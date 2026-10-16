import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';
import {publicNetworkAddress,validateImageProbeURL,probePublicImage,inspectMappedChannelImages} from '../src/public-image-probe.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=','base64');
const url='https://images.example.org/confirmed-picture.png';
const base={status:'current_mapping',url};
const safeLookup=async()=>[{address:'8.8.8.8',family:4}];
function fakeHttps({statusCode=206,type='image/png',bytes=png,timeout=false}={}){
 const calls=[];
 const transport=(target,options,callback)=>{
  calls.push({target:target.href,options});
  const req=new EventEmitter();
  req.setTimeout=(_ms,fn)=>{req.timeout=fn};
  req.destroy=()=>{};
  req.end=()=>{
   if(timeout)return queueMicrotask(()=>req.timeout());
   const response=Readable.from([bytes]);
   response.statusCode=statusCode;
   response.headers={'content-type':type};
   queueMicrotask(()=>callback(response));
  };
  return req;
 };
 return {calls,transport};
}
test('V53 public IP policy blocks private, reserved, mapped and metadata ranges',()=>{
 for(const ip of [
  '127.0.0.1','10.9.8.7','172.31.255.12','192.168.9.8','169.254.169.254',
  '100.100.100.200','192.0.2.3','198.51.100.12','203.0.113.5',
  '198.18.0.1','0.1.2.3','224.0.0.1','::1','::ffff:127.0.0.1',
  'fc00::1','fe80::1','2001:db8::1','2002::1','invalid'
 ])assert.equal(publicNetworkAddress(ip),false,ip);
 for(const ip of ['8.8.8.8','1.1.1.1','9.9.9.9','2001:4860:4860::8888'])
  assert.equal(publicNetworkAddress(ip),true,ip);
});
test('V53 refuses bad scheme, local/private target, credentials and query tokens before DNS',async()=>{
 const blocked=[
  'http://images.example.org/img.png','https://user:pass@images.example.org/img.png',
  'https://images.example.org:8443/img.png','https://127.0.0.1/img.png',
  'https://[::1]/img.png','https://localhost/img.png','https://images.local/img.png',
  'https://images.example.org/p.png?secret=token',
  'https://images.example.org/p.png#fragment','file:///etc/passwd','not-url'
 ];
 for(const u of blocked){assert.equal(validateImageProbeURL(u).valid,false,u);
  let resolutions=0;
  const s=await probePublicImage(u,{lookup:async()=>{resolutions++;return []}});
  assert.equal(s.status,'blocked');assert.equal(s.networkCalls,0);assert.equal(resolutions,0);
 }
});
test('V53 blocks mixed or rebinding DNS results without starting a connection',async()=>{
 for(const answers of [
  [{address:'127.0.0.1',family:4}],
  [{address:'8.8.8.8',family:4},{address:'169.254.169.254',family:4}],
  [{address:'2001:db8::1',family:6}],
  []
 ]){
  let calls=0;
  const s=await probePublicImage(url,{lookup:async()=>answers,transport:()=>{calls++}});
  assert.equal(s.status,'blocked');assert.equal(s.reason,'dns_contains_nonpublic_address');
  assert.equal(s.networkCalls,0);assert.equal(calls,0);
 }
 const fails=await probePublicImage(url,{lookup:async()=>{throw Error('private resolver details')}});
 assert.equal(fails.reason,'dns_unavailable');
 assert.ok(!JSON.stringify(fails).includes('private resolver details'));
});
test('V53 fixed-address HTTPS transport observes a PNG header without claiming complete CDN access',async()=>{
 const t=fakeHttps();
 const result=await probePublicImage(url,{lookup:safeLookup,transport:t.transport});
 assert.equal(result.status,'image_response_observed');
 assert.equal(result.networkCalls,1);assert.equal(result.httpStatus,206);
 assert.equal(result.mime,'image/png');assert.ok(result.bytesRead>=24);
 assert.equal(result.imageResponseObserved,true);
 assert.equal(result.cdnReachabilityVerified,false);
 assert.equal(result.browserRenderVerified,false);assert.equal(result.platformVerified,false);
 assert.equal(result.published,false);assert.equal(result.fullImageDownloaded,false);
 assert.equal(t.calls.length,1);
 assert.equal(t.calls[0].options.method,'GET');
 assert.equal(t.calls[0].options.rejectUnauthorized,true);
 assert.ok(t.calls[0].options.headers.Range);
 let chosen;
 t.calls[0].options.lookup('images.example.org',{},(_err,ip,family)=>{chosen=[ip,family]});
 assert.deepEqual(chosen,['8.8.8.8',4],'connection pins the previously approved DNS result');
});
test('V53 aborts redirects, bad responses, non-images, oversized streams and timeouts',async()=>{
 for(const [props,reason] of [
  [{statusCode:302,type:'text/html'},'redirect_not_followed'],
  [{statusCode:404},'image_http_error'],
  [{type:'text/html'},'unexpected_content_type'],
  [{type:'image/png',bytes:Buffer.alloc(44,42)},'image_signature_mismatch'],
  [{type:'image/png',bytes:Buffer.alloc(50000,42)},'response_exceeded_probe_limit'],
  [{timeout:true},'network_timeout']
 ]){
  const fake=fakeHttps(props);
  const r=await probePublicImage(url,{lookup:safeLookup,transport:fake.transport});
  assert.equal(r.status==='image_response_observed',false);
  assert.equal(r.reason,reason);
  assert.equal(r.networkCalls,1);
 }
});
test('V53 requires explicit consent and exact saved revision, limits to three saved mapped images',async()=>{
 let requests=0;
 const probe=async()=>{requests++;return {status:'image_response_observed',imageResponseObserved:true,networkCalls:1,dnsLookups:1}};
 const audit={references:[base]};
 await assert.rejects(inspectMappedChannelImages({audit,layoutRevision:4,expectedLayoutRevision:4,probe}),x=>x.status===403);
 await assert.rejects(inspectMappedChannelImages({audit,layoutRevision:4,expectedLayoutRevision:3,acknowledgeExternalRequests:true,probe}),x=>x.status===409);
 await assert.rejects(inspectMappedChannelImages({audit:{references:Array.from({length:4},(_,i)=>({...base,url:url+i}))},layoutRevision:4,expectedLayoutRevision:4,acknowledgeExternalRequests:true,probe}),x=>x.status===400);
 assert.equal(requests,0);
 const result=await inspectMappedChannelImages({audit:{references:[base,base,{...base,status:'stale_mapping'}]},layoutRevision:4,
  expectedLayoutRevision:4,acknowledgeExternalRequests:true,probe});
 assert.equal(requests,1);
 assert.equal(result.networkCalls,1);
 assert.equal(result.results[0].imageResponseObserved,true);
 assert.equal(result.results[0].cdnReachabilityVerified,false);
 assert.equal(result.platformVerified,false);
});
test('V53 API never makes DNS requests without affirmative user consent or matching revision',async t=>{
 const core=createCore(':memory:');t.after(()=>core.close());
 const req=(path,method='GET',data)=>dispatchApi(new Request('http://localhost:4312'+path,{
  method,headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined}),core);
 const project=await (await req('/api/editor/projects','POST',{title:'V53 explicit approval test',paragraphs:[{text:'只检查已保存稿件中登记的图片'}]})).json();
 const path='/api/composer/projects/'+project.id+'/wechat';
 const r=await req(path+'/image-network-check','POST',{expectedLayoutRevision:0,acknowledgeExternalRequests:false});
 assert.equal(r.status,403);
 const mismatch=await req(path+'/image-network-check','POST',{expectedLayoutRevision:2,acknowledgeExternalRequests:true});
 assert.equal(mismatch.status,409);
 const allowed=await req(path+'/image-network-check','POST',{expectedLayoutRevision:0,acknowledgeExternalRequests:true});
 assert.equal(allowed.status,200);
 const empty=await allowed.json();
 assert.equal(empty.networkCalls,0);
 assert.equal(empty.platformVerified,false);
 assert.equal(empty.published,false);
});

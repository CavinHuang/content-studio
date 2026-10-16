import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {inspectDoocsService,parseLocalDoocsAddress} from '../src/doocs-local-preflight.mjs';

async function localServer(t,handler){
 const server=createServer(handler);
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 t.after(()=>new Promise(ok=>server.close(ok)));
 return 'http://127.0.0.1:'+server.address().port+'/';
}
test('V50 probes a real loopback HTTP HTML service without sending article content',async t=>{
 let calls=0,method=null,body='',credential=null;
 const url=await localServer(t,async(req,res)=>{
  calls++;method=req.method;credential=req.headers.authorization||req.headers.cookie||null;
  for await(const chunk of req)body+=chunk;
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end('<!doctype html><title>Local mock formatter</title>');
 });
 const result=await inspectDoocsService({configuredUrl:url});
 assert.equal(result.status,'reachable');
 assert.equal(result.httpStatus,200);assert.equal(result.networkCalls,1);
 assert.equal(result.articleBytesSent,0);
 assert.equal(result.platformVerified,false);assert.equal(result.editorIdentityVerified,false);
 assert.equal(result.markdownRoundtripVerified,false);
 assert.equal(result.published,false);assert.equal(result.paidRequests,0);
 assert.equal(calls,1);assert.equal(method,'GET');assert.equal(body,'');assert.equal(credential,null);
});
test('V50 rejects any configured remote/private credential or path before making a request',async()=>{
 let calls=0;
 const requester=async()=>{calls++;throw Error('Requester must never run')};
 for(const configuredUrl of [
  'https://doocs.github.io/md/','https://example.org/',
  'http://user:pass@localhost:8800/',
  'http://127.0.0.1:80/private',
  'http://127.0.0.1:8800/?token=secret',
  'http://127.0.0.1:8800/#private',
  'ftp://127.0.0.1:8800/',
  'http://127.0.0.1:22/'
 ]){
  const result=await inspectDoocsService({configuredUrl,requester});
  assert.equal(result.status,'blocked',configuredUrl);
  assert.equal(result.networkCalls,0);
  assert.equal(result.articleBytesSent,0);
  assert.equal(result.platformVerified,false);
 }
 assert.equal(calls,0);
});
test('V50 refuses redirect, arbitrary JSON and missing services without claiming verification',async t=>{
 const redirect=await localServer(t,(_req,res)=>{res.writeHead(302,{Location:'https://example.com/collect'});res.end()});
 const redirectResult=await inspectDoocsService({configuredUrl:redirect});
 assert.equal(redirectResult.status,'blocked');
 assert.equal(redirectResult.reason,'redirect_not_followed');
 const json=await localServer(t,(_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}')});
 const notHtml=await inspectDoocsService({configuredUrl:json});
 assert.equal(notHtml.status,'unavailable');
 assert.equal(notHtml.reason,'non_html_or_bad_http_status');
 const disconnected=await inspectDoocsService({configuredUrl:'http://127.0.0.1:45999/',requester:async()=>{throw Error('simulated connection refused')}});
 assert.equal(disconnected.status,'unavailable');
 assert.equal(disconnected.reason,'connection_failed_or_timed_out');
});
test('V50 local address validation uses root only and handles configured or default URLs',()=>{
 assert.deepEqual(parseLocalDoocsAddress().url,'http://127.0.0.1:8800/');
 assert.equal(parseLocalDoocsAddress('http://localhost:8800/').safe,true);
 assert.equal(parseLocalDoocsAddress('http://127.0.0.1:8800/hack').safe,false);
 assert.equal(parseLocalDoocsAddress('not even a URL').safe,false);
});

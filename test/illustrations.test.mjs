import test from 'node:test';
import assert from 'node:assert/strict';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
const req=(c,path,method='GET',value)=>dispatchApi(new Request('http://localhost:4312'+path,{method,headers:value?{'content-type':'application/json'}:{},body:value?JSON.stringify(value):undefined}),c);
async function setup(t){const c=createCore(':memory:');t.after(()=>c.close());const p=await (await req(c,'/api/editor/projects','POST',{title:'Agent自动配图和编辑安全检查',paragraphs:[{text:'我们在项目中观察到配置错误导致的系统崩溃，需要在技术文章中解释复现过程。'},{text:'对比重试策略和限流处理的表现后，尚需复核实际用户是否经历相同的问题。'},{text:'最终介绍一个解决思路以及应当避免的误导性功能宣传，图文都不能代替证据。'}]})).json();return {c,p,base:`/api/illustrations/projects/${p.id}`};}

test('local illustration plan creates a cover and section suggestions without network and rejects stale revisions',async t=>{
 const {c,p,base}=await setup(t);
 const plan=await req(c,base+'/plan','POST',{expectedMasterRevision:1});assert.equal(plan.status,201);
 const v=await plan.json();assert.equal(v.shots[0].role,'cover');assert.ok(v.shots.length>=2&&v.shots.length<=3);
 assert.equal(v.shots.every(s=>s.status==='planned'),true);
 assert.ok(v.shots.every(s=>/not documented evidence|NOT documented evidence/.test(s.prompt)));
 assert.equal((await req(c,base+'/plan','POST',{expectedMasterRevision:0})).status,409);
 assert.equal((await req(c,base+'/plan','POST',{expectedMasterRevision:1})).status,201);
 const master=p.channels.master.document;
 const updated=await req(c,`/api/editor/projects/${p.id}/master/document`,'PUT',{expectedRevision:1,paragraphs:master.paragraphs.map(b=>({id:b.id,text:b.text+' 新修订。'}))});assert.equal(updated.status,200);
 const stale=await (await req(c,base)).json();assert.equal(stale.stale,true);
 assert.equal((await req(c,base+'/handoff/wechat')).status,409);
});

test('provider upload must be authorized; approved images stay private until per-channel address mapping',async t=>{
 const {c,p,base}=await setup(t);
 let calls=0;c.illustrations.generator=async()=>{calls++;return {base64:png,model:'mock-image-model'}};
 const plan=await (await req(c,base+'/plan','POST',{expectedMasterRevision:1})).json();const shot=plan.shots[0];
 assert.equal((await req(c,`${base}/shots/${shot.id}/generate`,'POST',{})).status,403);assert.equal(calls,0);
 assert.equal((await req(c,`${base}/shots/${shot.id}/decision`,'POST',{decision:'approve'})).status,409);
 const result=await req(c,`${base}/shots/${shot.id}/generate`,'POST',{allowExternalAI:true});assert.equal(result.status,200);const generated=await result.json();
 assert.equal(generated.status,'generated');assert.match(generated.assetId,/^as_[a-f0-9]{32}$/);assert.equal(calls,1);
 assert.equal((await req(c,`/api/assets/${generated.assetId}/preview`)).headers.get('content-type'),'image/png');
 const approved=await req(c,`${base}/shots/${shot.id}/decision`,'POST',{decision:'approve'});assert.equal(approved.status,200);
 const unmapped=await (await req(c,base+'/handoff/wechat')).json();assert.equal(unmapped.ready,false);assert.deepEqual(unmapped.unmapped,[shot.id]);
 assert.equal((await req(c,`/api/assets/${generated.assetId}/mappings/wechat`,'PUT',{url:'http://localhost:4312/a.png',note:'作者实际上传素材后的记录'})).status,400);
 const map=await req(c,`/api/assets/${generated.assetId}/mappings/wechat`,'PUT',{url:'https://cdn.example.org/agent-cover.png',note:'2026-10-13 微信排版器手动上传后的URL地址'});assert.equal(map.status,200);
 const handoff=await (await req(c,base+'/handoff/wechat')).json();assert.equal(handoff.ready,true);assert.match(handoff.markdown,/cdn\.example\.org\/agent-cover\.png/);
 assert.equal(handoff.inserted.length,1);assert.equal(handoff.platformVerified,false);
 const zhihu=await (await req(c,base+'/handoff/zhihu')).json();assert.equal(zhihu.ready,false);assert.equal(zhihu.unmapped[0],shot.id);
 const current=await (await req(c,`/api/composer/projects/${p.id}/wechat`)).json();assert.doesNotMatch(current.markdown,/agent-cover\.png/);
});

test('generation failure is recorded and supports explicit retry, approval and rejection',async t=>{
 const {c,base}=await setup(t);const plan=await (await req(c,base+'/plan','POST',{expectedMasterRevision:1})).json();const shot=plan.shots[0];
 c.illustrations.generator=async()=>{throw Object.assign(new Error('Provider offline'),{status:502})};
 const fail=await req(c,`${base}/shots/${shot.id}/generate`,'POST',{allowExternalAI:true});assert.equal(fail.status,502);
 let state=await (await req(c,base)).json();assert.equal(state.shots[0].status,'failed');assert.match(state.shots[0].error,/Provider offline/);
 c.illustrations.generator=async()=>({base64:png,model:'test'});
 assert.equal((await req(c,`${base}/shots/${shot.id}/generate`,'POST',{allowExternalAI:true})).status,200);
 assert.equal((await req(c,`${base}/shots/${shot.id}/generate`,'POST',{allowExternalAI:true})).status,409);
 assert.equal((await req(c,`${base}/shots/${shot.id}/decision`,'POST',{decision:'reject'})).status,200);
 state=await (await req(c,base)).json();assert.equal(state.shots[0].status,'rejected');
 assert.equal((await req(c,`${base}/shots/${shot.id}/decision`,'POST',{decision:'approve'})).status,200);
});

test('illustration handoff preserves missing placement warnings when author rewrites channel content',async t=>{
 const {c,p,base}=await setup(t);
 const plan=await (await req(c,base+'/plan','POST',{expectedMasterRevision:1})).json();const shot=plan.shots.find(x=>x.role==='section');assert.ok(shot);
 c.illustrations.generator=async()=>({base64:png,model:'test'});
 const generated=await (await req(c,`${base}/shots/${shot.id}/generate`,'POST',{allowExternalAI:true})).json();
 await req(c,`${base}/shots/${shot.id}/decision`,'POST',{decision:'approve'});
 await req(c,`/api/assets/${generated.assetId}/mappings/wechat`,'PUT',{url:'https://images.example.net/scene.png',note:'作者手动登记的微信渠道上传记录'});
 const out=await (await req(c,base+'/handoff/wechat')).json();assert.equal(out.ready,true);assert.equal(out.inserted[0].after,shot.paragraphId);
 // Save an unrelated layout revision that excludes the original source paragraph, then refuse auto placement.
 const v=await (await req(c,`/api/composer/projects/${p.id}/wechat`)).json();
 const audited=await (await req(c,`/api/composer/projects/${p.id}/wechat/review`,'POST',{expectedLayoutRevision:v.layoutRevision,expectedDocumentRevision:v.sourceDocumentRevision,markdown:'# 创作者重新写过的标题\n\n新的内容由创作者独立整理。'})).json();
 assert.equal((await req(c,`/api/composer/projects/${p.id}/wechat`,'PUT',{expectedLayoutRevision:v.layoutRevision,expectedDocumentRevision:v.sourceDocumentRevision,markdown:'# 创作者重新写过的标题\n\n新的内容由创作者独立整理。',reviewToken:audited.reviewToken,acknowledgeDrift:true})).status,200);
 const after=await (await req(c,base+'/handoff/wechat')).json();assert.equal(after.ready,false);assert.deepEqual(after.unplaced,[shot.id]);
});

test('image provider uses configured server-only credentials, parses true b64 output and never follows URL-only images',async()=>{
 const {requestImageGeneration}=await import('../src/illustrations.mjs');
 const before={base:process.env.CONTENT_IMAGE_API_BASE_URL,key:process.env.CONTENT_IMAGE_API_KEY,model:process.env.CONTENT_IMAGE_MODEL};const original=globalThis.fetch;
 process.env.CONTENT_IMAGE_API_BASE_URL='https://image.example.org/v1/';process.env.CONTENT_IMAGE_API_KEY='not-a-real-secret';process.env.CONTENT_IMAGE_MODEL='illustration-test';
 const seen=[];
 try{
  globalThis.fetch=async (url,opt)=>{seen.push({url:url.href||url,headers:opt.headers,body:JSON.parse(opt.body)});return Response.json({data:[{b64_json:png}]})};
  const result=await requestImageGeneration('Draw an illustration');assert.equal(result.base64,png);assert.equal(result.model,'illustration-test');
  assert.equal(seen[0].url,'https://image.example.org/v1/images/generations');assert.equal(seen[0].headers.authorization,'Bearer not-a-real-secret');
  assert.match(JSON.stringify(seen[0].body),/illustration-test/);
  assert.equal(Object.hasOwn(seen[0].body,'response_format'),false,'GPT Image models always return base64; deprecated response_format must not be sent');
  globalThis.fetch=async()=>Response.json({data:[{url:'https://unknown.example/image.png'}]});
  await assert.rejects(()=>requestImageGeneration('Draw another'),/no base64 image/);
  process.env.CONTENT_IMAGE_API_BASE_URL='http://outside.example/v1/';
  await assert.rejects(()=>requestImageGeneration('test'),/must use HTTPS/);
 }finally{globalThis.fetch=original;for(const [name,value] of Object.entries({CONTENT_IMAGE_API_BASE_URL:before.base,CONTENT_IMAGE_API_KEY:before.key,CONTENT_IMAGE_MODEL:before.model})){if(value===undefined)delete process.env[name];else process.env[name]=value}}
});

test('local image library de-duplicates uploads and does not expose credentials',async t=>{
 const {c}=await setup(t);const one=await (await req(c,'/api/assets','POST',{name:'image.png',alt:'一张局部示意图',base64:png})).json();
 const two=await (await req(c,'/api/assets','POST',{name:'image-duplicate.png',base64:png})).json();
 assert.equal(one.id,two.id);assert.equal(one.deduplicated,false);assert.equal(two.deduplicated,true);
 assert.equal((await req(c,'/api/assets')).status,200);
 assert.equal((await req(c,`/api/assets/${one.id}/preview`)).headers.get('cache-control'),'private, no-store');
 const invalid=await req(c,'/api/assets','POST',{base64:Buffer.from('<svg onload=alert(1)>').toString('base64')});assert.equal(invalid.status,422);
});

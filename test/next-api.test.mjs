import test from 'node:test';
import assert from 'node:assert/strict';
import { createCore } from '../lib/core.mjs';
import { dispatchApi } from '../lib/api.mjs';

async function setup(t){const core=createCore(':memory:');t.after(()=>core.close());return core;}
const get=(p,core)=>dispatchApi(new Request('http://localhost:4312'+p),core);
const post=(p,obj,core,method='POST')=>dispatchApi(new Request('http://localhost:4312'+p,{method,headers:{'content-type':'application/json'},body:JSON.stringify(obj)}),core);

test('Next handler health, local mode and initial state',async t=>{const core=await setup(t);let x=await get('/api/health',core);assert.equal(x.status,200);assert.equal((await x.json()).framework,'nextjs');x=await get('/api/editor/projects',core);assert.deepEqual((await x.json()).projects,[]);});
test('rejects remote access by default',async t=>{const core=await setup(t);const r=await dispatchApi(new Request('https://example.com/api/health'),core);assert.equal(r.status,403);});
test('rejects cross origin mutation',async t=>{const core=await setup(t);const r=await dispatchApi(new Request('http://localhost:4312/api/editor/projects',{method:'POST',headers:{origin:'https://evil.example'},body:'{}'}),core);assert.equal(r.status,403);});
test('creates real SQLite article and keeps channels isolated',async t=>{const core=await setup(t);let r=await post('/api/editor/projects',{title:'一篇关于 Agent 验证的原创文章'},core);assert.equal(r.status,201);let p=await r.json();assert.equal(p.channels.master.document.paragraphs.length,1);assert.equal(p.channels.wechat.document.revision,1);const original=p.channels.wechat.document.paragraphs[0].text;r=await post(`/api/editor/projects/${p.id}/master/document`,{expectedRevision:1,paragraphs:[{...p.channels.master.document.paragraphs[0],text:'我在真实项目中观察到了一个需要继续核验的技术问题。'}]},core,'PUT');assert.equal(r.status,200);p=await r.json();assert.equal(p.channels.wechat.document.paragraphs[0].text,original);assert.equal(p.channels.wechat.masterOutdated,true);});
test('conflicting revisions get 409, no lost updates',async t=>{const core=await setup(t);const p=await (await post('/api/editor/projects',{title:'校验并发写入'},core)).json();const r=await post(`/api/editor/projects/${p.id}/master/document`,{expectedRevision:0,paragraphs:[{text:'不能写入旧版本'}]},core,'PUT');assert.equal(r.status,409);});
test('export blocked until four explicit channel checks',async t=>{const core=await setup(t);const p=await (await post('/api/editor/projects',{title:'渠道审核和导出'},core)).json();const r=await post(`/api/editor/projects/${p.id}/wechat/export`,{expectedRevision:1},core);assert.ok(r.status>=400);});
test('source data empty when not synced; fixtures opt-in',async t=>{const core=await setup(t);const r=await get('/api/events',core);assert.deepEqual((await r.json()).events,[]);const s=await post('/api/fixture/seed',{},core);assert.equal(s.status,403);});
test('route errors and malformed request bodies',async t=>{const core=await setup(t);assert.equal((await get('/api/absent',core)).status,404);const r=await dispatchApi(new Request('http://localhost:4312/api/editor/projects',{method:'POST',body:'{' }),core);assert.equal(r.status,400);});
test('research and knowledge endpoints return real empty state',async t=>{const core=await setup(t);assert.equal((await get('/api/validations',core)).status,200);assert.equal((await get('/api/knowledge',core)).status,200);});

test('loopback 127.0.0.1 and localhost aliases work for same-port browser mutations',async t=>{
 const core=await setup(t);
 for(const [requestUrl,origin] of [
  ['http://localhost:4312/api/editor/projects','http://127.0.0.1:4312'],
  ['http://127.0.0.1:4312/api/editor/projects','http://localhost:4312']
 ]){
  const res=await dispatchApi(new Request(requestUrl,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({title:'Valid same-port loopback-origin test'})}),core);
  assert.equal(res.status,201,requestUrl+' from '+origin);
 }
});
test('local aliases do not relax cross-port, cross-protocol or attacker origins',async t=>{
 const core=await setup(t);
 for(const origin of ['http://127.0.0.1:4313','http://localhost:4313','https://127.0.0.1:4312','http://attacker.example:4312','not-a-url']){
  const res=await dispatchApi(new Request('http://localhost:4312/api/editor/projects',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({title:'Should never be created'})}),core);
  assert.equal(res.status,403,origin);
 }
 assert.equal((await get('/api/editor/projects',core)).status,200);
 assert.deepEqual((await (await get('/api/editor/projects',core)).json()).projects,[]);
});


test('V58 Next handler refuses simple form writes before mutating SQLite',async t=>{
 const core=await setup(t);
 const untrusted=await dispatchApi(new Request('http://localhost:4312/api/editor/projects',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
  body:'title=csrf-example'
 }),core);
 assert.equal(untrusted.status,400);
 const crossSiteRead=await dispatchApi(new Request('http://localhost:4312/api/editor/projects',{
  headers:{'sec-fetch-site':'cross-site'}
 }),core);
 assert.equal(crossSiteRead.status,403);
 const mismatch=await dispatchApi(new Request('http://localhost:4312/api/editor/projects',{
  headers:{host:'localhost:5555'}
 }),core);
 assert.equal(mismatch.status,403);
 assert.deepEqual((await (await get('/api/editor/projects',core)).json()).projects,[]);
});

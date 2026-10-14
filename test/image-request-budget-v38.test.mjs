import test from 'node:test';
import assert from 'node:assert/strict';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';
import {ImageRequestBudget} from '../src/image-request-budget.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
const req=(core,path,method='GET',value)=>dispatchApi(new Request('http://localhost:4312'+path,{method,headers:value?{'content-type':'application/json'}:{},body:value?JSON.stringify(value):undefined}),core);
async function setup(t){
 const core=createCore(':memory:');t.after(()=>core.close());
 const res=await req(core,'/api/editor/projects','POST',{title:'配图预算与人工审阅验证',paragraphs:[
  {text:'本地工具允许作者在每次付费模型调用前控制额度，并且记录所有外部请求。'},
  {text:'当第一个供应商超时或限流，系统可能选择其他供应商进行一次新的模型请求。'},
  {text:'原图片需要经过人工选择后才可以进入渠道 Markdown 排版流程，不能直接发表。'}
 ]});
 assert.equal(res.status,201);
 const article=await res.json();return {core,article,base:`/api/illustrations/projects/${article.id}`};
}

test('UTC requests are durably reserved before providers and never freed by errors or crashes',async t=>{
 const {core,article}=await setup(t);
 const budget=new ImageRequestBudget(core.store.db,()=>new Date('2026-10-13T23:58:00Z'));
 assert.equal(budget.get(article.id).dailyLimit,12);
 budget.setLimit(article.id,{expectedRevision:0,dailyLimit:2});
 const a=budget.reserve(article.id,{kind:'generate',provider:'openai',shotId:'il_demo'});
 budget.finish(a.id,'failed');
 const b=budget.reserve(article.id,{kind:'edit',provider:'qwen',shotId:'il_demo'});
 assert.equal(budget.get(article.id).used,2);
 assert.equal(budget.get(article.id).reserved,1,'unresolved reserved requests stay counted conservatively');
 assert.throws(()=>budget.reserve(article.id,{kind:'review',provider:'vision'}),e=>e.status===429);
 assert.throws(()=>budget.setLimit(article.id,{expectedRevision:0,dailyLimit:99}),e=>e.status===409);
 const rows=budget.history(article.id);
 assert.equal(rows.length,2);
 assert.equal(JSON.stringify(rows).includes('prompt'),false,'ledger excludes prompts, credentials and image bytes');
 budget.clock=()=>new Date('2026-10-14T00:00:00Z');
 assert.equal(budget.get(article.id).used,0,'cap resets at exact UTC day boundary');
 assert.equal(budget.get(article.id).dailyLimit,2);
 assert.equal(budget.history(article.id).length,2,'history stays immutable across days');
});

test('budget API is project scoped, optimistic and does not reserve on missing consent',async t=>{
 const {core,article,base}=await setup(t);
 const initial=await (await req(core,base+'/budget')).json();
 assert.equal(initial.revision,0);assert.equal(initial.remaining,12);
 assert.equal((await req(core,base+'/budget','PUT',{expectedRevision:0,dailyLimit:1})).status,200);
 assert.equal((await req(core,base+'/budget','PUT',{expectedRevision:0,dailyLimit:100})).status,409);
 assert.equal((await req(core,base+'/budget','PUT',{expectedRevision:1,dailyLimit:0})).status,400);
 assert.equal((await req(core,base+'/plan','POST',{expectedMasterRevision:1})).status,201);
 const current=await (await req(core,base)).json();
 const first=current.shots[0],second=current.shots[1];
 let calls=0;core.illustrations.generator=async()=>{calls++;return {base64:png,model:'budget-test'}};
 assert.equal((await req(core,`${base}/shots/${first.id}/generate`,'POST',{allowExternalAI:false})).status,403);
 assert.equal((await req(core,base+'/budget')).status,200);
 const generated=await req(core,`${base}/shots/${first.id}/generate`,'POST',{allowExternalAI:true});
 assert.equal(generated.status,200);
 assert.equal(calls,1);
 const cap=await req(core,`${base}/shots/${second.id}/generate`,'POST',{allowExternalAI:true});
 assert.equal(cap.status,429);
 assert.equal(calls,1,'provider must not be invoked once quota is exhausted');
 const summary=await (await req(core,base+'/budget')).json();
 assert.equal(summary.used,1);assert.equal(summary.remaining,0);
 assert.equal(summary.recent.length,1);
 assert.equal(summary.recent[0].kind,'generate');
 assert.equal(summary.recent[0].status,'success');
 assert.equal((await req(core,'/api/illustrations/projects/ep_nonexistent/budget')).status,404);
});

test('fallback retries independently consume quota and do not bypass a hard cap',async t=>{
 const {core,base}=await setup(t);
 await req(core,base+'/budget','PUT',{expectedRevision:0,dailyLimit:1});
 const plan=await (await req(core,base+'/plan','POST',{expectedMasterRevision:1})).json(),shot=plan.shots[0];
 let calls=0;core.illustrations.generator=async()=>{calls++;throw Object.assign(new Error('429 upstream'),{status:502})};
 const answer=await req(core,`${base}/shots/${shot.id}/generate`,'POST',{allowExternalAI:true,provider:'openai',fallbackProviders:['qwen'],maxAttempts:2});
 assert.equal(answer.status,429);
 assert.equal(calls,1,'fallback second provider does not run without budget');
 const log=(await (await req(core,base+'/budget')).json()).recent;
 assert.equal(log.length,1);assert.equal(log[0].status,'failed');assert.equal(log[0].provider,'openai');
});

test('image editing uses the same request budget as generation, with no implicit candidate approval',async t=>{
 const {core,base}=await setup(t);
 assert.equal((await req(core,base+'/budget','PUT',{expectedRevision:0,dailyLimit:2})).status,200);
 const plan=await (await req(core,base+'/plan','POST',{expectedMasterRevision:1})).json(),shot=plan.shots[0];
 core.illustrations.generator=async()=>({base64:png,model:'test'});
 core.illustrations.editor=async()=>({base64:png,provider:'openai',model:'mock-edit'});
 const generated=await (await req(core,`${base}/shots/${shot.id}/generate`,'POST',{allowExternalAI:true})).json();
 const r=await req(core,`${base}/shots/${shot.id}/candidates`,'POST',{allowExternalAI:true,expectedUpdatedAt:generated.updatedAt,referenceAssetId:generated.assetId,provider:'openai',instruction:'请调整画面留白和布局，使主体更加突出。'});
 assert.equal(r.status,201,JSON.stringify(await r.clone().json()));
 const candidate=(await r.json()).candidate;
 assert.equal(candidate.status,'generated');
 assert.equal((await (await req(core,base+'/budget')).json()).used,2);
 assert.equal((await req(core,`${base}/shots/${shot.id}/candidates`,'POST',{allowExternalAI:true,expectedUpdatedAt:generated.updatedAt,referenceAssetId:generated.assetId,provider:'openai',instruction:'请稍微增加图像对比度，保持原有配色。'})).status,429);
});

test('manual recovery clears an abandoned generating slot but keeps possible charges counted',async t=>{
 const {core,base,article}=await setup(t);
 const plan=await (await req(core,base+'/plan','POST',{expectedMasterRevision:1})).json(),shot=plan.shots[0];
 const tooRecent=new Date().toISOString();
 const db=core.store.db;
 db.prepare("UPDATE article_illustration_shots SET status='generating',updated_at=? WHERE id=?").run(tooRecent,shot.id);
 const endpoint=`${base}/shots/${shot.id}/recover`;
 assert.equal((await req(core,endpoint,'POST',{expectedUpdatedAt:tooRecent})).status,409,'live tasks must not be forcibly reclaimed');
 const staleAt=new Date(Date.now()-11*60*1000).toISOString();
 db.prepare('UPDATE article_illustration_shots SET updated_at=? WHERE id=?').run(staleAt,shot.id);
 const reservation=core.illustrations.budget.reserve(article.id,{shotId:shot.id,kind:'generate',provider:'openai'});
 assert.ok(reservation.id);
 assert.equal((await req(core,endpoint,'POST',{expectedUpdatedAt:'wrong'})).status,409);
 const recovered=await req(core,endpoint,'POST',{expectedUpdatedAt:staleAt});
 assert.equal(recovered.status,200);
 const value=await recovered.json();assert.equal(value.status,'failed');
 assert.match(value.error,/Provider outcome and billing are unknown/);
 const quota=await (await req(core,base+'/budget')).json();
 assert.equal(quota.used,1,'do not return possibly charged request to budget');
 assert.equal(quota.reserved,0);
 assert.equal(quota.recent[0].status,'interrupted');
 assert.equal((await req(core,endpoint,'POST',{expectedUpdatedAt:staleAt})).status,409,'recovery must not be replayed');
});

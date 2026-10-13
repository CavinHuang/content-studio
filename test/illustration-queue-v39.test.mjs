import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
const req=(core,path,method='GET',value)=>dispatchApi(new Request('http://localhost:4312'+path,{
 method,headers:value?{'content-type':'application/json'}:{},body:value?JSON.stringify(value):undefined
}),core);
async function article(core,name='Queue article'){
 const r=await req(core,'/api/editor/projects','POST',{title:name,paragraphs:[
  {text:'这篇技术文章将解释为什么模型配图需要准确记录提供商请求的状态与失败成本。'},
  {text:'图片仅为编辑性插画，作者需要逐一批准后才能进入任何渠道的交付流程。'},
  {text:'批量生成应该支持明确的权限控制和人工复核，不能悄悄重复付费请求。'}
 ]});
 assert.equal(r.status,201);
 const project=await r.json(),path=`/api/illustrations/projects/${project.id}`;
 const planR=await req(core,path+'/plan','POST',{expectedMasterRevision:1});
 assert.equal(planR.status,201);const plan=await planR.json();
 return {project,plan,items:plan.shots.map(s=>({projectId:project.id,shotId:s.id,expectedUpdatedAt:s.updatedAt}))};
}
const payload=(items,id='batch001')=>({idempotencyKey:id,allowExternalAI:true,items,provider:'openai',fallbackProviders:[],maxAttempts:1});

test('enqueue is persistent and idempotent, requires double consent and is not a model call',async t=>{
 const core=createCore(':memory:');t.after(()=>core.close());
 const a=await article(core);
 let calls=0;core.illustrations.generator=async()=>{calls++;return {base64:png,model:'mock'}};
 const p=payload(a.items.slice(0,2),'batch_canonical_v39');
 assert.equal((await req(core,'/api/illustrations/queue/batches','POST',{...p,allowExternalAI:false})).status,403);
 assert.equal((await req(core,'/api/illustrations/queue/start','POST',{})).status,403);
 const first=await req(core,'/api/illustrations/queue/batches','POST',p);assert.equal(first.status,201);
 const created=await first.json();assert.equal(created.jobs.length,2);
 assert.ok(created.jobs.every(x=>x.status==='queued'));
 const repeat=await (await req(core,'/api/illustrations/queue/batches','POST',p)).json();
 assert.deepEqual(repeat.jobs.map(x=>x.id),created.jobs.map(x=>x.id),'same key and same contents cannot charge twice');
 assert.equal((await req(core,'/api/illustrations/queue/batches','POST',{...p,items:a.items.slice(0,1)})).status,409);
 assert.equal((await req(core,'/api/illustrations/queue/batches','POST',payload(a.items.slice(0,1),'batch_conflict_2'))).status,409);
 assert.equal(calls,0,'enqueuing and querying must not call paid models');
 assert.equal((await req(core,'/api/illustrations/queue')).status,200);
 assert.equal((await req(core,'/api/illustrations/queue/start','POST',{allowExternalAI:true})).status,200);
 await core.queue.waitForIdle();
 assert.equal(calls,2);
 const final=(await (await req(core,'/api/illustrations/queue')).json());
 assert.equal(final.counts.completed,2);
 assert.equal(final.counts.queued||0,0);
 const states=(await (await req(core,`/api/illustrations/projects/${a.project.id}`)).json()).shots;
 assert.equal(states.filter(s=>s.status==='generated').length,2,'generated images remain unapproved');
 assert.equal((await req(core,`/api/illustrations/queue/jobs/${created.jobs[0].id}/events`)).status,200);
 assert.equal((await (await req(core,`/api/illustrations/projects/${a.project.id}/budget`)).json()).used,2);
});

test('multiple articles share one worker; pause leaves not-yet-started jobs queued',async t=>{
 const core=createCore(':memory:');t.after(()=>core.close());
 const one=await article(core,'first queue project'),two=await article(core,'second queue project');
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 let calls=0;core.illustrations.generator=async()=>{calls++;if(calls===1){entered();await gate}return {base64:png,model:'mock'}};
 const items=[one.items[0],two.items[0]];
 const batch=core.queue.enqueue(payload(items,'two_projects_paused'));
 core.queue.start({allowExternalAI:true});
 await started;
 const paused=core.queue.pause();assert.equal(paused.stopping,true);
 release();
 await core.queue.waitForIdle();
 const state=core.queue.get();
 assert.equal(state.counts.completed,1);assert.equal(state.counts.queued,1);assert.equal(calls,1);
 const perProject=core.queue.get({projectId:two.project.id});
 assert.equal(perProject.counts.queued,1);
 assert.equal(batch.jobs.length,2);
 core.queue.start({allowExternalAI:true});
 await core.queue.waitForIdle();
 assert.equal(calls,2);assert.equal(core.queue.get().counts.completed,2);
});

test('queued cancellation costs nothing; in-flight cancel never retries a fallback or automatically approves',async t=>{
 const core=createCore(':memory:');t.after(()=>core.close());
 const a=await article(core);
 const batch=core.queue.enqueue({...payload(a.items.slice(0,2),'cancel_pending_01'),fallbackProviders:['qwen'],maxAttempts:2});
 const queued=core.queue.cancel(batch.jobs[1].id);
 assert.equal(queued.status,'cancelled');
 let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 let calls=0;core.illustrations.generator=async()=>{calls++;entered();await gate;throw Object.assign(new Error('temporary upstream error'),{status:503})};
 core.queue.start({allowExternalAI:true});
 await started;
 const requested=await req(core,`/api/illustrations/queue/jobs/${batch.jobs[0].id}/cancel`,'POST');
 assert.equal(requested.status,200);
 assert.equal((await requested.json()).cancelRequested,true);
 release();
 await core.queue.waitForIdle();
 assert.equal(calls,1,'cancel before fallback must prohibit second provider');
 assert.equal(core.queue.get().counts.cancelled,2);
 assert.equal((await (await req(core,`/api/illustrations/projects/${a.project.id}/budget`)).json()).used,1);
 assert.equal((await req(core,`/api/illustrations/queue/jobs/${batch.jobs[0].id}/retry`,'POST',{allowExternalAI:true})).status,409);
});

test('stale plans are rejected at dispatch without consuming quota; jobs must not be automatically revived',async t=>{
 const core=createCore(':memory:');t.after(()=>core.close());
 const a=await article(core);let calls=0;core.illustrations.generator=async()=>{calls++;return {base64:png}};
 const batch=core.queue.enqueue(payload([a.items[0]],'stale_image_plan'));
 assert.equal((await req(core,`/api/illustrations/projects/${a.project.id}/plan`,'POST',{expectedMasterRevision:1})).status,201);
 core.queue.start({allowExternalAI:true});await core.queue.waitForIdle();
 assert.equal(core.queue.get().counts.obsolete,1);assert.equal(calls,0);
 assert.equal((await req(core,`/api/illustrations/queue/jobs/${batch.jobs[0].id}/retry`,'POST',{allowExternalAI:true})).status,409);
 assert.equal((await (await req(core,`/api/illustrations/projects/${a.project.id}/budget`)).json()).used,0);
});

test('daily quota blocks the worker and explicit retry continues only after cap is raised',async t=>{
 const core=createCore(':memory:');t.after(()=>core.close());const a=await article(core);
 await req(core,`/api/illustrations/projects/${a.project.id}/budget`,'PUT',{expectedRevision:0,dailyLimit:1});
 let calls=0;core.illustrations.generator=async()=>{calls++;return {base64:png,model:'mock'}};
 const batch=core.queue.enqueue(payload(a.items.slice(0,2),'budget_queue_01'));
 core.queue.start({allowExternalAI:true});await core.queue.waitForIdle();
 assert.equal(calls,1);
 const statuses=core.queue.get().counts;
 assert.equal(statuses.completed,1);assert.equal(statuses.blocked_budget,1);
 const blocked=batch.jobs[1].id;
 assert.equal((await req(core,`/api/illustrations/queue/jobs/${blocked}/retry`,'POST',{})).status,403);
 assert.equal((await req(core,`/api/illustrations/queue/jobs/${blocked}/retry`,'POST',{allowExternalAI:true})).status,200);
 await req(core,`/api/illustrations/projects/${a.project.id}/budget`,'PUT',{expectedRevision:1,dailyLimit:2});
 core.queue.start({allowExternalAI:true});await core.queue.waitForIdle();
 assert.equal(calls,2);assert.equal(core.queue.get().counts.completed,2);
 assert.equal((await (await req(core,`/api/illustrations/projects/${a.project.id}/budget`)).json()).used,2);
});

test('restart marks running job interrupted and never starts external work without explicit action',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'content-studio-v39-')),path=join(dir,'studio.sqlite');
 let core=createCore(path);t.after(()=>{try{core.close()}catch{}rmSync(dir,{recursive:true,force:true})});
 const a=await article(core);const batch=core.queue.enqueue(payload([a.items[0]],'restart_safety_1'));
 const old=new Date(Date.now()-11*60*1000).toISOString();
 core.store.db.prepare("UPDATE illustration_queue_jobs SET status='running',started_at=? WHERE id=?").run(old,batch.jobs[0].id);
 core.store.db.prepare("UPDATE article_illustration_shots SET status='generating',updated_at=? WHERE id=?").run(old,a.items[0].shotId);
 core.illustrations.budget.reserve(a.project.id,{shotId:a.items[0].shotId,kind:'generate',provider:'openai'});
 core.close();core=createCore(path);
 assert.equal(core.queue.get().counts.interrupted,1);
 let calls=0;core.illustrations.generator=async()=>{calls++;return {base64:png}};
 await new Promise(r=>setImmediate(r));
 assert.equal(calls,0,'reopening database must not replay paid calls');
 assert.equal((await (await req(core,`/api/illustrations/projects/${a.project.id}/budget`)).json()).reserved,1);
 assert.equal((await req(core,`/api/illustrations/queue/jobs/${batch.jobs[0].id}/retry`,'POST',{allowExternalAI:true})).status,409);
 const recovered=await req(core,`/api/illustrations/projects/${a.project.id}/shots/${a.items[0].shotId}/recover`,'POST',{expectedUpdatedAt:old});
 assert.equal(recovered.status,200);
 assert.equal((await (await req(core,`/api/illustrations/projects/${a.project.id}/budget`)).json()).reserved,0);
 // User deliberately creates a new batch after inspecting potential provider charges.
 const current=await (await req(core,`/api/illustrations/projects/${a.project.id}`)).json();
 const updated=current.shots.find(x=>x.id===a.items[0].shotId);
 core.queue.enqueue(payload([{projectId:a.project.id,shotId:updated.id,expectedUpdatedAt:updated.updatedAt}],'restart_manual_retry_2'));
 assert.equal(calls,0);
 core.queue.start({allowExternalAI:true});await core.queue.waitForIdle();
 assert.equal(calls,1);
});

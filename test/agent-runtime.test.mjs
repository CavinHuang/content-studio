import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';
import {AGENT_MAX_STEPS} from '../src/agent-runtime.mjs';

function setup(t){const root=mkdtempSync(join(tmpdir(),'agent-runtime-')),file=join(root,'test.sqlite');let core=createCore(file);t.after(()=>{core.close();rmSync(root,{recursive:true,force:true})});return {get core(){return core},reopen(){core.close();core=createCore(file);return core}}}
function provider(t){const names=['CONTENT_AI_BASE_URL','CONTENT_AI_MODEL','CONTENT_AI_API_KEY'],old=names.map(n=>process.env[n]);
 t.after(()=>names.forEach((n,i)=>{if(old[i]===undefined)delete process.env[n];else process.env[n]=old[i]}));
 process.env.CONTENT_AI_BASE_URL='https://writing.example/v1/';process.env.CONTENT_AI_MODEL='synthetic-writing-model';process.env.CONTENT_AI_API_KEY='synthetic-test-key';
}
const final=()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'完成'}}]}),{headers:{'content-type':'application/json'}});

test('default agent profile is created once, survives reopen and can be narrowed',t=>{
 const env=setup(t);
 const first=env.core.agent.profile();
 assert.equal(first.id,'ag_default');assert.equal(first.writeMode,'suggestions');
 assert.ok(first.tools.includes('read_document'));assert.ok(first.tools.includes('write_revision'));
 const again=env.reopen().agent.profile();
 assert.equal(again.writeMode,'suggestions');assert.deepEqual(again.tools,first.tools);
 const narrowed=env.core.agent.saveProfile({tools:['read_document','read_context']});
 assert.deepEqual(narrowed.tools,['read_document','read_context']);
 assert.throws(()=>env.core.agent.saveProfile({writeMode:'auto'}),e=>e.status===400);
 assert.throws(()=>env.core.agent.saveProfile({connectionId:'sc_missing'}),e=>e.status===404);
});

test('runs left running by a dead process become interrupted on startup',t=>{
 const env=setup(t),core=env.core;
 core.db.prepare("INSERT INTO agent_runs VALUES('ar_stale','ep_x','master',1,'draft-writer',1,'ag_default','running','','测试','{}','dead-owner','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')").run();
 const fresh=env.reopen();
 assert.equal(fresh.agent.run('ep_x','ar_stale').status,'interrupted');
 assert.match(fresh.agent.run('ep_x','ar_stale').stopReason,/进程重启/);
});

test('agent suggestion batches persist without a model call and follow existing review rules',t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'代理建议批次'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'第一段。\n\n第二段。\n\n第三段。'});
 const batch=core.writing.persistSuggestions(id,'master',{expectedRevision:saved.revision,runId:'ar_test',
  instruction:'agent：润色',reason:'提升表达',
  edits:[{from:0,to:4,original:'第一段。',replacement:'开头一段。'},{from:6,to:10,original:'第二段。',replacement:'中间一段。'}]});
 assert.equal(batch.length,2);
 const list=core.writing.suggestions(id,'master');
 assert.equal(list.length,2);assert.ok(list.every(s=>s.status==='pending'));
 assert.equal(core.writing.document(id,'master').markdown,saved.markdown);
 const next=core.writing.decide(id,'master',list.find(s=>s.from===0).id,{action:'accept',expectedRevision:saved.revision});
 assert.equal(next.markdown.startsWith('开头一段。'),true);
 assert.throws(()=>core.writing.persistSuggestions(id,'master',{expectedRevision:saved.revision,runId:'ar_test',instruction:'agent：过期写入',reason:'r',
  edits:[{from:0,to:1,original:'开',replacement:'x'}]}),e=>e.status===409);
});

test('agent run executes a scripted tool loop and completes with suggestions mode',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'代理运行测试'}),id=doc.projectId;
 core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'需要润色的正文。'});
 let phase=0;
 const fetchImpl=async(url,options)=>{
  const body=JSON.parse(options.body);
  if(phase===0){phase=1;return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'read_document',arguments:'{}'}}]}}]}),{headers:{'content-type':'application/json'}})}
  if(phase===1){phase=2;
   assert.equal(body.messages.at(-1).role,'tool');
   assert.throws(()=>core.writing.save(id,'master',{expectedRevision:99,markdown:'x'}),e=>e.status===409);
   return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'c2',type:'function',function:{name:'write_suggestions',arguments:JSON.stringify({reason:'润色开头',edits:[{from:0,to:3,original:'需要润',replacement:'已经润色'}]})}}]}}]}),{headers:{'content-type':'application/json'}})}
  assert.equal(body.messages.at(-1).role,'tool');
  return final()};
 const run=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'润色全文',expectedRevision:doc.revision+1,allowExternalAI:true,fetchImpl});
 assert.equal(run.status,'running');
 await core.agent.runSettled(run.id);
 const done=core.agent.run(id,run.id);
 assert.equal(done.status,'completed');
 assert.equal(core.writing.suggestions(id,'master').length,1);
 assert.equal(core.writing.document(id,'master').markdown,'需要润色的正文。');
 assert.ok(done.steps.some(s=>s.kind==='tool'&&s.payload.outcome?.result));
});

test('startRun enforces consent, single active run, revision match and unknown skill',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'启动门禁'}),id=doc.projectId;
 const base={skillId:'selection-rewriter',instruction:'x',expectedRevision:doc.revision};
 await assert.rejects(()=>core.agent.startRun(id,'master',{...base,allowExternalAI:false}),e=>e.status===403);
 await assert.rejects(()=>core.agent.startRun(id,'master',{...base,skillId:'nope',allowExternalAI:true}),e=>e.status===404);
 await assert.rejects(()=>core.agent.startRun(id,'master',{...base,expectedRevision:doc.revision+5,allowExternalAI:true}),e=>e.status===409);
});

test('unauthorized tool call fails the run and 409 from domain interrupts it',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'越权与漂移'}),id=doc.projectId;
 let rev=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'正文。'}).revision;
 core.agent.saveProfile({tools:['read_document']}); // 移除 write_suggestions
 let phase=0,mode='unauthorized';
 const fetchImpl=async()=>{ if(mode==='unauthorized'&&phase===0){phase=1;return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'write_suggestions',arguments:'{}'}}]}}]}),{headers:{'content-type':'application/json'}})}
  if(mode==='drift'&&phase===0){phase=1;return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'c2',type:'function',function:{name:'write_suggestions',arguments:JSON.stringify({reason:'r',edits:[{from:0,to:2,original:'正文',replacement:'改'}]})}}]}}]}),{headers:{'content-type':'application/json'}})}
  return final() };
 const run1=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'x',expectedRevision:rev,allowExternalAI:true,fetchImpl});
 await core.agent.runSettled(run1.id);
 assert.equal(core.agent.run(id,run1.id).status,'failed');
 assert.match(core.agent.run(id,run1.id).stopReason,/未获代理授权/);
 // 漂移：作者在运行中保存新版本 → 写工具 409 → interrupted
 core.agent.saveProfile({tools:['read_document','write_suggestions']});
 mode='drift';phase=0;
 const slow=()=>new Promise(r=>setTimeout(r,80));
 const run2=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'x',expectedRevision:rev,allowExternalAI:true,fetchImpl:async(u,o)=>{await slow();return fetchImpl(u,o)}});
 rev=core.writing.save(id,'master',{expectedRevision:rev,markdown:'作者改了正文。'}).revision;
 await core.agent.runSettled(run2.id);
 assert.equal(core.agent.run(id,run2.id).status,'interrupted');
});

test('cancelling wins over a late completion; status is never overwritten',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'取消不被覆盖'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'取消前的正文。'});
 let release;const gate=new Promise(r=>{release=r});
 const run=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'x',
  expectedRevision:saved.revision,allowExternalAI:true,
  fetchImpl:async()=>{await gate;return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'迟到完成'}}]}),{headers:{'content-type':'application/json'}})}});
 core.agent.cancelRun(id,run.id);
 release(new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'迟到完成'}}]}),{headers:{'content-type':'application/json'}}));
 await core.agent.runSettled(run.id);
 assert.equal(core.agent.run(id,run.id).status,'cancelled');
 assert.equal(core.writing.suggestions(id,'master').length,0);
 assert.equal(core.agent.controllers.has(run.id),false);
 assert.equal(core.agent.loopPromises.has(run.id),false);
});

test('cancelling a running run discards late model results',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'取消运行'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'取消前的正文。'});
 let release;const gate=new Promise(r=>{release=r});
 const run=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'x',
  expectedRevision:saved.revision,allowExternalAI:true,
  fetchImpl:async()=>{await gate;return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'write_suggestions',arguments:JSON.stringify({reason:'迟到',edits:[{from:0,to:2,original:'取消',replacement:'迟'}]})}}]}}]}),{headers:{'content-type':'application/json'}})}});
 const cancelled=core.agent.cancelRun(id,run.id);
 assert.equal(cancelled.status,'cancelled');
 release(new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'迟到'}}]}),{headers:{'content-type':'application/json'}}));
 await core.agent.runSettled(run.id);
 assert.equal(core.agent.run(id,run.id).status,'cancelled');
 assert.equal(core.writing.suggestions(id,'master').length,0);
 assert.equal(core.writing.document(id,'master').markdown,'取消前的正文。');
});

test('agent routes expose skills, profile editing, run lifecycle and NDJSON events',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'路由测试'}),id=doc.projectId;
 const req=(path,method='GET',input)=>dispatchApi(new Request('http://127.0.0.1:4312'+path,{method,headers:input?{'content-type':'application/json'}:{},body:input?JSON.stringify(input):undefined}),core);
 const skills=await (await req('/api/creator/agent-skills')).json();
 assert.equal(skills.skills.length,4);
 const profile=await (await req('/api/creator/agent')).json();
 assert.equal(profile.profile.writeMode,'suggestions');
 const narrowed=await (await req('/api/creator/agent','PUT',{tools:['read_document','read_context']})).json();
 assert.deepEqual(narrowed.profile.tools,['read_document','read_context']);
 const started=await req('/api/creator/projects/'+id+'/agent-runs','POST',{skillId:'selection-rewriter',instruction:'x',expectedRevision:doc.revision,allowExternalAI:true});
 assert.equal(started.status,201);
 const {run}=await started.json();
 const listed=await (await req('/api/creator/projects/'+id+'/agent-runs')).json();
 assert.equal(listed.runs.length,1);
 const events=await req('/api/creator/projects/'+id+'/agent-runs/'+run.id+'/events');
 assert.equal(events.headers.get('content-type'),'application/x-ndjson');
 assert.equal(events.headers.get('x-content-type-options'),'nosniff');
 await events.text(); // 流等待运行终态：合成域名解析失败 → 连续 3 次模型失败 → failed 收尾
 const done=(await (await req('/api/creator/projects/'+id+'/agent-runs/'+run.id)).json()).run;
 assert.equal(['completed','failed','interrupted'].includes(done.status),true);
 const cancelled=await req('/api/creator/projects/'+id+'/agent-runs/'+done.id+'/cancel','POST');
 assert.equal(cancelled.status,409); // 已终态不可再取消
});

test('run start binds the requested channel and startRun refuses unlisted channels',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'渠道绑定运行'}),id=doc.projectId;
 const master=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'主稿正文。'});
 const draft=core.writing.document(id,'wechat');
 const wechat=core.writing.save(id,'wechat',{expectedRevision:draft.revision,markdown:'公众号平台稿正文。',sourceMasterRevision:master.revision});
 const req=(path,method='GET',input)=>dispatchApi(new Request('http://127.0.0.1:4312'+path,{method,headers:input?{'content-type':'application/json'}:{},body:input?JSON.stringify(input):undefined}),core);
 const started=await req('/api/creator/projects/'+id+'/agent-runs','POST',{skillId:'selection-rewriter',instruction:'x',expectedRevision:wechat.revision,allowExternalAI:true,channel:'wechat'});
 assert.equal(started.status,201);
 const {run}=await started.json();
 assert.equal(run.channel,'wechat');
 assert.equal(core.agent.run(id,run.id).baseRevision,wechat.revision);
 await core.agent.runSettled(run.id); // 合成域名解析失败 → 连续 3 次模型失败收尾，不留运行中的循环
 assert.notEqual(core.agent.run(id,run.id).status,'running');
 const denied=await req('/api/creator/projects/'+id+'/agent-runs','POST',{skillId:'selection-rewriter',instruction:'x',expectedRevision:wechat.revision,allowExternalAI:true,channel:'douyin'});
 assert.equal(denied.status,403);
});

test('initial payload exposes writeMode and tool announcements match the write mode',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'写模式透传'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'写模式正文。'});
 const done=name=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:name}}]}),{headers:{'content-type':'application/json'}});
 let observed=null;
 const run=await core.agent.startRun(id,'master',{skillId:'draft-writer',instruction:'写稿',expectedRevision:saved.revision,allowExternalAI:true,
  fetchImpl:async(url,options)=>{observed=JSON.parse(options.body);return done('建议制完成')}});
 await core.agent.runSettled(run.id);
 assert.equal(core.agent.run(id,run.id).status,'completed');
 assert.equal(JSON.parse(observed.messages[1].content).writeMode,'suggestions');
 assert.equal(observed.tools.some(x=>x.function.name==='write_revision'),false);
 assert.equal(observed.tools.some(x=>x.function.name==='read_document'),true);
 core.agent.saveProfile({writeMode:'revisions'});
 try{
  const run2=await core.agent.startRun(id,'master',{skillId:'draft-writer',instruction:'写稿',expectedRevision:saved.revision,allowExternalAI:true,
   fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);
    assert.equal(JSON.parse(body.messages[1].content).writeMode,'revisions');
    assert.equal(body.tools.some(x=>x.function.name==='write_revision'),true);
    return done('直写完成')}});
  await core.agent.runSettled(run2.id);
  assert.equal(core.agent.run(id,run2.id).status,'completed');
 }finally{core.agent.saveProfile({writeMode:'suggestions'})}
});

test('a model that never stops calling tools hits the step cap and fails with 步数上限',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'步数上限'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'循环正文。'});
 let calls=0;
 const run=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'x',
  expectedRevision:saved.revision,allowExternalAI:true,
  fetchImpl:async()=>{calls++;
   return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,
    tool_calls:[{id:'c'+calls,type:'function',function:{name:'read_document',arguments:'{}'}}]}}]}),{headers:{'content-type':'application/json'}})}});
 await core.agent.runSettled(run.id);
 const finished=core.agent.run(id,run.id);
 assert.equal(finished.status,'failed');
 assert.match(finished.stopReason,/步数上限/);
 assert.equal(calls,AGENT_MAX_STEPS);
});

test('startRun refuses a project that has not been saved as markdown with 409',async t=>{
 provider(t);const env=setup(t),core=env.core;
 // 直接用 editorial.create 建立未写过 Markdown 的遗留排版状态（writing.create 会自动保存空 Markdown）
 const doc=core.editorial.create({title:'遗留模式拒绝'}),id=doc.id;
 const legacy=core.writing.document(id,'master');
 assert.notEqual(legacy.mode,'markdown');
 await assert.rejects(()=>core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'x',
  expectedRevision:legacy.revision,allowExternalAI:true}),e=>e.status===409);
});

test('a second startRun on the same project and channel is refused while one runs',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'唯一运行'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'唯一运行正文。'});
 let release;const gate=new Promise(r=>{release=r});
 const run=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'x',
  expectedRevision:saved.revision,allowExternalAI:true,fetchImpl:async()=>{await gate;return final()}});
 await assert.rejects(()=>core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'x',
  expectedRevision:saved.revision,allowExternalAI:true}),e=>e.status===409);
 core.agent.cancelRun(id,run.id);
 release(final());
 await core.agent.runSettled(run.id);
 assert.equal(core.agent.run(id,run.id).status,'cancelled');
 assert.equal(core.agent.controllers.has(run.id),false);
 assert.equal(core.agent.loopPromises.has(run.id),false);
});

test('recorded step payloads stay bounded even when tool arguments and results are huge',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'轨迹瘦身'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'巨大参数正文。'});
 const huge='巨'.repeat(50000);
 let phase=0;
 const fetchImpl=async()=>{
  if(phase===0){phase=1;
   return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,
    tool_calls:[{id:'h1',type:'function',function:{name:'write_suggestions',
     arguments:JSON.stringify({reason:'润色巨大',edits:[{from:0,to:6,original:'巨大参数正文',replacement:huge}]})}}]}}]}),{headers:{'content-type':'application/json'}})}
  return final()};
 const run=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'瘦身',
  expectedRevision:saved.revision,allowExternalAI:true,fetchImpl});
 await core.agent.runSettled(run.id);
 const done=core.agent.run(id,run.id);
 assert.equal(done.status,'completed');
 for(const step of done.steps)
  assert.ok(JSON.stringify(step.payload).length<6000,'步骤记录应保持有界：'+step.kind);
 // 截断只作用于落盘记录副本，领域数据保持完整，供作者审阅。
 const kept=core.writing.suggestions(id,'master')[0];
 assert.equal(kept.replacement.length,50000);
 assert.equal(core.writing.document(id,'master').markdown,'巨大参数正文。');
});

test('write_revision 改稿理由作为 note 进入不可变修订并受 500 字限制',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'修订备注'}),id=doc.projectId;
 const first=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'初稿正文。',note:'代理初稿'});
 assert.equal(first.note,'代理初稿');
 assert.equal(core.writing.document(id,'master').note,'代理初稿');
 assert.equal(core.writing.history(id,'master')[0].note,'代理初稿');
 const second=core.writing.save(id,'master',{expectedRevision:first.revision,markdown:'二稿正文。'});
 assert.equal(second.note,'');
 const history=core.writing.history(id,'master');
 assert.equal(history[0].note,'');
 assert.equal(history.find(r=>r.revision===first.revision).note,'代理初稿');
 assert.throws(()=>core.writing.save(id,'master',{expectedRevision:second.revision,markdown:'三稿正文。',note:'长'.repeat(501)}),e=>e.status===400);
 assert.throws(()=>core.writing.save(id,'master',{expectedRevision:second.revision,markdown:'三稿正文。',note:123}),e=>e.status===400);
 // 增量迁移不破坏重开：ALTER 重复执行被吞掉，历史 note 仍可读。
 const reopened=env.reopen();
 assert.equal(reopened.writing.history(id,'master')[0].note,'');
 // 工具接线：write_revision 的 reason 作为 note 落入新修订。
 reopened.agent.saveProfile({writeMode:'revisions'});
 const base=reopened.writing.document(id,'master');
 let phase=0;
 const fetchImpl=async()=>{
  if(phase===0){phase=1;
   return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,
    tool_calls:[{id:'n1',type:'function',function:{name:'write_revision',
     arguments:JSON.stringify({markdown:'代理直写的新正文。',reason:'代理直写理由'})}}]}}]}),{headers:{'content-type':'application/json'}})}
  return final()};
 const run=await reopened.agent.startRun(id,'master',{skillId:'draft-writer',instruction:'直写',
  expectedRevision:base.revision,allowExternalAI:true,fetchImpl});
 await reopened.agent.runSettled(run.id);
 assert.equal(reopened.agent.run(id,run.id).status,'completed');
 const finalDoc=reopened.writing.document(id,'master');
 assert.equal(finalDoc.markdown,'代理直写的新正文。');
 assert.equal(finalDoc.note,'代理直写理由');
 assert.equal(reopened.writing.history(id,'master')[0].note,'代理直写理由');
});

test('a run started through the dispatchApi route bills text usage in the production path',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'计费回路'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'计费正文。'});
 const realFetch=globalThis.fetch;
 t.after(()=>{globalThis.fetch=realFetch});
 let phase=0;
 globalThis.fetch=async(url,options)=>{
  const body=JSON.parse(options.body);
  if(phase===0){phase=1;
   return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,
    tool_calls:[{id:'b1',type:'function',function:{name:'write_suggestions',
     arguments:JSON.stringify({reason:'计费改写',edits:[{from:0,to:4,original:'计费正文',replacement:'已计费正文'}]})}}]}}]}),{headers:{'content-type':'application/json'}})}
  assert.equal(body.messages.at(-1).role,'tool');
  return final()};
 const req=(path,method='GET',input)=>dispatchApi(new Request('http://127.0.0.1:4312'+path,{method,headers:input?{'content-type':'application/json'}:{},body:input?JSON.stringify(input):undefined}),core);
 const started=await req('/api/creator/projects/'+id+'/agent-runs','POST',{skillId:'selection-rewriter',instruction:'计费',expectedRevision:saved.revision,allowExternalAI:true});
 assert.equal(started.status,201);
 const {run}=await started.json();
 await core.agent.runSettled(run.id);
 assert.equal(core.agent.run(id,run.id).status,'completed');
 const usage=core.services.usage();
 assert.ok(usage.today.some(r=>r.kind==='text'&&r.requests>=2),'两次模型调用应计入当日 text 用量');
 assert.equal(core.writing.suggestions(id,'master').length,1);
});

test('runSince 增量返回游标之后的步骤并保留终态运行字段',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'游标增量'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'游标增量正文。'});
 let phase=0;
 const fetchImpl=async()=>{
  if(phase===0){phase=1;return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'read_document',arguments:'{}'}}]}}]}),{headers:{'content-type':'application/json'}})}
  if(phase===1){phase=2;return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'c2',type:'function',function:{name:'write_suggestions',arguments:JSON.stringify({reason:'游标润色',edits:[{from:0,to:6,original:'游标增量正文',replacement:'游标润色后的正文'}]})}}]}}]}),{headers:{'content-type':'application/json'}})}
  return final()};
 const run=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'游标',expectedRevision:saved.revision,allowExternalAI:true,fetchImpl});
 await core.agent.runSettled(run.id);
 const done=core.agent.run(id,run.id),total=done.steps.length;
 assert.equal(done.status,'completed');
 const full=core.agent.runSince(id,run.id,0);
 assert.equal(full.steps.length,total);
 assert.deepEqual(full.steps.map(s=>s.seq),Array.from({length:total},(_,i)=>i+1));
 assert.equal(full.status,'completed');
 assert.ok(full.stopReason);
 // 默认游标 0 与显式 0 一致
 assert.equal(core.agent.runSince(id,run.id).steps.length,total);
 // 追赶后游标处不再有步骤，但终态字段仍返回
 const tail=core.agent.runSince(id,run.id,total);
 assert.equal(tail.steps.length,0);
 assert.equal(tail.status,'completed');
 assert.ok(tail.stopReason);
 // 中间游标切分：afterSeq=1 返回 total-1 条，且从 seq=2 连续开始
 const mid=core.agent.runSince(id,run.id,1);
 assert.equal(mid.steps.length,total-1);
 assert.equal(mid.steps[0].seq,2);
 // 游标分区无缝还原全量：已消费（seq<=cursor）+ runSince(cursor) = 全部步骤
 const cursor=2;
 const stitched=[...core.agent.runSince(id,run.id,0).steps.filter(s=>s.seq<=cursor),...core.agent.runSince(id,run.id,cursor).steps];
 assert.deepEqual(stitched.map(s=>s.seq),Array.from({length:total},(_,i)=>i+1));
 assert.throws(()=>core.agent.runSince(id,'ar_missing'),e=>e.status===404);
});

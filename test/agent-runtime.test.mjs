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
 assert.equal(skills.skills.length,8);
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

test('a tool-looping model burns the 20-request run budget and fails fast with 额度',async t=>{
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
 // SC-02 诚实边界：run 级预算（缺省 cap=20）先于 24 步上限耗尽——永不收尾的
 // 模型在第 21 次请求被 usingTask 任务上限 429 快速失败，redrive 接续新预算。
 assert.equal(finished.status,'failed');
 assert.match(finished.stopReason,/额度/);
 assert.equal(calls,20);
 assert.ok(calls<AGENT_MAX_STEPS,'预算上限 20 先于步数上限 24 生效');
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

// SC-01：单飞改写入队语义——同渠道命中 running 改为入队（201 queued），队列槽
// 每 project+channel 至多 1（第三条仍 409）；queued 行无 controller/loopPromises。
test('SC-01 排队：同渠道第二条运行入队（201/queuePosition=2/无 controller），第三条仍 409',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'唯一运行'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'唯一运行正文。'});
 let release;const gate=new Promise(r=>{release=r});
 const run=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'x',
  expectedRevision:saved.revision,allowExternalAI:true,fetchImpl:async()=>{await gate;return final()}});
 assert.equal(run.status,'running');
 const req=(path,method='GET',input)=>dispatchApi(new Request('http://127.0.0.1:4312'+path,{method,headers:input?{'content-type':'application/json'}:{},body:input?JSON.stringify(input):undefined}),core);
 const second=await req('/api/creator/projects/'+id+'/agent-runs','POST',{skillId:'selection-rewriter',instruction:'x',expectedRevision:saved.revision,allowExternalAI:true});
 assert.equal(second.status,201);
 const {run:queued}=await second.json();
 assert.equal(queued.status,'queued');
 assert.equal(queued.queuePosition,2,'A（running）占第 1 位，B 排第 2 位');
 assert.equal(core.agent.controllers.has(queued.id),false);
 assert.equal(core.agent.loopPromises.has(queued.id),false);
 await assert.rejects(()=>core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'x',
  expectedRevision:saved.revision,allowExternalAI:true}),e=>e.status===409);
 // 收尾：queued 取消（纯 UPDATE CAS）+ running 取消（abort）；A 的 finally 链
 // drain 无 queued 可认领，不产生任何额外运行。
 const cancelledQueued=core.agent.cancelRun(id,queued.id);
 assert.equal(cancelledQueued.status,'cancelled');
 core.agent.cancelRun(id,run.id);
 release(final());
 await core.agent.runSettled(run.id);
 assert.equal(core.agent.run(id,run.id).status,'cancelled');
 assert.equal(core.agent.controllers.has(run.id),false);
 assert.equal(core.agent.loopPromises.has(run.id),false);
});

// SC-01：全局并发上限（缺省 2；此处 CONTENT_STUDIO_AGENT_MAX_CONCURRENT='1'）——
// 跨渠道无同渠道活跃行但全局 running 已满 → 入队；前序完成后 loop.finally 链补位。
test('SC-01 全局并发上限：跨渠道排队，前序完成后 finally 链补位跑完',async t=>{
 provider(t);const env=setup(t),core=env.core;
 process.env.CONTENT_STUDIO_AGENT_MAX_CONCURRENT='1';
 t.after(()=>{delete process.env.CONTENT_STUDIO_AGENT_MAX_CONCURRENT});
 const doc=core.writing.create({title:'全局并发'}),id=doc.projectId;
 const master=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'主稿正文。'});
 const draft=core.writing.document(id,'wechat');
 const wechat=core.writing.save(id,'wechat',{expectedRevision:draft.revision,markdown:'公众号平台稿正文。',sourceMasterRevision:master.revision});
 let release;const gate=new Promise(r=>{release=r});
 const runA=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'A',
  expectedRevision:master.revision,allowExternalAI:true,fetchImpl:async()=>{await gate;return final()}});
 const req=(path,method='GET',input)=>dispatchApi(new Request('http://127.0.0.1:4312'+path,{method,headers:input?{'content-type':'application/json'}:{},body:input?JSON.stringify(input):undefined}),core);
 const post=await req('/api/creator/projects/'+id+'/agent-runs','POST',{skillId:'selection-rewriter',instruction:'B',expectedRevision:wechat.revision,allowExternalAI:true,channel:'wechat'});
 assert.equal(post.status,201);
 const {run:runB}=await post.json();
 assert.equal(runB.status,'queued');
 // 生产路径 fetch 打桩：B 被认领后走 globalThis.fetch（排队行不携带测试 fetchImpl）
 const realFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=realFetch});
 let bCalls=0;
 globalThis.fetch=async()=>{bCalls++;return final()};
 release(final());
 await core.agent.runSettled(runA.id);
 assert.equal(core.agent.run(id,runA.id).status,'completed');
 // A 的 finally 链 drain 认领 B 并跑完（runSettled 时 B 已在 loopPromises）
 await core.agent.runSettled(runB.id);
 assert.equal(core.agent.run(id,runB.id).status,'completed');
 assert.ok(bCalls>=1,'补位运行应经生产路径发出模型调用');
});

// SC-01：queued 取消即时生效，前序完成后 drain 不得复活取消行（守卫 SELECT 只取 queued）。
test('SC-01 取消 queued：即时 cancelled、零模型调用、前序完成后保持 cancelled',async t=>{
 provider(t);const env=setup(t),core=env.core;
 process.env.CONTENT_STUDIO_AGENT_MAX_CONCURRENT='1';
 t.after(()=>{delete process.env.CONTENT_STUDIO_AGENT_MAX_CONCURRENT});
 const doc=core.writing.create({title:'取消排队'}),id=doc.projectId;
 const master=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'取消排队正文。'});
 const draft=core.writing.document(id,'wechat');
 const wechat=core.writing.save(id,'wechat',{expectedRevision:draft.revision,markdown:'取消排队公众号正文。',sourceMasterRevision:master.revision});
 let release;const gate=new Promise(r=>{release=r});
 const runA=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'A',
  expectedRevision:master.revision,allowExternalAI:true,fetchImpl:async()=>{await gate;return final()}});
 const req=(path,method='GET',input)=>dispatchApi(new Request('http://127.0.0.1:4312'+path,{method,headers:input?{'content-type':'application/json'}:{},body:input?JSON.stringify(input):undefined}),core);
 const post=await req('/api/creator/projects/'+id+'/agent-runs','POST',{skillId:'selection-rewriter',instruction:'B',expectedRevision:wechat.revision,allowExternalAI:true,channel:'wechat'});
 const {run:runB}=await post.json();
 assert.equal(runB.status,'queued');
 const realFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=realFetch});
 let bCalls=0;
 globalThis.fetch=async()=>{bCalls++;return final()};
 const cancelled=core.agent.cancelRun(id,runB.id);
 assert.equal(cancelled.status,'cancelled');
 release(final());
 await core.agent.runSettled(runA.id);
 assert.equal(core.agent.run(id,runA.id).status,'completed');
 await new Promise(r=>setTimeout(r,50)); // A 的 finally 链 drain 已执行
 assert.equal(core.agent.run(id,runB.id).status,'cancelled','drain 不得认领已取消的行');
 assert.equal(bCalls,0,'取消的排队行零模型调用');
});

// SC-01：启动清扫扩到 queued——跨重启排队不存活（consent 未落库，不自动重跑），
// 专属 stop_reason；随后 resumeOf 重驱动一步接手（链通既有形态）。
test('SC-01 重启矩阵：queued 行清扫为 interrupted（专属文案）且可 resumeOf 重驱动 completed',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'重启矩阵'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'需要重试的原始句子。'});
 const binding=core.services.captureBinding('text');
 core.db.prepare("INSERT INTO agent_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
  'ar_staleq',id,'master',saved.revision,'selection-rewriter',1,'ag_default','queued','','排队中断',
  JSON.stringify(binding),'dead-owner','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
 const fresh=env.reopen();
 const swept=fresh.agent.run(id,'ar_staleq');
 assert.equal(swept.status,'interrupted');
 assert.match(swept.stopReason,/进程重启/);
 assert.match(swept.stopReason,/排队任务未保留/);
 const suggest=toolResponse('write_suggestions');
 let observed=null;
 const run2=await fresh.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'排队中断',
  expectedRevision:saved.revision,allowExternalAI:true,resumeOf:'ar_staleq',
  fetchImpl:async(url,options)=>{observed=JSON.parse(options.body);
   if(observed.messages.at(-1).role==='tool')return final();
   return suggest({reason:'续跑建议',edits:[{from:0,to:4,original:'需要重试',replacement:'重驱动后的表达'}]})}});
 assert.equal(run2.status,'running');
 await fresh.agent.runSettled(run2.id);
 const done=fresh.agent.run(id,run2.id);
 assert.equal(done.status,'completed');
 assert.equal(done.steps[0].kind,'resume');
 assert.equal(done.steps[0].payload.resumeOf,'ar_staleq');
 assert.equal(fresh.writing.suggestions(id,'master').length,1);
});

// SC-01：drain 认领后复核不静默换基准——排队期间正文变化 → interrupted /正文已变化/。
// FIX-05①（EASEL-PORT-PLAN §13 定稿）：文案附「入队基准 v{X}，当前 v{Y}」诊断。
test('SC-01 drain 复核：排队期间正文变化 → interrupted /正文已变化/ 且零模型调用',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'排队复核'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'排队复核正文。'});
 let release;const gate=new Promise(r=>{release=r});
 const runA=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'A',
  expectedRevision:saved.revision,allowExternalAI:true,fetchImpl:async()=>{await gate;return final()}});
 const req=(path,method='GET',input)=>dispatchApi(new Request('http://127.0.0.1:4312'+path,{method,headers:input?{'content-type':'application/json'}:{},body:input?JSON.stringify(input):undefined}),core);
 const post=await req('/api/creator/projects/'+id+'/agent-runs','POST',{skillId:'selection-rewriter',instruction:'B',expectedRevision:saved.revision,allowExternalAI:true});
 assert.equal(post.status,201);
 const {run:runB}=await post.json();
 assert.equal(runB.status,'queued');
 const realFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=realFetch});
 let bCalls=0;
 globalThis.fetch=async()=>{bCalls++;return final()};
 const authorSaved=core.writing.save(id,'master',{expectedRevision:saved.revision,markdown:'作者在排队期间改了正文。'});
 release(final());
 await core.agent.runSettled(runA.id);
 assert.equal(core.agent.run(id,runA.id).status,'completed');
 const row=core.agent.run(id,runB.id);
 assert.equal(row.status,'interrupted');
 assert.match(row.stopReason,/正文已变化/);
 assert.match(row.stopReason,new RegExp('入队基准 v'+saved.revision+'，当前 v'+authorSaved.revision),'入队基准与当前修订的诊断必须可见');
 assert.match(row.stopReason,/未按旧基准开跑/);
 assert.equal(bCalls,0,'复核失败的排队行零模型调用（不用旧基准发付费调用）');
});

// SC-01：CAS 半边——行已被他人认领（running、本进程无 controller）时
// drainQueued 不得重复起 loop、不得发出任何模型调用。
test('SC-01 CAS：预认领（已 running）的行 drainQueued 不重复起 loop',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'CAS 防重'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'CAS 正文。'});
 const binding=core.services.captureBinding('text');
 core.db.prepare("INSERT INTO agent_runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
  'ar_cas',id,'master',saved.revision,'selection-rewriter',1,'ag_default','queued','','x',
  JSON.stringify(binding),'dead-owner','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
 core.db.prepare("UPDATE agent_runs SET status='running' WHERE id='ar_cas'").run();
 const realFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=realFetch});
 let calls=0;
 globalThis.fetch=async()=>{calls++;return final()};
 await core.agent.drainQueued();
 assert.equal(core.agent.loopPromises.has('ar_cas'),false,'已被认领的行不得再次起 loop');
 assert.equal(core.agent.run(id,'ar_cas').status,'running');
 assert.equal(calls,0);
 core.db.prepare("UPDATE agent_runs SET status='cancelled',stop_reason='测试清理' WHERE id='ar_cas'").run();
});

// SC-01：events 流 queued 阶段帧——run_status 无 seq（非游标帧），认领后 running 帧，收流 run_done。
test('SC-01 events：queued 流出 run_status 帧（无 seq）→认领→run_done 收流',async t=>{
 provider(t);const env=setup(t),core=env.core;
 process.env.CONTENT_STUDIO_AGENT_MAX_CONCURRENT='1';
 t.after(()=>{delete process.env.CONTENT_STUDIO_AGENT_MAX_CONCURRENT});
 const doc=core.writing.create({title:'排队事件'}),id=doc.projectId;
 const master=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'排队事件正文。'});
 const draft=core.writing.document(id,'wechat');
 const wechat=core.writing.save(id,'wechat',{expectedRevision:draft.revision,markdown:'排队事件公众号正文。',sourceMasterRevision:master.revision});
 let release;const gate=new Promise(r=>{release=r});
 const runA=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'A',
  expectedRevision:master.revision,allowExternalAI:true,fetchImpl:async()=>{await gate;return final()}});
 const req=(path,method='GET',input)=>dispatchApi(new Request('http://127.0.0.1:4312'+path,{method,headers:input?{'content-type':'application/json'}:{},body:input?JSON.stringify(input):undefined}),core);
 const post=await req('/api/creator/projects/'+id+'/agent-runs','POST',{skillId:'selection-rewriter',instruction:'B',expectedRevision:wechat.revision,allowExternalAI:true,channel:'wechat'});
 const {run:runB}=await post.json();
 assert.equal(runB.status,'queued');
 const realFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=realFetch});
 // B 的首个模型调用被 gateB 挂住：认领后 B 停在 running 相位，事件流（800ms
 // 轮询）必然观察到 queued→running 过渡，不被「认领即完成」竞态吞帧。
 let releaseB;const gateB=new Promise(r=>{releaseB=r});
 globalThis.fetch=async()=>{await gateB;return final()};
 const events=await openEvents(core,id,runB.id);
 const reader=events.body.getReader(),dec=new TextDecoder();
 let buf='';const frames=[];
 const pump=(async()=>{try{for(;;){const {done,value}=await reader.read();if(done)return;
  buf+=dec.decode(value,{stream:true});const lines=buf.split('\n');buf=lines.pop();
  for(const line of lines)if(line.trim())frames.push(JSON.parse(line))}}catch{}})();
 release(final());
 await core.agent.runSettled(runA.id);
 assert.equal(core.agent.run(id,runA.id).status,'completed');
 // 等 B 被认领进入 running，再给流最多 5s 送达 running 帧
 for(let i=0;i<250&&core.agent.run(id,runB.id).status==='queued';i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(core.agent.run(id,runB.id).status,'running');
 for(let i=0;i<250&&!frames.some(f=>f.kind==='run_status'&&f.status==='running');i++)await new Promise(r=>setTimeout(r,20));
 releaseB(final());
 await core.agent.runSettled(runB.id);
 await Promise.race([pump,new Promise(r=>setTimeout(r,8000))]);
 const statuses=frames.filter(f=>f.kind==='run_status');
 assert.ok(statuses.length>=2,'应至少有 queued 与 running 两帧：'+JSON.stringify(frames));
 assert.equal(statuses[0].status,'queued');
 assert.equal('seq' in statuses[0],false,'run_status 是非游标帧，不携带 seq');
 assert.equal(statuses[0].queuePosition,2);
 assert.equal(statuses.some(f=>f.status==='running'),true);
 const done=frames.at(-1);
 assert.equal(done.kind,'run_done');
 assert.equal(done.status,'completed');
 assert.equal('seq' in done,false);
});

// SC-01 认领同渠道守卫（r6.1 评审 high 项判别性回归，唯一防复发单测）：
// A running（holdModel）时同渠道 B queued，全局 running=1<2 恰是旧缺陷触发条件——
// 无守卫时 drain 即认领 B → 同渠道双 loop。守卫必须跳过忙渠道 B、认领空闲渠道。
test('SC-01 认领同渠道守卫：drain 跳过忙渠道 queued，空闲渠道补位，前序终态后才认领',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'认领守卫'}),id=doc.projectId;
 const master=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'守卫主稿正文。'});
 const draftW=core.writing.document(id,'wechat');
 const wechat=core.writing.save(id,'wechat',{expectedRevision:draftW.revision,markdown:'守卫公众号正文。',sourceMasterRevision:master.revision});
 const draftZ=core.writing.document(id,'zhihu');
 const zhihu=core.writing.save(id,'zhihu',{expectedRevision:draftZ.revision,markdown:'守卫知乎正文。',sourceMasterRevision:master.revision});
 let releaseA,releaseE;const gateA=new Promise(r=>{releaseA=r}),gateE=new Promise(r=>{releaseE=r});
 const runA=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'A',
  expectedRevision:master.revision,allowExternalAI:true,fetchImpl:async()=>{await gateA;return final()}});
 const runE=await core.agent.startRun(id,'zhihu',{skillId:'selection-rewriter',instruction:'E',
  expectedRevision:zhihu.revision,allowExternalAI:true,fetchImpl:async()=>{await gateE;return final()}});
 const req=(path,method='GET',input)=>dispatchApi(new Request('http://127.0.0.1:4312'+path,{method,headers:input?{'content-type':'application/json'}:{},body:input?JSON.stringify(input):undefined}),core);
 const postB=await req('/api/creator/projects/'+id+'/agent-runs','POST',{skillId:'selection-rewriter',instruction:'B',expectedRevision:master.revision,allowExternalAI:true});
 const runB=(await postB.json()).run;
 const postC=await req('/api/creator/projects/'+id+'/agent-runs','POST',{skillId:'selection-rewriter',instruction:'C',expectedRevision:wechat.revision,allowExternalAI:true,channel:'wechat'});
 const runC=(await postC.json()).run;
 assert.equal(runB.status,'queued'); // 同渠道命中 running → 入队
 assert.equal(runC.status,'queued'); // 全局 running=2 已满 → 入队
 const realFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=realFetch});
 let prodCalls=0;
 globalThis.fetch=async()=>{prodCalls++;return final()};
 await core.agent.drainQueued(); // running 已满 → 不认领
 assert.equal(core.agent.run(id,runB.id).status,'queued');
 assert.equal(core.agent.run(id,runC.id).status,'queued');
 assert.equal(prodCalls,0);
 releaseE(final());
 await core.agent.runSettled(runE.id);
 assert.equal(core.agent.run(id,runE.id).status,'completed');
 // E 的 finally 链 drain：守卫跳过忙渠道（master 上 A 仍 running）的 B，认领空闲渠道 C
 await core.agent.runSettled(runC.id);
 assert.equal(core.agent.run(id,runC.id).status,'completed');
 assert.equal(core.agent.run(id,runB.id).status,'queued','忙渠道 queued 不得被认领');
 assert.equal(core.agent.loopPromises.has(runB.id),false);
 assert.equal(prodCalls,1,'B 全程零模型调用，仅 C 发出');
 // 直接调 drainQueued()：全局 running=1<2（默认 cap=2）——旧缺陷正在此认领 B → 同渠道双 loop
 await core.agent.drainQueued();
 assert.equal(core.agent.run(id,runB.id).status,'queued');
 assert.equal(core.agent.loopPromises.has(runB.id),false);
 assert.equal(prodCalls,1);
 // 放行 A → finally 链补位认领 B → completed（守卫保证发生在前序终态之后）
 releaseA(final());
 await core.agent.runSettled(runA.id);
 assert.equal(core.agent.run(id,runA.id).status,'completed');
 await core.agent.runSettled(runB.id);
 assert.equal(core.agent.run(id,runB.id).status,'completed');
 assert.equal(prodCalls,2);
});

// FIX-01：认领后复核段抛出不得留幽灵 running 行——认领 COMMIT 后 profile()
// 404（行被删）时，drainQueued 本身不抛、该行收敛为 interrupted 终态、渠道
// 单飞/排队槽被释放、零模型调用（修复前异常被 void…catch(()=>{}) 吞掉，
// B 永久停在无 controller 的 running）。
test('FIX-01 认领后复核异常：profile 抛错 → interrupted 收敛、渠道槽释放、drainQueued 不抛',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'复核异常收敛'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'复核异常正文。'});
 let release;const gate=new Promise(r=>{release=r});
 const runA=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'A',
  expectedRevision:saved.revision,allowExternalAI:true,fetchImpl:async()=>{await gate;return final()}});
 assert.equal(runA.status,'running');
 // 同渠道第二条：入队（201 queued，无 controller/loopPromises）
 const runB=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'B',
  expectedRevision:saved.revision,allowExternalAI:true});
 assert.equal(runB.status,'queued');
 assert.equal(core.agent.controllers.has(runB.id),false);
 // 复核异常源：删除 profile 行 → 认领复核 this.profile() 抛 ValidationError 404
 core.db.prepare("DELETE FROM agent_profiles WHERE id='ag_default'").run();
 const realFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=realFetch});
 let bCalls=0;
 globalThis.fetch=async()=>{bCalls++;return final()};
 release(final());
 await core.agent.runSettled(runA.id);
 assert.equal(core.agent.run(id,runA.id).status,'completed');
 await new Promise(r=>setTimeout(r,50)); // A 的 finally 链 drain 已执行
 const row=core.agent.run(id,runB.id);
 assert.equal(row.status,'interrupted','复核抛出必须收敛为非 running 终态，不留幽灵行');
 assert.match(row.stopReason,/复核异常/);
 assert.equal(bCalls,0,'复核异常的排队行零模型调用');
 assert.equal(core.agent.loopPromises.has(runB.id),false);
 assert.equal(core.agent.controllers.has(runB.id),false);
 // 渠道槽被释放：master 上不再有任何 running/queued 活跃行占用单飞/排队槽
 assert.equal(core.db.prepare(
  "SELECT COUNT(*) AS n FROM agent_runs WHERE project_id=? AND channel='master' AND status IN ('running','queued')").get(id).n,0);
 // drainQueued 不抛（修复前 _startClaimed 的异常沿 drainQueued reject 被吞）
 await assert.doesNotReject(()=>core.agent.drainQueued());
 assert.equal(core.agent.run(id,runB.id).status,'interrupted','再次 drain 不得改变已收敛的终态');
});

// FIX-04：writeMode 入队定格——入队后翻转 profile 的写模式（面板 select 已
// disabled，第二会话/直接 PUT 形态），drain 认领后运行的仍是入队快照值：
// 模型消息 writeMode 字段与宣告工具面都以快照为准，不现读 profile。
test('FIX-04 排队期间 writeMode 翻转：认领运行使用入队快照的 writeMode',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'写模式快照'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'写模式快照正文。'});
 let release;const gate=new Promise(r=>{release=r});
 try{
  const runA=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'A',
   expectedRevision:saved.revision,allowExternalAI:true,fetchImpl:async()=>{await gate;return final()}});
  // 同渠道入队，快照为建议制（ag_default 种子）
  const runB=await core.agent.startRun(id,'master',{skillId:'draft-writer',instruction:'B',
   expectedRevision:saved.revision,allowExternalAI:true});
  assert.equal(runB.status,'queued');
  // 排队期间翻转写模式（建议制 → 直写）
  core.agent.saveProfile({writeMode:'revisions'});
  // 生产路径打桩：B 认领后经 globalThis.fetch 发模型调用，捕获消息与工具面
  const realFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=realFetch});
  let observed=null;
  globalThis.fetch=async(url,options)=>{observed=JSON.parse(options.body);return final()};
  release(final());
  await core.agent.runSettled(runA.id);
  assert.equal(core.agent.run(id,runA.id).status,'completed');
  await core.agent.runSettled(runB.id);
  assert.equal(core.agent.run(id,runB.id).status,'completed');
  assert.ok(observed,'补位运行应经生产路径发出模型调用');
  assert.equal(JSON.parse(observed.messages[1].content).writeMode,'suggestions','运行 writeMode 是入队快照值，不是认领时的现读 profile');
  assert.equal(observed.tools.some(x=>x.function.name==='write_revision'),false,'工具面按快照建议制过滤，不宣告 write_revision');
 }finally{core.agent.saveProfile({writeMode:'suggestions'})}
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

// ---- SA-01：事件流心跳与 ?since= 续读游标 ----

function openEvents(core,projectId,runId,query=''){
 return dispatchApi(new Request('http://127.0.0.1:4312'+`/api/creator/projects/${projectId}/agent-runs/${runId}/events${query}`),core);
}
const parseFrames=text=>text.split('\n').filter(l=>l.trim()).map(l=>JSON.parse(l));

test('events ?since= 只投递增量步骤，run_done 不携带 seq（游标不推进）',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'游标事件'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'游标事件正文。'});
 let phase=0;
 const call=name=>args=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'e'+ ++phase,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]}),{headers:{'content-type':'application/json'}});
 const fetchImpl=async()=>{
  if(phase===0)return call('read_document')({});
  if(phase===1)return call('write_suggestions')({reason:'游标事件建议',edits:[{from:0,to:6,original:'游标事件正文',replacement:'游标事件改写'}]});
  return final()};
 const run=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'游标',expectedRevision:saved.revision,allowExternalAI:true,fetchImpl});
 await core.agent.runSettled(run.id);
 const total=core.agent.run(id,run.id).steps.length;
 assert.ok(total>=3);
 // 全量：步骤帧 + 收尾 run_done（无 seq 字段——客户端不得用 undefined 推进游标）
 const all=parseFrames(await (await openEvents(core,id,run.id)).text());
 assert.equal(all.filter(f=>f.kind!=='run_done').length,total);
 assert.deepEqual(all.filter(f=>f.kind!=='run_done').map(s=>s.seq),Array.from({length:total},(_,i)=>i+1));
 const done=all.at(-1);
 assert.equal(done.kind,'run_done');
 assert.equal(done.status,'completed');
 assert.equal('seq' in done,false);
 // 对照 runSince 游标分区：since=total 只收 run_done，不重放任何步骤
 const tail=parseFrames(await (await openEvents(core,id,run.id,'?since='+total)).text());
 assert.equal(tail.length,1);
 assert.equal(tail[0].kind,'run_done');
 // since=1 → seq 2..total + run_done
 const mid=parseFrames(await (await openEvents(core,id,run.id,'?since=1')).text());
 assert.deepEqual(mid.filter(f=>f.kind!=='run_done').map(s=>s.seq),Array.from({length:total-1},(_,i)=>i+2));
 // 非法/负数 since 不生效：回退全量重放
 for(const bad of ['?since=abc','?since=-1']){
  const frames=parseFrames(await (await openEvents(core,id,run.id,bad)).text());
  assert.equal(frames.filter(f=>f.kind!=='run_done').length,total);
 }
});

test('心跳：CONTENT_STUDIO_AGENT_STREAM_HEARTBEAT_MS=3000 下 9s 读窗口 ≥2 个空行帧',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'心跳下限'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'心跳正文。'});
 process.env.CONTENT_STUDIO_AGENT_STREAM_HEARTBEAT_MS='3000';
 t.after(()=>{delete process.env.CONTENT_STUDIO_AGENT_STREAM_HEARTBEAT_MS});
 let release;const gate=new Promise(r=>{release=r});
 const run=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'x',
  expectedRevision:saved.revision,allowExternalAI:true,
  fetchImpl:async()=>{await gate;return final()}});
 const events=await openEvents(core,id,run.id);
 const reader=events.body.getReader(),dec=new TextDecoder();
 // 后台泵持续 read（不可对同一 reader 反复 race 超时——被放弃的 read 仍在
 // 队列里，会吞掉到达的帧），主窗口等待 9s 后统计。
 let buf='',empty=0,frames=0,streamDone=false;
 const pump=(async()=>{
  try{
   for(;;){
    const {done,value}=await reader.read();
    if(done){streamDone=true;return}
    buf+=dec.decode(value,{stream:true});
    const lines=buf.split('\n');buf=lines.pop();
    for(const line of lines)line.trim()===''?empty++:frames++;
   }
  }catch{streamDone=true}
 })();
 await new Promise(r=>setTimeout(r,9000));
 const emptyDuringHang=empty,framesDuringHang=frames;
 release(final());
 await core.agent.runSettled(run.id);
 await Promise.race([pump,new Promise(r=>setTimeout(r,2000))]);
 assert.ok(emptyDuringHang>=2,'9s 读窗口应至少 2 个空行心跳，实际 '+emptyDuringHang);
 // 挂起期间零事件帧：空行心跳不是事件 kind
 assert.equal(framesDuringHang,0,'挂起期间不应有事件帧，实际 '+framesDuringHang);
});

test('更小的心跳值被 Math.max 抬到下限：CONTENT_STUDIO_AGENT_STREAM_HEARTBEAT_MS=100 不会密集发射',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'心跳钳制'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'钳制正文。'});
 process.env.CONTENT_STUDIO_AGENT_STREAM_HEARTBEAT_MS='100';
 t.after(()=>{delete process.env.CONTENT_STUDIO_AGENT_STREAM_HEARTBEAT_MS});
 let release;const gate=new Promise(r=>{release=r});
 const run=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'x',
  expectedRevision:saved.revision,allowExternalAI:true,
  fetchImpl:async()=>{await gate;return final()}});
 const events=await openEvents(core,id,run.id);
 const reader=events.body.getReader(),dec=new TextDecoder();
 let buf='',empty=0;
 const pump=(async()=>{
  try{
   for(;;){
    const {done,value}=await reader.read();
    if(done)return;
    buf+=dec.decode(value,{stream:true});
    const lines=buf.split('\n');buf=lines.pop();
    for(const line of lines)if(!line.trim())empty++;
   }
  }catch{}
 })();
 await new Promise(r=>setTimeout(r,9000));
 release(final());
 await core.agent.runSettled(run.id);
 await Promise.race([pump,new Promise(r=>setTimeout(r,2000))]);
 assert.ok(empty>=2,'钳制后仍应有正常心跳，实际 '+empty);
 assert.ok(empty<=4,'未钳制时 9s 窗口会出现约 10 个空行；实际 '+empty+' 说明 Math.max 下限未生效');
});

// ---- SA-02：中断/失败运行的 resumeOf 重驱动 ----

const toolResponse=name=>args=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',
 message:{role:'assistant',content:null,tool_calls:[{id:'t_'+Math.random().toString(16).slice(2),type:'function',
 function:{name,arguments:JSON.stringify(args)}}]}}]}),{headers:{'content-type':'application/json'}});

test('interrupted 运行可用 resumeOf 重驱动：续跑 completed、首步骤 resume、两次建议共存',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'重驱动'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'需要重试的原始句子。'});
 const suggest=toolResponse('write_suggestions');
 let phase=0;
 const fetchA=async()=>{
  if(phase===0){phase=1;return suggest({reason:'中断前建议',edits:[{from:0,to:4,original:'需要重试',replacement:'第一次修改'}]})}
  // 放行后：tracked.revision 已被作者保存甩开 → 写工具 409 → interrupted
  return suggest({reason:'漂移建议',edits:[{from:0,to:2,original:'需要',replacement:'漂'}]})};
 let release;const gate=new Promise(r=>{release=r});
 phase=0;
 const gatedFetch=async(u,o)=>{if(phase===1){await gate}return fetchA(u,o)};
 const run1=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'首轮',
  expectedRevision:saved.revision,allowExternalAI:true,fetchImpl:gatedFetch});
 while(core.writing.suggestions(id,'master').length<1)await new Promise(r=>setTimeout(r,20));
 const authorSaved=core.writing.save(id,'master',{expectedRevision:core.writing.document(id,'master').revision,
  markdown:'作者在运行中改了正文。'});
 release();
 await core.agent.runSettled(run1.id);
 assert.equal(core.agent.run(id,run1.id).status,'interrupted');
 assert.equal(core.writing.suggestions(id,'master').length,1);
 // 续跑：以当前正文为基准开新运行（不是断点续传），首步骤 resume
 let observed=null;
 const fetchB=async(url,options)=>{
  observed=JSON.parse(options.body);
  // 工具结果后的收尾调用返回终稿，结束运行
  if(observed.messages.at(-1).role==='tool')return final();
  return suggest({reason:'续跑建议',edits:[{from:0,to:5,original:'作者在运行',replacement:'续跑后的表达'}]})};
 const run2=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'首轮',
  expectedRevision:authorSaved.revision,allowExternalAI:true,fetchImpl:fetchB,resumeOf:run1.id});
 assert.equal(run2.status,'running');
 await core.agent.runSettled(run2.id);
 const done=core.agent.run(id,run2.id);
 assert.equal(done.status,'completed');
 assert.equal(done.steps[0].kind,'resume');
 assert.equal(done.steps[0].seq,1,'resume 首步骤占用 seq=1，_loop 从其后继续');
 assert.equal(done.steps[0].payload.resumeOf,run1.id);
 assert.equal(done.steps[0].payload.baseRevision,authorSaved.revision);
 assert.equal(done.steps.some(s=>s.kind==='tool'&&s.payload?.name==='write_suggestions'),true);
 assert.equal(core.writing.suggestions(id,'master').length,2,'中断前与续跑的建议应共存');
 assert.equal(JSON.parse(observed.messages[1].content).revision,authorSaved.revision,'续跑以当前正文为基准');
});

test('resumeOf 409 矩阵、404 与 403 门禁，空绑定行不建跑',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'续跑门禁'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'续跑门禁正文。'});
 const base=over=>({skillId:'selection-rewriter',instruction:'x',expectedRevision:saved.revision,allowExternalAI:true,...over});
 // 403：consent 仍必填
 await assert.rejects(()=>core.agent.startRun(id,'master',{...base({resumeOf:'ar_'+'0'.repeat(36)}),allowExternalAI:false}),e=>e.status===403);
 // 404：不存在的 resumeOf
 await assert.rejects(()=>core.agent.startRun(id,'master',base({resumeOf:'ar_'+'0'.repeat(36)})),e=>e.status===404);
 // completed / cancelled 均不可续跑
 const done=await core.agent.startRun(id,'master',{...base(),fetchImpl:async()=>final()});
 await core.agent.runSettled(done.id);
 assert.equal(core.agent.run(id,done.id).status,'completed');
 await assert.rejects(()=>core.agent.startRun(id,'master',base({resumeOf:done.id})),e=>e.status===409);
 let releaseC;const gateC=new Promise(r=>{releaseC=r});
 const cancelledRun=await core.agent.startRun(id,'master',{...base(),fetchImpl:async()=>{await gateC;return final()}});
 core.agent.cancelRun(id,cancelledRun.id);
 releaseC(final());
 await core.agent.runSettled(cancelledRun.id);
 await assert.rejects(()=>core.agent.startRun(id,'master',base({resumeOf:cancelledRun.id})),e=>e.status===409);
 // 公众号渠道 completed 运行：渠道不符 → 409
 const wechatSaved=core.writing.save(id,'wechat',{expectedRevision:core.writing.document(id,'wechat').revision,
  markdown:'公众号续跑门禁。',sourceMasterRevision:saved.revision});
 const wechatRun=await core.agent.startRun(id,'wechat',{...base({expectedRevision:wechatSaved.revision}),fetchImpl:async()=>final()});
 await core.agent.runSettled(wechatRun.id);
 await assert.rejects(()=>core.agent.startRun(id,'master',base({resumeOf:wechatRun.id})),e=>e.status===409);
 // interrupted 运行：技能不符 / 当前正文 expectedRevision 不符 → 409
 const suggest=toolResponse('write_suggestions');
 const slow=()=>new Promise(r=>setTimeout(r,80));
 const inter=await core.agent.startRun(id,'master',{...base(),fetchImpl:async(u,o)=>{await slow();return suggest({reason:'r',edits:[{from:0,to:2,original:'续跑',replacement:'x'}]})}});
 const authorRev=core.writing.save(id,'master',{expectedRevision:saved.revision,markdown:'作者中断后的正文。'}).revision;
 await core.agent.runSettled(inter.id);
 assert.equal(core.agent.run(id,inter.id).status,'interrupted');
 await assert.rejects(()=>core.agent.startRun(id,'master',base({skillId:'draft-writer',expectedRevision:authorRev,resumeOf:inter.id})),e=>e.status===409);
 await assert.rejects(()=>core.agent.startRun(id,'master',base({expectedRevision:saved.revision,resumeOf:inter.id})),e=>e.status===409);
 // 缺省 skillId：续跑直接取原运行的技能（计划 §SA-02）
 const defaultSkill=await core.agent.startRun(id,'master',{instruction:'x',expectedRevision:authorRev,allowExternalAI:true,resumeOf:inter.id,fetchImpl:async()=>final()});
 assert.equal(defaultSkill.skillId,'selection-rewriter');
 await core.agent.runSettled(defaultSkill.id);
 assert.equal(core.agent.run(id,defaultSkill.id).status,'completed');
 // binding_json 为 DDL 默认 '{}' 的陈旧行：409 且不新建运行行
 core.db.prepare("INSERT INTO agent_runs VALUES('ar_emptybind',?,'master',?,'selection-rewriter',1,'ag_default','interrupted','','测试','{}','dead-owner','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')").run(id,authorRev);
 const runsBefore=core.agent.runs(id).length;
 await assert.rejects(()=>core.agent.startRun(id,'master',base({expectedRevision:authorRev,resumeOf:'ar_emptybind'})),
  e=>e.status===409&&/无可用模型绑定/.test(e.message));
 assert.equal(core.agent.runs(id).length,runsBefore,'空绑定续跑不得留下必然失败的新运行行');
 // 运行中 → 409（单飞与状态门禁双重拦截；单飞先触发）
 let releaseR;const gateR=new Promise(r=>{releaseR=r});
 const running=await core.agent.startRun(id,'master',{...base({expectedRevision:authorRev}),fetchImpl:async()=>{await gateR;return final()}});
 await assert.rejects(()=>core.agent.startRun(id,'master',base({expectedRevision:authorRev,resumeOf:running.id})),e=>e.status===409);
 core.agent.cancelRun(id,running.id);
 releaseR(final());
 await core.agent.runSettled(running.id);
});

test('resumeOf 复用原运行绑定：切换选中连接后，续跑调用仍走原连接',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'绑定复用'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'绑定复用正文。'});
 // 连接甲先保存（selected）；失败的运行绑定甲
 await core.services.save({kind:'text',name:'连接甲',baseUrl:'https://binding-a.example/v1/',model:'model-a',apiKey:'key-aaaa',models:['model-a']});
 const suggest=toolResponse('write_suggestions');
 const seen=[];
 const probe=fetch=>async(url,options)=>{seen.push(String(url));return fetch(url,options)};
 // failed 运行：移除写工具授权 → 工具未获代理授权 failed（绑定甲，当时被选中）
 core.agent.saveProfile({tools:['read_document']});
 const failRun=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'x',
  expectedRevision:saved.revision,allowExternalAI:true,
  fetchImpl:probe(async()=>suggest({reason:'x',edits:[]}))});
 await core.agent.runSettled(failRun.id);
 assert.equal(core.agent.run(id,failRun.id).status,'failed');
 assert.ok(seen.some(u=>u.startsWith('https://binding-a.example/v1/')),'失败运行应已用连接甲发出模型调用');
 // 连接乙后保存并成为 selected——此后 captureBinding 会取乙
 await core.services.save({kind:'text',name:'连接乙',baseUrl:'https://binding-b.example/v1/',model:'model-b',apiKey:'key-bbbb',models:['model-b']});
 core.agent.saveProfile({tools:['read_document','write_suggestions']});
 // 续跑 failed：调用必须仍走原绑定的连接甲，而不是当前选中的连接乙
 seen.length=0;
 const resumed=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'x',
  expectedRevision:core.writing.document(id,'master').revision,allowExternalAI:true,
  fetchImpl:probe(async()=>final()),resumeOf:failRun.id});
 await core.agent.runSettled(resumed.id);
 assert.equal(core.agent.run(id,resumed.id).status,'completed');
 assert.ok(seen.some(u=>u.startsWith('https://binding-a.example/v1/')),'续跑应复用原连接甲，实际：'+seen.join(' , '));
 assert.ok(!seen.some(u=>u.startsWith('https://binding-b.example/v1/')),'续跑不得静默换到当前选中的连接乙');
});

// ---- AG-01：article-pipeline 全流程技能的脚本化全流程运行（revisions 模式）----

test('article-pipeline 全流程：读 → write_revision → write_suggestions → 收尾，步骤序与修订推进',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'全流程流水线'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'尚无标题的正文起点。'});
 core.agent.saveProfile({writeMode:'revisions'});
 const draft='# 全流程标题骨架\n\n## 第一节\n\n流水线直写的完整初稿正文。';
 let phase=0;
 const reply=calls=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',
  message:{role:'assistant',content:null,tool_calls:calls}}]}),{headers:{'content-type':'application/json'}});
 const fetchImpl=async(url,options)=>{
  const body=JSON.parse(options.body);
  if(phase===0){phase=1;
   // revisions 模式下 write_revision 必须在宣告给模型的工具面里
   assert.equal(body.tools.some(x=>x.function.name==='write_revision'),true);
   return reply([{id:'p1',type:'function',function:{name:'read_brief',arguments:'{}'}}])}
  if(phase===1){phase=2;
   assert.equal(body.messages.at(-1).role,'tool');
   return reply([{id:'p2',type:'function',function:{name:'write_revision',
    arguments:JSON.stringify({markdown:draft,reason:'全流程初稿'})}}])}
  if(phase===2){phase=3;
   assert.equal(body.messages.at(-1).role,'tool');
   return reply([{id:'p3',type:'function',function:{name:'write_suggestions',
    arguments:JSON.stringify({reason:'自审：收紧主标题',edits:[
     {from:0,to:9,original:'# 全流程标题骨架',replacement:'# 全流程标题骨架（修订）'}]})}}])}
  assert.equal(body.messages.at(-1).role,'tool');
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',
   content:'产出：含标题骨架的初稿新修订与 1 处自审建议。人工下一步：逐项审阅建议 → 四项人工检查 → 配图 → 导出准备。'}}]}),{headers:{'content-type':'application/json'}})};
 const run=await core.agent.startRun(id,'master',{skillId:'article-pipeline',instruction:'按简报产出完整初稿',
  expectedRevision:saved.revision,allowExternalAI:true,fetchImpl});
 await core.agent.runSettled(run.id);
 const done=core.agent.run(id,run.id);
 assert.equal(done.status,'completed');
 // 步骤序：模型/工具严格交替，工具名依次 read_brief → write_revision → write_suggestions。
 assert.deepEqual(done.steps.map(s=>s.kind==='tool'?'tool:'+s.payload.name:s.kind),
  ['model','tool:read_brief','model','tool:write_revision','model','tool:write_suggestions','model']);
 // 修订推进：write_revision 经 expectedRevision/onWritten 链落库为新修订（reason 作为 note）。
 assert.equal(core.writing.document(id,'master').markdown,draft);
 assert.equal(core.writing.document(id,'master').note,'全流程初稿');
 // 自审建议基于新修订落库，待作者审阅——直写也不直接改稿。
 assert.equal(core.writing.suggestions(id,'master').length,1);
 // 无越权工具名：每个 tool_call 都落在技能声明的工具面内。
 const allowed=['read_document','read_brief','read_context','search_assets','write_revision','write_suggestions'];
 for(const step of done.steps)
  for(const call of step.payload?.toolCalls||[])
   assert.ok(allowed.includes(call.name),'越权工具：'+call.name);
 // 收尾 content：列人工下一步、止于导出准备、无发布承诺。
 const lastModel=done.steps.filter(s=>s.kind==='model').at(-1);
 assert.ok(lastModel.payload.content.includes('人工'),'收尾列出人工下一步');
 assert.ok(lastModel.payload.content.includes('导出准备'),'收尾止于导出准备');
 assert.ok(!lastModel.payload.content.includes('已发布'),'无已发布措辞');
 assert.ok(!lastModel.payload.content.includes('自动发布'),'无自动发布措辞');
 assert.match(done.stopReason,/导出准备/);
});

// ---- SC-02：run 级模型请求预算（usingTask 单调用包裹）+ 429 快速失败 ----

test('SC-02 额度快速失败：textLimit=0 时首个请求即 429 → failed、恰 1 帧 model_error、零 fetch',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const doc=core.writing.create({title:'额度快速失败'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'额度正文。'});
 core.services.setLimits({textLimit:0,imageLimit:30});
 let fetchCalls=0;
 const run=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'x',
  expectedRevision:saved.revision,allowExternalAI:true,fetchImpl:async()=>{fetchCalls++;return final()}});
 await core.agent.runSettled(run.id);
 const done=core.agent.run(id,run.id);
 assert.equal(done.status,'failed');
 // FIX-05②（EASEL-PORT-PLAN §13 定稿）：stopReason 恢复「模型请求额度已用完：」
 // + 占用侧 message（不丢 provider/占用信息）；textLimit=0 命中日额度分支。
 assert.match(done.stopReason,/额度/);
 assert.match(done.stopReason,/^模型请求额度已用完：今日请求额度已用完/);
 assert.equal(fetchCalls,0,'429 快速失败不应触发任何真实请求（无 3 连重试）');
 assert.equal(done.steps.filter(s=>s.kind==='model_error').length,1,'恰记一帧 model_error');
});

test('SC-02 run 级预算：cap=2 时第 3 次请求 429 快速 failed，恰 2 次 fetch 与 2 行任务占用',async t=>{
 provider(t);const env=setup(t),core=env.core;
 process.env.CONTENT_STUDIO_AGENT_RUN_REQUEST_CAP='2';
 t.after(()=>{delete process.env.CONTENT_STUDIO_AGENT_RUN_REQUEST_CAP});
 const doc=core.writing.create({title:'run 预算'}),id=doc.projectId;
 const saved=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'预算正文。'});
 let calls=0;
 const run=await core.agent.startRun(id,'master',{skillId:'selection-rewriter',instruction:'x',
  expectedRevision:saved.revision,allowExternalAI:true,
  fetchImpl:async()=>{calls++;
   return new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,
    tool_calls:[{id:'b'+calls,type:'function',function:{name:'read_document',arguments:'{}'}}]}}]}),{headers:{'content-type':'application/json'}})}});
 await core.agent.runSettled(run.id);
 const done=core.agent.run(id,run.id);
 assert.equal(done.status,'failed');
 assert.match(done.stopReason,/额度/);
 // FIX-05②：任务预算分支的 429，占用侧 message 必须保留在 stopReason 里
 assert.match(done.stopReason,/该任务请求上限已用完/);
 assert.equal(calls,2,'第 3 次 reserve 在 fetch 前被任务上限拦下');
 assert.equal(core.db.prepare("SELECT COUNT(*) AS n FROM service_usage_tasks WHERE task_id=?").get(run.id).n,2,
  '429 尝试不落占用行（ROLLBACK），恰 2 行');
 const req=(path,method='GET',input)=>dispatchApi(new Request('http://127.0.0.1:4312'+path,{method,headers:input?{'content-type':'application/json'}:{},body:input?JSON.stringify(input):undefined}),core);
 assert.equal((await (await req('/api/creator/agent')).json()).runRequestCap,2,'环境变量读时生效');
});

test('SC-02 runRequestCap：缺省 20、上界钳制在 usingTask 既有校验上限',async t=>{
 provider(t);const env=setup(t),core=env.core;
 const req=(path,method='GET',input)=>dispatchApi(new Request('http://127.0.0.1:4312'+path,{method,headers:input?{'content-type':'application/json'}:{},body:input?JSON.stringify(input):undefined}),core);
 assert.equal((await (await req('/api/creator/agent')).json()).runRequestCap,20,'缺省 20');
 process.env.CONTENT_STUDIO_AGENT_RUN_REQUEST_CAP='99';
 t.after(()=>{delete process.env.CONTENT_STUDIO_AGENT_RUN_REQUEST_CAP});
 assert.equal((await (await req('/api/creator/agent')).json()).runRequestCap,20,'上界 20 是 usingTask 校验上限，钳制不报错');
 process.env.CONTENT_STUDIO_AGENT_RUN_REQUEST_CAP='abc';
 assert.equal((await (await req('/api/creator/agent')).json()).runRequestCap,20,'非法值回缺省');
 process.env.CONTENT_STUDIO_AGENT_RUN_REQUEST_CAP='0';
 assert.equal((await (await req('/api/creator/agent')).json()).runRequestCap,20,'下界抬到 1 以上（0 视为未设置回缺省）');
});

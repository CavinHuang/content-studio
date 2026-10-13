import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const tmp=mkdtempSync(join(tmpdir(),'cs26-http-'));const port=54426;const base=`http://127.0.0.1:${port}`;
async function req(path,method='GET',body,origin){const r=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(origin?{Origin:origin}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:(r.headers.get('content-type')||'').includes('application/json')?await r.json():await r.text()}}
let proc;
test('V26 HTTP: create document → claim → new research → precise correction, article revisions retained',async()=>{
 proc=spawn(process.execPath,['src/server.mjs'],{cwd:process.cwd(),env:{...process.env,DB_PATH:join(tmp,'test.sqlite'),PORT:String(port),ENABLE_SCENARIO:'1'},stdio:'ignore'});
 try{let ready=false;for(let i=0;i<55;i++){try{if((await req('/api/health')).status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,80))}assert.ok(ready);
 let r=await req('/precision');assert.equal(r.status,200);assert.match(r.data,/精准更正工作台/);
 r=await req('/api/fixture/seed','POST',{});assert.equal(r.status,200);
 const eid=(await req('/api/events')).data.events[0].id;
 let c=(await req('/api/validations','POST',{eventId:eid,hypothesis:'Agent 调试过程有时缺少足够的工具日志以说明失败原因'})).data;
 c=(await req(`/api/validations/${c.id}/evidence`,'POST',{version:c.version,kind:'reproduction',result:'supports',observation:'A controlled local run hid tool failure text, yet had no external user evidence.'})).data;
 c=(await req(`/api/validations/${c.id}/decision`,'POST',{version:c.version,status:'confirmed',conclusion:'The controlled reproduction supports only one narrow observation, not market demand.',nextAction:'Document an honest caveat'})).data;
 const k=(await req('/api/knowledge','POST',{caseId:c.id,synthesis:'An isolated run did not show a useful failure context but this says nothing about all users.',limitations:'One local reproducibility run only, with synthetic data.'})).data;
 const brief=(await req('/api/briefs','POST',{eventId:eid})).data;
 const ref=(await req('/api/content-references','POST',{briefId:brief.id,cardId:k.id,title:'Agent debugging practice',channel:'zhihu',status:'draft'})).data;
 r=await req('/api/precision/documents','POST',{referenceId:ref.id,expectedRevision:0,paragraphs:[{id:'p_test_01',text:'一次本地实验显示，工具失败信息未能在调试视图中完整呈现。'},{id:'p_test_02',text:'这是一条实验记录，不证明真实用户具有普遍需求。'}]});assert.equal(r.status,201);assert.equal(r.data.revision,1);
 r=await req('/api/precision/claims','POST',{referenceId:ref.id,paragraphId:'p_test_01',quote:'工具失败信息未能在调试视图中完整呈现',evidenceIds:[c.evidence[0].id]});assert.equal(r.status,201);assert.equal(r.data.anchorStatus,'matched');
 r=await req('/api/precision/corrections/scan','POST',{});assert.equal(r.status,200);assert.equal(r.data.created,0);
 c=(await req(`/api/validations/${c.id}/reopen`,'POST',{version:c.version,reason:'A later controlled run contradicts the older narrow observation'})).data;
 r=await req('/api/precision/corrections/scan','POST',{});assert.equal(r.status,200);assert.equal(r.data.created,1);const task=r.data.tasks[0];
 r=await req('/api/precision/corrections/scan','POST',{});assert.equal(r.data.created,0);
 r=await req(`/api/precision/corrections/${task.id}/propose`,'POST',{expectedDocumentRevision:1,proposedText:'在新版本的本地实验中，工具失败细节可以完整呈现，早期观察仅限旧环境。',reason:'同一条件下的新复现不支持先前的宽泛表述，应收窄描述范围。'});assert.equal(r.status,200);
 r=await req(`/api/precision/corrections/${task.id}/decide`,'POST',{action:'apply_local',expectedDocumentRevision:1,note:'依据新受控实验，修正本地段落，历史原文与证据锚点仍保留。'});assert.equal(r.status,200);assert.equal(r.data.status,'local_applied');
 r=await req(`/api/precision/documents/${ref.id}/history`);assert.equal(r.status,200);assert.equal(r.data.history.length,2);assert.match(r.data.history[1].paragraphs[0].text,/工具失败信息/);
 r=await req('/api/precision');assert.equal(r.status,200);assert.equal(r.data.stats.anchorMismatches,1);assert.equal(r.data.stats.resolved,1);
 r=await req('/api/precision/claims','POST',{referenceId:ref.id,paragraphId:'p_test_02',quote:'不存在的引文',evidenceIds:[c.evidence[0].id]});assert.equal(r.status,409);
 r=await req('/api/precision/documents','POST',{referenceId:ref.id,expectedRevision:1,paragraphs:[{id:'p_test_02',text:'无法复写历史'}]});assert.equal(r.status,409);
 r=await req('/api/precision/documents','POST',{referenceId:ref.id,expectedRevision:2,paragraphs:[{id:'p_test_02',text:'跨域伪造'}]},'https://other.example');assert.equal(r.status,403);
 }finally{proc?.kill();rmSync(tmp,{recursive:true,force:true})}
});

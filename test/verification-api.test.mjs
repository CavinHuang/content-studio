import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const temp=mkdtempSync(join(tmpdir(),'cs24-http-')),port=54424;const base=`http://127.0.0.1:${port}`;let worker;
async function request(path,{method='GET',body,headers={}}={}){const r=await fetch(base+path,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,body:(r.headers.get('Content-Type')||'').includes('application/json')?await r.json():await r.text()}}
test('end-to-end: selected event → validation → evidence → decision → immutable Brief',async()=>{worker=spawn(process.execPath,['src/server.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DB_PATH:join(temp,'db.sqlite'),ENABLE_SCENARIO:'1'},stdio:'ignore'});
 try{let ready=false;for(let i=0;i<60;i++){try{if((await request('/api/health')).status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,75))}assert.ok(ready);
 let r=await request('/api/fixture/seed',{method:'POST',body:{}});assert.equal(r.status,200);r=await request('/api/opportunities');const id=r.body.opportunities[0].eventId;
 r=await request('/api/validations',{method:'POST',body:{eventId:id,hypothesis:'Agent failures cannot be diagnosed with the available trace.'}});assert.equal(r.status,201);let c=r.body;assert.equal(c.status,'open');
 r=await request('/api/validations/'+c.id+'/decision',{method:'POST',body:{version:c.version,status:'confirmed',conclusion:'Some empirical data appears to be available here.',nextAction:'Write the report'}});assert.equal(r.status,400);
 r=await request('/api/validations/'+c.id+'/evidence',{method:'POST',body:{version:c.version,kind:'reproduction',result:'supports',observation:'In a controlled fixture the tool failed and the user could not inspect it; no real users involved.'}});assert.equal(r.status,201);c=r.body;
 r=await request('/api/opportunities');assert.equal(r.body.opportunities.find(x=>x.eventId===id).verification.status,'investigating');
 r=await request('/api/briefs',{method:'POST',body:{eventId:id}});assert.equal(r.status,201);assert.equal(r.body.verification.evidence.length,1);const briefId=r.body.id;
 r=await request('/api/validations/'+c.id+'/decision',{method:'POST',body:{version:c.version,status:'confirmed',conclusion:'A controlled reproduction supports a narrow technical bug, not market demand.',nextAction:'Write only about the reproduction'}});assert.equal(r.status,200);c=r.body;assert.equal(c.validatedUserProblem,false);
 r=await request('/api/opportunities');assert.equal(r.body.opportunities.find(x=>x.eventId===id).validatedUserProblem,false);
 r=await request('/api/briefs/'+briefId);assert.equal(r.body.verification.status,'investigating');
 r=await request('/api/validations/'+c.id+'/reopen',{method:'POST',body:{version:c.version,reason:'New test shows different behavior under same conditions'}});assert.equal(r.status,200);
 r=await request('/api/validations/'+c.id,{method:'PATCH',body:{version:1,hypothesis:'collision'}});assert.equal(r.status,409);
 r=await request('/api/validations',{method:'POST',headers:{origin:'https://evil.test'},body:{eventId:id,hypothesis:'Unauthorized create should be blocked'}});assert.equal(r.status,403);
 r=await request('/verification');assert.equal(r.status,200);assert.match(r.body,/问题验证/);
 }finally{worker?.kill();rmSync(temp,{recursive:true,force:true})}
});

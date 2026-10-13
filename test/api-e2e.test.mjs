import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const temp=mkdtempSync(join(tmpdir(),'cs23-e2e-')),port=54382;let worker;
async function api(path,{method='GET',body=null,headers={}}={}){const r=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:(r.headers.get('content-type')||'').includes('application/json')?await r.json():await r.text()}}
test('real HTTP boundary: health, fixture, opportunities, briefs, origin & model guard',async()=>{
 worker=spawn(process.execPath,['src/server.mjs'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DB_PATH:join(temp,'db.sqlite'),ENABLE_SCENARIO:'1',CONTENT_AI_API_KEY:'',CONTENT_AI_BASE_URL:'',CONTENT_AI_MODEL:''},stdio:'ignore'});
 try{let ready=false;for(let i=0;i<30;i++){try{const r=await api('/api/health');if(r.status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'server listening');
 let s=await api('/api/status');assert.equal(s.status,200);assert.equal(s.data.selected.status,'never');
 s=await api('/api/opportunities');assert.equal(s.data.opportunities.length,0);
 s=await api('/api/fixture/seed',{method:'POST',body:{}});assert.equal(s.status,200);assert.ok(s.data.itemsInserted>0);
 s=await api('/api/opportunities');assert.equal(s.status,200);assert.ok(s.data.opportunities.length>=4);assert.ok(s.data.opportunities.every(x=>x.validatedUserProblem===false));
 const eventId=s.data.opportunities[0].eventId;
 s=await api('/api/briefs',{method:'POST',body:{eventId}});assert.equal(s.status,201);assert.ok(s.data.sourceItems.length>=1);
 const id=s.data.id;s=await api(`/api/briefs/${id}`);assert.equal(s.data.id,id);
 s=await api('/api/opportunities/analyze',{method:'POST',body:{eventId}});assert.equal(s.status,503);
 s=await api('/api/fixture/seed',{method:'POST',body:{},headers:{Origin:'http://malicious.example'}});assert.equal(s.status,403);
 s=await api('/opportunities');assert.equal(s.status,200);
 }finally{worker.kill();rmSync(temp,{recursive:true,force:true});}
});

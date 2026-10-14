/**
 * V64 real built Next process via guarded launcher, isolated SQLite and
 * loopback-only endpoint. No actual production data, private credentials or
 * external publishers. Run AFTER npm run build.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {getHeadSha,verifyBuildReceipt,probeServingBuild} from '../scripts/build-provenance-v64.mjs';

const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){
 const s=createServer();
 await new Promise((ok,bad)=>s.once('error',bad).listen(0,'127.0.0.1',ok));
 const p=s.address().port;await new Promise(ok=>s.close(ok));return p;
}
async function stop(child){
 if(!child||child.exitCode!==null||child.signalCode!==null)return;
 const exit=new Promise(r=>child.once('exit',r));
 child.kill('SIGTERM');
 await Promise.race([exit,wait(5500)]);
 if(child.exitCode===null&&child.signalCode===null){
  child.kill('SIGKILL');await Promise.race([exit,wait(1000)]);
 }
}
test('V64 actual guarded production Next.js process announces same sealed Git SHA and file digest',
 {timeout:100000},async t=>{
 const cwd=process.cwd(),sha=getHeadSha(cwd);
 const sealed=verifyBuildReceipt({cwd,expectedSha:sha});
 const dir=mkdtempSync(join(tmpdir(),'cs-v64-serve-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const p=await port(),base='http://127.0.0.1:'+p;
 const env={...process.env,PORT:String(p),NODE_ENV:'production',NODE_OPTIONS:'',
  CONTENT_STUDIO_DB_PATH:join(dir,'isolated.sqlite'),
  CONTENT_STUDIO_ALLOW_REMOTE:'0',ENABLE_SCENARIO:'0',HOST:'127.0.0.1',HOSTNAME:'',
  CONTENT_AI_API_KEY:'',CONTENT_IMAGE_API_KEY:'',CONTENT_IMAGE_OPENAI_API_KEY:'',
  CONTENT_IMAGE_GEMINI_API_KEY:'',CONTENT_IMAGE_QWEN_API_KEY:'',
  CONTENT_IMAGE_REVIEW_API_KEY:'',CONTENT_ILLUSTRATION_PLANNER_API_KEY:''};
 for(const key of Object.keys(env)){
  if(key.startsWith('NEXT_PUBLIC_')&&/API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|AUTH_KEY/i.test(key))
   delete env[key];
 }
 const child=spawn(process.execPath,['scripts/runtime-guard.mjs','start'],{
  cwd,env,stdio:['ignore','pipe','pipe'],windowsHide:true
 });
 const output=[];
 for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{
  if(output.length<12)output.push(String(b).slice(0,160));
 });
 try{
  let ready=null;
  for(let i=0;i<160;i++){
   if(child.exitCode!==null||child.signalCode!==null)break;
   try{
    const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(900)});
    if(r.ok){
     const value=await r.json();
     if(value.framework==='nextjs'&&value.runtimeBuild){ready=value;break}
    }
   }catch{}
   await wait(250);
  }
  assert.ok(ready,'Guarded Next server must start with a signed-off receipt; '+output.join(' ').slice(0,400));
  assert.equal(ready.runtimeBuild.candidateCommit,sha);
  assert.equal(ready.runtimeBuild.artifactDigestSha256,sealed.artifactDigestSha256);
  assert.equal(ready.runtimeBuild.buildId,sealed.buildId);
  const probed=await probeServingBuild({sha,url:base});
  assert.equal(probed.servingProcessDeclarationMatchesBuild,true);
  assert.equal(probed.independentProcessBinaryAttestation,false);
  assert.equal(probed.mergeAuthorized,false);
  assert.equal(probed.productionReady,false);
 }finally{await stop(child)}
});

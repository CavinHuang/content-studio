import test from 'node:test';
import assert from 'node:assert/strict';
import {runSmoke,parseSmokeArgs,CONSENT_PHRASE} from '../scripts/paid-image-smoke.mjs';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
function env(t,entries){
 const prior=Object.fromEntries(Object.keys(entries).map(k=>[k,process.env[k]]));
 Object.assign(process.env,entries);
 t.after(()=>{for(const [k,v] of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v}});
}
test('smoke rejects accidental paid execution without exact opt-in and explicit single-request cap',async()=>{
 assert.deepEqual(parseSmokeArgs(['--provider=qwen']),{provider:'qwen',execute:false,maxRequests:null});
 assert.throws(()=>parseSmokeArgs(['--execute','--provider=openai']),/max-requests=1/);
 assert.throws(()=>parseSmokeArgs(['--execute','--provider=openai','--max-requests=2']),/exactly one/);
 assert.throws(()=>parseSmokeArgs(['--execute','--provider=unknown','--max-requests=1']),/supported provider/);
 let called=0;
 await assert.rejects(()=>runSmoke(['--execute','--provider=openai','--max-requests=1'],{environment:{},generator:async()=>{called++},output:()=>{}}),/Paid image test blocked/);
 assert.equal(called,0);
});
test('default smoke preflight does not call generator or record image',async()=>{
 let called=0,printed='';
 const result=await runSmoke(['--provider=openai'],{generator:async()=>{called++},output:x=>printed=x});
 assert.equal(result.mode,'offline_only');assert.equal(result.requests,0);assert.equal(called,0);
 assert.equal(JSON.parse(printed).noPublication,true);
 assert.equal(JSON.parse(printed).storesImagePersistently,false);
});
test('opted-in acceptance uses only one model invocation and a 1-request SQLite budget',async t=>{
 env(t,{CONTENT_IMAGE_OPENAI_API_KEY:'fake-example-only',CONTENT_IMAGE_OPENAI_MODEL:'gpt-image-2',CONTENT_IMAGE_OPENAI_BASE_URL:'https://api.openai.com/v1/'});
 const prompts=[];let printed='';
 const result=await runSmoke(['--provider=openai','--max-requests=1','--execute'],{
  environment:{CONTENT_STUDIO_PAID_SMOKE_CONSENT:CONSENT_PHRASE},
  generator:async(prompt,{provider})=>{prompts.push({prompt,provider});return {base64:png,provider:'openai',model:'fake-only'}},
  output:x=>printed=x
 });
 assert.equal(prompts.length,1);assert.equal(prompts[0].provider,'openai');
 assert.match(prompts[0].prompt,/Synthetic illustration provider verification/);
 assert.equal(result.outcome,'generated_unapproved');
 assert.equal(result.requestsReserved,1);
 assert.equal(result.requestsAttemptedAtMost,1);
 assert.equal(result.ephemeralDb,true);
 assert.equal(result.noPublication,true);
 assert.equal(result.imageApproved,false);
 assert.doesNotMatch(printed,/fake-example-only|iVBORw0KGgo|三個|三个抽象方块/);
});
test('failed once is not automatically retried or promoted; model errors are not echoed',async t=>{
 env(t,{CONTENT_IMAGE_OPENAI_API_KEY:'fake-example-only',CONTENT_IMAGE_OPENAI_MODEL:'gpt-image-2',CONTENT_IMAGE_OPENAI_BASE_URL:'https://api.openai.com/v1/'});
 let count=0,printed='';
 await assert.rejects(()=>runSmoke(['--provider=openai','--max-requests=1','--execute'],{
  environment:{CONTENT_STUDIO_PAID_SMOKE_CONSENT:CONSENT_PHRASE},
  generator:async()=>{count++;throw Object.assign(new Error('sensitive provider failure and fake-example-only'),{status:429,retryable:true})},
  output:x=>printed=x
 }),/Paid smoke returned an unsuccessful/);
 assert.equal(count,1);
 const row=JSON.parse(printed);assert.equal(row.requestsReserved,1);assert.equal(row.requestCostUnknown,true);
 assert.equal(row.outcome,'failed');
 assert.deepEqual(row.error,{status:429,classification:'transient'});
 assert.doesNotMatch(printed,/sensitive provider failure|fake-example-only/);
});

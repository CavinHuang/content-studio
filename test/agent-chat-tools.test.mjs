import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {Store} from '../src/store.mjs';
import {CreatorServices} from '../src/creator-services.mjs';

function setup(t,handler){
 const root=mkdtempSync(join(tmpdir(),'agent-chat-')),file=join(root,'t.sqlite');
 const names=['CONTENT_AI_BASE_URL','CONTENT_AI_MODEL','CONTENT_AI_API_KEY'],old=names.map(n=>process.env[n]);
 t.after(()=>names.forEach((n,i)=>{if(old[i]===undefined)delete process.env[n];else process.env[n]=old[i]}));
 process.env.CONTENT_AI_BASE_URL='https://agent.example/v1/';process.env.CONTENT_AI_MODEL='synthetic-agent-model';process.env.CONTENT_AI_API_KEY='synthetic-key';
 let calls=0;
 const service=new CreatorServices(new Store(file).db,{key:randomBytes(32),fetchImpl:async(url,options)=>{calls++;return handler(JSON.parse(options.body),calls)}});
 t.after(()=>{service.db.close?.();rmSync(root,{recursive:true,force:true})});
 return {service,get calls(){return calls}};
}
const toolCall=()=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'call_1',type:'function',function:{name:'read_document',arguments:'{}'}}]}}]}),{headers:{'content-type':'application/json'}});
const final=()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'完成'}}]}),{headers:{'content-type':'application/json'}});

test('chatWithTools requires consent, forwards tool messages and settles usage',async t=>{
 const env=setup(t,(body,call)=>{if(call===1)return toolCall();
  assert.equal(body.messages.at(-1).role,'tool');assert.equal(body.messages.at(-1).tool_call_id,'call_1');
  return final()});
 const binding=env.service.captureBinding('text');
 await assert.rejects(()=>env.service.chatWithTools({binding,messages:[{role:'user',content:'x'}],tools:[]}),e=>e.status===403);
 const msg=await env.service.chatWithTools({binding,messages:[{role:'user',content:'x'}],tools:[{type:'function',function:{name:'read_document',description:'d',parameters:{type:'object',properties:{}}}}],runConsent:true});
 assert.equal(msg.tool_calls[0].function.name,'read_document');
 const second=await env.service.chatWithTools({binding,messages:[{role:'user',content:'x'},{role:'assistant',content:null,tool_calls:msg.tool_calls},{role:'tool',tool_call_id:'call_1',content:'{}'}],tools:[],runConsent:true});
 assert.equal(second.content,'完成');
 assert.ok(env.service.usage().today.find(r=>r.kind==='text'&&r.state==='completed')?.requests>=2);
});

test('chatWithTools marks network failures as unknown usage and surfaces 502',async t=>{
 const env=setup(t,()=>{throw new Error('disconnect')});
 const binding=env.service.captureBinding('text');
 await assert.rejects(()=>env.service.chatWithTools({binding,messages:[{role:'user',content:'x'}],tools:[],runConsent:true}),e=>e.status===502);
 assert.ok(env.service.usage().today.find(r=>r.kind==='text'&&r.state==='unknown'));
});

test('mid-body disconnect marks usage unknown and surfaces 502',async t=>{
 const env=setup(t,()=>new Response(new ReadableStream({pull(c){c.error(new Error('broken pipe'))}}),{headers:{'content-type':'application/json'}}));
 const binding=env.service.captureBinding('text');
 await assert.rejects(()=>env.service.chatWithTools({binding,messages:[{role:'user',content:'x'}],tools:[],runConsent:true}),e=>e.status===502);
 assert.ok(env.service.usage().today.find(r=>r.kind==='text'&&r.state==='unknown'));
});

test('chatWithTools prefers an injected fetchImpl over the service fetch',async t=>{
 const env=setup(t,()=>{throw new Error('service fetchImpl must not be used')});
 const binding=env.service.captureBinding('text');
 let seen=null;
 const injected=async(url,options)=>{seen=String(url);
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content:'injected'}}]}),{headers:{'content-type':'application/json'}})};
 const msg=await env.service.chatWithTools({binding,messages:[{role:'user',content:'x'}],tools:[],runConsent:true,fetchImpl:injected});
 assert.equal(msg.content,'injected');
 assert.equal(seen,'https://agent.example/v1/chat/completions');
 assert.equal(env.calls,0);
});

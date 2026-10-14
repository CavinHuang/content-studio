import test from 'node:test';
import assert from 'node:assert/strict';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';
import {generateProviderImage,providerContractPreflight,editProviderImage} from '../src/image-providers.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
const req=(core,path,method='GET',value)=>dispatchApi(new Request('http://localhost:4312'+path,{
 method,headers:value?{'content-type':'application/json'}:{},body:value?JSON.stringify(value):undefined
}),core);
function env(t,settings){
 const original=Object.fromEntries(Object.keys(settings).map(k=>[k,process.env[k]]));
 Object.assign(process.env,settings);t.after(()=>{for(const [k,v] of Object.entries(original)){if(v===undefined)delete process.env[k];else process.env[k]=v}});
}
function mock(t,fn){const old=globalThis.fetch;globalThis.fetch=fn;t.after(()=>{globalThis.fetch=old})}
async function setup(t){
 const c=createCore(':memory:');t.after(()=>c.close());
 const created=await req(c,'/api/editor/projects','POST',{title:'公众号交接验收文章',paragraphs:[{text:'这是一篇对自动配图和证据一致性进行审查的实践文章，所有插图都需要人工审阅。'}]});
 assert.equal(created.status,201);
 const p=await created.json(),root=`/api/illustrations/projects/${p.id}`;
 const planned=await req(c,root+'/plan','POST',{expectedMasterRevision:1});
 assert.equal(planned.status,201);
 return {c,p,root,plan:await planned.json()};
}

test('provider preflight is local, returns non-secret contract and never uses network',async t=>{
 const {c}=await setup(t);
 env(t,{CONTENT_IMAGE_OPENAI_API_KEY:'unprintable-sandbox-secret',CONTENT_IMAGE_OPENAI_MODEL:'gpt-image-2',
  CONTENT_IMAGE_OPENAI_BASE_URL:'https://api.openai.com/v1/',
  CONTENT_IMAGE_QWEN_API_KEY:'unprintable-qwen-key',
  CONTENT_IMAGE_QWEN_BASE_URL:'http://outside.example/v1/'});
 let called=0;mock(t,async()=>{called++;throw Error('must not call network')});
 const result=await req(c,'/api/illustrations/providers/preflight');
 assert.equal(result.status,200);const view=await result.json();
 assert.equal(view.networkCalls,0);assert.equal(view.chargedRequests,0);
 assert.equal(view.providers.length,3);
 assert.equal(view.providers.find(x=>x.id==='openai').configured,true);
 assert.deepEqual(view.providers.find(x=>x.id==='qwen').problems,['invalid_base_url']);
 assert.equal(called,0);
 assert.doesNotMatch(JSON.stringify(view),/unprintable|Bearer|private image bytes/);
 assert.equal(providerContractPreflight().find(x=>x.id==='openai').liveApiChecked,false);
});

test('OpenAI permanent authorization errors cannot accidentally trigger paid provider fallback',async t=>{
 const {c,root,plan}=await setup(t);
 env(t,{CONTENT_IMAGE_OPENAI_API_KEY:'mock-openai',CONTENT_IMAGE_OPENAI_MODEL:'gpt-image-2',
  CONTENT_IMAGE_OPENAI_BASE_URL:'https://api.openai.com/v1/',
  CONTENT_IMAGE_GEMINI_API_KEY:'mock-gemini',CONTENT_IMAGE_GEMINI_MODEL:'gemini-nano-banana-2.1',
  CONTENT_IMAGE_GEMINI_BASE_URL:'https://generativelanguage.googleapis.com/v1beta/'});
 let calls=0;mock(t,async()=>{calls++;return Response.json({error:{message:'token must never leak'}},{status:401})});
 const r=await req(c,`${root}/shots/${plan.shots[0].id}/generate`,'POST',{
  provider:'openai',fallbackProviders:['gemini'],maxAttempts:2,allowExternalAI:true
 });
 assert.equal(r.status,401);
 assert.equal(calls,1,'permanent 401 must not call second provider');
 const state=await (await req(c,root)).json();
 assert.equal(state.shots[0].attempts.length,1);
 assert.equal((await (await req(c,root+'/budget')).json()).used,1);
 assert.doesNotMatch(state.shots[0].error,/token must never leak/);
});

test('provider-side invalid JSON is permanent and never fans out to a fallback supplier',async t=>{
 const {c,root,plan}=await setup(t);
 env(t,{CONTENT_IMAGE_OPENAI_API_KEY:'dummy',CONTENT_IMAGE_OPENAI_MODEL:'gpt-image-2',
  CONTENT_IMAGE_OPENAI_BASE_URL:'https://api.openai.com/v1/',
  CONTENT_IMAGE_QWEN_API_KEY:'dummy-qwen',CONTENT_IMAGE_QWEN_MODEL:'qwen-image-3.0',
  CONTENT_IMAGE_QWEN_BASE_URL:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/'});
 let calls=0;mock(t,async()=>{calls++;return new Response('not-json',{status:200,headers:{'content-type':'application/json'}})});
 const r=await req(c,`${root}/shots/${plan.shots[0].id}/generate`,'POST',{
  provider:'openai',fallbackProviders:['qwen'],maxAttempts:2,allowExternalAI:true
 });
 assert.equal(r.status,502);assert.equal(calls,1);
 assert.equal((await (await req(c,root+'/budget')).json()).used,1);
});

test('provider rate limit falls back once, consuming V38 budget for every actual attempt',async t=>{
 const {c,root,plan}=await setup(t);
 env(t,{CONTENT_IMAGE_OPENAI_API_KEY:'dummy',CONTENT_IMAGE_OPENAI_MODEL:'gpt-image-2',
  CONTENT_IMAGE_OPENAI_BASE_URL:'https://api.openai.com/v1/',
  CONTENT_IMAGE_GEMINI_API_KEY:'dummy-gemini',CONTENT_IMAGE_GEMINI_MODEL:'gemini-nano-banana-2.1',
  CONTENT_IMAGE_GEMINI_BASE_URL:'https://generativelanguage.googleapis.com/v1beta/'});
 const urls=[];
 mock(t,async(url,options)=>{
  urls.push(String(url));
  if(urls.length===1)return Response.json({error:'limit'},{status:429});
  assert.match(String(url),/generateContent/);
  assert.equal(JSON.parse(options.body).generationConfig.imageConfig.aspectRatio,'16:9');
  return Response.json({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:png}}]}}]});
 });
 const r=await req(c,`${root}/shots/${plan.shots[0].id}/generate`,'POST',{
  provider:'openai',fallbackProviders:['gemini'],maxAttempts:2,allowExternalAI:true
 });
 assert.equal(r.status,200);
 const shot=await r.json();assert.equal(shot.provider,'gemini');
 assert.equal(urls.length,2);
 const budget=await (await req(c,root+'/budget')).json();
 assert.equal(budget.used,2);
});

test('Qwen rejects general Alibaba hosts and credential URLs, only retrieves known OSS style host',async t=>{
 env(t,{CONTENT_IMAGE_QWEN_API_KEY:'dummy',CONTENT_IMAGE_QWEN_MODEL:'qwen-image-3.0',
  CONTENT_IMAGE_QWEN_BASE_URL:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/'});
 let calls=0;let result='https://general-service.aliyuncs.com/a.png';
 mock(t,async(url,options)=>{
  calls++;
  if(options.method==='POST')return Response.json({data:[{url:result}]});
  assert.equal(options.redirect,'error');
  return new Response(Buffer.from(png,'base64'),{headers:{'content-type':'image/png'}});
 });
 await assert.rejects(()=>generateProviderImage('Valid technical illustration',{provider:'qwen'}),/trusted Alibaba OSS/);
 assert.equal(calls,1);
 result='https://user:pass@dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/x.png';
 await assert.rejects(()=>generateProviderImage('Valid technical illustration',{provider:'qwen'}),/trusted Alibaba OSS/);
 assert.equal(calls,2);
 result='https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/x.png?Expires=123';
 const received=await generateProviderImage('Valid technical illustration',{provider:'qwen'});
 assert.equal(received.base64,png);assert.equal(calls,4);
});

test('manual platform QA is only an author report, anchored to exact source/layout/image proposal',async t=>{
 const {c,p,root,plan}=await setup(t);
 const qroot=root+'/handoff-qa/wechat';
 let view=await (await req(c,qroot)).json();
 assert.equal(view.readyForManualQA,false);
 assert.ok(view.pendingApproval.length);
 const checks={rightsReviewed:true,uploadConfirmed:true,desktopPasteConfirmed:true,mobilePreviewConfirmed:true};
 assert.equal((await req(c,qroot,'POST',{...view,expectedSourceRevision:view.sourceRevision,expectedLayoutRevision:view.layoutRevision,expectedProposalSha256:view.proposalSha256,checks,note:'我已经在微信后台检查粘贴与图片展示。'})).status,409);
 c.illustrations.generator=async()=>({base64:png,provider:'openai',model:'test'});
 for(const shot of plan.shots){
  const generated=await req(c,`${root}/shots/${shot.id}/generate`,'POST',{allowExternalAI:true});assert.equal(generated.status,200);
  const info=await generated.json();
  assert.equal((await req(c,`${root}/shots/${shot.id}/decision`,'POST',{decision:'approve'})).status,200);
  assert.equal((await req(c,`/api/assets/${info.assetId}/mappings/wechat`,'PUT',
   {url:'https://cdn.example.org/manually-uploaded.png',note:'人工上传图片到微信公众号图片库'})).status,200);
 }
 view=await (await req(c,qroot)).json();
 assert.equal(view.readyForManualQA,true);
 assert.equal(view.latest,null);
 const body={expectedSourceRevision:view.sourceRevision,expectedLayoutRevision:view.layoutRevision,
  expectedProposalSha256:view.proposalSha256,checks,note:'作者于测试环境人工核对微信公众号桌面端与手机端图片显示。'};
 const recorded=await req(c,qroot,'POST',body);
 assert.equal(recorded.status,201);
 const after=await recorded.json();
 assert.equal(after.latest.result,'passed');
 assert.equal(after.latestCurrent,true);
 assert.equal(after.latest.platformVerifiedAutomatically,false);
 assert.equal((await (await req(c,qroot+'/history')).json()).history.length,1);
 // A channel mapping change must invalidate the previous QA snapshot.
 const assetId=(await (await req(c,root)).json()).shots[0].assetId;
 await req(c,`/api/assets/${assetId}/mappings/wechat`,'PUT',
  {url:'https://cdn.example.org/re-uploaded-new.png',note:'作者将微信图片迁移到新的素材库地址'});
 const stale=await (await req(c,qroot)).json();
 assert.equal(stale.latestCurrent,false);
 assert.equal((await req(c,qroot,'POST',body)).status,409);
 const checked=await (await req(c,root+'/handoff-qa/zhihu')).json();
 assert.equal(checked.readyForManualQA,false,'WeChat QA does not certify Zhihu');
});

test('failed manual QA can be recorded with explicit false checks but is never platform-certified',async t=>{
 const {c,root}=await setup(t);
 const before=await (await req(c,root+'/handoff-qa/wechat')).json();
 assert.equal(before.proposalSha256.length,64);
 const reported=await req(c,root+'/handoff-qa/wechat','POST',{
  expectedSourceRevision:before.sourceRevision,expectedLayoutRevision:before.layoutRevision,
  expectedProposalSha256:before.proposalSha256,
  checks:{rightsReviewed:false,uploadConfirmed:false,desktopPasteConfirmed:false,mobilePreviewConfirmed:false},
  note:'平台图片未完成上传，无法在手机微信中进行可靠的显示验证。'
 });
 assert.equal(reported.status,201);
 assert.equal((await reported.json()).latest.result,'failed');
 assert.equal((await (await req(c,root+'/handoff-qa/wechat')).json()).latestCurrent,false);
});

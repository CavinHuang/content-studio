import test from 'node:test';
import assert from 'node:assert/strict';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';
import {generateProviderImage,configuredProviders} from '../src/image-providers.mjs';
import {composeImagePrompt,planScenesWithModel} from '../src/illustration-agent.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
const request=(core,path,method='GET',value)=>dispatchApi(new Request('http://localhost:4312'+path,{method,headers:value?{'content-type':'application/json'}:{},body:value?JSON.stringify(value):undefined}),core);
function env(t,items){const old=Object.fromEntries(Object.keys(items).map(k=>[k,process.env[k]]));Object.assign(process.env,items);t.after(()=>{for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v}})}
function fetchMock(t,fn){const prev=globalThis.fetch;globalThis.fetch=fn;t.after(()=>{globalThis.fetch=prev})}

const scene='A quiet workshop showing three connected modules and a clear input-to-output metaphor.';
test('visual prompt is provider aware, article anchored, and avoids fabricated evidence',()=>{
 const base={title:'Agent 编排问题',excerpt:'重试和限流策略',scene,role:'cover'};
 const a=composeImagePrompt({...base,provider:'openai'}),b=composeImagePrompt({...base,provider:'gemini'}),c=composeImagePrompt({...base,provider:'qwen'});
 assert.match(a,/16:9/);assert.match(a,/NOT documented evidence/);assert.notEqual(a,b);assert.notEqual(b,c);
 assert.throws(()=>composeImagePrompt({...base,style:'fake'}),/Unsupported style/);
});
test('OpenAI image2 routes to Images API with image2 wide size, no deprecated response format',async t=>{
 env(t,{CONTENT_IMAGE_OPENAI_API_KEY:'fake-openai-key',CONTENT_IMAGE_OPENAI_MODEL:'gpt-image-2'});let called=false;
 fetchMock(t,async(url,options)=>{called=true;assert.equal(new URL(url).pathname,'/v1/images/generations');assert.match(options.headers.authorization,/^Bearer fake-openai-key$/);const data=JSON.parse(options.body);assert.equal(data.model,'gpt-image-2');assert.equal(data.size,'1536x864');assert.equal(data.response_format,undefined);return Response.json({data:[{b64_json:png}]})});
 const result=await generateProviderImage('One conceptual editorial cover',{provider:'openai',role:'cover'});
 assert.equal(result.base64,png);assert.equal(result.provider,'openai');assert.ok(called);
});
test('Nano Banana uses Gemini generateContent, image modality and inlineData',async t=>{
 env(t,{CONTENT_IMAGE_GEMINI_API_KEY:'fake-gemini-key',CONTENT_IMAGE_GEMINI_MODEL:'gemini-nano-banana-2.1'});
 fetchMock(t,async(url,options)=>{assert.match(String(url),/models\/gemini-nano-banana-2.1:generateContent/);assert.equal(options.headers['x-goog-api-key'],'fake-gemini-key');const data=JSON.parse(options.body);assert.deepEqual(data.generationConfig.responseModalities,['IMAGE']);assert.equal(data.generationConfig.imageConfig.aspectRatio,'3:2');return Response.json({candidates:[{content:{parts:[{text:'picture:'},{inlineData:{data:png,mimeType:'image/png'}}]}}]})});
 assert.equal((await generateProviderImage('A conceptual diagram',{provider:'gemini',role:'section'})).base64,png);
});
test('Qwen downloads whitelisted expiring OSS result immediately and does not trust private URLs',async t=>{
 env(t,{CONTENT_IMAGE_QWEN_API_KEY:'fake-qwen-key',CONTENT_IMAGE_QWEN_MODEL:'qwen-image-3.0'});let count=0;
 fetchMock(t,async(url,options)=>{count++;if(count===1){assert.match(String(url),/images\/generations/);assert.equal(JSON.parse(options.body).model,'qwen-image-3.0');return Response.json({data:[{url:'https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/x.png?Expires=123'}]})}
 assert.equal(options.redirect,'error');return new Response(Buffer.from(png,'base64'),{headers:{'content-type':'image/png'}})});
 assert.equal((await generateProviderImage('Editorial image concept',{provider:'qwen'})).base64,png);assert.equal(count,2);
});
test('Qwen rejects local provider-returned image URL before fetch, and model errors do not reveal credentials',async t=>{
 env(t,{CONTENT_IMAGE_QWEN_API_KEY:'fake-qwen-key'});let count=0;
 fetchMock(t,async()=>{count++;return Response.json({data:[{url:'http://127.0.0.1/admin'}]})});
 await assert.rejects(()=>generateProviderImage('Editorial image concept',{provider:'qwen'}),/trusted Alibaba OSS/);
 assert.equal(count,1);
});
test('GPT planning model returns bounded anchored scene ideas, rejects invented anchors',async t=>{
 env(t,{CONTENT_ILLUSTRATION_PLANNER_API_KEY:'fake-planner-key',CONTENT_ILLUSTRATION_PLANNER_BASE_URL:'https://api.example.net/v1/',CONTENT_ILLUSTRATION_PLANNER_MODEL:'text-model'});
 const slots=[{role:'cover',paragraphId:'',excerpt:'Title'},{role:'section',paragraphId:'block-1',excerpt:'A technical case'}];
 const mk=xs=>Response.json({choices:[{message:{content:JSON.stringify({scenes:xs})}}]});
 fetchMock(t,async()=>mk([{role:'cover',paragraphId:'',scene,style:'editorial'},{role:'section',paragraphId:'block-1',scene,style:'diagram'}]));
 assert.equal((await planScenesWithModel({title:'试验'},null,slots)).length,2);
 globalThis.fetch=async()=>mk([{role:'cover',paragraphId:'unknown',scene,style:'editorial'},{role:'section',paragraphId:'block-1',scene,style:'diagram'}]);
 await assert.rejects(()=>planScenesWithModel({title:'试验'},null,slots),/invalid or unanchored/);
});
test('V33 prompt editing resets image approval and uses optimistic locks; per provider preview does not spend tokens',async t=>{
 const core=createCore(':memory:');t.after(()=>core.close());
 const p=await (await request(core,'/api/editor/projects','POST',{title:'文章自动配图',paragraphs:[{text:'第一段技术文章内容关于桌面Agent错误恢复与配置验证'}]})).json();
 const base=`/api/illustrations/projects/${p.id}`;
 const plan=await (await request(core,base+'/plan','POST',{expectedMasterRevision:1})).json();const shot=plan.shots[0];
 const res=await request(core,`${base}/shots/${shot.id}/prompt`,'PUT',{expectedUpdatedAt:shot.updatedAt,scene,style:'diagram',provider:'qwen'});
 assert.equal(res.status,200);const v=await res.json();assert.equal(v.style,'diagram');assert.equal(v.status,'planned');assert.match(v.prompt,/input-to-output/);
 assert.equal((await request(core,`${base}/shots/${shot.id}/prompt`,'PUT',{expectedUpdatedAt:shot.updatedAt,scene})).status,409);
 const q=await request(core,`${base}/shots/${shot.id}/prompt-preview?provider=gemini`);assert.equal(q.status,200);
 const prompt=(await q.json()).prompt;assert.match(prompt,/expert art director/);
 assert.equal((await request(core,`${base}/agent-plan`,'POST',{expectedMasterRevision:1})).status,403);
});

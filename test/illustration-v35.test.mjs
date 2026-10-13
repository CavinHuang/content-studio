import test from 'node:test';
import assert from 'node:assert/strict';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';
import {editProviderImage} from '../src/image-providers.mjs';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
const pngBytes=Buffer.from(png,'base64');
const changed=Buffer.concat([pngBytes,Buffer.from([9,10,11])]).toString('base64');
const api=(core,path,method='GET',body)=>dispatchApi(new Request('http://localhost:4312'+path,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined}),core);
async function init(t){const c=createCore(':memory:');t.after(()=>c.close());const p=await (await api(c,'/api/editor/projects','POST',{title:'技术架构配图',paragraphs:[{text:'描述技术模块间的信号传输和不断重试形成的路径，供作者编写专业内容'}]})).json();const root=`/api/illustrations/projects/${p.id}`;const plan=await (await api(c,root+'/plan','POST',{expectedMasterRevision:1})).json();const shot=plan.shots[0];c.illustrations.generator=async()=>({base64:png,provider:'openai',model:'fake-original'});await api(c,`${root}/shots/${shot.id}/generate`,'POST',{allowExternalAI:true});const original=await (await api(c,`${root}/shots/${shot.id}/decision`,'POST',{decision:'approve'})).json();return {c,p,root,shot:original};}
const edit=(x,instruction='Keep the subject but change the background to ivory.',options={})=>api(x.c,`${x.root}/shots/${x.shot.id}/candidates`,'POST',{allowExternalAI:true,expectedUpdatedAt:x.shot.updatedAt,referenceAssetId:x.shot.assetId,instruction,provider:'openai',...options});

test('reference edit enforces per-call consent, source scope, and instruction constraints',async t=>{
 const x=await init(t);x.c.illustrations.editor=async()=>({base64:changed,provider:'openai',model:'fake-edit'});
 assert.equal((await edit(x,undefined,{allowExternalAI:false})).status,403);
 assert.equal((await edit(x,'Too short')).status,400);
 assert.equal((await edit(x,undefined,{referenceAssetId:'as_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'})).status,403);
 assert.equal((await edit(x,undefined,{provider:'unknown'})).status,400);
 assert.equal((await edit(x,undefined,{expectedUpdatedAt:'wrong'})).status,409);
 const other=await init(t);assert.equal((await edit(x,undefined,{referenceAssetId:other.shot.assetId})).status,201); // content-addressed same image is already in own slot
});

test('new candidate is not promoted automatically, preserves approvals and is compared to current image',async t=>{
 const x=await init(t);x.c.illustrations.editor=async(prompt,options)=>{assert.match(prompt,/background to ivory/);assert.equal(options.referenceMime,'image/png');assert.equal(Buffer.from(options.referenceBytes).length,pngBytes.length);return {base64:changed,model:'mock-edit',provider:'openai'}};
 const response=await edit(x);assert.equal(response.status,201);const data=await response.json();assert.equal(data.shot.status,'approved');assert.equal(data.shot.assetId,x.shot.assetId);assert.equal(data.candidate.status,'generated');assert.notEqual(data.candidate.assetId,x.shot.assetId);
 const reload=await (await api(x.c,x.root)).json();assert.equal(reload.shots[0].candidates.length,1);assert.equal(reload.shots[0].editAttempts.length,1);
 const choose=await api(x.c,`${x.root}/shots/${x.shot.id}/candidates/${data.candidate.id}/decision`,'POST',{decision:'select',expectedUpdatedAt:x.shot.updatedAt});assert.equal(choose.status,200);const selected=await choose.json();assert.equal(selected.assetId,data.candidate.assetId);assert.equal(selected.status,'generated');assert.equal(selected.review,null);assert.equal(selected.candidates[0].status,'selected');
 assert.equal((await api(x.c,`${x.root}/shots/${x.shot.id}/decision`,'POST',{decision:'approve'})).status,200);
 assert.equal((await api(x.c,`${x.root}/shots/${x.shot.id}/candidates/${data.candidate.id}/decision`,'POST',{decision:'select',expectedUpdatedAt:selected.updatedAt})).status,409);
});

test('rejecting a candidate is independent from rejecting official image; rejected candidates cannot be chosen',async t=>{
 const x=await init(t);x.c.illustrations.editor=async()=>({base64:changed,provider:'openai',model:'m'});
 const v=await (await edit(x)).json();const url=`${x.root}/shots/${x.shot.id}/candidates/${v.candidate.id}/decision`;
 assert.equal((await api(x.c,url,'POST',{decision:'reject',expectedUpdatedAt:x.shot.updatedAt})).status,200);
 assert.equal((await api(x.c,url,'POST',{decision:'select',expectedUpdatedAt:x.shot.updatedAt})).status,409);
 const after=await (await api(x.c,x.root)).json();assert.equal(after.shots[0].status,'approved');assert.equal(after.shots[0].assetId,x.shot.assetId);
});

test('failed edit is audited; no candidate or approval is changed',async t=>{
 const x=await init(t);x.c.illustrations.editor=async()=>{throw Object.assign(new Error('model throttled'),{status:429})};
 assert.equal((await edit(x)).status,429);const state=await (await api(x.c,x.root)).json();assert.equal(state.shots[0].candidates.length,0);assert.equal(state.shots[0].editAttempts[0].result,'failed');assert.equal(state.shots[0].status,'approved');
});

test('reference editing rejects cross-slot asset and old article revisions',async t=>{
 const x=await init(t);x.c.illustrations.editor=async()=>({base64:changed,provider:'openai',model:'m'});
 const additional=x.c.assets.upload({base64:changed,alt:'independent'});
 assert.equal((await edit(x,undefined,{referenceAssetId:additional.id})).status,403);
 const project=x.c.editorial.get(x.p.id),doc=project.channels.master.document;
 const updated=await api(x.c,`/api/editor/projects/${x.p.id}/master/document`,'PUT',{expectedRevision:doc.revision,paragraphs:[...doc.paragraphs.map(p=>({id:p.id,text:p.text+' changed'}))]});assert.equal(updated.status,200);
 assert.equal((await edit(x)).status,409);
});

test('visual identity revision invalidates candidate promotion even if candidate exists',async t=>{
 const x=await init(t);x.c.illustrations.editor=async()=>({base64:changed,provider:'openai',model:'m'});
 const v=await (await edit(x)).json();const profile={name:'Brand',palette:'green and gray',mood:'calm',avoid:'logo and data'};
 assert.equal((await api(x.c,x.root+'/visual-profile','PUT',{expectedRevision:0,profile})).status,200);
 const now=await (await api(x.c,x.root)).json();assert.equal((await api(x.c,`${x.root}/shots/${x.shot.id}/candidates/${v.candidate.id}/decision`,'POST',{decision:'select',expectedUpdatedAt:now.shots[0].updatedAt})).status,409);
 assert.equal(now.shots[0].assetId,null);
});

test('simultaneous edits on the same slot are rejected; baseline stays in place until selection',async t=>{
 const x=await init(t);let release;const gate=new Promise(r=>release=r);let started;const began=new Promise(r=>started=r);
 x.c.illustrations.editor=async()=>{started();await gate;return {base64:changed,provider:'openai',model:'m'}};
 const pending=edit(x);await began;
 assert.equal((await edit(x)).status,409);release();assert.equal((await pending).status,201);
 assert.equal((await (await api(x.c,x.root)).json()).shots[0].status,'approved');
});

function environment(t,vars){const before=Object.fromEntries(Object.keys(vars).map(k=>[k,process.env[k]]));Object.assign(process.env,vars);t.after(()=>{for(const [k,v] of Object.entries(before))if(v===undefined)delete process.env[k];else process.env[k]=v})}
function mockedFetch(t,fn){const original=globalThis.fetch;globalThis.fetch=fn;t.after(()=>globalThis.fetch=original)}

test('OpenAI edit uses multipart /images/edits with private reference bytes and no legacy response_format',async t=>{
 environment(t,{CONTENT_IMAGE_OPENAI_API_KEY:'not-public',CONTENT_IMAGE_OPENAI_MODEL:'gpt-image-2'});
 mockedFetch(t,async(url,options)=>{assert.match(url.toString(),/images\/edits$/);assert.equal(options.headers.authorization,'Bearer not-public');assert.ok(options.body instanceof FormData);assert.equal(options.body.get('model'),'gpt-image-2');assert.equal(options.body.get('response_format'),null);assert.equal(options.body.get('image').type,'image/png');return Response.json({data:[{b64_json:changed}]});});
 const result=await editProviderImage('Keep the central subject, soften the background and remove any small decorative marks.',{provider:'openai',referenceBytes:pngBytes,referenceMime:'image/png'});assert.equal(result.provider,'openai');
});

test('Gemini edit supplies inline image bytes and Qwen uses generations.image, never OpenAI edits path',async t=>{
 environment(t,{CONTENT_IMAGE_GEMINI_API_KEY:'gem-private',CONTENT_IMAGE_GEMINI_MODEL:'test-gemini',CONTENT_IMAGE_QWEN_API_KEY:'qwen-private',CONTENT_IMAGE_QWEN_MODEL:'qwen-image-3.0'});
 mockedFetch(t,async(url,options)=>{
  const body=JSON.parse(options.body);
  if(String(url).includes('generateContent')){assert.equal(options.headers['x-goog-api-key'],'gem-private');assert.equal(body.contents[0].parts[1].inlineData.data,png);return Response.json({candidates:[{content:{parts:[{inlineData:{data:changed,mimeType:'image/png'}}]}}]});}
  assert.match(String(url),/images\/generations$/);assert.match(body.image,/^data:image\/png;base64,/);assert.equal(body.model,'qwen-image-3.0');return Response.json({data:[{b64_json:changed}]});
 });
 const options={referenceBytes:pngBytes,referenceMime:'image/png'};
 assert.equal((await editProviderImage('Adjust background, preserve structure and do not introduce additional facts.',{...options,provider:'gemini'})).provider,'gemini');
 assert.equal((await editProviderImage('Adjust background, preserve structure and do not introduce additional facts.',{...options,provider:'qwen'})).provider,'qwen');
});

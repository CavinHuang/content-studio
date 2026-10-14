import test from 'node:test';
import assert from 'node:assert/strict';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';
import {composeImagePrompt} from '../src/illustration-agent.mjs';
import {visionReviewImage,validateVisualProfile} from '../src/visual-quality.mjs';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
const req=(c,path,method='GET',value)=>dispatchApi(new Request('http://localhost:4312'+path,{method,headers:value?{'content-type':'application/json'}:{},body:value?JSON.stringify(value):undefined}),c);
async function setup(t){const c=createCore(':memory:');t.after(()=>c.close());const p=await (await req(c,'/api/editor/projects','POST',{title:'技术文章配图风格控制',paragraphs:[{text:'本文讲解Agent在反复执行工具时可能产生的错误以及重试策略的局限。'}]})).json();const root=`/api/illustrations/projects/${p.id}`;return {c,p,root};}
const profile={name:'V34 品牌标准',palette:'ivory, charcoal, muted teal',mood:'flat, calm, spacious',avoid:'fake screenshots, random labels'};
function env(t,values){const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);t.after(()=>{for(const [k,v] of Object.entries(old))v===undefined?delete process.env[k]:process.env[k]=v;});}
function fetchMock(t,fn){const old=globalThis.fetch;globalThis.fetch=fn;t.after(()=>globalThis.fetch=old);}

test('visual profile is bounded, revisioned, scoped to article, and reflected in all prompts',async t=>{
 const {c,root}=await setup(t);const p2=await (await req(c,'/api/editor/projects','POST',{title:'另一篇文章',paragraphs:[{text:'另一篇文章的段落和内容可能与本篇不同'}]})).json();
 const before=await (await req(c,root)).json();assert.equal(before.visualProfile.revision,0);
 const plan=await (await req(c,root+'/plan','POST',{expectedMasterRevision:1})).json();assert.equal(plan.shots.length,2);
 const saved=await req(c,root+'/visual-profile','PUT',{expectedRevision:0,profile});assert.equal(saved.status,200);
 const got=await saved.json();assert.equal(got.visualProfile.revision,1);assert.equal(got.shots[0].status,'planned');assert.match(got.shots[0].prompt,/muted teal/);
 assert.equal((await req(c,root+'/visual-profile','PUT',{expectedRevision:0,profile})).status,409);
 assert.equal((await req(c,root+'/visual-profile','PUT',{expectedRevision:1,profile:{...profile,palette:''}})).status,400);
 assert.equal((await (await req(c,`/api/illustrations/projects/${p2.id}`)).json()).visualProfile.revision,0);
 assert.match(composeImagePrompt({title:'test',visualProfile:profile}),/V34 品牌标准/);
 assert.throws(()=>validateVisualProfile({...profile,name:'x'.repeat(65)}),/Invalid visual profile/);
});

test('fallback attempts are explicit, bounded, audited and do not transfer manual approval',async t=>{
 const {c,root}=await setup(t);const plan=await (await req(c,root+'/plan','POST',{expectedMasterRevision:1})).json(),shot=plan.shots[0];
 let providers=[];c.illustrations.generator=async(prompt,{provider})=>{providers.push(provider);if(provider==='openai')throw Object.assign(new Error('temporary 429'),{status:429});return {base64:png,model:'mock-success',provider}};
 assert.equal((await req(c,`${root}/shots/${shot.id}/generate`,'POST',{allowExternalAI:true,provider:'openai',fallbackProviders:['qwen'],maxAttempts:0})).status,400);
 assert.equal((await req(c,`${root}/shots/${shot.id}/generate`,'POST',{allowExternalAI:false,provider:'openai',fallbackProviders:['qwen'],maxAttempts:2})).status,403);
 const generated=await (await req(c,`${root}/shots/${shot.id}/generate`,'POST',{allowExternalAI:true,provider:'openai',fallbackProviders:['qwen'],maxAttempts:2})).json();
 assert.deepEqual(providers,['openai','qwen']);assert.equal(generated.provider,'qwen');assert.equal(generated.status,'generated');assert.equal(generated.attempts.length,2);
 assert.deepEqual(generated.attempts.map(x=>x.result),['failed','success']);assert.equal(generated.review.kind,'local');assert.equal(generated.review.status,'needs_human_review');
 assert.equal((await req(c,root+'/handoff/wechat')).status,200);
});

test('permanent image errors are not retried even with fallback enabled',async t=>{
 const {c,root}=await setup(t);const plan=await (await req(c,root+'/plan','POST',{expectedMasterRevision:1})).json();let count=0;
 c.illustrations.generator=async()=>{count++;throw Object.assign(new Error('Policy rejected request'),{status:400})};
 const fail=await req(c,`${root}/shots/${plan.shots[0].id}/generate`,'POST',{allowExternalAI:true,provider:'openai',fallbackProviders:['gemini'],maxAttempts:2});
 assert.equal(fail.status,400);assert.equal(count,1);
 const got=await (await req(c,root)).json();assert.equal(got.shots[0].status,'failed');assert.equal(got.shots[0].attempts.length,1);
});

test('changing the visual identity invalidates old author approval without modifying old assets',async t=>{
 const {c,root}=await setup(t);const plan=await (await req(c,root+'/plan','POST',{expectedMasterRevision:1})).json(),shot=plan.shots[0];c.illustrations.generator=async()=>({base64:png,model:'test'});
 const old=await (await req(c,`${root}/shots/${shot.id}/generate`,'POST',{allowExternalAI:true})).json();assert.equal((await req(c,`${root}/shots/${shot.id}/decision`,'POST',{decision:'approve'})).status,200);
 const changed=await (await req(c,root+'/visual-profile','PUT',{expectedRevision:0,profile})).json();
 assert.equal(changed.shots[0].status,'planned');assert.equal(changed.shots[0].assetId,null);assert.ok(changed.shots[0].attempts.length===1);assert.ok(c.assets.get(old.assetId));
 assert.equal((await req(c,`${root}/shots/${shot.id}/decision`,'POST',{decision:'approve'})).status,409);
});

test('vision review requires explicit consent and supports only bounded advisory JSON; never auto approves',async t=>{
 const {c,root}=await setup(t);const plan=await (await req(c,root+'/plan','POST',{expectedMasterRevision:1})).json(),shot=plan.shots[0];c.illustrations.generator=async()=>({base64:png,model:'test'});
 await req(c,`${root}/shots/${shot.id}/generate`,'POST',{allowExternalAI:true});
 assert.equal((await req(c,`${root}/shots/${shot.id}/review`,'POST',{allowExternalAI:false})).status,403);
 assert.equal((await req(c,`${root}/shots/${shot.id}/review`,'POST',{allowExternalAI:true})).status,503);
 env(t,{CONTENT_IMAGE_REVIEW_BASE_URL:'https://vision.example.net/v1/',CONTENT_IMAGE_REVIEW_MODEL:'vision-test',CONTENT_IMAGE_REVIEW_API_KEY:'private-test'});
 fetchMock(t,async(url,options)=>{const body=JSON.parse(options.body);assert.match(body.messages[1].content[1].image_url.url,/^data:image\/png;base64,/);assert.equal(options.headers.authorization,'Bearer private-test');return Response.json({choices:[{message:{content:JSON.stringify({verdict:'needs_revision',reason:'Visual design needs revision',issues:['Too crowded']})}}]})});
 const reviewed=await (await req(c,`${root}/shots/${shot.id}/review`,'POST',{allowExternalAI:true})).json();assert.equal(reviewed.review.verdict,'needs_revision');assert.equal(reviewed.review.advisoryOnly,true);assert.equal(reviewed.status,'generated');
 assert.equal(reviewed.attempts.length,1);assert.doesNotMatch(JSON.stringify(reviewed),/private-test/);
});

test('vision reviewer rejects untrusted malformed output',async t=>{
 env(t,{CONTENT_IMAGE_REVIEW_BASE_URL:'https://vision.example.net/v1/',CONTENT_IMAGE_REVIEW_MODEL:'vision-test',CONTENT_IMAGE_REVIEW_API_KEY:'private-test'});
 fetchMock(t,async()=>Response.json({choices:[{message:{content:'{"verdict":"automatic_approval","reason":"Looks nice","issues":[]}'}}]}));
 await assert.rejects(()=>visionReviewImage({asset:{mime:'image/png'},body:Buffer.from(png,'base64'),prompt:'hello',profile}),/invalid assessment/);
});

test('saved visual identity can be reused across articles without silently changing other projects',async t=>{
 const {c,root,p}=await setup(t);
 assert.equal((await req(c,'/api/illustrations/visual-profiles')).status,200);
 await req(c,root+'/visual-profile','PUT',{expectedRevision:0,profile});
 const list=await (await req(c,'/api/illustrations/visual-profiles')).json();assert.equal(list.profiles.length,1);assert.equal(list.profiles[0].projectId,p.id);
 const other=await (await req(c,'/api/editor/projects','POST',{title:'共享风格的另一篇文章',paragraphs:[{text:'研究同一个领域中各项技术工具的性能与边界条件'}]})).json();
 const target=`/api/illustrations/projects/${other.id}`;
 const copy=await req(c,target+'/visual-profile','PUT',{expectedRevision:0,profile:{name:list.profiles[0].name,palette:list.profiles[0].palette,mood:list.profiles[0].mood,avoid:list.profiles[0].avoid}});
 assert.equal(copy.status,200);assert.equal((await copy.json()).visualProfile.revision,1);
 assert.equal((await (await req(c,root)).json()).visualProfile.revision,1);
});

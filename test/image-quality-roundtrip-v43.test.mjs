import test from 'node:test';
import assert from 'node:assert/strict';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';
import {markdownImageTokens} from '../src/image-roundtrip-reconciliation.mjs';

const call=(core,path,method='GET',data)=>dispatchApi(new Request('http://localhost:4312'+path,{
 method,headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined
}),core);
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
const ratings={briefFit:4,clarity:5,mobileReadability:4,styleConsistency:4};
async function setup(t){
 const core=createCore(':memory:');t.after(()=>core.close());
 const created=await call(core,'/api/editor/projects','POST',{title:'导回配图证据回归',paragraphs:[
  {text:'第一段：研究配图与文章段落的关联是否准确，并检查摘要不应出现错误。'},
  {text:'第二段：实际模型生成的图片必须由作者先审查版权和事实准确性。'},
  {text:'第三段：从外部排版器导回 Markdown 时，还需逐张检查插图是否仍然完整。'}
 ]});
 assert.equal(created.status,201);const article=await created.json();
 const root='/api/illustrations/projects/'+article.id;
 const plan=await call(core,root+'/plan','POST',{expectedMasterRevision:1});
 assert.equal(plan.status,201);
 core.illustrations.generator=async(_prompt,{provider})=>({base64:png,provider,model:'test-model'});
 return {core,article,root,plan:await plan.json()};
}
async function generate(core,root,shot,provider='openai'){
 const r=await call(core,root+'/shots/'+shot.id+'/generate','POST',{allowExternalAI:true,provider});
 assert.equal(r.status,200);
 return r.json();
}
async function approveAndMap(core,root,plan,channel='wechat'){
 for(let index=0;index<plan.shots.length;index++){
  const shot=plan.shots[index];
  const image=await generate(core,root,shot);
  assert.equal((await call(core,root+'/shots/'+shot.id+'/decision','POST',{decision:'approve'})).status,200);
  assert.equal((await call(core,'/api/assets/'+image.assetId+'/mappings/'+channel,'PUT',{
   url:'https://cdn.example.org/quality-asset-'+index+'.png',
   note:'作者在目标平台手工上传素材并登记该地址'
  })).status,200);
 }
}
test('image quality reviews require versioned asset, explicit rubric, human evidence and no auto-approval',async t=>{
 const {core,article,root,plan}=await setup(t),shot=plan.shots[0];
 const result=await generate(core,root,shot);
 const qualityPath=root+'/shots/'+shot.id+'/quality-reviews';
 let view=await (await call(core,qualityPath)).json();
 assert.equal(view.items.length,1);
 assert.equal(view.items[0].assetId,result.assetId);
 assert.equal(view.items[0].latest,null);
 const state=await (await call(core,root)).json();
 const current=state.shots[0],asset=current.asset;
 const body={assetId:current.assetId,expectedAssetSha256:asset.sha256,expectedShotUpdatedAt:current.updatedAt,
  expectedSourceRevision:state.sourceRevision,expectedProfileRevision:state.visualProfile.revision,
  ratings,rightsReviewed:true,factualReviewed:true,riskFlags:[],recommendation:'recommended',
  note:'已人工核查概念插画与文字内容基本一致，图片可读性良好。'};
 assert.equal((await call(core,qualityPath,'POST',{...body,ratings:{...ratings,clarity:6}})).status,400);
 assert.equal((await call(core,qualityPath,'POST',{...body,rightsReviewed:false})).status,409);
 assert.equal((await call(core,qualityPath,'POST',{...body,expectedAssetSha256:'old-hash'})).status,409);
 assert.equal((await call(core,qualityPath,'POST',body)).status,201);
 view=await (await call(core,qualityPath)).json();
 assert.equal(view.reviews.length,1);
 assert.equal(view.items[0].latestCurrent,true);
 assert.equal(view.reviews[0].modelReviewed,false);
 assert.equal(view.reviews[0].approvalChanged,false);
 assert.equal(view.byProvider[0].reviewCount,1);
 assert.equal(view.comparisonsControlled,false);
 assert.equal((await (await call(core,root)).json()).shots[0].status,'generated');
 const budget=(await (await call(core,root+'/budget')).json()).used;
 await call(core,qualityPath);assert.equal((await (await call(core,root+'/budget')).json()).used,budget);
 assert.equal((await call(core,root+'/shots/'+shot.id+'/decision','POST',{decision:'approve'})).status,200);
 assert.equal((await (await call(core,qualityPath)).json()).items[0].latestCurrent,false);
 const other=await (await call(core,'/api/editor/projects','POST',{title:'另一篇不同文章'})).json();
 assert.equal((await call(core,'/api/illustrations/projects/'+other.id+'/shots/'+shot.id+'/quality-reviews')).status,404);
 assert.equal(view.projectId,article.id);
});
test('quality feedback can record concerns but may not silently give a positive recommendation',async t=>{
 const {core,root,plan}=await setup(t);const shot=plan.shots[0];await generate(core,root,shot);
 const state=await (await call(core,root)).json();
 const body={assetId:state.shots[0].assetId,expectedAssetSha256:state.shots[0].asset.sha256,
  expectedShotUpdatedAt:state.shots[0].updatedAt,expectedSourceRevision:state.sourceRevision,
  expectedProfileRevision:state.visualProfile.revision,ratings:{briefFit:1,clarity:2,mobileReadability:2,styleConsistency:3},
  riskFlags:['fabricated_ui','text_errors'],rightsReviewed:false,factualReviewed:false,
  recommendation:'revise',note:'模型画面存在疑似虚构的产品界面，部分文字也无法准确辨认。'};
 const path=root+'/shots/'+shot.id+'/quality-reviews';
 assert.equal((await call(core,path,'POST',body)).status,201);
 assert.equal((await call(core,path,'POST',{...body,recommendation:'recommended'})).status,409);
 assert.equal((await call(core,path,'POST',{...body,riskFlags:['fake_tag']})).status,400);
 const x=await (await call(core,path)).json();
 assert.deepEqual(x.reviews[0].riskFlags,['fabricated_ui','text_errors']);
 assert.equal(x.reviews.length,1);
});
test('extracting Markdown images ignores fenced and inline code and supports encoded parentheses',()=>{
 const markdown='# Title\n\n`![ignore](https://code.example/a.png)`\n\n```md\n![ignore](https://code.example/b.png)\n```\n\n![封面](https://cdn.example.org/img%28one%29.png)\n\n![章节](https://cdn.example.org/img(two).png)';
 const tokens=markdownImageTokens(markdown);
 assert.deepEqual(tokens.map(x=>x.url),['https://cdn.example.org/img(one).png','https://cdn.example.org/img(two).png']);
 assert.equal(tokens.length,2);
});
test('doocs imported Markdown consistency detects missing, duplicated, reordered and unknown images',async t=>{
 const {core,article,root,plan}=await setup(t);
 await approveAndMap(core,root,plan);
 let out=await (await call(core,root+'/image-roundtrip/wechat')).json();
 assert.equal(out.ready,false);
 assert.ok(out.issues.includes('no_imported_layout'));
 const proposed=await (await call(core,root+'/handoff/wechat')).json();
 assert.equal(proposed.inserted.length,plan.shots.length);
 const draft=(await (await call(core,'/api/composer/projects/'+article.id+'/wechat')).json());
 let preview=await call(core,root+'/image-roundtrip/wechat','POST',{markdown:proposed.markdown,
  expectedSourceRevision:1,expectedLayoutRevision:draft.layoutRevision});
 assert.equal(preview.status,200);
 preview=await preview.json();
 assert.equal(preview.matchedCount,plan.shots.length);
 assert.equal(preview.ready,true);
 assert.equal(preview.origin,'supplied-preview');
 const layoutReview=await (await call(core,'/api/composer/projects/'+article.id+'/wechat/review','POST',{
  expectedLayoutRevision:draft.layoutRevision,expectedDocumentRevision:draft.sourceDocumentRevision,markdown:proposed.markdown
 })).json();
 assert.ok(layoutReview.reviewToken);
 const saved=await call(core,'/api/composer/projects/'+article.id+'/wechat','PUT',{
  expectedLayoutRevision:draft.layoutRevision,expectedDocumentRevision:draft.sourceDocumentRevision,
  markdown:proposed.markdown,reviewToken:layoutReview.reviewToken,acknowledgeDrift:true
 });
 assert.equal(saved.status,200);
 out=await (await call(core,root+'/image-roundtrip/wechat')).json();
 assert.equal(out.ready,true);
 assert.equal(out.layoutRevision,1);
 assert.equal(out.documentHash,preview.documentHash);
 assert.equal(out.externalRequests,0);
 assert.equal(out.platformVerified,false);
 const expected=proposed.markdown;
 const first=expected.match(/!\[[^\]]*\]\([^\n]*?\)/)[0];
 const missing=await (await call(core,root+'/image-roundtrip/wechat','POST',{markdown:expected.replace(first,''),expectedSourceRevision:1,expectedLayoutRevision:1})).json();
 assert.equal(missing.ready,false);assert.ok(missing.issues.some(x=>x.startsWith('image_missing:')));
 const doubled=await (await call(core,root+'/image-roundtrip/wechat','POST',{markdown:expected+'\n\n'+first,expectedSourceRevision:1,expectedLayoutRevision:1})).json();
 assert.ok(doubled.issues.some(x=>x.startsWith('image_duplicate:')));
 const extra=await (await call(core,root+'/image-roundtrip/wechat','POST',{markdown:expected+'\n\n![new](https://bad.example.org/unreviewed.png)',expectedSourceRevision:1,expectedLayoutRevision:1})).json();
 assert.ok(extra.issues.some(x=>x.startsWith('unmapped_or_extra_image:')));
 const found=[...expected.matchAll(/!\[[^\]]*\]\([^\n]*?\)/g)];
 if(found.length>=2){
  const moved=expected.replace(found[0][0],'____IMAGE____').replace(found[1][0],found[0][0]).replace('____IMAGE____',found[1][0]);
  const reordered=await (await call(core,root+'/image-roundtrip/wechat','POST',{markdown:moved,expectedSourceRevision:1,expectedLayoutRevision:1})).json();
  assert.ok(reordered.issues.includes('image_order_changed'));
 }
 assert.equal((await call(core,root+'/image-roundtrip/wechat','POST',{markdown:expected,expectedSourceRevision:1,expectedLayoutRevision:0})).status,409);
 assert.equal((await call(core,root+'/image-roundtrip/zhihu')).status,200);
 const zhihu=(await (await call(core,root+'/image-roundtrip/zhihu')).json());
 assert.equal(zhihu.ready,false);
 assert.equal(zhihu.channel,'zhihu');
});

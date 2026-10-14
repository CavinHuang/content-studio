import test from 'node:test';
import assert from 'node:assert/strict';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';

const request=(c,path,method='GET',data)=>dispatchApi(new Request('http://localhost:4312'+path,{
 method,headers:data?{'content-type':'application/json'}:{},
 body:data?JSON.stringify(data):undefined
}),c);
const read=async response=>({...await response.json(),status:response.status});
const qualityRatings={briefFit:4,clarity:4,mobileReadability:4,styleConsistency:4};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
async function setup(t,paragraphs){
 const core=createCore(':memory:');t.after(()=>core.close());
 const created=await request(core,'/api/editor/projects','POST',{title:'统一交付验收回归项目',paragraphs:paragraphs||[
  {text:'本文描述实际观察到的工程实践，以及人工验证素材是否能够正确进入排版稿。'},
  {text:'附图必须在导回前被作者批准与标记使用权，不允许把模型生成的示意图当作证据。'}
 ]});
 assert.equal(created.status,201);
 const article=await created.json();
 const root='/api/delivery/projects/'+article.id+'/wechat';
 const illu='/api/illustrations/projects/'+article.id;
 return {core,article,root,illu};
}
async function importLayout(core,article,channel='wechat',markdown){
 const url='/api/composer/projects/'+article.id+'/'+channel;
 const draft=await read(await request(core,url));
 assert.equal(draft.status,200);
 const md=markdown??draft.markdown;
 const reviewed=await read(await request(core,url+'/review','POST',{
  expectedLayoutRevision:draft.layoutRevision,expectedDocumentRevision:draft.sourceDocumentRevision,markdown:md
 }));
 assert.equal(reviewed.status,200);
 const imported=await request(core,url,'PUT',{expectedLayoutRevision:draft.layoutRevision,
  expectedDocumentRevision:draft.sourceDocumentRevision,markdown:md,reviewToken:reviewed.reviewToken,acknowledgeDrift:true});
 assert.equal(imported.status,200);
 return await imported.json();
}
async function checkAll(core,article,channel='wechat'){
 const r=await request(core,'/api/editor/projects/'+article.id+'/'+channel+'/checks','POST',{
  expectedRevision:article.channels[channel].document.revision,
  checks:{factual:true,privacy:true,rights:true,layout:true}
 });assert.equal(r.status,200);return r.json();
}
test('V44 initial board clearly blocks incomplete work and isolates channel status',async t=>{
 const {core,article,root}=await setup(t);
 const status=await read(await request(core,root));
 assert.equal(status.status,200);assert.equal(status.ready,false);
 assert.equal(status.decision,'blocked');assert.equal(status.platformVerified,false);
 assert.equal(status.published,false);assert.equal(status.readOnly,true);
 assert.deepEqual(status.steps.map(s=>s.id),['content','evidence','editorial','images','roundtrip','platform']);
 assert.ok(status.steps.find(s=>s.id==='editorial').issues.includes('channel_checks_incomplete'));
 assert.ok(status.steps.find(s=>s.id==='images').issues.includes('explicit_no_image_choice_or_plan_required'));
 assert.ok(status.steps.find(s=>s.id==='roundtrip').issues.includes('channel_layout_not_imported'));
 assert.equal((await read(await request(core,'/api/delivery/projects/'+article.id+'/zhihu'))).ready,false);
 assert.equal((await request(core,'/api/delivery/projects/'+article.id+'/master')).status,404);
 assert.equal((await request(core,root+'/snapshots','POST',{expectedFingerprint:status.fingerprint,
  note:'当前尚有几项未完成的交付任务',acknowledgeLocalOnly:true})).status,409);
 assert.equal((await request(core,root+'/no-images','POST',{expectedSourceRevision:0,
  expectedChannelRevision:1,expectedLayoutRevision:0,reason:'当前文章全部采用文字表达，不附加插图。'})).status,409);
});
test('explicit versioned no-image decision + checks creates local-only readiness snapshot, never publication',async t=>{
 const {core,article,root}=await setup(t);
 await importLayout(core,article);
 await checkAll(core,article);
 let before=await read(await request(core,root));
 assert.equal(before.ready,false);
 const waive=await read(await request(core,root+'/no-images','POST',{
  expectedSourceRevision:1,expectedChannelRevision:1,expectedLayoutRevision:1,
  reason:'本文章仅为文字实验记录，明确决定不使用概念插图。'
 }));
 assert.equal(waive.status,201);
 assert.equal(waive.ready,true);
 assert.equal(waive.steps.find(x=>x.id==='images').status,'skipped');
 assert.equal(waive.steps.find(x=>x.id==='platform').status,'skipped');
 assert.equal(waive.steps.find(x=>x.id==='roundtrip').status,'ready');
 assert.equal(waive.decision,'ready_for_author_final_review');
 assert.equal(waive.platformVerified,false);
 assert.equal(waive.published,false);
 assert.equal((await request(core,root+'/snapshots','POST',{expectedFingerprint:waive.fingerprint,
  note:'完成全部本地检查，但不代表平台已经发表'})).status,403);
 const snapshot=await read(await request(core,root+'/snapshots','POST',{
  expectedFingerprint:waive.fingerprint,acknowledgeLocalOnly:true,
  note:'本人检查了文字稿的事实、隐私、引用及排版，仍需手工发稿。'
 }));
 assert.equal(snapshot.status,201);
 assert.equal(snapshot.summary.platformVerified,false);
 assert.equal(snapshot.summary.published,false);
 const current=await read(await request(core,root));
 assert.equal(current.latestSnapshot.current,true);
 const history=await read(await request(core,root+'/history'));
 assert.equal(history.history.length,1);assert.equal(history.history[0].current,true);
 assert.equal((await request(core,root+'/snapshots','POST',{
  expectedFingerprint:'0'.repeat(64),acknowledgeLocalOnly:true,
  note:'这次提交依据的是过期的交付核查状态。'
 })).status,409);
 const zhihu=await read(await request(core,'/api/delivery/projects/'+article.id+'/zhihu'));
 assert.equal(zhihu.ready,false);assert.equal(zhihu.exemption.exists,false);
});
test('changing master article revision invalidates old no-image decision and stored readiness evidence',async t=>{
 const {core,article,root}=await setup(t);
 await importLayout(core,article);await checkAll(core,article);
 const v=await read(await request(core,root+'/no-images','POST',{
  expectedSourceRevision:1,expectedChannelRevision:1,expectedLayoutRevision:1,
  reason:'目前仅提供文字清单，按用户体验设计不插入任何图片。'
 }));
 assert.equal(v.ready,true);
 await request(core,root+'/snapshots','POST',{expectedFingerprint:v.fingerprint,acknowledgeLocalOnly:true,
  note:'在修改主稿前保存当前核查状态，供后续历史审计。'});
 const original=article.channels.master.document;
 const put=await request(core,'/api/editor/projects/'+article.id+'/master/document','PUT',{
  expectedRevision:1,paragraphs:original.paragraphs.map(p=>({id:p.id,text:p.text+' 后续补充内容。'}))
 });
 assert.equal(put.status,200);
 const now=await read(await request(core,root));
 assert.equal(now.ready,false);
 assert.equal(now.exemption.exists,true);assert.equal(now.exemption.current,false);
 assert.equal(now.latestSnapshot.current,false);
 assert.ok(now.steps.find(s=>s.id==='content').issues.includes('channel_master_revision_outdated'));
 assert.ok(now.steps.find(s=>s.id==='images').issues.includes('explicit_no_image_choice_or_plan_required'));
 assert.equal((await request(core,root+'/snapshots','POST',{expectedFingerprint:v.fingerprint,
  acknowledgeLocalOnly:true,note:'旧文章版本不应被新的作者快照继续使用。'})).status,409);
});
test('cannot waive images after plan creation, or when channel contains Markdown images',async t=>{
 const {core,article,root,illu}=await setup(t);
 const draft=await importLayout(core,article,'wechat','# 测试文章\n\n![existing](https://cdn.example.org/image.png)');
 assert.equal(draft.layoutRevision,1);
 const skip={expectedSourceRevision:1,expectedChannelRevision:1,expectedLayoutRevision:1,
  reason:'没有插图需要生成，但是现有排版包含未经核查的图像。'};
 assert.equal((await request(core,root+'/no-images','POST',skip)).status,409);
 const plan=await request(core,illu+'/plan','POST',{expectedMasterRevision:1});
 assert.equal(plan.status,201);
 assert.equal((await request(core,root+'/no-images','POST',skip)).status,409);
});
test('image delivery remains blocked without approval, current quality, saved roundtrip and manual platform report',async t=>{
 const {core,article,root,illu}=await setup(t);
 const plan=await read(await request(core,illu+'/plan','POST',{expectedMasterRevision:1}));
 assert.equal(plan.status,201);
 let view=await read(await request(core,root));
 assert.ok(view.steps.find(x=>x.id==='images').issues.includes('images_require_author_approval'));
 assert.ok(view.steps.find(x=>x.id==='platform').issues.includes('current_author_platform_qa_pass_required'));
 assert.equal((await request(core,root+'/no-images','POST',{
  expectedSourceRevision:1,expectedChannelRevision:1,expectedLayoutRevision:0,
  reason:'已有配图方案的文章不允许绕过插图与平台审核。'
 })).status,409);
 const [shot]=plan.shots;
 core.illustrations.generator=async()=>({base64:png,provider:'openai',model:'fake-model'});
 const image=await read(await request(core,illu+'/shots/'+shot.id+'/generate','POST',{allowExternalAI:true}));
 assert.equal(image.status,200);
 let state=await read(await request(core,illu));
 assert.equal(state.shots[0].status,'generated');
 const approved=await request(core,illu+'/shots/'+shot.id+'/decision','POST',{decision:'approve'});
 assert.equal(approved.status,200);
 state=await read(await request(core,illu));
 const asset=state.shots[0].asset;
 await request(core,'/api/assets/'+asset.id+'/mappings/wechat','PUT',{
  url:'https://cdn.example.org/illustration.png',note:'作者自行上传之后的渠道地址'});
 view=await read(await request(core,root));
 assert.ok(view.steps.find(x=>x.id==='images').issues.includes('current_positive_quality_review_required'));
 const quality=await request(core,illu+'/shots/'+shot.id+'/quality-reviews','POST',{
  assetId:asset.id,expectedAssetSha256:asset.sha256,expectedShotUpdatedAt:state.shots[0].updatedAt,
  expectedSourceRevision:1,expectedProfileRevision:state.visualProfile.revision,
  ratings:qualityRatings,riskFlags:[],rightsReviewed:true,factualReviewed:true,
  recommendation:'recommended',note:'作者人工审核该图主题适当，没有发现版权或事实方面的具体异常。'
 });
 assert.equal(quality.status,201);
 view=await read(await request(core,root));
 assert.equal(view.steps.find(x=>x.id==='images').status,'blocked','unreviewed other shots still block');
 assert.equal(view.platformVerified,false);assert.equal(view.published,false);
});

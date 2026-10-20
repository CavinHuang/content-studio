import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';

// Unit coverage for the Creator V2.3 visual studio additions:
//  - POST plan {scope:'cover'} creates a cover-only plan from the SAME
//    plan/shot storage (no parallel model);
//  - PUT prompt accepts an optional alt (2-160 chars) for the
//    accessibility description without changing other semantics;
//  - src/illustrations-studio.mjs derives honest labels from real rows.
let core,dir;
const request=(path,options={})=>dispatchApi(new Request('http://127.0.0.1:4312'+path,options),core);
const post=(path,data)=>request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data||{})});
const put=(path,data)=>request(path,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(data||{})});

test('setup: real core with a synthetic master draft',async()=>{
 dir=mkdtempSync(join(tmpdir(),'studio-illu-v2-'));
 core=await createCore(join(dir,'studio.sqlite'));
 const created=await post('/api/writing/projects',{title:'视觉工作台单元验证'});
 assert.equal(created.status,201);
 const doc=await created.json();
 // Seed with two long paragraphs; the fresh revision comes from the create response.
 const saved=await put(`/api/writing/projects/${doc.projectId}/master`,{expectedRevision:doc.revision,
  markdown:'# 视觉工作台单元验证\n\n第一段写足够长的文字：桌面 Agent 的可靠性判断需要执行证据与失败恢复，而不是一次演示。\n\n第二段继续写足够长的文字：人工确认的位置决定了协作边界，也决定了图片需要解释什么概念。'});
 assert.equal(saved.status,200);
});

test('plan scope cover keeps only the cover slot; default plan stays cover+sections',async()=>{
 const projects=await (await request('/api/editor/projects')).json();
 const project=projects.projects[0];
 const revision=project.channels.master.document.revision;
 const full=await post(`/api/illustrations/projects/${project.id}/plan`,{expectedMasterRevision:revision});
 assert.equal(full.status,201);
 const fullBody=await full.json();
 assert.equal(fullBody.shots[0].role,'cover');
 assert.ok(fullBody.shots.length>=2);
 // scope:'cover' replaces the latest plan with the cover slot only.
 const cover=await post(`/api/illustrations/projects/${project.id}/plan`,{expectedMasterRevision:revision,scope:'cover'});
 assert.equal(cover.status,201);
 const coverBody=await cover.json();
 assert.equal(coverBody.shots.length,1);
 assert.equal(coverBody.shots[0].role,'cover');
 // invalid scope fails without touching storage
 const bad=await post(`/api/illustrations/projects/${project.id}/plan`,{expectedMasterRevision:revision,scope:'everything'});
 assert.equal(bad.status,400);
 // paragraph planning (pre-existing behavior) still works after the change
 const master=await (await request(`/api/editor/projects/${project.id}`)).json();
 const paragraphId=master.channels.master.document.paragraphs[0].id;
 const single=await post(`/api/illustrations/projects/${project.id}/plan`,{expectedMasterRevision:revision,paragraphId});
 assert.equal(single.status,201);
 assert.equal((await single.json()).shots.length,1);
});

test('prompt edit accepts optional alt; validation and conflict semantics intact',async()=>{
 const projects=await (await request('/api/editor/projects')).json();
 const project=projects.projects[0];
 const revision=project.channels.master.document.revision;
 const planned=await post(`/api/illustrations/projects/${project.id}/plan`,{expectedMasterRevision:revision});
 const {shots}=await planned.json();
 const shot=shots[0];
 const ok=await put(`/api/illustrations/projects/${project.id}/shots/${shot.id}/prompt`,{
  expectedUpdatedAt:shot.updatedAt,scene:shot.scene,style:'diagram',alt:'抽象几何图形表达 AI Agent 的可控性',
 });
 assert.equal(ok.status,200);
 const body=await ok.json();
 assert.equal(body.alt,'抽象几何图形表达 AI Agent 的可控性');
 assert.equal(body.style,'diagram');
 assert.equal(body.status,'planned');
 // invalid alt rejected
 const bad=await put(`/api/illustrations/projects/${project.id}/shots/${shot.id}/prompt`,{
  expectedUpdatedAt:body.updatedAt,scene:body.scene,alt:'x',
 });
 assert.equal(bad.status,400);
 // stale expectedUpdatedAt still conflicts (409), nothing overwritten
 const stale=await put(`/api/illustrations/projects/${project.id}/shots/${shot.id}/prompt`,{
  expectedUpdatedAt:shot.updatedAt,scene:body.scene,
 });
 assert.equal(stale.status,409);
});

test('illustrations-studio derivations stay honest over real rows',async()=>{
 const {shotStatusView,shotAnchor,planningModes,variantCards,previewBlocks,budgetLine,insertedAssetIds}=await import('../src/illustrations-studio.mjs');
 // status view: approved+inserted vs approved vs generated
 assert.deepEqual(shotStatusView({status:'planned'}),{label:'待生成',tone:'warn'});
 assert.deepEqual(shotStatusView({status:'failed'}),{label:'生成失败',tone:'danger'});
 assert.deepEqual(shotStatusView({status:'generating'}),{label:'生成中',tone:'blue'});
 assert.deepEqual(shotStatusView({status:'generated'}),{label:'待审阅',tone:'blue'});
 assert.deepEqual(shotStatusView({status:'approved'}),{label:'已批准',tone:'good'});
 assert.deepEqual(shotStatusView({status:'approved'},{inserted:true}),{label:'已插入',tone:'good'});
 assert.deepEqual(shotStatusView({status:'rejected'}),{label:'已拒绝',tone:'muted'});
 // anchor: cover under title; section after its paragraph; missing → replan
 assert.equal(shotAnchor({role:'cover'}),'文章标题下方 · 封面');
 const paragraphs=[{id:'p1',text:'第一段的完整文本，用于锚定图片位置和摘要。'}];
 assert.match(shotAnchor({role:'section',paragraphId:'p1'},paragraphs),/^第 1 段之后 · /);
 assert.equal(shotAnchor({role:'section',paragraphId:'gone'},paragraphs),'原段落不在当前主稿 · 需重新规划');
 // planning modes: three real modes; paragraph mode only long paragraphs
 const modes=planningModes(paragraphs);
 assert.deepEqual(modes.map(m=>m.id),['cover','full','paragraph']);
 assert.equal(modes[2].paragraphs.length,1);
 assert.equal(planningModes([{id:'p2',text:'短'}])[2].paragraphs.length,0);
 // variant cards: current asset selected, candidates appended, rejected counted
 const {cards,rejected}=variantCards({
  assetId:'as_1',asset:{previewUrl:'/api/assets/as_1/preview',mappings:[]},
  candidates:[{id:'ic_a',assetId:'as_1',status:'selected',asset:{previewUrl:'x'},provider:'openai',instruction:''},
   {id:'ic_b',assetId:'as_2',status:'generated',asset:{previewUrl:'y'},provider:'openai',instruction:'更暖的背景'},
   {id:'ic_c',assetId:'as_3',status:'rejected',asset:{previewUrl:'z'},provider:'openai',instruction:''}],
 });
 assert.equal(cards.length,2);
 assert.equal(cards[0].selected,true);
 assert.equal(cards[1].candidateId,'ic_b');
 assert.equal(rejected,1);
 // preview blocks: title, paragraphs, approved images only; mapping per channel
 const doc={title:'真实标题',paragraphs:[{id:'p1',text:'段落一'},{id:'p2',text:'段落二'}]};
 const shots=[
  {id:'s1',assetId:'as_1',role:'cover',paragraphId:'',status:'approved',alt:'封面',asset:{previewUrl:'/p1',mappings:[{channel:'wechat',url:'https://a.example/x.png'}]}},
  {id:'s2',assetId:'as_2',role:'section',paragraphId:'p2',status:'generated',alt:'未批准图',asset:{previewUrl:'/p2',mappings:[]}},
  {id:'s3',assetId:'as_3',role:'section',paragraphId:'p2',status:'approved',alt:'章节图',asset:{previewUrl:'/p3',mappings:[]}},
 ];
 const wechat=previewBlocks(doc,shots,'wechat');
 assert.deepEqual(wechat.blocks.map(b=>b.type),['title','image','text','text','image']);
 assert.equal(wechat.adopted,2);
 assert.equal(wechat.total,3);
 assert.equal(wechat.blocks[1].mapped,true);
 assert.equal(wechat.blocks[4].mapped,false);
 const zhihu=previewBlocks(doc,shots,'zhihu');
 assert.equal(zhihu.blocks[1].mapped,false);
 // budget copy is request-based, never currency
 assert.match(budgetLine({used:2,dailyLimit:12,remaining:10}),/按请求预留计数/);
 assert.equal(budgetLine(null),'');
 // inserted derivation reads the real master markdown convention
 const inserted=insertedAssetIds('![封面](asset://as_1)\n\n正文',shots);
 assert.ok(inserted.has('as_1'));
 assert.equal(inserted.has('as_2'),false);
});

test('teardown',async()=>{rmSync(dir,{recursive:true,force:true})});

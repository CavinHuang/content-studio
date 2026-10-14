import test from 'node:test';
import assert from 'node:assert/strict';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';
import {analyzeMarkdownRoundtrip} from '../lib/markdown-audit.mjs';
const request=(path,core,method='GET',data)=>dispatchApi(new Request('http://localhost:4312'+path,{method,headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined}),core);
const paragraphs=[{id:'p_testtext',text:'一个环境里观察到日志缺失，并不代表全部用户。'}];
const audit=(markdown,blocks=paragraphs)=>analyzeMarkdownRoundtrip({title:'测试文章',paragraphs:blocks,markdown,documentRevision:1,layoutRevision:0});
test('format-only changes preserve identical visible wording',()=>{
 const a=audit('# 测试文章\n\n**一个环境里观察到日志缺失，并不代表全部用户。**');
 assert.equal(a.summary.exactText,1);assert.equal(a.hasMaterialDrift,false);
});
test('changed assertion is flagged and source ID is preserved',()=>{
 const a=audit('# 测试文章\n\n全部用户都遇到了日志缺失。');
 assert.equal(a.summary.sourceNeedsReview,1);assert.equal(a.sourceBlocks[0].paragraphId,'p_testtext');assert.equal(a.summary.newOrChangedBlocks,1);
});
test('one Markdown block does not satisfy repeated original paragraphs',()=>{
 const a=audit('# 测试文章\n\n重复记录。',[{id:'p_repeated1',text:'重复记录。'},{id:'p_repeated2',text:'重复记录。'}]);
 assert.equal(a.summary.exactText,1);assert.equal(a.summary.sourceNeedsReview,1);
});
test('links, paragraph reordering and code-identifiers cannot bypass review',()=>{
 const linked=audit('# 测试文章\n\n[一个环境里观察到日志缺失，并不代表全部用户。](https://example.org/source)');
 assert.equal(linked.summary.newLinkTargets,1);assert.equal(linked.requiresHumanReview,true);
 const reordered=audit('# 测试文章\n\n第二段。\n\n第一段。',[{id:'p_first1',text:'第一段。'},{id:'p_second1',text:'第二段。'}]);
 assert.equal(reordered.summary.reorderedBlocks,1);
 const changed=audit('# 测试文章\n\nauthcode 工作正常。',[{id:'p_code1',text:'auth_code 工作正常。'}]);
 assert.equal(changed.summary.exactText,0);
});
test('previously linked research problems require review despite identical words',()=>{
 const a=analyzeMarkdownRoundtrip({title:'测试文章',paragraphs,claims:[{paragraphId:'p_testtext',anchorStatus:'matched',needsResearchReview:true}],markdown:'# 测试文章\n\n一个环境里观察到日志缺失，并不代表全部用户。'});
 assert.equal(a.summary.affectedEvidence,1);assert.equal(a.requiresHumanReview,true);
});
test('preview token must match exact markdown and version before layout is saved',async t=>{
 const core=createCore(':memory:');t.after(()=>core.close());
 const p=await (await request('/api/editor/projects',core,'POST',{title:'完整审阅测试',paragraphs})).json();
 const path=`/api/composer/projects/${p.id}/wechat`;
 const body={expectedLayoutRevision:0,expectedDocumentRevision:1,markdown:'# 完整审阅测试\n\n所有用户都会出现故障。'};
 assert.equal((await request(path,core,'PUT',body)).status,409);
 const response=await request(path+'/review',core,'POST',body);assert.equal(response.status,200);
 const review=await response.json();assert.equal(review.requiresHumanReview,true);
 assert.equal((await request(path,core,'PUT',{...body,acknowledgeDrift:true,reviewToken:'bad'})).status,409);
 assert.equal((await request(path,core,'PUT',{...body,acknowledgeDrift:true,reviewToken:review.reviewToken,markdown:body.markdown+' 又改了'})).status,409);
 const ok=await request(path,core,'PUT',{...body,acknowledgeDrift:true,reviewToken:review.reviewToken});assert.equal(ok.status,200);
 const saved=await ok.json();assert.equal(saved.layoutRevision,1);assert.equal(saved.lastImportReview.acknowledgedByAuthor,true);
 const history=(await (await request(path+'/history',core)).json()).history;assert.equal(history[0].importReview.summary.sourceNeedsReview,1);
 const zhihu=await (await request(`/api/composer/projects/${p.id}/zhihu`,core)).json();assert.equal(zhihu.layoutRevision,0);
 const ch=(await (await request(`/api/editor/projects/${p.id}`,core)).json()).channels.wechat;
 assert.equal(ch.checks.factual,false);
 assert.equal((await request(path+'/review',core,'POST',body)).status,409);
});

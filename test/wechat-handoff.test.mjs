import test from 'node:test';
import assert from 'node:assert/strict';
import {markdownFromDocument, validateHandoffMarkdown, suggestFilename} from '../lib/wechat-handoff.mjs';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';

const request=(path,core,method='GET',data)=>dispatchApi(new Request('http://localhost:4312'+path,{method,headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined}),core);
async function setup(t){const c=createCore(':memory:');t.after(()=>c.close());return c;}

test('handoff renders source without dropping paragraph text',()=>{
 const markdown=markdownFromDocument('版本标题',[{text:'事实段落。'},{text:'证据摘要。'}]);
 assert.match(markdown,/^# 版本标题\n\n事实段落。\n\n证据摘要。\n$/);
 assert.equal(suggestFilename('A/B \\ TEST','wechat',2),'A-B - TEST-wechat-layout-v2.md');
});
test('rejects empty or oversized markdown and normalizes line endings',()=>{
 assert.throws(()=>validateHandoffMarkdown(''),/5-150000/);
 assert.throws(()=>validateHandoffMarkdown('a'.repeat(150001)),/5-150000/);
 assert.equal(validateHandoffMarkdown('# Hi\r\n\r\nHello'), '# Hi\n\nHello');
});
test('channel drafts preserve revision, keep isolated, and check optimistic locking', async t=>{
 const c=await setup(t);
 const p=await (await request('/api/editor/projects',c,'POST',{title:'测试 doocs Markdown 交接'})).json();
 let w=await (await request(`/api/composer/projects/${p.id}/wechat`,c)).json();
 assert.equal(w.layoutRevision,0);assert.equal(w.sourceDocumentRevision,1);
 let r=await request(`/api/composer/projects/${p.id}/wechat`,c,'PUT',{expectedLayoutRevision:0,expectedDocumentRevision:1,markdown:'# 首个微信排版稿\n\n- 列表\n\n```js\nconsole.log(1)\n```'});
 assert.equal(r.status,200);w=await r.json();assert.equal(w.layoutRevision,1);
 const z=await (await request(`/api/composer/projects/${p.id}/zhihu`,c)).json();assert.equal(z.layoutRevision,0);assert.doesNotMatch(z.markdown,/首个微信排版稿/);
 r=await request(`/api/composer/projects/${p.id}/wechat`,c,'PUT',{expectedLayoutRevision:0,expectedDocumentRevision:1,markdown:'# 覆盖内容'});assert.equal(r.status,409);
 r=await request(`/api/composer/projects/${p.id}/wechat/history`,c);const history=(await r.json()).history;assert.deepEqual(history.map(x=>x.revision),[1]);
 const checks=await (await request(`/api/editor/projects/${p.id}`,c)).json();assert.equal(checks.channels.wechat.status,'draft');
 const exportAttempt=await request(`/api/editor/projects/${p.id}/wechat/export`,c,'POST',{expectedRevision:1});assert.equal(exportAttempt.status,409);
 assert.match((await exportAttempt.json()).error,/doocs\/md/);
});
test('stale source revision blocked and saving does not overwrite source paragraphs', async t=>{
 const c=await setup(t);
 const p=await (await request('/api/editor/projects',c,'POST',{title:'源稿更新与排版稿隔离'})).json();
 const before=p.channels.wechat.document.paragraphs;
 const w=await (await request(`/api/composer/projects/${p.id}/wechat`,c,'PUT',{expectedLayoutRevision:0,expectedDocumentRevision:1,markdown:'# 修改后\n\n真实的新排版内容'})).json();
 assert.equal(w.layoutRevision,1);
 let updated=await request(`/api/editor/projects/${p.id}/wechat/document`,c,'PUT',{expectedRevision:1,paragraphs:[{...before[0],text:'这是另一个本地源段落，新版文章记录。'}]});
 assert.equal(updated.status,200);
 const read=await (await request(`/api/composer/projects/${p.id}/wechat`,c)).json();assert.equal(read.isSourceOutdated,true);
 const invalid=await request(`/api/composer/projects/${p.id}/wechat`,c,'PUT',{expectedLayoutRevision:1,expectedDocumentRevision:1,markdown:'# 尝试错误地覆写'});assert.equal(invalid.status,409);
 const saved=await (await request(`/api/editor/projects/${p.id}`,c)).json();assert.match(saved.channels.wechat.document.paragraphs[0].text,/另一个本地源段落/);
});
test('does not accept master as publishing typesetting destination',async t=>{
 const c=await setup(t),p=await (await request('/api/editor/projects',c,'POST',{title:'主稿不等同微信排版'})).json();
 assert.equal((await request(`/api/composer/projects/${p.id}/master`,c)).status,404);
});

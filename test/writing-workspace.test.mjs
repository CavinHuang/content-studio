import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';

function setup(t){const root=mkdtempSync(join(tmpdir(),'studio-writing-')),file=join(root,'test.sqlite');let core=createCore(file);t.after(()=>{core.close();rmSync(root,{recursive:true,force:true})});return {get core(){return core},reopen(){core.close();core=createCore(file);return core}}}
function provider(t){const names=['CONTENT_AI_BASE_URL','CONTENT_AI_MODEL','CONTENT_AI_API_KEY'],old=names.map(n=>process.env[n]);
 t.after(()=>names.forEach((n,i)=>{if(old[i]===undefined)delete process.env[n];else process.env[n]=old[i]}));
 process.env.CONTENT_AI_BASE_URL='https://writing.example/v1/';process.env.CONTENT_AI_MODEL='synthetic-writing-model';process.env.CONTENT_AI_API_KEY='synthetic-test-key';
}
const reply=(replacement,reason='让表达更清晰')=>async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({replacement,reason})}}]}),{headers:{'content-type':'application/json'}});
async function request(core,path,method='GET',input){return dispatchApi(new Request('http://127.0.0.1:4312'+path,{method,headers:input?{'content-type':'application/json'}:{},body:input?JSON.stringify(input):undefined}),core)}

test('Markdown roundtrip preserves complex source and revisions across process reopen; channels remain independent',t=>{
 const env=setup(t),{writing,editorial}=env.core,initial=writing.create({title:'复杂 Markdown 编辑测试'}),id=initial.projectId;
 const before=editorial.get(id).channels.wechat.document.revision;
 const markdown='# 标题\n\n正文中的 **重点** 与 [来源](https://example.com/)\n\n| 列一 | 列二 |\n| --- | --- |\n| 内容 | 更多 |\n\n```js\nconst a = "<div>";\n\nconsole.log(a);\n```\n\n![图](asset://as_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)\n';
 const saved=writing.save(id,'master',{expectedRevision:initial.revision,markdown});
 assert.equal(saved.markdown,markdown);assert.equal(editorial.get(id).channels.wechat.document.revision,before);
 const historical=writing.history(id,'master');assert.equal(historical[0].markdown,markdown);
 assert.equal(env.reopen().writing.document(id,'master').markdown,markdown);
 const next=env.core.writing.save(id,'master',{expectedRevision:saved.revision,markdown:markdown+'\n新增一段。'});
 assert.equal(next.revision,saved.revision+1);assert.equal(env.core.writing.history(id,'master').find(r=>r.revision===saved.revision).markdown,markdown);
});

test('optimistic Markdown updates are atomic; no-op saves do not create revisions; old writers cannot corrupt formatting',t=>{
 const {core}=setup(t),doc=core.writing.create({title:'乐观锁与旧接口保护'}),id=doc.projectId;
 const first=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'## 第一节\n\n稳定的原始正文。'});
 const rows=core.writing.history(id,'master').length;
 assert.equal(core.writing.save(id,'master',{expectedRevision:first.revision,markdown:first.markdown}).revision,first.revision);
 assert.throws(()=>core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'旧页面覆盖'}),e=>e.status===409);
 assert.throws(()=>core.editorial.save(id,'master',{expectedRevision:first.revision,paragraphs:[{text:'旧接口不得覆盖 Markdown'}]}),e=>e.status===409);
 assert.throws(()=>core.precision.saveDocument({referenceId:first.referenceId,expectedRevision:first.revision,paragraphs:[{text:'精确引用入口也不能覆盖 Markdown'}]}),e=>e.status===409);
 assert.equal(core.writing.history(id,'master').length,rows);assert.equal(core.writing.document(id,'master').markdown,first.markdown);
});

test('legacy layout migration requires a choice and retains both historical representations',t=>{
 const {core}=setup(t),project=core.editorial.create({title:'旧稿迁移测试'}),id=project.id;
 const draft=core.editorial.layoutDraft(id,'wechat'),markdown=draft.markdown+'\n\n作者在排版中新增的内容。';
 const audit=core.editorial.reviewLayoutDraft(id,'wechat',{expectedLayoutRevision:0,expectedDocumentRevision:1,markdown});
 core.editorial.saveLayoutDraft(id,'wechat',{expectedLayoutRevision:0,expectedDocumentRevision:1,markdown,reviewToken:audit.reviewToken,acknowledgeDrift:true});
 const writing=core.writing.document(id,'wechat');assert.equal(writing.mode,'legacy');assert.equal(writing.legacyLayout.markdown,markdown);
 assert.throws(()=>core.writing.save(id,'wechat',{expectedRevision:1,markdown}),e=>e.status===409);
 const migrated=core.writing.save(id,'wechat',{expectedRevision:1,markdown,resolveLegacy:'layout'});
 assert.equal(migrated.mode,'markdown');assert.equal(core.editorial.layoutHistory(id,'wechat').length,1);
 assert.equal(core.writing.history(id,'wechat').some(r=>r.revision===1&&r.mode==='legacy'),true);
 assert.equal(core.editorial.layoutDraft(id,'wechat').markdown,markdown);
 assert.throws(()=>core.editorial.saveLayoutDraft(id,'wechat',{expectedLayoutRevision:1,expectedDocumentRevision:2,markdown}),e=>e.status===409);
});

test('AI range suggestion is persisted without editing, requires consent, applies once and resets only its channel checks',async t=>{
 provider(t);const {core}=setup(t),created=core.writing.create({title:'局部改写建议测试'}),id=created.projectId;
 let doc=core.writing.save(id,'master',{expectedRevision:created.revision,markdown:'保留开头。\n\n改写这一段。\n\n保留结尾。'});
 const input={expectedRevision:doc.revision,instruction:'只改选中的段落',from:8,to:14};
 let calls=0;const fetchImpl=async(url,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.messages[1].role,'user');return reply('更清楚的新段落。')(url,options)};
 await assert.rejects(()=>core.writing.suggest(id,'master',input,{fetchImpl}),e=>e.status===403);assert.equal(calls,0);
 const s=await core.writing.suggest(id,'master',{...input,allowExternalAI:true},{fetchImpl});
 assert.equal(core.writing.document(id,'master').markdown,doc.markdown);
 assert.equal(core.writing.suggestions(id,'master')[0].id,s.id);
 const next=core.writing.decide(id,'master',s.id,{action:'accept',expectedRevision:doc.revision});
 assert.equal(next.markdown,doc.markdown.slice(0,8)+'更清楚的新段落。'+doc.markdown.slice(14));
 assert.equal(core.writing.suggestions(id,'master')[0].status,'accepted');
 assert.throws(()=>core.writing.decide(id,'master',s.id,{action:'accept',expectedRevision:next.revision}),e=>e.status===409);
});

test('editing during model generation keeps the stale suggestion reviewable and prevents lost updates',async t=>{
 provider(t);const {core}=setup(t),doc=core.writing.create({title:'模型生成时继续编辑'}),id=doc.projectId;
 let finish;const fetchImpl=()=>new Promise(resolve=>{finish=resolve});
 const pending=core.writing.suggest(id,'master',{expectedRevision:doc.revision,instruction:'生成完整初稿',allowExternalAI:true},{fetchImpl});
 const edited=core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:'作者刚刚写下的重要内容。'});
 finish(await reply('模型生成的另一份内容。')());const s=await pending;
 assert.equal(core.writing.document(id,'master').markdown,edited.markdown);
 assert.throws(()=>core.writing.decide(id,'master',s.id,{action:'accept',expectedRevision:edited.revision}),e=>e.status===409);
 core.writing.decide(id,'master',s.id,{action:'reject'});assert.equal(core.writing.suggestions(id,'master')[0].status,'rejected');
});

test('truncated, invalid and failed model responses never alter the article or expose response bodies',async t=>{
 provider(t);const {core}=setup(t),doc=core.writing.create({title:'模型异常不会覆盖正文'}),id=doc.projectId;
 const input={expectedRevision:doc.revision,instruction:'生成文章初稿',allowExternalAI:true};
 for(const response of [new Response('private-provider-error',{status:429}),new Response('{'),new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{"replacement":"partial","reason":"cut"}'}}]}))]){
  await assert.rejects(()=>core.writing.suggest(id,'master',input,{fetchImpl:async()=>response}),e=>e.status===502&&!e.message.includes('private-provider-error'));
 }
 assert.equal(core.writing.document(id,'master').revision,doc.revision);assert.equal(core.writing.suggestions(id,'master').length,0);
});

test('discussion persists a reply without producing an applicable document mutation',async t=>{
 provider(t);const {core}=setup(t),doc=core.writing.create({title:'讨论不会被当成正文'}),id=doc.projectId;
 const s=await core.writing.suggest(id,'master',{expectedRevision:doc.revision,instruction:'先讨论这个主题的核心观点',mode:'discuss',allowExternalAI:true},{fetchImpl:reply('','可以先比较两个不同的写作角度。')});
 assert.equal(s.status,'conversation');assert.equal(core.writing.document(id,'master').revision,doc.revision);
 assert.throws(()=>core.writing.decide(id,'master',s.id,{action:'accept',expectedRevision:doc.revision}),e=>e.status===409);
 assert.equal(core.writing.suggestions(id,'master')[0].reason,'可以先比较两个不同的写作角度。');
});

test('selection image planning uses the current canonical paragraph and rejects stale or foreign anchors',t=>{
 const {core}=setup(t),initial=core.writing.create({title:'选段配图的稳定锚点'}),id=initial.projectId;
 const doc=core.writing.save(id,'master',{expectedRevision:initial.revision,markdown:'# 文章标题\n\n作者希望在这一段后添加概念图。\n\n其他段落应继续保留。'});
 const block=doc.blocks[1];assert.equal(doc.markdown.slice(block.from,block.to),'作者希望在这一段后添加概念图。');
 const plan=core.illustrations.plan(id,{expectedMasterRevision:doc.revision,paragraphId:block.id});assert.equal(plan.shots.length,1);assert.equal(plan.shots[0].paragraphId,block.id);
 assert.throws(()=>core.illustrations.plan(id,{expectedMasterRevision:doc.revision,paragraphId:'p_notinthearticle'}),e=>e.status===409);
 core.writing.save(id,'master',{expectedRevision:doc.revision,markdown:doc.markdown+'\n\n更新后的内容。'});
 assert.throws(()=>core.illustrations.plan(id,{expectedMasterRevision:doc.revision,paragraphId:block.id}),e=>e.status===409);
});

test('selected topic brief is persisted and sent as explicit source context to the writing model',async t=>{
 provider(t);const {core}=setup(t);
 const brief=core.store.createBrief({id:'synthetic-event',title:'基于公开来源的选题',assessment:{warning:'来源待核实'},items:[{id:'synthetic-source',sourceId:'official-rss',originalUrl:'https://example.org/source',role:'primary_statement',seenAt:'2026-10-16T00:00:00Z'}]});
 const doc=core.writing.create({title:'由选题进入文章',briefId:brief.id});assert.equal(doc.brief.id,brief.id);
 let captured;const fetchImpl=async(_url,options)=>{captured=JSON.parse(JSON.parse(options.body).messages.at(-1).content);return reply('基于当前选题的合成文章。')()};
 await core.writing.suggest(doc.projectId,'master',{expectedRevision:doc.revision,instruction:'参考选题简报生成初稿',allowExternalAI:true},{fetchImpl});
 assert.equal(captured.brief.sources[0].url,'https://example.org/source');assert.equal(captured.brief.sources[0].role,'primary_statement');
 assert.equal(core.writing.document(doc.projectId,'master').markdown,'');
});

test('API rejects foreign suggestion IDs, stale revisions and unsafe origins before mutations',async t=>{
 const {core}=setup(t),doc=core.writing.create({title:'写作 API 边界测试'}),root='/api/writing/projects/'+doc.projectId+'/master';
 let response=await request(core,root,'PUT',{expectedRevision:0,markdown:'不能覆盖'});assert.equal(response.status,409);
 response=await request(core,root+'/suggestions/ws_11111111-1111-1111-1111-111111111111','POST',{action:'accept',expectedRevision:doc.revision});assert.equal(response.status,404);
 response=await dispatchApi(new Request('http://localhost:4312'+root,{method:'PUT',headers:{origin:'https://evil.example','content-type':'application/json'},body:JSON.stringify({expectedRevision:doc.revision,markdown:'不能写入'})}),core);assert.equal(response.status,403);
 response=await request(core,root+'/history');assert.equal(response.status,200);assert.ok((await response.json()).history.length);
});

test('Markdown export preserves source, enforces checks and image mappings, and never reports publication',t=>{
 const {core}=setup(t),initial=core.writing.create({title:'Markdown 导出检查'}),id=initial.projectId;
 let doc=core.writing.document(id,'wechat');doc=core.writing.save(id,'wechat',{expectedRevision:doc.revision,markdown:'# 公众号稿\n\n已核对的内容。'});
 assert.throws(()=>core.writing.export(id,'wechat',{expectedRevision:doc.revision}),e=>e.status===409);
 core.editorial.setChecks(id,'wechat',{expectedRevision:doc.revision,checks:{factual:true,privacy:true,rights:true,layout:true}});
 const exported=core.writing.export(id,'wechat',{expectedRevision:doc.revision});assert.equal(exported.markdown,doc.markdown);assert.equal(exported.publicationVerified,false);
 assert.equal(core.editorial.get(id).channels.wechat.status,'exported');
 doc=core.writing.save(id,'wechat',{expectedRevision:doc.revision,markdown:doc.markdown+'\n\n修改后需重新审核。'});
 assert.ok(Object.values(doc.checks).every(value=>value===false));assert.throws(()=>core.writing.export(id,'wechat',{expectedRevision:doc.revision}),e=>e.status===409);
 assert.throws(()=>core.editorial.exportChannel(id,'wechat',{expectedRevision:doc.revision}),e=>e.status===409);
 const image=core.assets.upload({name:'synthetic.png',alt:'合成测试图片',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII='});
 doc=core.writing.save(id,'wechat',{expectedRevision:doc.revision,markdown:doc.markdown+`\n\n![配图](asset://${image.id})`});
 core.editorial.setChecks(id,'wechat',{expectedRevision:doc.revision,checks:{factual:true,privacy:true,rights:true,layout:true}});
 assert.throws(()=>core.writing.export(id,'wechat',{expectedRevision:doc.revision}),e=>e.status===409&&e.message.includes('URL'));
 core.assets.setMapping(image.id,'wechat',{url:'https://cdn.example.org/synthetic.png',note:'合成测试的手动图片地址映射'});
 const mapped=core.writing.export(id,'wechat',{expectedRevision:doc.revision});assert.ok(mapped.markdown.includes('https://cdn.example.org/synthetic.png'));
 assert.ok(core.writing.document(id,'wechat').markdown.includes('asset://'));
 core.assets.setMapping(image.id,'wechat',{url:'https://cdn.example.org/new-synthetic.png',note:'合成测试变更地址但不改历史导出'});
 const snapshot=core.store.db.prepare('SELECT content_text FROM editorial_exports WHERE reference_id=? AND document_revision=?').get(doc.referenceId,doc.revision);
 assert.equal(snapshot.content_text,mapped.markdown);
});

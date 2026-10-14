import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCore} from '../lib/core.mjs';
import {Store} from '../src/store.mjs';
import {VerificationService} from '../src/verification.mjs';
import {KnowledgeService} from '../src/knowledge.mjs';
import {PrecisionService} from '../src/precision.mjs';
import {EditorialService} from '../src/editorial.mjs';
import {integrationRehearsal,historicalInventory,checkHistoricalInventory} from '../scripts/integration-rehearsal.mjs';

const md5=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function dir(t){const root=mkdtempSync(join(tmpdir(),'v47-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root}
const paragraphs=[
 {text:'这篇旧文章已经存储在数据库里，升级必须保留其文本和版本历史。'},
 {text:'备份之后对临时数据库运行模拟编辑操作，原始数据不应该发生变化。'}
];
function oldSchema(path){
 const store=new Store(path);
 const verify=new VerificationService(store),knowledge=new KnowledgeService(store,verify);
 const precision=new PrecisionService(store,verify,knowledge);
 const editorial=new EditorialService(store,knowledge,precision);
 editorial.attachPrecision();
 const article=editorial.create({title:'历史 V29 文章，真实字段数据持久化',paragraphs});
 store.db.exec('DROP TABLE editorial_layout_review_history');
 store.close();return article;
}
test('V47 restores pre-V30 database, scans historic docs, exercises both channels and never touches source',async t=>{
 const db=join(dir(t),'old.sqlite');
 const article=oldSchema(db),before=md5(db);
 const result=await integrationRehearsal(db);
 assert.equal(result.kind,'content-studio-v47-restored-acceptance');
 assert.equal(result.sourceUntouched,true);
 assert.equal(result.backupVerified,true);
 assert.equal(result.restoredIntegrity,'ok');
 assert.equal(result.existingRowsUnchanged,true);
 assert.equal(result.historicProjectsInspected,1);
 assert.equal(result.historicRowsProtected>0,true);
 assert.equal(result.synthetic.textOnly.channels,2);
 assert.equal(result.synthetic.textOnly.snapshots,2);
 assert.equal(result.synthetic.textOnly.staleSnapshotsDetected,2);
 assert.equal(result.synthetic.illustrated.channels,2);
 assert.equal(result.synthetic.illustrated.snapshots,2);
 assert.ok(result.synthetic.illustrated.images>=1);
 assert.equal(result.synthetic.illustrated.staleImageMappingDetected,true);
 assert.equal(result.synthetic.illustrated.otherChannelUnaffected,true);
 assert.equal(result.paidModelRequests,0);
 assert.equal(result.platformVerified,false);
 assert.equal(result.productionReady,false);
 assert.equal(result.temporaryCopiesDeleted,true);
 assert.equal(md5(db),before,'original on-disk SQLite must not be mutated by rehearsal');
 const reopened=createCore(db);
 try{
  const p=reopened.editorial.get(article.id);
  assert.equal(p.channels.master.document.paragraphs[0].text,paragraphs[0].text);
  assert.equal(reopened.editorial.list().length,1,'synthetic articles only existed in restored disposable copy');
 }finally{reopened.close()}
});
test('V47 preserves prior images, mapping URLs, quality audit and immutable delivery snapshots',async t=>{
 const db=join(dir(t),'current.sqlite'),core=createCore(db);
 const doc=core.editorial.create({title:'历史素材和人工审核回归',paragraphs});
 const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
 const asset=core.assets.upload({name:'existing.png',alt:'原有私有图片',base64:png});
 core.assets.setMapping(asset.id,'wechat',{url:'https://cdn.example.org/existing.png',note:'旧版真实路径不可丢失'});
 core.store.db.prepare('INSERT INTO briefs VALUES(?,?,?,?)').run('br_v47','old',new Date().toISOString(),JSON.stringify({privateText:'test fixture'}));
 core.close();const before=md5(db);
 const result=await integrationRehearsal(db);
 assert.equal(result.existingRowsUnchanged,true);
 assert.equal(result.historicProjectsInspected,1);
 assert.equal(md5(db),before);
 const reopened=createCore(db);
 try{
  assert.equal(reopened.editorial.list().length,1);
  assert.equal(reopened.editorial.get(doc.id).title,'历史素材和人工审核回归');
  assert.equal(Buffer.from(reopened.assets.preview(asset.id).body).toString('base64'),png);
  assert.equal(reopened.assets.get(asset.id).mappings[0].url,'https://cdn.example.org/existing.png');
 }finally{reopened.close()}
});
test('V47 fails when restored historical contents are tampered with during candidate bootstrap',async t=>{
 const db=join(dir(t),'old.sqlite');oldSchema(db);const before=md5(db);
 await assert.rejects(()=>integrationRehearsal(db,{makeCore:path=>{
  const core=createCore(path);
  core.store.db.prepare('UPDATE article_document_revisions SET paragraphs_json=? WHERE rowid=(SELECT MIN(rowid) FROM article_document_revisions)')
   .run('[{"id":"fake","text":"silently changed"}]');
  return core;
 }}),/Historical user data changed during candidate initialization/);
 assert.equal(md5(db),before);
});
test('V47 historical inventory catches same-row-count binary tampering and missing tables',t=>{
 const path=join(dir(t),'historical.sqlite'),core=createCore(path);
 const asset=core.assets.upload({name:'historical.png',alt:'本地素材',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII='});
 const original=historicalInventory(core.store.db);
 const raw=Buffer.from(core.assets.preview(asset.id).body);
 raw[raw.length-4]^=1;
 core.store.db.prepare('UPDATE content_assets SET body=? WHERE id=?').run(raw,asset.id);
 const wrong=checkHistoricalInventory(core.store.db,original);
 assert.equal(wrong.passed,false);
 assert.ok(wrong.changedTables.includes('content_assets'));
 core.store.db.exec('DROP TABLE content_assets');
 const missing=checkHistoricalInventory(core.store.db,original);
 assert.ok(missing.missingTables.includes('content_assets'));
 core.close();
});
test('V47 requires explicit DB and refuses accidental implicit default',async()=>{
 await assert.rejects(()=>integrationRehearsal(),/Explicit --db path required/);
 await assert.rejects(()=>integrationRehearsal(''),/Explicit --db path required/);
});

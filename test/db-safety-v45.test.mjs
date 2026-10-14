import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync,appendFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createCore} from '../lib/core.mjs';
import {Store} from '../src/store.mjs';
import {VerificationService} from '../src/verification.mjs';
import {KnowledgeService} from '../src/knowledge.mjs';
import {PrecisionService} from '../src/precision.mjs';
import {EditorialService} from '../src/editorial.mjs';
import {createBackup,restoreBackup,verifyBackup,inspectDatabase,rehearseUpgrade,runCommand} from '../scripts/db-safety.mjs';

const fresh=t=>{
 const root=mkdtempSync(join(tmpdir(),'v45-db-test-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 return root;
};
const makeArticle=(core,title='数据库恢复演练中的文章')=>core.editorial.create({title,paragraphs:[
 {text:'这是属于本地数据库的真实持久化文章测试内容，备份必须完整保留证据、正文和历史。'},
 {text:'SQLite WAL 日志中的提交也应完整进入恢复后的副本，不能只复制主库文件。'}
]});
test('V45 creates verified manifest-backed SQLite backup from an open WAL database',async t=>{
 const dir=fresh(t),database=join(dir,'active.sqlite');
 const core=createCore(database);
 const article=makeArticle(core);
 core.store.db.exec('PRAGMA wal_autocheckpoint=0');
 core.store.db.prepare('INSERT INTO briefs(id,event_id,created_at,snapshot) VALUES(?,?,?,?)').run(
  'br_v45','test-v45',new Date().toISOString(),JSON.stringify({testing:true,v:45}));
 const result=await createBackup(database,{outputPath:join(dir,'backups','first.sqlite')});
 assert.equal(result.verified,true);assert.equal(result.walSafe,true);
 assert.equal(result.sourceUntouched,true);assert.equal(existsSync(result.output),true);
 assert.equal(existsSync(result.manifest),true);
 const manifest=JSON.parse(readFileSync(result.manifest,'utf8'));
 assert.equal(manifest.bytes,statSync(result.output).size);
 assert.match(manifest.sha256,/^[a-f0-9]{64}$/);
 const check=await verifyBackup(result.output);
 assert.equal(check.backupValid,true);assert.equal(check.manifestVerified,true);
 const copy=new DatabaseSync(result.output,{readOnly:true});
 try{
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM editorial_projects').get().n,1);
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM briefs').get().n,1);
  assert.equal(copy.prepare('SELECT payload FROM article_documents WHERE reference_id=?').get(article.channels.master.referenceId)?.payload,undefined);
 }finally{copy.close();core.close()}
});
test('V45 restores to a different missing path only and preserves user document revisions',async t=>{
 const dir=fresh(t),src=join(dir,'source.sqlite'),out=join(dir,'checkpoint.sqlite'),target=join(dir,'recovered.sqlite');
 const core=createCore(src),article=makeArticle(core),before=core.editorial.get(article.id);
 core.close();
 const archive=await createBackup(src,{outputPath:out});
 const restored=await restoreBackup(archive.output,target);
 assert.equal(restored.existingDatabaseOverwritten,false);assert.equal(restored.verified,true);
 const reopened=createCore(target);
 try{
  const after=reopened.editorial.get(article.id);
  assert.deepEqual(after.channels.master.document.paragraphs,before.channels.master.document.paragraphs);
  assert.equal(after.channels.wechat.document.revision,before.channels.wechat.document.revision);
 }finally{reopened.close()}
 await assert.rejects(()=>restoreBackup(archive.output,target),/Destination already exists/);
 await assert.rejects(()=>createBackup(src,{outputPath:archive.output}),/Destination already exists/);
 assert.equal(existsSync(src),true);
});
test('V45 backup and restore reject corrupted backup content and missing or forged manifests',async t=>{
 const dir=fresh(t),db=join(dir,'source.sqlite'),out=join(dir,'copy.sqlite');
 const core=createCore(db);makeArticle(core);core.close();
 const a=await createBackup(db,{outputPath:out});
 appendFileSync(out,Buffer.from('forged-trailer'));
 await assert.rejects(()=>verifyBackup(out),/size does not match|SHA256 mismatch/);
 await assert.rejects(()=>restoreBackup(out,join(dir,'unsafe.sqlite')),/size does not match|SHA256 mismatch/);
 assert.equal(existsSync(join(dir,'unsafe.sqlite')),false);
 const manifest=JSON.parse(readFileSync(a.manifest,'utf8'));
 manifest.bytes=statSync(out).size;writeFileSync(a.manifest,JSON.stringify(manifest));
 await assert.rejects(()=>verifyBackup(out),/SHA256 mismatch/);
 rmSync(a.manifest);
 await assert.rejects(()=>verifyBackup(out),/manifest missing or invalid/);
});
test('V45 rehearsal migrates a synthetic legacy SQLite, retains previous article rows and does not change live source',async t=>{
 const dir=fresh(t),db=join(dir,'legacy.sqlite');
 const store=new Store(db);
 const verify=new VerificationService(store);
 const knowledge=new KnowledgeService(store,verify);
 const precision=new PrecisionService(store,verify,knowledge);
 const editorial=new EditorialService(store,knowledge,precision);editorial.attachPrecision();
 const article=editorial.create({title:'迁移前已保存的历史文章',paragraphs:[{text:'V27 legacy user data must survive later schema registration.'}]});
 store.close();
 const sourceBefore=await inspectDatabase(db,{includeTableNames:true});
 assert.ok(sourceBefore.missingCoreTables.includes('article_illustration_plans'));
 const report=await rehearseUpgrade(db,{openWithCore:createCore});
 assert.equal(report.verified,true);
 assert.equal(report.upgradeOpenedSuccessfully,true);
 assert.ok(report.newTables.includes('article_image_quality_reviews'));
 assert.ok(report.newTables.includes('delivery_readiness_snapshots'));
 const sourceAfter=await inspectDatabase(db,{includeTableNames:true});
 assert.deepEqual(sourceAfter,sourceBefore,'rehearsal MUST never initialize the original DB');
 const upgraded=createCore(db);
 try{
  assert.equal(upgraded.editorial.get(article.id).title,article.title);
  assert.equal(upgraded.editorial.get(article.id).channels.master.document.paragraphs[0].text,'V27 legacy user data must survive later schema registration.');
  assert.equal(upgraded.store.db.prepare('SELECT COUNT(*) AS n FROM delivery_readiness_snapshots').get().n,0);
 }finally{upgraded.close()}
});
test('V45 standalone argument validation prevents source overwrite and unintended restore',async t=>{
 const dir=fresh(t),db=join(dir,'source.sqlite'),core=createCore(db);
 makeArticle(core);core.close();
 const checked=await runCommand(['preflight','--db='+db]);
 assert.equal(checked.integrity,'ok');assert.equal(checked.readOnly,true);
 assert.equal(checked.missingCoreTables.length,0);
 await assert.rejects(()=>runCommand(['backup','--db='+db,'--out='+db]),/Source and backup destination must differ/);
 await assert.rejects(()=>runCommand(['restore','--from='+db]),/requires explicit --from and --to/);
 await assert.rejects(()=>runCommand(['preflight','--unknown=1']),/Unexpected or duplicate/);
 const rehearsed=await runCommand(['rehearse','--db='+db]);
 assert.equal(rehearsed.verified,true);
 assert.equal(rehearsed.upgradeOpenedSuccessfully,true);
});

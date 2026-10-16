import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {createCore} from '../lib/core.mjs';
import {createBackup,verifyBackup,inspectDatabase} from '../scripts/db-safety.mjs';
import {collectReleaseEvidence} from '../scripts/operator-release-evidence-v55.mjs';

const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
const candidate='c'.repeat(40),main='d'.repeat(40);
const git={technicalHistoryValid:true,mode:'premerge-candidate',checkedHead:candidate,checkedMain:main};
const manual={
 schemaVersion:'content-studio-v55-manual-review',candidateCommit:candidate,
 deploymentMode:'deployment-paused',operatorRole:'local-operator',
 hostingInventoryReference:'v56-test-host-inventory',rollbackReference:'v56-test-rollback-record',
 backupLocationProtected:true,rollbackInstructionsReviewed:true
};
const args=(db,backup)=>['--db='+db,'--backup='+backup];
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'content-studio-v56-real-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const db=join(root,'source.sqlite'),backup=join(root,'archive','backup.sqlite');
 const core=createCore(db);
 const doc=core.editorial.create({title:'V56真实磁盘文件回归 私有测试文章',paragraphs:[
  {text:'这是用于持久化演练的合成文章内容，不能出现在发布证据报告中。'},
  {text:'This content should survive WAL-safe backup and restored-copy upgrade.'}
 ]});
 const asset=core.assets.upload({name:'v56.png',alt:'V56合成 PNG',base64:image});
 core.assets.setMapping(asset.id,'wechat',{url:'https://cdn.example.org/v56-first.png',note:'这是一条 V56 合成图片的人工映射说明，不代表远程上传'});
 core.assets.setMapping(asset.id,'wechat',{url:'https://cdn.example.org/v56-second.png',note:'V56 合成数据：记录第二次图片映射地址变更，未真实上传'});
 core.store.db.exec('PRAGMA wal_autocheckpoint=0');
 core.store.db.prepare('INSERT INTO briefs VALUES(?,?,?,?)')
  .run('br_v56_test','v56',new Date().toISOString(),JSON.stringify({secret:'SYNTHETIC_PRIVATE_SENTINEL_8F22'}));
 t.after(()=>core.close());
 return {db,backup,doc,asset,core};
}
async function collected(f){
 return collectReleaseEvidence(args(f.db,f.backup),{gitAudit:()=>git,manualReview:manual});
}
test('V56 real WAL SQLite + genuine backup manifest + full restore/rehearsal yields a sanitized, non-deployable packet',{timeout:120000},async t=>{
 const f=fixture(t);
 const before=await inspectDatabase(f.db);
 const backed=await createBackup(f.db,{outputPath:f.backup});
 assert.equal(backed.verified,true);
 assert.equal(backed.walSafe,true);
 assert.equal(existsSync(f.backup+'.manifest.json'),true);
 const srcBackup=await verifyBackup(f.backup);
 assert.equal(srcBackup.schemaSha256,before.schemaSha256);
 assert.equal(srcBackup.rowCountsSha256,before.rowCountsSha256);
 const backupDb=new DatabaseSync(f.backup,{readOnly:true});
 try{
  assert.equal(backupDb.prepare('SELECT COUNT(*) AS n FROM editorial_projects').get().n,1);
  assert.equal(backupDb.prepare('SELECT COUNT(*) AS n FROM content_asset_mapping_history').get().n,1);
  assert.equal(backupDb.prepare('SELECT COUNT(*) AS n FROM briefs').get().n,1);
  const binary=backupDb.prepare('SELECT body FROM content_assets WHERE id=?').get(f.asset.id).body;
  assert.equal(Buffer.from(binary).toString('base64'),image);
 }finally{backupDb.close()}
 const report=await collected(f);
 assert.equal(report.packetComplete,true,JSON.stringify(report.blockers));
 assert.equal(report.localEvidenceComplete,true);
 assert.equal(report.local.databaseInspection,'passed');
 assert.equal(report.local.backupManifest,'passed');
 assert.equal(report.local.backupSchemaMatchesDatabase,true);
 assert.equal(report.local.backupRowCountsMatchDatabase,true);
 assert.equal(report.local.restoredUpgrade,'passed');
 assert.equal(report.local.restoredIntegration,'passed');
 assert.equal(report.local.syntheticOnly,true);
 assert.equal(report.local.originalDatabaseUnchanged,true);
 assert.equal(report.local.temporaryCopiesDeleted,true);
 assert.deepEqual(report.blockers,[]);
 assert.equal(report.hostingWebhookInventoryVerifiedByAutomation,false);
 assert.equal(report.finalHeadCIVerifiedExternally,false);
 assert.equal(report.mergeAuthorized,false);
 assert.equal(report.deployAuthorized,false);
 assert.equal(report.productionReady,false);
 assert.equal(report.realPublishingVerified,false);
 const privateReport=JSON.stringify(report);
 for(const secret of [f.db,f.backup,'SYNTHETIC_PRIVATE_SENTINEL_8F22',f.doc.title,
  manual.hostingInventoryReference])
  assert.ok(!privateReport.includes(secret),'Evidence leaked private content or operator details');
 const after=await inspectDatabase(f.db);
 assert.equal(after.schemaSha256,before.schemaSha256);
 assert.equal(after.rowCountsSha256,before.rowCountsSha256);
 assert.equal(f.core.editorial.get(f.doc.id).title,f.doc.title);
 assert.equal(f.core.assets.get(f.asset.id).mappings[0].url,'https://cdn.example.org/v56-second.png');
});
test('V56 a valid older WAL backup is rejected after the source database gains a new article',{timeout:120000},async t=>{
 const f=fixture(t);
 await createBackup(f.db,{outputPath:f.backup});
 const old=await verifyBackup(f.backup);
 f.core.editorial.create({title:'第二条新文章必须触发旧备份拒绝',paragraphs:[{text:'未进入之前备份的历史正文'}]});
 const live=await inspectDatabase(f.db);
 assert.equal(old.schemaSha256,live.schemaSha256,'schema is still identical; counts must detect drift');
 assert.notEqual(old.rowCountsSha256,live.rowCountsSha256);
 const packet=await collected(f);
 assert.equal(packet.packetComplete,false);
 assert.ok(packet.blockers.includes('backup_row_counts_mismatch'),JSON.stringify(packet.blockers));
 assert.equal(packet.local.backupSchemaMatchesDatabase,true);
 assert.equal(packet.local.backupRowCountsMatchDatabase,false);
 assert.equal(packet.mergeAuthorized,false);
 assert.equal(f.core.editorial.list().length,2,'original live database remains intact');
});
test('V56 refuses a stale but intact backup when private article rows change without any row-count change',{timeout:120000},async t=>{
 const f=fixture(t);
 await createBackup(f.db,{outputPath:f.backup});
 const former=await verifyBackup(f.backup,{includeContentDigest:true});
 const before=await inspectDatabase(f.db,{includeContentDigest:true});
 assert.equal(former.contentSha256,before.contentSha256);
 // In-place content mutation with exactly the same number of rows; the DB is
 // still valid and a naive table-count or schema check would accept it.
 const row=f.core.store.db.prepare('SELECT id, snapshot FROM briefs LIMIT 1').get();
 f.core.store.db.prepare('UPDATE briefs SET snapshot=? WHERE id=?')
  .run(JSON.stringify({secret:'SYNTHETIC_PRIVATE_SENTINEL_EDITED',fixtureVersion:56}),row.id);
 const after=await inspectDatabase(f.db,{includeContentDigest:true});
 assert.equal(former.schemaSha256,after.schemaSha256);
 assert.equal(former.rowCountsSha256,after.rowCountsSha256);
 assert.notEqual(former.contentSha256,after.contentSha256);
 const report=await collected(f);
 assert.equal(report.packetComplete,false);
 assert.equal(report.local.backupRowCountsMatchDatabase,true);
 assert.equal(report.local.backupSchemaMatchesDatabase,true);
 assert.equal(report.local.backupContentMatchesDatabase,false);
 assert.ok(report.blockers.includes('backup_historical_content_mismatch'),JSON.stringify(report.blockers));
 assert.equal(report.mergeAuthorized,false);
});
test('V56 rejects a forged on-disk backup manifest even when the source is valid',{timeout:120000},async t=>{
 const f=fixture(t);
 await createBackup(f.db,{outputPath:f.backup});
 const manifest=JSON.parse(readFileSync(f.backup+'.manifest.json','utf8'));
 manifest.sha256='f'.repeat(64);
 writeFileSync(f.backup+'.manifest.json',JSON.stringify(manifest));
 await assert.rejects(()=>verifyBackup(f.backup),/SHA256 mismatch/);
 const report=await collected(f);
 assert.equal(report.packetComplete,false);
 assert.ok(report.blockers.includes('wal_backup_manifest_not_verified'));
 assert.equal(report.local.backupManifest,'blocked');
 assert.equal(report.mergeAuthorized,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCore} from '../lib/core.mjs';
import {createBackup,inspectDatabase,verifyBackup} from '../scripts/db-safety.mjs';
import {V59_TARGET} from '../scripts/remote-release-evidence-v59.mjs';
import {parseRollbackArgs,validateRollbackInputs,runRollbackDrill} from '../scripts/rollback-drill-v60.mjs';

const SHA='a'.repeat(40),secret='PRIVATE_SYNTHETIC_V60_DO_NOT_LEAK';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
const packet=()=>({kind:'content-studio-v55-operator-release-evidence',candidateCommit:SHA,
 mainCommit:V59_TARGET.mainSha,packetComplete:true,localEvidenceComplete:true,blockers:[],
 local:{originalDatabaseUnchanged:true,backupContentMatchesDatabase:true,
 backupManifest:'passed',restoredUpgrade:'passed',restoredIntegration:'passed'},
 manualReview:{recorded:true},mergeAuthorized:false,deployAuthorized:false,productionReady:false});
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'content-studio-v60-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const db=join(root,'source.sqlite'),backup=join(root,'backup.sqlite'),
  evidence=join(root,'review.json'),scratch=join(root,'protected');
 mkdirSync(scratch,{mode:0o700});chmodSync(scratch,0o700);
 const core=createCore(db);
 const article=core.editorial.create({title:'V60 synthetic original',paragraphs:[{text:secret}]});
 const asset=core.assets.upload({name:'v60.png',alt:'local PNG',base64:png});
 core.assets.setMapping(asset.id,'wechat',{url:'https://cdn.example.org/synthetic-v60.png',note:'manual fixture only'});
 core.store.db.exec('PRAGMA wal_autocheckpoint=0');
 core.store.db.prepare('INSERT INTO briefs VALUES(?,?,?,?)').run('br_v60_synthetic','v60',new Date().toISOString(),JSON.stringify({text:secret}));
 t.after(()=>core.close());
 writeFileSync(evidence,JSON.stringify(packet()));
 return {root,db,backup,evidence,scratch,core,article,asset,sha:SHA};
}
const args=f=>({sha:f.sha,db:f.db,backup:f.backup,evidence:f.evidence,scratch:f.scratch});
const inspect=p=>inspectDatabase(p,{includeContentDigest:true});
const entries=async p=>(await import('node:fs/promises')).readdir(p);

test('V60 parses explicit SHA, protected paths, rejects relative and duplicate arguments',()=>{
 const example={sha:SHA,db:'/tmp/source',backup:'/tmp/archive',scratch:'/tmp/isolated',evidence:'/tmp/evidence'};
 assert.deepEqual(parseRollbackArgs(['--sha='+SHA,'--db='+example.db,'--backup='+example.backup,
  '--scratch-dir='+example.scratch,'--operator-evidence='+example.evidence]),example);
 for(const argv of [[],['--sha=HEAD'],['--sha='+SHA,'--db=relative'],['--sha='+SHA,'--token=secret'],
  ['--sha='+SHA,'--sha='+SHA]])assert.throws(()=>parseRollbackArgs(argv));
});

test('V60 WAL backup+PNG BLOB+faulted copy+new path rollback+core reopen are lossless',
 {timeout:120000},async t=>{
 const f=fixture(t);await createBackup(f.db,{outputPath:f.backup});
 const before=await inspect(f.db),snapshot=await verifyBackup(f.backup,{includeContentDigest:true});
 assert.equal(before.contentSha256,snapshot.contentSha256);
 const report=await runRollbackDrill(args(f));
 assert.equal(report.status,'passed');
 assert.equal(report.rollbackRestoredHistoricalRows,true);
 assert.equal(report.deliberateFaultChangedDisposableCopy,true);
 assert.equal(report.rollbackApplicationOpened,true);
 assert.equal(report.scratchCopiesRemoved,true);
 assert.equal(report.cleanupIsNotSecureErase,true);
 assert.equal(report.mergeAuthorized,false);
 assert.equal(report.deployAuthorized,false);
 assert.equal(report.productionReady,false);
 assert.equal((await inspect(f.db)).contentSha256,before.contentSha256);
 assert.equal((await verifyBackup(f.backup,{includeContentDigest:true})).contentSha256,snapshot.contentSha256);
 assert.equal(f.core.editorial.get(f.article.id).title,'V60 synthetic original');
 assert.equal(f.core.assets.get(f.asset.id).mime,'image/png');
 assert.deepEqual(await entries(f.scratch),[]);
 for(const value of [secret,f.db,f.backup,f.evidence,f.scratch])
  assert.equal(JSON.stringify(report).includes(value),false);
});
test('V60 mismatch in operator SHA stops before making copies',async t=>{
 const f=fixture(t);await createBackup(f.db,{outputPath:f.backup});
 const bad=packet();bad.candidateCommit='b'.repeat(40);
 writeFileSync(f.evidence,JSON.stringify(bad));
 await assert.rejects(()=>runRollbackDrill(args(f)),/evidence is not complete/);
 assert.deepEqual(await entries(f.scratch),[]);
});
test('V60 stale but intact backup with same row-count edit is rejected',async t=>{
 const f=fixture(t);await createBackup(f.db,{outputPath:f.backup});
 f.core.store.db.prepare('UPDATE briefs SET snapshot=? WHERE id=?')
  .run(JSON.stringify({text:'EDITED_WITH_SAME_ROW_COUNT'}),'br_v60_synthetic');
 await assert.rejects(()=>runRollbackDrill(args(f)),/not identical/);
});
test('V60 altered manifest SHA fails closed without source damage',async t=>{
 const f=fixture(t);await createBackup(f.db,{outputPath:f.backup});
 const before=await inspect(f.db),manifest=JSON.parse(readFileSync(f.backup+'.manifest.json','utf8'));
 manifest.sha256='f'.repeat(64);writeFileSync(f.backup+'.manifest.json',JSON.stringify(manifest));
 await assert.rejects(()=>runRollbackDrill(args(f)),/SHA256 mismatch/);
 assert.equal((await inspect(f.db)).contentSha256,before.contentSha256);
});
test('V60 refuses linked evidence and shared-access scratch',async t=>{
 const f=fixture(t);await createBackup(f.db,{outputPath:f.backup});
 const linked=join(f.root,'linked.json');symlinkSync(f.evidence,linked);
 await assert.rejects(()=>validateRollbackInputs({...args(f),evidence:linked}),/regular local files/);
 if(process.platform!=='win32'){
  chmodSync(f.scratch,0o755);
  await assert.rejects(()=>validateRollbackInputs(args(f)),/Scratch must not be accessible/);
 }
});
test('V60 refuses alias of source/backup or source symlink',async t=>{
 const f=fixture(t);await createBackup(f.db,{outputPath:f.backup});
 await assert.rejects(()=>runRollbackDrill({...args(f),backup:f.db}),/distinct/);
 const linked=join(f.root,'linked.sqlite');symlinkSync(f.db,linked);
 await assert.rejects(()=>runRollbackDrill({...args(f),db:linked}),/regular local files/);
});
test('V60 fault injection failure cleans temporary copies and source stays intact',async t=>{
 const f=fixture(t);await createBackup(f.db,{outputPath:f.backup});
 const before=await inspect(f.db);
 await assert.rejects(()=>runRollbackDrill(args(f),{applyFault:()=>{throw Error('synthetic fault')}}),/synthetic fault/);
 assert.deepEqual(await entries(f.scratch),[]);
 assert.equal((await inspect(f.db)).contentSha256,before.contentSha256);
});
test('V60 incomplete operator packet never enters rollback exercise',async t=>{
 const f=fixture(t);await createBackup(f.db,{outputPath:f.backup});
 writeFileSync(f.evidence,JSON.stringify({candidateCommit:SHA}));
 await assert.rejects(()=>runRollbackDrill(args(f)),/evidence is not complete/);
 assert.deepEqual(await entries(f.scratch),[]);
});

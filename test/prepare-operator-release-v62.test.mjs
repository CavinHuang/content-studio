import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,chmodSync,symlinkSync,readFileSync,existsSync} from 'node:fs';
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCore} from '../lib/core.mjs';
import {inspectDatabase,verifyBackup} from '../scripts/db-safety.mjs';
import {collectReleaseEvidence} from '../scripts/operator-release-evidence-v55.mjs';
import {V59_TARGET} from '../scripts/remote-release-evidence-v59.mjs';
import {runOperatorAcceptance} from '../scripts/operator-acceptance-v61.mjs';
import {parsePrepareArgs,validatePreparePaths,snapshotUnchanged,
 createVerifiedOperatorSnapshot,runPreparedAcceptance
} from '../scripts/prepare-operator-release-v62.mjs';

const sha='a'.repeat(40),sentinel='V62_SYNTHETIC_CONTENT_PRIVATE';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
const remote=(withPacket=false)=>({candidateCommit:sha,
 githubCI:{githubCheckPassed:true,githubApiWasQueried:true,checks:{
 push:{runId:110},pull_request:{runId:111}}},
 operatorPacket:{recorded:withPacket,independentlyVerified:false},
 technicalEvidenceComplete:withPacket,releaseAuthorized:false,
 mergeAuthorized:false,deployAuthorized:false,productionReady:false});
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'cs-v62-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const paths={sha,root,db:join(root,'live.sqlite'),review:join(root,'review.json'),
  backupDir:join(root,'private-backups'),scratch:join(root,'private-scratch')};
 for(const path of [paths.backupDir,paths.scratch]){mkdirSync(path,{mode:0o700});chmodSync(path,0o700)}
 writeFileSync(paths.review,JSON.stringify({schemaVersion:'content-studio-v55-manual-review',
  candidateCommit:sha,deploymentMode:'deployment-paused',operatorRole:'synthetic-tester',
  hostingInventoryReference:'local-host-review-test',
  rollbackReference:'tested-rollback-plan-ref',
  backupLocationProtected:true,rollbackInstructionsReviewed:true}));
 const core=createCore(paths.db),article=core.editorial.create({
  title:sentinel,paragraphs:[{text:sentinel}]});
 const asset=core.assets.upload({name:'v62.png',alt:'synthetic',base64:png});
 core.assets.setMapping(asset.id,'wechat',{url:'https://cdn.example.org/v62.png',
  note:'Synthetic manually mapped image'});
 core.store.db.exec('PRAGMA wal_autocheckpoint=0');
 core.store.db.prepare('INSERT INTO briefs VALUES(?,?,?,?)').run('v62_private','fixture',
  new Date().toISOString(),JSON.stringify({text:sentinel}));
 t.after(()=>core.close());
 return {...paths,core,article,asset};
}
test('V62 strict CLI requires explicit SHA, four absolute distinct paths',()=>{
 const args=['--sha='+sha,'--db=/tmp/a','--backup-dir=/tmp/b',
 '--review=/tmp/c','--scratch-dir=/tmp/d'];
 assert.deepEqual(parsePrepareArgs(args),{sha,db:'/tmp/a',backupDir:'/tmp/b',
  review:'/tmp/c',scratch:'/tmp/d'});
 for(const bad of [[],['--sha=HEAD'],[...args,'--sha='+sha],
  args.map(x=>x.startsWith('--db=')?'--db=relative.sqlite':x),
  [...args,'--publish=yes']])assert.throws(()=>parsePrepareArgs(bad));
});
test('V62 makes WAL-consistent new backup while preserving source and PNG bytes',async t=>{
 const f=fixture(t),original=await inspectDatabase(f.db,{includeContentDigest:true});
 const ready=await createVerifiedOperatorSnapshot(f);
 assert.ok(ready.backupFilename.includes(sha.slice(0,12)));
 assert.equal(ready.manifestAndFullContentVerified,true);
 assert.equal(ready.sourceStableAcrossBackup,true);
 assert.equal(existsSync(ready.backupPath),true);
 assert.ok((await readdir(f.backupDir)).every(name=>name.endsWith('.sqlite')||name.endsWith('.sqlite.manifest.json')),
  'A committed backup must not rely on leftover SQLite WAL/SHM or temp files');
 const backed=await verifyBackup(ready.backupPath,{includeContentDigest:true});
 assert.equal(backed.contentSha256,original.contentSha256);
 assert.equal((await inspectDatabase(f.db,{includeContentDigest:true})).contentSha256,original.contentSha256);
 assert.equal(f.core.editorial.get(f.article.id).title,sentinel);
 assert.equal(f.core.assets.get(f.asset.id).mime,'image/png');
});
test('V62 makes two distinct backups without overwriting first archive',async t=>{
 const f=fixture(t);
 const first=await createVerifiedOperatorSnapshot(f);
 const second=await createVerifiedOperatorSnapshot(f);
 assert.notEqual(first.backupPath,second.backupPath);
 assert.equal((await verifyBackup(first.backupPath)).manifestVerified,true);
 assert.equal((await verifyBackup(second.backupPath)).manifestVerified,true);
});
test('V62 refuses source mutation during snapshot and discards newly made stale archive',async t=>{
 const f=fixture(t);
 const {createBackup}=await import('../scripts/db-safety.mjs');
 const fail=async(db,{outputPath})=>{
  const report=await createBackup(db,{outputPath});
  f.core.store.db.prepare('UPDATE briefs SET snapshot=? WHERE id=?')
   .run(JSON.stringify({text:'CHANGED_WITH_SAME_ROW_COUNT'}),'v62_private');
  return report;
 };
 await assert.rejects(()=>createVerifiedOperatorSnapshot(f,{backup:fail}),/Cannot prepare/);
 assert.deepEqual(await readdir(f.backupDir),[]);
});
test('V62 fails on forged manifest and cleans created archive',async t=>{
 const f=fixture(t);
 const {createBackup}=await import('../scripts/db-safety.mjs');
 const forge=async(db,{outputPath})=>{
  const saved=await createBackup(db,{outputPath});
  const file=outputPath+'.manifest.json';
  const manifest=JSON.parse(readFileSync(file,'utf8'));
  manifest.sha256='f'.repeat(64);writeFileSync(file,JSON.stringify(manifest));
  return saved;
 };
 await assert.rejects(()=>createVerifiedOperatorSnapshot(f,{backup:forge}),/Cannot prepare/);
 assert.deepEqual(await readdir(f.backupDir),[]);
});
test('V62 checks private directories, symlinks and disallows overlapping backup and scratch',async t=>{
 const f=fixture(t),link=join(f.root,'backup-link');
 symlinkSync(f.backupDir,link);
 await assert.rejects(()=>validatePreparePaths({...f,backupDir:link}),/real directory/);
 await assert.rejects(()=>validatePreparePaths({...f,scratch:f.backupDir}),/overlapping/);
 if(process.platform!=='win32'){
  chmodSync(f.backupDir,0o755);
  await assert.rejects(()=>validatePreparePaths(f),/not private/);
 }
});
test('V62 initial red CI denies backup and any private source reads',async t=>{
 const f=fixture(t);let called=false;
 await assert.rejects(()=>runPreparedAcceptance(f,{assertHead:()=>true,
  remote:async()=>({...remote(),githubCI:{githubCheckPassed:false,githubApiWasQueried:true}}),
  paths:async()=>{called=true;return f;}}),/GitHub CI/);
 assert.equal(called,false);assert.deepEqual(await readdir(f.backupDir),[]);
});
test('V62 wrong manual review SHA prevents snapshot creation',async t=>{
 const f=fixture(t);
 const document=JSON.parse(readFileSync(f.review,'utf8'));
 document.candidateCommit='b'.repeat(40);
 writeFileSync(f.review,JSON.stringify(document));
 await assert.rejects(()=>runPreparedAcceptance(f,{assertHead:()=>true,remote:async()=>remote()}),
  /Reviewed host declaration/);
 assert.deepEqual(await readdir(f.backupDir),[]);
});
test('V62 rejects failed V61 result; does not claim deployment authority',async t=>{
 const f=fixture(t);
 await assert.rejects(()=>runPreparedAcceptance(f,{assertHead:()=>true,
  remote:async()=>remote(),accept:async()=>({candidateCommit:sha,reviewReady:false})}),
 /technical acceptance was not completed/);
 const names=await readdir(f.backupDir);
 assert.ok(names.some(x=>x.endsWith('.sqlite')),'valid recovery snapshot is retained for operator');
});
test('V62 full local synthetic WAL backup -> V55 -> V60 -> V61 operator chain', {timeout:180000},async t=>{
 const f=fixture(t),before=await inspectDatabase(f.db,{includeContentDigest:true});
 const result=await runPreparedAcceptance(f,{assertHead:()=>true,remote:async()=>remote(),
  accept:args=>runOperatorAcceptance(args,{
   assertHead:()=>true,remote:async o=>remote(!!o['operator-evidence']),
   local:opts=>collectReleaseEvidence(opts,{gitAudit:()=>({
    technicalHistoryValid:true,mode:'premerge-candidate',
    checkedHead:sha,checkedMain:V59_TARGET.mainSha})})
  })
 });
 assert.equal(result.reviewReady,true);
 assert.equal(result.v61TechnicalAcceptancePassed,true);
 assert.equal(result.backupManifestAndHistoryVerified,true);
 assert.equal(result.mergeAuthorized,false);
 assert.equal(result.deployAuthorized,false);
 assert.equal(result.productionReady,false);
 assert.equal(result.externalHostingIndependentlyVerified,false);
 assert.equal(result.encryptionVerifiedBySoftware,false);
 assert.deepEqual(await readdir(f.scratch),[]);
 assert.equal((await inspectDatabase(f.db,{includeContentDigest:true})).contentSha256,before.contentSha256);
 assert.equal(f.core.editorial.get(f.article.id).title,sentinel);
 const report=JSON.stringify(result);
 for(const text of [f.db,f.review,f.backupDir,f.scratch,sentinel])assert.ok(!report.includes(text));
});

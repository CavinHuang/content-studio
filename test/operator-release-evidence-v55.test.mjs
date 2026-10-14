import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
 parseEvidenceArgs,assessOperatorReview,composeReleaseEvidence,
 collectReleaseEvidence,readOperatorReview
} from '../scripts/operator-release-evidence-v55.mjs';

const head='a'.repeat(40),main='b'.repeat(40);
const git={technicalHistoryValid:true,mode:'premerge-candidate',checkedHead:head,checkedMain:main};
const local={database:{status:'passed',schemaSha256:'same'},
 backup:{status:'passed',schemaSha256:'same',manifestVerified:true},
 upgrade:{status:'passed',historicalRowsPreserved:true,sourceUntouched:true,temporaryCopiesDeleted:true},
 integration:{status:'passed',historicalRowsUnchanged:true,syntheticOnly:true},
 localBlockers:[],candidateGatesPassed:true};
const manual={schemaVersion:'content-studio-v55-manual-review',candidateCommit:head,
 deploymentMode:'deployment-paused',operatorRole:'deployment-owner',
 hostingInventoryReference:'internal-change-record-53',
 rollbackReference:'release-rollback-record-22',
 backupLocationProtected:true,rollbackInstructionsReviewed:true};
test('V55 refuses implicit file paths, duplicates, same source and archive, unknown CLI parameters',()=>{
 for(const args of [[],['--db=relative.sqlite','--backup=/secure/snapshot.sqlite'],
  ['--db=/data/db.sqlite','--backup=/data/db.sqlite'],
  ['--db=/data/db.sqlite','--backup=/backup/one.sqlite','--backup=/backup/two.sqlite'],
  ['--db=/data/db.sqlite','--backup=/backup/one.sqlite','--token=secret']])
  assert.throws(()=>parseEvidenceArgs(args));
 const parsed=parseEvidenceArgs(['--db=/trusted/private.sqlite','--backup=/encrypted/backup.sqlite']);
 assert.deepEqual(parsed,{db:'/trusted/private.sqlite',backup:'/encrypted/backup.sqlite'});
 const win=parseEvidenceArgs(['--db=C:\\Users\\owner\\db.sqlite',
  '--backup=D:\\Encrypted\\backup.sqlite']);
 assert.equal(win.db,'C:\\Users\\owner\\db.sqlite');
});
test('V55 refuses unreviewed manual manifest and never mislabels operator declarations as external proof',()=>{
 const unreviewed=assessOperatorReview(null,head);
 assert.equal(unreviewed.recorded,false);
 assert.equal(unreviewed.outsideGitHubVerifiedByAutomation,false);
 const reviewed=assessOperatorReview(manual,head);
 assert.equal(reviewed.recorded,true);
 assert.equal(reviewed.manualDeploymentReview,'operator_declaration_recorded');
 assert.equal(reviewed.outsideGitHubVerifiedByAutomation,false);
 const stale=assessOperatorReview({...manual,candidateCommit:main},head);
 assert.equal(stale.recorded,false);
 assert.ok(stale.findings.includes('candidate_commit_mismatch'));
});
test('V55 manifest blocks missing host inventory, unsafe free text and no rollback check',()=>{
 for(const update of [
  {hostingInventoryReference:''},{hostingInventoryReference:'https://secret.example.com/token'},
  {operatorRole:'password=foo'},{rollbackReference:'C:\\Secret\\backups'},
  {rollbackInstructionsReviewed:false},{backupLocationProtected:false},
  {deploymentMode:'unknown'},{candidateCommit:'not-sha'},
  {schemaVersion:'unknown'}
 ]){
  const result=assessOperatorReview({...manual,...update},head);
  assert.equal(result.recorded,false,JSON.stringify(update));
  assert.ok(result.findings.length);
 }
});
test('V55 good source and restore proof creates sanitized complete packet but never authorizes a merge',()=>{
 const report=composeReleaseEvidence({git,local,manual});
 assert.equal(report.packetComplete,true);
 assert.equal(report.localEvidenceComplete,true);
 assert.deepEqual(report.blockers,[]);
 assert.equal(report.candidateCommit,head);
 assert.equal(report.local.originalDatabaseUnchanged,true);
 assert.equal(report.local.backupSchemaMatchesDatabase,true);
 assert.equal(report.manualReview.recorded,true);
 assert.equal(report.finalHeadCIVerifiedExternally,false);
 assert.equal(report.hostingWebhookInventoryVerifiedByAutomation,false);
 assert.equal(report.mergeAuthorized,false);
 assert.equal(report.deployAuthorized,false);
 assert.equal(report.productionReady,false);
 assert.equal(report.realPublishingVerified,false);
});
test('V55 refuses green packet if backup manifest, synthetic rehearsal, unchanged originals or Git are missing',()=>{
 const situations=[
  [{...local,backup:{...local.backup,status:'blocked'}},git,'wal_backup_manifest_not_verified'],
  [{...local,backup:{...local.backup,manifestVerified:false}},git,'wal_backup_manifest_not_verified'],
  [{...local,backup:{...local.backup,schemaSha256:'other'}},git,'backup_schema_mismatch'],
  [{...local,upgrade:{...local.upgrade,sourceUntouched:false}},git,'restored_copy_upgrade_unverified'],
  [{...local,upgrade:{...local.upgrade,temporaryCopiesDeleted:false}},git,'restored_copy_upgrade_unverified'],
  [{...local,integration:{...local.integration,syntheticOnly:false}},git,'restored_copy_channel_acceptance_unverified'],
  [{...local,candidateGatesPassed:false},git,'local_release_admission_blocked'],
  [local,{...git,technicalHistoryValid:false},'candidate_git_history_unverified'],
  [local,{...git,mode:'integrated-mainline'},'not_a_premerge_candidate'],
  [local,{...git,checkedHead:'invalid'},'candidate_commit_unresolved']
 ];
 for(const [unsafe,g,expected] of situations){
  const report=composeReleaseEvidence({git:g,local:unsafe,manual});
  assert.equal(report.packetComplete,false,expected);
  assert.ok(report.blockers.includes(expected),JSON.stringify(report.blockers));
  assert.equal(report.mergeAuthorized,false);
 }
});
test('V55 never serializes private DB paths, model keys or free-form manual declarations',()=>{
 const secrets={
  ...local, database:{...local.database,path:'/Users/private/real.sqlite',rows:['SECRET_ARTICLE']},
  providerContracts:[{apiKey:'sk-super-private-token'}]
 };
 const report=composeReleaseEvidence({git,local:secrets,manual:{...manual,
  privateNote:'sk-super-private-token',actualSource:'/Users/private/real.sqlite'}});
 const serialized=JSON.stringify(report);
 for(const fragment of ['SECRET_ARTICLE','sk-super-private-token','/Users/private/real.sqlite','internal-change-record-53'])
  assert.equal(serialized.includes(fragment),false,fragment);
 assert.equal(report.packetComplete,true);
});
test('V55 Git fails before opening any real database, even if misleading CLI paths are supplied',async()=>{
 let calls=0;
 const report=await collectReleaseEvidence(['--db=/trusted/source.sqlite','--backup=/trusted/backup.sqlite'],{
  gitAudit:()=>({...git,technicalHistoryValid:false}),admission:async()=>{calls++;return local}
 });
 assert.equal(calls,0);
 assert.equal(report.packetComplete,false);
 assert.ok(report.blockers.includes('candidate_git_history_unverified'));
});
test('V55 explicitly exercises the existing database backup and restore admission workflow',async()=>{
 let used=null;
 const report=await collectReleaseEvidence(['--db=/trusted/source.sqlite','--backup=/trusted/backup.sqlite'],{
  gitAudit:()=>git,
  admission:async args=>{used=args;return local},
  manualReview:manual
 });
 assert.deepEqual(used,['--db=/trusted/source.sqlite','--backup=/trusted/backup.sqlite',
  '--rehearse','--integration']);
 assert.equal(report.packetComplete,true);
});
test('V55 operator manifest is read from a small regular local file, not symlink or large input',t=>{
 const dir=mkdtempSync(join(tmpdir(),'content-studio-v55-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'review.json');
 writeFileSync(file,JSON.stringify(manual));
 assert.deepEqual(readOperatorReview(file),manual);
 const link=join(dir,'linked.json');
 symlinkSync(file,link);
 assert.throws(()=>readOperatorReview(link),/regular local JSON/);
 const huge=join(dir,'oversized.json');
 writeFileSync(huge,' '.repeat(4097));
 assert.throws(()=>readOperatorReview(huge),/smaller than 4 KiB/);
});
test('V55 insufficient local evidence leaves every approval and real publishing status blocked',()=>{
 const report=composeReleaseEvidence({git,local,manual:null});
 assert.equal(report.localEvidenceComplete,true);
 assert.equal(report.packetComplete,false);
 assert.deepEqual(report.blockers,['external_deployment_review_not_recorded']);
 assert.equal(report.hostingWebhookInventoryVerifiedByAutomation,false);
 assert.equal(report.operatorMergeApproval,'not_obtained');
 assert.equal(report.mergeAuthorized,false);
});

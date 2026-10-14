import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {blankHostInventory,inspectHostReadiness} from '../scripts/host-inventory-v66.mjs';
import {reviewOperatorRelease as realReviewOperatorRelease,parseReviewArgs,requireHostReview,
 requireRuntimeReview,requirePreparedReview} from '../scripts/operator-review-v67.mjs';

const sha='a'.repeat(40),other='b'.repeat(40);
const reviewOperatorRelease=(input,opts={})=>
 realReviewOperatorRelease(input,{
  separate:()=>({candidateSeparatedFromSource:true}),
  isolate:()=>({candidateIsolated:true,connectedCandidateIdentityMatched:true}),
  verifyOs:()=>({candidateOsBoundaryVerified:true}),
  ...opts
 });
const privateText='SYNTHETIC_PRIVATE_TEXT_NOT_IN_RESULT';
function entries(){
 return ['--sha='+sha,'--db=/private/studio.sqlite','--candidate-db=/secure/isolated-candidate.sqlite',
 '--backup-dir=/secure/backup','--scratch-dir=/secure/scratch',
 '--review=/secure/review.json','--inventory=/secure/inventory.json',
 '--url=http://127.0.0.1:4312/'];
}
const safe={
 releaseAuthorized:false,mergeAuthorized:false,deployAuthorized:false,
 productionReady:false
};
const host=()=>({
 kind:'content-studio-v66-host-preflight',candidateCommit:sha,
 reviewReady:true,hostInventoryRecorded:true,v55ReviewRecorded:true,
 storageSpaceSufficient:true,storageDirectoriesPrivate:true,
 npmLockMetadataVerified:true,encryptedStorageVerifiedBySoftware:false,
 externalHostingIndependentlyVerified:false,githubWorkflowFiles:2,
 heuristicDeploymentMentions:0,backupAndScratchSameDevice:true,
 backupSharesDbFilesystem:true,blockers:[],...safe
});
const runtime=()=>({
 kind:'content-studio-v64-serving-build-probe',candidateCommit:sha,
 localBuildIntegrityVerified:true,servingProcessDeclarationMatchesBuild:true,
 independentProcessBinaryAttestation:false,
 artifactDigestSha256:'c'.repeat(64),dependencyLockSha256:'d'.repeat(64),
 buildId:'synthetic-next-build',observedDatabaseIdentity:'b'.repeat(64),
 observedOsIsolation:{sourcePathTag:'c'.repeat(64),processUid:21345,
  sourceAccessDenied:true,candidateFileOwnedByProcess:true,
  protectedWalSidecarsChecked:true,verifiedAtLauncher:true},observedProcessPid:1234,
 observedNonce:'e'.repeat(32),...safe
});
const backup=()=>({
 kind:'content-studio-v62-prepared-operator-acceptance',
 candidateCommit:sha,reviewReady:true,newWalBackupCreated:true,
 backupManifestAndHistoryVerified:true,sourceStableAcrossBackup:true,
 v61TechnicalAcceptancePassed:true,backupRetainedForOperator:true,
 externalHostingIndependentlyVerified:false,
 encryptionVerifiedBySoftware:false,
 backupFilename:'content-studio-pre-release-'+sha.slice(0,12)+'-'+'f'.repeat(16)+'.sqlite',
 ...safe
});
const deps=()=>({host:async()=>host(),runtime:async()=>runtime(),prepare:async()=>backup()});
test('V67 accepts only pinned SHA, five absolute paths and loopback URL',()=>{
 assert.equal(parseReviewArgs(entries()).url,'http://127.0.0.1:4312');
 for(const bad of [[],[...entries(),'--sha='+sha],
  entries().map(x=>x.startsWith('--db=')?'--db=relative':x),
  entries().map(x=>x.startsWith('--candidate-db=')?'--candidate-db=relative':x),
  entries().map(x=>x.startsWith('--url=')?'--url=https://example.com':x),
  [...entries(),'--token=PRIVATE']])
  assert.throws(()=>parseReviewArgs(bad));
});
test('V67 stages execute in correct order, before DB backup and after runtime',async()=>{
 const calls=[];
 const d={host:async()=>{calls.push('host');return host()},
  runtime:async()=>{calls.push('runtime');return runtime()},
  prepare:async()=>{calls.push('prepare');return backup()}};
 const result=await reviewOperatorRelease(parseReviewArgs(entries()),d);
 assert.deepEqual(calls,['host','runtime','prepare','runtime','host']);
 assert.equal(result.technicalReviewReady,true);
 assert.equal(result.mergeAuthorized,false);
 assert.equal(result.deployAuthorized,false);
 assert.equal(result.externalHostingIndependentlyVerified,false);
 assert.equal(result.approvalDocumentProduced,false);
 for(const word of ['/private/studio','/secure/backup',privateText])
  assert.equal(JSON.stringify(result).includes(word),false);
});
test('V67 unreviewed/active hosting prevents any runtime probe or private backup',async()=>{
 let calls=0;
 await assert.rejects(()=>reviewOperatorRelease(parseReviewArgs(entries()),{
  host:async()=>({...host(),hostInventoryRecorded:false,reviewReady:false}),
  runtime:async()=>{calls++;return runtime()},prepare:async()=>{calls++;return backup()}
 }),/V66 private host/);
 assert.equal(calls,0);
});
test('V67 runtime mismatch prevents original DB inspection and backup',async()=>{
 let backups=0;
 await assert.rejects(()=>reviewOperatorRelease(parseReviewArgs(entries()),{
  host:async()=>host(),runtime:async()=>({...runtime(),dependencyLockSha256:other}),
  prepare:async()=>{backups++;return backup()}
 }),/V64 candidate/);
 assert.equal(backups,0);
});
test('V67 refuses V62 report without actual restored-copy and manifest flags',async()=>{
 await assert.rejects(()=>reviewOperatorRelease(parseReviewArgs(entries()),{
  ...deps(),prepare:async()=>({...backup(),backupManifestAndHistoryVerified:false})
 }),/V62 backup/);
});
test('V67 detects candidate process restart between real backup and final check',async()=>{
 let n=0;
 await assert.rejects(()=>reviewOperatorRelease(parseReviewArgs(entries()),{
  ...deps(),runtime:async()=>({...runtime(),observedNonce:(++n===1?'1':'2').repeat(32)})
 }),/process or build changed/);
});
test('V67 rejects final preflight becoming unsafe after backup',async()=>{
 let n=0;
 await assert.rejects(()=>reviewOperatorRelease(parseReviewArgs(entries()),{
  ...deps(),host:async()=>++n===1?host():{...host(),storageSpaceSufficient:false}
 }),/V66 private host/);
});
test('V67 detects repository workflow inventory changes midflight',async()=>{
 let n=0;
 await assert.rejects(()=>reviewOperatorRelease(parseReviewArgs(entries()),{
  ...deps(),host:async()=>({...host(),githubWorkflowFiles:++n})
 }),/inventory changed/);
});
test('V67 refuses missing or unsafe backup basename to avoid displaying operator paths',()=>{
 assert.throws(()=>requirePreparedReview({...backup(),backupFilename:'/private/a'},sha),/V62 backup/);
 assert.throws(()=>requirePreparedReview({...backup(),backupFilename:'../archive.sqlite'},sha),/V62 backup/);
});
test('V67 requires false authorization on all three independent stage results',()=>{
 for(const patch of [{mergeAuthorized:true},{deployAuthorized:true},{productionReady:true}]){
  assert.throws(()=>requireHostReview({...host(),...patch},sha));
  assert.throws(()=>requireRuntimeReview({...runtime(),...patch},sha));
  assert.throws(()=>requirePreparedReview({...backup(),...patch},sha));
 }
});
test('V67 cannot launder candidate SHA mismatch across stage reports',async()=>{
 for(const step of ['host','runtime','prepare']){
  const config=deps(),base=config[step];
  config[step]=async()=>({...await base(),candidateCommit:other});
  await assert.rejects(()=>reviewOperatorRelease(parseReviewArgs(entries()),config));
 }
});
test('V67 real V66 filesystem preflight on synthetic private files rejects unsafe host before backup',async t=>{
 const cwd=mkdtempSync(join(tmpdir(),'cs-v67-host-'));
 t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 const db=join(cwd,'database.sqlite'),review=join(cwd,'review.json'),
  inventory=join(cwd,'hosting.json'),backupDir=join(cwd,'backups'),
  scratchDir=join(cwd,'scratch');
 for(const dir of [backupDir,scratchDir]){mkdirSync(dir,{mode:0o700});chmodSync(dir,0o700)}
 writeFileSync(db,Buffer.alloc(4096));chmodSync(db,0o600);
 writeFileSync(review,JSON.stringify({schemaVersion:'content-studio-v55-manual-review',
  candidateCommit:sha,deploymentMode:'deployment-paused',operatorRole:'synthetic-host',
  hostingInventoryReference:'synthetic-inventory-reference',
  rollbackReference:'synthetic-rollback-reference',backupLocationProtected:true,
  rollbackInstructionsReviewed:true}));
 writeFileSync(inventory,JSON.stringify({...blankHostInventory(sha),
  githubActionsReviewed:true,externalHostingReviewed:true,
  mainPushTrigger:'ci-only',externalDeployHook:'paused',
  allAutomaticDeploymentPaused:true,backupVolumeEncryptionReviewed:true,
  rollbackOwnerReviewed:true,localOnlyAccessReviewed:true}));
 mkdirSync(join(cwd,'.github','workflows'),{recursive:true});
 writeFileSync(join(cwd,'.github','workflows','ci.yml'),'name: test\njobs:\n  test: {}\n');
 const opts={sha,db,candidateDb:join(cwd,'isolated-candidate.sqlite'),backupDir,scratchDir,review,inventory,url:'http://127.0.0.1:4312'};
 const deps2={host:async o=>inspectHostReadiness(o,{
  cwd,checkout:()=>true,head:()=>sha,lock:()=>({lockSha256:'b'.repeat(64)})
 }),runtime:async()=>runtime(),prepare:async()=>backup()};
 const result=await reviewOperatorRelease(opts,deps2);
 assert.equal(result.technicalReviewReady,true);
 assert.equal(result.realOperatorHostTestedByCI,false);
 writeFileSync(inventory,JSON.stringify({...blankHostInventory(sha)}));
 let invoked=0;
 await assert.rejects(()=>reviewOperatorRelease(opts,{...deps2,prepare:async()=>{
  invoked++;return backup()}}));
 assert.equal(invoked,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,chmodSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseHostArgs,blankHostInventory,assessHostInventory,loadHostInventory,
 inspectHostStorage,inspectWorkflowTriggers,inspectHostReadiness} from '../scripts/host-inventory-v66.mjs';

const sha='a'.repeat(40);
function fixture(t){
 const cwd=mkdtempSync(join(tmpdir(),'cs-host-v66-'));
 t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 const result={cwd,sha,db:join(cwd,'original.sqlite'),backupDir:join(cwd,'backups'),
  scratchDir:join(cwd,'scratch'),review:join(cwd,'review.json'),
  inventory:join(cwd,'hosting.json')};
 for(const folder of [result.backupDir,result.scratchDir]){
  mkdirSync(folder,{mode:0o700});chmodSync(folder,0o700);
 }
 writeFileSync(result.db,Buffer.alloc(4096));
 chmodSync(result.db,0o600);
 writeFileSync(result.review,JSON.stringify({schemaVersion:'content-studio-v55-manual-review',
  candidateCommit:sha,deploymentMode:'deployment-paused',
  operatorRole:'fixture-operator',hostingInventoryReference:'example-internal-review',
  rollbackReference:'example-internal-rollback',backupLocationProtected:true,
  rollbackInstructionsReviewed:true}));
 const doc={...blankHostInventory(sha),githubActionsReviewed:true,
  externalHostingReviewed:true,mainPushTrigger:'ci-only',externalDeployHook:'paused',
  allAutomaticDeploymentPaused:true,backupVolumeEncryptionReviewed:true,
  rollbackOwnerReviewed:true,localOnlyAccessReviewed:true};
 writeFileSync(result.inventory,JSON.stringify(doc));
 mkdirSync(join(cwd,'.github','workflows'),{recursive:true});
 writeFileSync(join(cwd,'.github','workflows','ci.yml'),
  "on:\n  push:\n    branches: [main]\njobs:\n  test:\n    runs-on: ubuntu-latest\n");
 return {result,doc};
}
const deps={checkout:()=>true,head:()=>sha,lock:()=>({lockSha256:'b'.repeat(64)})};
test('V66 explicit inputs reject duplicate SHA, relative paths and unknown options',()=>{
 const f=['--sha='+sha,'--db=/private/database.sqlite','--backup-dir=/protected/backup',
  '--scratch-dir=/protected/scratch','--review=/protected/review','--inventory=/protected/inventory'];
 assert.equal(parseHostArgs(f).sha,sha);
 for(const invalid of [[],[...f,'--token=secret'],[...f,'--sha='+sha],
  f.map(v=>v.startsWith('--db=')?'--db=relative':v)])
  assert.throws(()=>parseHostArgs(invalid));
});
test('V66 template is not approved until each explicit host declaration is reviewed',()=>{
 const doc=blankHostInventory(sha);
 assert.equal(assessHostInventory(doc,sha).recorded,false);
 assert.equal(assessHostInventory({...doc,candidateCommit:'b'.repeat(40)},sha).recorded,false);
});
test('V66 rejects active main-push deployment, active/unknown webhook and extra secret fields',t=>{
 const {doc}=fixture(t);
 for(const changes of [{mainPushTrigger:'auto-deploy'},{mainPushTrigger:'unknown'},
  {externalDeployHook:'active'},{externalDeployHook:'unknown'},
  {allAutomaticDeploymentPaused:false},{userPassword:'NEVER_COPY_SECRET'}])
  assert.equal(assessHostInventory({...doc,...changes},sha).recorded,false);
});
test('V66 real host paths, private folders and free capacity admit safe synthetic preflight',t=>{
 const {result}=fixture(t),report=inspectHostReadiness(result,{...deps,cwd:result.cwd});
 assert.equal(report.reviewReady,true);
 assert.equal(report.hostInventoryRecorded,true);
 assert.equal(report.storageDirectoriesPrivate,true);
 assert.equal(report.externalHostingIndependentlyVerified,false);
 assert.equal(report.productionDatabaseOpened,false);
 assert.equal(report.mergeAuthorized,false);
 for(const value of [result.db,result.backupDir,result.scratchDir,result.review,result.inventory])
  assert.ok(!JSON.stringify(report).includes(value));
});
test('V66 simulated low free storage fails closed without backup or DB reads',t=>{
 const {result}=fixture(t);
 const storage=o=>inspectHostStorage(o,{filesystem:()=>({bavail:0,bsize:4096})});
 const report=inspectHostReadiness(result,{...deps,cwd:result.cwd,storage});
 assert.equal(report.reviewReady,false);
 assert.deepEqual(report.blockers,['insufficient_recovery_disk_capacity']);
 assert.equal(report.backupCreated,false);
});
test('V66 unreviewed or mismatched hosting inventory blocks private DB metadata inspection',t=>{
 const {result,doc}=fixture(t);let touched=false;
 writeFileSync(result.inventory,JSON.stringify({...doc,candidateCommit:'b'.repeat(40)}));
 const report=inspectHostReadiness(result,{...deps,cwd:result.cwd,
  storage:()=>{touched=true;throw Error('should not inspect')}});
 assert.equal(report.reviewReady,false);assert.equal(touched,false);
});
test('V66 refuses symlinks and world-accessible backup directories',t=>{
 const {result}=fixture(t),alias=join(result.cwd,'alias-backup');
 symlinkSync(result.backupDir,alias);
 assert.throws(()=>inspectHostStorage({...result,backupDir:alias}),/actual directory/);
 if(process.platform!=='win32'){
  chmodSync(result.backupDir,0o755);
  assert.throws(()=>inspectHostStorage(result),/not be accessible/);
 }
});
test('V66 rejects overlap with storage directories and aliased DB paths',t=>{
 const {result}=fixture(t);
 const inside=join(result.scratchDir,'review.json');
 writeFileSync(inside,'{}');
 assert.throws(()=>inspectHostStorage({...result,review:inside}),/isolated/);
 assert.throws(()=>inspectHostStorage({...result,inventory:result.review}),/Aliased/);
});
test('V66 workflow scanner shows static CI count without claiming external hook coverage',t=>{
 const {result}=fixture(t),w=inspectWorkflowTriggers(result.cwd);
 assert.equal(w.githubWorkflowFiles,1);
 assert.equal(w.heuristicDeploymentMentions,0);
 assert.equal(w.externalHostingInspected,false);
});
test('V66 detects deployment keyword in GitHub workflow but does not approve it',t=>{
 const {result}=fixture(t);
 writeFileSync(join(result.cwd,'.github','workflows','deploy.yml'),
  'name: deploy\non: push\njobs:\n  run: echo publish');
 assert.equal(inspectWorkflowTriggers(result.cwd).heuristicDeploymentMentions,1);
});
test('V66 strict host inspection refuses changed checkout or dependency lock',t=>{
 const {result}=fixture(t);
 assert.throws(()=>inspectHostReadiness(result,{...deps,cwd:result.cwd,
  checkout:()=>{throw Error('uncommitted files')}}),/uncommitted/);
 assert.throws(()=>inspectHostReadiness(result,{...deps,cwd:result.cwd,
  lock:()=>{throw Error('dependency lock invalid')}}),/dependency lock invalid/);
});
test('V66 wrong V55 review SHA is not considered operator clearance',t=>{
 const {result}=fixture(t),review=JSON.parse(readFileSync(result.review,'utf8'));
 review.candidateCommit='b'.repeat(40);
 writeFileSync(result.review,JSON.stringify(review));
 const report=inspectHostReadiness(result,{...deps,cwd:result.cwd});
 assert.equal(report.reviewReady,false);
 assert.equal(report.v55ReviewRecorded,false);
});

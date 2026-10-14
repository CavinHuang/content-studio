/**
 * V70: genuine Linux UID-separated Next.js candidate process.
 * Runs only with synthetic DB files on an ephemeral GitHub Actions runner.
 * V66/V64/V68/V69 and V67 are real; V62 approval/remote CI is intentionally
 * STUBBED here and covered independently by V62 tests. No real release.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {
 mkdtempSync,mkdirSync,writeFileSync,chmodSync,statSync,rmSync,
 cpSync,existsSync,readFileSync
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {getHeadSha,probeServingBuild} from '../scripts/build-provenance-v64.mjs';
import {verifyCandidateIsolation} from '../src/candidate-db-identity-v68.mjs';
import {verifyOperatorOsBoundary} from '../src/candidate-os-boundary-v69.mjs';
import {reviewOperatorRelease} from '../scripts/operator-review-v67.mjs';
import {blankHostInventory,inspectHostReadiness} from '../scripts/host-inventory-v66.mjs';
const nap=ms=>new Promise(r=>setTimeout(r,ms));
const command=(file,args,opts={})=>{
 const r=spawnSync(file,args,{encoding:'utf8',maxBuffer:1024*1024,
  stdio:['ignore','pipe','pipe'],...opts});
 if(r.error||r.status!==0)throw Error('V70 isolated fixture OS setup failed');
 return r.stdout.trim();
};
async function unusedPort(){
 const s=createServer();
 await new Promise((yes,no)=>s.once('error',no).listen(0,'127.0.0.1',yes));
 const port=s.address().port;
 await new Promise(done=>s.close(done));
 return port;
}
function syntheticSQLite(file){
 const db=new DatabaseSync(file);
 db.exec('CREATE TABLE IF NOT EXISTS fixture(id INTEGER PRIMARY KEY, note TEXT)');
 db.prepare('INSERT INTO fixture(note) VALUES(?)').run('SYNTHETIC CI ONLY');
 db.close();
}
function preparedStub(sha){
 return {kind:'content-studio-v62-prepared-operator-acceptance',
 candidateCommit:sha,reviewReady:true,newWalBackupCreated:true,
 backupManifestAndHistoryVerified:true,sourceStableAcrossBackup:true,
 v61TechnicalAcceptancePassed:true,backupRetainedForOperator:true,
 externalHostingIndependentlyVerified:false,encryptionVerifiedBySoftware:false,
 backupFilename:'content-studio-pre-release-'+sha.slice(0,12)+'-'+'a'.repeat(16)+'.sqlite',
 mergeAuthorized:false,deployAuthorized:false,releaseAuthorized:false,productionReady:false};
}
test('V70 real Next.js under nobody UID + V67 genuine pre/post host/runtime/SQLite/OS checks; V62 stub only',
 {timeout:200000},async t=>{
 if(process.platform!=='linux')return t.skip('Linux-only cross-UID smoke');
 const probe=spawnSync('sudo',['-n','-u','nobody','id','-u'],{encoding:'utf8'});
 if(probe.status!==0){
  if(process.env.CI==='true')assert.fail('Linux CI requires sudo -n -u nobody');
  return t.skip('separate non-root UID unavailable on developer host');
 }
 const candidateUid=Number(probe.stdout.trim());
 assert.ok(candidateUid>0);
 const originalCwd=process.cwd(),sha=getHeadSha(originalCwd);
 const tmp=mkdtempSync(join(tmpdir(),'cs-v70-multiuid-'));
 t.after(()=>rmSync(tmp,{force:true,recursive:true}));
 // /tmp fixture only; make its top-level traversable by both OS users.
 chmodSync(tmp,0o755);
 const sourceDir=join(tmp,'source-protected'),sourceDb=join(sourceDir,'operator.sqlite');
 mkdirSync(sourceDir,{mode:0o700});
 chmodSync(sourceDir,0o700);
 syntheticSQLite(sourceDb);
 chmodSync(sourceDb,0o600);
 const sourceOwner=statSync(sourceDb).uid;
 assert.notEqual(sourceOwner,candidateUid);
 const candidateDir=join(tmp,'candidate-storage'),candidateDb=join(candidateDir,'candidate.sqlite');
 mkdirSync(candidateDir,{mode:0o755});
 syntheticSQLite(candidateDb);chmodSync(candidateDb,0o600);
 command('sudo',['-n','chown','-R',String(candidateUid),candidateDir]);
 // The source is private even in the presence of distinct names and inodes.
 assert.notEqual(statSync(sourceDb).ino,statSync(candidateDb).ino);
 command('sudo',['-n','-u','nobody','test','!','-r',sourceDb]);

 // Copy the real sealed Next build, runtime source, dependencies and Git HEAD
 // into a DISPOSABLE sandbox owned by the candidate UID. This keeps the
 // user's checkout, real host files and production directories untouched.
 const app=join(tmp,'candidate-app');
 mkdirSync(app,{mode:0o755});
 for(const name of [
  '.git','.next','node_modules','app','components','lib','src','scripts',
  'public','next.config.mjs','package.json','package-lock.json'
 ]){
  const path=join(originalCwd,name);
  if(existsSync(path))cpSync(path,join(app,name),
   {recursive:true,force:false,verbatimSymlinks:false});
 }
 command('sudo',['-n','chown','-R',String(candidateUid),app]);
 assert.equal(command('sudo',['-n','-u','nobody','git','-C',app,'rev-parse','HEAD']),sha);
 const port=await unusedPort(),url='http://127.0.0.1:'+port;
 const env=[
  'PATH=/usr/local/bin:/usr/bin:/bin','HOME='+tmp,'PORT='+String(port),
  'NODE_ENV=production','HOST=127.0.0.1','HOSTNAME=127.0.0.1',
  'CONTENT_STUDIO_ALLOW_REMOTE=0','ENABLE_SCENARIO=0',
  'CONTENT_STUDIO_DB_PATH='+candidateDb,
  'CONTENT_STUDIO_CANDIDATE_SOURCE_DB_PATH='+sourceDb
 ];
 const launch=spawn('sudo',['-n','-u','nobody','env','-i',...env,
  process.execPath,'scripts/runtime-guard.mjs','candidate-start'],{
   cwd:app,stdio:['ignore','pipe','pipe'],windowsHide:true
  });
 let stderr='';
 launch.stderr.on('data',b=>{stderr=(stderr+String(b)).slice(-1800)});
 launch.stdout.on('data',()=>{});
 let processPid=null;
 try{
  let live=null;
  for(let i=0;i<135;i++){
   if(launch.exitCode!==null||launch.signalCode!==null)break;
   try{
    const response=await fetch(url+'/api/health',{
     signal:AbortSignal.timeout(750),cache:'no-store'});
    if(response.ok){
     const result=await response.json();
     if(result?.runtimeBuild?.osIsolation?.sourceAccessDenied===true){
      live=result;break;
     }
    }
   }catch{}
   await nap(350);
  }
  assert.ok(live,'V70 separate UID guarded Next did not start; synthetic CI stderr '+stderr.slice(-900));
  const marker=live.runtimeBuild;
  processPid=marker.pid;
  assert.equal(marker.candidateCommit,sha);
  assert.equal(marker.osIsolation.processUid,candidateUid);
  assert.equal(marker.osIsolation.verifiedAtLauncher,true);
  assert.equal(marker.osIsolation.sourceAccessDenied,true);
  assert.equal(marker.osIsolation.protectedWalSidecarsChecked,true);
  assert.equal(marker.osIsolation.candidateFileOwnedByProcess,true);
  assert.match(marker.databaseIdentity,/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(live).includes(sourceDb));
  assert.ok(!JSON.stringify(live).includes(candidateDb));

  // Runtime probe checks the real operator-workspace build and live localhost.
  const runtime=()=>probeServingBuild({sha,url});
  const observed=await runtime();
  assert.equal(observed.observedProcessPid,processPid);
  assert.equal(observed.observedOsIsolation.processUid,candidateUid);
  const backupDir=join(tmp,'backups'),scratchDir=join(tmp,'scratch');
  mkdirSync(backupDir,{mode:0o700});mkdirSync(scratchDir,{mode:0o700});
  chmodSync(backupDir,0o700);chmodSync(scratchDir,0o700);
  const isolated=verifyCandidateIsolation({sourceDb,candidateDb,
   observedIdentity:observed.observedDatabaseIdentity,
   runNonce:observed.observedNonce,
   backupDir:join(tmp,'backups'),scratchDir:join(tmp,'scratch')});
  assert.equal(isolated.candidateIsolated,true);
  const permission=verifyOperatorOsBoundary({sourceDb,
   observed:observed.observedOsIsolation,runNonce:observed.observedNonce});
  assert.equal(permission.candidateOsBoundaryVerified,true);

  const review=join(tmp,'v55-review.json'),inventory=join(tmp,'v66-inventory.json');
  writeFileSync(review,JSON.stringify({
   schemaVersion:'content-studio-v55-manual-review',candidateCommit:sha,
   deploymentMode:'deployment-paused',operatorRole:'synthetic-ci-only',
   hostingInventoryReference:'synthetic-reviewed',rollbackReference:'synthetic-rollback',
   backupLocationProtected:true,rollbackInstructionsReviewed:true
  }));
  writeFileSync(inventory,JSON.stringify({...blankHostInventory(sha),
   githubActionsReviewed:true,externalHostingReviewed:true,
   mainPushTrigger:'ci-only',externalDeployHook:'paused',
   allAutomaticDeploymentPaused:true,backupVolumeEncryptionReviewed:true,
   rollbackOwnerReviewed:true,localOnlyAccessReviewed:true
  }));
  let stubCalls=0;
  const options={sha,db:sourceDb,candidateDb,backupDir,scratchDir,review,inventory,url};
  const result=await reviewOperatorRelease(options,{
   host:opts=>inspectHostReadiness(opts,{cwd:originalCwd}),
   prepare:async()=>{stubCalls++;return preparedStub(sha)}
  });
  assert.equal(stubCalls,1);
  assert.equal(result.technicalReviewReady,true);
  assert.equal(result.candidateOsSourceReadDenied,true);
  assert.equal(result.candidateRunsUnderDistinctPosixUid,true);
  assert.equal(result.activeDatabaseIdentityMatchesOperatorSelectedFile,true);
  assert.equal(result.realOperatorHostTestedByCI,false);
  for(const field of ['mergeAuthorized','releaseAuthorized','deployAuthorized','productionReady'])
   assert.equal(result[field],false);
  for(const secret of [sourceDb,candidateDb,'SYNTHETIC CI ONLY'])
   assert.equal(JSON.stringify(result).includes(secret),false);

  // Explicit fail-closed when the real health probe loses OS evidence; no
  // fake V62 rehearsal should be triggered after this failure.
  let afterUnsafe=0;
  await assert.rejects(()=>reviewOperatorRelease(options,{
   host:opts=>inspectHostReadiness(opts,{cwd:originalCwd}),
   runtime:async()=>({...await runtime(),observedOsIsolation:null}),
   prepare:async()=>{afterUnsafe++;return preparedStub(sha)}
  }),/V64 candidate runtime identity is not verified/);
  assert.equal(afterUnsafe,0);
 }finally{
  // Signal the *real* candidate Next PID through privileged CI cleanup, not
  // just the sudo parent process; never leave a listening child in the runner.
  if(processPid)spawnSync('sudo',['-n','kill','-TERM',String(processPid)]);
  launch.kill('SIGTERM');
  await nap(550);
  if(processPid)spawnSync('sudo',['-n','kill','-KILL',String(processPid)]);
 }
});

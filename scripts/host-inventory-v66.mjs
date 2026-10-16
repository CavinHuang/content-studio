/**
 * V66: host-owned release inventory, read-only. No hosting API credentials,
 * no DB opens, backup writes, hooks, merge or deployment.
 */
import {lstatSync,realpathSync,readFileSync,statfsSync,statSync,readdirSync} from 'node:fs';
import {resolve,isAbsolute,win32,sep,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyCleanCheckout} from './checkout-integrity-v63.mjs';
import {verifyDependencyLock} from './dependency-lock-v65.mjs';
import {assessOperatorReview,readOperatorReview} from './operator-release-evidence-v55.mjs';
import {getHeadSha} from './build-provenance-v64.mjs';

const SHA=/^[a-f0-9]{40}$/;
const KIND='content-studio-v66-hosting-inventory';
const MB=1024n*1024n;
const yesFalse={releaseAuthorized:false,mergeAuthorized:false,deployAuthorized:false,productionReady:false};
const absolute=p=>isAbsolute(p)||win32.isAbsolute(p);
const within=(file,dir)=>file===dir||file.startsWith(dir+sep);
const required=['kind','schemaVersion','candidateCommit','githubActionsReviewed',
 'externalHostingReviewed','mainPushTrigger','externalDeployHook',
 'allAutomaticDeploymentPaused','backupVolumeEncryptionReviewed',
 'rollbackOwnerReviewed','localOnlyAccessReviewed'];
function regular(path){
 const s=lstatSync(path);
 if(!s.isFile()||s.isSymbolicLink())throw Error('Host evidence must be a regular local file');
 return {path:realpathSync(path),stat:s};
}
function privateDirectory(path){
 const s=lstatSync(path);
 if(!s.isDirectory()||s.isSymbolicLink())throw Error('Private storage must be an actual directory');
 if(process.platform!=='win32'&&(s.mode&0o077)!==0)
  throw Error('Private storage must not be accessible to other users');
 return {path:realpathSync(path),stat:s};
}
export function parseHostArgs(argv=[]){
 const value={};
 for(const part of argv){
  const m=/^--(sha|db|backup-dir|scratch-dir|review|inventory)=(.+)$/.exec(part);
  if(!m||Object.hasOwn(value,m[1]))throw Error('Unexpected or duplicate host preflight parameter');
  value[m[1]]=m[2];
 }
 if(!SHA.test(value.sha||'')||
   !['db','backup-dir','scratch-dir','review','inventory'].every(k=>value[k]&&absolute(value[k])))
   throw Error('Explicit SHA and five absolute host paths required');
 const paths=['db','backup-dir','scratch-dir','review','inventory'].map(k=>resolve(value[k]));
 if(new Set(paths).size!==5)throw Error('Host preflight paths must be distinct');
 return {sha:value.sha,db:paths[0],backupDir:paths[1],scratchDir:paths[2],review:paths[3],inventory:paths[4]};
}
export function blankHostInventory(sha){
 if(!SHA.test(sha||''))throw Error('Pinned candidate Git SHA required');
 return {kind:KIND,schemaVersion:1,candidateCommit:sha,
  githubActionsReviewed:false,externalHostingReviewed:false,
  mainPushTrigger:'unknown',externalDeployHook:'unknown',
  allAutomaticDeploymentPaused:false,backupVolumeEncryptionReviewed:false,
  rollbackOwnerReviewed:false,localOnlyAccessReviewed:false};
}
export function assessHostInventory(manual,sha){
 if(!SHA.test(sha||''))throw Error('Pinned candidate SHA required');
 const blockers=[];
 if(!manual||typeof manual!=='object'||Array.isArray(manual)||
   Object.keys(manual).length!==required.length||
   required.some(k=>!Object.hasOwn(manual,k)))
  return {recorded:false,blockers:['inventory_schema_invalid']};
 if(manual.kind!==KIND||manual.schemaVersion!==1)blockers.push('inventory_schema_invalid');
 if(manual.candidateCommit!==sha)blockers.push('inventory_sha_mismatch');
 for(const k of ['githubActionsReviewed','externalHostingReviewed',
  'allAutomaticDeploymentPaused','backupVolumeEncryptionReviewed',
  'rollbackOwnerReviewed','localOnlyAccessReviewed'])
  if(manual[k]!==true)blockers.push(k+'_not_confirmed');
 if(!['none','ci-only','auto-deploy','unknown'].includes(manual.mainPushTrigger))
  blockers.push('main_push_trigger_invalid');
 else if(!['none','ci-only'].includes(manual.mainPushTrigger))
  blockers.push('main_push_may_auto_deploy');
 if(!['none','paused','active','unknown'].includes(manual.externalDeployHook))
  blockers.push('external_hook_invalid');
 else if(!['none','paused'].includes(manual.externalDeployHook))
  blockers.push('external_hook_not_paused');
 return {recorded:blockers.length===0,blockers,
  independentlyVerified:false,source:'operator-self-declaration'};
}
export function loadHostInventory(file,sha){
 const meta=lstatSync(file);
 if(!meta.isFile()||meta.isSymbolicLink()||meta.size>4096)
  throw Error('Host inventory must be a small regular JSON file');
 let input;
 try{input=JSON.parse(readFileSync(file,'utf8'))}
 catch{throw Error('Invalid host inventory JSON')}
 return assessHostInventory(input,sha);
}
export function inspectWorkflowTriggers(cwd){
 const folder=resolve(cwd,'.github','workflows');
 const stats=lstatSync(folder);
 if(!stats.isDirectory()||stats.isSymbolicLink())throw Error('Expected GitHub workflow directory');
 let count=0,possibleDeploymentJobs=0;
 for(const entry of readdirSync(folder,{withFileTypes:true})){
  if(!/\.ya?ml$/.test(entry.name))continue;
  if(!entry.isFile()||entry.isSymbolicLink())throw Error('GitHub workflow is not a regular file');
  const file=join(folder,entry.name),stat=lstatSync(file);
  if(stat.size>300000)throw Error('GitHub workflow is unexpectedly large');
  const content=readFileSync(file,'utf8');
  count++;
  // A conservative keyword heuristic, NOT a parser or external hook audit.
  if(/\b(?:deploy|release|publish|webhook|rsync|ssh)\b/i.test(content))
   possibleDeploymentJobs++;
 }
 if(!count)throw Error('GitHub workflow inventory unavailable');
 return {githubWorkflowFiles:count,heuristicDeploymentMentions:possibleDeploymentJobs,
  externalHostingInspected:false,staticWorkflowScanOnly:true};
}
export function inspectHostStorage(opts,{filesystem=statfsSync}={}){
 const originals=[regular(opts.db),regular(opts.review),regular(opts.inventory)];
 const dirs=[privateDirectory(opts.backupDir),privateDirectory(opts.scratchDir)];
 const all=[...originals,...dirs].map(x=>x.path);
 if(new Set(all).size!==all.length)throw Error('Aliased host evidence paths');
 const [db,review,inventory]=originals.map(x=>x.path);
 const [backup,scratch]=dirs.map(x=>x.path);
 if(within(scratch,backup)||within(backup,scratch)||
   [db,review,inventory].some(x=>within(x,backup)||within(x,scratch)))
  throw Error('DB, review, hosting inventory and private storage must be isolated');
 const dbStat=originals[0].stat;
 if(dbStat.size===0||!dbStat.isFile())throw Error('A real local SQLite file is required');
 if(process.platform!=='win32'&&(dbStat.mode&0o007)!==0)
  throw Error('Local SQLite DB must not be world accessible');
 const left=filesystem(backup),right=filesystem(scratch);
 const available=x=>BigInt(x.bavail)*BigInt(x.bsize);
 // Reserve room for one complete WAL backup plus manifests, and several
 // V55/V60 disposable restored copies. Same device counts demand jointly.
 const size=BigInt(dbStat.size);
 const backupRequired=size*2n+128n*MB;
 const scratchRequired=size*3n+256n*MB;
 const sameDevice=dirs[0].stat.dev===dirs[1].stat.dev;
 const enough=sameDevice
  ? available(left)>=backupRequired+scratchRequired
  : available(left)>=backupRequired&&available(right)>=scratchRequired;
 return {storageSpaceSufficient:enough,
  backupAndScratchSameDevice:sameDevice,backupSharesDbFilesystem:dirs[0].stat.dev===dbStat.dev,
  minimumCapacityPolicy:'backup-2x+128MiB,scratch-3x+256MiB',
  storageDirectoriesPrivate:true,encryptedStorageVerifiedBySoftware:false,
  diskFreeBytesOmitted:true,dbSizeBytesOmitted:true};
}
export function inspectHostReadiness(input,{
 checkout=verifyCleanCheckout,head=getHeadSha,lock=verifyDependencyLock,
 inventory=loadHostInventory,review=readOperatorReview,workflows=inspectWorkflowTriggers,
 storage=inspectHostStorage,cwd=process.cwd()
}={}){
 const opts=Array.isArray(input)?parseHostArgs(input):input;
 if(!SHA.test(opts?.sha||''))throw Error('Pinned SHA required');
 checkout(opts.sha,{cwd});
 if(head(cwd)!==opts.sha)throw Error('Host Git HEAD changed');
 const dependency=lock({cwd});
 const hostInventory=inventory(opts.inventory,opts.sha);
 const operatorReview=assessOperatorReview(review(opts.review),opts.sha);
 // Manual claim is not independent evidence. All required details must be
 // explicit and safe before any DB file metadata is inspected.
 if(!hostInventory.recorded||!operatorReview.recorded)
  return {kind:'content-studio-v66-host-preflight',schemaVersion:1,
   candidateCommit:opts.sha,reviewReady:false,hostInventoryRecorded:hostInventory.recorded,
   v55ReviewRecorded:operatorReview.recorded,
   blockers:[...hostInventory.blockers,...(!operatorReview.recorded?['v55_review_incomplete']:[])],
   externalHostingIndependentlyVerified:false,...yesFalse};
 const staticWorkflows=workflows(cwd);
 const disk=storage(opts);
 checkout(opts.sha,{cwd});
 if(head(cwd)!==opts.sha)throw Error('Host Git checkout changed during review');
 const ready=disk.storageSpaceSufficient===true;
 return {kind:'content-studio-v66-host-preflight',schemaVersion:1,candidateCommit:opts.sha,
  reviewReady:ready,hostInventoryRecorded:true,v55ReviewRecorded:true,
  npmLockMetadataVerified:!!dependency.lockSha256,
  ...staticWorkflows,...disk,
  blockers:ready?[]:['insufficient_recovery_disk_capacity'],
  externalHostingIndependentlyVerified:false,
  operatorApprovalGranted:false,liveServiceValidated:false,
  productionDatabaseOpened:false,backupCreated:false,...yesFalse};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const arg=process.argv.slice(2);
  if(arg[0]==='template'){
   if(arg.length!==2||!/^--sha=[a-f0-9]{40}$/.test(arg[1]))throw Error('Template needs exact SHA');
   console.log(JSON.stringify(blankHostInventory(arg[1].slice(6)),null,2));
  }else{
   const report=inspectHostReadiness(arg);
   console.log(JSON.stringify(report,null,2));
   if(!report.reviewReady)process.exitCode=1;
  }
 }catch{
  console.error('V66 local host inventory blocked; check operator checklist, paths and capacity privately');
  process.exitCode=1;
 }
}

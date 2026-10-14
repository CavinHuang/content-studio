/**
 * V61 single-entry technical acceptance. Read-only GitHub V59, local V55 and
 * isolated rollback V60; no merge, deploy, publishing or paid-model use.
 */
import {verifyCleanCheckout} from './checkout-integrity-v63.mjs';
import {constants} from 'node:fs';
import {lstat,realpath,access,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve,join,isAbsolute,win32} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectV59Evidence,assessOperatorPacket} from './remote-release-evidence-v59.mjs';
import {collectReleaseEvidence} from './operator-release-evidence-v55.mjs';
import {runRollbackDrill} from './rollback-drill-v60.mjs';

const SHA=/^[a-f0-9]{40}$/;
const abs=p=>isAbsolute(p)||win32.isAbsolute(p);
const notAuthorized=Object.freeze({
 releaseAuthorized:false,mergeAuthorized:false,deployAuthorized:false,
 productionReady:false,realPublishingVerified:false,paidProviderChecked:false
});
export function parseAcceptanceArgs(args=[]){
 const out={};
 for(const arg of args){
  const m=/^--(sha|db|backup|review|scratch-dir)=(.+)$/.exec(arg);
  if(!m||Object.hasOwn(out,m[1]))throw Error('Invalid or duplicate V61 argument');
  out[m[1]]=m[2];
 }
 if(!SHA.test(out.sha||'')||!['db','backup','review','scratch-dir'].every(k=>out[k]&&abs(out[k])))
  throw Error('Explicit pinned SHA and four absolute local paths are required');
 const values=['db','backup','review','scratch-dir'].map(k=>resolve(out[k]));
 if(new Set(values).size!==values.length)throw Error('Operator paths must be distinct');
 return {sha:out.sha,db:values[0],backup:values[1],review:values[2],scratch:values[3]};
}
export function requireLocalHead(sha){
 verifyCleanCheckout(sha);
 return true;
}
export async function verifyOperatorPaths({db,backup,review,scratch}){
 const paths=[];
 for(const input of [db,backup,review]){
  const info=await lstat(input);
  if(!info.isFile()||info.isSymbolicLink())throw Error('Unsafe local evidence path');
  paths.push(await realpath(input));
 }
 const info=await lstat(scratch);
 if(!info.isDirectory()||info.isSymbolicLink())throw Error('Scratch is not a real directory');
 if(process.platform!=='win32'&&(info.mode&0o077)!==0)
  throw Error('Scratch must be private');
 await access(scratch,constants.R_OK|constants.W_OK|constants.X_OK);
 paths.push(await realpath(scratch));
 if(new Set(paths).size!==paths.length)throw Error('Aliased local paths');
 return paths[3];
}
export function checkRemoteSnapshot(report,sha,{mustIncludePacket=false}={}){
 if(report?.candidateCommit!==sha||report.githubCI?.githubCheckPassed!==true||
  report.githubCI?.githubApiWasQueried!==true)
  throw Error('GitHub CI or candidate commit did not pass');
 if(mustIncludePacket&&(report.technicalEvidenceComplete!==true||
  report.operatorPacket?.recorded!==true||report.operatorPacket?.independentlyVerified!==false))
  throw Error('GitHub CI and operator packet mismatch');
 if(report.releaseAuthorized!==false||report.mergeAuthorized!==false||
  report.deployAuthorized!==false||report.productionReady!==false)
  throw Error('Invalid remote authorization claims');
 return true;
}
export function checkRollbackResult(report,sha){
 if(report?.candidateCommit!==sha||report.status!=='passed'||
  report.restoredToNewFile!==true||report.deliberateFaultChangedDisposableCopy!==true||
  report.sourceUnchanged!==true||report.verifiedBackupUnchanged!==true||
  report.rollbackRestoredHistoricalRows!==true||report.rollbackApplicationOpened!==true||
  report.scratchCopiesRemoved!==true||report.mergeAuthorized!==false||
  report.deployAuthorized!==false||report.productionReady!==false)
  throw Error('Rollback rehearsal incomplete');
 return true;
}
export async function runOperatorAcceptance(input,{
 assertHead=requireLocalHead,validatePaths=verifyOperatorPaths,
 remote=collectV59Evidence,local=collectReleaseEvidence,rollback=runRollbackDrill,
 makeTemp=mkdtemp,write=writeFile,remove=rm
}={}){
 const opts=Array.isArray(input)?parseAcceptanceArgs(input):input;
 if(!SHA.test(opts?.sha||''))throw Error('Pinned SHA required');
 assertHead(opts.sha);
 const scratch=await validatePaths(opts);
 // Do not access the user's database until current GitHub CI is confirmed.
 const before=await remote({sha:opts.sha});
 checkRemoteSnapshot(before,opts.sha);
 const packet=await local(['--db='+opts.db,'--backup='+opts.backup,'--review='+opts.review]);
 if(!assessOperatorPacket(packet,opts.sha).localOperatorEvidenceRecorded)
  throw Error('V55 local evidence incomplete');
 assertHead(opts.sha);
 let tmp;
 try{
  tmp=await makeTemp(join(scratch,'.content-studio-v61-'));
  const filename=join(tmp,'v55.release-evidence.json');
  await write(filename,JSON.stringify(packet),{flag:'wx',mode:0o600});
  const report=await rollback({sha:opts.sha,db:opts.db,backup:opts.backup,
   evidence:filename,scratch});
  checkRollbackResult(report,opts.sha);
  assertHead(opts.sha);
  const after=await remote({sha:opts.sha,'operator-evidence':filename});
  checkRemoteSnapshot(after,opts.sha,{mustIncludePacket:true});
  assertHead(opts.sha);
  return {kind:'content-studio-v61-operator-technical-acceptance',schemaVersion:1,
   candidateCommit:opts.sha,
   stages:{exactCheckoutSha:'passed',initialGithubCi:'passed',
    localV55Evidence:'passed',isolatedV60Rollback:'passed',
    finalGithubCiAndPacket:'passed'},
   technicalEvidenceComplete:true,reviewReady:true,
   externalHostingIndependentlyVerified:false,approvalGranted:false,
   scratchCleanupNotSecureErase:true,
   ciRuns:{push:after.githubCI?.checks?.push?.runId??null,
    pullRequest:after.githubCI?.checks?.pull_request?.runId??null},
   ...notAuthorized};
 }finally{
  if(tmp)await remove(tmp,{recursive:true,force:true});
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 runOperatorAcceptance(process.argv.slice(2)).then(report=>{
  console.log(JSON.stringify({...report,privateEvidenceScratchRemoved:true},null,2));
 }).catch(()=>{
  console.error('V61 acceptance blocked; inspect protected inputs, candidate CI and local backup');
  process.exitCode=1;
 });
}

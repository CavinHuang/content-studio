/**
 * V67 — coordinated operator review; NOT permission to merge/deploy.
 * All actions are on the operator's own host. The candidate Next instance
 * MUST already run on loopback with an isolated/disposable SQLite database.
 * This script never starts/restarts servers or changes the live application.
 */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseHostArgs,inspectHostReadiness} from './host-inventory-v66.mjs';
import {parseRuntimeProbeArgs,probeServingBuild} from './build-provenance-v64.mjs';
import {runPreparedAcceptance} from './prepare-operator-release-v62.mjs';
import {checkCandidateFileSeparation,verifyCandidateIsolation} from '../src/candidate-db-identity-v68.mjs';
import {isAbsolute,win32} from 'node:path';

const SHA=/^[a-f0-9]{40}$/;
const lockedDown={
 releaseAuthorized:false,mergeAuthorized:false,deployAuthorized:false,
 productionReady:false,externalHostingIndependentlyVerified:false,
 operatorApprovalGranted:false,realPublishingVerified:false
};
export function parseReviewArgs(args=[]){
 const names=new Set(['sha','db','candidate-db','backup-dir','scratch-dir','review','inventory','url']);
 const values={};
 for(const arg of args){
  const m=/^--([a-z-]+)=(.+)$/.exec(arg);
  if(!m||!names.has(m[1])||Object.hasOwn(values,m[1]))
   throw Error('Unknown or duplicate V67 review argument');
  values[m[1]]=m[2];
 }
 if(Object.keys(values).length!==names.size||!SHA.test(values.sha||''))
  throw Error('Explicit pinned SHA, loopback URL and five absolute paths required');
 const host=parseHostArgs(['--sha='+values.sha,'--db='+values.db,
  '--backup-dir='+values['backup-dir'],'--scratch-dir='+values['scratch-dir'],
  '--review='+values.review,'--inventory='+values.inventory]);
 const runtime=parseRuntimeProbeArgs(['--sha='+values.sha,'--url='+values.url]);
 if(!values['candidate-db']||
   !(isAbsolute(values['candidate-db'])||win32.isAbsolute(values['candidate-db'])))
  throw Error('Explicit candidate SQLite absolute path required');
 return {...host,candidateDb:resolve(values['candidate-db']),url:runtime.url};
}
function requiredFalse(report){
 return report?.mergeAuthorized===false&&report.deployAuthorized===false&&
  report.productionReady===false&&report.releaseAuthorized===false;
}
export function requireHostReview(report,sha){
 if(report?.kind!=='content-studio-v66-host-preflight'||report.candidateCommit!==sha||
   report.reviewReady!==true||report.hostInventoryRecorded!==true||
   report.v55ReviewRecorded!==true||report.storageSpaceSufficient!==true||
   report.storageDirectoriesPrivate!==true||report.npmLockMetadataVerified!==true||
   report.externalHostingIndependentlyVerified!==false||
   report.encryptedStorageVerifiedBySoftware!==false||
   !Array.isArray(report.blockers)||report.blockers.length!==0||
   !requiredFalse(report))
  throw Error('V66 private host prerequisites are incomplete');
 return true;
}
export function requireRuntimeReview(report,sha){
 if(report?.kind!=='content-studio-v64-serving-build-probe'||report.candidateCommit!==sha||
   report.localBuildIntegrityVerified!==true||
   report.servingProcessDeclarationMatchesBuild!==true||
   report.independentProcessBinaryAttestation!==false||
   !/^[a-f0-9]{64}$/.test(report.artifactDigestSha256||'')||
   !/^[a-f0-9]{64}$/.test(report.dependencyLockSha256||'')||
   typeof report.buildId!=='string'||!report.buildId||
   !/^[a-f0-9]{64}$/.test(report.observedDatabaseIdentity||'')||
   !Number.isInteger(report.observedProcessPid)||report.observedProcessPid<1||
   !/^[a-f0-9]{32}$/.test(report.observedNonce||'')||
   !requiredFalse(report))
  throw Error('V64 candidate runtime identity is not verified');
 return true;
}
export function requirePreparedReview(report,sha){
 if(report?.kind!=='content-studio-v62-prepared-operator-acceptance'||report.candidateCommit!==sha||
   report.reviewReady!==true||report.newWalBackupCreated!==true||
   report.backupManifestAndHistoryVerified!==true||
   report.sourceStableAcrossBackup!==true||
   report.v61TechnicalAcceptancePassed!==true||
   report.backupRetainedForOperator!==true||
   report.externalHostingIndependentlyVerified!==false||
   report.encryptionVerifiedBySoftware!==false||
   !/^content-studio-pre-release-[a-f0-9]{12}-[a-f0-9]{16}\.sqlite$/.test(report.backupFilename||'')||
   !requiredFalse(report))
  throw Error('V62 backup/restore rehearsal is incomplete');
 return true;
}
function equalRuntime(before,after){
 return ['candidateCommit','artifactDigestSha256','dependencyLockSha256',
  'buildId','observedDatabaseIdentity','observedProcessPid','observedNonce']
   .every(key=>before[key]===after[key]);
}
export async function reviewOperatorRelease(input,{
 host=inspectHostReadiness,runtime=probeServingBuild,prepare=runPreparedAcceptance,
 separate=checkCandidateFileSeparation,isolate=verifyCandidateIsolation
}={}){
 const opts=Array.isArray(input)?parseReviewArgs(input):input;
 if(!SHA.test(opts?.sha||''))throw Error('Pinned commit SHA required');
 // V66 validates the lock, clean checkout and host assertions without reading
 // actual private SQLite rows; all downstream stages are skipped if blocked.
 const pre=await host(opts);
 requireHostReview(pre,opts.sha);
 // V68 must reject source aliases / hardlinks BEFORE any runtime probe or
 // private backup operation. This checks file metadata only, not row content.
 const selected={sourceDb:opts.db,candidateDb:opts.candidateDb,
  backupDir:opts.backupDir,scratchDir:opts.scratchDir};
 const separation=separate(selected);
 if(separation?.candidateSeparatedFromSource!==true)
  throw Error('Candidate SQLite file separation not proven');
 // Probe the *already-running* isolated candidate before touching the source.
 const instance=await runtime({sha:opts.sha,url:opts.url});
 requireRuntimeReview(instance,opts.sha);
 const identity=isolate({...selected,runNonce:instance.observedNonce,
  observedIdentity:instance.observedDatabaseIdentity});
 if(identity?.candidateIsolated!==true||identity?.connectedCandidateIdentityMatched!==true)
  throw Error('Candidate process SQLite identity not isolated');
 // This stage performs the existing V62 WAL snapshot and genuine V61 rollback
 // against disposable copies; no restore into the original database.
 const backup=await prepare({sha:opts.sha,db:opts.db,
  backupDir:opts.backupDir,review:opts.review,scratch:opts.scratchDir});
 requirePreparedReview(backup,opts.sha);
 const after=await runtime({sha:opts.sha,url:opts.url});
 requireRuntimeReview(after,opts.sha);
 const finalIdentity=isolate({...selected,runNonce:after.observedNonce,
  observedIdentity:after.observedDatabaseIdentity});
 if(finalIdentity?.candidateIsolated!==true||finalIdentity?.connectedCandidateIdentityMatched!==true)
  throw Error('Candidate process SQLite identity drifted');
 if(!equalRuntime(instance,after))
  throw Error('Candidate process or build changed during operator review');
 const final=await host(opts);
 requireHostReview(final,opts.sha);
 if(pre.githubWorkflowFiles!==final.githubWorkflowFiles||
  pre.heuristicDeploymentMentions!==final.heuristicDeploymentMentions||
  pre.backupAndScratchSameDevice!==final.backupAndScratchSameDevice||
  pre.backupSharesDbFilesystem!==final.backupSharesDbFilesystem)
  throw Error('Operator host preflight inventory changed during review');
 return {
  kind:'content-studio-v67-operator-review-handoff',schemaVersion:1,
  candidateCommit:opts.sha,
  technicalReviewReady:true,
  stages:{initialHostPreflight:'passed',candidateRuntimeBeforeBackup:'passed',
   newWalBackupAndIsolatedRollback:'passed',
   candidateRuntimeAfterBackup:'passed',finalHostPreflight:'passed'},
  buildId:instance.buildId,
  artifactDigestSha256:instance.artifactDigestSha256,
  dependencyLockSha256:instance.dependencyLockSha256,
  candidateProcessStable:true,candidateDatabaseIsolated:true,
  activeDatabaseIdentityMatchesOperatorSelectedFile:true,
  backupFilename:backup.backupFilename,backupRetainedForOperator:true,
  operatorManualInventoryRecorded:true,privateDataIncluded:false,
  approvalDocumentProduced:false,realOperatorHostTestedByCI:false,
  ...lockedDown
 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 reviewOperatorRelease(process.argv.slice(2)).then(report=>{
  console.log(JSON.stringify(report,null,2));
 }).catch(()=>{
  // Never echo host paths, private DB data, log file contents, secrets,
  // or untrusted model/provider errors to the terminal.
  console.error('V67 operator handoff blocked; inspect protected host, current CI, isolated candidate, and backup privately');
  process.exitCode=1;
 });
}

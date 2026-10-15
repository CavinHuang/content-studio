/**
 * V71 protected, privacy-minimal operator technical handoff receipt.
 * Executes real V67 on the operator's host, but never signs deployment
 * authorization, publishes user data or verifies external hosting control.
 */
import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,writeFileSync,fsyncSync,
 lstatSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,dirname,basename,isAbsolute,win32,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseReviewArgs,reviewOperatorRelease} from './operator-review-v67.mjs';

const SHA=/^[a-f0-9]{40}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const BUILD=/^[a-zA-Z0-9_-]{1,128}$/;
const BACKUP=/^content-studio-pre-release-[a-f0-9]{12}-[a-f0-9]{16}\.sqlite$/;
const KIND='content-studio-v71-local-technical-receipt';
const STAGE_KEYS=['initialHostPreflight','candidateRuntimeBeforeBackup',
 'newWalBackupAndIsolatedRollback','candidateRuntimeAfterBackup','finalHostPreflight'];
const locked=Object.freeze({
 mergeAuthorized:false,deployAuthorized:false,releaseAuthorized:false,
 productionReady:false,externalHostingIndependentlyVerified:false,
 operatorApprovalGranted:false
});
const abs=x=>typeof x==='string'&&(isAbsolute(x)||win32.isAbsolute(x));
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nested=(x,root)=>x===root||x.startsWith(root+sep);
const validDate=x=>typeof x==='string'&&
 /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)&&
 !Number.isNaN(Date.parse(x));
export function parseHandoffArgs(argv=[]){
 const options={},allowed=new Set([
  'sha','db','candidate-db','backup-dir','scratch-dir','review','inventory','url','receipt'
 ]);
 for(const arg of argv){
  const m=/^--([a-z-]+)=(.+)$/.exec(arg);
  if(!m||!allowed.has(m[1])||Object.hasOwn(options,m[1]))
   throw Error('Invalid or duplicate operator handoff parameter');
  options[m[1]]=m[2];
 }
 if(Object.keys(options).length!==allowed.size||!abs(options.receipt)||
  !options.receipt.endsWith('.v71-receipt.json'))
  throw Error('Explicit absolute receipt path and all V67 parameters required');
 const normalized=parseReviewArgs(argv.filter(x=>!x.startsWith('--receipt=')));
 const receipt=resolve(options.receipt);
 if([normalized.db,normalized.candidateDb,normalized.backupDir,
  normalized.scratchDir,normalized.review,normalized.inventory].some(x=>x===receipt))
  throw Error('Receipt cannot alias private operator input files');
 return {...normalized,receipt};
}
export function privateReceiptLocation(receipt,{cwd=process.cwd()}={}){
 if(!abs(receipt)||!receipt.endsWith('.v71-receipt.json'))
  throw Error('Receipt path must be an absolute V71 JSON filename');
 const target=resolve(receipt),parent=resolve(dirname(target));
 const s=lstatSync(parent);
 if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(parent)!==parent)
  throw Error('Receipt parent must be a real private directory');
 if(process.platform!=='win32'&&((s.mode&0o077)!==0||
   s.uid!==process.getuid?.()))
  throw Error('Receipt parent must be owned by current process and private');
 if(nested(target,realpathSync(cwd)))
  throw Error('Operator receipt must be outside Git checkout');
 if(basename(target)==='.v71-receipt.json')
  throw Error('Receipt filename must have a unique prefix');
 return target;
}
export function makeReceipt(sha,report,{date=new Date()}={}){
 if(!SHA.test(sha||'')||!Number.isFinite(date?.getTime?.()))
  throw Error('V71 fixed SHA and valid time are required');
 const common={kind:KIND,schemaVersion:1,candidateCommit:sha,
  recordedAt:date.toISOString(),...locked};
 const approved=report?.kind==='content-studio-v67-operator-review-handoff'&&
  report?.candidateCommit===sha&&report.technicalReviewReady===true&&
  STAGE_KEYS.every(k=>report.stages?.[k]==='passed')&&
  Object.keys(report.stages||{}).length===STAGE_KEYS.length&&
  BUILD.test(report.buildId||'')&&DIGEST.test(report.artifactDigestSha256||'')&&
  DIGEST.test(report.dependencyLockSha256||'')&&
  BACKUP.test(report.backupFilename||'')&&report.backupRetainedForOperator===true&&
  report.candidateProcessStable===true&&report.candidateDatabaseIsolated===true&&
  report.activeDatabaseIdentityMatchesOperatorSelectedFile===true&&
  report.candidateOsSourceReadDenied===true&&
  report.candidateRunsUnderDistinctPosixUid===true&&
  report.operatorManualInventoryRecorded===true&&
  report.privateDataIncluded===false&&report.realOperatorHostTestedByCI===false&&
  report.approvalDocumentProduced===false&&
  Object.entries(locked).every(([k,v])=>report[k]===v);
 const payload=approved
  ? {...common,status:'technical_review_recorded',
    stages:Object.fromEntries(STAGE_KEYS.map(k=>[k,'passed'])),
    buildId:report.buildId,artifactDigestSha256:report.artifactDigestSha256,
    dependencyLockSha256:report.dependencyLockSha256,
    backupFilename:report.backupFilename}
  : {...common,status:'blocked',reasonCode:'technical_review_not_complete'};
 return {...payload,receiptDigestSha256:digest(payload)};
}
function payloadOf(input){
 const {receiptDigestSha256,...payload}=input;
 return payload;
}
export function validateReceipt(input,sha){
 if(!input||typeof input!=='object'||Array.isArray(input)||!SHA.test(sha||''))
  throw Error('Receipt schema or SHA invalid');
 const commonKeys=['kind','schemaVersion','candidateCommit','recordedAt',
  ...Object.keys(locked),'status','receiptDigestSha256'];
 const successKeys=['stages','buildId','artifactDigestSha256','dependencyLockSha256','backupFilename'];
 const blockedKeys=['reasonCode'];
 const keys=[...commonKeys,...(input.status==='technical_review_recorded'?successKeys:blockedKeys)].sort();
 if(Object.keys(input).sort().join('|')!==keys.join('|')||
  input.kind!==KIND||input.schemaVersion!==1||
  input.candidateCommit!==sha||!validDate(input.recordedAt)||
  Object.entries(locked).some(([k,v])=>input[k]!==v)||
  !DIGEST.test(input.receiptDigestSha256||'')||
  digest(payloadOf(input))!==input.receiptDigestSha256)
  throw Error('Receipt mismatch or modification');
 if(input.status==='technical_review_recorded'){
  if(Object.keys(input.stages||{}).sort().join('|')!==STAGE_KEYS.slice().sort().join('|')||
   STAGE_KEYS.some(k=>input.stages[k]!=='passed')||
   !BUILD.test(input.buildId||'')||!DIGEST.test(input.artifactDigestSha256||'')||
   !DIGEST.test(input.dependencyLockSha256||'')||
   !BACKUP.test(input.backupFilename||''))
   throw Error('Technical handoff receipt stages incomplete');
 }else if(input.status!=='blocked'||input.reasonCode!=='technical_review_not_complete')
  throw Error('Blocked receipt invalid');
 return {kind:'content-studio-v71-receipt-check',candidateCommit:sha,
  receiptIntegrityValid:true,recordedStatus:input.status,
  technicalReviewRecorded:input.status==='technical_review_recorded',
  independentlySigned:false,realHostIndependentlyVerified:false,...locked};
}
export function readReceipt(receipt,sha){
 const s=lstatSync(receipt);
 if(!s.isFile()||s.isSymbolicLink()||s.size<20||s.size>4096||
  (process.platform!=='win32'&&((s.mode&0o077)!==0||s.uid!==process.getuid?.())))
  throw Error('Receipt file not private and regular');
 let parsed;
 try{parsed=JSON.parse(readFileSync(receipt,'utf8'))}
 catch{throw Error('Receipt JSON could not be read')}
 return validateReceipt(parsed,sha);
}
export async function recordHandoff(input,{
 review=reviewOperatorRelease,now=()=>new Date(),location=privateReceiptLocation,
 open=openSync,write=writeFileSync,flush=fsyncSync,close=closeSync
}={}){
 const opts=Array.isArray(input)?parseHandoffArgs(input):input;
 if(!SHA.test(opts?.sha||''))throw Error('Pinned operator SHA required');
 const receipt=location(opts.receipt);
 // Exclusive reservation happens BEFORE a backup is attempted, so retries
 // cannot silently overwrite old evidence after doing expensive DB work.
 const fd=open(receipt,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|
  (constants.O_NOFOLLOW||0),0o600);
 let record,failed=false,ioFailure=false;
 try{
  let result;
  try{result=await review(opts)}
  catch{failed=true}
  record=makeReceipt(opts.sha,result,{date:now()});
  if(record.status!=='technical_review_recorded')failed=true;
  write(fd,JSON.stringify(record,null,2)+'\n',{encoding:'utf8'});
  flush(fd);
 }catch{ioFailure=true}
 finally{close(fd)}
 if(ioFailure)throw Error('V71 local receipt could not be persisted safely');
 const checked=readReceipt(receipt,opts.sha);
 if(failed)throw Error('V71 local technical handoff blocked; consult private host evidence');
 return checked;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args[0]==='verify'){
  try{
   if(args.length!==3||!/^--sha=[a-f0-9]{40}$/.test(args[1])||
    !/^--receipt=.+\.v71-receipt\.json$/.test(args[2]))
    throw Error('Expected explicit receipt and SHA');
   const receipt=privateReceiptLocation(args[2].slice(10));
   console.log(JSON.stringify(readReceipt(receipt,args[1].slice(6)),null,2));
  }catch{
   console.error('V71 local receipt integrity could not be verified');
   process.exitCode=1;
  }
 }else{
  recordHandoff(args).then(result=>console.log(JSON.stringify(result,null,2)))
   .catch(()=>{
    console.error('V71 handoff not accepted; inspect protected local receipt and operator environment');
    process.exitCode=1;
   });
 }
}

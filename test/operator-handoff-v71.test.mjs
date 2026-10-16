import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,chmodSync,readFileSync,writeFileSync,
 rmSync,statSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseHandoffArgs,privateReceiptLocation,makeReceipt,validateReceipt,
 readReceipt,recordHandoff} from '../scripts/operator-handoff-v71.mjs';
const sha='a'.repeat(40);
const good={
 kind:'content-studio-v67-operator-review-handoff',
 candidateCommit:sha,technicalReviewReady:true,
 stages:{initialHostPreflight:'passed',candidateRuntimeBeforeBackup:'passed',
  newWalBackupAndIsolatedRollback:'passed',candidateRuntimeAfterBackup:'passed',
  finalHostPreflight:'passed'},
 buildId:'realisticNextBuild_01',artifactDigestSha256:'b'.repeat(64),
 dependencyLockSha256:'c'.repeat(64),
 backupFilename:'content-studio-pre-release-'+sha.slice(0,12)+'-'+'d'.repeat(16)+'.sqlite',
 backupRetainedForOperator:true,candidateProcessStable:true,candidateDatabaseIsolated:true,
 activeDatabaseIdentityMatchesOperatorSelectedFile:true,
 candidateOsSourceReadDenied:true,candidateRunsUnderDistinctPosixUid:true,
 operatorManualInventoryRecorded:true,privateDataIncluded:false,
 realOperatorHostTestedByCI:false,approvalDocumentProduced:false,
 mergeAuthorized:false,deployAuthorized:false,releaseAuthorized:false,
 productionReady:false,externalHostingIndependentlyVerified:false,
 operatorApprovalGranted:false
};
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'cs-v71-receipt-'));
 t.after(()=>rmSync(root,{force:true,recursive:true}));
 const folder=join(root,'private');
 mkdirSync(folder,{mode:0o700});chmodSync(folder,0o700);
 const receipt=join(folder,'candidate-a.v71-receipt.json');
 return {root,folder,receipt,sha};
}
function args(receipt){
 return ['--sha='+sha,'--db=/private/source.sqlite',
  '--candidate-db=/safe/candidate.sqlite','--backup-dir=/protected/backup',
  '--scratch-dir=/protected/scratch','--review=/protected/review.json',
  '--inventory=/protected/inventory.json','--url=http://127.0.0.1:4312/',
  '--receipt='+receipt];
}
test('V71 explicitly accepts V67 args with a separate absolute receipt path',t=>{
 const f=fixture(t),parsed=parseHandoffArgs(args(f.receipt));
 assert.equal(parsed.sha,sha);assert.equal(parsed.receipt,f.receipt);
 for(const incorrect of [[...args(f.receipt),'--receipt='+f.receipt],
  args(f.receipt).map(x=>x.startsWith('--receipt=')?'--receipt=local.v71-receipt.json':x),
  [...args(f.receipt),'--token=SENSITIVE'],args(f.receipt).slice(0,-1)])
  assert.throws(()=>parseHandoffArgs(incorrect));
});
test('V71 real 0600 receipt stores only allowlisted technical fields and verifies offline',async t=>{
 const f=fixture(t),result=await recordHandoff(parseHandoffArgs(args(f.receipt)),
  {review:async()=>({...good,superPrivateSource:'/secret/db.sqlite',apiKey:'SECRET'})});
 assert.equal(result.receiptIntegrityValid,true);
 assert.equal(result.technicalReviewRecorded,true);
 assert.equal(result.releaseAuthorized,false);
 const stored=readFileSync(f.receipt,'utf8');
 assert.equal(statSync(f.receipt).mode&0o777,0o600);
 assert.equal(stored.includes('/secret/db.sqlite'),false);
 assert.equal(stored.includes('SECRET'),false);
 assert.equal(stored.includes('/private/source.sqlite'),false);
 assert.deepEqual(readReceipt(f.receipt,sha),result);
});
test('V71 failed real review writes a minimal blocked receipt and never claims ready',async t=>{
 const f=fixture(t);
 await assert.rejects(()=>recordHandoff(parseHandoffArgs(args(f.receipt)),
  {review:async()=>{throw Error('operator sensitive path and token SECRET')}}),/blocked/);
 const value=JSON.parse(readFileSync(f.receipt,'utf8'));
 assert.equal(value.status,'blocked');
 assert.equal(value.reasonCode,'technical_review_not_complete');
 assert.equal(JSON.stringify(value).includes('SECRET'),false);
 assert.equal(readReceipt(f.receipt,sha).technicalReviewRecorded,false);
});
test('V71 missing one success flag cannot be laundered as a success receipt',async t=>{
 const f=fixture(t);
 await assert.rejects(()=>recordHandoff(parseHandoffArgs(args(f.receipt)),
  {review:async()=>({...good,candidateOsSourceReadDenied:false})}),/blocked/);
 assert.equal(JSON.parse(readFileSync(f.receipt,'utf8')).status,'blocked');
});
test('V71 exactly-once reservation prevents overwrites and cannot rerun backups',async t=>{
 const f=fixture(t),opts=parseHandoffArgs(args(f.receipt));
 await recordHandoff(opts,{review:async()=>good});
 let executions=0;
 await assert.rejects(()=>recordHandoff(opts,{review:async()=>{
  executions++;return good
 }}),/EEXIST/);
 assert.equal(executions,0);
});
test('V71 verifies receipt SHA binding and changed digest fails closed',async t=>{
 const f=fixture(t);
 await recordHandoff(parseHandoffArgs(args(f.receipt)),{review:async()=>good});
 assert.throws(()=>readReceipt(f.receipt,'b'.repeat(40)),/mismatch/);
 const payload=JSON.parse(readFileSync(f.receipt,'utf8'));
 payload.artifactDigestSha256='f'.repeat(64);
 writeFileSync(f.receipt,JSON.stringify(payload));
 assert.throws(()=>readReceipt(f.receipt,sha),/mismatch/);
});
test('V71 cannot include unauthorized extra private fields, even with no digest change',()=>{
 const r=makeReceipt(sha,good);
 assert.throws(()=>validateReceipt({...r,rawDatabase:'/private/db.sqlite'},sha),/mismatch/);
});
test('V71 refuses public receipt directory and symlinked receipt',async t=>{
 const f=fixture(t),pub=join(f.root,'public');
 mkdirSync(pub,{mode:0o755});chmodSync(pub,0o755);
 if(process.platform!=='win32')
  assert.throws(()=>privateReceiptLocation(join(pub,'x.v71-receipt.json')),/private/);
 await recordHandoff(parseHandoffArgs(args(f.receipt)),{review:async()=>good});
 const alias=join(f.folder,'linked.v71-receipt.json');
 symlinkSync(f.receipt,alias);
 assert.throws(()=>readReceipt(alias,sha),/regular/);
});
test('V71 refuses blocked receipt with forged success and incorrect schema',()=>{
 const b=makeReceipt(sha,null),g=makeReceipt(sha,good);
 assert.equal(validateReceipt(b,sha).technicalReviewRecorded,false);
 assert.throws(()=>validateReceipt({...b,status:'technical_review_recorded'},sha));
 assert.throws(()=>validateReceipt({...g,mergeAuthorized:true},sha));
});
test('V71 rejects untrusted/unsafe build ID and private backup filename',()=>{
 assert.equal(makeReceipt(sha,{...good,buildId:'/private/source'}).status,'blocked');
 assert.equal(makeReceipt(sha,{...good,backupFilename:'/secret/backup.sqlite'}).status,'blocked');
});
test('V71 refuses receipt creation inside source checkout',()=>{
 assert.throws(()=>privateReceiptLocation(join(process.cwd(),'inside.v71-receipt.json')));
});

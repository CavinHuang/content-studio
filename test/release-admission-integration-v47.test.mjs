import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAdmissionArgs,releaseAdmission} from '../scripts/release-admission.mjs';

const passing={
 inspect:async()=>({integrity:'ok',tableCount:41,rowCount:99,schemaSha256:'schema-synthetic',missingCoreTables:[]}),
 verify:async()=>({backupValid:true,manifestVerified:true,sha256:'backed-up-fixture',schemaSha256:'schema-synthetic',rowCount:99}),
 rehearsal:async()=>({verified:true,upgradeOpenedSuccessfully:true,sourceUntouched:true,temporaryCopiesDeleted:true,newTables:[]}),
 providers:()=>[{id:'openai',model:'mock',configured:false,problems:['missing_api_key']}]
};
const accepted={sourceUntouched:true,existingRowsUnchanged:true,syntheticOnly:true,
 historicProjectsInspected:2,historicRowsProtected:56,synthetic:{
  textOnly:{channels:2},illustrated:{channels:2}
 }};
test('V47 candidate admission requires an explicit restored business integration rehearsal',async()=>{
 const report=await releaseAdmission(['--db=/synthetic/source.sqlite','--backup=/synthetic/archive.sqlite','--rehearse'],passing);
 assert.equal(report.localGatesPassed,true);
 assert.equal(report.candidateGatesPassed,false);
 assert.equal(report.integration.status,'not_checked');
 assert.equal(report.productionReady,false);
 assert.equal(report.platformVerified,false);
});
test('V47 full candidate admission stays strictly separate from actual platform and paid-model attestation',async()=>{
 let called=0;
 const report=await releaseAdmission(['--db=/synthetic/source.sqlite','--backup=/synthetic/archive.sqlite','--rehearse','--integration'],{
  ...passing,integration:async()=>{called++;return accepted}
 });
 assert.equal(called,1);
 assert.equal(report.localGatesPassed,true);
 assert.equal(report.candidateGatesPassed,true);
 assert.equal(report.integration.status,'passed');
 assert.equal(report.integration.historicRowsProtected,56);
 assert.equal(report.integration.simulatedChannels,4);
 assert.equal(report.integration.paidModelRequests,0);
 assert.equal(report.paidModelRequests,0);
 assert.equal(report.productionReady,false);
 assert.equal(report.deployAuthorized,false);
 assert.equal(report.platformVerified,false);
 assert.equal(report.manualAcceptance.every(x=>x.status==='unverified'),true);
 assert.equal(report.kind,'content-studio-v47-release-admission');
});
test('V47 injected rehearsal failure is blocked and hides private exception messages',async()=>{
 const r=await releaseAdmission(['--db=/synthetic/source.sqlite','--backup=/synthetic/archive.sqlite','--rehearse','--integration'],{
  ...passing,integration:async()=>{throw Error('LOCAL_PRIVATE_AUTHOR_CONTENT_DO_NOT_LEAK')}
 });
 assert.equal(r.candidateGatesPassed,false);
 assert.equal(r.localGatesPassed,false);
 assert.equal(r.integration.status,'blocked');
 assert.ok(r.localBlockers.includes('integration_rehearsal_failed'));
 assert.equal(JSON.stringify(r).includes('LOCAL_PRIVATE_AUTHOR_CONTENT_DO_NOT_LEAK'),false);
});
test('V47 parsing refuses accidental or repeated integration flag',()=>{
 assert.deepEqual(parseAdmissionArgs(['--integration']),{rehearse:false,integration:true});
 assert.throws(()=>parseAdmissionArgs(['--integration','--integration']),/Duplicate --integration/);
});

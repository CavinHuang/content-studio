import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseAdmission,parseAdmissionArgs} from '../scripts/release-admission.mjs';

test('V46 admission reports local blockers without accidentally creating databases or paid calls',async()=>{
 let calls=0;
 const result=await releaseAdmission(['--db=/a/not-existing-db.sqlite'],{
  inspect:async()=>{throw Error('ENOENT sensitive/local/file')},
  verify:async()=>{calls++;throw Error('unexpected')},
  rehearsal:async()=>{calls++;throw Error('unexpected')},
  providers:()=>[{id:'openai',model:'fake-model',configured:false,problems:['missing_api_key']}]
 });
 assert.deepEqual(result.localBlockers,['database_missing_or_inaccessible','backup_not_supplied','upgrade_rehearsal_not_requested']);
 assert.equal(calls,0);
 assert.equal(result.productionReady,false);
 assert.equal(result.platformVerified,false);
 assert.equal(result.paidModelRequests,0);
 assert.equal(result.manualAcceptance.every(x=>x.status==='unverified'),true);
 assert.equal(result.providerContracts[0].liveApiChecked,false);
 assert.equal(JSON.stringify(result).includes('sensitive/local/file'),false);
});
test('V46 successful offline evidence is never promoted to platform verification or deployment approval',async()=>{
 let checked=0;
 const result=await releaseAdmission(['--db=/synthetic/private.sqlite','--backup=/synthetic/checked.sqlite','--rehearse'],{
  inspect:async()=>({integrity:'ok',tableCount:91,rowCount:125,schemaSha256:'test-fingerprint',missingCoreTables:[]}),
  verify:async()=>({backupValid:true,manifestVerified:true,sha256:'backup-digest',schemaSha256:'test-fingerprint',rowCount:125}),
  rehearsal:async()=>{checked++;return {verified:true,upgradeOpenedSuccessfully:true,sourceUntouched:true,temporaryCopiesDeleted:true,newTables:[]}},
  providers:()=>[{id:'openai',model:'synthetic-image',configured:true,problems:[],key:'SECRET_KEY_SHOULD_NOT_RENDER'}]
 });
 assert.equal(checked,1);
 assert.deepEqual(result.localBlockers,[]);
 assert.equal(result.localGatesPassed,true);
 assert.equal(result.productionReady,false);
 assert.equal(result.deployAuthorized,false);
 assert.equal(result.platformVerified,false);
 assert.equal(result.providerContracts[0].locallyConfigured,true);
 assert.equal(result.providerContracts[0].liveApiChecked,false);
 assert.equal(result.manualAcceptance.length,6);
 assert.ok(!JSON.stringify(result).includes('SECRET_KEY_SHOULD_NOT_RENDER'));
});
test('V46 backup corrupt or upgrade failed is distinctly blocked even with valid database',async()=>{
 const result=await releaseAdmission(['--db=/test/db.sqlite','--backup=/corrupt/backup.sqlite','--rehearse'],{
  inspect:async()=>({integrity:'ok',tableCount:3,rowCount:3,schemaSha256:'schema',missingCoreTables:[]}),
  verify:async()=>{throw Error('checksum details must not leak')},
  rehearsal:async()=>{throw Error('private source JSON must not leak')},
  providers:()=>[]
 });
 assert.equal(result.localGatesPassed,false);
 assert.ok(result.localBlockers.includes('backup_missing_or_corrupt'));
 assert.ok(result.localBlockers.includes('upgrade_rehearsal_failed'));
 assert.equal(JSON.stringify(result).includes('private source JSON'),false);
});
test('V46 admission argument parsing rejects ambiguous or untrusted parameters',()=>{
 assert.deepEqual(parseAdmissionArgs(['--db=/tmp/private.sqlite','--backup=/tmp/safe.sqlite','--rehearse']),{
  db:'/tmp/private.sqlite',backup:'/tmp/safe.sqlite',rehearse:true,integration:false
 });
 assert.throws(()=>parseAdmissionArgs(['--execute-paid']),/Use --db=/);
 assert.throws(()=>parseAdmissionArgs(['--rehearse','--rehearse']),/Duplicate/);
 assert.throws(()=>parseAdmissionArgs(['--db=one','--db=two']),/Use --db=/);
});

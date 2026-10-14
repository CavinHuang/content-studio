import test from 'node:test';
import assert from 'node:assert/strict';
import {assessConsolidatedIntegration,classifyReleaseSurface,releaseVersionOk,V54_ANCHORS} from '../scripts/integration-gate-v54.mjs';

const main=V54_ANCHORS.mainBeforeV49;
const stages=V54_ANCHORS.stages;
const tips=Object.fromEntries(stages.map(stage=>[stage.branch,stage.sha]));
function evaluate({
 integrated=false,mainSha=main,version='0.54.0',
 changedFiles=['.github/workflows/ci.yml','package.json','scripts/runtime-guard.mjs','src/assets.mjs'],
 branchTips=tips,broken=null,extraAlternative=false
}={}){
 const head='v54-synthetic-head';
 const order=[main,...stages.map(x=>x.sha),head];
 const mainPosition=integrated?stages.length:0;
 const idx=Object.fromEntries(order.map((sha,i)=>[sha,i]));
 idx['refs/remotes/origin/main']=mainPosition;
 function ancestor(older,newer){
  if(older===V54_ANCHORS.alternateV37)return extraAlternative;
  if(broken?.older===older&&broken?.newer===newer)return false;
  return idx[older]!==undefined&&idx[newer]!==undefined&&idx[older]<=idx[newer];
 }
 return assessConsolidatedIntegration({
  mainSha:integrated?'synthetic-after-merge-sha':mainSha,headSha:head,version,
  branchTips,changedFiles,isAncestor:ancestor
 });
}
test('V54 canonical V49 through V53 is a technically valid consolidated premerge candidate only',()=>{
 const report=evaluate();
 assert.equal(report.technicalHistoryValid,true,JSON.stringify(report.problems));
 assert.equal(report.mode,'premerge-candidate');
 assert.equal(report.stages.length,5);
 assert.deepEqual(report.stages.map(x=>x.pr),[21,22,23,24,25]);
 assert.ok(report.stages.every(x=>x.includedInCurrentCheckout));
 assert.equal(report.mergeAuthorized,false);
 assert.equal(report.deployAuthorized,false);
 assert.equal(report.externalDeploymentHooks,'unverified');
 assert.equal(report.productionReady,false);
 assert.equal(report.changeSurface.deploymentSensitivePaths.includes('package.json'),true);
});
test('V54 detects changed main baseline even when all feature PR heads are unchanged',()=>{
 const report=evaluate({mainSha:'unexpected-main-change'});
 assert.equal(report.technicalHistoryValid,false);
 assert.ok(report.problems.some(x=>x.code==='main_moved_since_original_review'));
 assert.equal(report.mergeAuthorized,false);
});
test('V54 detects a reviewed PR branch silently advanced after CI evidence',()=>{
 const branchTips={...tips,[stages[3].branch]:'new-unreviewed-commit'};
 const report=evaluate({branchTips});
 assert.equal(report.technicalHistoryValid,false);
 assert.ok(report.problems.some(x=>x.code==='reviewed_PR_head_changed'&&x.detail==='V52'));
});
test('V54 rejects the alternate PR #8 and lost canonical ancestors',()=>{
 const alternate=evaluate({extraAlternative:true});
 assert.ok(alternate.problems.some(x=>x.code==='alternate_v37_not_permitted'));
 const missing=evaluate({broken:{older:stages[2].sha,newer:'v54-synthetic-head'}});
 assert.ok(missing.problems.some(x=>x.code==='missing_feature_history'&&x.detail==='V51'));
 const wrongChain=evaluate({broken:{older:stages[1].sha,newer:stages[2].sha}});
 assert.ok(wrongChain.problems.some(x=>x.code==='noncanonical_stack_history'&&x.detail==='V51'));
});
test('V54 postmerge checks immutable history and no longer relies on deleted Draft branch refs',()=>{
 const done=evaluate({integrated:true,branchTips:{}});
 assert.equal(done.mode,'integrated-mainline');
 assert.equal(done.technicalHistoryValid,true,JSON.stringify(done.problems));
 assert.ok(done.stages.every(x=>!x.remoteTipChecked));
 assert.equal(done.productionReady,false);
 assert.equal(done.mergeAuthorized,false);
});
test('V54 rejects version regression regardless of Git ancestry and accepts future patch/minor',()=>{
 for(const version of ['0.53.9','0.49.1','invalid']){
  assert.equal(releaseVersionOk(version),false);
  assert.ok(evaluate({version}).problems.some(x=>x.code==='release_version_too_old'));
 }
 for(const version of ['0.54.0','0.54.1','0.55.0','1.0.0'])
  assert.equal(releaseVersionOk(version),true);
});
test('V54 file surface audit includes build/deployment and schema-sensitive paths without secrets',()=>{
 const r=classifyReleaseSurface([
  'package.json','.github/workflows/ci.yml','Dockerfile','docker-compose.doocs.yml',
  'scripts/build-guard.mjs','scripts/runtime-guard.mjs','src/assets.mjs','src/store.mjs','README.md',
  'README.md'
 ]);
 assert.equal(r.totalFiles,9);
 assert.equal(r.deploymentSensitivePaths.length,6);
 assert.ok(r.databaseSensitivePaths.includes('src/assets.mjs'));
 assert.ok(r.databaseSensitivePaths.includes('src/store.mjs'));
 assert.equal(JSON.stringify(r).includes('actualDatabaseUpgrade'),false);
});
test('V54 even a valid commit chain cannot certify external deploy hooks or make release ready',()=>{
 const result=evaluate({integrated:true});
 assert.equal(result.technicalHistoryValid,true);
 assert.equal(result.fullBrowserCI,'requires_separate_final_SHA_result');
 assert.equal(result.actualDatabaseUpgrade,'not_executed');
 assert.equal(result.realPublishing,'not_executed');
 assert.equal(result.publisherCredentials,'not_accessed');
 assert.equal(result.productionHost,'unverified');
 assert.equal(result.deployAuthorized,false);
 assert.equal(result.productionReady,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {auditReleaseLineage} from '../scripts/verify-release-lineage.mjs';
import {INTEGRATION_ANCHORS} from '../scripts/verify-main.mjs';

const proof=(ref,to)=>{
 if(ref===INTEGRATION_ANCHORS.alternateV37)return false;
 if(ref==='refs/remotes/origin/main')return to==='HEAD';
 return to==='HEAD';
};
test('V48 selects full stacked DAG verification before any code reaches main',()=>{
 let visited=false;
 const result=auditReleaseLineage({
  integratedMain:false,version:'0.48.0',isAncestor:proof,
  stackReport:()=>{visited=true;return {verified:true,problems:[],canonicalBranches:20}}
 });
 assert.equal(visited,true);
 assert.equal(result.mode,'stacked-candidate');
 assert.equal(result.canonicalBranches,20);
 assert.equal(result.verified,true);
});
test('V48 switches to integrated DAG verification after main contains V47 (also for future PRs)',()=>{
 const result=auditReleaseLineage({
  integratedMain:true,version:'0.48.0',isAncestor:proof,
  stackReport:()=>{throw Error('Must not invoke draft-stack gate after main merged')}
 });
 assert.equal(result.mode,'integrated-mainline-or-descendant');
 assert.equal(result.verified,true);
 assert.equal(result.productionReady,false);
});
test('V48 rejects future PR checkout that is not descended from integrated main',()=>{
 const bad=auditReleaseLineage({
  integratedMain:true,version:'0.48.0',
  isAncestor:(ref,to)=>ref==='refs/remotes/origin/main'?false:proof(ref,to),
  stackReport:()=>{throw Error('should not evaluate old stack')}
 });
 assert.equal(bad.verified,false);
 assert.ok(bad.problems.includes('current_checkout_not_based_on_integrated_main'));
});
test('V48 refuses an integrated main containing the alternate V37 fork',()=>{
 const bad=auditReleaseLineage({
  integratedMain:true,version:'0.48.0',
  isAncestor:(ref,to)=>ref===INTEGRATION_ANCHORS.alternateV37?true:proof(ref,to),
  stackReport:()=>null
 });
 assert.equal(bad.verified,false);
 assert.ok(bad.problems.includes('alternative_V37_excluded'));
});

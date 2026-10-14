import test from 'node:test';
import assert from 'node:assert/strict';
import {auditMainline,INTEGRATION_ANCHORS} from '../scripts/verify-main.mjs';
import {CANONICAL_BRANCHES,inspectBranchChain} from '../scripts/verify-stack.mjs';

function integrated({excludeAlternative=true,omit=null}={}){
 const safe=new Set([
  INTEGRATION_ANCHORS.preIntegrationMain,
  INTEGRATION_ANCHORS.firstPR,
  INTEGRATION_ANCHORS.canonicalV37,
  INTEGRATION_ANCHORS.lastPreIntegrationFeature
 ]);
 if(!excludeAlternative)safe.add(INTEGRATION_ANCHORS.alternateV37);
 if(omit)safe.delete(omit);
 return auditMainline({version:'0.48.0',isAncestor:(ref,child)=>child==='HEAD'&&safe.has(ref)});
}
test('V48 merged mainline passes historical commit evidence without requiring deleted PR refs',()=>{
 const r=integrated();
 assert.equal(r.phase,'integrated-main');
 assert.equal(r.verified,true,JSON.stringify(r.problems));
 assert.deepEqual(r.problems,[]);
 assert.equal(r.releaseVersion,'0.48.0');
 assert.equal(r.productionReady,false);
 assert.equal(r.deployAuthorized,false);
 assert.equal(r.platformVerified,false);
 assert.equal(r.checks.length,6);
});
test('V48 prevents release if canonical V37 is replaced by alternative PR #8',()=>{
 const wrong=integrated({excludeAlternative:false});
 assert.equal(wrong.verified,false);
 assert.ok(wrong.problems.includes('alternative_V37_excluded'));
 const missing=integrated({omit:INTEGRATION_ANCHORS.canonicalV37});
 assert.equal(missing.verified,false);
 assert.ok(missing.problems.includes('canonical_V37_integrated'));
});
test('V48 rejects false merge of code missing complete V47 baseline or original main history',()=>{
 const lacksPrevious=integrated({omit:INTEGRATION_ANCHORS.lastPreIntegrationFeature});
 assert.ok(lacksPrevious.problems.includes('V47_integrated'));
 const lacksMain=integrated({omit:INTEGRATION_ANCHORS.preIntegrationMain});
 assert.ok(lacksMain.problems.includes('pre_integration_main_is_ancestor'));
 const oldVersion=auditMainline({isAncestor:()=>true,version:'0.47.0'});
 assert.equal(oldVersion.verified,false);
 assert.ok(oldVersion.problems.includes('integrated_version'));
});
test('V48 detects postmerge tree replacement when compared with the approved candidate',()=>{
 const checks=()=>auditMainline({isAncestor:ref=>ref!==INTEGRATION_ANCHORS.alternateV37,
  version:'0.48.0',treeMatchesCandidate:false});
 assert.ok(checks().problems.includes('merge_tree_matches_release_candidate'));
 assert.equal(auditMainline({isAncestor:ref=>ref!==INTEGRATION_ANCHORS.alternateV37,
  version:'0.48.0',treeMatchesCandidate:true}).verified,true);
});
test('V48 candidate lineage still detects missing and diverged integration branch refs',()=>{
 const refs=new Set(CANONICAL_BRANCHES.map(x=>'refs/remotes/origin/'+x));
 const parents=new Map(CANONICAL_BRANCHES.slice(1).map((x,i)=>[
  'refs/remotes/origin/'+x,'refs/remotes/origin/'+CANONICAL_BRANCHES[i]
 ]));
 const ancestor=(a,b)=>b==='HEAD'?a==='refs/remotes/origin/main'||a==='refs/remotes/origin/feat/v48-mainline-integration':parents.get(b)===a;
 const fresh=inspectBranchChain({hasRef:ref=>refs.has(ref),isAncestor:ancestor});
 assert.equal(fresh.verified,true);
 assert.equal(fresh.canonicalBranches,20);
 assert.equal(fresh.mergedToMain,false);
 refs.delete('refs/remotes/origin/feat/v48-mainline-integration');
 const stale=inspectBranchChain({hasRef:ref=>refs.has(ref),isAncestor:ancestor});
 assert.equal(stale.verified,false);
 assert.ok(stale.problems.includes('missing_remote_ref:feat/v48-mainline-integration'));
});

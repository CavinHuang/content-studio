/** V47 local git release-candidate lineage check.
 * Checks actual ancestry, not names/README claims. No merges, network or writes.
 */
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const CANONICAL_BRANCHES=Object.freeze([
 'main',
 'feat/v30-markdown-evidence-review',
 'feat/v31-channel-paste-compat',
 'feat/v32-agent-auto-illustrations',
 'feat/v33-multi-model-illustration-agent',
 'feat/v34-visual-review-retry',
 'feat/v35-reference-image-editing',
 'feat/v36-image-feedback-memory',
 'feat/v37-visual-series-library', // PR #9, not alternative PR #8
 'feat/v38-image-request-budgets',
 'feat/v39-durable-illustration-queue',
 'feat/v40-provider-contract-preflight',
 'feat/v41-browser-live-smoke-gates',
 'feat/v42-visual-audit-handoff-regression',
 'feat/v43-image-quality-roundtrip',
 'feat/v44-unified-delivery-readiness',
 'feat/v45-database-recovery-hardening',
 'feat/v46-integration-release-gates',
 'feat/v47-restored-data-acceptance'
]);
export const ALTERNATIVE_V37='feat/v37-series-visual-library';
function git(...args){
 const result=spawnSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:256000});
 if(result.error)throw Error('Git unavailable in this checkout');
 return {code:result.status,stdout:result.stdout?.trim()||'',stderr:result.stderr?.trim()||''};
}
export function inspectBranchChain({hasRef,isAncestor,hasAlternative=()=>false}){
 const problems=[],steps=[];
 for(let i=0;i<CANONICAL_BRANCHES.length;i++){
  const name=CANONICAL_BRANCHES[i],ref='refs/remotes/origin/'+name;
  const previous=i>0?'refs/remotes/origin/'+CANONICAL_BRANCHES[i-1]:null;
  if(!hasRef(ref)){problems.push('missing_remote_ref:'+name);steps.push({branch:name,result:'missing'});continue}
  if(previous&&hasRef(previous)&&!isAncestor(previous,ref)){
   problems.push('unexpected_branch_ancestry:'+name);steps.push({branch:name,result:'diverged'});
  }else steps.push({branch:name,result:'ancestor_confirmed'});
 }
 const final='refs/remotes/origin/'+CANONICAL_BRANCHES.at(-1);
 if(hasRef(final)&&!isAncestor(final,'HEAD'))problems.push('current_checkout_does_not_contain_candidate');
 const main='refs/remotes/origin/main';
 if(hasRef(main)&&!isAncestor(main,'HEAD'))problems.push('current_main_not_ancestor_of_candidate');
 const alternative=hasAlternative('refs/remotes/origin/'+ALTERNATIVE_V37);
 return {verified:!problems.length,canonicalBranches:CANONICAL_BRANCHES.length,checkedRelationships:steps.filter(x=>x.result==='ancestor_confirmed').length-1,
  candidate:CANONICAL_BRANCHES.at(-1),steps,problems,
  alternativeV37:{branch:ALTERNATIVE_V37,present:alternative,canonical:false,
   action:'Do not merge PR #8 as if it were an ancestor of PR #9'},
  mergedToMain:false,releasePublished:false};
}
export function verifyCurrentCheckout(){
 return inspectBranchChain({
  hasRef:ref=>git('show-ref','--verify','--quiet',ref).code===0,
  isAncestor:(parent,child)=>git('merge-base','--is-ancestor',parent,child).code===0,
  hasAlternative:ref=>git('show-ref','--verify','--quiet',ref).code===0
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const result=verifyCurrentCheckout();
  console.log(JSON.stringify(result,null,2));
  if(!result.verified)process.exitCode=1;
 }catch(e){console.error('Release ancestry check cannot complete: '+String(e?.message||'unknown'));process.exitCode=1}
}

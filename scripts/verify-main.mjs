/**
 * V48 post-merge mainline guard, explicitly separate from the stacked PR guard.
 *
 * A release integration through a merge commit makes origin/main *descend* from
 * V30–V48; the original verify-stack relation (main ancestor of each feature
 * branch) must no longer be asserted against main after integration.
 *
 * No Git writes, network, publishing APIs, or private database access.
 */
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const INTEGRATION_ANCHORS=Object.freeze({
 preIntegrationMain:'071db4295302a10e5214a0a0835c05d13b3e7c39',
 firstPR:'3bda406c5fbbf8661742b2a258129d0170a6bacb',
 canonicalV37:'affd5d7ec183c27b14129ae8b2fdcbf6e43958d2',
 lastPreIntegrationFeature:'4ad7ff2eac7b9896f55f8378671e3f44525ac4a8',
 alternateV37:'82906f257c89e66b6c3d254afe75ebe380eb2ac3'
});
const VERSION='0.48.0';

export function auditMainline({isAncestor,version,treeMatchesCandidate=null,checkOut='HEAD'}){
 const checks=[
  ['pre_integration_main_is_ancestor',INTEGRATION_ANCHORS.preIntegrationMain,true],
  ['V30_integrated',INTEGRATION_ANCHORS.firstPR,true],
  ['canonical_V37_integrated',INTEGRATION_ANCHORS.canonicalV37,true],
  ['V47_integrated',INTEGRATION_ANCHORS.lastPreIntegrationFeature,true],
  ['alternative_V37_excluded',INTEGRATION_ANCHORS.alternateV37,false]
 ];
 const evidence=checks.map(([name,ref,expected])=>({name,pass:!!isAncestor(ref,checkOut)===expected}));
 evidence.push({name:'integrated_version',pass:version===VERSION});
 if(treeMatchesCandidate!==null)evidence.push({name:'merge_tree_matches_release_candidate',pass:!!treeMatchesCandidate});
 const problems=evidence.filter(x=>!x.pass).map(x=>x.name);
 return {phase:'integrated-main',verified:problems.length===0,releaseVersion:version,
  retainedAuditCommits:true,checks:evidence,problems,
  productionReady:false,platformVerified:false,deployAuthorized:false};
}
function git(...args){
 const out=spawnSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 if(out.error)throw Error('Git is not installed');
 return {status:out.status,out:(out.stdout||'').trim()};
}
export function verifyIntegratedCheckout(){
 const isAncestor=(a,b)=>git('merge-base','--is-ancestor',a,b).status===0;
 const branch=git('rev-parse','--abbrev-ref','HEAD').out;
 const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
 // This command is intended for the *push main* job, not the PR synthetic
 // merge ref. Detached checkout is normal in GitHub Actions on main pushes.
 const checked=git('rev-parse','HEAD').out;
 const main=git('rev-parse','refs/remotes/origin/main').out;
 const currentMain=branch==='main'||checked===main;
 const report=auditMainline({isAncestor,version});
 if(!currentMain)report.problems.push('not_main_checkout');
 if(currentMain&&checked!==main)report.problems.push('local_main_not_at_origin_main');
 report.verified=report.problems.length===0;
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const status=verifyIntegratedCheckout();
  console.log(JSON.stringify(status,null,2));
  if(!status.verified)process.exitCode=1;
 }catch(e){
  console.error('Integrated mainline audit failed: '+String(e?.message||'unknown').slice(0,180));
  process.exitCode=1;
 }
}

/**
 * V54 — single-entry audit for the V49–V54 consolidated PR.
 *
 * Operates on Git metadata alone. It cannot inspect private deployment
 * webhooks, prove third-party acceptance or authorize a merge/deployment.
 */
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const V54_ANCHORS=Object.freeze({
 mainBeforeV49:'9c6dfaa03dacb1689d1e9c256e707ab7ac094ece',
 alternateV37:'82906f257c89e66b6c3d254afe75ebe380eb2ac3',
 stages:Object.freeze([
  Object.freeze({version:'V49',pr:21,branch:'feat/v49-production-runtime-acceptance',sha:'3857211f4274a995689ef3d35ec11f5f4f339b9a'}),
  Object.freeze({version:'V50',pr:22,branch:'feat/v50-doocs-live-preflight',sha:'fdf5fc842a75e1c1cb61aec9fb466c68c506b687'}),
  Object.freeze({version:'V51',pr:23,branch:'feat/v51-real-doocs-browser-integration',sha:'1f696c243b3a826d727e09842986e0beefb532aa'}),
  Object.freeze({version:'V52',pr:24,branch:'feat/v52-image-doocs-roundtrip',sha:'b6e0c0ed83eb4391c06fe4c40f9cc1ecb6578b82'}),
  Object.freeze({version:'V53',pr:25,branch:'feat/v53-public-image-probe-gate',sha:'2fd2496a2a7d514ea6af16fb6e95d545242580b9'})
 ])
});
export function releaseVersionOk(version){
 const match=/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version));
 return !!match&&(Number(match[1])>0||(Number(match[1])===0&&Number(match[2])>=54));
}
export function classifyReleaseSurface(paths=[]){
 const all=[...new Set(paths.filter(x=>typeof x==='string'&&x.length<260))].sort();
 const deployment=all.filter(p=>/^(?:\.github\/|Dockerfile(?:\..*)?$|docker-compose(?:\..*)?\.ya?ml$|(?:vercel|netlify|railway|render|fly)\.(?:json|toml|ya?ml)$|next\.config\.[cm]?[jt]s$|package(?:-lock)?\.json$|scripts\/(?:runtime-guard|build-guard)\.mjs$)/i.test(p));
 const database=all.filter(p=>/^(?:src\/(?:store|assets|editorial|delivery-readiness)\.mjs|scripts\/(?:db-safety|integration-rehearsal)\.mjs|lib\/core\.mjs)$/i.test(p));
 return {totalFiles:all.length,deploymentSensitivePaths:deployment,databaseSensitivePaths:database};
}
function issue(check,expected,actual,problems){
 if(!check)problems.push({code:expected,detail:actual});
}
export function assessConsolidatedIntegration({
 mainSha,headSha,version,branchTips={},isAncestor,
 changedFiles=[],source='git',mainRef='refs/remotes/origin/main'
}={}){
 const problems=[],stages=V54_ANCHORS.stages,tail=stages.at(-1);
 const mainIntegrated=!!isAncestor?.(tail.sha,mainRef);
 const mode=mainIntegrated?'integrated-mainline':'premerge-candidate';
 const surface=classifyReleaseSurface(changedFiles);
 issue(releaseVersionOk(version),'release_version_too_old','expected_0_54_or_later',problems);
 issue(isAncestor?.(V54_ANCHORS.mainBeforeV49,headSha),'original_main_history_missing','V48_anchor',problems);
 issue(!isAncestor?.(V54_ANCHORS.alternateV37,headSha),'alternate_v37_not_permitted','PR_8',problems);
 issue(isAncestor?.(mainRef,headSha),'checkout_not_descended_from_current_main','branch_or_PR_merge',problems);
 const coverage=stages.map(stage=>{
  const included=!!isAncestor?.(stage.sha,headSha);
  if(!included)problems.push({code:'missing_feature_history',detail:stage.version});
  return {version:stage.version,pr:stage.pr,commit:stage.sha,
   includedInCurrentCheckout:included,remoteTipChecked:!mainIntegrated};
 });
 for(let index=1;index<stages.length;index++)
  issue(isAncestor?.(stages[index-1].sha,stages[index].sha),
   'noncanonical_stack_history',stages[index].version,problems);
 if(!mainIntegrated){
  issue(mainSha===V54_ANCHORS.mainBeforeV49,
   'main_moved_since_original_review','baseline_changed',problems);
  for(const stage of stages){
   const actual=branchTips[stage.branch]||'';
   issue(actual===stage.sha,'reviewed_PR_head_changed',stage.version,problems);
   issue(!isAncestor?.(stage.sha,mainRef),'stage_unexpectedly_reachable_from_main',stage.version,problems);
  }
 }else{
  // Existing PR branches may legitimately be deleted after merge: audit
  // reachable immutable commits instead of stale refs in postmerge mode.
  issue(isAncestor?.(tail.sha,mainRef),'integrated_main_missing_V53','canonical_tip',problems);
 }
 const technicalHistoryValid=problems.length===0;
 return {
  kind:'content-studio-v54-consolidated-integration-audit',mode,source,
  checkedHead:headSha||null,checkedMain:mainSha||null,version,
  technicalHistoryValid,problems,stages:coverage,changeSurface:surface,
  externalDeploymentHooks:'unverified',productionHost:'unverified',
  actualDatabaseUpgrade:'not_executed',publisherCredentials:'not_accessed',
  fullBrowserCI:'requires_separate_final_SHA_result',realPublishing:'not_executed',
  mergeAuthorized:false,deployAuthorized:false,productionReady:false,
  recommendation:technicalHistoryValid
   ?'Candidate history is consistent. Verify deployment triggers, CI on final SHA and backups separately; merge is NOT automatically authorized.'
   :'Stop integration: correct the listed Git ancestry, reviewed head or baseline problems first.'
 };
}
function git(...args){
 const p=spawnSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024});
 if(p.error||p.status===null)throw Error('Git invocation failed');
 return {code:p.status,out:(p.stdout||'').trim()};
}
export function runIntegrationGate(){
 const main='refs/remotes/origin/main';
 const version=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
 const headSha=git('rev-parse','HEAD').out,mainSha=git('rev-parse',main).out;
 if(!/^[0-9a-f]{40}$/.test(headSha)||!/^[0-9a-f]{40}$/.test(mainSha))
  throw Error('Full Git history and origin/main are required');
 const isAncestor=(a,b)=>git('merge-base','--is-ancestor',a,b).code===0;
 const branchTips={};
 for(const stage of V54_ANCHORS.stages) {
  const tip=git('rev-parse','--verify','refs/remotes/origin/'+stage.branch);
  if(tip.code===0)branchTips[stage.branch]=tip.out;
 }
 const changes=git('diff','--name-only',main,'HEAD');
 if(changes.code!==0)throw Error('Cannot audit main-to-candidate changed file paths');
 return assessConsolidatedIntegration({mainSha,headSha,version,branchTips,isAncestor,
  changedFiles:changes.out.split('\n').filter(Boolean)});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const result=runIntegrationGate();
  console.log(JSON.stringify(result,null,2));
  if(!result.technicalHistoryValid)process.exitCode=1;
 }catch{
  console.error('V54 integration audit failed to inspect complete local Git history');
  process.exitCode=1;
 }
}

/**
 * V48 adaptive release ancestry gate:
 * - before integration, keep the canonical V30-V48 draft ancestry check;
 * - once main contains V47, verify immutable integrated commit anchors.
 * This makes CI useful on main *and future PRs based on main*, not only the
 * one-time V48 merge. This tool never changes Git or repository metadata.
 */
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {INTEGRATION_ANCHORS,auditMainline} from './verify-main.mjs';
import {verifyCurrentCheckout} from './verify-stack.mjs';

export function auditReleaseLineage({integratedMain,isAncestor,stackReport,version}){
 if(!integratedMain){
  const candidate=stackReport();
  return {mode:'stacked-candidate',...candidate};
 }
 const main=auditMainline({isAncestor,version});
 if(!isAncestor('refs/remotes/origin/main','HEAD'))
  main.problems.push('current_checkout_not_based_on_integrated_main');
 main.verified=main.problems.length===0;
 return {mode:'integrated-mainline-or-descendant',...main};
}
function git(...args){
 const result=spawnSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 if(result.error)throw Error('Git unavailable');
 return {status:result.status,stdout:(result.stdout||'').trim()};
}
export function verifyReleaseLineage(){
 const ancestor=(older,newer)=>git('merge-base','--is-ancestor',older,newer).status===0;
 const integratedMain=ancestor(INTEGRATION_ANCHORS.lastPreIntegrationFeature,'refs/remotes/origin/main');
 const version=JSON.parse((awaitReadPackage()).toString('utf8')).version;
 return auditReleaseLineage({integratedMain,isAncestor:ancestor,version,stackReport:verifyCurrentCheckout});
}
function awaitReadPackage(){
 // Synchronous: this CLI runs at the first CI gate, before dependencies exist.
 const file=spawnSync('git',['show','HEAD:package.json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 if(file.status!==0)throw Error('Cannot read candidate package.json');
 return file.stdout;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const result=verifyReleaseLineage();
  console.log(JSON.stringify(result,null,2));
  if(!result.verified)process.exitCode=1;
 }catch(e){console.error('Integration ancestry gate failed: '+String(e?.message||'unknown').slice(0,160));process.exitCode=1}
}

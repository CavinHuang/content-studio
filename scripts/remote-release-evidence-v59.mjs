/**
 * V59 — read-only release evidence from the actual GitHub PR/branch/CI APIs.
 * This is NOT deployment approval. Outside GitHub hosting hooks, private
 * databases, signed release authorization and platform publishing remain
 * independently unverified.
 */
import {readFileSync,lstatSync} from 'node:fs';
import {isAbsolute,win32,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {V54_ANCHORS} from './integration-gate-v54.mjs';

export const V59_TARGET=Object.freeze({
 repository:'CavinHuang/content-studio',
 branch:'feat/v54-consolidated-integration-gate',
 base:'main',prNumber:26,workflow:'.github/workflows/ci.yml',
 mainSha:V54_ANCHORS.mainBeforeV49
});
const SHA=/^[a-f0-9]{40}$/;
const plain=(v)=>v&&typeof v==='object'&&!Array.isArray(v);
function unique(values){return [...new Set(values)];}

export function parseV59Args(argv=[]){
 const out={};
 for(const item of argv){
  const match=/^--(sha|operator-evidence)=(.+)$/.exec(item);
  if(!match||Object.hasOwn(out,match[1]))throw Error('Expected --sha=40_HEX [--operator-evidence=ABSOLUTE_PATH]');
  out[match[1]]=match[2];
 }
 if(!SHA.test(out.sha||''))throw Error('Explicit 40-digit lowercase Git commit SHA required');
 if(out['operator-evidence']&&!isAbsolute(out['operator-evidence'])&&!win32.isAbsolute(out['operator-evidence']))
  throw Error('Operator evidence path must be absolute');
 return out;
}

/** No arbitrary endpoints or redirects: only the fixed public GitHub API. */
export async function requestGithubJson(path,{request=fetch,token=process.env.GITHUB_TOKEN}={}){
 if(typeof path!=='string'||!/^\/repos\/CavinHuang\/content-studio\/(?:pulls\/26|branches\/(?:main|feat%2Fv54-consolidated-integration-gate)|actions\/runs\?head_sha=[a-f0-9]{40}&per_page=100)$/.test(path))
  throw Error('Unexpected GitHub API path');
 let response;
 try{
  response=await request('https://api.github.com'+path,{
   method:'GET',redirect:'error',signal:AbortSignal.timeout(8000),
   headers:{'accept':'application/vnd.github+json','user-agent':'content-studio-v59-readonly',
    'x-github-api-version':'2022-11-28',...(token?{'authorization':'Bearer '+token}:{})}
  });
 }catch{throw Error('GitHub API request failed or timed out');}
 if(!response?.ok)throw Error('GitHub API did not return success (HTTP '+(Number(response?.status)||'unknown')+')');
 try {return await response.json();}
 catch{throw Error('GitHub API returned invalid JSON');}
}

export function assessGithubEvidence({pr,branch,main,runs},expectedSha){
 if(!SHA.test(expectedSha||''))throw Error('Explicit SHA required');
 const target=V59_TARGET, blockers=[];
 const add=(condition,code)=>{if(!condition)blockers.push(code);};
 add(plain(pr)&&pr.number===target.prNumber&&pr.state==='open'&&pr.draft===true&&pr.merged===false,
  'candidate_pr_not_open_draft');
 add(pr?.base?.ref===target.base && pr?.base?.repo?.full_name===target.repository,
  'candidate_pr_wrong_base');
 add(pr?.head?.ref===target.branch&&pr?.head?.repo?.full_name===target.repository&&pr?.head?.sha===expectedSha,
  'candidate_pr_head_mismatch');
 add(branch?.name===target.branch&&branch?.commit?.sha===expectedSha,'candidate_branch_head_mismatch');
 add(main?.name==='main'&&main?.commit?.sha===target.mainSha,'baseline_main_has_changed');
 add(plain(runs)&&Array.isArray(runs.workflow_runs),'workflow_result_missing');
 const all=Array.isArray(runs?.workflow_runs)?runs.workflow_runs:[];
 const checks={};
 for(const event of ['push','pull_request']){
  const matches=all.filter(r=>r&&r.event===event&&r.path===target.workflow &&
   r.head_branch===target.branch && r.head_repository?.full_name===target.repository);
  // A later run failure on the SAME checked commit must not be masked by
  // an older success. Require newest per event; never use any other SHA.
  matches.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))||
   Number(b.id||0)-Number(a.id||0));
  const latest=matches[0];
  add(!!latest,'missing_'+event+'_ci');
  add(latest?.head_sha===expectedSha,'unmatched_'+event+'_ci_sha');
  add(latest?.status==='completed'&&latest?.conclusion==='success','unverified_'+event+'_ci');
  if(event==='pull_request')
   add(Array.isArray(latest?.pull_requests)&&latest.pull_requests.some(p=>p?.number===target.prNumber),
    'pull_request_ci_not_linked_to_pr');
  checks[event]={verified:!!latest&&latest.head_sha===expectedSha&&
   latest.status==='completed'&&latest.conclusion==='success'&&
   (event==='push'||latest.pull_requests?.some(p=>p?.number===target.prNumber)===true),
   runId:Number.isSafeInteger(latest?.id)?latest.id:null};
 }
 return {kind:'content-studio-v59-github-ci-evidence',candidateCommit:expectedSha,
  githubCheckPassed:blockers.length===0,checks,blockers:unique(blockers),
  githubApiWasQueried:false, // set true only by the real network command
  externalHostingVerified:false,operatorReleaseApproved:false,
  mergeAuthorized:false,deployAuthorized:false,productionReady:false};
}

export function assessOperatorPacket(packet,expectedSha){
 const blockers=[];
 if(!plain(packet)||packet.kind!=='content-studio-v55-operator-release-evidence')
  blockers.push('operator_packet_missing_or_invalid');
 else{
  if(packet.candidateCommit!==expectedSha)blockers.push('operator_packet_candidate_sha_mismatch');
  if(packet.mainCommit!==V59_TARGET.mainSha)blockers.push('operator_packet_main_sha_mismatch');
  if(packet.packetComplete!==true||packet.localEvidenceComplete!==true||
   !Array.isArray(packet.blockers)||packet.blockers.length!==0)
   blockers.push('operator_packet_incomplete');
  if(packet.local?.originalDatabaseUnchanged!==true||packet.local?.backupContentMatchesDatabase!==true||
   packet.local?.backupManifest!=='passed'||packet.local?.restoredUpgrade!=='passed'||
   packet.local?.restoredIntegration!=='passed'||packet.manualReview?.recorded!==true)
   blockers.push('operator_packet_safety_stages_incomplete');
  if(packet.mergeAuthorized!==false||packet.deployAuthorized!==false||packet.productionReady!==false)
   blockers.push('operator_packet_claims_unsafe_authorization');
 }
 return {localOperatorEvidenceRecorded:blockers.length===0,blockers};
}

export function readOperatorPacket(path){
 const info=lstatSync(path);
 if(!info.isFile()||info.isSymbolicLink()||info.size>16384)
  throw Error('Operator evidence must be a regular JSON file no larger than 16 KiB');
 return JSON.parse(readFileSync(path,'utf8'));
}

export async function collectV59Evidence(options,{request=fetch,token=process.env.GITHUB_TOKEN,
  readPacket=readOperatorPacket}={}){
 const args=Array.isArray(options)?parseV59Args(options):options;
 if(!SHA.test(args?.sha||''))throw Error('Explicit pinned candidate SHA required');
 const owner='/repos/CavinHuang/content-studio';
 const [pr,branch,main,runs]=await Promise.all([
  requestGithubJson(owner+'/pulls/26',{request,token}),
  requestGithubJson(owner+'/branches/feat%2Fv54-consolidated-integration-gate',{request,token}),
  requestGithubJson(owner+'/branches/main',{request,token}),
  requestGithubJson(owner+'/actions/runs?head_sha='+args.sha+'&per_page=100',{request,token})
 ]);
 const github=assessGithubEvidence({pr,branch,main,runs},args.sha);
 const hasPacket=!!args['operator-evidence'];
 let packet;
 if(hasPacket){
  try{packet=assessOperatorPacket(readPacket(resolve(args['operator-evidence'])),args.sha)}
  catch{packet={localOperatorEvidenceRecorded:false,blockers:['operator_packet_unreadable']};}
 }else packet={localOperatorEvidenceRecorded:false,blockers:['operator_packet_not_supplied']};
 const blockers=unique([...github.blockers,...packet.blockers,
  // GitHub cannot see external hosting, webhooks or a genuine release sign-off.
  'external_deployment_inventory_unverified','explicit_release_approval_missing']);
 return {kind:'content-studio-v59-remote-release-evidence',schemaVersion:1,
  candidateCommit:args.sha,mainCommit:V59_TARGET.mainSha,
  githubCI:{...github,githubApiWasQueried:true},
  operatorPacket:{recorded:packet.localOperatorEvidenceRecorded,independentlyVerified:false},
  technicalEvidenceComplete:github.githubCheckPassed&&packet.localOperatorEvidenceRecorded,
  blockers,releaseAuthorized:false,mergeAuthorized:false,deployAuthorized:false,
  productionReady:false,realPublishingVerified:false,paidProviderChecked:false};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 collectV59Evidence(process.argv.slice(2)).then(report=>{
  console.log(JSON.stringify(report,null,2));
  // Not a deploy gate and never an approval: use nonzero until all *technical*
  // evidence is supplied. External/manual blockers continue to be reported.
  if(!report.technicalEvidenceComplete)process.exitCode=1;
 }).catch(()=>{
  console.error('V59 remote release evidence check failed; inspect the local release configuration');
  process.exitCode=1;
 });
}

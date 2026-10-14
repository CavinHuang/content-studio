/**
 * V55 operator-owned release evidence packet.
 *
 * Must run on a trusted operator host with an explicit DB/backup path. It
 * introspects Git ancestry and replays the existing V45-V47 backup, restore
 * and synthetic integration checks against a DISPOSABLE copy. It never
 * automatically merges, deploys or changes the source database.
 *
 * This is a sanitized report, not a certificate or proof of external hosting.
 */
import {resolve,isAbsolute,win32} from 'node:path';
import {readFileSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {releaseAdmission} from './release-admission.mjs';
import {runIntegrationGate} from './integration-gate-v54.mjs';

const HASH=/^[a-f0-9]{40}$/i;
const REVIEW_KINDS=new Set(['no-automatic-deployment','deployment-paused','controlled-manual-deploy']);
export function parseEvidenceArgs(args=[]){
 const values={};
 for(const part of args){
  const match=/^--(db|backup|review)=(.+)$/.exec(part);
  if(!match||values[match[1]])throw Error('Required: --db=ABSOLUTE_PATH --backup=ABSOLUTE_PATH');
  values[match[1]]=match[2];
 }
 const absolute=p=>isAbsolute(p)||win32.isAbsolute(p);
 if(!values.db||!values.backup||!absolute(values.db)||!absolute(values.backup)||
   (values.review&&!absolute(values.review))||
   (values.db===values.backup||resolve(values.db)===resolve(values.backup)))
  throw Error('Explicit distinct absolute local database and backup paths required');
 return values;
}
/**
 * A manual review declaration can be attached to the packet by the operator,
 * but is never accepted as machine verification of webhooks or a merge permit.
 * Do not include tokens, secret values, private database paths or names.
 */
export function assessOperatorReview(manual,revision){
 const no={
  recorded:false,consistentWithCandidate:false,findings:[],
  manualDeploymentReview:'unverified',outsideGitHubVerifiedByAutomation:false
 };
 if(!manual||typeof manual!=='object'||Array.isArray(manual))return no;
 const problems=[];
 const safeText=s=>typeof s==='string'&&s.length>=3&&s.length<=128&&
  !/[\r\n<>]/.test(s)&&!/(?:https?:\/\/|password|token|secret|\/Users\/|\/home\/|C:\\)/i.test(s);
 if(manual.schemaVersion!=='content-studio-v55-manual-review')problems.push('invalid_manual_schema');
 if(!HASH.test(manual.candidateCommit||'')||manual.candidateCommit!==revision)
  problems.push('candidate_commit_mismatch');
 if(!REVIEW_KINDS.has(manual.deploymentMode))problems.push('deployment_mode_unknown');
 if(!safeText(manual.operatorRole))problems.push('reviewer_role_missing_or_unsafe');
 if(!safeText(manual.hostingInventoryReference))problems.push('hosting_inventory_reference_missing_or_unsafe');
 if(!safeText(manual.rollbackReference))problems.push('rollback_reference_missing_or_unsafe');
 if(manual.backupLocationProtected!==true)problems.push('backup_protection_not_attested');
 if(manual.rollbackInstructionsReviewed!==true)problems.push('rollback_not_attested');
 // A supplied self-report is only a human statement. It is NOT a proof that
 // the connector inspected webhook endpoints, nor an approval to merge.
 return {
  recorded:problems.length===0,
  consistentWithCandidate:problems.length===0,
  findings:problems,manualDeploymentReview:problems.length===0?'operator_declaration_recorded':'unverified',
  outsideGitHubVerifiedByAutomation:false
 };
}
export function composeReleaseEvidence({git,local,manual}={}){
 if(!git||!local)throw Error('Missing release audit or local rehearsal report');
 const problems=[];
 if(!git.technicalHistoryValid)problems.push('candidate_git_history_unverified');
 if(git.mode!=='premerge-candidate')problems.push('not_a_premerge_candidate');
 if(!HASH.test(git.checkedHead||''))problems.push('candidate_commit_unresolved');
 if(!HASH.test(git.checkedMain||''))problems.push('main_commit_unresolved');
 if(local.database?.status!=='passed')problems.push('database_inspection_incomplete');
 if(local.backup?.status!=='passed'||local.backup?.manifestVerified!==true)
  problems.push('wal_backup_manifest_not_verified');
 if(!local.backup?.schemaSha256||!local.database?.schemaSha256||
    local.backup.schemaSha256!==local.database.schemaSha256)
  problems.push('backup_schema_mismatch');
 // A verified manifest can still reference an OLD (but intact) snapshot.
 // Require a matching row-count fingerprint in addition to schema SHA.
 if(!local.backup?.rowCountsSha256||!local.database?.rowCountsSha256||
    local.backup.rowCountsSha256!==local.database.rowCountsSha256)
  problems.push('backup_row_counts_mismatch');
 // Row count and schema alone cannot detect in-place edits to old article
 // paragraphs or image BLOBs. Compare every row's deterministic SHA as well.
 if(!local.backup?.contentSha256||!local.database?.contentSha256||
    local.backup.contentSha256!==local.database.contentSha256)
  problems.push('backup_historical_content_mismatch');
 if(local.upgrade?.status!=='passed'||local.upgrade?.historicalRowsPreserved!==true||
    local.upgrade?.sourceUntouched!==true||local.upgrade?.temporaryCopiesDeleted!==true)
  problems.push('restored_copy_upgrade_unverified');
 if(local.integration?.status!=='passed'||local.integration?.historicalRowsUnchanged!==true||
    local.integration?.syntheticOnly!==true)
  problems.push('restored_copy_channel_acceptance_unverified');
 if(local.candidateGatesPassed!==true||local.localBlockers?.length)
  problems.push('local_release_admission_blocked');
 const review=assessOperatorReview(manual,git.checkedHead);
 if(!review.recorded)problems.push('external_deployment_review_not_recorded');
 // Avoid exposing actual paths, personal articles, source snippets, model keys
 // and manual-review free text in the serialized packet.
 return {
  kind:'content-studio-v55-operator-release-evidence',schemaVersion:1,
  candidateCommit:HASH.test(git.checkedHead||'')?git.checkedHead:null,
  mainCommit:HASH.test(git.checkedMain||'')?git.checkedMain:null,
  integrationMode:git.mode,historyValid:!!git.technicalHistoryValid,
  local:{
   databaseInspection:local.database?.status||'not_checked',
   backupManifest:local.backup?.status||'not_checked',
   backupSchemaMatchesDatabase:local.backup?.schemaSha256===local.database?.schemaSha256 &&
     !!local.backup?.schemaSha256,
   backupRowCountsMatchDatabase:!!local.backup?.rowCountsSha256 &&
     local.backup.rowCountsSha256===local.database?.rowCountsSha256,
   backupContentMatchesDatabase:!!local.backup?.contentSha256 &&
     local.backup.contentSha256===local.database?.contentSha256,
   restoredUpgrade:local.upgrade?.status||'not_checked',
   historicalRowsPreserved:local.upgrade?.historicalRowsPreserved===true,
   restoredIntegration:local.integration?.status||'not_checked',
   syntheticOnly:local.integration?.syntheticOnly===true,
   originalDatabaseUnchanged:local.upgrade?.sourceUntouched===true,
   temporaryCopiesDeleted:local.upgrade?.temporaryCopiesDeleted===true
  },
  manualReview:review,
  localEvidenceComplete:problems.filter(p=>p!=='external_deployment_review_not_recorded').length===0,
  packetComplete:problems.length===0,
  blockers:[...new Set(problems)],
  // This packet is not a merge authorization or independent verification of
  // CI, hosting provider dashboards, webhook listeners or publishing.
  finalHeadCIVerifiedExternally:false,
  hostingWebhookInventoryVerifiedByAutomation:false,
  operatorMergeApproval:'not_obtained',
  mergeAuthorized:false,deployAuthorized:false,productionReady:false,
  realPublishingVerified:false,paidProviderChecked:false
 };
}
export function readOperatorReview(path){
 const stat=lstatSync(path);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)
  throw Error('Manual review must be a regular local JSON file smaller than 4 KiB');
 const value=JSON.parse(readFileSync(path,'utf8'));
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid operator review format');
 return value;
}
export async function collectReleaseEvidence(args,{
  gitAudit=runIntegrationGate,admission=releaseAdmission,manualReview=null
}={}){
 const opts=Array.isArray(args)?parseEvidenceArgs(args):args;
 if(!opts?.db||!opts?.backup)throw Error('Explicit DB and backup paths are required');
 const git=gitAudit();
 // Never open a private DB if the Git candidate is already invalid.
 if(!git.technicalHistoryValid||git.mode!=='premerge-candidate')
  return composeReleaseEvidence({git,local:{database:{status:'not_checked'}}});
 const review=manualReview||(opts.review?readOperatorReview(opts.review):null);
 if(!assessOperatorReview(review,git.checkedHead).recorded)
  return composeReleaseEvidence({git,local:{database:{status:'not_checked'}},manual:review});
 // Only a reviewed, SHA-matched candidate can trigger an expensive private
 // database backup rehearsal. Actual platform/merge approval stays separate.
 const local=await admission(['--db='+opts.db,'--backup='+opts.backup,'--rehearse','--integration']);
 return composeReleaseEvidence({git,local,manual:review});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 collectReleaseEvidence(process.argv.slice(2)).then(result=>{
  console.log(JSON.stringify(result,null,2));
  if(!result.packetComplete)process.exitCode=1;
 }).catch(()=>{
  // Never echo input path, email, tokens, temporary DB data or model settings.
  console.error('V55 local evidence collection could not complete; inspect trusted operator configuration');
  process.exitCode=1;
 });
}

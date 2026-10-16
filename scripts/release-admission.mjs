/** V46 local-only operator admission report.
 * Does not access publishing platforms, send prompts or execute paid models.
 * Production readiness stays false until separate real-world acceptance.
 */
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectDatabase,verifyBackup,rehearseUpgrade} from './db-safety.mjs';
import {providerContractPreflight} from '../src/image-providers.mjs';
import {createCore} from '../lib/core.mjs';
import {integrationRehearsal} from './integration-rehearsal.mjs';

const manualStages=[
 ['provider_live_smoke','Explicitly consent to one paid request per provider, inspect actual output and provider billing dashboard'],
 ['doocs_roundtrip','Test real external doocs/md editor export and imported Markdown against an authored article'],
 ['wechat_real_paste','Inspect real WeChat desktop paste, image URL loading and mobile preview'],
 ['zhihu_real_paste','Inspect real Zhihu image paste, copy and mobile preview'],
 ['recovery_operator','Confirm encrypted off-device backup and independently verified recovery on the target host'],
 ['actual_release','Obtain explicit operator authorization before any merge/deploy/publication']
];
export function parseAdmissionArgs(args=[]){
 const out={rehearse:false,integration:false};
 for(const arg of args){
  if(arg==='--rehearse'){if(out.rehearse)throw Error('Duplicate --rehearse');out.rehearse=true;continue}
  if(arg==='--integration'){if(out.integration)throw Error('Duplicate --integration');out.integration=true;continue}
  const match=arg.match(/^--(db|backup)=(.+)$/);
  if(!match||out[match[1]])throw Error('Use --db=PATH [--backup=PATH] [--rehearse] [--integration]');
  out[match[1]]=match[2];
 }
 return out;
}
export async function releaseAdmission(args,{inspect=inspectDatabase,verify=verifyBackup,rehearsal=rehearseUpgrade,integration=integrationRehearsal,providers=providerContractPreflight,openWithCore=createCore}={}){
 const opts=Array.isArray(args)?parseAdmissionArgs(args):args;
 const local=[],warnings=[];
 const dbPath=resolve(opts.db||process.env.CONTENT_STUDIO_DB_PATH||join(process.cwd(),'data','content-studio.sqlite'));
 let database=null,archive=null,upgrade=null,integrated=null;
 try{
  const data=await inspect(dbPath,{includeContentDigest:true});
  database={status:data.integrity==='ok'?'passed':'blocked',tables:data.tableCount,rows:data.rowCount,
   schemaSha256:data.schemaSha256,rowCountsSha256:data.rowCountsSha256,contentSha256:data.contentSha256,readOnly:true,missingCoreTables:data.missingCoreTables};
  if(database.status!=='passed'||database.missingCoreTables?.length)local.push('database_integrity_or_schema');
 }catch{local.push('database_missing_or_inaccessible');database={status:'blocked'}}
 if(opts.backup){
  try{
   const data=await verify(resolve(opts.backup),{includeContentDigest:true});
   archive={status:data.backupValid&&data.manifestVerified?'passed':'blocked',sha256:data.sha256,
    schemaSha256:data.schemaSha256,rowCountsSha256:data.rowCountsSha256,contentSha256:data.contentSha256,rows:data.rowCount,manifestVerified:data.manifestVerified};
   if(archive.status!=='passed')local.push('backup_invalid');
   if(database?.status==='passed'&&archive.schemaSha256!==database.schemaSha256)
    warnings.push('backup_schema_differs_from_current_db');
  }catch{local.push('backup_missing_or_corrupt');archive={status:'blocked'}}
 }else{local.push('backup_not_supplied');archive={status:'not_checked'}}
 if(opts.rehearse){
  if(database?.status!=='passed')local.push('cannot_rehearse_without_valid_db');
  else try{
   const data=await rehearsal(dbPath,{openWithCore});
   upgrade={status:data.upgradeOpenedSuccessfully&&data.verified?'passed':'blocked',
    historicalRowsPreserved:!!data.verified,sourceUntouched:data.sourceUntouched,
    temporaryCopiesDeleted:data.temporaryCopiesDeleted,newTables:data.newTables||[]};
   if(upgrade.status!=='passed')local.push('upgrade_rehearsal_failed');
  }catch{local.push('upgrade_rehearsal_failed');upgrade={status:'blocked'}}
 }else{local.push('upgrade_rehearsal_not_requested');upgrade={status:'not_checked'}}
 if(opts.integration){
  if(database?.status!=='passed')local.push('cannot_integrate_without_valid_db');
  else try{
   const evidence=await integration(dbPath);
   integrated={status:evidence.existingRowsUnchanged&&evidence.sourceUntouched&&evidence.syntheticOnly?'passed':'blocked',
    historicProjectsInspected:evidence.historicProjectsInspected,historicRowsProtected:evidence.historicRowsProtected,
    historicalRowsUnchanged:evidence.existingRowsUnchanged,syntheticOnly:evidence.syntheticOnly,
    simulatedChannels:evidence.synthetic?.textOnly?.channels+evidence.synthetic?.illustrated?.channels,
    paidModelRequests:0,platformVerified:false};
   if(integrated.status!=='passed')local.push('integration_rehearsal_failed');
  }catch{local.push('integration_rehearsal_failed');integrated={status:'blocked'}}
 }else integrated={status:'not_checked'};
 const contracts=providers().map(p=>({provider:p.id,model:p.model,locallyConfigured:!!p.configured,
  problems:p.problems,liveApiChecked:false,chargeChecked:false}));
 // No user/account content or API key values are included in this report.
 return {kind:'content-studio-v47-release-admission',scope:'read-only-local-and-disposable-upgrade-copy',
  database,backup:archive,upgrade,integration:integrated,providerContracts:contracts,localBlockers:[...new Set(local)],
  warnings,manualAcceptance:manualStages.map(([id,description])=>({id,status:'unverified',description})),
  localGatesPassed:local.length===0,candidateGatesPassed:local.length===0&&integrated.status==='passed',productionReady:false,deployAuthorized:false,
  platformVerified:false,paidModelRequests:0,
  message:'Passing local checks cannot certify billing, external editors, platform publishing, data ownership or deployment authority.'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 releaseAdmission(process.argv.slice(2)).then(result=>{
  console.log(JSON.stringify(result,null,2));
  if(!result.localGatesPassed)process.exitCode=1;
 }).catch(()=>{console.error('Release admission failed; check local path arguments and filesystem access');process.exitCode=1});
}

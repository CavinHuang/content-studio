/**
 * V60 — Offline SQLite rollback rehearsal. Scratch copies may contain sensitive
 * plaintext. Never mutate original database/backup, merge or deploy.
 */
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,realpath,lstat,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve,isAbsolute,win32,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectDatabase,verifyBackup,restoreBackup} from './db-safety.mjs';
import {createCore} from '../lib/core.mjs';
import {readOperatorPacket,assessOperatorPacket} from './remote-release-evidence-v59.mjs';

const SHA=/^[a-f0-9]{40}$/;
const notAuthorized=()=>({releaseAuthorized:false,mergeAuthorized:false,deployAuthorized:false,productionReady:false});
const absolute=p=>isAbsolute(p)||win32.isAbsolute(p);
const same=(a,b)=>!!a?.schemaSha256&&a.schemaSha256===b?.schemaSha256&&
  a.rowCountsSha256===b?.rowCountsSha256&&a.contentSha256===b?.contentSha256&&
  a.integrity==='ok'&&b?.integrity==='ok';

export function parseRollbackArgs(args=[]){
 const found={};
 for(const arg of args){
  const m=/^--(sha|db|backup|scratch-dir|operator-evidence)=(.+)$/.exec(arg);
  if(!m||Object.hasOwn(found,m[1]))throw Error('Expected pinned SHA and explicit source, backup, scratch and evidence paths');
  found[m[1]]=m[2];
 }
 if(!SHA.test(found.sha||'')||!['db','backup','scratch-dir','operator-evidence'].every(k=>found[k]&&absolute(found[k])))
  throw Error('Pinned 40-digit lowercase SHA and four absolute paths are required');
 const paths=['db','backup','scratch-dir','operator-evidence'].map(k=>resolve(found[k]));
 if(new Set(paths).size!==paths.length)throw Error('Drill source and destinations must be distinct');
 return {sha:found.sha,db:paths[0],backup:paths[1],scratch:paths[2],evidence:paths[3]};
}
async function regular(path){
 const stat=await lstat(path);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('The drill requires regular local files');
 return realpath(path);
}
async function privateScratch(path){
 const stat=await lstat(path);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Scratch must be a real directory');
 // Windows ACL permissions still require review by the host operator.
 if(process.platform!=='win32'&&(stat.mode&0o077)!==0)
  throw Error('Scratch must not be accessible to group or other users');
 await access(path,constants.R_OK|constants.W_OK|constants.X_OK);
 return realpath(path);
}
const underneath=(child,parent)=>child===parent||child.startsWith(parent+sep);
export async function validateRollbackInputs(opts,{readPacket=readOperatorPacket}={}){
 if(!SHA.test(opts?.sha||''))throw Error('Explicit candidate SHA required');
 if(!['db','backup','scratch','evidence'].every(k=>opts[k]&&absolute(opts[k])))
  throw Error('Explicit absolute local paths required');
 const src=await regular(opts.db),archive=await regular(opts.backup),
  evidence=await regular(opts.evidence),scratch=await privateScratch(opts.scratch);
 if(new Set([src,archive,evidence,scratch]).size!==4)
  throw Error('Drill source and destinations must be distinct');
 if(underneath(scratch,src)||underneath(scratch,archive)||underneath(scratch,evidence))
  throw Error('Unsafe scratch location');
 if(!assessOperatorPacket(readPacket(evidence),opts.sha).localOperatorEvidenceRecorded)
  throw Error('V55 operator evidence is not complete for this exact SHA');
 return {src,archive,scratch};
}
function injectDisposableFault(dbPath){
 const db=new DatabaseSync(dbPath);
 try{
  db.exec('CREATE TABLE v60_disposable_fault_probe (id TEXT PRIMARY KEY, details TEXT NOT NULL)');
  db.prepare('INSERT INTO v60_disposable_fault_probe VALUES(?,?)').run('v60','synthetic-fault-only');
 }finally{db.close()}
}
export async function runRollbackDrill(input,{
 validate=validateRollbackInputs,inspect=inspectDatabase,verify=verifyBackup,
 restore=restoreBackup,openCore=createCore,applyFault=injectDisposableFault
}={}){
 const opts=Array.isArray(input)?parseRollbackArgs(input):input;
 // Deny invalid packet or path before opening the original DB.
 const {src,archive,scratch}=await validate(opts);
 const before=await inspect(src,{includeContentDigest:true});
 const backed=await verify(archive,{includeContentDigest:true});
 if(before.missingCoreTables?.length||backed.missingCoreTables?.length||
    !backed.manifestVerified||!backed.backupValid||!same(before,backed))
  throw Error('Source and verified backup are not identical or core schema is missing');
 let work=null,success=null;
 try{
  work=await mkdtemp(join(scratch,'.content-studio-v60-'));
  const simulated=join(work,'upgrade-simulated.sqlite'),recovered=join(work,'rollback-restored.sqlite');
  await restore(archive,simulated);
  if(!same(await inspect(simulated,{includeContentDigest:true}),before))
   throw Error('Staging copy differs from source');
  const core=openCore(simulated);
  try{if(!core?.store?.db)throw Error('Application cannot open staging copy')}
  finally{core?.close?.()}
  applyFault(simulated);
  if(same(await inspect(simulated,{includeContentDigest:true}),before))
   throw Error('Fault injection did not change staging');
  await restore(archive,recovered);
  if(!same(await inspect(recovered,{includeContentDigest:true}),before))
   throw Error('Rollback copy does not match original backup');
  const rollbackCore=openCore(recovered);
  try{if(!rollbackCore?.store?.db)throw Error('Application cannot open rollback copy')}
  finally{rollbackCore?.close?.()}
  const opened=await inspect(recovered,{includeContentDigest:true});
  if(opened.integrity!=='ok'||opened.missingCoreTables?.length)
   throw Error('Rollback copy failed application initialization check');
  const after=await inspect(src,{includeContentDigest:true});
  const backupAfter=await verify(archive,{includeContentDigest:true});
  if(!same(before,after)||!same(backed,backupAfter)||backed.sha256!==backupAfter.sha256)
   throw Error('Original database or backup changed during rehearsal');
  success={kind:'content-studio-v60-rollback-drill',schemaVersion:1,
   candidateCommit:opts.sha,status:'passed',restoredToNewFile:true,
   deliberateFaultChangedDisposableCopy:true,sourceUnchanged:true,
   verifiedBackupUnchanged:true,rollbackRestoredHistoricalRows:true,
   rollbackApplicationOpened:true,plaintextScratchCopiesCreated:true,
   cleanupIsNotSecureErase:true,operatorHostCheckedByCI:false,
   realHostingVerified:false,...notAuthorized()};
 }finally{
  if(work)await rm(work,{recursive:true,force:true});
 }
 // Only report cleanup after the deletion operation succeeds.
 return {...success,scratchCopiesRemoved:true};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 runRollbackDrill(process.argv.slice(2)).then(report=>console.log(JSON.stringify(report,null,2))).catch(()=>{
  // No paths, user data or environment values in CLI errors.
  console.error('V60 rollback rehearsal blocked; review protected host inputs and scratch storage');
  process.exitCode=1;
 });
}

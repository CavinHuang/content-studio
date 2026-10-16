/**
 * V62: create an exclusively new WAL-safe operator backup, verify freshness
 * against a stable source snapshot and feed it to the V61 acceptance chain.
 * Never overwrite existing DB/archive, authorize deployment or publish.
 */
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {access,lstat,realpath,stat,unlink} from 'node:fs/promises';
import {basename,resolve,isAbsolute,win32,sep,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBackup,verifyBackup,inspectDatabase} from './db-safety.mjs';
import {assessOperatorReview,readOperatorReview} from './operator-release-evidence-v55.mjs';
import {collectV59Evidence} from './remote-release-evidence-v59.mjs';
import {requireLocalHead,checkRemoteSnapshot,runOperatorAcceptance} from './operator-acceptance-v61.mjs';

const SHA=/^[a-f0-9]{40}$/;
const absolute=p=>isAbsolute(p)||win32.isAbsolute(p);
const nested=(path,root)=>path===root||path.startsWith(root+sep);
export function parsePrepareArgs(argv=[]){
 const raw={};
 for(const arg of argv){
  const match=/^--(sha|db|backup-dir|review|scratch-dir)=(.+)$/.exec(arg);
  if(!match||Object.hasOwn(raw,match[1]))throw Error('Unexpected or duplicated operator argument');
  raw[match[1]]=match[2];
 }
 if(!SHA.test(raw.sha||'')||!['db','backup-dir','review','scratch-dir'].every(k=>raw[k]&&absolute(raw[k])))
  throw Error('Explicit pinned SHA and four absolute local paths are required');
 const paths=['db','backup-dir','review','scratch-dir'].map(k=>resolve(raw[k]));
 if(new Set(paths).size!==paths.length)throw Error('All operator paths must be distinct');
 return {sha:raw.sha,db:paths[0],backupDir:paths[1],review:paths[2],scratch:paths[3]};
}
async function file(path){
 const info=await lstat(path);
 if(!info.isFile()||info.isSymbolicLink())throw Error('Operator source must be a regular file');
 return realpath(path);
}
async function privateDir(path){
 const info=await lstat(path);
 if(!info.isDirectory()||info.isSymbolicLink())throw Error('Operator storage must be a real directory');
 if(process.platform!=='win32'&&(info.mode&0o077)!==0)throw Error('Operator storage is not private');
 await access(path,constants.R_OK|constants.W_OK|constants.X_OK);
 return realpath(path);
}
export async function validatePreparePaths(opts){
 const [db,review,backupDir,scratch]=await Promise.all([
  file(opts.db),file(opts.review),privateDir(opts.backupDir),privateDir(opts.scratch)]);
 if(db===review||backupDir===scratch||nested(backupDir,scratch)||nested(scratch,backupDir)||
    nested(db,backupDir)||nested(db,scratch)||nested(review,backupDir)||nested(review,scratch))
  throw Error('Unsafe or overlapping operator paths');
 return {db,review,backupDir,scratch};
}
const MATCH_KEYS=['schemaSha256','rowCountsSha256','contentSha256'];
export function snapshotUnchanged(before,after){
 return before?.integrity==='ok'&&after?.integrity==='ok'&&
  before?.missingCoreTables?.length===0&&after?.missingCoreTables?.length===0&&
  MATCH_KEYS.every(k=>typeof before[k]==='string'&&before[k].length===64&&before[k]===after[k]);
}
export async function createVerifiedOperatorSnapshot({db,backupDir,sha},{
 inspect=inspectDatabase,backup=createBackup,verify=verifyBackup,
 nonce=()=>randomUUID().replaceAll('-','').slice(0,16),remove=unlink
}={}){
 if(!SHA.test(sha||''))throw Error('Pinned SHA required');
 // Every run uses a fresh filename. Existing backup files are NEVER replaced.
 const suffix=nonce();
 if(!/^[a-f0-9]{16}$/.test(suffix))throw Error('Invalid snapshot nonce');
 const name='content-studio-pre-release-'+sha.slice(0,12)+'-'+suffix+'.sqlite';
 const output=join(backupDir,name);
 const first=await inspect(db,{includeContentDigest:true});
 if(first.integrity!=='ok'||first.missingCoreTables?.length)
  throw Error('Original database failed the read-only preflight');
 let created=false;
 try{
  await backup(db,{outputPath:output});
  created=true;
  const verified=await verify(output,{includeContentDigest:true});
  const last=await inspect(db,{includeContentDigest:true});
  if(verified.manifestVerified!==true||verified.backupValid!==true||
   !snapshotUnchanged(first,verified)||!snapshotUnchanged(first,last))
   throw Error('WAL snapshot stale or source changed while creating backup');
  return {backupPath:output,backupFilename:name,
   sourceStableAcrossBackup:true,manifestAndFullContentVerified:true};
 }catch{
  // Never delete any preexisting file; cleanup only after *our* createBackup
  // returned successfully. Do not leave a stale archive eligible for review.
  if(created){
   await remove(output+'.manifest.json').catch(()=>{});
   await remove(output).catch(()=>{});
   // Read-only SQLite verification may have materialized WAL/SHM sidecars.
   await remove(output+'-wal').catch(()=>{});
   await remove(output+'-shm').catch(()=>{});
  }
  throw Error('Cannot prepare a stable verified WAL backup');
 }
}
export async function runPreparedAcceptance(input,{
 assertHead=requireLocalHead,remote=collectV59Evidence,
 paths=validatePreparePaths,readReview=readOperatorReview,
 prepare=createVerifiedOperatorSnapshot,accept=runOperatorAcceptance
}={}){
 const opts=Array.isArray(input)?parsePrepareArgs(input):input;
 if(!SHA.test(opts?.sha||''))throw Error('Pinned candidate SHA required');
 assertHead(opts.sha);
 // Remote verification before reading any private database content.
 checkRemoteSnapshot(await remote({sha:opts.sha}),opts.sha);
 const resolved=await paths(opts);
 if(!assessOperatorReview(readReview(resolved.review),opts.sha).recorded)
  throw Error('Reviewed host declaration missing or mismatched');
 assertHead(opts.sha);
 const prepared=await prepare({db:resolved.db,backupDir:resolved.backupDir,sha:opts.sha});
 assertHead(opts.sha);
 // V61 re-verifies the current PR/CI and the fresh archive against the
 // untouched source; all its private scratch copies are disposable.
 const technical=await accept({sha:opts.sha,db:resolved.db,
  backup:prepared.backupPath,review:resolved.review,scratch:resolved.scratch});
 if(technical?.candidateCommit!==opts.sha||technical.reviewReady!==true||
  technical.technicalEvidenceComplete!==true||technical.mergeAuthorized!==false||
  technical.deployAuthorized!==false||technical.productionReady!==false)
  throw Error('Operator technical acceptance was not completed');
 assertHead(opts.sha);
 return {kind:'content-studio-v62-prepared-operator-acceptance',schemaVersion:1,
  candidateCommit:opts.sha,backupFilename:prepared.backupFilename,
  newWalBackupCreated:true,backupManifestAndHistoryVerified:prepared.manifestAndFullContentVerified===true,
  sourceStableAcrossBackup:prepared.sourceStableAcrossBackup===true,
  v61TechnicalAcceptancePassed:true,reviewReady:true,
  backupRetainedForOperator:true,externalHostingIndependentlyVerified:false,
  encryptionVerifiedBySoftware:false,
  operatorAuthorizationVerified:false,
  privateHostCheckedByCI:false,mergeAuthorized:false,deployAuthorized:false,
  releaseAuthorized:false,productionReady:false,realPublishingVerified:false,
  note:'Technical evidence only; real operator review and external hosting authorization remain separate.'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 runPreparedAcceptance(process.argv.slice(2)).then(result=>{
  console.log(JSON.stringify(result,null,2));
 }).catch(()=>{
  // Sanitized errors do not leak DB paths, article text or GitHub credentials.
  console.error('V62 protected backup preparation/technical acceptance blocked; inspect operator settings');
  process.exitCode=1;
 });
}

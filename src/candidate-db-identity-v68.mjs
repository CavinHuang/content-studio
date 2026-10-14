/**
 * V68: verify that the already-running candidate Next process uses a distinct
 * SQLite file, not the operator's source database (including hardlinks).
 * The HTTP endpoint exposes a nonce-scoped opaque file identity, never a
 * database path, SQLite rows, inode or device number.
 * The nonce is public and this is a local consistency proof, NOT attestation.
 */
import {createHmac} from 'node:crypto';
import {lstatSync,realpathSync,statSync} from 'node:fs';
import {resolve,isAbsolute,win32,sep} from 'node:path';

const NONCE=/^[a-f0-9]{32}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const within=(p,dir)=>p===dir||p.startsWith(dir+sep);
const absolute=p=>typeof p==='string'&&(isAbsolute(p)||win32.isAbsolute(p));
function identity(file){
 if(!absolute(file))throw Error('Candidate DB path must be absolute');
 const stat=lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('Candidate DB must be a regular file');
 const canonical=realpathSync(file);
 const obj=statSync(canonical,{bigint:true});
 if(!obj.isFile()||obj.ino<=0n)throw Error('Database file identity unavailable');
 return {canonical,device:String(obj.dev),inode:String(obj.ino)};
}
export function fileIdentityDigest(file,runNonce){
 if(!NONCE.test(runNonce||''))throw Error('A process run nonce is required');
 const meta=identity(file);
 return createHmac('sha256',Buffer.from(runNonce,'hex'))
  .update('content-studio-v68-db:'+meta.device+':'+meta.inode)
  .digest('hex');
}
/**
 * This gets the filename from the SQLite connection actually used by the API.
 * Reading PRAGMA database_list is metadata-only and does not retrieve content.
 */
export function activeDatabaseIdentity(core,runNonce){
 if(!NONCE.test(runNonce||''))return null;
 try{
  const rows=core?.store?.db?.prepare('PRAGMA database_list').all();
  const main=rows?.find(x=>x.name==='main');
  if(!main?.file||!absolute(main.file))return null;
  return fileIdentityDigest(main.file,runNonce);
 }catch{return null}
}
export function checkCandidateFileSeparation({sourceDb,candidateDb,backupDir,scratchDir}){
 if(!absolute(sourceDb)||!absolute(candidateDb)||
  !absolute(backupDir)||!absolute(scratchDir))
  throw Error('Explicit absolute source and candidate SQLite paths required');
 const source=identity(sourceDb),candidate=identity(candidateDb);
 const backup=realpathSync(backupDir),scratch=realpathSync(scratchDir);
 if(source.canonical===candidate.canonical||
  source.device===candidate.device&&source.inode===candidate.inode||
  within(candidate.canonical,backup)||within(candidate.canonical,scratch)||
  within(source.canonical,backup)||within(source.canonical,scratch))
  throw Error('Candidate SQLite aliases the source or protected recovery storage');
 return {candidateSeparatedFromSource:true,privatePathsIncluded:false};
}
export function verifyCandidateIsolation({
 sourceDb,candidateDb,observedIdentity,runNonce,backupDir,scratchDir
}){
 if(!NONCE.test(runNonce||'')||!DIGEST.test(observedIdentity||''))
  throw Error('Candidate SQLite file identity arguments invalid');
 checkCandidateFileSeparation({sourceDb,candidateDb,backupDir,scratchDir});
 const expected=fileIdentityDigest(candidateDb,runNonce);
 if(observedIdentity!==expected||observedIdentity===fileIdentityDigest(sourceDb,runNonce))
  throw Error('Running candidate does not use the independently selected SQLite file');
 return {candidateIsolated:true,connectedCandidateIdentityMatched:true,
  sourceDatabaseDistinct:true,privatePathsIncluded:false,
  independentProcessAttestation:false,productionReady:false};
}

/** V69: unprivileged POSIX candidate process must be unable to read operator's source SQLite. */
import {createHmac} from 'node:crypto';
import {constants,openSync,closeSync,lstatSync,statSync} from 'node:fs';
import {resolve,isAbsolute,win32} from 'node:path';
const NONCE=/^[a-f0-9]{32}$/;
const absolute=x=>typeof x==='string'&&(isAbsolute(x)||win32.isAbsolute(x));
const privateMode=stat=>(stat.mode&0o077)===0;
export const sourceTag=(path,nonce)=>{
 if(!absolute(path)||!NONCE.test(nonce||''))throw Error('Absolute source and run nonce required');
 return createHmac('sha256',Buffer.from(nonce,'hex'))
  .update('content-studio-v69-source:').update(resolve(path)).digest('hex');
};
function denied(path,{open=openSync,close=closeSync}={}){
 let fd;
 try{
  fd=open(path,constants.O_RDONLY|constants.O_NONBLOCK);
  // Opening the source successfully fails the guard, without reading bytes.
  return false;
 }catch(error){
  if(error?.code==='EACCES'||error?.code==='EPERM')return true;
  if(error?.code==='ENOENT')throw error;
  throw Error('Source database path could not be safely checked');
 }finally{if(fd!==undefined)close(fd)}
}
export function auditCandidateOsBoundary({
 sourceDb,candidateDb,uid=process.getuid?.(),read=denied,stat=lstatSync
}={}){
 if(process.platform==='win32'||!Number.isSafeInteger(uid)||uid<=0)
  throw Error('Dedicated non-root POSIX process identity required');
 if(!absolute(sourceDb)||!absolute(candidateDb)||resolve(sourceDb)===resolve(candidateDb))
  throw Error('Distinct absolute SQLite paths required');
 const candidate=stat(candidateDb);
 if(!candidate.isFile()||candidate.isSymbolicLink()||
  !privateMode(candidate)||candidate.uid!==uid)
  throw Error('Candidate SQLite must be a private file owned by the process');
 let fd;
 try{fd=openSync(candidateDb,constants.O_RDWR)}
 catch{throw Error('Candidate SQLite file not writable by this process')}
 finally{if(fd!==undefined)closeSync(fd)}
 for(const file of [sourceDb,sourceDb+'-wal',sourceDb+'-shm']){
  let safe;
  try{safe=read(file)}
  catch(error){
   if(file!==sourceDb&&error?.code==='ENOENT')safe=true;
   else throw Error('Source SQLite access boundary could not be confirmed');
  }
  if(safe!==true)throw Error('Candidate process can access operator source SQLite');
 }
 return {kind:'content-studio-v69-candidate-os-boundary',
  processUid:uid,nonRoot:true,sourceAccessDenied:true,
  candidateFileOwnedByProcess:true,privateCandidateFile:true,
  protectedWalSidecarsChecked:true,checkedAtLauncher:true,
  independentSandboxAttestation:false,productionReady:false};
}
export function attestCandidateOsBoundary(audit,{sourceDb,runNonce}){
 if(audit?.kind!=='content-studio-v69-candidate-os-boundary'||
  audit.nonRoot!==true||audit.sourceAccessDenied!==true||
  audit.candidateFileOwnedByProcess!==true||audit.privateCandidateFile!==true||
  audit.protectedWalSidecarsChecked!==true||audit.checkedAtLauncher!==true||
  !Number.isSafeInteger(audit.processUid)||audit.processUid<=0)
  throw Error('Candidate OS boundary audit incomplete');
 return {sourcePathTag:sourceTag(sourceDb,runNonce),
  processUid:audit.processUid,sourceAccessDenied:true,
  candidateFileOwnedByProcess:true,
  protectedWalSidecarsChecked:true,verifiedAtLauncher:true};
}
export function verifyOperatorOsBoundary({sourceDb,observed,runNonce,stat=statSync}){
 if(!absolute(sourceDb)||!NONCE.test(runNonce||'')||
  !observed||typeof observed!=='object'||
  observed.sourcePathTag!==sourceTag(sourceDb,runNonce)||
  observed.sourceAccessDenied!==true||
  observed.candidateFileOwnedByProcess!==true||
  observed.protectedWalSidecarsChecked!==true||
  observed.verifiedAtLauncher!==true||
  !Number.isSafeInteger(observed.processUid)||observed.processUid<=0)
  throw Error('Running candidate did not prove source access denial');
 const owner=stat(sourceDb);
 if(!owner.isFile()||owner.uid===observed.processUid||!privateMode(owner))
  throw Error('Operator source database POSIX isolation is insufficient');
 return {candidateOsBoundaryVerified:true,
  differentProcessUidFromSourceOwner:true,
  sourceOwnerOnlyFileMode:true,privatePathsIncluded:false,
  externalHostIndependentlyVerified:false,productionReady:false};
}

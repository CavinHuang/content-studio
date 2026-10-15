/**
 * V74 local Docker operator-only SQLite WAL-safe backups & restores.
 * Never runs on the public HTTP surface. Backup reads the original under an
 * isolated (network=none) maintenance container. Restore only into a fresh
 * dedicated volume, never into /app/data, with strict basename allowlists.
 */
import {createHash,randomBytes} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,readFile,readdir,realpath,stat,unlink} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBackup,verifyBackup,restoreBackup,inspectDatabase} from './db-safety.mjs';

export const DATA='/app/data',BACKUPS='/app/backups',RESTORE='/app/restore';
export const LIVE=DATA+'/content-studio.sqlite',RESTORED=RESTORE+'/content-studio.sqlite';
const ARCHIVE=/^content-studio-v74-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-([a-f0-9]{16})\.sqlite$/;
const denied=(reason)=>{throw Error(reason)};
const safe={mergeAuthorized:false,deployAuthorized:false,releaseAuthorized:false,productionReady:false};
const isUnder=(path,folder)=>path===folder||path.startsWith(folder+'/');
export function parseCommand(argv=[]){
 const [op,...tail]=argv;
 if(!['backup','list','prune','restore'].includes(op))denied('Unsupported maintenance operation');
 const options={operation:op};
 for(const arg of tail){
  const m=/^--(backup|keep|apply)=(.+)$/.exec(arg);
  if(!m||Object.hasOwn(options,m[1]))denied('Unexpected or duplicate argument');
  options[m[1]]=m[2];
 }
 const expected={backup:[],list:[],prune:['keep','apply'],restore:['backup']};
 if(Object.keys(options).sort().join(',')!==['operation',...expected[op]].sort().join(','))
  denied('Explicit arguments required');
 if(op==='restore'&&!ARCHIVE.test(options.backup||''))
  denied('Restore requires a recognized V74 backup basename');
 if(op==='prune'&&(!/^[0-9]+$/.test(options.keep||'')||
   !Number.isSafeInteger(Number(options.keep))||Number(options.keep)<2||
   !['yes','no'].includes(options.apply)))
  denied('Prune requires --keep=N >=2 and --apply=yes|no');
 return options;
}
export function mountedAt(folder,mountinfo){
 const root=resolve(folder);
 return typeof mountinfo==='string'&&mountinfo.split('\n').some(line=>{
  const before=line.split(' - ')[0]?.trim().split(/\s+/);
  // Linux mountinfo fifth field is the mount point; must be a distinct
  // exact mount rather than a path inside the image's root mount.
  return before?.[4]===root;
 });
}
export async function verifyMaintenanceMount(folder,{read=readFile,inspect=lstat}={}){
 const s=await inspect(folder);
 if(!s.isDirectory()||s.isSymbolicLink()||
  (process.platform!=='win32'&&((s.mode&0o077)!==0||s.uid!==process.getuid?.())))
  denied('Maintenance directory must be owner-only and non-symlink');
 let info;
 try{info=await read('/proc/self/mountinfo','utf8')}
 catch{denied('Linux mount evidence missing')}
 if(!mountedAt(folder,info))denied('Maintenance directory must be an independent Docker mount');
 return true;
}
async function regular(filename){
 const state=await lstat(filename);
 if(!state.isFile()||state.isSymbolicLink()||state.nlink!==1||
  (process.platform!=='win32'&&((state.mode&0o077)!==0||state.uid!==process.getuid?.())))
  denied('Unsafe archive file mode, owner or hardlink');
 return state;
}
export async function inventory(dir=BACKUPS,{readDir=readdir,file=regular,verify=verifyBackup}={}){
 const names=await readDir(dir);
 // Must fail closed rather than silently ignore unknown files. Partially
 // written archives, symlinks or arbitrary content prevent automatic prune.
 const archives=names.filter(name=>ARCHIVE.test(name));
 if(names.length!==archives.length*2)denied('Unknown or incomplete files in backup vault');
 const known=new Set(archives.flatMap(name=>[name,name+'.manifest.json']));
 if(names.some(name=>!known.has(name)))denied('Backup vault contains foreign files');
 const entries=[];
 for(const name of archives.sort()){
  const path=join(dir,name);
  await file(path);await file(path+'.manifest.json');
  const report=await verify(path);
  if(report.backupValid!==true||report.manifestVerified!==true)
   denied('Backup verification was incomplete');
  entries.push({name,sha256:report.sha256,rows:report.rowCount});
 }
 return entries;
}
export function decidePrune(entries,keep){
 if(!Number.isSafeInteger(keep)||keep<2||!Array.isArray(entries))
  denied('Prune retention count invalid');
 const sorted=[...entries].sort((a,b)=>a.name.localeCompare(b.name));
 if(sorted.some(x=>!ARCHIVE.test(x.name||''))||
  new Set(sorted.map(x=>x.name)).size!==sorted.length)
  denied('Backup inventory invalid');
 return {keep:Math.min(keep,sorted.length),
  retain:sorted.slice(-keep).map(x=>x.name),
  remove:sorted.slice(0,Math.max(0,sorted.length-keep)).map(x=>x.name)};
}
export async function execute(input,{
 source=LIVE,dir=BACKUPS,restoreDir=RESTORE,
 mount=verifyMaintenanceMount,inspect=inspectDatabase,
 backup=createBackup,verify=verifyBackup,restore=restoreBackup,
 scan=inventory,remove=unlink,nonce=()=>randomBytes(8).toString('hex'),
 now=()=>new Date()
}={}){
 const opts=Array.isArray(input)?parseCommand(input):input;
 if(process.platform!=='linux'||!Number.isInteger(process.getuid?.())||process.getuid()===0)
  denied('V74 maintenance requires an unprivileged Linux container');
 if(opts.operation==='backup'){
  await mount(DATA);await mount(dir);
  await regular(source);
  const name='content-studio-v74-'+now().toISOString().slice(0,19).replaceAll(':','-')+
   '-'+nonce()+'.sqlite';
  if(!ARCHIVE.test(name))denied('Cannot derive safe backup basename');
  const out=join(dir,name);
  const result=await backup(source,{outputPath:out});
  const verified=await verify(out);
  if(result.walSafe!==true||result.verified!==true||
   verified.backupValid!==true||verified.manifestVerified!==true)
   denied('WAL backup verification incomplete');
  return {kind:'content-studio-v74-container-maintenance',operation:'backup',
   archive:name,sha256:verified.sha256,rowCount:verified.rowCount,
   walSafe:true,backupManifestVerified:true,sourceUntouched:true,...safe};
 }
 if(opts.operation==='list'||opts.operation==='prune'){
  await mount(dir);
  const entries=await scan(dir);
  if(opts.operation==='list')
   return {kind:'content-studio-v74-container-maintenance',operation:'list',
    count:entries.length,backups:entries,...safe};
  const decision=decidePrune(entries,Number(opts.keep));
  if(opts.apply==='yes'){
   // Re-read and verify immediately before touching the protected vault.
   const again=await scan(dir);
   if(JSON.stringify(entries)!==JSON.stringify(again))
    denied('Backup vault changed during pruning');
   for(const name of decision.remove){
    const full=join(dir,name);
    await remove(full+'.manifest.json');
    await remove(full);
   }
  }
  return {kind:'content-studio-v74-container-maintenance',operation:'prune',
   applied:opts.apply==='yes',kept:decision.retain,
   candidatesForRemoval:decision.remove,verifiedBeforePrune:true,...safe};
 }
 if(opts.operation==='restore'){
  await mount(dir);await mount(restoreDir);
  if(isUnder(resolve(restoreDir),resolve(DATA))||
   resolve(RESTORED)===resolve(LIVE))denied('Cannot restore into production data');
  const entries=await scan(dir);
  if(!entries.some(e=>e.name===opts.backup))denied('Archive missing from trusted inventory');
  const from=join(dir,opts.backup);
  await regular(from);
  const restored=await restore(from,join(restoreDir,'content-studio.sqlite'));
  if(restored.verified!==true||restored.existingDatabaseOverwritten!==false)
   denied('Restore validation incomplete');
  const result=await inspect(RESTORED);
  if(result.integrity!=='ok')denied('Restored SQLite integrity failed');
  return {kind:'content-studio-v74-container-maintenance',operation:'restore',
   archive:opts.backup,destination:'separate_restore_volume_only',
   restoredToNewFile:true,verified:true,rowCount:result.rowCount,
   existingDatabaseOverwritten:false,liveApplicationStopped:false,...safe};
 }
 denied('Unsupported operation');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 execute(process.argv.slice(2)).then(r=>console.log(JSON.stringify(r,null,2)))
  .catch(()=>{
   console.error('V74 container maintenance blocked. Review private mounts, database, archive and permissions.');
   process.exitCode=1;
  });
}

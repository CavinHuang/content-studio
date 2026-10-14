/**
 * V45 safe SQLite recovery. Uses node:sqlite backup API: copying a live WAL
 * database file with ordinary fs.copyFile is NOT a consistent backup.
 *
 * This module is local-only. Never accepts paths over HTTP, never overwrites,
 * never prints row content, and never runs an auto-restore at app startup.
 */
import {DatabaseSync,backup as sqliteBackup} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,stat,lstat,link,unlink,rename,copyFile,chmod,readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {COPYFILE_EXCL} from 'node:constants';
import {dirname,join,resolve,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

export const BACKUP_FORMAT='content-studio-sqlite-v45';
export const MINIMUM_TABLES=['items','editorial_projects','editorial_channel_refs','article_documents','article_illustration_plans'];
const stop=(message)=>{throw Error(message)};
const sha=value=>createHash('sha256').update(value).digest('hex');
const quoteIdentifier=s=>'"'+s.replaceAll('"','""')+'"';
const DEFAULT_DB=()=>resolve(process.env.CONTENT_STUDIO_DB_PATH||join(process.cwd(),'data','content-studio.sqlite'));

async function regularFile(path){
 const info=await lstat(path);
 if(!info.isFile()||info.isSymbolicLink())stop('Regular file required (symlinks and special files are refused)');
 return info;
}
async function digestFile(path){
 const hash=createHash('sha256');
 for await(const part of createReadStream(path))hash.update(part);
 return hash.digest('hex');
}
async function ensureAbsent(path){
 try{await lstat(path);stop('Destination already exists: refusing overwrite')}catch(e){if(e?.code!=='ENOENT')throw e}
}
function snapshot(db){
 const check=db.prepare('PRAGMA quick_check').all();
 if(check.length!==1||check[0].quick_check!=='ok')stop('SQLite quick_check failed: '+JSON.stringify(check).slice(0,160));
 const fk=db.prepare('PRAGMA foreign_key_check').all();
 if(fk.length)stop('SQLite foreign_key_check reported '+fk.length+' problems');
 const tables=db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
 const counts=Object.fromEntries(tables.map(({name})=>[name,Number(db.prepare('SELECT COUNT(*) AS n FROM '+quoteIdentifier(name)).get().n)]));
 return {integrity:'ok',tableCount:tables.length,rowCount:Object.values(counts).reduce((a,b)=>a+b,0),
  schemaSha256:sha(JSON.stringify(tables)),rowCountsSha256:sha(JSON.stringify(counts)),
  missingCoreTables:MINIMUM_TABLES.filter(t=>!counts.hasOwnProperty(t)),tables:counts};
}
export async function inspectDatabase(path,{includeTableNames=false}={}){
 const file=resolve(path);await regularFile(file);
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  const audit=snapshot(db);
  const {tables,...safe}=audit;
  return {file:basename(file),...safe,...(includeTableNames?{tables}:{}),readOnly:true};
 }finally{db.close()}
}
export async function verifyBackup(backupPath,{requireManifest=true}={}){
 const input=resolve(backupPath);
 const info=await regularFile(input);
 const metaPath=input+'.manifest.json';
 let manifest;
 try{manifest=JSON.parse(await readFile(metaPath,'utf8'))}
 catch(e){if(requireManifest)stop('Backup manifest missing or invalid');manifest=null}
 if(manifest){
  if(manifest.format!==BACKUP_FORMAT||manifest.version!==1)stop('Backup manifest format unsupported');
  if(manifest.filename!==basename(input))stop('Manifest backup filename mismatch');
  if(info.size!==manifest.bytes)stop('Backup size does not match manifest');
  if(await digestFile(input)!==manifest.sha256)stop('Backup SHA256 mismatch');
 }
 const inspected=await inspectDatabase(input);
 if(manifest&&(inspected.schemaSha256!==manifest.schemaSha256||
    inspected.rowCountsSha256!==manifest.rowCountsSha256||
    inspected.rowCount!==manifest.rowCount))stop('Backup contents diverge from recorded schema and row-count checks');
 return {...inspected,backupValid:true,manifestVerified:!!manifest,sha256:manifest?.sha256||null,
  backupFormat:manifest?.format||null};
}
export async function createBackup(sourcePath,{outputPath}={}){
 const source=resolve(sourcePath||DEFAULT_DB());
 await regularFile(source);
 const time=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
 const dest=resolve(outputPath||join(dirname(source),'backups','content-studio-'+time+'-'+randomUUID().slice(0,8)+'.sqlite'));
 if(dest===source)stop('Source and backup destination must differ');
 await mkdir(dirname(dest),{recursive:true,mode:0o700});
 await ensureAbsent(dest);await ensureAbsent(dest+'.manifest.json');
 const temp=dest+'.tmp-'+randomUUID();
 let opened=false;
 try{
  // Separate unique temporary path for sqliteBackup; failure cannot corrupt an old backup.
  const db=new DatabaseSync(source,{readOnly:true});
  try{await sqliteBackup(db,temp)}finally{db.close()}
  await chmod(temp,0o600);
  const inspection=await inspectDatabase(temp);
  const info=await stat(temp);
  const fingerprint=await digestFile(temp);
  const manifest={format:BACKUP_FORMAT,version:1,filename:basename(dest),
   createdAt:new Date().toISOString(),bytes:info.size,sha256:fingerprint,
   schemaSha256:inspection.schemaSha256,rowCountsSha256:inspection.rowCountsSha256,
   rowCount:inspection.rowCount,tableCount:inspection.tableCount};
  // Hard-link from within same directory atomically fails if dest appears in a race.
  await link(temp,dest);opened=true;
  await writeFile(dest+'.manifest.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  await verifyBackup(dest);
  return {operation:'backup',output:dest,manifest:dest+'.manifest.json',
   bytes:info.size,sha256:fingerprint,tables:inspection.tableCount,rows:inspection.rowCount,
   verified:true,sourceUntouched:true,walSafe:true,platformVerified:false};
 }catch(e){if(opened){await unlink(dest+'.manifest.json').catch(()=>{});await unlink(dest).catch(()=>{})}throw e}
 finally{await unlink(temp).catch(()=>{})}
}
export async function restoreBackup(backupPath,destinationPath){
 if(!backupPath||!destinationPath)stop('Restore requires explicit --from and --to');
 const source=resolve(backupPath),dest=resolve(destinationPath);
 if(source===dest)stop('Restore source and destination must be different');
 await verifyBackup(source);
 await mkdir(dirname(dest),{recursive:true,mode:0o700});
 await ensureAbsent(dest);
 await copyFile(source,dest,COPYFILE_EXCL);
 try{
  await chmod(dest,0o600);
  const check=await inspectDatabase(dest);
  const original=await verifyBackup(source);
  if(check.schemaSha256!==original.schemaSha256||
     check.rowCountsSha256!==original.rowCountsSha256)stop('Restored copy differs from source backup');
  return {operation:'restore',target:dest,verified:true,rowCount:check.rowCount,tableCount:check.tableCount,
   existingDatabaseOverwritten:false,appRestarted:false};
 }catch(e){await unlink(dest).catch(()=>{});throw e}
}
export async function rehearseUpgrade(sourcePath,{openWithCore}={}){
 const source=resolve(sourcePath||DEFAULT_DB());
 await regularFile(source);
 const base=await mkdtemp(join(tmpdir(),'content-studio-v45-'));
 try{
  const output=join(base,'snapshot.sqlite'),restored=join(base,'restored.sqlite');
  const backed=await createBackup(source,{outputPath:output});
  const replayed=await restoreBackup(output,restored);
  let upgraded=false,newTables=[];
  if(openWithCore){
   const before=(await inspectDatabase(restored,{includeTableNames:true})).tables;
   const core=openWithCore(restored);
   try{
    const after=(await inspectDatabase(restored,{includeTableNames:true})).tables;
    // Startup registers newly supported default connectors into source_state.
    // That one additive change is expected; all other existing business row
    // counts must be preserved. Rehearsal alone does not certify semantic
    // equality: a separate legacy document round-trip test covers that.
    for(const [table,count] of Object.entries(before)){
     if(table==='source_state'&&after[table]>=count)continue;
     if(after[table]!==count)stop('Upgrade altered historical row count for table '+table);
    }
    newTables=Object.keys(after).filter(k=>!(k in before));
    upgraded=true;
   }finally{core.close()}
  }
  return {operation:'rehearse',verified:true,sourceUntouched:true,
   backupSha256:backed.sha256,rowCount:replayed.rowCount,tableCount:replayed.tableCount,
   upgradeOpenedSuccessfully:upgraded,newTables,temporaryCopiesDeleted:true};
 }finally{await rm(base,{recursive:true,force:true})}
}
function argsFrom(argv){
 const [action,...tail]=argv;
 if(!['preflight','backup','restore','rehearse'].includes(action))stop('Usage: db:safety -- preflight|backup|restore|rehearse [--db=PATH] [--out=PATH] [--from=PATH] [--to=PATH]');
 const data={action};
 for(const token of tail){
  const x=token.match(/^--(db|out|from|to)=(.+)$/);
  if(!x||data[x[1]])stop('Unexpected or duplicate database safety argument');
  data[x[1]]=x[2];
 }
 const allowed={preflight:['db'],backup:['db','out'],restore:['from','to'],rehearse:['db']};
 for(const k of Object.keys(data))if(k!=='action'&&!allowed[action].includes(k))stop('Argument --'+k+' is invalid for '+action);
 return data;
}
export async function runCommand(argv,options={}){
 const a=argsFrom(argv);
 if(a.action==='preflight')return {operation:'preflight',...await inspectDatabase(a.db||DEFAULT_DB())};
 if(a.action==='backup')return createBackup(a.db||DEFAULT_DB(),{outputPath:a.out});
 if(a.action==='restore')return restoreBackup(a.from,a.to);
 const {createCore}=await import('../lib/core.mjs');
 return rehearseUpgrade(a.db||DEFAULT_DB(),{openWithCore:createCore});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 runCommand(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result,null,2))).catch(e=>{
  // Never print source rows, environment secrets or a copied full SQLite.
  console.error('Database safety check failed: '+String(e?.message||'unknown').slice(0,260));
  process.exitCode=1;
 });
}

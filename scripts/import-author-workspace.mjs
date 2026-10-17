/** Explicit, offline one-owner migration. Source and verified WAL backup are preserved. */
import {DatabaseSync} from 'node:sqlite';
import {resolve,dirname} from 'node:path';
import {existsSync,readFileSync,writeFileSync,lstatSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {AuthorAccounts} from '../src/author-accounts.mjs';
import {CreatorServices} from '../src/creator-services.mjs';
import {createCore} from '../lib/core.mjs';
import {createBackup,restoreBackup,inspectDatabase} from './db-safety.mjs';
export async function importAuthorWorkspace({source,accountsRoot,email,backupPath}){
 if(!source||!accountsRoot||!email||!backupPath)throw Error('Explicit source, accounts root, author email and new backup path are required');
 source=resolve(source);backupPath=resolve(backupPath);const stat=lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('Source must be a regular, unlinked SQLite file');
 mkdirSync(dirname(backupPath),{recursive:true,mode:0o700});if(lstatSync(dirname(backupPath)).mode&0o077)throw Error('Backup directory must be owner-only');
 const accounts=new AuthorAccounts(accountsRoot);let core;
 try{const author=accounts.authors().find(a=>a.email===email.toLowerCase());if(!author)throw Error('Register the selected owner before importing');const destination=accounts.workspace(author);if(existsSync(destination))throw Error('Selected workspace must be empty; existing data will never be overwritten');
  const original=new DatabaseSync(source,{readOnly:true});let encrypted=[];
  try{for(const [table,column,id] of [['service_connections','secret','id'],['publishing_accounts','credentials','id'],['publishing_tokens','encrypted','account_id']]){if(original.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)){for(const row of original.prepare(`SELECT ${id} AS id,${column} AS value FROM ${table}`).all())encrypted.push({table,column,id,row})}}}finally{original.close()}
  if(encrypted.length){const keyFile=source+'.services.key';const keyInfo=lstatSync(keyFile);if(!keyInfo.isFile()||keyInfo.isSymbolicLink()||(keyInfo.mode&0o077))throw Error('Original credential key must be private and available');const key=readFileSync(keyFile);encrypted=encrypted.map(entry=>({...entry,clear:CreatorServices.prototype.open.call({key},entry.row.value)}));writeFileSync(backupPath+'.credentials-key',key,{flag:'wx',mode:0o600})}
  const backup=await createBackup(source,{outputPath:backupPath});await restoreBackup(backupPath,destination);const [expected,restored]=await Promise.all([inspectDatabase(backupPath,{includeContentDigest:true}),inspectDatabase(destination,{includeContentDigest:true})]);if(expected.contentSha256!==restored.contentSha256)throw Error('Restored business contents differ from verified snapshot');
  core=createCore(destination,{key:accounts.key});core.store.db.exec('BEGIN IMMEDIATE');try{for(const entry of encrypted)core.store.db.prepare(`UPDATE ${entry.table} SET ${entry.column}=? WHERE ${entry.id}=?`).run(core.services.seal(entry.clear),entry.row.id);core.store.db.exec('COMMIT')}catch(e){core.store.db.exec('ROLLBACK');throw e}
  return {imported:true,ownerSelected:true,workspacePreviouslyEmpty:true,walSafe:backup.walSafe,snapshotContentVerified:true,credentialsReencrypted:encrypted.length,sourceUntouched:true,backupPreserved:true};
 }finally{core?.close();accounts.close()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const index=arg.indexOf('=');return [arg.slice(2,index),arg.slice(index+1)]}));try{console.log(JSON.stringify(await importAuthorWorkspace({source:args.source,accountsRoot:args['accounts-root'],email:args['author-email'],backupPath:args.backup}),null,2))}catch(e){console.error('Import blocked: check source, private directories, selected owner and new backup destination. Existing workspaces are never overwritten.');process.exitCode=1}}

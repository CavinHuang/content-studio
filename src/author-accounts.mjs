import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdirSync,readFileSync,writeFileSync,lstatSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {ValidationError} from './verification.mjs';
const scrypt=promisify(scryptCallback),hash=s=>createHash('sha256').update(s).digest('hex');
const fail=(s,status=400)=>{throw new ValidationError(s,status)};
export const accountsEnabled=()=>process.env.CONTENT_STUDIO_MULTIUSER==='1';
export const accountCookie=(remote=process.env.CONTENT_STUDIO_DEPLOY_MODE==='dokploy')=>remote?'__Host-studio_author':'studio_author';
export class AuthorAccounts{
 constructor(root){
  this.root=resolve(root);mkdirSync(this.root,{recursive:true,mode:0o700});const rootState=lstatSync(this.root);if(!rootState.isDirectory()||rootState.isSymbolicLink()||(rootState.mode&0o077))fail('账号目录必须为作者进程私有目录（0700）',503);
  const keyfile=join(this.root,'authors.key');
  try{writeFileSync(keyfile,randomBytes(32),{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e}
  const state=lstatSync(keyfile);if(!state.isFile()||state.isSymbolicLink()||state.nlink!==1||(state.mode&0o077))fail('账号密钥文件权限不安全',503);
  this.key=readFileSync(keyfile);if(this.key.length!==32)fail('账号密钥不可用',503);
  const registry=join(this.root,'authors.sqlite');try{writeFileSync(registry,'',{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e}const registryState=lstatSync(registry);if(!registryState.isFile()||registryState.isSymbolicLink()||registryState.nlink!==1||(registryState.mode&0o077))fail('账号数据库权限不安全',503);
  this.db=new DatabaseSync(registry);this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=4000;
   CREATE TABLE IF NOT EXISTS authors(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,workspace_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS author_sessions(token_hash TEXT PRIMARY KEY,author_id TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS author_login_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,start INTEGER NOT NULL);
  `);
 }
 _email(s){if(typeof s!=='string'||s.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))fail('请输入有效邮箱');return s.trim().toLowerCase()}
 _public(row){return {id:row.id,email:row.email,name:row.name,workspaceId:row.workspace_id}}
 _limit(key,max){const now=Date.now(),row=this.db.prepare('SELECT * FROM author_login_limits WHERE key=?').get(key);if(row&&now-row.start<600000&&row.count>=max)fail('尝试次数过多，请十分钟后重试',429);this.db.prepare('INSERT INTO author_login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ?-start>=600000 THEN 1 ELSE count+1 END,start=CASE WHEN ?-start>=600000 THEN ? ELSE start END').run(key,now,now,now,now)}
 async register({email,password,name}={}){
  this._limit('registration',30);email=this._email(email);
  if(typeof password!=='string'||password.length<12||password.length>256)fail('密码需为 12–256 个字符');
  if(typeof name!=='string'||name.trim().length<2||name.length>80)fail('作者名称需为 2–80 个字符');
  const salt=randomBytes(24).toString('hex'),derived=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  const row={id:'au_'+randomUUID(),email,name:name.trim(),workspace_id:'ws_'+randomUUID()};
  try{this.db.prepare('INSERT INTO authors VALUES(?,?,?,?,?,?,?)').run(row.id,email,row.name,salt,derived.toString('hex'),row.workspace_id,new Date().toISOString())}catch(e){if(e.errcode===2067||e.code?.includes('CONSTRAINT'))fail('该邮箱已注册',409);throw e}
  return this._public(row);
 }
 async login({email,password}={}){
  email=this._email(email);this._limit('global-login',150);this._limit(hash(email),10);
  if(typeof password!=='string'||password.length>256)fail('邮箱或密码不正确',401);
  const row=this.db.prepare('SELECT * FROM authors WHERE email=?').get(email),salt=row?.salt||'dummy-fixed-login-salt';
  const derived=await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  if(!row||!timingSafeEqual(derived,Buffer.from(row.password_hash,'hex')))fail('邮箱或密码不正确',401);
  this.db.prepare('DELETE FROM author_login_limits WHERE key=?').run(hash(email));
  const token=randomBytes(32).toString('hex'),now=Date.now();
  this.db.prepare('DELETE FROM author_sessions WHERE expires_at<?').run(now);
  this.db.prepare('INSERT INTO author_sessions VALUES(?,?,?,?)').run(hash(token),row.id,now+8*3600000,now);
  const stale=this.db.prepare('SELECT token_hash FROM author_sessions WHERE author_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 10').all(row.id);for(const old of stale)this.db.prepare('DELETE FROM author_sessions WHERE token_hash=?').run(old.token_hash);
  return {author:this._public(row),token};
 }
 token(headers){const raw=headers.get('cookie')||'';const token=raw.split(';').map(s=>s.trim()).find(s=>s.startsWith(accountCookie()+'='))?.slice(accountCookie().length+1);return /^[a-f0-9]{64}$/.test(token||'')?token:null}
 session(headers){const token=this.token(headers);if(!token)return null;const row=this.db.prepare('SELECT a.* FROM author_sessions s JOIN authors a ON a.id=s.author_id WHERE s.token_hash=? AND s.expires_at>?').get(hash(token),Date.now());return row?this._public(row):null}
 logout(headers){const token=this.token(headers);if(token)this.db.prepare('DELETE FROM author_sessions WHERE token_hash=?').run(hash(token))}
 cookie(token=''){return `${accountCookie()}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token?28800:0}${process.env.CONTENT_STUDIO_DEPLOY_MODE==='dokploy'?'; Secure':''}`}
 workspace(author){if(!/^ws_[a-f0-9-]{36}$/.test(author.workspaceId))fail('作者空间无效',403);const workspaceParent=join(this.root,'workspaces');mkdirSync(workspaceParent,{recursive:true,mode:0o700});const parentState=lstatSync(workspaceParent);if(!parentState.isDirectory()||parentState.isSymbolicLink()||(parentState.mode&0o077))fail('工作空间目录权限不安全',503);const root=join(workspaceParent,author.workspaceId);mkdirSync(root,{recursive:true,mode:0o700});const s=lstatSync(root);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077))fail('作者空间权限不安全',503);return join(root,'studio.sqlite')}
 authors(){return this.db.prepare('SELECT * FROM authors ORDER BY created_at').all().map(row=>this._public(row))}
 close(){this.db.close()}
}
const key=Symbol.for('studio.author-accounts');
export function getAccounts(){const root=process.env.CONTENT_STUDIO_ACCOUNTS_PATH||dirname(process.env.CONTENT_STUDIO_DB_PATH||join(process.cwd(),'data','content-studio.sqlite'));const state=globalThis[key];if(state?.root===resolve(root))return state;globalThis[key]=new AuthorAccounts(root);return globalThis[key]}

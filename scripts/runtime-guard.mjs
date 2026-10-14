/**
 * V49: localhost production start guard.
 *
 * The server is trusted, single-user and unauthenticated. Deny unsafe public
 * opt-ins instead of treating localhost binding as sufficient authentication.
 * This script never reads/displays provider keys or opens user SQLite data.
 */
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {verifyBuildReceipt,getHeadSha} from './build-provenance-v64.mjs';
import {readFileSync,existsSync,lstatSync} from 'node:fs';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';

const DEFAULT_PORT=4312;
const hasValue=value=>typeof value==='string'&&value.trim().length>0;
const sensitivePublicName=name=>/^NEXT_PUBLIC_/i.test(name)&&/(?:API[_-]?KEY|SECRET|PASSWORD|TOKEN|PRIVATE[_-]?KEY|AUTH[_-]?KEY|CREDENTIAL)/i.test(name);
const loopbackOnlyHosts=new Set(['127.0.0.1','localhost','[::1]','::1']);
const pathFromEnv=(env,cwd)=>resolve(cwd,env.CONTENT_STUDIO_DB_PATH||'data/content-studio.sqlite');

export function auditLocalRuntime({env=process.env,version=process.versions.node,cwd=process.cwd(),strict=true}={}){
 const problems=[],warnings=[];
 const match=String(version).match(/^(\d+)\.(\d+)\.(\d+)/);
 const parts=match?.slice(1).map(Number)||[];
 if(parts.length!==3||parts[0]<22||(parts[0]===22&&parts[1]<16))problems.push('requires_node_22_16_or_later_in_22_x');
 if(env.CONTENT_STUDIO_ALLOW_REMOTE==='1')problems.push('unauthenticated_remote_access_opt_in_forbidden');
 if(hasValue(env.CONTENT_STUDIO_DB_PATH)&&env.CONTENT_STUDIO_DB_PATH.trim()===':memory:')problems.push('nonpersistent_database_forbidden');
 if(hasValue(env.DB_PATH))warnings.push('legacy_DB_PATH_ignored_by_next_app');
 if(env.ENABLE_SCENARIO==='1')problems.push('fixture_seed_endpoint_must_be_disabled_for_production');
 const publicSecrets=Object.entries(env).filter(([name,value])=>sensitivePublicName(name)&&hasValue(value)).map(([name])=>name).sort();
 if(publicSecrets.length)problems.push('public_environment_contains_secret_like_names');
 if(publicSecrets.length)warnings.push('review_NEXT_PUBLIC_secret_names_out_of_band');
 const port=hasValue(env.PORT)?Number(env.PORT):DEFAULT_PORT;
 if(!Number.isInteger(port)||port<1024||port>65535)problems.push('invalid_local_port');
 if(hasValue(env.HOST)&&!loopbackOnlyHosts.has(env.HOST.trim()))problems.push('nonloopback_host_override');
 if(hasValue(env.HOSTNAME)&&!loopbackOnlyHosts.has(env.HOSTNAME.trim()))warnings.push('HOSTNAME_ignored_by_strict_next_start');
 let databasePresent=false;
 if(!problems.includes('nonpersistent_database_forbidden')){
  try{
   const path=pathFromEnv(env,cwd);
   // lstat even for dangling symlinks: existsSync() follows the symlink and
   // would incorrectly treat an unsafe dangling link as a new database path.
   const stat=lstatSync(path);
   if(stat.isSymbolicLink()||!stat.isFile())problems.push('database_must_be_regular_local_file');
   else databasePresent=true;
  }catch(error){
   if(error?.code==='ENOENT'){if(strict)warnings.push('database_missing_will_be_created_on_first_start')}
   else problems.push('database_path_not_accessible');
  }
 }
 return {kind:'content-studio-v49-local-runtime-audit',ready:problems.length===0,problems,warnings,
  nodeVersion:version,loopbackBind:'127.0.0.1',port:Number.isInteger(port)?port:null,
  databasePresent,providerRequests:0,platformVerified:false,
  publicSecretsDetected:publicSecrets.length,privateValuesDisplayed:false,
  productionReady:false,message:'Local single-user start only; do not expose on a public network without separate authentication and access controls.'};
}
export function assertLocalRuntime(options){
 const status=auditLocalRuntime(options);
 if(!status.ready)throw Object.assign(new Error('Unsafe local runtime configuration: '+status.problems.join(',')),{status:78});
 return status;
}
export async function startLocalRuntime({env=process.env,cwd=process.cwd(),spawnChild=spawn,
 inspectBuild=dir=>verifyBuildReceipt({cwd:dir,expectedSha:getHeadSha(dir)}),
 makeNonce=()=>randomBytes(16).toString('hex')}={}){
 const audit=assertLocalRuntime({env,cwd});
 const build=inspectBuild(cwd);
 const nonce=makeNonce();
 if(!/^[a-f0-9]{40}$/.test(build?.candidateCommit||'')||
  !/^[a-f0-9]{64}$/.test(build?.artifactDigestSha256||'')||
  !/^[a-f0-9]{64}$/.test(build?.dependencyLockSha256||'')||
  typeof build?.buildId!=='string'||!build.buildId||
  !/^[a-f0-9]{32}$/.test(nonce))
  throw Error('Verified Next production build identity is required');
 const bin=resolve(cwd,'node_modules/next/dist/bin/next');
 const argv=[bin,'start','-H','127.0.0.1','-p',String(audit.port)];
 const child=spawnChild(process.execPath,argv,{cwd,env:{...env,
  CONTENT_STUDIO_ALLOW_REMOTE:'0',ENABLE_SCENARIO:'0',
  CONTENT_STUDIO_RUNTIME_COMMIT:build.candidateCommit,
  CONTENT_STUDIO_RUNTIME_DIGEST:build.artifactDigestSha256,
  CONTENT_STUDIO_RUNTIME_LOCK_DIGEST:build.dependencyLockSha256,
  CONTENT_STUDIO_RUNTIME_BUILD_ID:build.buildId,
  CONTENT_STUDIO_RUNTIME_NONCE:nonce},stdio:'inherit'});
 const forward=sig=>{if(!child.killed)child.kill(sig)};
 const onInt=()=>forward('SIGINT'),onTerm=()=>forward('SIGTERM');
 process.once('SIGINT',onInt);
 process.once('SIGTERM',onTerm);
 return new Promise((done,reject)=>{
  child.once('error',reject);
  child.once('exit',(code,signal)=>{
   process.removeListener('SIGINT',onInt);
   process.removeListener('SIGTERM',onTerm);
   done(code??(signal?128:1));
  });
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 // Next resolves .env.production.local, .env.local, .env.production and .env
 // internally. Resolve the exact same precedence BEFORE checking settings:
 // otherwise an unsafe toggle hidden in .env.local could bypass the guard.
 (async()=>{
  const command=process.argv[2];
  if(!['preflight','start'].includes(command)){
   console.error('Usage: node scripts/runtime-guard.mjs preflight|start');
   process.exitCode=2;return;
  }
  // @next/env is CommonJS in Next 16: ESM import() may expose only default.
  const loaded=await import('@next/env');
  const loadEnvConfig=loaded.loadEnvConfig||loaded.default?.loadEnvConfig;
  if(typeof loadEnvConfig!=='function')throw Error('Next environment loader is unavailable');
  loadEnvConfig(process.cwd(),false);
  if(command==='preflight'){
   const result=auditLocalRuntime();
   console.log(JSON.stringify(result,null,2));
   if(!result.ready)process.exitCode=78;
  }else process.exitCode=await startLocalRuntime();
 })().catch(error=>{
  console.error('Local runtime denied: '+String(error?.message||'unknown').slice(0,220));
  process.exitCode=78;
 });
}

/**
 * V50 — fail closed BEFORE Next embeds NEXT_PUBLIC_* into client bundles.
 * Operational guard at npm start is too late: Next inline substitution happens
 * at npm run build. This script does not read or print secret values.
 */
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const publicSecretName=name=>/^NEXT_PUBLIC_/i.test(name)&&
  /(?:API[_-]?KEY|SECRET|PASSWORD|TOKEN|PRIVATE[_-]?KEY|AUTH[_-]?KEY|CREDENTIAL)/i.test(name);
export function auditClientBuildEnvironment(env=process.env){
 const publicSecrets=Object.entries(env).filter(([name,value])=>
  publicSecretName(name)&&typeof value==='string'&&value.trim().length>0).map(([name])=>name).sort();
 return {kind:'content-studio-v50-client-build-preflight',safe:publicSecrets.length===0,
  problems:publicSecrets.length?['secret_like_NEXT_PUBLIC_variable_present']:[],
  unsafeVariableNames:publicSecrets,secretValuesIncluded:false,
  paidRequests:0,externalCalls:0,platformVerified:false};
}
export function prepareBuildEnvironment({cwd=process.cwd(),env=process.env,load=()=>require('@next/env').loadEnvConfig(cwd,false)}={}){
 load();
 return auditClientBuildEnvironment(env);
}
export function runSafeBuild({cwd=process.cwd(),env=process.env,runner=spawnSync}={}){
 const report=prepareBuildEnvironment({cwd,env});
 if(!report.safe)return {code:78,report};
 const bin=resolve(cwd,'node_modules/next/dist/bin/next');
 const build=runner(process.execPath,[bin,'build'],{cwd,env,stdio:'inherit'});
 return {code:Number.isInteger(build.status)?build.status:1,report};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2];
 try{
  if(mode==='preflight'){
   const report=prepareBuildEnvironment();
   console.log(JSON.stringify(report,null,2));
   if(!report.safe)process.exitCode=78;
  }else if(mode==='build'){
   const result=runSafeBuild();
   if(result.code===78)console.error('Client build denied: '+result.report.unsafeVariableNames.join(', '));
   process.exitCode=result.code;
  }else{console.error('Usage: node scripts/build-guard.mjs preflight|build');process.exitCode=2}
 }catch{
  console.error('Client build guard could not load the environment safely');process.exitCode=78;
 }
}

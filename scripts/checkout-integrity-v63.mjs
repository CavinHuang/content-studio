/**
 * V63 release checkout integrity: a Git commit SHA alone does not prove that
 * executable files on a host match that commit. Fail closed on dirty, staged,
 * untracked, sparse/skip-worktree and assume-unchanged index states.
 * No networking, database access, checkout mutation or publishing.
 */
import {spawnSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const SHA=/^[a-f0-9]{40}$/;
const sanitizedEnvironment=()=>{
 const env={...process.env};
 for(const key of Object.keys(env))if(/^GIT_/i.test(key))delete env[key];
 return env;
};
function runGit(cwd,args,{runner=spawnSync,env=sanitizedEnvironment()}={}){
 const child=runner('git',['--no-optional-locks','-c','core.fsmonitor=false',
  '-c','core.untrackedCache=false',...args],{
  cwd,env,encoding:'buffer',stdio:['ignore','pipe','pipe'],
  maxBuffer:4*1024*1024,windowsHide:true
 });
 if(child.error||child.status!==0||!Buffer.isBuffer(child.stdout))
  throw Error('Cannot validate the complete local Git checkout');
 return child.stdout;
}
function canonical(path){
 const p=realpathSync(path);
 return process.platform==='win32'?p.toLowerCase():p;
}
/** Every check re-reads actual index, tracked files and HEAD from disk. */
export function verifyCleanCheckout(sha,{cwd=process.cwd(),runner=spawnSync}={}){
 if(!SHA.test(sha||''))throw Error('Pinned lowercase 40-character commit SHA required');
 const env=sanitizedEnvironment();
 const git=(...args)=>runGit(cwd,args,{runner,env});
 const root=git('rev-parse','--show-toplevel').toString('utf8').trim();
 if(canonical(root)!==canonical(resolve(cwd)))
  throw Error('Operator command must run from the Git worktree root');
 const actual=git('rev-parse','--verify','HEAD^{commit}').toString('utf8').trim();
 if(actual!==sha)throw Error('Local Git HEAD differs from reviewed commit');
 // --porcelain -z includes unstaged, staged, deletions and all untracked files
 // regardless of unusual filenames. Never print those paths or their content.
 const dirty=git('status','--porcelain=v1','--untracked-files=all',
  '--ignore-submodules=none','-z');
 if(dirty.length)throw Error('Local checkout has uncommitted or untracked changes');
 // Git's skip-worktree and assume-unchanged bits can hide edited files even
 // when porcelain status is clean; they cannot be used for release review.
 const flags=git('ls-files','-v','-z');
 for(const record of flags.toString('utf8').split('\0')){
  if(!record)continue;
  const first=record[0];
  if(first==='S'||first===first.toLowerCase())
   throw Error('Local checkout contains Git index flags that hide file changes');
 }
 return {kind:'content-studio-v63-checkout-integrity',candidateCommit:sha,
  cleanTrackedFiles:true,cleanIndex:true,noUntrackedFiles:true,
  noHiddenIndexFlags:true,atWorktreeRoot:true,ignoredPathsNotInspected:true,
  mergeAuthorized:false,deployAuthorized:false,productionReady:false};
}
export function parseCheckoutArgs(argv=[]){
 if(argv.length!==1||!/^--sha=[a-f0-9]{40}$/.test(argv[0]))
  throw Error('Usage: npm run release:checkout:v63 -- --sha=<40-digit-lowercase-Git-SHA>');
 return argv[0].slice('--sha='.length);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(verifyCleanCheckout(parseCheckoutArgs(process.argv.slice(2))),null,2))}
 catch{
  console.error('V63 release checkout verification refused: examine Git HEAD, status and index flags locally');
  process.exitCode=1;
 }
}

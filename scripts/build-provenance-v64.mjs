/**
 * V64 — a local SHA-256 inventory of Next.js production output.
 * This is NOT a signed build or an independent provenance certificate.
 * Mutable Next cache and trace logs are excluded by fixed exact paths only.
 */
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,readdirSync,lstatSync,openSync,readSync,closeSync} from 'node:fs';
import {resolve,join,relative,sep,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyCleanCheckout} from './checkout-integrity-v63.mjs';
import {verifyDependencyLock} from './dependency-lock-v65.mjs';

const SHA=/^[a-f0-9]{40}$/;
const RECEIPT='content-studio-v64-build-receipt.json';
const KIND='content-studio-v64-next-build-receipt';
const digest=value=>createHash('sha256').update(value).digest('hex');
const safeGitEnv=()=>{
 const env={...process.env};
 for(const key of Object.keys(env))if(/^GIT_/i.test(key))delete env[key];
 return env;
};
export function getHeadSha(cwd=process.cwd()){
 const child=spawnSync('git',['--no-optional-locks','rev-parse','--verify','HEAD^{commit}'],{
  cwd,env:safeGitEnv(),encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true
 });
 const sha=child.stdout?.trim();
 if(child.error||child.status!==0||!SHA.test(sha||''))
  throw Error('Build source Git commit could not be resolved');
 return sha;
}
function fileDigest(path){
 const fd=openSync(path,'r'),h=createHash('sha256'),buf=Buffer.allocUnsafe(65536);
 try{
  let count;
  while((count=readSync(fd,buf,0,buf.length,null))>0)h.update(buf.subarray(0,count));
 }finally{closeSync(fd)}
 return h.digest('hex');
}
// Next 16 writes APP_PAGE HTML/RSC route-cache during ordinary requests.
 // Never exclude server application JS/chunks outside this precise cache path.
const excluded=rel=>rel===RECEIPT||rel==='cache'||rel.startsWith('cache/')||
 rel==='server/route-cache'||rel.startsWith('server/route-cache/')||
 rel==='trace'||rel==='trace-build'||rel==='trace-upload';
export function inspectBuildFiles(cwd=process.cwd()){
 const root=resolve(cwd,'.next');
 const base=lstatSync(root);
 if(!base.isDirectory()||base.isSymbolicLink())throw Error('Next build root is not a real directory');
 const artifacts=[];
 function visit(dir,folder=''){
  for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
   const rel=folder?folder+'/'+entry.name:entry.name;
   if(excluded(rel))continue;
   const full=join(dir,entry.name);
   const stat=lstatSync(full);
   if(stat.isSymbolicLink())throw Error('Next build includes a symbolic link');
   if(stat.isDirectory()){visit(full,rel);continue}
   if(!stat.isFile())throw Error('Next build includes an unsupported file type');
   artifacts.push({path:rel,bytes:stat.size,sha256:fileDigest(full)});
   if(artifacts.length>25000)throw Error('Next build inventory is unexpectedly large');
  }
 }
 visit(root);
 artifacts.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const buildId=readFileSync(join(root,'BUILD_ID'),'utf8').trim();
 if(!buildId||buildId.length>200||/[\r\n]/.test(buildId)||
  !artifacts.some(x=>x.path==='BUILD_ID')||
  !artifacts.some(x=>x.path.startsWith('server/'))||
  !artifacts.some(x=>x.path.startsWith('static/')))
  throw Error('Next production build is missing expected output');
 return {root,buildId,fileCount:artifacts.length,artifactDigestSha256:digest(JSON.stringify(artifacts))};
}
export function sealBuild(cwd=process.cwd(),{sha=getHeadSha(cwd)}={}){
 if(!SHA.test(sha||''))throw Error('A complete Git SHA is required to seal this build');
 const report=inspectBuildFiles(cwd);
 const locked=verifyDependencyLock({cwd});
 const value={kind:KIND,schemaVersion:1,candidateCommit:sha,
  buildId:report.buildId,fileCount:report.fileCount,artifactDigestSha256:report.artifactDigestSha256,
  dependencyLockSha256:locked.lockSha256};
 const path=join(report.root,RECEIPT);
 // A successful build may replace an older .next tree. Its new receipt replaces
 // the previous receipt after the full current tree has been inventoried.
 writeFileSync(path,JSON.stringify(value)+'\n',{encoding:'utf8',mode:0o600});
 return value;
}
export function verifyBuildReceipt({cwd=process.cwd(),expectedSha}={}){
 if(!SHA.test(expectedSha||''))throw Error('Expected pinned source SHA required');
 const path=join(resolve(cwd,'.next'),RECEIPT);
 const stat=lstatSync(path);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2048)
  throw Error('Build receipt missing or invalid');
 const value=JSON.parse(readFileSync(path,'utf8'));
 if(value.kind!==KIND||value.schemaVersion!==1||
  value.candidateCommit!==expectedSha||
  !/^[a-f0-9]{64}$/.test(value.artifactDigestSha256||'')||
  !/^[a-f0-9]{64}$/.test(value.dependencyLockSha256||''))
  throw Error('Build receipt does not match pinned Git commit');
 const locked=verifyDependencyLock({cwd});
 if(value.dependencyLockSha256!==locked.lockSha256)
  throw Error('Built Next.js artifact dependency lock differs from its receipt');
 const current=inspectBuildFiles(cwd);
 if(value.buildId!==current.buildId||value.fileCount!==current.fileCount||
  value.artifactDigestSha256!==current.artifactDigestSha256)
  throw Error('Built Next.js artifact differs from its receipt');
 return {candidateCommit:expectedSha,buildId:current.buildId,
  artifactDigestSha256:current.artifactDigestSha256,
  dependencyLockSha256:locked.lockSha256,
  checkedFiles:current.fileCount,integrityVerified:true,
  signedByTrustedBuilder:false,productionReady:false};
}
export function parseRuntimeProbeArgs(argv=[]){
 const out={};
 for(const arg of argv){
  const match=/^--(sha|url)=(.+)$/.exec(arg);
  if(!match||Object.hasOwn(out,match[1]))throw Error('Expected exact --sha and --url');
  out[match[1]]=match[2];
 }
 if(!SHA.test(out.sha||''))throw Error('Pinned Git SHA required');
 let u;
 try{u=new URL(out.url)}catch{throw Error('Invalid local server URL')}
 if(u.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(u.hostname)||
  !u.port||!Number.isInteger(Number(u.port))||Number(u.port)<1024||
  u.username||u.password||u.pathname!=='/'||u.search||u.hash)
  throw Error('Only explicit numeric loopback HTTP server root with a port is supported');
 return {sha:out.sha,url:u.origin};
}
export async function probeServingBuild(input,{
 inspect=verifyBuildReceipt,head=getHeadSha,checkout=verifyCleanCheckout,
 request=fetch,cwd=process.cwd()
}={}){
 const opts=Array.isArray(input)?parseRuntimeProbeArgs(input):input;
 const args=parseRuntimeProbeArgs(['--sha='+opts.sha,'--url='+opts.url]);
 checkout(args.sha,{cwd});
 if(head(cwd)!==args.sha)throw Error('Git checkout moved before runtime query');
 const local=inspect({cwd,expectedSha:args.sha});
 const response=await request(args.url+'/api/health',{method:'GET',
  redirect:'error',signal:AbortSignal.timeout(4000),cache:'no-store'});
 if(!response.ok)throw Error('Local Next.js process is not healthy');
 const status=await response.json();
 const marker=status?.runtimeBuild;
 if(status.ok!==true||status.framework!=='nextjs'||status.mode!=='local-only'||
  marker?.candidateCommit!==args.sha||
  marker?.artifactDigestSha256!==local.artifactDigestSha256||
  marker?.dependencyLockSha256!==local.dependencyLockSha256||
  marker?.buildId!==local.buildId||
  !/^[a-f0-9]{64}$/.test(marker?.databaseIdentity||'')||
  !/^[a-f0-9]{32}$/.test(marker?.runNonce||'')||
  !Number.isInteger(marker?.pid)||marker.pid<1)
  throw Error('Local Next.js process does not identify the verified build');
 checkout(args.sha,{cwd});
 if(head(cwd)!==args.sha)throw Error('Git checkout moved during runtime query');
 inspect({cwd,expectedSha:args.sha});
 return {kind:'content-studio-v64-serving-build-probe',schemaVersion:1,
  candidateCommit:args.sha,artifactDigestSha256:local.artifactDigestSha256,
  buildId:local.buildId,dependencyLockSha256:local.dependencyLockSha256,
  observedDatabaseIdentity:marker.databaseIdentity,
  observedProcessPid:marker.pid,
  observedNonce:marker.runNonce,localBuildIntegrityVerified:true,
  servingProcessDeclarationMatchesBuild:true,
  independentProcessBinaryAttestation:false,hostingIndependentlyVerified:false,
  mergeAuthorized:false,deployAuthorized:false,releaseAuthorized:false,productionReady:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 probeServingBuild(process.argv.slice(2)).then(x=>console.log(JSON.stringify(x,null,2))).catch(()=>{
  console.error('V64 local serving-build verification blocked; review build receipt and loopback server');
  process.exitCode=1;
 });
}

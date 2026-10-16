/**
 * V65 — local npm package-lock v3 integrity admission.
 * This validates committed dependency metadata before build/start; npm ci
 * remains the actual graph and integrity enforcement. No registry/network,
 * private files, shell execution, or automatic package mutation.
 */
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const SHA256=v=>createHash('sha256').update(v).digest('hex');
const integrity=/^sha512-[A-Za-z0-9+/]+={0,2}$/;
const version=/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/;
const npmPackage=/^node_modules\/(?:@[-\w.]+\/)?[-\w.]+(?:\/node_modules\/(?:@[-\w.]+\/)?[-\w.]+)*$/;
const depMap=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const hasOwn=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
function compareSpecs(manifest,locked,label){
 const expected=depMap(manifest),actual=depMap(locked);
 const a=Object.keys(expected).sort(),b=Object.keys(actual).sort();
 if(JSON.stringify(a)!==JSON.stringify(b)||
  a.some(name=>expected[name]!==actual[name]||typeof actual[name]!=='string'||
   /^(?:file:|link:|git\+|https?:|workspace:)/i.test(actual[name])))
  throw Error('Manifest and lockfile dependency specs differ: '+label);
}
export function examineDependencyLock(packageText,lockText){
 if(typeof packageText!=='string'||typeof lockText!=='string'||
  packageText.length>1024*1024||lockText.length>5*1024*1024)
  throw Error('Manifest or npm lock exceeds safe limits');
 let manifest,lock;
 try{manifest=JSON.parse(packageText);lock=JSON.parse(lockText)}
 catch{throw Error('Malformed npm manifest or lockfile JSON')}
 if(!manifest||!lock||manifest.name!=='content-studio'||
  !version.test(manifest.version||'')||
  manifest.packageManager!=='npm@10.9.2'||
  lock.lockfileVersion!==3||lock.requires!==true||
  lock.name!==manifest.name||lock.version!==manifest.version||
  !lock.packages||!hasOwn(lock.packages,'')||
  lock.packages[''].name!==manifest.name||
  lock.packages[''].version!==manifest.version)
  throw Error('Npm v3 dependency lock identity mismatch');
 const root=lock.packages[''];
 compareSpecs(manifest.dependencies,root.dependencies,'dependencies');
 compareSpecs(manifest.devDependencies,root.devDependencies,'devDependencies');
 let count=0;
 for(const [path,item] of Object.entries(lock.packages)){
  if(!path)continue;
  if(!npmPackage.test(path)||!item||typeof item!=='object'||
   item.link===true||!version.test(item.version||'')||
   typeof item.resolved!=='string'||
   !item.resolved.startsWith('https://registry.npmjs.org/')||
   !integrity.test(item.integrity||''))
   throw Error('npm dependency integrity/resolution not pinned');
  count++;
 }
 if(!count)throw Error('Empty dependency lock graph');
 for(const name of [...Object.keys(depMap(manifest.dependencies)),...Object.keys(depMap(manifest.devDependencies))]){
  if(!hasOwn(lock.packages,'node_modules/'+name))throw Error('Direct dependency missing from npm lock');
 }
 return {kind:'content-studio-v65-npm-lock',
  lockfileVersion:3,packageManager:manifest.packageManager,
  packageVersion:manifest.version,dependencyPackages:count,
  lockSha256:SHA256(lockText),
  packageSha256:SHA256(packageText),
  immutableInstallRequired:true,verifiedInstall:false,
  independentlySigned:false,mergeAuthorized:false,deployAuthorized:false,
  productionReady:false};
}
export function verifyDependencyLock({cwd=process.cwd()}={}){
 const base=resolve(cwd);
 const paths=[join(base,'package.json'),join(base,'package-lock.json')];
 for(const file of paths){
  const stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>5*1024*1024)
   throw Error('Expected regular npm lock/manifest files');
 }
 return examineDependencyLock(readFileSync(paths[0],'utf8'),readFileSync(paths[1],'utf8'));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==2)throw Error('No parameters supported');
  console.log(JSON.stringify(verifyDependencyLock(),null,2));
 }catch{
  console.error('V65 npm lock admission blocked; check package.json and committed package-lock.json');
  process.exitCode=1;
 }
}

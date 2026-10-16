import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {examineDependencyLock,verifyDependencyLock} from '../scripts/dependency-lock-v65.mjs';

const fakeIntegrity='sha512-'+Buffer.from('synthetic-only-package-checksum').toString('base64');
function make(){
 const packageJSON={name:'content-studio',version:'0.65.0',packageManager:'npm@10.9.2',
  dependencies:{'my-lib':'^1.2.0'},devDependencies:{'dev-lib':'~3.2.0'}};
 const lock={name:'content-studio',version:'0.65.0',lockfileVersion:3,requires:true,
  packages:{'':{name:'content-studio',version:'0.65.0',dependencies:{'my-lib':'^1.2.0'},
   devDependencies:{'dev-lib':'~3.2.0'}},
   'node_modules/my-lib':{version:'1.2.3',resolved:'https://registry.npmjs.org/my-lib/-/my-lib-1.2.3.tgz',integrity:fakeIntegrity},
   'node_modules/dev-lib':{version:'3.2.1',resolved:'https://registry.npmjs.org/dev-lib/-/dev-lib-3.2.1.tgz',integrity:fakeIntegrity}
  }};
 return {packageJSON,lock};
}
const check=(m,l)=>examineDependencyLock(JSON.stringify(m),JSON.stringify(l));
test('V65 checks authentic repository npm v3 lock with pinned transitive integrity',()=>{
 const r=verifyDependencyLock();
 assert.equal(r.lockfileVersion,3);
 assert.equal(r.packageManager,'npm@10.9.2');
 assert.ok(r.dependencyPackages>=5);
 assert.match(r.lockSha256,/^[a-f0-9]{64}$/);
 assert.equal(r.verifiedInstall,false);
 assert.equal(r.independentlySigned,false);
 assert.equal(r.productionReady,false);
});
test('V65 accepts an exact consistent synthetic lock and never includes secrets',()=>{
 const {packageJSON,lock}=make(),r=check(packageJSON,lock);
 assert.equal(r.dependencyPackages,2);
 assert.equal(JSON.stringify(r).includes(fakeIntegrity),false);
 assert.equal(r.mergeAuthorized,false);
});
test('V65 rejects changed top-level dependency without a lock refresh',()=>{
 const {packageJSON,lock}=make();
 packageJSON.dependencies['my-lib']='^1.3.0';
 assert.throws(()=>check(packageJSON,lock),/dependency specs differ/);
});
test('V65 rejects added or missing direct dependencies',()=>{
 const {packageJSON,lock}=make();
 packageJSON.dependencies['new']='^1.0.0';
 assert.throws(()=>check(packageJSON,lock),/dependency specs differ/);
});
test('V65 rejects tampered integrity and missing integrity',()=>{
 const {packageJSON,lock}=make();
 lock.packages['node_modules/my-lib'].integrity='sha512-#bad#';
 assert.throws(()=>check(packageJSON,lock),/integrity/);
 delete lock.packages['node_modules/my-lib'].integrity;
 assert.throws(()=>check(packageJSON,lock),/integrity/);
});
test('V65 rejects Git, HTTP and local file resolved dependency sources',()=>{
 for(const resolved of ['http://registry.npmjs.org/my-lib','file:../local','git+https://github.com/X/Y',
  'https://malicious.example/download.tar.gz']){
  const {packageJSON,lock}=make();
  lock.packages['node_modules/my-lib'].resolved=resolved;
  assert.throws(()=>check(packageJSON,lock),/resolution/);
 }
});
test('V65 rejects links, malformed versions and unsafe package paths',()=>{
 const f=make();f.lock.packages['node_modules/my-lib'].link=true;
 assert.throws(()=>check(f.packageJSON,f.lock),/resolution/);
 delete f.lock.packages['node_modules/my-lib'].link;
 f.lock.packages['node_modules/my-lib'].version='latest';
 assert.throws(()=>check(f.packageJSON,f.lock),/resolution/);
 const x=make();
 x.lock.packages['../node_modules/escape']={...x.lock.packages['node_modules/my-lib']};
 assert.throws(()=>check(x.packageJSON,x.lock),/resolution/);
});
test('V65 rejects mismatched npm root version, package manager or schema',()=>{
 const f=make();
 f.lock.packages[''].version='0.64.0';
 assert.throws(()=>check(f.packageJSON,f.lock),/identity/);
 const b=make();b.packageJSON.packageManager='npm@9.0.0';
 assert.throws(()=>check(b.packageJSON,b.lock),/identity/);
 const c=make();c.lock.lockfileVersion=2;
 assert.throws(()=>check(c.packageJSON,c.lock),/identity/);
});
test('V65 detects a changed locked archive SHA without leaking the archive URL',()=>{
 const a=make(),original=check(a.packageJSON,a.lock).lockSha256;
 a.lock.packages['node_modules/dev-lib'].integrity='sha512-'+Buffer.from('changed').toString('base64');
 assert.notEqual(check(a.packageJSON,a.lock).lockSha256,original);
});
test('V65 requires both real regular local files and refuses symlinked lock',t=>{
 const cwd=mkdtempSync(join(tmpdir(),'studio-lock-v65-'));
 t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 const f=make();
 writeFileSync(join(cwd,'package.json'),JSON.stringify(f.packageJSON));
 assert.throws(()=>verifyDependencyLock({cwd}),/ENOENT/);
 writeFileSync(join(cwd,'package-lock.json'),JSON.stringify(f.lock));
 assert.equal(verifyDependencyLock({cwd}).dependencyPackages,2);
});

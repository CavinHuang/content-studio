import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,symlinkSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sealBuild,verifyBuildReceipt,parseRuntimeProbeArgs,probeServingBuild} from '../scripts/build-provenance-v64.mjs';

const sha='a'.repeat(40),other='b'.repeat(40);
function fixture(t){
 const cwd=mkdtempSync(join(tmpdir(),'studio-build-v64-'));
 t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 const base=join(cwd,'.next');
 mkdirSync(join(base,'server'),{recursive:true});
 mkdirSync(join(base,'static'),{recursive:true});
 writeFileSync(join(base,'BUILD_ID'),'v64-test-build\n');
 writeFileSync(join(base,'server','main.js'),'console.log("built app");\n');
 writeFileSync(join(base,'static','bundle.js'),'window.__app = 1;\n');
 const packageJSON={name:'content-studio',version:'0.65.0',packageManager:'npm@10.9.2',
  dependencies:{'test-lib':'^1.0.0'}};
 const lock={name:'content-studio',version:'0.65.0',lockfileVersion:3,requires:true,
  packages:{'':{name:'content-studio',version:'0.65.0',dependencies:{'test-lib':'^1.0.0'}},
   'node_modules/test-lib':{version:'1.0.1',
    resolved:'https://registry.npmjs.org/test-lib/-/test-lib-1.0.1.tgz',
    integrity:'sha512-'+Buffer.from('v65-synthetic-integrity').toString('base64')}}};
 writeFileSync(join(cwd,'package.json'),JSON.stringify(packageJSON));
 writeFileSync(join(cwd,'package-lock.json'),JSON.stringify(lock));
 return {cwd,base};
}
const noSecrets=output=>{
 for(const forbidden of ['super-private', '/private/studio', 'db-secret'])
  assert.equal(JSON.stringify(output).includes(forbidden),false);
};
test('V64 seals genuine Next-shaped files against a pinned Git SHA',t=>{
 const f=fixture(t),receipt=sealBuild(f.cwd,{sha});
 assert.equal(receipt.candidateCommit,sha);
 assert.equal(receipt.fileCount,3);
 assert.equal(verifyBuildReceipt({cwd:f.cwd,expectedSha:sha}).integrityVerified,true);
 assert.equal(verifyBuildReceipt({cwd:f.cwd,expectedSha:sha}).signedByTrustedBuilder,false);
 noSecrets(receipt);
});
test('V64 refuses wrong SHA even if build bytes are intact',t=>{
 const f=fixture(t);sealBuild(f.cwd,{sha});
 assert.throws(()=>verifyBuildReceipt({cwd:f.cwd,expectedSha:other}),/does not match pinned/);
});
test('V64 refuses changed server bundle bytes after sealing',t=>{
 const f=fixture(t);sealBuild(f.cwd,{sha});
 writeFileSync(join(f.base,'server','main.js'),'TAMPERED\n');
 assert.throws(()=>verifyBuildReceipt({cwd:f.cwd,expectedSha:sha}),/differs from its receipt/);
});
test('V64 refuses an added or deleted bundle after sealing',t=>{
 const f=fixture(t);sealBuild(f.cwd,{sha});
 writeFileSync(join(f.base,'server','new.js'),'ADDED');
 assert.throws(()=>verifyBuildReceipt({cwd:f.cwd,expectedSha:sha}),/differs/);
 unlinkSync(join(f.base,'server','new.js'));
 unlinkSync(join(f.base,'static','bundle.js'));
 assert.throws(()=>verifyBuildReceipt({cwd:f.cwd,expectedSha:sha}),/missing expected output|differs/);
});
test('V64 changing a Next cache file or trace does not invalidate build receipts',t=>{
 const f=fixture(t);
 mkdirSync(join(f.base,'cache'),{recursive:true});
 writeFileSync(join(f.base,'cache','fetch.json'),'before');
 sealBuild(f.cwd,{sha});
 writeFileSync(join(f.base,'cache','fetch.json'),'after');
 writeFileSync(join(f.base,'trace'),'traced');
 assert.equal(verifyBuildReceipt({cwd:f.cwd,expectedSha:sha}).integrityVerified,true);
});
test('V64 treats Next 16 APP_PAGE route-cache as mutable while server JS remains sealed',t=>{
 const f=fixture(t);
 const cache=join(f.base,'server','route-cache','APP_PAGE','abc');
 mkdirSync(cache,{recursive:true});
 writeFileSync(join(cache,'page.rsc'),'rendered');
 sealBuild(f.cwd,{sha});
 writeFileSync(join(cache,'page.rsc'),'updated on normal request');
 writeFileSync(join(cache,'page.html'),'new runtime cache');
 assert.equal(verifyBuildReceipt({cwd:f.cwd,expectedSha:sha}).integrityVerified,true);
 writeFileSync(join(f.base,'server','main.js'),'EXECUTABLE_CHANGED');
 assert.throws(()=>verifyBuildReceipt({cwd:f.cwd,expectedSha:sha}),/differs/);
});
test('V64 rejects symlinks into outside build tree',t=>{
 const f=fixture(t),outside=join(f.cwd,'outside-secret');
 writeFileSync(outside,'super-private');
 symlinkSync(outside,join(f.base,'server','unsafe.js'));
 assert.throws(()=>sealBuild(f.cwd,{sha}),/symbolic link/);
});
test('V64 rejects missing, malformed or tampered receipt',t=>{
 const f=fixture(t),path=join(f.base,'content-studio-v64-build-receipt.json');
 assert.throws(()=>verifyBuildReceipt({cwd:f.cwd,expectedSha:sha}));
 sealBuild(f.cwd,{sha});
 const report=JSON.parse(readFileSync(path,'utf8'));
 report.artifactDigestSha256='f'.repeat(64);
 writeFileSync(path,JSON.stringify(report));
 assert.throws(()=>verifyBuildReceipt({cwd:f.cwd,expectedSha:sha}),/differs/);
});
test('V64 runtime probe parses only exact numeric loopback URL',()=>{
 const arg=['--sha='+sha,'--url=http://127.0.0.1:4312/'];
 assert.deepEqual(parseRuntimeProbeArgs(arg),{sha,url:'http://127.0.0.1:4312'});
 for(const value of ['http://example.org:4312','https://127.0.0.1:4312',
  'http://localhost:4312','http://127.0.0.1:4312/?x=1',
  'http://127.0.0.1:4312@evil.example:3333/','http://127.0.0.1:88/'])
  assert.throws(()=>parseRuntimeProbeArgs(['--sha='+sha,'--url='+value]));
});
const response=(marker,ok=true)=>({ok,json:async()=>({ok:true,framework:'nextjs',mode:'local-only',runtimeBuild:marker})});
test('V64 matches local file receipt to actual health response declaration',async t=>{
 const f=fixture(t),receipt=sealBuild(f.cwd,{sha}),stamp={candidateCommit:sha,
  artifactDigestSha256:receipt.artifactDigestSha256,
  dependencyLockSha256:receipt.dependencyLockSha256,
  buildId:receipt.buildId,runNonce:'1'.repeat(32),pid:12345};
 const report=await probeServingBuild({sha,url:'http://127.0.0.1:4312'},{
  cwd:f.cwd,checkout:()=>true,head:()=>sha,request:async()=>response(stamp)});
 assert.equal(report.servingProcessDeclarationMatchesBuild,true);
 assert.equal(report.independentProcessBinaryAttestation,false);
 assert.equal(report.mergeAuthorized,false);
 noSecrets(report);
});
test('V64 blocks forged process SHA, digest, nonce and HTTP error',async t=>{
 const f=fixture(t),receipt=sealBuild(f.cwd,{sha}),base={
  candidateCommit:sha,artifactDigestSha256:receipt.artifactDigestSha256,
  dependencyLockSha256:receipt.dependencyLockSha256,
  buildId:receipt.buildId,runNonce:'1'.repeat(32),pid:123};
 for(const change of [{candidateCommit:other},{artifactDigestSha256:'f'.repeat(64)},
  {runNonce:''},{pid:0},{dependencyLockSha256:'f'.repeat(64)}]){
  await assert.rejects(()=>probeServingBuild({sha,url:'http://127.0.0.1:4312'},{
   cwd:f.cwd,checkout:()=>{},head:()=>sha,request:async()=>response({...base,...change})}),
   /does not identify/);
 }
 await assert.rejects(()=>probeServingBuild({sha,url:'http://127.0.0.1:4312'},{
  cwd:f.cwd,checkout:()=>{},head:()=>sha,request:async()=>response(base,false)}),/not healthy/);
});
test('V65 altered transitive SRI after sealing cannot reuse old Next build receipt',t=>{
 const f=fixture(t),sealed=sealBuild(f.cwd,{sha});
 const path=join(f.cwd,'package-lock.json');
 const lock=JSON.parse(readFileSync(path,'utf8'));
 lock.packages['node_modules/test-lib'].integrity='sha512-'+Buffer.from('different').toString('base64');
 writeFileSync(path,JSON.stringify(lock));
 assert.throws(()=>verifyBuildReceipt({cwd:f.cwd,expectedSha:sha}),/dependency lock differs/);
 assert.match(sealed.dependencyLockSha256,/^[a-f0-9]{64}$/);
});
test('V64 refuses checkout mutation between request and reply',async t=>{
 const f=fixture(t),receipt=sealBuild(f.cwd,{sha}),base={
  candidateCommit:sha,artifactDigestSha256:receipt.artifactDigestSha256,
  dependencyLockSha256:receipt.dependencyLockSha256,
  buildId:receipt.buildId,runNonce:'1'.repeat(32),pid:123};
 let n=0;
 await assert.rejects(()=>probeServingBuild({sha,url:'http://127.0.0.1:4312'},{
  cwd:f.cwd,checkout:()=>{if(++n===2)throw Error('checkout moved')},
  head:()=>sha,request:async()=>response(base)}),/checkout moved/);
});

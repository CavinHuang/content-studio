import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,chmodSync,copyFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {auditCandidateOsBoundary,attestCandidateOsBoundary,sourceTag,
 verifyOperatorOsBoundary} from '../src/candidate-os-boundary-v69.mjs';
const nonce='a'.repeat(32),sourceDb='/private/prod.sqlite';
const good={kind:'content-studio-v69-candidate-os-boundary',
 nonRoot:true,processUid:21345,sourceAccessDenied:true,
 candidateFileOwnedByProcess:true,privateCandidateFile:true,
 protectedWalSidecarsChecked:true,checkedAtLauncher:true};
test('V69 source tag is path and nonce bound without exposing a literal DB path',()=>{
 const tag=sourceTag(sourceDb,nonce);
 assert.match(tag,/^[a-f0-9]{64}$/);
 assert.notEqual(tag,sourceTag(sourceDb,'b'.repeat(32)));
 assert.notEqual(tag,sourceTag('/private/other.sqlite',nonce));
 assert.ok(!tag.includes(sourceDb));
});
test('V69 operator verifies source file owner UID and owner-only mode',()=>{
 const att=attestCandidateOsBoundary(good,{sourceDb,runNonce:nonce});
 const stat=(uid,mode=0o100600)=>()=>({isFile:()=>true,uid,mode});
 assert.equal(verifyOperatorOsBoundary({sourceDb,observed:att,runNonce:nonce,stat:stat(20001)}).candidateOsBoundaryVerified,true);
 assert.throws(()=>verifyOperatorOsBoundary({sourceDb,observed:att,runNonce:nonce,stat:stat(21345)}),/insufficient/);
 assert.throws(()=>verifyOperatorOsBoundary({sourceDb,observed:att,runNonce:nonce,stat:stat(20001,0o100644)}),/insufficient/);
});
test('V69 operator fails when source identity differs or evidence is missing',()=>{
 const att=attestCandidateOsBoundary(good,{sourceDb,runNonce:nonce});
 for(const bad of [{sourceDb:'/private/other.sqlite'},
  {observed:{...att,sourceAccessDenied:false}},
  {observed:{...att,processUid:0}}]){
  assert.throws(()=>verifyOperatorOsBoundary({
   sourceDb,observed:att,runNonce:nonce,
   stat:()=>({isFile:()=>true,uid:20001,mode:0o100600}),...bad}));
 }
});
test('V69 refuses root UID or relative candidate DB',()=>{
 assert.throws(()=>auditCandidateOsBoundary({sourceDb,candidateDb:'/safe/candidate.sqlite',
  uid:0}),/non-root/);
 assert.throws(()=>auditCandidateOsBoundary({sourceDb,candidateDb:'relative.sqlite',
  uid:12345}),/absolute/);
});
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'v69-synthetic-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const source=join(root,'source.sqlite'),candidate=join(root,'candidate.sqlite');
 writeFileSync(source,'SYNTHETIC',{mode:0o600});
 writeFileSync(candidate,'SYNTHETIC',{mode:0o600});
 chmodSync(candidate,0o600);
 return {root,source,candidate};
}
test('V69 synthetic candidate real owned file accepts read denial and rejects readable source',t=>{
 const f=fixture(t),uid=process.getuid?.();
 if(!Number.isInteger(uid)||uid===0)return t.skip('requires non-root current UID');
 const opts={sourceDb:f.source,candidateDb:f.candidate,uid};
 assert.equal(auditCandidateOsBoundary({...opts,read:()=>true}).sourceAccessDenied,true);
 assert.throws(()=>auditCandidateOsBoundary(opts),/can access operator source/);
});
test('V69 refuses readable WAL sidecar and nonexistent main source',t=>{
 const f=fixture(t),uid=process.getuid?.();
 if(!Number.isInteger(uid)||uid===0)return t.skip('requires non-root current UID');
 assert.throws(()=>auditCandidateOsBoundary({sourceDb:f.source,candidateDb:f.candidate,uid,
  read:path=>path.endsWith('-wal')?false:true}),/can access/);
 assert.throws(()=>auditCandidateOsBoundary({sourceDb:f.source,candidateDb:f.candidate,uid,
  read:()=>{const e=Error('absent');e.code='ENOENT';throw e}}),/could not be confirmed/);
});
test('V69 genuine separate Linux UID cannot open operator private SQLite, no source read',t=>{
 if(process.platform!=='linux')return t.skip('Linux POSIX only');
 const probe=spawnSync('sudo',['-n','-u','nobody','id','-u'],{encoding:'utf8'});
 if(probe.status!==0){
  if(process.env.CI==='true')assert.fail('CI must provide separate nobody UID and noninteractive sudo');
  return t.skip('sudo -u nobody unavailable');
 }
 const uid=Number(probe.stdout.trim());
 assert.ok(uid>0);
 const root=mkdtempSync(join(tmpdir(),'v69-real-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 chmodSync(root,0o755);
 const privateDir=join(root,'source-private');
 mkdirSync(privateDir,{mode:0o700});chmodSync(privateDir,0o700);
 const source=join(privateDir,'source.sqlite');
 writeFileSync(source,'SYNTHETIC SOURCE, NEVER READ',{mode:0o600});
 const candidate=join(root,'candidate.sqlite');
 writeFileSync(candidate,'SYNTHETIC CANDIDATE',{mode:0o600});
 assert.equal(spawnSync('sudo',['-n','chown',String(uid),candidate]).status,0);
 // The CI checkout parent directory is deliberately not traversable by
 // other UIDs. Expose ONLY the synthetic test module in our temp fixture.
 const shared=join(root,'candidate-os-boundary-v69.mjs');
 copyFileSync(new URL('../src/candidate-os-boundary-v69.mjs',import.meta.url),shared);
 chmodSync(shared,0o644);
 const lib=pathToFileURL(shared).href;
 const js='import {auditCandidateOsBoundary} from '+JSON.stringify(lib)+'; '+
  'const r=auditCandidateOsBoundary({sourceDb:process.argv[1],candidateDb:process.argv[2]});'+
  'if(!r.sourceAccessDenied||r.processUid<=0)process.exit(19);';
 const result=spawnSync('sudo',['-n','-u','nobody',process.execPath,
  '--input-type=module','-e',js,source,candidate],{encoding:'utf8'});
 assert.equal(result.status,0,(result.stderr||'').slice(0,600));
});

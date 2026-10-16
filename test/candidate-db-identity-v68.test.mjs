import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,linkSync,symlinkSync,chmodSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {activeDatabaseIdentity,fileIdentityDigest,verifyCandidateIsolation}
 from '../src/candidate-db-identity-v68.mjs';

const nonce='e'.repeat(32);
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'cs-v68-db-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const sourceDb=join(root,'private-source.sqlite'),candidateDb=join(root,'candidate.sqlite'),
 backupDir=join(root,'backup'),scratchDir=join(root,'scratch');
 for(const dir of [backupDir,scratchDir]){mkdirSync(dir,{mode:0o700});chmodSync(dir,0o700)}
 const a=new DatabaseSync(sourceDb),b=new DatabaseSync(candidateDb);
 a.exec('CREATE TABLE secrets(id INTEGER PRIMARY KEY, content TEXT)');
 a.prepare('INSERT INTO secrets(content) VALUES(?)').run('NEVER_LEAK');
 b.exec('CREATE TABLE fixture(id INTEGER PRIMARY KEY, content TEXT)');
 b.prepare('INSERT INTO fixture(content) VALUES(?)').run('SYNTHETIC');
 a.close();b.close();
 return {root,sourceDb,candidateDb,backupDir,scratchDir};
}
function args(f,extra={}){return {...f,observedIdentity:fileIdentityDigest(f.candidateDb,nonce),runNonce:nonce,...extra}}
test('V68 genuine SQLite connection-derived identity matches its own disk file',t=>{
 const f=fixture(t),db=new DatabaseSync(f.candidateDb);
 t.after(()=>db.close());
 const digest=activeDatabaseIdentity({store:{db}},nonce);
 assert.equal(digest,fileIdentityDigest(f.candidateDb,nonce));
 assert.match(digest,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(digest).includes(f.candidateDb),false);
});
test('V68 distinguishes two SQLite files even when their exact bytes match',t=>{
 const f=fixture(t),a=fileIdentityDigest(f.sourceDb,nonce);
 copyFileSync(f.sourceDb,f.candidateDb);
 const b=fileIdentityDigest(f.candidateDb,nonce);
 assert.notEqual(a,b);
});
test('V68 accepts explicitly distinct candidate file and omits private metadata',t=>{
 const f=fixture(t),out=verifyCandidateIsolation(args(f));
 assert.equal(out.candidateIsolated,true);
 assert.equal(out.sourceDatabaseDistinct,true);
 assert.equal(out.productionReady,false);
 for(const path of [f.root,f.sourceDb,f.candidateDb])
  assert.equal(JSON.stringify(out).includes(path),false);
});
test('V68 rejects candidate equal to original live SQLite source',t=>{
 const f=fixture(t);
 assert.throws(()=>verifyCandidateIsolation(args(f,{candidateDb:f.sourceDb,
  observedIdentity:fileIdentityDigest(f.sourceDb,nonce)})),/aliases/);
});
test('V68 rejects hardlink alias of source DB even when paths differ',t=>{
 const f=fixture(t),alias=join(f.root,'hardlink.sqlite');
 linkSync(f.sourceDb,alias);
 assert.throws(()=>verifyCandidateIsolation(args(f,{candidateDb:alias,
  observedIdentity:fileIdentityDigest(alias,nonce)})),/aliases/);
});
test('V68 rejects symlinked candidate SQLite',t=>{
 const f=fixture(t),link=join(f.root,'symlink.sqlite');
 symlinkSync(f.candidateDb,link);
 assert.throws(()=>verifyCandidateIsolation(args(f,{candidateDb:link})),/regular file/);
});
test('V68 detects fake process bound to unrelated SQLite file',t=>{
 const f=fixture(t);
 assert.throws(()=>verifyCandidateIsolation(args(f,{observedIdentity:fileIdentityDigest(f.sourceDb,nonce)})),/does not use/);
});
test('V68 rejects candidate database stored inside private backup/scratch',t=>{
 const f=fixture(t);
 for(const dir of [f.backupDir,f.scratchDir]){
  const file=join(dir,'candidate.sqlite');
  copyFileSync(f.candidateDb,file);
  assert.throws(()=>verifyCandidateIsolation(args(f,{candidateDb:file,
   observedIdentity:fileIdentityDigest(file,nonce)})),/recovery storage/);
 }
});
test('V68 refuses wrong nonce, absent identity and relative paths',t=>{
 const f=fixture(t);
 for(const bad of [{runNonce:'not-nonce'},{observedIdentity:null},
  {candidateDb:'relative.sqlite'},{sourceDb:'relative.sqlite'}])
  assert.throws(()=>verifyCandidateIsolation(args(f,bad)));
});
test('V68 does not identify memory-only DB as a persistent candidate',t=>{
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 assert.equal(activeDatabaseIdentity({store:{db}},nonce),null);
});
test('V68 stable SQLite inode survives WAL writes within same connection',t=>{
 const f=fixture(t),db=new DatabaseSync(f.candidateDb);
 t.after(()=>db.close());
 const a=activeDatabaseIdentity({store:{db}},nonce);
 db.exec('PRAGMA journal_mode=WAL');
 db.prepare('INSERT INTO fixture(content) VALUES(?)').run('later');
 assert.equal(activeDatabaseIdentity({store:{db}},nonce),a);
});

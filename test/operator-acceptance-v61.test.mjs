import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,chmodSync,symlinkSync} from 'node:fs';
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCore} from '../lib/core.mjs';
import {createBackup,inspectDatabase} from '../scripts/db-safety.mjs';
import {collectReleaseEvidence} from '../scripts/operator-release-evidence-v55.mjs';
import {V59_TARGET,assessOperatorPacket,readOperatorPacket} from '../scripts/remote-release-evidence-v59.mjs';
import {parseAcceptanceArgs,requireLocalHead,verifyOperatorPaths,
 checkRemoteSnapshot,checkRollbackResult,runOperatorAcceptance
} from '../scripts/operator-acceptance-v61.mjs';

const sha='a'.repeat(40),privateText='V61_PRIVATE_SYNTHETIC_SENTINEL';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
const packet=()=>({kind:'content-studio-v55-operator-release-evidence',candidateCommit:sha,
 mainCommit:V59_TARGET.mainSha,packetComplete:true,localEvidenceComplete:true,blockers:[],
 local:{originalDatabaseUnchanged:true,backupContentMatchesDatabase:true,
  backupManifest:'passed',restoredUpgrade:'passed',restoredIntegration:'passed'},
 manualReview:{recorded:true},mergeAuthorized:false,deployAuthorized:false,productionReady:false});
const remote=(hasPacket=false)=>({
 candidateCommit:sha,githubCI:{githubCheckPassed:true,githubApiWasQueried:true,
  checks:{push:{runId:100},pull_request:{runId:101}}},
 technicalEvidenceComplete:hasPacket,operatorPacket:{recorded:hasPacket,independentlyVerified:false},
 releaseAuthorized:false,mergeAuthorized:false,deployAuthorized:false,productionReady:false});
const rollback=()=>({candidateCommit:sha,status:'passed',restoredToNewFile:true,
 deliberateFaultChangedDisposableCopy:true,sourceUnchanged:true,
 verifiedBackupUnchanged:true,rollbackRestoredHistoricalRows:true,
 rollbackApplicationOpened:true,scratchCopiesRemoved:true,
 mergeAuthorized:false,deployAuthorized:false,productionReady:false});
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'v61-operator-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const value={sha,root,db:join(root,'live.sqlite'),backup:join(root,'archive.sqlite'),
  review:join(root,'manual.json'),scratch:join(root,'private-scratch')};
 writeFileSync(value.db,'');writeFileSync(value.backup,'');
 writeFileSync(value.review,'{}');
 mkdirSync(value.scratch,{mode:0o700});chmodSync(value.scratch,0o700);
 return value;
}
const mock=()=>({assertHead:()=>true,remote:async opts=>remote(!!opts['operator-evidence']),
 local:async()=>packet(),rollback:async()=>rollback()});
const clean=async f=>assert.deepEqual(await readdir(f.scratch),[]);
test('V61 parses pinned SHA and local paths, rejects duplicate and relative inputs',()=>{
 assert.deepEqual(parseAcceptanceArgs(['--sha='+sha,'--db=/tmp/a','--backup=/tmp/b',
  '--review=/tmp/c','--scratch-dir=/tmp/d']),
  {sha,db:'/tmp/a',backup:'/tmp/b',review:'/tmp/c',scratch:'/tmp/d'});
 for(const args of [[],['--sha=HEAD'],['--sha='+sha,'--db=relative'],
  ['--sha='+sha,'--sha='+sha],['--sha='+sha,'--token=x']])
  assert.throws(()=>parseAcceptanceArgs(args));
 assert.throws(()=>requireLocalHead('f'.repeat(40)));
});
test('V61 runs GitHub before private local check and once more after rollback',async t=>{
 const f=fixture(t),calls=[];
 const result=await runOperatorAcceptance(f,{assertHead:()=>calls.push('head'),
  remote:async opts=>{
   const post=!!opts['operator-evidence'];
   calls.push(post?'final':'initial');
   if(post)assert.equal(readOperatorPacket(opts['operator-evidence']).candidateCommit,sha);
   return remote(post);
  },
  local:async()=>{calls.push('local');return packet()},
  rollback:async opts=>{calls.push('rollback');assert.equal(readOperatorPacket(opts.evidence).candidateCommit,sha);return rollback()}
 });
 assert.deepEqual(calls,['head','initial','local','head','rollback','head','final','head']);
 assert.equal(result.reviewReady,true);
 assert.equal(result.mergeAuthorized,false);
 assert.equal(result.deployAuthorized,false);
 assert.equal(result.externalHostingIndependentlyVerified,false);
 assert.deepEqual(result.ciRuns,{push:100,pullRequest:101});
 for(const value of [f.db,f.backup,f.review,f.scratch,privateText])
  assert.ok(!JSON.stringify(result).includes(value));
 await clean(f);
});
test('V61 rejects red initial CI before looking at the local private database',async t=>{
 const f=fixture(t);let called=false;
 await assert.rejects(()=>runOperatorAcceptance(f,{...mock(),
  remote:async()=>({...remote(),githubCI:{githubCheckPassed:false,githubApiWasQueried:true}}),
  local:async()=>{called=true;return packet();}}),/GitHub CI/);
 assert.equal(called,false);await clean(f);
});
test('V61 rejects wrong local packet SHA before rollback',async t=>{
 const f=fixture(t);let called=false;
 await assert.rejects(()=>runOperatorAcceptance(f,{...mock(),
  local:async()=>({...packet(),candidateCommit:'b'.repeat(40)}),
  rollback:async()=>{called=true;return rollback();}}),/V55 local/);
 assert.equal(called,false);await clean(f);
});
test('V61 refuses a claimed successful rollback with mutated source and cleans temp',async t=>{
 const f=fixture(t);
 await assert.rejects(()=>runOperatorAcceptance(f,{...mock(),
  rollback:async()=>({...rollback(),sourceUnchanged:false})}),/Rollback rehearsal/);
 await clean(f);
});
test('V61 rejects failed final CI after rollback and cleans temp',async t=>{
 const f=fixture(t);
 await assert.rejects(()=>runOperatorAcceptance(f,{...mock(),
  remote:async opts=>opts['operator-evidence']
   ? {...remote(true),technicalEvidenceComplete:false}:remote(false)}),/packet mismatch/);
 await clean(f);
});
test('V61 detects local checkout moving between expensive stages',async t=>{
 const f=fixture(t);let n=0;
 await assert.rejects(()=>runOperatorAcceptance(f,{...mock(),
  assertHead:()=>{if(++n===3)throw Error('changed checkout')}}),/changed checkout/);
 await clean(f);
});
test('V61 rejects symbolic links and insecure shared scratch directory',async t=>{
 const f=fixture(t),link=join(f.root,'db-link');
 symlinkSync(f.db,link);
 await assert.rejects(()=>verifyOperatorPaths({...f,db:link}),/Unsafe local evidence/);
 const scratchLink=join(f.root,'scratch-link');
 symlinkSync(f.scratch,scratchLink);
 await assert.rejects(()=>verifyOperatorPaths({...f,scratch:scratchLink}),/real directory/);
 if(process.platform!=='win32'){
  chmodSync(f.scratch,0o755);
  await assert.rejects(()=>verifyOperatorPaths(f),/private/);
 }
});
test('V61 uses real WAL SQLite, real V55 evidence and real V60 fault-rollback in sequence',
 {timeout:150000},async t=>{
 const f=fixture(t); f.backup=join(f.root,'fresh-snapshot.sqlite');
 const core=createCore(f.db);
 t.after(()=>core.close());
 const article=core.editorial.create({title:privateText,paragraphs:[{text:privateText}]});
 const asset=core.assets.upload({name:'synthetic.png',alt:'one pixel',base64:png});
 core.assets.setMapping(asset.id,'wechat',{url:'https://cdn.example.org/v61.png',
  note:'V61 synthetic manual mapping fixture'});
 core.store.db.exec('PRAGMA wal_autocheckpoint=0');
 await createBackup(f.db,{outputPath:f.backup});
 const before=await inspectDatabase(f.db,{includeContentDigest:true});
 writeFileSync(f.review,JSON.stringify({schemaVersion:'content-studio-v55-manual-review',
  candidateCommit:sha,deploymentMode:'deployment-paused',operatorRole:'synthetic-operator',
  hostingInventoryReference:'synthetic-inventory-v61',rollbackReference:'synthetic-rollback-v61',
  backupLocationProtected:true,rollbackInstructionsReviewed:true}));
 const result=await runOperatorAcceptance(f,{assertHead:()=>true,
  remote:async opts=>{
   if(opts['operator-evidence'])
    assert.equal(assessOperatorPacket(readOperatorPacket(opts['operator-evidence']),sha).localOperatorEvidenceRecorded,true);
   return remote(!!opts['operator-evidence']);
  },
  local:opts=>collectReleaseEvidence(opts,{gitAudit:()=>({technicalHistoryValid:true,
   mode:'premerge-candidate',checkedHead:sha,checkedMain:V59_TARGET.mainSha})})
 });
 assert.equal(result.reviewReady,true);
 assert.equal(result.stages.isolatedV60Rollback,'passed');
 assert.equal(core.editorial.get(article.id).title,privateText);
 assert.equal(core.assets.get(asset.id).mime,'image/png');
 assert.equal((await inspectDatabase(f.db,{includeContentDigest:true})).contentSha256,before.contentSha256);
 await clean(f);
 assert.ok(!JSON.stringify(result).includes(privateText));
});
test('V61 refuses inconsistent remote and rollback authorization claims',()=>{
 assert.throws(()=>checkRemoteSnapshot({...remote(),deployAuthorized:true},sha));
 assert.throws(()=>checkRemoteSnapshot({...remote(true),operatorPacket:{recorded:true,independentlyVerified:true}},sha,{mustIncludePacket:true}));
 assert.throws(()=>checkRollbackResult({...rollback(),scratchCopiesRemoved:false},sha));
});

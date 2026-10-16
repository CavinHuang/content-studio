import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyCleanCheckout,parseCheckoutArgs} from '../scripts/checkout-integrity-v63.mjs';

function git(cwd,...args){
 const p=spawnSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']});
 assert.equal(p.status,0,'Synthetic Git command failed');return p.stdout.trim();
}
function fixture(t){
 const cwd=mkdtempSync(join(tmpdir(),'content-studio-v63-'));
 t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 git(cwd,'init','-q');
 writeFileSync(join(cwd,'.gitignore'),'data/\n');
 writeFileSync(join(cwd,'release.mjs'),'export const value = 1;\n');
 git(cwd,'add','.gitignore','release.mjs');
 git(cwd,'-c','user.email=ci@example.invalid','-c','user.name=CI',
  'commit','-q','-m','synthetic baseline');
 const sha=git(cwd,'rev-parse','HEAD');
 assert.match(sha,/^[a-f0-9]{40}$/);
 return {cwd,sha};
}
test('V63 accepts a clean real Git checkout at exact commit; ignored data does not leak',t=>{
 const f=fixture(t);
 mkdirSync(join(f.cwd,'data'));
 writeFileSync(join(f.cwd,'data','local.sqlite'),'synthetic-only');
 const result=verifyCleanCheckout(f.sha,{cwd:f.cwd});
 assert.equal(result.cleanTrackedFiles,true);
 assert.equal(result.noHiddenIndexFlags,true);
 assert.equal(result.ignoredPathsNotInspected,true);
 assert.equal(result.mergeAuthorized,false);
 assert.equal(result.deployAuthorized,false);
 assert.equal(result.productionReady,false);
 assert.ok(!JSON.stringify(result).includes(f.cwd));
});
test('V63 refuses modified tracked executable with the SAME HEAD sha',t=>{
 const f=fixture(t);writeFileSync(join(f.cwd,'release.mjs'),'export const value=999;\n');
 assert.throws(()=>verifyCleanCheckout(f.sha,{cwd:f.cwd}),/uncommitted or untracked/);
});
test('V63 refuses staged changes at the SAME HEAD sha',t=>{
 const f=fixture(t);writeFileSync(join(f.cwd,'release.mjs'),'staged\n');
 git(f.cwd,'add','release.mjs');
 assert.throws(()=>verifyCleanCheckout(f.sha,{cwd:f.cwd}),/uncommitted or untracked/);
});
test('V63 refuses untracked executable and does not reveal its name',t=>{
 const f=fixture(t);writeFileSync(join(f.cwd,'PRIVATE_SECRET_NAME.mjs'),'test');
 assert.throws(()=>verifyCleanCheckout(f.sha,{cwd:f.cwd}),err=>
  !err.message.includes('PRIVATE_SECRET_NAME')&&/uncommitted or untracked/.test(err.message));
});
test('V63 refuses changed HEAD after a new commit',t=>{
 const f=fixture(t);writeFileSync(join(f.cwd,'release.mjs'),'updated\n');
 git(f.cwd,'add','release.mjs');
 git(f.cwd,'-c','user.email=ci@example.invalid','-c','user.name=CI','commit','-q','-m','changed');
 assert.throws(()=>verifyCleanCheckout(f.sha,{cwd:f.cwd}),/HEAD differs/);
});
test('V63 refuses assume-unchanged index trick hiding a modified file',t=>{
 const f=fixture(t);git(f.cwd,'update-index','--assume-unchanged','release.mjs');
 writeFileSync(join(f.cwd,'release.mjs'),'file changed although Git status may be clean\n');
 assert.throws(()=>verifyCleanCheckout(f.sha,{cwd:f.cwd}),/index flags/);
});
test('V63 refuses skip-worktree index trick hiding a modified file',t=>{
 const f=fixture(t);git(f.cwd,'update-index','--skip-worktree','release.mjs');
 writeFileSync(join(f.cwd,'release.mjs'),'hidden edit\n');
 assert.throws(()=>verifyCleanCheckout(f.sha,{cwd:f.cwd}),/index flags/);
});
test('V63 refuses git checkout invoked from subdirectory',t=>{
 const f=fixture(t);const child=join(f.cwd,'nested');mkdirSync(child);
 assert.throws(()=>verifyCleanCheckout(f.sha,{cwd:child}),/worktree root/);
});
test('V63 does not trust GIT_INDEX_FILE or GIT_DIR environment overrides',t=>{
 const f=fixture(t);
 const original={index:process.env.GIT_INDEX_FILE,dir:process.env.GIT_DIR};
 t.after(()=>{
  if(original.index===undefined)delete process.env.GIT_INDEX_FILE;
  else process.env.GIT_INDEX_FILE=original.index;
  if(original.dir===undefined)delete process.env.GIT_DIR;
  else process.env.GIT_DIR=original.dir;
 });
 process.env.GIT_INDEX_FILE=join(f.cwd,'missing-invalid-index');
 process.env.GIT_DIR=join(f.cwd,'nonexistent-other-git');
 assert.equal(verifyCleanCheckout(f.sha,{cwd:f.cwd}).noUntrackedFiles,true);
});
test('V63 CLI refuses missing/uppercase/duplicate SHA values',()=>{
 const sha='a'.repeat(40);
 assert.equal(parseCheckoutArgs(['--sha='+sha]),sha);
 for(const args of [[],['--sha=HEAD'],['--sha='+sha,'--sha='+sha],
  ['--sha='+sha.toUpperCase()],['--token=private']])
  assert.throws(()=>parseCheckoutArgs(args));
});

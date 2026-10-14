import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCore} from '../lib/core.mjs';
import {rehearseUpgrade} from '../scripts/db-safety.mjs';
import {CANONICAL_BRANCHES,ALTERNATIVE_V37,inspectBranchChain} from '../scripts/verify-stack.mjs';

const fakePng='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'v46-release-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const db=join(dir,'legacy.sqlite'),core=createCore(db);
 const p=core.editorial.create({title:'V46 模拟既有文章',paragraphs:[
  {text:'正文必须在升级时逐字保留，包括独立段落的文字和证据关系。'},
  {text:'图片的二进制内容也不能在不改变数据库行数时被替换。'}
 ]});
 const asset=core.assets.upload({name:'image.png',alt:'人工批准的素材',base64:fakePng});
 core.assets.setMapping(asset.id,'wechat',{url:'https://cdn.example.org/v46-image.png',note:'作者已实际上传并登记图片 URL'});
 core.close();
 return {db,p,asset};
}
test('V46 upgrade rehearsal compares original text and image bytes, not only counts',async t=>{
 const {db}=fixture(t);
 const ok=await rehearseUpgrade(db,{openWithCore:createCore});
 assert.equal(ok.verified,true);
 assert.equal(ok.upgradeOpenedSuccessfully,true);
 assert.equal(ok.sourceUntouched,true);
 assert.equal(ok.temporaryCopiesDeleted,true);
});
test('V46 rejects old article being silently rewritten when row count stays identical',async t=>{
 const {db}=fixture(t);
 await assert.rejects(()=>rehearseUpgrade(db,{openWithCore:path=>{
  const core=createCore(path);
  core.store.db.prepare('UPDATE article_document_revisions SET paragraphs_json=? WHERE rowid=(SELECT MIN(rowid) FROM article_document_revisions)')
   .run('[{"id":"forged","text":"REWRITTEN WITHOUT REVISION"}]');
  return core;
 }}),/Upgrade altered historical content for table article_document_revisions/);
 const core=createCore(db);
 try{
  const original=core.store.db.prepare('SELECT paragraphs_json FROM article_document_revisions ORDER BY rowid LIMIT 1').get();
  assert.doesNotMatch(original.paragraphs_json,/REWRITTEN WITHOUT REVISION/);
 }finally{core.close()}
});
test('V46 rejects same-sized replacement image BLOB without losing any rows',async t=>{
 const {db,asset}=fixture(t);
 await assert.rejects(()=>rehearseUpgrade(db,{openWithCore:path=>{
  const core=createCore(path);
  const raw=core.store.db.prepare('SELECT body FROM content_assets WHERE id=?').get(asset.id).body;
  const forged=Buffer.from(raw);forged[forged.length-4]^=0x01;
  core.store.db.prepare('UPDATE content_assets SET body=? WHERE id=?').run(forged,asset.id);
  return core;
 }}),/Upgrade altered historical content for table content_assets/);
});
test('V46 lets new default source IDs be registered, not existing source rows rewritten',async t=>{
 const {db}=fixture(t);
 const core=createCore(db);
 core.store.db.prepare('INSERT OR IGNORE INTO source_state(id,status) VALUES(?,?)').run('historical-signal','success');
 core.close();
 await assert.rejects(()=>rehearseUpgrade(db,{openWithCore:path=>{
  const opened=createCore(path);
  opened.store.db.prepare('UPDATE source_state SET status=? WHERE id=?').run('failed','historical-signal');
  return opened;
 }}),/Upgrade modified historical source historical-signal/);
});
test('V46 canonical PR lineage refuses alternative V37 and detects drift',()=>{
 const refs=new Set(CANONICAL_BRANCHES.map(name=>'refs/remotes/origin/'+name));
 refs.add('refs/remotes/origin/'+ALTERNATIVE_V37);
 const parents=new Map(CANONICAL_BRANCHES.slice(1).map((name,i)=>[
  'refs/remotes/origin/'+name,'refs/remotes/origin/'+CANONICAL_BRANCHES[i]
 ]));
 const isAncestor=(parent,child)=>{
  if(child==='HEAD')return parent==='refs/remotes/origin/main'||parent==='refs/remotes/origin/'+CANONICAL_BRANCHES.at(-1);
  return parents.get(child)===parent;
 };
 const valid=inspectBranchChain({
  hasRef:ref=>refs.has(ref),
  isAncestor,
  hasAlternative:ref=>refs.has(ref)
 });
 assert.equal(valid.verified,true,JSON.stringify(valid.problems));
 assert.equal(valid.canonicalBranches,20);
 assert.equal(valid.mergedToMain,false);
 assert.equal(valid.alternativeV37.present,true);
 assert.equal(valid.alternativeV37.canonical,false);
 parents.set('refs/remotes/origin/feat/v38-image-request-budgets','refs/remotes/origin/'+ALTERNATIVE_V37);
 const invalid=inspectBranchChain({hasRef:ref=>refs.has(ref),isAncestor,hasAlternative:ref=>refs.has(ref)});
 assert.equal(invalid.verified,false);
 assert.ok(invalid.problems.includes('unexpected_branch_ancestry:feat/v38-image-request-budgets'));
 refs.delete('refs/remotes/origin/feat/v35-reference-image-editing');
 const missing=inspectBranchChain({hasRef:ref=>refs.has(ref),isAncestor,hasAlternative:()=>true});
 assert.equal(missing.verified,false);
 assert.ok(missing.problems.includes('missing_remote_ref:feat/v35-reference-image-editing'));
});

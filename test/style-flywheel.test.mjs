import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';

function setup(t){const root=mkdtempSync(join(tmpdir(),'studio-flywheel-test-')),path=join(root,'studio.sqlite');const core=createCore(path);t.after(()=>{core.close();rmSync(root,{recursive:true,force:true})});return core}

function insertRejected(db,id,avoid){
  db.prepare("INSERT INTO creator_style_suggestions(id,data_json,evidence_json,status,created_at) VALUES(?,?,?,?,?)")
    .run(id,JSON.stringify({tone:'',structure:'',avoid,length:''}),'[]','rejected','2026-10-21T00:00:0'+id.slice(-1)+'Z');
}

test('flywheel proposes a rule only after two rejections of the same avoid direction',t=>{
  const core=setup(t),db=core.store.db;
  insertRejected(db,'st_a','避免堆砌排比与空泛总结');
  assert.equal(core.creator.styleFlywheel().candidates.length,0,'single rejection is not enough');
  insertRejected(db,'st_b','避免堆砌排比与空泛总结。');
  const c=core.creator.styleFlywheel().candidates;
  assert.equal(c.length,1);
  assert.equal(c[0].rejectedCount,2);
  assert.deepEqual([...c[0].suggestionIds].sort(),['st_a','st_b']);
  assert.match(c[0].proposal,/需作者显式确认/);
  insertRejected(db,'st_c','另一条无关的避免表达');
  assert.equal(core.creator.styleFlywheel().candidates.length,1,'unrelated avoids do not merge');
});

test('flywheel endpoint exposes candidates through the local API boundary',async t=>{
  const core=setup(t),db=core.store.db;
  insertRejected(db,'st_x','避免假精确数据');
  insertRejected(db,'st_y','避免假精确数据');
  const r=await dispatchApi(new Request('http://127.0.0.1:4312/api/creator/style-flywheel'),core);
  assert.equal(r.status,200);
  const d=await r.json();
  assert.equal(d.candidates.length,1);
  assert.equal(d.candidates[0].rejectedCount,2);
});

test('ai-flavor endpoint scans the master draft without blocking or editing',async t=>{
  const core=setup(t);
  const createdResponse=await dispatchApi(new Request('http://127.0.0.1:4312/api/editor/projects',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({title:'AI 腔扫描测试稿'})
  }),core);
  const created=await createdResponse.json();
  const id=created.id||created.project?.id;
  assert.match(id,/^ep_/);
  const r=await dispatchApi(new Request('http://127.0.0.1:4312/api/writing/projects/'+id+'/ai-flavor'),core);
  assert.equal(r.status,200);
  const d=await r.json();
  assert.equal(typeof d.score,'number');
  assert.equal(d.level,'clean');
  assert.match(d.hint,/不能证明|仍需人工/);
});

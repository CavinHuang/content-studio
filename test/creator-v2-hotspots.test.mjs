import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';
import {buildHotspotsRadar,dayClock,latestSyncAt,HOTSPOT_TABS} from '../src/hotspots-radar.mjs';

function setup(t){const root=mkdtempSync(join(tmpdir(),'studio-hotspots-test-')),path=join(root,'studio.sqlite');let core=createCore(path);t.after(()=>{core.close();rmSync(root,{recursive:true,force:true})});return {root,path,get core(){return core}}}
async function request(core,path,{method='GET',body}={}){return dispatchApi(new Request('http://127.0.0.1:4312'+path,{method,headers:body?{'content-type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})}),core)}

test('hotspot radar derivation filters by real fields only and never invents trend or relevance',()=>{
  const items=[
    {id:'csitem_1',title:'AI Agent 工作流讨论',summary:'任务失败后的恢复',sourceName:'测试信源甲',url:'https://example-a.example/1',syncedAt:'2026-10-19T01:00:00Z',publishedAt:''},
    {id:'csitem_2',title:'独立开发定价',summary:'费用透明',sourceName:'测试信源乙',url:'https://example-b.example/2',syncedAt:'2026-10-19T02:00:00Z',publishedAt:''},
  ];
  const all=buildHotspotsRadar({items,tab:'all'});
  assert.equal(all.rows.length,2);assert.deepEqual(all.counts,{all:2,followed:0,shown:2});
  assert.deepEqual(HOTSPOT_TABS.map(t=>t.label),['全部热点','我关注的']);
  const followed=buildHotspotsRadar({items,tab:'followed',followed:['csitem_2']});
  assert.deepEqual(followed.rows.map(r=>r.id),['csitem_2']);assert.equal(followed.counts.followed,1);
  const searched=buildHotspotsRadar({items,query:'定价'});
  assert.deepEqual(searched.rows.map(r=>r.id),['csitem_2']);
  const bySource=buildHotspotsRadar({items:[items[0]],query:'测试信源乙'});
  assert.equal(bySource.rows.length,0);
  assert.equal(dayClock(''),'');assert.equal(dayClock('not-a-date'),'');
  assert.match(dayClock('2026-10-19T01:00:00Z'),/今天|昨天|10 月 19 日/);
  assert.equal(latestSyncAt([]),'');
  assert.equal(latestSyncAt([{last_run:''},{last_run:'2026-10-19T02:00:00Z'}]),new Date('2026-10-19T02:00:00Z').toISOString());
});

test('save-as-topic converts one staged item into a persistent topic candidate with provenance, dedupes repeats and keeps URL traceability',async t=>{
  const {core:c}=setup(t);
  c.creator.saveSource({name:'测试信源甲',url:'https://example-a.example/feed.xml',allowExternalRequest:true});
  const src=c.creator.sources()[0],db=c.store.db;
  db.prepare("INSERT INTO creator_source_items(id,source_id,url,title,summary,published_at,synced_at) VALUES(?,?,?,?,?,?,?)")
    .run('csitem_t1',src.id,'https://example-a.example/post-1','信源文章标题足够长','摘要内容用于概要','2026-10-19T00:00:00Z','2026-10-19T01:00:00Z');
  // 未知条目 → 诚实 404，不静默成功
  assert.equal((await request(c,'/api/creator/source-items/topic',{method:'POST',body:{id:'csitem_missing'}})).status,404);
  const first=await (await request(c,'/api/creator/source-items/topic',{method:'POST',body:{id:'csitem_t1'}})).json();
  assert.equal(first.duplicate,false);assert.equal(first.materialCreated,true);
  assert.equal(first.topic.title,'信源文章标题足够长');assert.equal(first.topic.status,'draft');
  assert.equal(first.topic.refs.length,1);assert.equal(first.topic.refs[0].kind,'material');
  assert.match(first.topic.reason,/热点雷达转入 · 测试信源甲/);
  const mat=c.creator.material(first.topic.refs[0].id);
  assert.equal(mat.url,'https://example-a.example/post-1');assert.equal(mat.kind,'link');
  assert.equal(JSON.parse(db.prepare('SELECT tags_json FROM creator_materials WHERE id=?').get(mat.id).tags_json)[0],'测试信源甲');
  // 重复收起 → 不新建：同一选题 id + duplicate 标记，素材也不重复
  const again=await (await request(c,'/api/creator/source-items/topic',{method:'POST',body:{id:'csitem_t1'}})).json();
  assert.equal(again.duplicate,true);assert.equal(again.topic.id,first.topic.id);
  assert.equal(again.materialCreated,false);
  assert.equal(c.creator.topics().filter(x=>x.title==='信源文章标题足够长').length,1);
  // 已先转素材的条目再收为选题：素材不重复创建（materialCreated=false）
  const conv=await (await request(c,'/api/creator/source-items/convert',{method:'POST',body:{ids:['csitem_t1']}})).json();
  assert.equal(conv.skipped,1);
  // 自定义标题走同一持久化链路
  db.prepare("INSERT INTO creator_source_items(id,source_id,url,title,summary,published_at,synced_at) VALUES(?,?,?,?,?,?,?)")
    .run('csitem_t2',src.id,'https://example-a.example/post-2','第二条公开线索的原始标题','另一条摘要','','2026-10-19T03:00:00Z');
  const second=await (await request(c,'/api/creator/source-items/topic',{method:'POST',body:{id:'csitem_t2',title:'自定义选题标题'}})).json();
  assert.equal(second.topic.title,'自定义选题标题');assert.equal(second.duplicate,false);
  const listed=c.creator.topics().map(x=>x.id);
  assert.ok(listed.includes(first.topic.id)&&listed.includes(second.topic.id));
});

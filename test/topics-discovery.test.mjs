import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';
import {
  TOPIC_TABS,TOPIC_STATUS,AUTHOR_TOPIC_REASON,isRecommendedOrigin,dayLabel,
  statusInfo,describeRefs,sourceLine,buildTopicsDiscovery,judgmentGaps,
} from '../src/topics-discovery.mjs';

function setup(t){const root=mkdtempSync(join(tmpdir(),'studio-topics-test-')),path=join(root,'studio.sqlite');let core=createCore(path);t.after(()=>{core.close();rmSync(root,{recursive:true,force:true})});return {root,path,get core(){return core}}}
async function request(core,path,{method='GET',body}={}){return dispatchApi(new Request('http://127.0.0.1:4312'+path,{method,headers:body?{'content-type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})}),core)}

test('topic discovery derivation filters by real provenance/status only and never invents a relevance score',()=>{
  assert.deepEqual(TOPIC_TABS.map(t=>t.label),['为我推荐','全部线索','已收藏']);
  assert.equal(TOPIC_STATUS.draft.label,'待讨论');
  assert.equal(statusInfo({status:'writing'}).label,'写作中');
  assert.equal(statusInfo({status:'nonsense'}).tone,'');
  assert.equal(dayLabel(''),'');
  assert.equal(dayLabel('not-a-date'),'');
  assert.match(dayLabel(new Date().toISOString()),/^今天$/);
  // provenance: server default reason = author-typed; anything else is a
  // real pipeline reason (radar conversion / material recommend / model)
  assert.equal(isRecommendedOrigin({reason:AUTHOR_TOPIC_REASON}),false);
  assert.equal(isRecommendedOrigin({reason:'热点雷达转入 · 合成信源甲'}),true);
  assert.equal(isRecommendedOrigin({reason:'来源候选，需核实'}),true);
  assert.equal(isRecommendedOrigin({reason:''}),true);
  assert.equal(isRecommendedOrigin(null),false);

  const topics=[
    {id:'tp_1',title:'作者手记',reason:AUTHOR_TOPIC_REASON,status:'draft',favorite:false,createdAt:'2026-10-19T01:00:00Z',refs:[]},
    {id:'tp_2',title:'雷达转入候选',reason:'热点雷达转入 · 合成信源甲',status:'draft',favorite:false,createdAt:'2026-10-19T02:00:00Z',refs:[{kind:'material',id:'ma_1'}]},
    {id:'tp_3',title:'已收藏的线索',reason:'来自你的素材库',status:'prepared',favorite:true,createdAt:'2026-10-18T01:00:00Z',refs:[]},
    {id:'tp_4',title:'正在写作',reason:AUTHOR_TOPIC_REASON,status:'writing',favorite:false,createdAt:'2026-10-17T01:00:00Z',refs:[]},
  ];
  const library=[{id:'ma_1',kind:'material',title:'授权素材标题'}];
  const all=buildTopicsDiscovery({topics,library});
  assert.deepEqual(all.counts,{all:4,recommended:2,saved:1,shown:4});
  const recommended=buildTopicsDiscovery({topics,tab:'recommended',library});
  assert.deepEqual(recommended.rows.map(r=>r.id),['tp_2','tp_3']);
  const saved=buildTopicsDiscovery({topics,tab:'saved',library});
  assert.deepEqual(saved.rows.map(r=>r.id),['tp_3']);
  const byStatus=buildTopicsDiscovery({topics,status:'writing',library});
  assert.deepEqual(byStatus.rows.map(r=>r.id),['tp_4']);
  const tabAndStatus=buildTopicsDiscovery({topics,tab:'recommended',status:'prepared',library});
  assert.deepEqual(tabAndStatus.rows.map(r=>r.id),['tp_3']);
  // 来源依据 resolves against the library; missing ids stay visible as unavailable
  assert.deepEqual(describeRefs(topics[1].refs,library),[{key:'material:ma_1:0',kindLabel:'素材',title:'授权素材标题',revision:undefined,unavailable:false}]);
  assert.equal(describeRefs([{kind:'material',id:'ma_gone'}],library)[0].unavailable,true);
  assert.equal(describeRefs([{kind:'article',id:'ep_x'}],library)[0].kindLabel,'历史文章');
  assert.equal(sourceLine(topics[1],library),'1 条参考素材');
  assert.equal(sourceLine(topics[0],library),'暂无关联素材');
  assert.deepEqual(all.refs.tp_2[0].title,'授权素材标题');
});

test('judgment gaps name exactly the four ask-named editorial fields',()=>{
  assert.deepEqual(judgmentGaps({problem:'p',angle:'a',refs:[{kind:'material',id:'x'}],evidenceGaps:'e'}),[]);
  assert.deepEqual(judgmentGaps({}),['读者问题','写作角度','来源依据','证据缺口']);
  assert.deepEqual(judgmentGaps({problem:'  ',angle:'',refs:'nope',evidenceGaps:null}),['读者问题','写作角度','来源依据','证据缺口']);
});

test('real topic API round-trip: judgment card fields persist with revision conflict protection and start is idempotent',async t=>{
  const {core:c}=setup(t);
  const created=(await (await request(c,'/api/creator/topics',{method:'POST',body:{title:'选题发现页的合成候选'}})).json());
  assert.equal(created.status,'draft');
  assert.equal(created.reason,AUTHOR_TOPIC_REASON);
  assert.deepEqual(isRecommendedOrigin(created),false);
  const updated=await (await request(c,'/api/creator/topics/'+created.id,{method:'PUT',body:{
    expectedRevision:created.revision,
    problem:'谁需要这个判断？',
    angle:'从真实使用记录出发',
    evidenceGaps:'需要补充两条可核对来源',
    refs:[{kind:'material',id:'ma_missing'}], // will 400: material must exist
  }}));
  assert.equal(updated.status,404); // _refs validates material existence — honest failure
  const okUpdate=await (await request(c,'/api/creator/topics/'+created.id,{method:'PUT',body:{
    expectedRevision:created.revision,
    problem:'谁需要这个判断？',
    angle:'从真实使用记录出发',
    evidenceGaps:'需要补充两条可核对来源',
  }})).json();
  assert.equal(okUpdate.problem,'谁需要这个判断？');
  assert.equal(okUpdate.evidenceGaps,'需要补充两条可核对来源');
  // stale expectedRevision → 409 (conflict protection preserved)
  const conflict=await request(c,'/api/creator/topics/'+created.id,{method:'PUT',body:{
    expectedRevision:created.revision,angle:'过期修改',
  }});
  assert.equal(conflict.status,409);
  // start creates a real project; second start returns the same project
  const first=await (await request(c,'/api/creator/topics/'+created.id+'/start',{method:'POST'})).json();
  assert.match(first.projectId,/^ep_/);
  const again=await (await request(c,'/api/creator/topics/'+created.id+'/start',{method:'POST'})).json();
  assert.equal(again.projectId,first.projectId);
  const listed=(await (await request(c,'/api/creator/topics')).json()).topics;
  assert.equal(listed.filter(x=>x.id===created.id)[0].projectId,first.projectId);
  assert.equal(listed.filter(x=>x.id===created.id)[0].status,'writing');
});

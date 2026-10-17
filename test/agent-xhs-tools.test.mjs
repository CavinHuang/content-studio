import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {createCore} from '../lib/core.mjs';
import {AGENT_TOOLS} from '../src/agent-tools.mjs';

// 渲染门禁照旧：缺少 Noto CJK 字体时仅在安装了 fonts-noto-cjk 的 Linux 容器内运行渲染用例。
const FONT='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';
const needsFont=existsSync(FONT)?{}:{skip:'需要 Noto CJK 中文字体（/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc），请在安装 fonts-noto-cjk 的 Linux 容器内运行'};

// 合成 chat：无已选连接、无 provider task 时 CreatorServices.chat 走注入的 fetchImpl；
// chat() 解析 choices[0].message.content 为 JSON（与 test/creator-v1.test.mjs 的 response() 信封一致）。
function chatStub(payload){
 const calls=[];
 const fetchImpl=async(url,options)=>{
  const body=JSON.parse(options.body);
  calls.push({url:String(url),model:body.model,user:body.messages?.[1]?.content});
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(typeof payload==='function'?payload():payload)}}],usage:{total_tokens:12}}),{headers:{'content-type':'application/json'}});
 };
 return {fetchImpl,calls};
}

function setup(t,fetchImpl){
 const names=['CONTENT_AI_BASE_URL','CONTENT_AI_MODEL','CONTENT_AI_API_KEY'],old=names.map(n=>process.env[n]);
 process.env.CONTENT_AI_BASE_URL='https://agent.example/v1/';
 process.env.CONTENT_AI_MODEL='synthetic-agent-model';
 process.env.CONTENT_AI_API_KEY='synthetic-key';
 t.after(()=>names.forEach((n,i)=>{if(old[i]===undefined)delete process.env[n];else process.env[n]=old[i]}));
 const core=createCore(':memory:',{key:randomBytes(32),services:{fetchImpl}});
 t.after(()=>core.close());
 return core;
}

function xhsProject(core){
 const doc=core.writing.create({title:'图组代理'});
 const paragraphs=Array.from({length:12},(_,i)=>`第${i+1}段记录一个具体可复核的写作实践与读者反馈证据。`);
 const saved=core.writing.save(doc.projectId,'master',{expectedRevision:doc.revision,markdown:'# 图组代理封面\n\n'+paragraphs.join('\n\n')+'\n'});
 return {id:doc.projectId,saved};
}

const agentCtx=(id,saved)=>({projectId:id,channel:'master',runId:'ar_xhs',skillTitle:'小红书图组',expectedRevision:()=>saved.revision,onWritten:()=>{}});

test('render_xhs_group renders every approved page and edit_xhs_page keeps unedited pages byte-identical',needsFont,async t=>{
 // 合成回包与 src/xiaohongshu.mjs _edit 的真实响应结构一致：{pages:[{title,body,assetId,scene,layout,accent,removeBackground}]}
 const {fetchImpl,calls}=chatStub({pages:[{title:'重排后的封面',body:'重新组织这一页的版式与要点顺序。',assetId:'',scene:'',layout:'editorial',accent:'#285c45',removeBackground:false}]});
 const core=setup(t,fetchImpl);
 const {id,saved}=xhsProject(core);
 const plan=await core.xhs.plan(id,{expectedMasterRevision:saved.revision,useAI:false});
 assert.ok(plan.pages.length>=3,'本地排版应拆出多页，才能验证未编辑页保持不变');
 const approved=core.xhs.approveText(id,plan.id,{expectedRevision:plan.revision});
 assert.equal(approved.textApproved,true);
 const ctx=agentCtx(id,saved);
 const rendered=await AGENT_TOOLS.render_xhs_group.execute(core,ctx,{generateVisuals:false});
 assert.equal(rendered.status,'rendered');
 assert.equal(rendered.pages.length,plan.pages.length);
 for(const page of rendered.pages){
  assert.ok(page.asset,'渲染后每页必须带资产');
  assert.match(page.asset.sha256,/^[0-9a-f]{64}$/);
  assert.ok(page.report);
  assert.equal(page.report.textOverflow,false);
 }
 assert.equal(calls.length,0,'generateVisuals:false 的渲染不应调用模型');
 const hashes=rendered.pages.map(p=>p.asset.sha256);
 const edited=await AGENT_TOOLS.edit_xhs_page.execute(core,ctx,{pageId:rendered.pages[0].id,instruction:'只改这一页的排版',generateVisuals:false});
 assert.equal(calls.length,1);
 assert.match(calls[0].url,/\/chat\/completions$/);
 assert.ok(calls[0].user.includes(rendered.pages[0].id),'编辑请求必须携带被修改页');
 assert.equal(edited.status,'rendered');
 assert.equal(edited.pages.length,rendered.pages.length);
 assert.equal(edited.pages[0].id,rendered.pages[0].id);
 assert.equal(edited.pages[0].revision,rendered.pages[0].revision+1);
 assert.equal(edited.pages[0].title,'重排后的封面');
 assert.notEqual(edited.pages[0].asset.sha256,hashes[0]);
 assert.deepEqual(edited.pages.slice(1).map(p=>p.asset.sha256),hashes.slice(1));
 assert.deepEqual(edited.pages.slice(1).map(p=>p.asset.id),rendered.pages.slice(1).map(p=>p.asset.id));
 assert.deepEqual(edited.pages.slice(1).map(p=>p.id),rendered.pages.slice(1).map(p=>p.id));
});

// 缺字体主机的领域门禁自检：与上面的渲染用例互斥——装了字体的主机走完整渲染断言，
// 缺字体的主机在这里验证"无字体→503 拒绝"本身，任何主机至少覆盖门禁的一侧。
if(!existsSync(FONT)) test('render_xhs_group rejects with 503 after 文案确认 when the Noto CJK font is missing',async t=>{
 const {fetchImpl,calls}=chatStub({pages:[]});
 const core=setup(t,fetchImpl);
 const {id,saved}=xhsProject(core);
 const plan=await core.xhs.plan(id,{expectedMasterRevision:saved.revision,useAI:false});
 const approved=core.xhs.approveText(id,plan.id,{expectedRevision:plan.revision});
 assert.equal(approved.textApproved,true);
 await assert.rejects(()=>AGENT_TOOLS.render_xhs_group.execute(core,agentCtx(id,saved),{generateVisuals:false}),
  e=>e.status===503&&/缺少中文字体/.test(e.message));
 assert.equal(calls.length,0,'字体门禁必须先于任何模型调用拒绝渲染');
});

test('render_xhs_group refuses to render before 文案确认 and leaves every page without an asset',async t=>{
 const {fetchImpl,calls}=chatStub({pages:[]});
 const core=setup(t,fetchImpl);
 const {id,saved}=xhsProject(core);
 const plan=await core.xhs.plan(id,{expectedMasterRevision:saved.revision,useAI:false});
 assert.ok(!plan.textApproved,'新规划在确认前不得带有已确认文案标记');
 await assert.rejects(()=>AGENT_TOOLS.render_xhs_group.execute(core,agentCtx(id,saved),{generateVisuals:false}),
  e=>e.status===409&&/请先审阅并确认平台文案/.test(e.message));
 const after=core.xhs.get(id,plan.id);
 assert.equal(after.pages.every(p=>!p.asset),true);
 assert.equal(after.revision,plan.revision,'被拒绝的渲染不得推进图组修订');
 assert.equal(calls.length,0);
});

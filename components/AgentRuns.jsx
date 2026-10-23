'use client';
import {useEffect,useRef,useState} from 'react';
import {Task,TaskTrigger,TaskContent,TaskItem} from './ai-elements/task';
import {Tool,ToolHeader,ToolContent,ToolInput,ToolOutput} from './ai-elements/tool';
import {Badge} from './ui/badge';
import {MessageResponse} from './ai-elements/message';
import {PromptInputTextarea} from './ai-elements/prompt-input';
async function api(path,method='GET',body){const r=await fetch(path,{method,cache:'no-store',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const value=await r.json().catch(()=>({}));if(!r.ok){if(r.status===401&&typeof window!=='undefined')window.location.assign('/signin');throw Error(value.error||'agent 请求未完成')}return value}
const LABEL={model:'模型',tool:'工具',model_error:'模型异常'};
// VA-04：技能按 compose 阶段分组（stage 为 src/agent-skills.mjs 的纯展示字段，
// 白名单同 src/compose-view.mjs parseStage；组名沿用 compose 阶段文案）。
// Adapted from ZJU-REAL/Easel (Apache-2.0)：分组信息架构取自
// web/frontend/src/components/SkillPage.tsx:74-83（layer 分区）与
// web/frontend/src/lib/capabilityMenu.ts:9-19（诚实状态角标 legend）；
// 时间线折叠取自 web/frontend/src/components/MessageBubble.tsx:87-92
// （doneSteps「执行过程 N 步」details）。modified：不搬 113 技能手工菜单/
// SkillDrawer 就地配 key/layer 五色体系——我们仅 8 技能，连接配置在设置页
// 既有工作区（壳层工作区冻结），只保留「分组 + 诚实角标 + 真实计数折叠」。
const STAGE_GROUPS=[["research","研究"],["write","写作"],["review","审稿"],["images","配图"],["publish","发布"]];
// SA-01 重连退避：耗尽后如实提示「运行仍在服务端继续」（循环与 HTTP 解耦是
// 既有事实，src/agent-runtime.mjs 的 _loop 不随连接断开而停止）。
const RECONNECT_BACKOFF=[1000,2000,4000,8000,15000];
const maxSeq=steps=>(steps||[]).reduce((m,s)=>Math.max(m,Number(s.seq)||0),0);
export default function AgentRuns({projectId,channel,revision,onNotice}){
 const [skills,setSkills]=useState([]),[profile,setProfile]=useState(null),[skillId,setSkillId]=useState(''),[instruction,setInstruction]=useState(''),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[run,setRun]=useState(null),[reconnect,setReconnect]=useState(0);
 const serial=useRef(0),mountedRef=useRef(true),scope=useRef(0);
 useEffect(()=>()=>{mountedRef.current=false},[]);
 useEffect(()=>{serial.current++;let alive=true;
  (async()=>{try{const [s,p]=await Promise.all([api('/api/creator/agent-skills'),api('/api/creator/agent')]);if(!alive)return;setSkills(s.skills);setProfile(p.profile);setSkillId(old=>old||s.skills[0]?.id||'')}catch(e){if(alive)onNotice(e.message)}})();
  return()=>{alive=false};
 },[projectId]);
 // SA-01 刷新接续：挂载/切渠道时取本项目的运行列表（服务端列表不分渠道，
 // agent-runtime.mjs runs() rowid DESC LIMIT 20），只附着「本渠道且仍
 // running」的最新一条——不回落展示其它渠道（跨渠道附着会渲染错误上下文的
 // 「取消运行」按钮，单飞按 project+channel 划分）或终态运行（终态重现会改
 // 变面板初始为空语义）。
 useEffect(()=>{const myScope=++scope.current;let alive=true;
  (async()=>{try{
   const {runs}=await api(`/api/creator/projects/${projectId}/agent-runs`);
   const latest=(runs||[]).find(r=>r.channel===channel&&r.status==='running');
   if(!alive||myScope!==scope.current||!latest)return;
   setRun(latest);follow(latest.id,maxSeq(latest.steps))
  }catch{}/* 运行列表失败不阻塞面板常规使用 */})();
  return()=>{alive=false};
 },[projectId,channel]);
 async function start(){
  if(!skillId||!consent)return;setBusy(true);
  try{const {run}=await api(`/api/creator/projects/${projectId}/agent-runs`,'POST',{skillId,instruction,expectedRevision:revision,allowExternalAI:true,channel});setRun(run);follow(run.id)}
  catch(e){onNotice(e.message)}finally{setBusy(false)}
 }
 // SA-01：follow(id,since,attempt)——步骤帧携带 seq 推进游标；run_done/error
 // 帧与空行不携带 seq，跳过游标更新（防 undefined 写入），seq<=lastSeq 防御性
 // 去重。流结束/出错先整体刷新（刷新会并入断流期间新落库的步骤），再把游标
 // 回填为 max(刷新结果 seq, lastSeq) 后按退避重连——否则重连流按 seq>since
 // 重放会出现重复条目。终态即停；耗尽退避后如实提示运行仍在服务端继续。
 async function follow(id,since=0,attempt=0){
  const myScope=scope.current;let lastSeq=since;
  try{
   const r=await fetch(`/api/creator/projects/${projectId}/agent-runs/${id}/events?since=${lastSeq}`,{cache:'no-store'});
   if(r.status===401&&typeof window!=='undefined'){window.location.assign('/signin');return}
   const reader=r.body.getReader(),dec=new TextDecoder();let buf='';
   for(;;){const {done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});
    const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.trim())continue;let frame;try{frame=JSON.parse(line)}catch{continue}
     if(frame&&typeof frame.seq==='number'&&frame.seq<=lastSeq)continue; // 防御性去重：游标后的帧不追加
     if(mountedRef.current&&myScope===scope.current)setRun(old=>old&&old.id===id?{...old,steps:[...(old.steps||[]),frame],status:frame.kind==='run_done'?frame.status:old.status}:old);
     if(frame&&typeof frame.seq==='number'&&frame.seq>lastSeq)lastSeq=frame.seq}}
  }catch{}
  if(!mountedRef.current||myScope!==scope.current)return;
  try{
   const {run:latest}=await api(`/api/creator/projects/${projectId}/agent-runs/${id}`);
   if(!mountedRef.current||myScope!==scope.current)return;
   lastSeq=Math.max(lastSeq,maxSeq(latest.steps));
   setRun(latest);
   if(latest.status==='running'&&attempt<RECONNECT_BACKOFF.length){
    setReconnect(attempt+1);
    setTimeout(()=>{if(mountedRef.current&&myScope===scope.current)follow(id,lastSeq,attempt+1)},RECONNECT_BACKOFF[attempt]);
    return;
   }
  }catch{}
  if(!mountedRef.current||myScope!==scope.current)return;
  setReconnect(0);
  if(attempt>=RECONNECT_BACKOFF.length)onNotice('实时进度连接已断开，运行仍在服务端继续；请刷新页面查看轨迹。');
 }
 // DF-01（QA §10.4.1）：解构名不可与组件态 run 同名——同名 const 会让 URL 模板串
 // ${run.id} 求值命中暂时性死区，ReferenceError 在 fetch 前抛出、被 catch 吞掉。
 async function cancel(){if(!run)return;try{const {run:updated}=await api(`/api/creator/projects/${projectId}/agent-runs/${run.id}/cancel`,'POST',{});setRun(updated)}catch(e){onNotice(e.message)}}
 // SA-02 重驱动：按原技能与模型绑定重新驱动 interrupted/failed 运行；原轨迹
 // 保留、已入库建议/修订不受影响；consent 仍必填，以当前正文为基准开新运行。
 async function redrive(source){
  if(!consent){onNotice('请先勾选本次运行的模型授权，再重新驱动');return}
  setBusy(true);
  try{const {run}=await api(`/api/creator/projects/${projectId}/agent-runs`,'POST',{skillId:source.skillId,instruction:source.instruction,expectedRevision:revision,allowExternalAI:true,channel,resumeOf:source.id});setRun(run);follow(run.id)}
  catch(e){onNotice(e.message)}finally{setBusy(false)}
 }
 async function setWriteMode(mode){
  if(!profile||mode===profile.writeMode)return;
  const before=profile;setProfile({...before,writeMode:mode});
  try{setProfile((await api('/api/creator/agent','PUT',{writeMode:mode})).profile);onNotice('写模式已更新：'+mode)}
  catch(e){setProfile(before);onNotice(e.message)}
 }
 const skill=skills.find(s=>s.id===skillId),tools=skill&&profile?skill.tools.filter(t=>profile.tools.includes(t)):[];
 // VA-04 诚实角标（capabilityMenu legend 语义按我们事实裁剪）：工具交集为空
 // 预告服务端「工具交集空 403」门禁；需图片工具而未启用 → 事后 403 变事前预告。
 const stageGroups=STAGE_GROUPS
  .map(([stage,label])=>({label,list:skills.filter(s=>s.stage===stage)}))
  .filter(group=>group.list.length);
 const toolsAllDisabled=!!skill&&!!profile&&tools.length===0;
 const needsImageTool=!!skill&&!!profile&&skill.tools.includes('generate_image')&&!tools.includes('generate_image');
 function renderStep(step){
  if(step.kind==='resume'){
   const p=step.payload||{};
   return <div className="py-1 text-sm text-(--muted-ink)"><Badge variant="secondary">续跑</Badge><span className="ml-2">从运行 {p.resumeOf||'?'}（原状态：{p.fromStatus||'未知'}）继续，基准修订 v{p.baseRevision??'?'}</span></div>;
  }
  if(step.kind==='tool'){
   const outcome=step.payload.outcome||{};
   const state=outcome.error?'output-error':'output-available';
   return <Tool className="border-border bg-popover">
    <ToolHeader type="dynamic-tool" state={state} toolName={step.payload.name} title={`工具 · ${step.payload.name}`} />
    <ToolContent>
     {outcome.result!==undefined&&<ToolInput input={outcome.result} />}
     <ToolOutput output={outcome.error?undefined:outcome.result} errorText={outcome.error} />
    </ToolContent>
   </Tool>;
  }
  if(step.kind==='model'){
   const names=(step.payload.toolCalls||[]).map(c=>c.name).join('、');
   return <div className="py-1 text-sm text-(--muted-ink)"><Badge variant="secondary">模型</Badge>{names&&<span className="ml-2">{names}</span>}{step.payload.content&&<div className="mt-1 w-full text-foreground"><MessageResponse>{step.payload.content}</MessageResponse></div>}</div>;
  }
  if(step.kind==='model_error')
   return <div className="flex items-center gap-2 py-1 text-sm text-(--destructive)"><Badge variant="outline">模型异常</Badge><span>{step.payload.message}</span></div>;
  if(step.kind==='run_done')
   return <div className="py-1 text-sm text-(--writing-green)">运行{step.status==='completed'?'完成':'结束'}：{step.stopReason||''}</div>;
  return <div className="py-1 text-sm text-(--muted-ink)">{step.kind}</div>;
 }
 return <section className="writing-agent-panel" aria-label="agent 任务运行">
  <p>选择内置技能，由 agent 在授权范围内多步完成写作任务；每一步都记录在运行轨迹中。</p>
  <label>技能<select aria-label="agent 技能" value={skillId} onChange={e=>setSkillId(e.target.value)} disabled={busy||run?.status==='running'}>{stageGroups.map(group=><optgroup label={group.label} key={group.label}>{group.list.map(s=><option value={s.id} key={s.id}>{s.title}（v{s.version}）</option>)}</optgroup>)}</select></label>
  {profile&&<label>写模式<select aria-label="agent 写模式" value={profile.writeMode} onChange={e=>setWriteMode(e.target.value)} disabled={busy||run?.status==='running'}><option value="suggestions">建议制，逐项审阅</option><option value="revisions">授权直写新修订</option></select></label>}
  {skill&&<small>将加载工具：{tools.join('、')||'（无可用工具）'}；当前写模式：{profile?.writeMode==='revisions'?'直写修订':'建议制'}
   {toolsAllDisabled&&<strong className="block text-(--destructive)">工具全部被禁用，启动将被拒绝</strong>}
   {needsImageTool&&<strong className="block text-(--destructive)">需先在偏好中启用图片工具</strong>}
  </small>}
  <label>任务要求<PromptInputTextarea aria-label="agent 任务要求" value={instruction} onChange={e=>setInstruction(e.target.value)} maxLength={4000} placeholder="例如：润色第二段，举一个日常例子（Enter 启动，Shift+Enter 换行）" disabled={busy||run?.status==='running'} submitDisabled={busy||!skillId||!consent||run?.status==='running'} onEnterSubmit={()=>start()}/></label>
  <label className="writing-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={busy||run?.status==='running'}/>允许本次运行调用模型与图片服务，可能产生费用；v1 不设次数上限，逐次记账</label>
  <div className="writing-image-actions">
   <button className="writing-button primary" disabled={busy||!skillId||!consent||run?.status==='running'} onClick={start}>启动运行</button>
   {run?.status==='running'&&<button className="writing-button" onClick={cancel}>取消运行</button>}
  </div>
  {/* SA-01：重连期间时间线上方的如实提示，不新增停止入口；保持在折叠层外附着可见 */}
  {run&&run.status==='running'&&reconnect>0&&<p className="writing-source-note">进度连接重连中（第 {reconnect} 次）…</p>}
  {/* VA-04 时间线折叠（MessageBubble doneSteps 语义）：运行中 open 自动展开，
      终态默认收起为「执行过程 N 步」真实计数摘要；N 即 steps 数，不虚报。 */}
  {run&&<details className="agent-run-steps-box" open={run.status==='running'}>
   <summary className="agent-run-steps-summary">执行过程 {(run.steps||[]).length} 步</summary>
   <ol className="agent-run-steps list-none space-y-2">{(run.steps||[]).map(step=><li key={step.seq}>{renderStep(step)}{step.kind==='run_done'&&<span className="ml-2 text-xs">{step.stopReason||''}</span>}</li>)}</ol>
  </details>}
  {run&&run.status!=='running'&&<p className="writing-source-note">{run.status==='completed'?'运行完成。建议制产出请到建议列表逐项审阅；直写修订可在历史中对比与恢复。':'运行未完成：'+(run.stopReason||run.status)+'。以当前正文为基准开启一条新运行；原运行轨迹保留可查，已入库的建议/修订不受影响。'}{(run.status==='interrupted'||run.status==='failed')&&' 重新驱动需重新勾选本次授权（consent）。'}</p>}
  {run&&(run.status==='interrupted'||run.status==='failed')&&<button className="writing-button" disabled={busy||run?.status==='running'} onClick={()=>redrive(run)}>按原技能与模型绑定重新驱动</button>}
 </section>;
}

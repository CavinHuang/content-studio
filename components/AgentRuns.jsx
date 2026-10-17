'use client';
import {useEffect,useRef,useState} from 'react';
async function api(path,method='GET',body){const r=await fetch(path,{method,cache:'no-store',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const value=await r.json().catch(()=>({}));if(!r.ok)throw Error(value.error||'agent 请求未完成');return value}
const LABEL={model:'模型',tool:'工具',model_error:'模型异常'};
export default function AgentRuns({projectId,channel,revision,onNotice}){
 const [skills,setSkills]=useState([]),[profile,setProfile]=useState(null),[skillId,setSkillId]=useState(''),[instruction,setInstruction]=useState(''),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[run,setRun]=useState(null);
 const serial=useRef(0),mountedRef=useRef(true);
 useEffect(()=>()=>{mountedRef.current=false},[]);
 useEffect(()=>{serial.current++;let alive=true;
  (async()=>{try{const [s,p]=await Promise.all([api('/api/creator/agent-skills'),api('/api/creator/agent')]);if(!alive)return;setSkills(s.skills);setProfile(p.profile);setSkillId(old=>old||s.skills[0]?.id||'')}catch(e){if(alive)onNotice(e.message)}})();
  return()=>{alive=false};
 },[projectId]);
 async function start(){
  if(!skillId||!consent)return;setBusy(true);
  try{const {run}=await api(`/api/creator/projects/${projectId}/agent-runs`,'POST',{skillId,instruction,expectedRevision:revision,allowExternalAI:true,channel});setRun(run);follow(run.id)}
  catch(e){onNotice(e.message)}finally{setBusy(false)}
 }
 async function follow(id){
  try{
   const r=await fetch(`/api/creator/projects/${projectId}/agent-runs/${id}/events`,{cache:'no-store'});
   const reader=r.body.getReader(),dec=new TextDecoder();let buf='';
   for(;;){const {done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});
    const lines=buf.split('\n');buf=lines.pop();for(const line of lines)if(line.trim()){const step=JSON.parse(line);if(mountedRef.current)setRun(old=>old&&old.id===id?{...old,steps:[...(old.steps||[]),step],status:step.kind==='run_done'?step.status:old.status}:old)}}
   if(mountedRef.current){const {run:latest}=await api(`/api/creator/projects/${projectId}/agent-runs/${id}`);setRun(latest)}
  }catch(e){if(mountedRef.current)onNotice('运行事件流中断，请刷新查看进度：'+e.message)}
 }
 async function cancel(){try{const {run}=await api(`/api/creator/projects/${projectId}/agent-runs/${run.id}/cancel`,'POST',{});setRun(run)}catch(e){onNotice(e.message)}}
 async function setWriteMode(mode){
  if(!profile||mode===profile.writeMode)return;
  const before=profile;setProfile({...before,writeMode:mode});
  try{setProfile((await api('/api/creator/agent','PUT',{writeMode:mode})).profile);onNotice('写模式已更新：'+mode)}
  catch(e){setProfile(before);onNotice(e.message)}
 }
 const skill=skills.find(s=>s.id===skillId),tools=skill&&profile?skill.tools.filter(t=>profile.tools.includes(t)):[];
 return <section className="writing-agent-panel" aria-label="agent 任务运行">
  <p>选择内置技能，由 agent 在授权范围内多步完成写作任务；每一步都记录在运行轨迹中。</p>
  <label>技能<select aria-label="agent 技能" value={skillId} onChange={e=>setSkillId(e.target.value)} disabled={busy||run?.status==='running'}>{skills.map(s=><option value={s.id} key={s.id}>{s.title}（v{s.version}）</option>)}</select></label>
  {profile&&<label>写模式<select aria-label="agent 写模式" value={profile.writeMode} onChange={e=>setWriteMode(e.target.value)} disabled={busy||run?.status==='running'}><option value="suggestions">建议制，逐项审阅</option><option value="revisions">授权直写新修订</option></select></label>}
  {skill&&<small>将加载工具：{tools.join('、')||'（无可用工具）'}；当前写模式：{profile?.writeMode==='revisions'?'直写修订':'建议制'}</small>}
  <label>任务要求<textarea aria-label="agent 任务要求" value={instruction} onChange={e=>setInstruction(e.target.value)} maxLength={4000} rows={3} disabled={busy||run?.status==='running'}/></label>
  <label className="writing-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={busy||run?.status==='running'}/>允许本次运行调用模型与图片服务，可能产生费用；v1 不设次数上限，逐次记账</label>
  <div className="writing-image-actions">
   <button className="writing-button primary" disabled={busy||!skillId||!consent||run?.status==='running'} onClick={start}>启动运行</button>
   {run?.status==='running'&&<button className="writing-button" onClick={cancel}>取消运行</button>}
  </div>
  {run&&<ol className="agent-run-steps">{(run.steps||[]).map(step=><li key={step.seq}><strong>{LABEL[step.kind]||step.kind}</strong> <code>{step.kind==='tool'?step.payload.name:step.kind==='model'?(step.payload.toolCalls||[]).map(c=>c.name).join('、')||'（产出）':''}</code> {step.kind==='run_done'?`运行${step.status==='completed'?'完成':'结束'}：${step.stopReason||''}`:''}</li>)}</ol>}
  {run&&run.status!=='running'&&<p className="writing-source-note">{run.status==='completed'?'运行完成。建议制产出请到建议列表逐项审阅；直写修订可在历史中对比与恢复。':'运行未完成：'+(run.stopReason||run.status)+'。可核对轨迹后重新启动。'}</p>}
 </section>;
}

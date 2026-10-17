'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
async function api(path,method='GET',body){const r=await fetch(path,{method,cache:'no-store',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const value=await r.json();if(!r.ok)throw Error(value.error||'配图请求未完成');return value}
export default function WritingImages({projectId,channel,sourceRevision,getContext,onInsert,onNotice}){
 const [plan,setPlan]=useState(null),[busy,setBusy]=useState(false),[provider,setProvider]=useState(''),[consent,setConsent]=useState(false),[selected,setSelected]=useState([]);
 const serial=useRef(0),root=`/api/illustrations/projects/${projectId}`;
 async function load(){const token=serial.current,result=await api(root);if(token!==serial.current)return;setPlan(result);setProvider(old=>old||(result.providers||[]).find(p=>p.configured)?.id||'')}
 useEffect(()=>{serial.current++;setPlan(null);setConsent(false);setSelected([]);load().catch(e=>onNotice(e.message));return()=>{serial.current++}},[projectId]);
 const stale=!!plan&&(plan.stale||plan.sourceRevision!==sourceRevision);
 async function run(task){const token=serial.current;setBusy(true);try{await task();if(token===serial.current)await load()}catch(e){if(token===serial.current)onNotice(e.message)}finally{setBusy(false)}}
 async function makePlan(selection){
  if(plan?.shots.length&&!window.confirm('创建新配图计划？原图仍保存在素材库。'))return;
  await run(async()=>{const context=await getContext(selection);await api(root+'/plan','POST',{expectedMasterRevision:context.revision,...(selection?{paragraphId:context.paragraphId}:{})});setSelected([]);onNotice('配图方案已准备，尚未调用图片服务。')});
 }
 async function generate(){
  if(!consent||!provider||!plan)return;
  const shots=plan.shots.filter(s=>['planned','failed'].includes(s.status));
  await run(async()=>{for(const shot of shots)await api(root+'/shots/'+shot.id+'/generate','POST',{allowExternalAI:true,provider,maxAttempts:1,fallbackProviders:[]});onNotice('图片已生成，请选择要使用的候选。')});setConsent(false);
 }
 async function insert(){
  await run(async()=>{
   const shots=plan.shots.filter(s=>selected.includes(s.id)&&['generated','approved'].includes(s.status));
   const context=await getContext(false);if(context.revision!==plan.sourceRevision)throw Error('主稿已变化，请更新配图计划后再选用。');
   for(const shot of shots)if(shot.status!=='approved')await api(root+'/shots/'+shot.id+'/decision','POST',{decision:'approve'});
   await onInsert(shots,plan.sourceRevision);setSelected([]);onNotice('选中的图片已插入文章，原图和生成记录保留在素材库。');
  });
 }
 return <section className="writing-image-panel" aria-label="文章配图助手"><p>依据主稿规划封面和正文插图，也可选中一个主稿段落单独配图。</p><div className="writing-image-actions"><button disabled={busy} onClick={()=>makePlan(false)}>规划全文配图</button><button disabled={busy||channel!=='master'} onClick={()=>makePlan(true)}>为选段规划配图</button><button disabled={busy} onClick={()=>load().catch(e=>onNotice(e.message))}>刷新</button></div>
  {stale&&<p className="writing-source-note">主稿已有新版本，需更新计划后继续生成。</p>}
  {plan&&<><label>图片服务<select aria-label="配图模型服务" value={provider} onChange={e=>setProvider(e.target.value)} disabled={busy}><option value="">选择已配置服务</option>{plan.providers.map(p=><option value={p.id} key={p.id} disabled={!p.configured}>{p.label||p.id}{p.configured?'':'（未配置）'}</option>)}</select></label>
   <p>当前计划 {plan.shots.length} 张；本次最多 {plan.shots.filter(s=>['planned','failed'].includes(s.status)).length} 次图片请求。{plan.requestBudget&&`每日上限 ${plan.requestBudget.dailyLimit} 次。`}</p>
   <label className="writing-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>允许本次将标题与章节摘要发送至所选图片服务，可能产生费用</label>
   <button className="writing-button primary" disabled={busy||stale||!provider||!consent||!plan.shots.some(s=>['planned','failed'].includes(s.status))} onClick={generate}>{busy?'正在处理…':'生成待处理图片'}</button>
   <div className="writing-image-cards">{plan.shots.map(shot=><article key={shot.id}><strong>{shot.role==='cover'?'封面':'正文配图'} · {shot.ordinal}</strong><p>{shot.scene}</p>{shot.asset&&<img src={shot.asset.previewUrl} alt={shot.alt}/>}<small>{({planned:'待生成',generated:'待选择',approved:'已选用',failed:'生成失败',generating:'正在生成',rejected:'已拒绝'})[shot.status]||shot.status}</small>{['generated','approved'].includes(shot.status)&&<label><input type="checkbox" checked={selected.includes(shot.id)} disabled={busy||stale} onChange={e=>setSelected(ids=>e.target.checked?[...ids,shot.id]:ids.filter(id=>id!==shot.id))}/>选择这张图片</label>}{shot.error&&<p>{shot.error}</p>}</article>)}</div>
   <button className="writing-button" disabled={busy||stale||!selected.length} onClick={insert}>将选中图片插入文章</button>
  </>}
  <Link href={`/illustrations?project=${projectId}`} target="_blank" rel="noopener noreferrer">更多图片编辑、渠道映射与视觉设置 ↗</Link>
 </section>;
}

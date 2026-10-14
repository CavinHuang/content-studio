'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';

async function request(path,method='GET',data){
 const response=await fetch(path,{method,cache:'no-store',headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
 const json=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(json.error||'HTTP '+response.status);
 return json;
}
const statusLabels={queued:'等待执行',running:'执行中',completed:'已生成 · 待人工审阅',failed:'失败',cancelled:'已取消',blocked_budget:'预算不足 · 已暂停',interrupted:'服务中断 · 待核查',obsolete:'文章/方案已变化'};
const eligible=status=>['planned','failed'].includes(status);

export default function IllustrationQueueWorkspace(){
 const [projects,setProjects]=useState([]),[selected,setSelected]=useState([]),[plans,setPlans]=useState({}),[marked,setMarked]=useState({});
 const [queue,setQueue]=useState(null),[provider,setProvider]=useState('openai'),[fallback,setFallback]=useState(false);
 const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const requestIdentity=useRef(null);
 const refreshQueue=useCallback(()=>request('/api/illustrations/queue').then(setQueue),[]);
 const refreshPlans=useCallback(async ids=>{
  if(!ids.length){setPlans({});return}
  const data=await Promise.all(ids.map(async id=>[id,await request('/api/illustrations/projects/'+encodeURIComponent(id))]));
  setPlans(Object.fromEntries(data));
 },[]);
 useEffect(()=>{let active=true;
  request('/api/editor/projects').then(x=>{if(!active)return;const list=(x.projects||[]).slice(0,30);setProjects(list);})
   .catch(e=>setMessage(e.message));
  refreshQueue().catch(e=>setMessage(e.message));
  return()=>{active=false};
 },[refreshQueue]);
 useEffect(()=>{refreshPlans(selected).catch(e=>setMessage(e.message));},[selected,refreshPlans]);
 useEffect(()=>{const tick=setInterval(()=>refreshQueue().catch(()=>{}),2500);return()=>clearInterval(tick)},[refreshQueue]);
 const chosen=selected.flatMap(id=>(plans[id]?.shots||[]).filter(s=>eligible(s.status)&&marked[s.id]!==false).map(s=>({projectId:id,shotId:s.id,expectedUpdatedAt:s.updatedAt})));
 const configured=selected.some(id=>(plans[id]?.providers||[]).some(p=>p.id===provider&&p.configured));
 async function action(fn,{reloadPlans=false}={}){
  setBusy(true);setMessage('');
  try{const response=await fn();await refreshQueue();if(reloadPlans)await refreshPlans(selected);return response}
  catch(e){setMessage(e.message);return null}
  finally{setBusy(false)}
 }
 async function enqueue(){
  if(!consent){setMessage('请先确认同意向所选图片模型发送文章信息。');return}
  if(!chosen.length){setMessage('请选择具有当前配图方案的待生成图片。');return}
  const providers=selected.flatMap(id=>plans[id]?.providers||[]);
  const fallbackProviders=fallback?[...new Set(providers.filter(x=>x.configured&&x.id!==provider).map(x=>x.id))].slice(0,2):[];
  const data={items:chosen,provider,fallbackProviders,maxAttempts:fallbackProviders.length+1};
  const signature=JSON.stringify(data);
  if(requestIdentity.current?.signature!==signature)requestIdentity.current={signature,key:'batch_'+crypto.randomUUID().replaceAll('-','')};
  const result=await action(()=>request('/api/illustrations/queue/batches','POST',{
   ...data,idempotencyKey:requestIdentity.current.key,allowExternalAI:true
  }));
  if(result)setMessage('已创建 '+result.jobs.length+' 项本地任务。还需要明确点击“开始执行”，才会向外部模型发送请求。');
 }
 async function start(){
  if(!consent){setMessage('开始或继续执行前必须再次勾选外部模型授权。');return}
  const result=await action(()=>request('/api/illustrations/queue/start','POST',{allowExternalAI:true}));
  if(result)setMessage('开始处理。执行一次只处理一项；剩余任务按先入先出排队。');
 }
 async function retry(id){
  if(!consent){setMessage('重试是新的付费请求风险；请重新确认授权。');return}
  const result=await action(()=>request('/api/illustrations/queue/jobs/'+id+'/retry','POST',{allowExternalAI:true}));
  if(result)setMessage('任务已重新进入队列；需要再次点击“开始执行”。');
 }
 const queued=queue?.counts?.queued||0,running=queue?.counts?.running||0;
 const selectedStates=selected.map(id=>({project:projects.find(p=>p.id===id),data:plans[id]}));
 return <div className="compose-root"><header className="compose-head">
  <div><Link href="/" className="compose-brand">◈ Content Studio</Link><span className="compose-divider">/</span> Agent 配图任务队列</div>
  <div className="compose-right"><Link className="btn secondary" href="/illustrations">返回配图工作台 ↗</Link></div>
 </header><main className="compose-container">
  <div className="compose-intro"><div><span className="eyebrow">ILLUSTRATION QUEUE · V39</span><h1>跨文章配图任务</h1>
   <p>创建持久队列 → 明确开始外部模型调用 → 查看逐项执行与预算 → 暂停／取消 → 人工审核生成结果。服务重启不会自动恢复付费请求。</p>
  </div><span className="compose-mode">SQLite 持久化 · 单进程执行</span></div>
  {message&&<div className="compose-notice" role="status">{message}<button onClick={()=>setMessage('')} aria-label="关闭通知">×</button></div>}
  <div className="queue-layout">
   <section className="compose-panel queue-selection"><div className="compose-panel-title">01 · 选择文章与待生成插图</div>
    <p className="compose-muted">仅展示最近 30 篇文章。勾选文章后读取最新配图方案；不自动创建方案或上传内容。</p>
    <div className="queue-article-list">{projects.length===0?<p className="compose-muted">暂无文章，请先在内容工作台创建文章。</p>:projects.map(p=><label key={p.id} className="queue-project">
     <input type="checkbox" checked={selected.includes(p.id)} onChange={e=>{setSelected(a=>e.target.checked?[...a,p.id]:a.filter(x=>x!==p.id));requestIdentity.current=null}}/>
     <span>{p.title}</span>
    </label>)}</div>
    {selectedStates.map(({project,data})=><div className="queue-slots" key={project?.id}>
     <strong>{project?.title||'文章'}{data?data.stale?' · 配图计划已过期':' · 方案 v'+data.plan?.masterRevision:' · 加载中'}</strong>
     {!data?.plan?<p className="compose-muted">没有配图方案，请返回工作台先创建方案。</p>:
      data.stale?<p className="compose-danger">主稿已修改，需要重新规划后才能进入队列。</p>:
      data.shots.filter(x=>eligible(x.status)).length===0?<p className="compose-muted">暂无待生成图片。</p>:
      data.shots.filter(x=>eligible(x.status)).map(shot=><label className="queue-shot" key={shot.id}>
       <input type="checkbox" checked={marked[shot.id]!==false} onChange={e=>{setMarked(a=>({...a,[shot.id]:e.target.checked}));requestIdentity.current=null}}/>
       <span>{shot.role==='cover'?'封面':'章节'} {shot.ordinal} · {shot.status==='failed'?'待重试':'待生成'}</span>
      </label>)}
    </div>)}
   </section>
   <section className="compose-panel queue-controls"><div className="compose-panel-title">02 · 任务与外部模型授权</div>
    <label>默认图片供应商<select value={provider} onChange={e=>{setProvider(e.target.value);requestIdentity.current=null}}>
     <option value="openai">OpenAI GPT Image</option><option value="gemini">Google Nano Banana</option><option value="qwen">Qwen Image</option>
    </select></label>
    <label className="compose-consent"><input type="checkbox" checked={fallback} onChange={e=>{setFallback(e.target.checked);requestIdentity.current=null}}/>
     <span>同意供应商失败后尝试最多 2 个备用模型；每次尝试都会单独占用预算。</span></label>
    <label className="compose-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
     <span>我已确认文章内容允许发送给这些外部模型，并理解失败、取消或服务中断也可能产生费用。</span></label>
    <p className="compose-muted">生成额度依然按每篇文章 V38 UTC 日额度限制，队列不能突破预算。创建队列本身不计费。</p>
    <button className="btn primary compose-save" disabled={busy||!consent||!configured||!chosen.length} onClick={enqueue}>加入任务队列（{chosen.length} 张）</button>
    <div className="queue-control-buttons"><button className="btn secondary" disabled={busy||!consent||(!queued&&!running)} onClick={start}>开始／恢复执行</button>
    <button className="btn secondary" disabled={busy||!queue?.active} onClick={()=>action(()=>request('/api/illustrations/queue/pause','POST',{}))}>暂停后续任务</button></div>
    <p className="compose-muted">暂停只阻止新的任务开始。取消正在执行的任务不会撤回已发送的请求，但会禁止其后的模型回退。</p>
   </section>
   <section className="compose-panel queue-jobs"><div className="compose-panel-title">03 · 队列执行与审计</div>
    <div className="queue-stats"><span>等待 <strong>{queued}</strong></span><span>运行 <strong>{running}</strong></span><span>完成 <strong>{queue?.counts?.completed||0}</strong></span><span>异常 <strong>{(queue?.counts?.failed||0)+(queue?.counts?.blocked_budget||0)+(queue?.counts?.interrupted||0)}</strong></span></div>
    <button className="btn secondary" disabled={busy} onClick={()=>action(async()=>{await refreshPlans(selected);return refreshQueue()})}>刷新任务和文章状态</button>
    <div className="queue-job-list">{!queue?.jobs?.length?<p className="compose-muted">还没有任务，先从左侧选择文章和图片。</p>:queue.jobs.map(job=><article className="queue-job" key={job.id}>
     <div className="queue-job-title"><strong>{projects.find(p=>p.id===job.projectId)?.title||job.projectId}</strong><span>{statusLabels[job.status]||job.status}</span></div>
     <p className="compose-muted">图片 {job.shotId.slice(0,13)}… · {job.provider} · {job.startedAt?new Date(job.startedAt).toLocaleString():'尚未开始'}</p>
     {job.error&&<p className="compose-danger">{job.error}</p>}
     {job.cancelRequested&&job.status==='running'&&<p className="compose-muted">已请求取消；当前模型调用可能仍计费。</p>}
     <div className="queue-control-buttons">
      {['queued','running'].includes(job.status)&&<button className="btn secondary" disabled={busy} onClick={()=>action(()=>request('/api/illustrations/queue/jobs/'+job.id+'/cancel','POST',{}))}>{job.status==='running'?'请求取消':'取消排队'}</button>}
      {['failed','blocked_budget'].includes(job.status)&&<button className="btn secondary" disabled={busy||!consent} onClick={()=>retry(job.id)}>人工重试（再次授权）</button>}
      <button className="btn secondary" disabled={busy} onClick={()=>action(async()=>{
       const data=await request('/api/illustrations/queue/jobs/'+job.id+'/events');
       setMessage(data.events.map(e=>e.at.slice(11,19)+' '+e.event+' '+e.detail).join(' · ')||'暂无事件');
      })}>执行事件</button>
     </div>
    </article>)}</div>
   </section>
  </div>
 </main></div>;
}

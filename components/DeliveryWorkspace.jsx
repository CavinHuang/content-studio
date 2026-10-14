'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
const labels={wechat:'微信公众号',zhihu:'知乎'};
const statusText={blocked:'待处理',ready:'已满足本地条件',waiting:'等待上一步',skipped:'明确不适用'};
const issueNames={
 master_article_empty:'主稿尚无有效正文',channel_article_empty:'渠道稿尚无有效正文',
 channel_master_revision_outdated:'渠道稿需要复核最新主稿',
 layout_source_revision_outdated:'排版稿来自旧版渠道正文',
 claim_anchors_unverified:'有失效或未核实的证据锚点',
 open_correction_tasks:'尚有精准更正任务未处理',
 no_claims_linked_manual_fact_check_still_required:'尚未附加段落证据：仍需人工事实检查',
 channel_checks_incomplete:'事实、隐私、版权和布局审核尚未全部确认',
 channel_layout_not_imported:'尚未保存从 doocs/md 导回的排版稿',
 explicit_no_image_choice_or_plan_required:'需要配图计划，或明确记录无配图决定',
 illustration_plan_outdated:'配图方案与主稿版本不一致',
 illustration_queue_unfinished:'仍有排队或执行中的图片任务',
 images_require_author_approval:'有配图尚未由作者批准',
 approved_image_channel_url_missing:'批准的素材未登记渠道图片地址',
 current_positive_quality_review_required:'已批准图片尚缺当前版本的人工质量正向评价',
 image_plan_has_no_slots:'配图方案不包含任何图片位',
 technical_image_findings_require_review:'存在图片尺寸、比例或替代文字的技术提醒',
 image_handoff_not_ready_for_platform_qa:'图文交接尚不满足人工平台验收条件',
 current_author_platform_qa_pass_required:'当前版本缺少人工记录的平台图片检查通过结果',
 saved_markdown_image_reconciliation_failed:'保存的排版稿与批准图片不一致',
 unexpected_images_in_text_only_layout:'无配图稿中检测到图片',
 plan_required:'缺少有效配图方案',plan_stale:'配图方案已失效'
};
const f=s=>issueNames[s]||s;
async function json(url,options){
 const response=await fetch(url,{cache:'no-store',...options});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||'HTTP '+response.status);
 return data;
}
export default function DeliveryWorkspace(){
 const params=useSearchParams();
 const [projects,setProjects]=useState([]),[projectId,setProjectId]=useState(''),[channel,setChannel]=useState('wechat');
 const [report,setReport]=useState(null),[history,setHistory]=useState([]),[reason,setReason]=useState(''),[note,setNote]=useState('');
 const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const endpoint='/api/delivery/projects/'+projectId+'/'+channel;
 const load=useCallback(async()=>{if(!projectId)return;
  const [report,archive]=await Promise.all([json(endpoint),json(endpoint+'/history')]);
  setReport(report);setHistory(archive.history||[]);
 },[projectId,channel,endpoint]);
 useEffect(()=>{let live=true;
  json('/api/editor/projects').then(data=>{
   if(!live)return;
   const items=data.projects||[];setProjects(items);
   const param=params.get('project');setProjectId(param&&items.some(p=>p.id===param)?param:items[0]?.id||'');
   const selected=params.get('channel');setChannel(labels[selected]?selected:'wechat');
  }).catch(e=>{if(live)setError(e.message)});
  return()=>{live=false};
 },[params]);
 useEffect(()=>{let live=true;setReport(null);setHistory([]);setReason('');setNote('');setConfirmed(false);setError('');setSuccess('');
  if(projectId)load().catch(e=>{if(live)setError(e.message)});
  return()=>{live=false};
 },[load,projectId,channel]);
 async function act(work){setBusy(true);setError('');setSuccess('');
  try{await work();await load()}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function waive(){if(!report)return;
  await act(async()=>{
   await json(endpoint+'/no-images',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({expectedSourceRevision:report.sourceRevision,expectedChannelRevision:report.channelRevision,
     expectedLayoutRevision:report.layoutRevision,reason})});
   setReason('');setSuccess('已记录本渠道、本版本的无配图决定。文章变更后需要重新确认。');
  });
 }
 async function saveSnapshot(){if(!report)return;
  await act(async()=>{
   await json(endpoint+'/snapshots',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({expectedFingerprint:report.fingerprint,note,acknowledgeLocalOnly:confirmed})});
   setConfirmed(false);setNote('');setSuccess('本地交付核查快照已保存。它不代表已发布或平台已核验。');
  });
 }
 return <div className="compose-root" data-testid="v44-delivery-workspace">
  <header className="compose-head"><div><Link href="/" className="compose-brand">◈ Content Studio</Link><span className="compose-divider">/</span>文章交付验收</div>
   <div className="compose-right"><Link href="/publish" className="btn secondary">发布准备 ↗</Link><Link href="/illustrations" className="btn secondary">配图工作台 ↗</Link></div>
  </header>
  <main className="compose-container">
   <div className="compose-intro"><div><span className="eyebrow">DELIVERY READINESS · V44</span>
    <h1>文章交付验收工作台</h1><p>从事实证据到渠道排版，集中列出每项缺口与对应的修复入口。显示“本地准备完成”也不代表公众号或知乎已发表。</p>
   </div><span className="compose-mode">仅本地检查 · 不自动发布</span></div>
   <div className="compose-panel delivery-readiness-controls">
    <label>当前文章<select aria-label="交付验收文章" value={projectId} onChange={e=>setProjectId(e.target.value)}>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
    <label>交付渠道<select aria-label="交付验收渠道" value={channel} onChange={e=>setChannel(e.target.value)}><option value="wechat">微信公众号</option><option value="zhihu">知乎</option></select></label>
    <button className="btn secondary" disabled={busy||!projectId} onClick={()=>act(async()=>{})}>重新检查当前状态</button>
   </div>
   {error&&<div className="compose-notice" role="alert">{error}</div>}
   {success&&<div className="compose-notice" role="status">{success}</div>}
   {!projects.length?<div className="compose-panel"><p className="compose-muted">目前没有文章，请先创建内容。</p><Link href="/editor" className="btn primary">进入文章编辑器</Link></div>:!report?<p className="compose-muted">正在读取本地审核记录…</p>:<>
    <section className="compose-panel" data-testid="v44-readiness-summary">
     <div className="compose-panel-title">01 · {report.title} · {labels[channel]}</div>
     <div className="delivery-readiness-summary">
      <strong className={report.ready?'illustration-status':'compose-danger'}>{report.ready?'本地交付条件已满足':'仍有交付事项待处理'}</strong>
      <span>阻断步骤 {report.blockers} · 提醒 {report.warnings}</span>
      <span>主稿 v{report.sourceRevision} · 渠道稿 v{report.channelRevision} · 排版 v{report.layoutRevision}</span>
     </div>
     <p className="compose-muted">结果只来自当前本地数据库与作者核查记录。作者仍须对真实平台的图片可见性、版权和最终发表负责。</p>
     {report.latestSnapshot&&<p className="compose-muted">上次交付快照：{report.latestSnapshot.current?'与当前状态一致':'已过期，需要重新核查'}。</p>}
    </section>
    <section className="compose-panel" data-testid="v44-readiness-steps">
     <div className="compose-panel-title">02 · 逐项检查与修复入口</div>
     <div className="delivery-readiness-steps">{report.steps.map((step,index)=><article className="delivery-readiness-step" key={step.id} data-stage={step.id} data-status={step.status}>
      <div className="delivery-readiness-step-head"><span className="delivery-readiness-index">{index+1}</span><div><strong>{step.title}</strong>
       <p className="compose-muted">{statusText[step.status]}</p></div><Link href={step.href} className="btn secondary">前往处理 ↗</Link></div>
      {step.issues.map((code,i)=><p className="compose-danger" key={code+i}>· {f(code)}</p>)}
      {step.warnings.map((code,i)=><p className="compose-muted" key={code+i}>· {f(code)}</p>)}
     </article>)}</div>
    </section>
    {!report.exemption.current&&report.steps.find(s=>s.id==='images')?.issues.includes('explicit_no_image_choice_or_plan_required')&&<section className="compose-panel" data-testid="v44-no-image-choice">
     <div className="compose-panel-title">可选 · 这篇文章确实不需要图片</div>
     <p className="compose-muted">仅适用于从未创建配图方案、当前排版稿中也没有 Markdown 图片的文章。此决定绑定当前主稿、渠道稿和排版版本，不会替代事实、版权或其他发布检查。</p>
     <textarea aria-label="无配图原因" value={reason} onChange={e=>setReason(e.target.value)} rows={3} placeholder="请具体说明不配图的原因（至少12字）"/>
     <button className="btn secondary" disabled={busy||reason.trim().length<12} onClick={waive}>记录本版本无配图决定</button>
    </section>}
    <section className="compose-panel" data-testid="v44-readiness-snapshot">
     <div className="compose-panel-title">03 · 交付快照（不代表已发布）</div>
     <p className="compose-muted">仅在所有阻断项解决后允许保存当前状态。任何文章修订、图片变更或审核状态变化都会让旧快照过期。</p>
     <textarea aria-label="交付快照备注" value={note} onChange={e=>setNote(e.target.value)} placeholder="说明作者检查过的主要事项（12–600 字）" rows={3}/>
     <label className="compose-consent"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>确认这只是本地交付核查记录，不代表内容已真实发表或被平台独立验证。</span></label>
     <button className="btn primary" disabled={busy||!report.ready||!confirmed||note.trim().length<12} onClick={saveSnapshot}>保存不可变的交付核查快照</button>
     {!!history.length&&<div className="delivery-readiness-history"><strong>最近交付记录</strong>
      {history.slice(0,5).map(h=><p className="compose-muted" key={h.id}>{h.createdAt} · {h.current?'当前版本':'历史版本已过期'} · {h.note}</p>)}
     </div>}
    </section>
   </>}
  </main>
 </div>;
}

'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';

async function api(path,method='GET',data){const r=await fetch(path,{method,cache:'no-store',headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined});const v=await r.json().catch(()=>({}));if(!r.ok)throw Error(v.error||`HTTP ${r.status}`);return v;}
const channels={wechat:'微信公众号',zhihu:'知乎'};
export default function IllustrationStudio(){
 const query=useSearchParams();const [projects,setProjects]=useState([]),[projectId,setProjectId]=useState(''),[channel,setChannel]=useState('wechat');
 const [state,setState]=useState(null),[preview,setPreview]=useState(null),[mapping,setMapping]=useState({}),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const root=`/api/illustrations/projects/${projectId}`;
 const reload=useCallback(async id=>{if(!id)return;setState(await api(`/api/illustrations/projects/${id}`));},[]);
 useEffect(()=>{api('/api/editor/projects').then(x=>{const ps=x.projects||[];setProjects(ps);const fromQuery=query.get('project');setProjectId(fromQuery&&ps.some(p=>p.id===fromQuery)?fromQuery:ps[0]?.id||'');}).catch(e=>setMessage(e.message))},[query]);
 useEffect(()=>{setPreview(null);setState(null);reload(projectId).catch(e=>setMessage(e.message))},[projectId,reload]);
 async function run(task){setBusy(true);setMessage('');try{await task();await reload(projectId)}catch(e){setMessage(e.message)}finally{setBusy(false)}}
 const current=projects.find(p=>p.id===projectId);
 async function generateAll(){if(!consent){setMessage('先明确同意向已配置的图片模型发送文章标题和章节摘要。');return}
  await run(async()=>{let failures=0;const shots=state?.shots||[];for(const shot of shots.filter(x=>x.status==='planned'||x.status==='failed')){
   try{await api(`${root}/shots/${shot.id}/generate`,'POST',{allowExternalAI:true})}catch{failures++}
   await reload(projectId);
  }setMessage(failures?`${failures} 张生成失败，请查看错误后重试。`:'配图生成完成。请逐张审阅并批准，再安排渠道映射。')});
 }
 async function decide(id,decision){return run(()=>api(`${root}/shots/${id}/decision`,'POST',{decision}))}
 function setMap(id,field,v){setMapping(x=>({...x,[id]:{...x[id],[field]:v}}))}
 async function saveMapping(shot){return run(async()=>{const entry=mapping[shot.id]||{};await api(`/api/assets/${shot.assetId}/mappings/${channel}`,'PUT',{url:entry.url||'',note:entry.note||''})})}
 async function buildHandoff(){setBusy(true);setMessage('');try{setPreview(await api(`${root}/handoff/${channel}`))}catch(e){setPreview(null);setMessage(e.message)}finally{setBusy(false)}}
 async function copyProposal(){try{await navigator.clipboard.writeText(preview.markdown);setMessage('含图 Markdown 已复制；请在 doocs/md 中排版，并按 V30 差异审阅导回。')}catch{setMessage('复制被浏览器拦截，请手动选择下方 Markdown。')}}
 return <div className="compose-root"><header className="compose-head"><div><Link href="/" className="compose-brand">◈ Content Studio</Link><span className="compose-divider">/</span>创作 · Agent 自动配图</div><div className="compose-right"><Link className="btn secondary" href={`/compose?project=${encodeURIComponent(projectId)}`}>返回 doocs/md 排版 ↗</Link></div></header>
 <main className="compose-container">
  <div className="compose-intro"><div><span className="eyebrow">ILLUSTRATION AGENT · V32</span><h1>文章写好，交给 Agent 配图</h1><p>分析主稿 → 制定封面和章节配图方案 → 图片模型生成 → 人工审阅 → 素材映射 → doocs/md 排版。图像是概念插画，不是事实证据。</p></div><span className="compose-mode">本地素材库 · 渠道独立</span></div>
  {message&&<div className="compose-notice" role="status">{message}<button type="button" onClick={()=>setMessage('')}>×</button></div>}
  <div className="illustration-grid">
   <aside className="compose-panel"><div className="compose-panel-title">01 · 选择创作内容</div>
    <label>当前文章<select aria-label="配图文章" value={projectId} onChange={e=>setProjectId(e.target.value)}>{projects.map(x=><option value={x.id} key={x.id}>{x.title}</option>)}</select></label>
    <label>目标渠道<select aria-label="配图目标渠道" value={channel} onChange={e=>{setChannel(e.target.value);setPreview(null)}}><option value="wechat">微信公众号</option><option value="zhihu">知乎</option></select></label>
    {state?<><p className="illustration-status">主稿 v{state.sourceRevision}{state.stale?' · 方案已过期':' · 方案可用'}</p><p className="compose-muted">{current?.title}</p>
    <button className="btn primary compose-save" disabled={busy} onClick={()=>run(()=>api(`${root}/plan`,'POST',{expectedMasterRevision:state.sourceRevision}))}>{state.plan?'根据最新主稿重新规划':'分析文章并创建配图计划'}</button>
    {state.stale&&<p className="compose-danger">文章正文已有变化。必须重新生成配图计划，旧图片会保留，但不自动关联到新文章。</p>}
    </>:<p className="compose-muted">请选择已有文章。</p>}
    <div className="compose-tip"><strong>计划与生成有什么区别？</strong><p>创建计划只在本地分析文章标题、段落，不上传内容。点击“调用图片模型”后，相关标题、章节摘要和提示词才会发给配置的图片服务。</p></div>
    <label className="compose-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>我允许将所选文章的标题与章节摘要发送到配置的外部图片模型。已确认没有需要保密的内容。</span></label>
    <p className="compose-muted">图片服务：{state?.configured?'已配置（凭据仅存在服务端）':'未配置。设置 CONTENT_IMAGE_API_* 环境变量后才可实际生成。'}</p>
    <button className="btn secondary compose-save" disabled={busy||!state?.plan||state.stale||!consent||!state.configured||!state.shots.some(s=>['planned','failed'].includes(s.status))} onClick={generateAll}>{busy?'处理中…':'Agent 生成所有待处理配图'}</button>
   </aside>
   <section className="compose-panel"><div className="compose-panel-title">02 · 图片方案与人工审阅</div>
    {!state?.shots.length?<div className="illustration-empty">先选择文章并创建配图计划。默认规划一张封面图与最多两张重点章节插画，避免每段都塞图片。</div>:<div className="illustration-shots">{state.shots.map(shot=>{
      const match=shot.asset?.mappings?.find(x=>x.channel===channel);return <article key={shot.id} className="illustration-shot"><div className="illustration-shot-art">{shot.asset?<img src={shot.asset.previewUrl} alt={shot.alt}/>:<div><span>◌</span><small>{shot.role==='cover'?'封面画面':'章节插画'}</small></div>}</div><div className="illustration-shot-info"><div className="illustration-shot-top"><strong>{shot.ordinal.toString().padStart(2,'0')} · {shot.role==='cover'?'文章封面':'章节插图'}</strong><span>{({planned:'待生成',generating:'正在生成',failed:'生成失败',generated:'待审阅',approved:'已批准',rejected:'已拒绝'})[shot.status]}</span></div><p>{shot.alt}</p><details><summary>查看 Agent 使用的图片生成提示词</summary><p>{shot.prompt}</p></details>
      {shot.error&&<p className="compose-danger">{shot.error}</p>}
      <div className="illustration-actions">{['planned','failed'].includes(shot.status)&&<button className="btn secondary" disabled={busy||!consent||!state.configured||state.stale} onClick={()=>run(()=>api(`${root}/shots/${shot.id}/generate`,'POST',{allowExternalAI:true}))}>生成图片</button>}
       {['generated','rejected'].includes(shot.status)&&<button className="btn primary" disabled={busy||state.stale} onClick={()=>decide(shot.id,'approve')}>批准使用</button>}
       {['generated','approved'].includes(shot.status)&&<button className="btn secondary" disabled={busy||state.stale} onClick={()=>decide(shot.id,'reject')}>不采用</button>}
       {shot.asset&&<a className="btn secondary" href={shot.asset.previewUrl} download={`${shot.id}.png`}>保存图片</a>}
      </div>
      {shot.status==='approved'&&<div className="illustration-mapping"><strong>目标平台素材映射 · {channels[channel]}</strong><p>先在 doocs/md 或平台素材库中手动上传图片，再登记由平台提供的公网 HTTPS 地址。</p><input value={mapping[shot.id]?.url??match?.url??''} onChange={e=>setMap(shot.id,'url',e.target.value)} placeholder="https://...（目标平台或授权图床地址）" aria-label={`${shot.ordinal} 图片 URL`}/><input value={mapping[shot.id]?.note??match?.note??''} onChange={e=>setMap(shot.id,'note',e.target.value)} placeholder="登记人工上传记录、日期或素材编号" aria-label={`${shot.ordinal} 上传记录`}/><button className="btn secondary" disabled={busy} onClick={()=>saveMapping(shot)}>保存该渠道映射</button>{match&&<p className="illustration-status">已登记地址；尚未验证平台显示效果</p>}</div>}
      </div></article>})}</div>}
   </section>
   <aside className="compose-panel"><div className="compose-panel-title">03 · 交接带图稿件</div><p className="compose-muted">仅处理你已经批准、且为该渠道完成地址映射的图片。若段落已在排版器中改写而无法精准定位，图片会标为“需要人工安排”，不会乱插入。</p>
     <button className="btn primary compose-save" disabled={busy||!state?.plan||state.stale} onClick={buildHandoff}>检查并生成带图 Markdown</button>
     {preview&&<div className="illustration-preview"><div className="compose-data"><span>已定位插图</span><strong>{preview.inserted.length}</strong></div><div className="compose-data"><span>缺少渠道图片地址</span><strong>{preview.unmapped.length}</strong></div><div className="compose-data"><span>段落无法定位</span><strong>{preview.unplaced.length}</strong></div>
      {preview.ready?<p className="illustration-status">已生成只读 Markdown 提案，可复制交给 doocs/md。</p>:<p className="compose-danger">仍有未映射或无法定位图片，请补全或手工调整。不会自动修改正式渠道稿。</p>}
      <textarea readOnly rows={9} aria-label="带图 Markdown 预览" value={preview.markdown}/><button className="btn secondary compose-save" disabled={!preview.ready} onClick={copyProposal}>复制带图 Markdown</button></div>}
     <div className="compose-tip"><strong>排版后的必须检查</strong><p>AI 可能画错事实、界面或文字。逐张检查内容准确性、肖像与版权、移动端排版，以及微信公众号和知乎实际粘贴后的图片显示；再按 V30/V31 的导回审阅存档。</p></div>
   </aside>
  </div>
 </main></div>;
}

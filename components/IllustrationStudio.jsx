'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import VisualSeriesPanel from './VisualSeriesPanel';
import {useSearchParams} from 'next/navigation';

async function api(path,method='GET',data){const r=await fetch(path,{method,cache:'no-store',headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined});const v=await r.json().catch(()=>({}));if(!r.ok)throw Error(v.error||`HTTP ${r.status}`);return v;}
const channels={wechat:'微信公众号',zhihu:'知乎'};
export default function IllustrationStudio(){
 const query=useSearchParams();const [projects,setProjects]=useState([]),[projectId,setProjectId]=useState(''),[channel,setChannel]=useState('wechat');
 const [provider,setProvider]=useState('openai'),[promptEdits,setPromptEdits]=useState({}),[promptPreviews,setPromptPreviews]=useState({}),[editDrafts,setEditDrafts]=useState({}),[feedbackDrafts,setFeedbackDrafts]=useState({});
 const [state,setState]=useState(null),[preview,setPreview]=useState(null),[mapping,setMapping]=useState({}),[consent,setConsent]=useState(false),[reviewConsent,setReviewConsent]=useState(false),[fallback,setFallback]=useState(false),[profileDraft,setProfileDraft]=useState(null),[savedProfiles,setSavedProfiles]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const root=`/api/illustrations/projects/${projectId}`;
 const reload=useCallback(async id=>{if(!id)return;const data=await api(`/api/illustrations/projects/${id}`);setState(data);setProfileDraft(current=>current||{name:data.visualProfile?.name||'',palette:data.visualProfile?.palette||'',mood:data.visualProfile?.mood||'',avoid:data.visualProfile?.avoid||''});setProvider(current=>data.providers?.find(x=>x.id===current&&x.configured)?current:(data.providers?.find(x=>x.configured)?.id||current));},[]);
 useEffect(()=>{api('/api/editor/projects').then(x=>{const ps=x.projects||[];setProjects(ps);api('/api/illustrations/visual-profiles').then(v=>setSavedProfiles(v.profiles||[])).catch(()=>{});const fromQuery=query.get('project');setProjectId(fromQuery&&ps.some(p=>p.id===fromQuery)?fromQuery:ps[0]?.id||'');}).catch(e=>setMessage(e.message))},[query]);
 useEffect(()=>{setPreview(null);setState(null);setPromptEdits({});setPromptPreviews({});setEditDrafts({});setFeedbackDrafts({});setProfileDraft(null);reload(projectId).catch(e=>setMessage(e.message))},[projectId,reload]);
 async function run(task){setBusy(true);setMessage('');try{await task();await reload(projectId)}catch(e){setMessage(e.message)}finally{setBusy(false)}}
 const current=projects.find(p=>p.id===projectId);
 async function generateAll(){if(!consent){setMessage('先明确同意向已配置的图片模型发送文章标题和章节摘要。');return}
  await run(async()=>{let failures=0;const shots=state?.shots||[];for(const shot of shots.filter(x=>x.status==='planned'||x.status==='failed')){
   try{await api(`${root}/shots/${shot.id}/generate`,'POST',{allowExternalAI:true,provider,...generationOptions()})}catch{failures++}
   await reload(projectId);
  }setMessage(failures?`${failures} 张生成失败，请查看错误后重试。`:'配图生成完成。请逐张审阅并批准，再安排渠道映射。')});
 }
 function generationOptions(){const secondary=fallback?(state?.providers||[]).filter(p=>p.configured&&p.id!==provider).slice(0,2).map(p=>p.id):[];return {fallbackProviders:secondary,maxAttempts:secondary.length+1};}
 async function saveProfile(){return run(async()=>{await api(`${root}/visual-profile`,'PUT',{expectedRevision:state.visualProfile.revision,profile:profileDraft});api('/api/illustrations/visual-profiles').then(v=>setSavedProfiles(v.profiles||[])).catch(()=>{});setPromptPreviews({});})}
 async function requestReview(shot){if(!reviewConsent){setMessage('请先单独授权向外部视觉评审模型发送图片。');return;}return run(()=>api(`${root}/shots/${shot.id}/review`,'POST',{allowExternalAI:true}));}
 async function agentPlan(){if(!consent){setMessage('需授权将标题与章节摘要发送给外部文本规划模型。');return;}return run(()=>api(`${root}/agent-plan`,'POST',{expectedMasterRevision:state.sourceRevision,allowExternalAI:true}));}
 async function savePrompt(shot){return run(()=>api(`${root}/shots/${shot.id}/prompt`,'PUT',{expectedUpdatedAt:shot.updatedAt,scene:promptEdits[shot.id]?.scene??shot.scene,style:promptEdits[shot.id]?.style??shot.style,provider}));}
 async function viewPrompt(shot){setBusy(true);try{const v=await api(`${root}/shots/${shot.id}/prompt-preview?provider=${provider}`);setPromptPreviews(x=>({...x,[shot.id]:v.prompt}));setMessage('已展示该模型实际使用的提示词。');}catch(e){setMessage(e.message)}finally{setBusy(false)}}
 async function decide(id,decision){return run(()=>api(`${root}/shots/${id}/decision`,'POST',{decision}))}
 function setEdit(id,field,value){setEditDrafts(old=>({...old,[id]:{...old[id],[field]:value}}));}
 async function editShot(shot){const draft=editDrafts[shot.id]||{};const referenceAssetId=draft.referenceAssetId||shot.assetId;
  return run(()=>api(`${root}/shots/${shot.id}/candidates`,'POST',{allowExternalAI:true,expectedUpdatedAt:shot.updatedAt,referenceAssetId,provider,instruction:draft.instruction||''}));
 }
 async function decideCandidate(shot,candidate,decision){return run(()=>api(`${root}/shots/${shot.id}/candidates/${candidate.id}/decision`,'POST',{decision,expectedUpdatedAt:shot.updatedAt}));}
 async function compareCandidate(shot,candidate){if(!reviewConsent){setMessage('先单独同意将参考图和候选图发送给视觉评审模型。');return;}
  return run(()=>api(`${root}/shots/${shot.id}/candidates/${candidate.id}/comparison`,'POST',{allowExternalAI:true,expectedUpdatedAt:shot.updatedAt}));}
 function setFeedback(id,field,value){setFeedbackDrafts(old=>({...old,[id]:{...old[id],[field]:value}}));}
 async function submitFeedback(shot,candidate){const draft=feedbackDrafts[candidate.id]||{};
  return run(()=>api(`${root}/shots/${shot.id}/candidates/${candidate.id}/feedback`,'POST',{expectedUpdatedAt:shot.updatedAt,rating:draft.rating||'needs_revision',note:draft.note||'',remember:!!draft.remember}));}

 function setMap(id,field,v){setMapping(x=>({...x,[id]:{...x[id],[field]:v}}))}
 async function saveMapping(shot){return run(async()=>{const entry=mapping[shot.id]||{};await api(`/api/assets/${shot.assetId}/mappings/${channel}`,'PUT',{url:entry.url||'',note:entry.note||''})})}
 async function buildHandoff(){setBusy(true);setMessage('');try{setPreview(await api(`${root}/handoff/${channel}`))}catch(e){setPreview(null);setMessage(e.message)}finally{setBusy(false)}}
 async function copyProposal(){try{await navigator.clipboard.writeText(preview.markdown);setMessage('含图 Markdown 已复制；请在 doocs/md 中排版，并按 V30 差异审阅导回。')}catch{setMessage('复制被浏览器拦截，请手动选择下方 Markdown。')}}
 return <div className="compose-root"><header className="compose-head"><div><Link href="/" className="compose-brand">◈ Content Studio</Link><span className="compose-divider">/</span>创作 · Agent 自动配图</div><div className="compose-right"><Link className="btn secondary" href={`/compose?project=${encodeURIComponent(projectId)}`}>返回 doocs/md 排版 ↗</Link></div></header>
 <main className="compose-container">
  <div className="compose-intro"><div><span className="eyebrow">ILLUSTRATION AGENT · V37</span><h1>文章写好，交给 Agent 配图</h1><p>分析主稿 → 统一视觉规范 → 多模型配图与有限回退 → 参考图编辑 → 双图质量对比与作者反馈 → 视觉偏好记忆 → 图片质量辅助评审 → 人工批准 → 素材映射 → doocs/md 排版。图像是概念插画，不是事实证据。</p></div><span className="compose-mode">本地素材库 · 渠道独立</span></div>
  {message&&<div className="compose-notice" role="status">{message}<button type="button" onClick={()=>setMessage('')}>×</button></div>}
  <div className="illustration-grid">
   <aside className="compose-panel"><div className="compose-panel-title">01 · 选择创作内容</div>
    <label>当前文章<select aria-label="配图文章" value={projectId} onChange={e=>setProjectId(e.target.value)}>{projects.map(x=><option value={x.id} key={x.id}>{x.title}</option>)}</select></label>
    <label>图片生成供应商<select aria-label="图片供应商" value={provider} onChange={e=>{setProvider(e.target.value);setPromptPreviews({})}}>{(state?.providers||[{id:'openai',label:'OpenAI GPT Image',configured:false},{id:'gemini',label:'Google Nano Banana',configured:false},{id:'qwen',label:'Qwen Image',configured:false}]).map(p=><option key={p.id} value={p.id}>{p.label} · {p.model||'模型待配置'} {p.configured?'（可用）':'（未配置）'}</option>)}</select></label>
    <label>目标渠道<select aria-label="配图目标渠道" value={channel} onChange={e=>{setChannel(e.target.value);setPreview(null)}}><option value="wechat">微信公众号</option><option value="zhihu">知乎</option></select></label>
    {state?<><p className="illustration-status">主稿 v{state.sourceRevision}{state.stale?' · 方案已过期':' · 方案可用'}</p><p className="compose-muted">{current?.title}</p>
    <button className="btn primary compose-save" disabled={busy} onClick={()=>run(()=>api(`${root}/plan`,'POST',{expectedMasterRevision:state.sourceRevision}))}>{state.plan?'根据最新主稿重新规划':'分析文章并创建配图计划'}</button>
    {state.plannerConfigured&&<button className="btn secondary compose-save" disabled={busy||!consent} onClick={agentPlan}>Agent 重新理解文章并生成视觉方案（外部文本模型）</button>}
    {state.stale&&<p className="compose-danger">文章正文已有变化。必须重新生成配图计划，旧图片会保留，但不自动关联到新文章。</p>}
    </>:<p className="compose-muted">请选择已有文章。</p>}
    {state?.visualProfile&&profileDraft&&<div className="compose-tip"><strong>系列文章视觉规范 · v{state.visualProfile.revision}</strong>
     <p>同一篇文章的封面和章节图复用同一套视觉规范。修改后当前计划的旧图将退回待生成；历史记录保留。</p>
     {!!savedProfiles.filter(x=>x.projectId!==projectId).length&&<label>复用其他文章的视觉规范<select aria-label="从已有文章复用视觉规范" defaultValue="" onChange={e=>{const p=savedProfiles.find(x=>x.projectId===e.target.value);if(p)setProfileDraft({name:p.name,palette:p.palette,mood:p.mood,avoid:p.avoid})}}><option value="">选择已有规范…</option>{savedProfiles.filter(x=>x.projectId!==projectId).map(x=><option key={x.projectId} value={x.projectId}>{x.name} · v{x.revision}</option>)}</select></label>}
     {[['name','规范名称'],['palette','主要配色'],['mood','画面氛围'],['avoid','禁止元素']].map(([field,label])=><label key={field}>{label}<input value={profileDraft[field]||''} onChange={e=>setProfileDraft(p=>({...p,[field]:e.target.value}))}/></label>)}
     <button className="btn secondary compose-save" disabled={busy||state.stale} onClick={saveProfile}>保存视觉规范并重新确认图片</button>
    </div>}
    <VisualSeriesPanel key={projectId} projectId={projectId} state={state} projects={projects} onChange={()=>reload(projectId)}/>
    {!!state?.visualMemory?.preferences?.length&&<div className="compose-tip"><strong>作者确认的视觉偏好记忆 · {state.visualMemory.preferences.length} 条</strong><p>这些文字来自你勾选“记住偏好”的候选反馈，仅作用于这篇文章后续配图和修改提示词，不会自动决定采用或发表。</p>{state.visualMemory.preferences.map((item,i)=><p key={i} className="compose-muted">{item.rating==='candidate_better'?'候选更好':item.rating==='reference_better'?'参考图更好':'需要调整'} · {item.note}</p>)}</div>}
    <div className="compose-tip"><strong>计划与生成有什么区别？</strong><p>创建计划只在本地分析文章标题、段落，不上传内容。点击“调用图片模型”后，相关标题、章节摘要和提示词才会发给配置的图片服务。</p></div>
    <label className="compose-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>我允许将所选文章的标题与章节摘要发送到配置的外部图片模型。已确认没有需要保密的内容。</span></label>
    <label className="compose-consent"><input type="checkbox" checked={fallback} onChange={e=>setFallback(e.target.checked)}/><span>主模型遇到限流／服务异常时，允许尝试其他已配置供应商（每张图最多 3 次 API 调用；可能产生额外费用）。</span></label>
    <label className="compose-consent"><input type="checkbox" checked={reviewConsent} onChange={e=>setReviewConsent(e.target.checked)}/><span>额外授权将图片和配图提示词发送给视觉质量评审模型（单独付费调用，不会自动批准发布）。</span></label>
    <p className="compose-muted">图片服务：{state?.providers?.find(p=>p.id===provider)?.configured?`已配置 ${provider}（凭据仅在服务端）`:`${provider} 尚未配置 API Key`}; 文本策划模型：{state?.plannerConfigured?'已配置':'未配置，使用本地规划草案'}</p>
    <button className="btn secondary compose-save" disabled={busy||!state?.plan||state.stale||!consent||!state?.providers?.find(p=>p.id===provider)?.configured||!state.shots.some(s=>['planned','failed'].includes(s.status))} onClick={generateAll}>{busy?'处理中…':'Agent 生成所有待处理配图'}</button>
   </aside>
   <section className="compose-panel"><div className="compose-panel-title">02 · 图片方案与人工审阅</div>
    {!state?.shots.length?<div className="illustration-empty">先选择文章并创建配图计划。默认规划一张封面图与最多两张重点章节插画，避免每段都塞图片。</div>:<div className="illustration-shots">{state.shots.map(shot=>{
      const match=shot.asset?.mappings?.find(x=>x.channel===channel);return <article key={shot.id} className="illustration-shot"><div className="illustration-shot-art">{shot.asset?<img src={shot.asset.previewUrl} alt={shot.alt}/>:<div><span>◌</span><small>{shot.role==='cover'?'封面画面':'章节插画'}</small></div>}</div><div className="illustration-shot-info"><div className="illustration-shot-top"><strong>{shot.ordinal.toString().padStart(2,'0')} · {shot.role==='cover'?'文章封面':'章节插图'}</strong><span>{shot.provider?`${shot.provider} · `:''}{({planned:'待生成',generating:'正在生成',failed:'生成失败',generated:'待审阅',approved:'已批准',rejected:'已拒绝'})[shot.status]}</span></div><p>{shot.alt}</p><div className="illustration-prompt-editor">
        <label>画面内容 / Scene<textarea aria-label={`${shot.ordinal} 画面描述`} rows={3} value={promptEdits[shot.id]?.scene??shot.scene??''} onChange={e=>setPromptEdits(p=>({...p,[shot.id]:{...p[shot.id],scene:e.target.value}}))}/></label>
        <label>视觉风格<select aria-label={`${shot.ordinal} 风格`} value={promptEdits[shot.id]?.style??shot.style??'editorial'} onChange={e=>setPromptEdits(p=>({...p,[shot.id]:{...p[shot.id],style:e.target.value}}))}><option value="editorial">高级杂志插画</option><option value="diagram">抽象结构示意</option><option value="abstract">抽象隐喻</option></select></label>
        <div className="illustration-actions"><button className="btn secondary" disabled={busy||state.stale} onClick={()=>savePrompt(shot)}>保存视觉方案（重新生成前）</button><button className="btn secondary" disabled={busy} onClick={()=>viewPrompt(shot)}>预览 {provider} 提示词</button></div>
        {promptPreviews[shot.id]&&<details open><summary>当前模型生成提示词</summary><textarea readOnly rows={5} value={promptPreviews[shot.id]}/></details>}
       </div><details><summary>上次保存/生成的提示词</summary><p>{shot.prompt}</p></details>
      {shot.error&&<p className="compose-danger">{shot.error}</p>}
      {shot.review&&<div className="compose-tip"><strong>质量辅助评审 · {shot.review.kind==='vision'?'视觉模型':'文件校验'}</strong><p>{shot.review.reason||shot.review.issues?.join('；')||'仍需要人工核查'}</p><p>结论：{shot.review.verdict||shot.review.status} · 不能代替人工审核或事实证据</p></div>}
      {!!shot.attempts?.length&&<details><summary>生成尝试历史 · {shot.attempts.length} 次</summary>{shot.attempts.map((a,i)=><p key={i} className="compose-muted">{a.provider} · {a.result==='success'?'成功':'失败'} · {a.elapsedMs}ms {a.error?'· '+a.error:''}</p>)}</details>}
      {shot.asset&&<div className="compose-tip illustration-variations">
       <strong>参考图迭代 · 保留原图，候选图人工择优</strong>
       <p>可选择当前配图、历史候选或当前系列明确共享的参考图。编辑生成一次调用一笔独立费用；不会自动替换已批准图片。</p>
       <label>参考图片<select aria-label={`${shot.ordinal} 参考图`} value={editDrafts[shot.id]?.referenceAssetId||shot.assetId} onChange={e=>setEdit(shot.id,'referenceAssetId',e.target.value)}>
        <option value={shot.assetId}>当前正式图片</option>{(shot.candidates||[]).map(c=><option key={c.id} value={c.assetId}>候选 · {c.provider} · {c.createdAt}</option>)}{(state?.visualSeries?.references||[]).filter(x=>x.assetId!==shot.assetId).map(ref=><option key={ref.id} value={ref.assetId}>系列参考 · {ref.caption.slice(0,40)}</option>)}
       </select></label>
       <label>修改要求<textarea rows={3} aria-label={`${shot.ordinal} 图片修改指令`} placeholder="例如：保留构图，只将背景调整为米白色，弱化装饰元素，突出中心主体。" value={editDrafts[shot.id]?.instruction||''} onChange={e=>setEdit(shot.id,'instruction',e.target.value)}/></label>
       <button className="btn secondary" disabled={busy||state.stale||!consent||!(editDrafts[shot.id]?.instruction?.trim().length>=12)||!state?.providers?.find(p=>p.id===provider)?.configured} onClick={()=>editShot(shot)}>使用 {provider} 根据参考图生成候选</button>
       {!!shot.candidates?.length&&<div className="illustration-candidate-list">{shot.candidates.map(candidate=><div className="illustration-candidate" key={candidate.id}>
        <div className="illustration-compare-pair"><figure><img src={candidate.referenceAsset?.previewUrl} alt="修改前参考图片"/><figcaption>参考图 · 修改前</figcaption></figure><figure><img src={candidate.asset.previewUrl} alt={`${shot.alt}·编辑候选`}/><figcaption>候选图 · 修改后</figcaption></figure></div><div><strong>{candidate.provider} · {({generated:'待选择',selected:'已选入正式配图',rejected:'已拒绝'})[candidate.status]}</strong><p>{candidate.instruction}</p><p className="compose-muted">生成：{candidate.createdAt} · 参考图哈希：{candidate.referenceAssetId.slice(0,17)}…</p>
        {candidate.comparison&&<div className="compose-tip"><strong>双图 AI 参考意见 · {candidate.comparison.verdict}</strong><p>编辑要求：{candidate.comparison.instructionFit} · 风格一致性：{candidate.comparison.styleConsistency}</p><p>{candidate.comparison.reason}</p>{candidate.comparison.issues?.length>0&&<p>需留意：{candidate.comparison.issues.join('；')}</p>}<p className="compose-muted">此结论仅为模型意见，不代表作者批准、事实准确或版权无风险。</p></div>}
        {!candidate.comparison&&candidate.status==='generated'&&state.comparatorConfigured&&<button className="btn secondary" disabled={busy||state.stale||!reviewConsent} onClick={()=>compareCandidate(shot,candidate)}>AI 对照评审参考图与候选图</button>}
        {candidate.feedback?<div className="compose-tip"><strong>已保存作者反馈 · {candidate.feedback.rating}</strong><p>{candidate.feedback.note}</p><p>{candidate.feedback.remember?'已选择记住偏好':'仅保留审阅记录，不用于后续提示词'}</p></div>:<div className="illustration-feedback"><strong>作者候选反馈</strong><label>对比选择<select aria-label="候选对比判断" value={feedbackDrafts[candidate.id]?.rating||'needs_revision'} onChange={e=>setFeedback(candidate.id,'rating',e.target.value)}><option value="candidate_better">候选更符合要求</option><option value="reference_better">参考图更好</option><option value="needs_revision">还需要调整</option></select></label><label>具体偏好或修改方向<textarea rows={2} aria-label="候选反馈内容" placeholder="例如：背景更克制，但请保留参考图中心主体比例。" value={feedbackDrafts[candidate.id]?.note||''} onChange={e=>setFeedback(candidate.id,'note',e.target.value)}/></label><label className="compose-consent"><input type="checkbox" checked={!!feedbackDrafts[candidate.id]?.remember} onChange={e=>setFeedback(candidate.id,'remember',e.target.checked)}/><span>将这条作者反馈作为后续配图的视觉偏好（下次调用外部模型时会包含这段文字）</span></label><button className="btn secondary" disabled={busy||state.stale||(feedbackDrafts[candidate.id]?.note||'').trim().length<10} onClick={()=>submitFeedback(shot,candidate)}>保存作者反馈</button></div>}
        {candidate.status==='generated'&&<div className="illustration-actions"><button className="btn primary" disabled={busy||state.stale} onClick={()=>decideCandidate(shot,candidate,'select')}>采用为当前配图（仍需人工批准）</button><button className="btn secondary" disabled={busy} onClick={()=>decideCandidate(shot,candidate,'reject')}>拒绝该候选</button></div>}
        </div></div>)}</div>}
       {!!shot.editAttempts?.length&&<details><summary>图片编辑审计 · {shot.editAttempts.length} 次</summary>{shot.editAttempts.map((a,i)=><p className="compose-muted" key={i}>{a.provider} · {a.result==='success'?'生成成功':'失败'} · {a.elapsedMs}ms {a.error?' · '+a.error:''}</p>)}</details>}
      </div>}

      <div className="illustration-actions">{['generated','approved','rejected'].includes(shot.status)&&state.reviewerConfigured&&<button className="btn secondary" disabled={busy||state.stale||!reviewConsent} onClick={()=>requestReview(shot)}>AI 辅助评审图片</button>}{['planned','failed'].includes(shot.status)&&<button className="btn secondary" disabled={busy||!consent||!state?.providers?.find(p=>p.id===provider)?.configured||state.stale} onClick={()=>run(()=>api(`${root}/shots/${shot.id}/generate`,'POST',{allowExternalAI:true,provider,...generationOptions()}))}>生成图片</button>}
       {['generated','rejected'].includes(shot.status)&&<button className="btn primary" disabled={busy||state.stale} onClick={()=>decide(shot.id,'approve')}>批准使用</button>}
       {['generated','approved'].includes(shot.status)&&<button className="btn secondary" disabled={busy||state.stale} onClick={()=>decide(shot.id,'reject')}>不采用</button>}
       {shot.asset&&<a className="btn secondary" href={shot.asset.previewUrl} download={`${shot.id}.${shot.asset?.mime==='image/jpeg'?'jpg':shot.asset?.mime==='image/webp'?'webp':shot.asset?.mime==='image/gif'?'gif':'png'}`}>保存图片</a>}
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

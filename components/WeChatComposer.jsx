'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';

const labels={wechat:'微信公众号',zhihu:'知乎'};
const configuredURL=process.env.NEXT_PUBLIC_DOOCS_MD_URL||'';
async function getJSON(url,options){const r=await fetch(url,{cache:'no-store',...options});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d;}
const basename=(title,ch,revision)=>`${(title||'article').replace(/[\\/<>:"|?*\x00-\x1f]/g,'-').slice(0,55)}-${ch}-layout-v${revision}.md`;

export default function WeChatComposer(){
 const query=useSearchParams();
 const [projects,setProjects]=useState([]),[projectId,setProjectId]=useState(''),[channel,setChannel]=useState('wechat');
 const [layout,setLayout]=useState(null),[importText,setImportText]=useState('');
 const [audit,setAudit]=useState(null),[ackRisk,setAckRisk]=useState(false),[manualResult,setManualResult]=useState({});
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[showEmbed,setShowEmbed]=useState(false),[allowCloud,setAllowCloud]=useState(false);
 const [doocsStatus,setDoocsStatus]=useState(null),[checkingDoocs,setCheckingDoocs]=useState(false);
 const [imageAudit,setImageAudit]=useState(null),[checkingImageAudit,setCheckingImageAudit]=useState(false);
 const [networkConsent,setNetworkConsent]=useState(false),[networkReport,setNetworkReport]=useState(null),[checkingNetwork,setCheckingNetwork]=useState(false);
 const current=useMemo(()=>projects.find(p=>p.id===projectId),[projectId,projects]);
 const loadProjects=useCallback(async()=>{const data=await getJSON('/api/editor/projects');setProjects(data.projects||[]);return data.projects||[];},[]);
 useEffect(()=>{loadProjects().then(ps=>{const p=query.get('project');if(p&&ps.some(x=>x.id===p))setProjectId(p);else if(ps.length)setProjectId(ps[0].id);if(labels[query.get('channel')])setChannel(query.get('channel'));}).catch(e=>setNotice(e.message));},[loadProjects,query]);
 useEffect(()=>{if(!projectId)return;let ok=true;setLayout(null);setImportText('');setAudit(null);setAckRisk(false);getJSON(`/api/composer/projects/${projectId}/${channel}`).then(v=>{if(ok)setLayout(v)}).catch(e=>{if(ok)setNotice(e.message)});return()=>{ok=false}},[projectId,channel]);
 const probeDoocs=useCallback(async()=>{
  setCheckingDoocs(true);
  try{setDoocsStatus(await getJSON('/api/integrations/doocs/preflight'))}
  catch{setDoocsStatus({status:'unavailable',reason:'preflight_failed',platformVerified:false})}
  finally{setCheckingDoocs(false)}
 },[]);
 useEffect(()=>{probeDoocs()},[probeDoocs]);
 const doocsLabel=doocsStatus?.status==='reachable'
  ?'本机排版器服务可连接（未核实 doocs 身份或实际排版效果）'
  :doocsStatus?.status==='blocked'?'排版器地址不符合本机安全检查'
  :doocsStatus?.status==='unavailable'?'尚未连接本机排版器，请检查服务是否已启动'
  :'正在检测本机排版器服务';
 const imageAuditUrl=projectId?`/api/composer/projects/${projectId}/${channel}/image-audit`:null;
 const checkImageMappings=async()=>{
  if(!imageAuditUrl)return;
  setCheckingImageAudit(true);
  try{setImageAudit(await getJSON(imageAuditUrl))}
  catch{setImageAudit({status:'unavailable',summary:{total:0}})}
  finally{setCheckingImageAudit(false)}
 };
 useEffect(()=>{
  if(!imageAuditUrl)return;
  let active=true;setImageAudit(null);
  getJSON(imageAuditUrl).then(report=>{if(active)setImageAudit(report)})
   .catch(()=>{if(active)setImageAudit({status:'unavailable',summary:{total:0}})});
  return()=>{active=false};
 },[imageAuditUrl,layout?.layoutRevision]);
 const verifyPublicImageHeaders=async()=>{
  if(!projectId||!layout||!networkConsent)return;
  setCheckingNetwork(true);setNetworkReport(null);
  try{
   const report=await getJSON(`/api/composer/projects/${projectId}/${channel}/image-network-check`,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({acknowledgeExternalRequests:true,expectedLayoutRevision:layout.layoutRevision})
   });
   setNetworkReport(report);
  }catch(e){setNotice('图片网络检查未完成：'+e.message)}
  finally{setCheckingNetwork(false);setNetworkConsent(false)}
 };
 useEffect(()=>{setNetworkReport(null);setNetworkConsent(false)},[imageAuditUrl,layout?.layoutRevision]);
 const mappedImages=imageAudit?.summary;
 const imageAuditLabel=!mappedImages?'图片映射状态加载中':
  imageAudit?.status==='unavailable'?'图片映射检查暂不可用，请重试':
  mappedImages.stale>0?`发现 ${mappedImages.stale} 个旧图片 URL：当前映射已更改，请重新导出并审阅排版稿`:
  mappedImages.unresolved>0?`有 ${mappedImages.unresolved} 个未替换的本地素材标记，需先登记渠道 URL`:
  mappedImages.external>0?`包含 ${mappedImages.external} 个未登记在本地素材映射中的外部图片，需人工核对`:
  mappedImages.current>0?`已匹配 ${mappedImages.current} 个本地图片映射；不代表实际图床或发布平台可用`:
  '当前渠道排版稿没有 Markdown 图片';
 const auditCurrent=!!audit&&audit.previewMarkdown===importText;
 const compatibility=auditCurrent?audit.compatibility:null;
 const blockers=compatibility?.summary?.blockers||0;
 function setEvidence(checkId,field,value){setManualResult(old=>{const row={...old[checkId],[field]:value};if(row.status==='passed'&&(!row.evidence||row.evidence.trim().length<8))row.status='pending';return {...old,[checkId]:row};});}
 function saveQaRecord(){if(!compatibility)return;const rows=compatibility.manualChecklist.map(c=>({id:c.id,label:c.label,status:manualResult[c.id]?.status||'pending',evidence:manualResult[c.id]?.evidence||''}));const report={kind:'content-studio-author-recorded-platform-paste-test',projectId,channel,layoutRevision:layout?.layoutRevision||0,sourceDocumentRevision:layout?.sourceDocumentRevision||0,contentHash:compatibility.contentHash,recordedAt:new Date().toISOString(),scope:'Self-reported observation only; Content Studio has not verified platform publication.',summary:compatibility.summary,findings:compatibility.issues,checks:rows};const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=basename(current?.title,channel,layout?.layoutRevision||0).replace(/\.md$/, '-paste-test.json');link.click();URL.revokeObjectURL(url);setNotice('已导出人工平台测试记录；填写通过不代表系统自动核实，请保留平台截图或测试证据。')}
 async function reviewMarkdown(){
  if(!layout||importText.trim().length<5)return;
  setBusy(true);setNotice('');setAudit(null);setAckRisk(false);setManualResult({});
  try{
   const result=await getJSON(`/api/composer/projects/${projectId}/${channel}/review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedLayoutRevision:layout.layoutRevision,expectedDocumentRevision:layout.sourceDocumentRevision,markdown:importText})});
   setAudit({...result,previewMarkdown:importText});setManualResult({});
   setNotice(result.requiresHumanReview?'差异已分析：有内容或证据需要人工核对。审阅并确认后才能保存。':'差异已分析：文字与当前来源段落一致。仍须完成渠道发布审核。');
  }catch(e){setNotice(e.message)}finally{setBusy(false)}
 }
 async function update(){if(!layout||!auditCurrent||(audit.requiresHumanReview&&!ackRisk))return;setBusy(true);setNotice('');try{
   const data=await getJSON(`/api/composer/projects/${projectId}/${channel}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedLayoutRevision:layout.layoutRevision,expectedDocumentRevision:layout.sourceDocumentRevision,markdown:importText,reviewToken:audit.reviewToken,acknowledgeDrift:ackRisk})});
   setLayout(data);setImportText('');setAudit(null);setAckRisk(false);setManualResult({});
   setNotice('已保存独立 Markdown 排版版本。本渠道事实、隐私、版权和布局检查均需要重新确认；外部平台未发表。');
  }catch(e){setNotice(e.message)}finally{setBusy(false)}}
 async function copyMarkdown(){try{await navigator.clipboard.writeText(layout?.markdown||'');setNotice('Markdown 已复制。请在 doocs/md 编辑器中粘贴，并在目标平台逐项验证样式。');}catch{setNotice('浏览器不允许自动复制，请下载 Markdown 后导入排版器。')}}
 function downloadMarkdown(){if(!layout)return;const blob=new Blob([layout.markdown],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=basename(current?.title,channel,layout.layoutRevision);link.click();URL.revokeObjectURL(url)}
 async function chooseFile(e){const file=e.target.files?.[0];if(!file)return;if(file.size>200_000){setNotice('仅支持 150000 字以内的 Markdown');return}try{setImportText(await file.text());setAudit(null);setAckRisk(false);setManualResult({});setNotice('Markdown 已导入待保存区；还未替换原排版稿。')}catch(err){setNotice(err.message)}e.target.value='';}
 const editorUrl=configuredURL||'http://127.0.0.1:8800/';
 const isLocal=/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/.test(editorUrl);
 const canOpen=/^https?:\/\//i.test(editorUrl)&&(isLocal||allowCloud);
 return <div className="compose-root">
  <header className="compose-head"><div><Link href="/" className="compose-brand">◈ Content Studio</Link><span className="compose-divider">/</span><span>创作 · 微信排版</span></div><div className="compose-right"><span className="compose-label">排版引擎：<strong>doocs/md</strong></span><Link className="btn secondary" href={`/editor?project=${encodeURIComponent(projectId)}&channel=${channel}`}>证据与人工核查 ↗</Link></div></header>
  <div className="compose-container">
   <div className="compose-intro"><div><span className="eyebrow">COMPOSER · WECHAT MARKDOWN</span><h1>专注内容，交给成熟工具排版</h1><p>使用 doocs/md 负责标题、图片、代码、主题与微信复制；Content Studio 负责来源、研究证据、文章版本与渠道审核。</p></div><span className="compose-mode">独立工具 · 显式交接</span></div>
   {notice&&<div className="compose-notice" role="status">{notice}<button type="button" onClick={()=>setNotice('')} aria-label="关闭提示">×</button></div>}
   <div className="compose-layout"><aside className="compose-panel"><div className="compose-panel-title">01 · 选择当前稿件</div>
     <label>文章项目<select aria-label="选择文章" value={projectId} onChange={e=>setProjectId(e.target.value)}>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>
     <label>排版目标<select aria-label="排版目标渠道" value={channel} onChange={e=>{setChannel(e.target.value);setShowEmbed(false)}}><option value="wechat">微信公众号</option><option value="zhihu">知乎（单独导出）</option></select></label>
     {layout?<><div className="compose-data"><span>正文源版本</span><strong>v{layout.sourceDocumentRevision}</strong></div><div className="compose-data"><span>Markdown 排版修订</span><strong>v{layout.layoutRevision}</strong></div><div className="compose-data"><span>交接方式</span><strong>手动 · 不上传云端</strong></div>{layout.lastImportReview&&<div className="compose-tip"><strong>最近一次导回审阅</strong><p>原文未匹配 {layout.lastImportReview.summary.sourceNeedsReview} 段，新内容 {layout.lastImportReview.summary.newOrChangedBlocks} 段。作者确认不等于事实已核实。</p></div>}{layout.isSourceOutdated&&<p className="compose-danger">源稿有更新。旧排版稿不会自动被覆盖；请确认是否重新交接。</p>}</>:<p>载入稿件中…</p>}
     <div className="compose-tip"><strong>版本保护</strong><p>公众号和知乎分别保留排版记录。Markdown 导回会重置本渠道人工核查，但不会覆盖知识与历史版本。</p></div>
     </aside>
     <section className="compose-panel compose-main"><div className="compose-panel-title">02 · Agent 配图 → doocs/md 排版</div><p className="compose-note">写作后可先由 Agent 自动制定配图方案和生成图片。<Link href={`/illustrations?project=${encodeURIComponent(projectId)}`}>打开自动配图工作台 →</Link></p>
       <div className="compose-engine"><span className="compose-engine-logo">md</span><div><h2>doocs / md</h2><p>主题预览 · 数学公式 · 代码高亮 · 图片管理 · 微信复制</p></div><span className="compose-open-tag">开源工具</span></div>
       <div className="compose-actions"><button className="btn primary" disabled={!layout} onClick={copyMarkdown}>复制 Markdown</button><button className="btn secondary" disabled={!layout} onClick={downloadMarkdown}>下载 .md</button><button className="btn secondary" disabled={!canOpen} onClick={()=>window.open(editorUrl,'_blank','noopener,noreferrer')}>打开排版器 ↗</button></div>
       <div className="compose-note" data-testid="v50-doocs-status" role="status"><span>{doocsLabel}</span><button type="button" className="btn secondary" disabled={checkingDoocs} onClick={probeDoocs} style={{marginLeft:12}}>{checkingDoocs?'检查中…':'重新检查连接'}</button></div>
       {!configuredURL&&<div className="compose-note">尚未配置自托管地址。默认目标为本机 <code>127.0.0.1:8800</code>。先启动 doocs/md 容器或 CLI，再点击「打开排版器」。</div>}
       {!isLocal&&<label className="compose-consent"><input type="checkbox" checked={allowCloud} onChange={e=>setAllowCloud(e.target.checked)}/>我已确认该排版器是可信的外部站点，同意手动传递文章内容（含潜在敏感信息）。</label>}
       <div className="compose-steps"><div><b>0</b><span>文章写好后，<Link href={`/illustrations?project=${encodeURIComponent(projectId)}`}>进入 Agent 自动配图</Link>，确认图片并为目标渠道映射公开地址</span></div><div><b>1</b><span>复制 / 导出当前渠道 Markdown</span></div><div><b>2</b><span>在 doocs/md 中粘贴、调整主题与图片</span></div><div><b>3</b><span>在排版器导出 .md，并导回 Content Studio 存档</span></div><div><b>4</b><span>完成事实、隐私、版权和平台粘贴实测</span></div></div>
       {configuredURL&&isLocal&&<><button className="compose-toggle" onClick={()=>setShowEmbed(v=>!v)}>{showEmbed?'收起嵌入视图':'展开本地排版器（独立文档）'}</button>{showEmbed&&<><p className="compose-note">嵌入仅用于使用排版器，不提供自动传稿或获取稿件权限。</p><iframe className="compose-iframe" title="自托管 doocs/md 排版器" src={configuredURL} referrerPolicy="no-referrer"/></>}</>}
       {layout&&<div data-testid="v52-image-mapping-audit" className={imageAudit?.status==='needs_remapping'?'compose-danger':'compose-note'} role="status" style={{marginTop:12}}>
         <span>图片映射 · {imageAuditLabel}</span>
         <button type="button" className="btn secondary" disabled={checkingImageAudit} onClick={checkImageMappings} style={{marginLeft:12}}>{checkingImageAudit?'检查中…':'复查图片链接'}</button>
         {mappedImages?.stale>0&&<p>本地映射历史提示已有图片地址变化。旧排版稿不会自动替换，请重新审阅并导回。</p>}
         {mappedImages?.current>0&&<>
          <label className="compose-consent"><input type="checkbox" data-testid="v53-network-consent" checked={networkConsent} onChange={e=>setNetworkConsent(e.target.checked)}/>
           我同意本次向当前稿件已映射的公网 HTTPS 图片地址发送最多 3 次有限 GET 请求；不会上传正文，也不代表平台验证。</label>
          <button type="button" className="btn secondary" onClick={verifyPublicImageHeaders}
           disabled={!networkConsent||checkingNetwork||mappedImages.current>3} data-testid="v53-check-image-network">
           {checkingNetwork?'检查中…':'检查公网图片响应'}
          </button>
          {mappedImages.current>3&&<p>此稿已有超过 3 条当前图片映射，请分批整理后再检查。</p>}
         </>}
         {networkReport&&<div data-testid="v53-network-results">
          <p>外部请求 {networkReport.networkCalls} 次：检测图片响应 {networkReport.results.filter(r=>r.imageResponseObserved).length} 条，失败或被拦截 {networkReport.results.filter(r=>!r.imageResponseObserved).length} 条。仅检查部分响应字节，不代表 CDN 持续可用或微信、知乎已验证。</p>
          {networkReport.results.map((r,i)=><p key={i}>图片 {i+1}：{r.imageResponseObserved?'响应包含图片文件头':'无法确认图片响应'}（{r.reason||'header observed'}）</p>)}
         </div>}
       </div>}
       <div className="compose-excerpt"><div className="compose-excerpt-head"><strong>当前交接内容预览</strong><span>只读 · {layout?.markdown?.length||0} 字</span></div><pre>{layout?.markdown||'请选择一个已有项目'}</pre></div>
     </section>
     <aside className="compose-panel"><div className="compose-panel-title">03 · 保存排版修订</div><p className="compose-muted">doocs/md 不提供我们可依赖的双向同步接口。排版完成后，请导出 Markdown 或粘贴 Markdown 保存；上传操作不会自动修改旧正文的证据锚点。</p>
       <label className="compose-upload">导入排版器的 .md 文件<input type="file" accept=".md,.markdown,text/markdown,text/plain" onChange={chooseFile}/></label>
       <textarea aria-label="待保存的排版 Markdown" placeholder="或粘贴从 doocs/md 导出的 Markdown。这里仅用于导入，不是另一个排版编辑器。" value={importText} onChange={e=>{setImportText(e.target.value);setAudit(null);setAckRisk(false);setManualResult({})}} rows={8}/>
       <button className="btn secondary compose-save" disabled={busy||!layout||importText.trim().length<5} onClick={reviewMarkdown}>{busy?'分析中…':'检查导回内容与原文差异'}</button>
       {auditCurrent&&<div className="compose-audit" aria-live="polite">
         <div className="compose-audit-title"><strong>内容与证据差异审阅</strong><span>{audit.requiresHumanReview?'存在需要人工核对的内容/证据':'原文字匹配'}</span></div>
         <div className="compose-audit-counts"><span><b>{audit.summary.exactText}</b> 原文匹配</span><span><b>{audit.summary.sourceNeedsReview}</b> 原文未匹配</span><span><b>{audit.summary.newOrChangedBlocks}</b> 新增/改变段落</span><span><b>{audit.summary.affectedEvidence}</b> 证据需复核</span><span><b>{audit.summary.reorderedBlocks}</b> 原文重排</span><span><b>{audit.summary.newLinkTargets}</b> 新外链/图片地址</span></div>
         <div className="compose-audit-items">
           {audit.sourceBlocks.filter(x=>x.status!=='exact_text'||x.evidenceReview).slice(0,12).map(x=><div className="compose-audit-item" key={x.paragraphId}><span>{x.status==='exact_text'?'证据需复核':'原句未找到匹配'} · {x.paragraphId}</span><p>{x.excerpt}</p>{x.linkedClaims>0&&<small>原稿关联 {x.linkedClaims} 条证据。新排版稿不自动继承核验结论。</small>}</div>)}
           {audit.newLinks.map((url,i)=><div className="compose-audit-item" key={`link-${i}`}><span>新增外部链接或图片地址</span><p>{url}</p></div>)}
           {audit.addedBlocks.slice(0,12).map((x,i)=><div className="compose-audit-item" key={`${x.line}-${i}`}><span>导回内容 · 第 {x.line} 行 · {x.kind}</span><p>{x.excerpt}</p></div>)}
         </div>
         {compatibility&&<div className="compose-compat" aria-label="排版兼容性预检">
          <div className="compose-compat-head"><strong>V31 · 渠道排版兼容预检</strong><span>{compatibility.summary.blockers>0?'存在阻断项 · 不允许存档':'静态检查完成 · 平台表现待实测'}</span></div>
          <div className="compose-compat-metrics"><span><b>{compatibility.summary.blockers}</b> 必须修复</span><span><b>{compatibility.summary.warnings}</b> 风险提醒</span><span><b>{compatibility.summary.manualSignals}</b> 人工检查信号</span></div>
          {compatibility.issues.map((finding,i)=><div className={`compose-compat-issue ${finding.severity}`} key={`${finding.rule}-${finding.line}-${i}`}><span>{finding.severity==='block'?'阻断':finding.severity==='warning'?'提醒':'待实测'} · 第 {finding.line} 行</span><p>{finding.detail}</p></div>)}
          <details className="compose-compat-details"><summary>查看 {labels[channel]} 人工后台粘贴验收清单（{compatibility.manualChecklist.length} 项）</summary><p className="compose-compat-disclaimer">这是一份手工测试记录，不会连接微信或知乎验证是否发表。选择“通过”必须说明实际证据；填写后可导出 JSON 留档。</p>
          {compatibility.manualChecklist.map(check=><div className="compose-compat-check" key={check.id}><div>{check.label}</div><select aria-label={`${check.label} 状态`} value={manualResult[check.id]?.status||'pending'} onChange={e=>setEvidence(check.id,'status',e.target.value)}><option value="pending">待检查</option><option value="passed" disabled={!manualResult[check.id]?.evidence||manualResult[check.id].evidence.trim().length<8}>人工记录：通过</option><option value="failed">人工记录：不通过</option></select><input aria-label={`${check.label} 证据`} type="text" value={manualResult[check.id]?.evidence||''} maxLength={500} onChange={e=>setEvidence(check.id,'evidence',e.target.value)} placeholder="输入平台、日期、截图编号或操作记录（至少 8 字可标记通过）" /></div>)}
          <button type="button" className="btn secondary compose-save" onClick={saveQaRecord}>下载人工粘贴测试记录 JSON</button></details>
         </div>}
         <p className="compose-audit-limit">{audit.limitations}</p>
         {audit.requiresHumanReview&&<label className="compose-risk-check"><input type="checkbox" checked={ackRisk} onChange={e=>setAckRisk(e.target.checked)}/><span>我已检查以上文字差异及相关证据。理解保存不会证明事实正确、不会继承修改部分的证据核验，且必须重新完成本渠道发布审核。</span></label>}
       </div>}
       <button className="btn primary compose-save" disabled={busy||!auditCurrent||blockers>0||(audit.requiresHumanReview&&!ackRisk)} onClick={update}>{busy?'保存中…':'保存为新的排版版本'}</button>
       <p className="compose-warning">⚠ 差异审阅只比较文字，不能自动辨别事实正误；引用、图片、表格、代码与微信实际渲染还要人工检查。此 Markdown 会单独版本化，不会自动取代段落证据快照。旧的纯文本 HTML 导出将被阻止，避免误交付与排版稿不一致的内容。</p>
       <Link className="compose-research-link" href={`/editor?project=${encodeURIComponent(projectId)}&channel=${channel}`}>返回人工证据核查 →</Link>
     </aside>
   </div>
  </div>
 </div>;
}

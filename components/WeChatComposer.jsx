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
 const [audit,setAudit]=useState(null),[ackRisk,setAckRisk]=useState(false);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[showEmbed,setShowEmbed]=useState(false),[allowCloud,setAllowCloud]=useState(false);
 const current=useMemo(()=>projects.find(p=>p.id===projectId),[projectId,projects]);
 const loadProjects=useCallback(async()=>{const data=await getJSON('/api/editor/projects');setProjects(data.projects||[]);return data.projects||[];},[]);
 useEffect(()=>{loadProjects().then(ps=>{const p=query.get('project');if(p&&ps.some(x=>x.id===p))setProjectId(p);else if(ps.length)setProjectId(ps[0].id);if(labels[query.get('channel')])setChannel(query.get('channel'));}).catch(e=>setNotice(e.message));},[loadProjects,query]);
 useEffect(()=>{if(!projectId)return;let ok=true;setLayout(null);setImportText('');setAudit(null);setAckRisk(false);getJSON(`/api/composer/projects/${projectId}/${channel}`).then(v=>{if(ok)setLayout(v)}).catch(e=>{if(ok)setNotice(e.message)});return()=>{ok=false}},[projectId,channel]);

 const auditCurrent=!!audit&&audit.previewMarkdown===importText;
 async function reviewMarkdown(){
  if(!layout||importText.trim().length<5)return;
  setBusy(true);setNotice('');setAudit(null);setAckRisk(false);
  try{
   const result=await getJSON(`/api/composer/projects/${projectId}/${channel}/review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedLayoutRevision:layout.layoutRevision,expectedDocumentRevision:layout.sourceDocumentRevision,markdown:importText})});
   setAudit({...result,previewMarkdown:importText});
   setNotice(result.requiresHumanReview?'差异已分析：有内容或证据需要人工核对。审阅并确认后才能保存。':'差异已分析：文字与当前来源段落一致。仍须完成渠道发布审核。');
  }catch(e){setNotice(e.message)}finally{setBusy(false)}
 }
 async function update(){if(!layout||!auditCurrent||(audit.requiresHumanReview&&!ackRisk))return;setBusy(true);setNotice('');try{
   const data=await getJSON(`/api/composer/projects/${projectId}/${channel}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({expectedLayoutRevision:layout.layoutRevision,expectedDocumentRevision:layout.sourceDocumentRevision,markdown:importText,reviewToken:audit.reviewToken,acknowledgeDrift:ackRisk})});
   setLayout(data);setImportText('');setAudit(null);setAckRisk(false);
   setNotice('已保存独立 Markdown 排版版本。本渠道事实、隐私、版权和布局检查均需要重新确认；外部平台未发表。');
  }catch(e){setNotice(e.message)}finally{setBusy(false)}}
 async function copyMarkdown(){try{await navigator.clipboard.writeText(layout?.markdown||'');setNotice('Markdown 已复制。请在 doocs/md 编辑器中粘贴，再通过其排版与复制功能交付。');}catch{setNotice('浏览器不允许自动复制，请下载 Markdown 后导入排版器。')}}
 function downloadMarkdown(){if(!layout)return;const blob=new Blob([layout.markdown],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=basename(current?.title,channel,layout.layoutRevision);link.click();URL.revokeObjectURL(url)}
 async function chooseFile(e){const file=e.target.files?.[0];if(!file)return;if(file.size>200_000){setNotice('仅支持 150000 字以内的 Markdown');return}try{setImportText(await file.text());setAudit(null);setAckRisk(false);setNotice('Markdown 已导入待保存区；还未替换原排版稿。')}catch(err){setNotice(err.message)}e.target.value='';}
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
     <section className="compose-panel compose-main"><div className="compose-panel-title">02 · 交给 doocs/md 排版</div>
       <div className="compose-engine"><span className="compose-engine-logo">md</span><div><h2>doocs / md</h2><p>主题预览 · 数学公式 · 代码高亮 · 图片管理 · 微信复制</p></div><span className="compose-open-tag">开源工具</span></div>
       <div className="compose-actions"><button className="btn primary" disabled={!layout} onClick={copyMarkdown}>复制 Markdown</button><button className="btn secondary" disabled={!layout} onClick={downloadMarkdown}>下载 .md</button><button className="btn secondary" disabled={!canOpen} onClick={()=>window.open(editorUrl,'_blank','noopener,noreferrer')}>打开排版器 ↗</button></div>
       {!configuredURL&&<div className="compose-note">尚未配置自托管地址。默认目标为本机 <code>127.0.0.1:8800</code>。先启动 doocs/md 容器或 CLI，再点击「打开排版器」。</div>}
       {!isLocal&&<label className="compose-consent"><input type="checkbox" checked={allowCloud} onChange={e=>setAllowCloud(e.target.checked)}/>我已确认该排版器是可信的外部站点，同意手动传递文章内容（含潜在敏感信息）。</label>}
       <div className="compose-steps"><div><b>1</b><span>复制 / 导出当前渠道 Markdown</span></div><div><b>2</b><span>在 doocs/md 中粘贴、调整主题与图片</span></div><div><b>3</b><span>在排版器导出 .md，并导回 Content Studio 存档</span></div><div><b>4</b><span>完成事实、隐私、版权和平台粘贴实测</span></div></div>
       {configuredURL&&isLocal&&<><button className="compose-toggle" onClick={()=>setShowEmbed(v=>!v)}>{showEmbed?'收起嵌入视图':'展开本地排版器（独立文档）'}</button>{showEmbed&&<><p className="compose-note">嵌入仅用于使用排版器，不提供自动传稿或获取稿件权限。</p><iframe className="compose-iframe" title="自托管 doocs/md 排版器" src={configuredURL} referrerPolicy="no-referrer"/></>}</>}
       <div className="compose-excerpt"><div className="compose-excerpt-head"><strong>当前交接内容预览</strong><span>只读 · {layout?.markdown?.length||0} 字</span></div><pre>{layout?.markdown||'请选择一个已有项目'}</pre></div>
     </section>
     <aside className="compose-panel"><div className="compose-panel-title">03 · 保存排版修订</div><p className="compose-muted">doocs/md 不提供我们可依赖的双向同步接口。排版完成后，请导出 Markdown 或粘贴 Markdown 保存；上传操作不会自动修改旧正文的证据锚点。</p>
       <label className="compose-upload">导入排版器的 .md 文件<input type="file" accept=".md,.markdown,text/markdown,text/plain" onChange={chooseFile}/></label>
       <textarea aria-label="待保存的排版 Markdown" placeholder="或粘贴从 doocs/md 导出的 Markdown。这里仅用于导入，不是另一个排版编辑器。" value={importText} onChange={e=>{setImportText(e.target.value);setAudit(null);setAckRisk(false)}} rows={8}/>
       
<button className="btn secondary compose-save" disabled={busy||!layout||importText.trim().length<5} onClick={reviewMarkdown}>{busy?'分析中…':'检查导回内容与原文差异'}</button>
       {auditCurrent&&<div className="compose-audit" aria-live="polite">
         <div className="compose-audit-title"><strong>内容与证据差异审阅</strong><span>{audit.requiresHumanReview?'存在需要人工核对的内容/证据':'原文字匹配'}</span></div>
         <div className="compose-audit-counts"><span><b>{audit.summary.exactText}</b> 原文匹配</span><span><b>{audit.summary.sourceNeedsReview}</b> 原文未匹配</span><span><b>{audit.summary.newOrChangedBlocks}</b> 新增/改变段落</span><span><b>{audit.summary.affectedEvidence}</b> 证据需复核</span><span><b>{audit.summary.reorderedBlocks}</b> 原文重排</span><span><b>{audit.summary.newLinkTargets}</b> 新外链/图片地址</span></div>
         <div className="compose-audit-items">
           {audit.sourceBlocks.filter(x=>x.status!=='exact_text'||x.evidenceReview).slice(0,12).map(x=><div className="compose-audit-item" key={x.paragraphId}><span>{x.status==='exact_text'?'证据需复核':'原句未找到匹配'} · {x.paragraphId}</span><p>{x.excerpt}</p>{x.linkedClaims>0&&<small>原稿关联 {x.linkedClaims} 条证据。新排版稿不自动继承核验结论。</small>}</div>)}
           {audit.newLinks.map((url,i)=><div className="compose-audit-item" key={`link-${i}`}><span>新增外部链接或图片地址</span><p>{url}</p></div>)}
           {audit.addedBlocks.slice(0,12).map((x,i)=><div className="compose-audit-item" key={`${x.line}-${i}`}><span>导回内容 · 第 {x.line} 行 · {x.kind}</span><p>{x.excerpt}</p></div>)}
         </div>
         <p className="compose-audit-limit">{audit.limitations}</p>
         {audit.requiresHumanReview&&<label className="compose-risk-check"><input type="checkbox" checked={ackRisk} onChange={e=>setAckRisk(e.target.checked)}/><span>我已检查以上文字差异及相关证据。理解保存不会证明事实正确、不会继承修改部分的证据核验，且必须重新完成本渠道发布审核。</span></label>}
       </div>}
       <button className="btn primary compose-save" disabled={busy||!auditCurrent||(audit.requiresHumanReview&&!ackRisk)} onClick={update}>{busy?'保存中…':'保存为新的排版版本'}</button>
       <p className="compose-warning">⚠ 差异审阅只比较文字，不能自动辨别事实正误；引用、图片、表格、代码与微信实际渲染还要人工检查。此 Markdown 会单独版本化，不会自动取代段落证据快照。旧的纯文本 HTML 导出将被阻止，避免误交付与排版稿不一致的内容。</p>
       <Link className="compose-research-link" href={`/editor?project=${encodeURIComponent(projectId)}&channel=${channel}`}>返回人工证据核查 →</Link>
     </aside>
   </div>
  </div>
 </div>;
}

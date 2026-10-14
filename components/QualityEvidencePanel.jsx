'use client';
import {useEffect,useMemo,useState} from 'react';

const CATEGORIES=[
 ['briefFit','主题与文章要求一致'],
 ['clarity','画面信息清晰'],
 ['mobileReadability','手机端可读性'],
 ['styleConsistency','与系列视觉风格一致']
];
const FLAG_OPTIONS=[
 ['misleading_data','可能误导的数据或事实'],
 ['fabricated_ui','疑似虚构界面或截图'],
 ['text_errors','图片文字错误'],
 ['rights_unclear','素材权利不明确'],
 ['sensitive_content','敏感内容风险'],
 ['accessibility','无障碍问题'],
 ['other','其他需要修改的问题']
];
async function api(path,method='GET',body){
 const r=await fetch(path,{method,cache:'no-store',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
 const x=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(x.error||'HTTP '+r.status);
 return x;
}
export default function QualityEvidencePanel({projectId,channel,state}){
 const eligible=useMemo(()=>(state?.shots||[]).filter(s=>s.assetId||(s.candidates||[]).length),[state]);
 const [shotId,setShotId]=useState(''),[quality,setQuality]=useState(null),[assetId,setAssetId]=useState('');
 const [ratings,setRatings]=useState({briefFit:3,clarity:3,mobileReadability:3,styleConsistency:3});
 const [riskFlags,setRiskFlags]=useState([]),[rightsReviewed,setRightsReviewed]=useState(false),[factualReviewed,setFactualReviewed]=useState(false),[recommendation,setRecommendation]=useState('revise'),[note,setNote]=useState('');
 const [roundtrip,setRoundtrip]=useState(null),[draft,setDraft]=useState(null),[draftText,setDraftText]=useState('');
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const root='/api/illustrations/projects/'+encodeURIComponent(projectId);
 const chosen=eligible.find(s=>s.id===shotId);
 const selected=quality?.items?.find(x=>x.assetId===assetId);
 useEffect(()=>{setShotId(eligible[0]?.id||'');setQuality(null);setAssetId('');setRoundtrip(null);setDraft(null);setDraftText('');setNotice('')},[projectId,eligible[0]?.id]);
 useEffect(()=>{if(!projectId||!shotId)return;let live=true;api(root+'/shots/'+shotId+'/quality-reviews').then(x=>{if(live){setQuality(x);setAssetId(x.items[0]?.assetId||'')}}).catch(e=>{if(live)setNotice(e.message)});return()=>{live=false}},[root,projectId,shotId,chosen?.updatedAt]);
 useEffect(()=>{setRoundtrip(null);setDraft(null);setDraftText('')},[projectId,channel]);
 async function act(task){
  setBusy(true);setNotice('');
  try{await task()}catch(e){setNotice(e.message)}finally{setBusy(false)}
 }
 async function saveReview(){
  if(!selected||!chosen)return;
  await act(async()=>{
   const next=await api(root+'/shots/'+shotId+'/quality-reviews','POST',{
    assetId,expectedAssetSha256:selected.sha256,
    expectedShotUpdatedAt:chosen.updatedAt,expectedSourceRevision:state.sourceRevision,
    expectedProfileRevision:state.visualProfile.revision,
    ratings,riskFlags,rightsReviewed,factualReviewed,recommendation,note
   });
   setQuality(next);setNotice('作者评分已作为不可变记录保存；图片批准状态未被更改。');
  });
 }
 async function checkSaved(){
  await act(async()=>{
   const v=await api(root+'/image-roundtrip/'+channel);
   setRoundtrip(v);setNotice(v.ready?'已保存稿件中的图片匹配当前配图方案，仍需人工检查真实平台。':'已检查已保存的渠道稿，请处理下方图片差异。');
  });
 }
 async function checkPreview(){
  if(!draftText.trim()){setNotice('请先粘贴从 doocs/md 导出的 Markdown。');return}
  await act(async()=>{
   const current=await api('/api/composer/projects/'+projectId+'/'+channel);
   setDraft(current);
   setRoundtrip(await api(root+'/image-roundtrip/'+channel,'POST',{
    markdown:draftText,expectedLayoutRevision:current.layoutRevision,expectedSourceRevision:state.sourceRevision
   }));
   setNotice('只做图片一致性预检，未替换或保存任何渠道稿。');
  });
 }
 return <div className="compose-tip" data-testid="v43-quality-workspace">
  <strong>V43 · 视觉质量证据与排版图片核对</strong>
  <p className="compose-muted">评分由作者提供，绑定当前文章、素材哈希及图片位版本。不会自动选择、批准、发送模型或发布图片。</p>
  {!eligible.length?<p className="compose-muted">还没有可评分的图片。生成图片后可以记录人工评价。</p>:<>
   <label>图片位<select aria-label="质量评价图片位" value={shotId} onChange={e=>{setShotId(e.target.value);setQuality(null);setAssetId('')}}>
    {eligible.map(s=><option key={s.id} value={s.id}>{s.role==='cover'?'封面':'章节'} {s.ordinal} · {s.status}</option>)}
   </select></label>
   {!!quality?.items?.length&&<>
    <label>选用或候选素材<select aria-label="质量评价素材" value={assetId} onChange={e=>setAssetId(e.target.value)}>
     {quality.items.map(x=><option key={x.assetId} value={x.assetId}>{x.provider||'未知供应商'} · {x.selected?'当前图片':'候选图片'} · {x.assetId.slice(-7)}</option>)}
    </select></label>
    {selected&&<p className="compose-muted"><a href={selected.previewUrl} target="_blank" rel="noopener noreferrer">查看本地素材预览 ↗</a> · {selected.latest?selected.latestCurrent?'已有当前版本作者评价':'历史评价已失效':'尚无作者评价'}</p>}
    {CATEGORIES.map(([key,label])=><label key={key}>{label}（1–5）
     <select aria-label={label} value={ratings[key]} onChange={e=>setRatings(old=>({...old,[key]:Number(e.target.value)}))}>
      {[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}
     </select>
    </label>)}
    <div className="illustration-mapping">
     <strong>风险标签（可多选）</strong>
     {FLAG_OPTIONS.map(([key,label])=><label className="compose-consent" key={key}><input type="checkbox" checked={riskFlags.includes(key)} onChange={e=>setRiskFlags(old=>e.target.checked?[...old,key]:old.filter(x=>x!==key))}/><span>{label}</span></label>)}
     <label className="compose-consent"><input type="checkbox" checked={rightsReviewed} onChange={e=>setRightsReviewed(e.target.checked)}/><span>本人已实际检查素材使用权（非自动认证）</span></label>
     <label className="compose-consent"><input type="checkbox" checked={factualReviewed} onChange={e=>setFactualReviewed(e.target.checked)}/><span>本人已实际检查图文事实一致性（非自动认证）</span></label>
     <label>人工建议<select aria-label="质量评价结论" value={recommendation} onChange={e=>setRecommendation(e.target.value)}>
      <option value="revise">建议修改</option><option value="reject">建议弃用</option><option value="recommended">建议采用（不等于批准）</option>
     </select></label>
     <textarea aria-label="质量评价备注" rows={3} placeholder="说明为什么这张图适用或需要修改（12–600 字）" value={note} onChange={e=>setNote(e.target.value)}/>
     <button className="btn secondary compose-save" disabled={busy||!selected||note.trim().length<12} onClick={saveReview}>保存不可变的人工质量评价</button>
     {quality?.byProvider?.length>0&&<p className="compose-muted">该图片位历史作者评分：{quality.byProvider.map(x=>x.provider+' '+x.reviewCount+' 次').join('、')}。非盲测，不排名。</p>}
    </div>
   </>}
  </>}
  <div className="illustration-mapping">
   <strong>doocs/md 导回图片一致性</strong>
   <p className="compose-muted">校验已批准素材在 Markdown 中是否缺失、重复、替换或改变顺序。未上传图片、仍含代码围栏或无法定位段落时不宣称交接成功。</p>
   <button className="btn secondary compose-save" disabled={busy||!projectId||!state?.plan} onClick={checkSaved}>检查已导回并保存的渠道稿</button>
   <textarea aria-label="待导回的图片Markdown" rows={3} value={draftText} onChange={e=>setDraftText(e.target.value)} placeholder="可选：先粘贴 doocs/md 导出的 Markdown 进行只读预检。不会覆盖稿件。"/>
   <button className="btn secondary compose-save" disabled={busy||!draftText.trim()||!state?.plan} onClick={checkPreview}>校验待导回的 Markdown（只读）</button>
   {roundtrip&&<div role="status" data-testid="v43-roundtrip-result">
    <p className={roundtrip.ready?'illustration-status':'compose-danger'}>{roundtrip.ready?'图片地址、数量与锚点初步一致':'图片导回存在待核对差异'} · 已匹配 {roundtrip.matchedCount}/{roundtrip.expectedCount} · 扫描到 {roundtrip.actualCount} 张</p>
    {!!roundtrip.issues.length&&<p className="compose-muted">差异：{roundtrip.issues.join('、')}</p>}
    {!!roundtrip.warnings.length&&<p className="compose-muted">人工核验提示：{roundtrip.warnings.join('、')}</p>}
    <p className="compose-muted">{roundtrip.origin==='saved-layout'?'已保存渠道稿':'待导回预览'} · 内容 SHA256 {roundtrip.documentHash.slice(0,14)}… · 没有自动平台校验。</p>
   </div>}
  </div>
  {notice&&<p className="compose-muted" role="alert">{notice}</p>}
 </div>;
}

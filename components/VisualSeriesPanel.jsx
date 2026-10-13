'use client';
import {useEffect,useState} from 'react';

/** Series access is opt-in; never transfers hidden project notes or full article text. */
async function api(path,method='GET',data){
 const r=await fetch(path,{method,cache:'no-store',headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined});
 const out=await r.json().catch(()=>({}));if(!r.ok)throw Error(out.error||'Request failed');return out;
}
export default function VisualSeriesPanel({projectId,state,projects,onChange}){
 const [series,setSeries]=useState([]),[choice,setChoice]=useState(''),[name,setName]=useState('');
 const [draft,setDraft]=useState(null),[notes,setNotes]=useState({}),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const joined=state?.visualSeries||null,profile=state?.visualProfile||null;
 const root=joined?'/api/illustrations/series/'+joined.id:null;
 const refresh=async()=>{const result=await api('/api/illustrations/series');setSeries(result.series||[]);await onChange?.()};
 useEffect(()=>{setChoice('');setDraft(null);setNotes({});api('/api/illustrations/series').then(x=>setSeries(x.series||[])).catch(e=>setMessage(e.message))},[projectId]);
 useEffect(()=>{setDraft(null)},[joined?.id,joined?.revision]);
 async function run(task){
  setBusy(true);setMessage('');
  try{await task();await refresh()}catch(e){setMessage(e.message)}finally{setBusy(false)}
 }
 function currentProfile(){return {name:profile.name,palette:profile.palette,mood:profile.mood,avoid:profile.avoid}}
 async function create(){return run(async()=>{const result=await api('/api/illustrations/series','POST',{name,profile:currentProfile()});setChoice(result.id);setName('');setMessage('已创建系列；请明确点击加入以开放参考图复用。')})}
 async function join(){const target=series.find(x=>x.id===choice);if(!target)return;return run(()=>api('/api/illustrations/series/'+target.id+'/members','POST',{projectId,expectedRevision:target.revision}))}
 async function leave(){return run(()=>api(root+'/members/leave','POST',{projectId}))}
 async function save(){const profileChanges=draft||{};return run(()=>api(root,'PUT',{expectedRevision:joined.revision,name:profileChanges.seriesName??joined.name,profile:{name:profileChanges.name??joined.profile.name,palette:profileChanges.palette??joined.profile.palette,mood:profileChanges.mood??joined.profile.mood,avoid:profileChanges.avoid??joined.profile.avoid}}))}
 async function share(shot){return run(()=>api(root+'/references','POST',{projectId,shotId:shot.id,caption:notes[shot.id],expectedRevision:joined.revision}))}
 async function revoke(ref){return run(()=>api(root+'/references/'+ref.id,'DELETE',{projectId}))}
 if(!state||!profile)return null;
 return <section className="compose-tip" aria-label="系列视觉资产">
  <strong>系列视觉资产 · V37</strong>
  <p>只有主动加入同一系列的文章才能使用系列视觉规范和已共享参考图；不会自动共享文章正文、访谈记录或未经批准的图片。</p>
  {message&&<p role="status" className="compose-muted">{message}</p>}
  {!joined?<div>
    <label>加入已有系列<select aria-label="选择视觉系列" value={choice} onChange={e=>setChoice(e.target.value)}><option value="">选择系列…</option>{series.map(x=><option key={x.id} value={x.id}>{x.name} · v{x.revision} · {x.members} 篇</option>)}</select></label>
    <button className="btn secondary compose-save" disabled={busy||!choice||!projectId} onClick={join}>明确加入此系列</button>
    <label>新建系列名称<input aria-label="新建视觉系列" value={name} maxLength={72} placeholder="例如 Agent Engineering 专栏" onChange={e=>setName(e.target.value)}/></label>
    <button className="btn secondary compose-save" disabled={busy||name.trim().length<2} onClick={create}>根据当前视觉规范创建系列</button>
   </div>:<div>
    <p>当前系列：<strong>{joined.name}</strong> · v{joined.revision} · {joined.members} 篇文章。更新仅影响未来的生成，已批准图片不会静默替换。</p>
    <label>系列名称<input aria-label="修改系列名称" value={draft?.seriesName??joined.name} onChange={e=>setDraft(x=>({...x,seriesName:e.target.value}))}/></label>
    {[[ 'name','视觉规范名称'],['palette','统一配色'],['mood','氛围'],['avoid','禁止元素']].map(([key,label])=><label key={key}>{label}<input value={draft?.[key]??joined.profile[key]} onChange={e=>setDraft(x=>({...x,[key]:e.target.value}))}/></label>)}
    <div className="illustration-actions">
      <button className="btn secondary" disabled={busy} onClick={save}>保存系列新版本</button>
      <button className="btn secondary" disabled={busy} onClick={leave}>退出系列并撤回本文共享图</button>
    </div>
    <details><summary>历史视觉规范 · {joined.versions?.length||0} 个版本</summary>{(joined.versions||[]).map(v=><p className="compose-muted" key={v.revision}>v{v.revision} · {v.profile.name} · {v.createdAt}</p>)}</details>
    <strong>系列共享参考图 · {joined.references?.length||0}</strong>
    <p>参考图仅向系列成员开放。创建其他文章的编辑候选时可明确选择；调用模型仍需单独授权。退出系列会撤回本篇共享图。</p>
    {(joined.references||[]).map(ref=><div className="compose-tip" key={ref.id}>
      <img src={ref.asset.previewUrl} alt={ref.caption} style={{maxWidth:'100%',maxHeight:160,objectFit:'contain'}}/>
      <p>{ref.caption}</p><p className="compose-muted">来源：{projects.find(x=>x.id===ref.sourceProjectId)?.title||'系列文章'}</p>
      {ref.sourceProjectId===projectId&&<button className="btn secondary" disabled={busy} onClick={()=>revoke(ref)}>撤回共享</button>}
    </div>)}
    {(state.shots||[]).filter(shot=>shot.status==='approved'&&!joined.references.some(ref=>ref.assetId===shot.assetId)).map(shot=><div className="compose-tip" key={shot.id}>
      <strong>共享已批准图片：{shot.ordinal} · {shot.alt}</strong>
      <label>图片特征描述<input aria-label={shot.ordinal+' 共享图片描述'} value={notes[shot.id]||''} onChange={e=>setNotes(x=>({...x,[shot.id]:e.target.value}))} maxLength={220} placeholder="例如：米白底、深绿线条、右侧留白的构图"/></label>
      <button className="btn secondary" disabled={busy||(notes[shot.id]||'').trim().length<12} onClick={()=>share(shot)}>明确共享到系列图库</button>
    </div>)}
   </div>}
 </section>;
}

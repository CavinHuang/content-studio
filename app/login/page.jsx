'use client';
import {useState} from 'react';
export default function Login(){
 const [password,setPassword]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(e){
  e.preventDefault();if(busy)return;
  setBusy(true);setError('');
  try{
   const result=await fetch('/api/auth/login',{method:'POST',credentials:'same-origin',
    headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
    body:JSON.stringify({password}),cache:'no-store'});
   if(!result.ok){setError(result.status===429?'登录尝试过多，请稍后重试':'密码不正确或登录已被拒绝');return}
   window.location.replace('/');
  }catch{setError('连接失败，请检查网络后重试')}
  finally{setBusy(false);setPassword('')}
 }
 return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',
  background:'#f8fafc',padding:24,fontFamily:'system-ui,-apple-system,sans-serif'}}>
  <form onSubmit={submit} style={{width:'100%',maxWidth:370,background:'#fff',border:'1px solid #e2e8f0',
   borderRadius:18,padding:32,boxShadow:'0 8px 32px #0f172a0b'}}>
   <div style={{fontSize:13,color:'#64748b',marginBottom:12}}>CONTENT STUDIO</div>
   <h1 style={{fontSize:23,fontWeight:650,margin:'0 0 12px',color:'#0f172a'}}>登录工作台</h1>
   <p style={{fontSize:14,color:'#64748b',lineHeight:1.6,margin:'0 0 24px'}}>
    此工作台仅供授权的管理员使用。
   </p>
   <label htmlFor="studio-password" style={{fontSize:13,fontWeight:600,color:'#334155'}}>管理员密码</label>
   <input id="studio-password" type="password" autoComplete="current-password"
    autoFocus required maxLength={256} value={password} onChange={e=>setPassword(e.target.value)}
    placeholder="输入管理员密码" style={{display:'block',width:'100%',boxSizing:'border-box',
    border:'1px solid #cbd5e1',borderRadius:9,padding:'12px 13px',
    fontSize:15,margin:'9px 0 14px'}}/>
   {error&&<p role="alert" style={{fontSize:13,color:'#b91c1c',marginBottom:13}}>{error}</p>}
   <button disabled={busy} type="submit" style={{width:'100%',background:'#111827',
    color:'#fff',border:0,borderRadius:9,fontSize:14,padding:13,cursor:'pointer'}}>
    {busy?'正在验证…':'登录'}
   </button>
  </form>
 </main>
}

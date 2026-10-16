/**
 * V50 — doocs/md service reachability, NOT editorial or publishing verification.
 * Never sends article data, credentials, cookies or a body. Restricts the
 * destination to an operator-configured loopback origin and root path only.
 */
const loopback=new Set(['localhost','127.0.0.1','[::1]']);
export function parseLocalDoocsAddress(value){
 const original=String(value||'').trim()||'http://127.0.0.1:8800/';
 let u;
 try{u=new URL(original)}catch{return {safe:false,reason:'invalid_url'}}
 if(!['http:','https:'].includes(u.protocol)||!loopback.has(u.hostname)||
    u.username||u.password||u.search||u.hash||u.pathname!=='/'||
    (u.port&&(!/^\d+$/.test(u.port)||Number(u.port)<1024||Number(u.port)>65535))){
  return {safe:false,reason:'requires_loopback_root_without_credentials'};
 }
 return {safe:true,url:u.origin+'/',host:u.hostname,port:Number(u.port|| (u.protocol==='https:'?443:80))};
}
export async function inspectDoocsService({configuredUrl=process.env.NEXT_PUBLIC_DOOCS_MD_URL,
 requester=fetch,timeoutMs=1800}={}){
 const address=parseLocalDoocsAddress(configuredUrl);
 const base={kind:'content-studio-v50-doocs-local-preflight',scope:'loopback-service-only',
  networkCalls:0,articleBytesSent:0,paidRequests:0,platformVerified:false,
  editorIdentityVerified:false,markdownRoundtripVerified:false,published:false};
 if(!address.safe)return {...base,status:'blocked',reason:address.reason};
 const config={...base,host:address.host,port:address.port};
 try{
  const response=await requester(address.url,{
   method:'GET',redirect:'manual',cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',
   headers:{accept:'text/html'},signal:AbortSignal.timeout(Math.min(5000,Math.max(250,timeoutMs)))});
  try{await response.body?.cancel?.()}catch{}
  const type=String(response.headers?.get?.('content-type')||'').toLowerCase();
  if(response.status>=300&&response.status<400)
   return {...config,status:'blocked',reason:'redirect_not_followed',networkCalls:1,httpStatus:response.status};
  if(response.status===200&&type.includes('text/html'))
   return {...config,status:'reachable',networkCalls:1,httpStatus:200,
    note:'Local HTTP HTML endpoint is reachable; its doocs identity, export fidelity and platform paste are NOT verified'};
  return {...config,status:'unavailable',reason:'non_html_or_bad_http_status',networkCalls:1,
   httpStatus:Number.isInteger(response.status)?response.status:null};
 }catch{
  return {...config,status:'unavailable',reason:'connection_failed_or_timed_out',networkCalls:1};
 }
}

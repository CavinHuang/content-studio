export class HTTPError extends Error {constructor(status,headers,message){super(message||`HTTP ${status}`);this.status=status;this.retryAfter=headers?.get?.('retry-after')||null;this.rateReset=headers?.get?.('x-ratelimit-reset')||null;}}
export function waitTime(error,now=Date.now()){
 if(error.retryAfter){const secs=Number(error.retryAfter);if(Number.isFinite(secs))return Math.min(Math.max(secs*1000,60000),86400000);const d=Date.parse(error.retryAfter);if(Number.isFinite(d))return Math.min(Math.max(d-now,60000),86400000);}
 if(error.rateReset){const ms=Number(error.rateReset)*1000-now;if(Number.isFinite(ms))return Math.min(Math.max(ms,60000),86400000);}
 return 5*60*1000;
}
export function createClient({fetchImpl=globalThis.fetch,getEtag=()=>null,timeout=10000}={}){
 return async(url,{sourceId,conditional=false}={})=>{
  const u=new URL(url);if(u.protocol!=='https:')throw Error('Only HTTPS external endpoints are allowed');
  const headers={'User-Agent':'ContentStudio-SourceLab/0.22 (personal research)',Accept:'application/json, application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9'};
  if(u.hostname==='api.github.com'){headers.Accept='application/vnd.github+json';headers['X-GitHub-Api-Version']='2026-03-10';if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;}
  const etag=conditional?getEtag(sourceId):null;if(etag)headers['If-None-Match']=etag;
  const response=await fetchImpl(url,{headers,signal:AbortSignal.timeout(timeout),redirect:'error'});
  const newEtag=response.headers.get('etag')||etag;
  if(response.status===304)return {notModified:true,etag:newEtag,httpStatus:304};
  if(!response.ok){
   const e=new HTTPError(response.status,response.headers);
   if(response.status===409||response.status===400){try{const problem=await response.json();e.code=typeof problem.code==='string'?problem.code:null;e.requestId=problem.requestId||null;if(e.code)e.message=e.code;}catch{}}
   throw e;
  }
  const len=Number(response.headers.get('content-length')||0);if(len>2_000_000)throw Error('Response exceeds 2MB limit');
  const body=await response.text();if(Buffer.byteLength(body,'utf8')>2_000_000)throw Error('Response exceeds 2MB limit');
  return {body,etag:newEtag,httpStatus:response.status};
 }
}

import {validateRemoteConfig,validateRemoteWrite,verifyPassword,
 createSession,setCookie,hasSession} from '../../../../src/remote-auth-v75.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const respond=(body,status=200,headers={})=>Response.json(body,{status,headers:{...noStore,...headers}});
// In-memory, single-owner, single-Next-instance fail-closed global throttle.
// Operator must ALSO configure edge IP rate limiting and avoid multi-replicas.
const limiter=globalThis[Symbol.for('content-studio.v75.login-limiter')]??={
 start:0,failures:0,blockedUntil:0
};
globalThis[Symbol.for('content-studio.v75.login-limiter')]=limiter;
export async function POST(request){
 try{
  validateRemoteConfig();
  validateRemoteWrite(request);
  const now=Date.now();
  if(now<limiter.blockedUntil)return respond({error:'Too many attempts'},429,
   {'Retry-After':String(Math.max(1,Math.ceil((limiter.blockedUntil-now)/1000)))});
  if(now-limiter.start>15*60*1000){limiter.start=now;limiter.failures=0}
  if(Number(request.headers.get('content-length')||0)>1024)return respond({error:'Invalid login'},400);
  const raw=await request.text();
  if(raw.length>1024)return respond({error:'Invalid login'},400);
  let data;
  try{data=JSON.parse(raw)}catch{return respond({error:'Invalid login'},400)}
  if(!data||typeof data.password!=='string'||Object.keys(data).length!==1)
   return respond({error:'Invalid login'},400);
  if(!verifyPassword(data.password)){
   limiter.failures++;
   if(limiter.failures>=8){limiter.blockedUntil=now+15*60*1000;
    return respond({error:'Too many attempts'},429,{'Retry-After':'900'})}
   return respond({error:'Unauthorized'},401);
  }
  limiter.failures=0;
  limiter.blockedUntil=0;
  limiter.start=now;
  return respond({ok:true},200,{'Set-Cookie':setCookie(createSession())});
 }catch{return respond({error:'Login unavailable'},403)}
}

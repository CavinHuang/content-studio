/**
 * V75 single-owner HTTPS Dokploy mode. Cryptographic, short-lived, HttpOnly
 * session; do not trust an arbitrary proxy header as an authentication signal.
 * Host routing, TLS and rate limiting MUST also be enforced by the operator.
 */
import {createHmac,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {env as runtimeEnv} from 'node:process';

export const COOKIE='__Host-content_studio_session';
const ONE_HOUR=3600;
const SESSION_SECONDS=8*ONE_HOUR;
const NONCE=/^[A-Za-z0-9_-]{22,64}$/;
const HTTPS_HOST=/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;
const B64=/^[A-Za-z0-9_-]+$/;
// The legacy $ delimiter is still accepted for existing installations. Newly
// generated ':' verifiers survive Docker Compose .env interpolation unchanged.
const PASSWORD_HASH_LEGACY=/^scrypt\$16384\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/;
const PASSWORD_HASH_COMPOSE_SAFE=/^scrypt:16384:8:1:([A-Za-z0-9_-]{22}):([A-Za-z0-9_-]{86})$/;
const parsePasswordHash=value=>{
 if(typeof value!=='string')return null;
 const match=PASSWORD_HASH_COMPOSE_SAFE.exec(value)||PASSWORD_HASH_LEGACY.exec(value);
 return match?{salt:match[1],digest:match[2]}:null;
};
const safe=(data)=>{throw Object.assign(new Error(data),{status:403})};
const privateKey=env=>{
 const input=env.CONTENT_STUDIO_AUTH_SESSION_KEY||'';
 if(!B64.test(input)||input.length!==43)throw Error('Remote session key must be a random 32-byte base64url value');
 const key=Buffer.from(input,'base64url');
 if(key.length!==32||key.toString('base64url')!==input)throw Error('Invalid random session key encoding');
 return key;
};
export function publicOrigin(env=runtimeEnv){
 const value=env.CONTENT_STUDIO_PUBLIC_ORIGIN;
 let url;
 try{url=new URL(value)}catch{throw Error('Remote mode requires HTTPS public origin')};
 if(url.protocol!=='https:'||url.username||url.password||url.port||
    url.pathname!=='/'||url.search||url.hash||
    (value!==url.origin&&value!==url.origin+'/')||
    !HTTPS_HOST.test(url.hostname)||['localhost','127.0.0.1'].includes(url.hostname)||
    url.hostname.endsWith('.localhost')||url.hostname.includes('..'))
  throw Error('Remote mode requires one canonical HTTPS hostname without path');
 return url.origin;
}
/** Return only fixed, secret-free error codes for Dokploy startup logs. */
export function diagnoseRemoteConfig(env=runtimeEnv){
 const problems=[];
 if(env.CONTENT_STUDIO_DEPLOY_MODE!=='dokploy')problems.push('deployment_mode_invalid');
 try{publicOrigin(env)}catch{problems.push('public_origin_invalid')}
 if(!parsePasswordHash(env.CONTENT_STUDIO_AUTH_PASSWORD_SCRYPT))
  problems.push('password_scrypt_invalid');
 try{privateKey(env)}catch{problems.push('session_key_invalid')}
 if(env.CONTENT_STUDIO_ALLOW_REMOTE==='1'||env.ENABLE_SCENARIO==='1')
  problems.push('unsafe_remote_flags');
 return problems;
}
export function validateRemoteConfig(env=runtimeEnv){
 const problems=diagnoseRemoteConfig(env);
 if(problems.length)throw Error('Unsafe Dokploy authentication configuration: '+problems.join(','));
 return {mode:'dokploy',publicOrigin:publicOrigin(env),credentialsConfigured:true,
  authenticated:true,productionReady:false};
}
export function newCredentials(password,{random=randomBytes}={}){
 if(typeof password!=='string'||password.length<16||password.length>256)
  throw Error('Choose an operator password between 16 and 256 characters');
 const salt=random(16);
 const hash=scryptSync(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
 return {passwordScrypt:'scrypt:16384:8:1:'+salt.toString('base64url')+':'+hash.toString('base64url'),
  sessionKey:random(32).toString('base64url')};
}
export function verifyPassword(password,env=runtimeEnv){
 validateRemoteConfig(env);
 const parsed=parsePasswordHash(env.CONTENT_STUDIO_AUTH_PASSWORD_SCRYPT);
 const expected=Buffer.from(parsed.digest,'base64url');
 // Spend equivalent scrypt time even on incorrect input sizes; do not
 // ever log the input, the hash or the comparison result.
 const candidate=typeof password==='string'&&password.length<=256?password:'';
 const digest=scryptSync(candidate,Buffer.from(parsed.salt,'base64url'),64,
  {N:16384,r:8,p:1,maxmem:64*1024*1024});
 return timingSafeEqual(expected,digest)&&typeof password==='string'&&password.length>=16;
}
function sign(payload,env){
 return createHmac('sha256',privateKey(env))
  .update('cs-v75-session:').update(env.CONTENT_STUDIO_AUTH_PASSWORD_SCRYPT)
  .update(':').update(payload).digest('base64url');
}
export function createSession(env=runtimeEnv,{now=Date.now(),random=randomBytes}={}){
 validateRemoteConfig(env);
 const issued=Math.floor(now/1000),expiry=issued+SESSION_SECONDS,nonce=random(16).toString('base64url');
 if(!NONCE.test(nonce))throw Error('Session entropy invalid');
 const payload=['v1',issued,expiry,nonce].join('.');
 return payload+'.'+sign(payload,env);
}
export function validSession(token,env=runtimeEnv,{now=Date.now()}={}){
 if(env.CONTENT_STUDIO_DEPLOY_MODE!=='dokploy')return false;
 try{
  validateRemoteConfig(env);
  if(typeof token!=='string'||token.length>300)return false;
  const parts=token.split('.');
  if(parts.length!==5||parts[0]!=='v1'||!NONCE.test(parts[3])||
    !/^\d{10,11}$/.test(parts[1])||!/^\d{10,11}$/.test(parts[2])||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[4]))return false;
  const nowSeconds=Math.floor(now/1000),issued=Number(parts[1]),expiry=Number(parts[2]);
  if(!Number.isSafeInteger(issued)||!Number.isSafeInteger(expiry)||
   issued>nowSeconds+60||expiry<=nowSeconds||expiry-issued!==SESSION_SECONDS)return false;
  const payload=parts.slice(0,4).join('.');
  return timingSafeEqual(Buffer.from(parts[4]),Buffer.from(sign(payload,env)));
 }catch{return false}
}
export function cookieFromHeaders(headers){
 const raw=headers?.get?.('cookie')||'';
 if(raw.length>8192)return null;
 const matches=raw.split(';').map(s=>s.trim()).filter(s=>s.startsWith(COOKIE+'='));
 return matches.length===1?matches[0].slice(COOKIE.length+1):null;
}
export function hasSession(headers,env=runtimeEnv){
 return validSession(cookieFromHeaders(headers),env);
}
export function setCookie(value,{clear=false}={}){
 if(clear)return COOKIE+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict';
 return COOKIE+'='+value+'; Path=/; Max-Age='+SESSION_SECONDS+'; Secure; HttpOnly; SameSite=Strict';
}
export function validateRemoteTransport(request,env=runtimeEnv,{allowHealthLoopback=false}={}){
 const target=publicOrigin(env),host=new URL(target).host;
 const rawHost=request.headers.get('host')||'';
 const proto=request.headers.get('x-forwarded-proto');
 const forwardedHost=request.headers.get('x-forwarded-host');
 if(rawHost!==host){
  if(allowHealthLoopback &&
    ['127.0.0.1','localhost'].includes(rawHost.split(':')[0]) &&
    /^((127\.0\.0\.1)|(localhost)):\d{4,5}$/.test(rawHost) &&
    new URL(request.url).pathname==='/api/health')
    return {internalHealth:true,origin:target};
  // Next.js may normalize the Host to its container listener before running
  // proxy.js. Only permit the exact configured internal PORT combined with
  // the original external hostname independently supplied by Traefik.
  const port=env.PORT||'4312';
  const internal=new Set(['127.0.0.1:'+port,'localhost:'+port,
   '0.0.0.0:'+port,'[::1]:'+port,host+':'+port]);
  if(!internal.has(rawHost)||forwardedHost!==host)
   safe('Remote Host header does not match canonical application host');
 }
 // TLS must be enforced by Traefik's websecure router and browser Secure
 // cookies, while x-forwarded-proto remains an additional edge signal.
 if(proto!=='https')safe('Untrusted proxy protocol');
 if(forwardedHost&&forwardedHost!==host)safe('Untrusted proxy forwarded host');
 const site=request.headers.get('sec-fetch-site');
 if(site&&!['none','same-origin','same-site'].includes(site)){
  // 页面导航（GET/HEAD 且非 API）不按跨站拒绝：内容仍由登录门保护
  //（未登录一律 303 到 /signin），跨站写由 validateRemoteWrite 的精确
  // Origin + JSON 头强制。只对 API 面与读之外的请求拒绝跨站上下文，
  // 否则从聊天工具/外部链接点进来后的正常刷新会撞上不可用的 403。
  const path=new URL(request.url).pathname;
  if(path.startsWith('/api/')||(request.method!=='GET'&&request.method!=='HEAD'))
   safe('Cross-site request not permitted');
 }
 return {internalHealth:false,origin:target};
}
export function validateRemoteWrite(request,env=runtimeEnv){
 const transport=validateRemoteTransport(request,env);
 const origin=request.headers.get('origin');
 if(origin!==transport.origin)safe('Same HTTPS Origin required for remote writes');
 if(request.headers.get('sec-fetch-mode')==='navigate')safe('Browser navigation cannot mutate');
 const contentType=request.headers.get('content-type')||'';
 if(!/^application\/json(?:\s*;\s*charset\s*=\s*"?utf-8"?\s*)?$/i.test(contentType))
  throw Object.assign(new Error('JSON Content-Type required'),{status:400});
 return transport;
}

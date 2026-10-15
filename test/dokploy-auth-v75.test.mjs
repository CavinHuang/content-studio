import test from 'node:test';
import assert from 'node:assert/strict';
import {newCredentials,validateRemoteConfig,publicOrigin,verifyPassword,
 createSession,validSession,cookieFromHeaders,hasSession,setCookie,
 validateRemoteTransport,validateRemoteWrite,COOKIE} from '../src/remote-auth-v75.mjs';
import {validateRemoteApiRequest,validateStudioApiRequest}
 from '../src/local-api-boundary.mjs';
import {auditLocalRuntime} from '../scripts/runtime-guard.mjs';
import {dispatchApi} from '../lib/api.mjs';
import {readFileSync} from 'node:fs';

const now=Date.UTC(2026,9,15,0,0,0);
const password='unique-private-passphrase-2026-v75';
const creds=newCredentials(password,{random:size=>Buffer.alloc(size,7)});
const env={CONTENT_STUDIO_DEPLOY_MODE:'dokploy',
 CONTENT_STUDIO_PUBLIC_ORIGIN:'https://studio.example.com',
 CONTENT_STUDIO_AUTH_PASSWORD_SCRYPT:creds.passwordScrypt,
 CONTENT_STUDIO_AUTH_SESSION_KEY:creds.sessionKey,
 CONTENT_STUDIO_ALLOW_REMOTE:'0',ENABLE_SCENARIO:'0',
 HOST:'0.0.0.0',NODE_ENV:'production',PORT:'4312',
 CONTENT_STUDIO_DB_PATH:'/tmp/v75-synthetic-absent.sqlite'};
const cookie=createSession(env,{now,random:size=>Buffer.alloc(size,9)});
const heads=(extra={})=>new Headers({host:'studio.example.com',
 'x-forwarded-proto':'https','x-forwarded-host':'studio.example.com',...extra});
const request=(path,extra={},method='GET',body)=>new Request('http://127.0.0.1:4312'+path,{
 method,headers:heads(extra),...(body===undefined?{}:{body})});
const api=()=>request('/api/status',{cookie:COOKIE+'='+cookie});
const denied=(f,status=403)=>assert.throws(f,e=>e.status===status);
test('V75 strong scrypt verifier and random session key, never raw credential',()=>{
 assert.match(creds.passwordScrypt,/^scrypt\$16384\$8\$1\$/);
 assert.equal(Buffer.from(creds.sessionKey,'base64url').length,32);
 assert.equal(creds.passwordScrypt.includes(password),false);
 assert.equal(verifyPassword(password,env),true);
 assert.equal(verifyPassword('incorrect-password-is-wrong',env),false);
 assert.throws(()=>newCredentials('short'));
});
test('V75 rejects broken public origin, absent secrets and unsafe deployment flags',()=>{
 assert.equal(validateRemoteConfig(env).authenticated,true);
 assert.equal(publicOrigin(env),'https://studio.example.com');
 for(const origin of ['http://studio.example.com','https://localhost',
  'https://studio.example.com/extra','https://studio.example.com/',
  'https://studio.example.com:444','https://a@studio.example.com',
  'https://studio.example.com?x=1']){
  assert.throws(()=>validateRemoteConfig({...env,CONTENT_STUDIO_PUBLIC_ORIGIN:origin}));
 }
 for(const update of [{CONTENT_STUDIO_AUTH_PASSWORD_SCRYPT:''},
  {CONTENT_STUDIO_AUTH_SESSION_KEY:''},{CONTENT_STUDIO_AUTH_SESSION_KEY:'hello'},
  {ENABLE_SCENARIO:'1'},{CONTENT_STUDIO_ALLOW_REMOTE:'1'}])
  assert.throws(()=>validateRemoteConfig({...env,...update}));
});
test('V75 signed 8h cookie is strict HttpOnly, Secure, host-only, expires and rotates',()=>{
 assert.equal(validSession(cookie,env,{now:now+3000}),true);
 assert.equal(validSession(cookie,env,{now:now+8*3600*1000}),false);
 assert.equal(validSession(cookie.slice(0,-1)+'x',env,{now:now+3000}),false);
 assert.equal(validSession(cookie, {...env,CONTENT_STUDIO_AUTH_SESSION_KEY:newCredentials(password).sessionKey},{now:now+3000}),false);
 assert.equal(validSession(cookie,{...env,CONTENT_STUDIO_AUTH_PASSWORD_SCRYPT:newCredentials(password).passwordScrypt},{now:now+3000}),false);
 const header=setCookie(cookie);
 for(const s of [COOKIE+'=', 'Secure','HttpOnly','SameSite=Strict','Path=/','Max-Age=28800'])
  assert.ok(header.includes(s));
 assert.equal(header.includes('Domain='),false);
 assert.ok(setCookie('',{clear:true}).includes('Max-Age=0'));
});
test('V75 cookie parser rejects duplicate cookie and ordinary missing cookie',()=>{
 const h=heads({cookie:COOKIE+'='+cookie});
 assert.equal(cookieFromHeaders(h),cookie);
 assert.equal(cookieFromHeaders(heads({cookie:COOKIE+'='+cookie+'; '+COOKIE+'=evil'})),null);
 assert.equal(cookieFromHeaders(heads()),null);
 assert.equal(hasSession(heads(),env),false);
 assert.equal(validSession(cookie,env,{now:now+1000}),true);
});
test('V75 validates exact HTTPS proxy domain and rejects host/forwarded spoofing',()=>{
 assert.equal(validateRemoteTransport(request('/api/status'),env).origin,env.CONTENT_STUDIO_PUBLIC_ORIGIN);
 for(const headers of [{host:'evil.example'},{host:'studio.example.com:4312'},
  {'x-forwarded-proto':'http'},{'x-forwarded-proto':'https,http'},
  {'x-forwarded-host':'evil.example'},{'x-forwarded-host':'studio.example.com,evil.com'},
  {'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'}])
  denied(()=>validateRemoteTransport(request('/api/status',headers),env));
 assert.equal(validateRemoteTransport(new Request('http://127.0.0.1:4312/api/health',
  {headers:{host:'127.0.0.1:4312'}}),env,{allowHealthLoopback:true}).internalHealth,true);
 denied(()=>validateRemoteTransport(new Request('http://127.0.0.1:4312/api/status',
  {headers:{host:'127.0.0.1:4312'}}),env,{allowHealthLoopback:true}));
});
test('V75 JSON writes require canonical Origin, no forms, navigation or cross-site',()=>{
 const good={'origin':'https://studio.example.com','content-type':'application/json'};
 assert.equal(validateRemoteWrite(request('/api/status',good,'POST','{}'),env).origin,env.CONTENT_STUDIO_PUBLIC_ORIGIN);
 for(const h of [{origin:''},{origin:'http://studio.example.com'},
  {origin:'https://evil.example'},{origin:'https://studio.example.com:444'},
  {origin:'https://studio.example.com/extra'},{'content-type':'text/plain'},
  {'content-type':'application/x-www-form-urlencoded'},{'sec-fetch-mode':'navigate'},
  {'sec-fetch-site':'cross-site'}])
  assert.throws(()=>validateRemoteWrite(request('/api/status',{...good,...h},'POST','{}'),env));
});
test('V75 API boundary allows valid session only and refuses wrong CSRF origin',()=>{
 const valid=createSession(env);
 const auth=request('/api/status',{cookie:COOKIE+'='+valid});
 assert.equal(validateRemoteApiRequest(auth,env).remoteAuthenticated,true);
 const noOrigin=request('/api/status',{cookie:COOKIE+'='+valid,'content-type':'application/json'},'POST','{}');
 denied(()=>validateRemoteApiRequest(noOrigin,env));
 const crossOrigin=request('/api/status',{cookie:COOKIE+'='+valid,'content-type':'application/json',
  origin:'https://evil.example'},'POST','{}');
 denied(()=>validateRemoteApiRequest(crossOrigin,env));
 assert.equal(validateRemoteApiRequest(request('/api/health'),env).health,true);
 denied(()=>validateRemoteApiRequest(request('/api/status'),env),401);
});
test('V75 local runtime stays localhost; remote listener requires fully valid auth',()=>{
 const local=auditLocalRuntime({env:{PORT:'4312',HOST:'127.0.0.1'},strict:false});
 assert.equal(local.loopbackBind,'127.0.0.1');
 assert.equal(local.ready,true);
 const remote=auditLocalRuntime({env,strict:false});
 assert.equal(remote.loopbackBind,'container-network-only');
 assert.equal(remote.ready,true);
 for(const override of [{HOST:'127.0.0.1'}, {CONTENT_STUDIO_AUTH_SESSION_KEY:''},
  {CONTENT_STUDIO_DEPLOY_MODE:'garbage'}])
  assert.equal(auditLocalRuntime({env:{...env,...override},strict:false}).ready,false);
});
test('V75 Dokploy compose has no host ports, no plaintext secrets and no extra replicas',()=>{
 const y=readFileSync(new URL('../compose.dokploy.yml',import.meta.url),'utf8');
 for(const m of ['expose:','- "4312"','HOST: "0.0.0.0"',
  'CONTENT_STUDIO_DEPLOY_MODE: dokploy','CONTENT_STUDIO_PUBLIC_ORIGIN:',
  'CONTENT_STUDIO_AUTH_PASSWORD_SCRYPT:','CONTENT_STUDIO_AUTH_SESSION_KEY:',
  'read_only: true','studio-data:/app/data','no-new-privileges:true'])
  assert.ok(y.includes(m),m);
 assert.ok(!/^\s*ports:/m.test(y));
 assert.ok(!y.includes('network_mode: host'));
 assert.ok(!y.includes('traefik.http.routers'));
});

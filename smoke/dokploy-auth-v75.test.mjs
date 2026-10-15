/**
 * Real Next.js 16 HTTP/Proxy + Auth under synthetic database and simulated
 * HTTPS headers. NO public TLS or external Dokploy platform is touched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {newCredentials,COOKIE} from '../src/remote-auth-v75.mjs';
import {getHeadSha} from '../scripts/build-provenance-v64.mjs';
const delay=ms=>new Promise(done=>setTimeout(done,ms));
async function freePort(){
 const srv=createServer();
 await new Promise(done=>srv.listen(0,'127.0.0.1',done));
 const p=srv.address().port;await new Promise(done=>srv.close(done));return p;
}
async function terminate(process){
 if(process.exitCode!==null||process.signalCode!==null)return;
 process.kill('SIGTERM');
 const exit=new Promise(r=>process.once('exit',r));
 await Promise.race([exit,delay(4500)]);
 if(process.exitCode===null&&process.signalCode===null)process.kill('SIGKILL');
}
test('V75 real Next.js behind simulated HTTPS proxy blocks anonymous content and CSRF writes',
 {timeout:120000},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'cs-v75-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const port=await freePort(),base='http://127.0.0.1:'+port;
 const password='synthetic-v75-testing-password-long';
 const creds=newCredentials(password);
 const env={...process.env,NODE_ENV:'production',PORT:String(port),HOST:'0.0.0.0',HOSTNAME:'',
  CONTENT_STUDIO_DEPLOY_MODE:'dokploy',CONTENT_STUDIO_TEST_DIAGNOSTIC:'1',
  CONTENT_STUDIO_PUBLIC_ORIGIN:'https://studio.example.com',
  CONTENT_STUDIO_AUTH_PASSWORD_SCRYPT:creds.passwordScrypt,
  CONTENT_STUDIO_AUTH_SESSION_KEY:creds.sessionKey,
  CONTENT_STUDIO_ALLOW_REMOTE:'0',ENABLE_SCENARIO:'0',
  CONTENT_STUDIO_DB_PATH:join(dir,'synthetic.sqlite'),NODE_OPTIONS:'',
  CONTENT_AI_API_KEY:'',CONTENT_IMAGE_API_KEY:'',
  CONTENT_IMAGE_OPENAI_API_KEY:'',CONTENT_IMAGE_GEMINI_API_KEY:'',
  CONTENT_IMAGE_QWEN_API_KEY:'',CONTENT_IMAGE_REVIEW_API_KEY:'',
  CONTENT_ILLUSTRATION_PLANNER_API_KEY:''};
 const child=spawn(process.execPath,['scripts/runtime-guard.mjs','start'],{
  cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
 const logs=[];for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{
  if(logs.length<25)logs.push(String(b).slice(0,180))
 });
 const headers={host:'studio.example.com',
  'x-forwarded-proto':'https','x-forwarded-host':'studio.example.com'};
 const req=(route,options={})=>fetch(base+route,{redirect:'manual',
  signal:AbortSignal.timeout(2500),...options,headers:{...headers,...options.headers}});
 try{
  let health,lastCode='none',lastBody='none';
  for(let i=0;i<30;i++){
   if(child.exitCode!==null||child.signalCode!==null)break;
   try{const r=await req('/api/health');lastCode=String(r.status);
    if(r.ok){health=r;break}
    const body=await r.text();
    lastBody=body.startsWith('{')?body.slice(0,140):
      body.startsWith('Forbidden')?'proxy-forbidden':'html-or-text';
   }catch{lastCode='network'}
   await delay(300);
  }
  assert.ok(health,'Dokploy Next HTTP='+lastCode+', kind='+lastBody+'; '+logs.join(' ').slice(0,430));
  assert.equal((await health.json()).runtimeBuild,null);
  const anonPage=await req('/');
  assert.equal(anonPage.status,303,
    'Expected anonymous page redirect; got HTTP '+anonPage.status+
    ', type '+(anonPage.headers.get('content-type')||'none')+
    ', diagnostic '+(anonPage.headers.get('x-content-studio-test-diagnostic')||'none'));
  assert.equal(anonPage.headers.get('location'),'https://studio.example.com/login');
  const anonApi=await req('/api/status');
  assert.equal(anonApi.status,401,
    'Expected API 401, got HTTP '+anonApi.status+
    ', type '+(anonApi.headers.get('content-type')||'none'));
  const loginPage=await req('/login');
  assert.equal(loginPage.status,200);
  assert.match(await loginPage.text(),/登录工作台/);
  const wrong=await req('/api/auth/login',{method:'POST',
   headers:{origin:'https://studio.example.com','content-type':'application/json'},
   body:JSON.stringify({password:'an incorrect admin password'})});
  assert.equal(wrong.status,401);
  const noOrigin=await req('/api/auth/login',{method:'POST',
   headers:{'content-type':'application/json'},body:JSON.stringify({password})});
  assert.equal(noOrigin.status,403);
  const good=await req('/api/auth/login',{method:'POST',
   headers:{origin:'https://studio.example.com','content-type':'application/json'},
   body:JSON.stringify({password})});
  assert.equal(good.status,200);
  const set=good.headers.get('set-cookie');
  assert.match(set,new RegExp(COOKIE));
  assert.match(set,/HttpOnly/);assert.match(set,/Secure/);assert.match(set,/SameSite=Strict/);
  const cookie=set.split(';')[0];
  assert.equal((await req('/',{headers:{cookie}})).status,200);
  const data=await req('/api/status',{headers:{cookie}});
  assert.equal(data.status,200);
  const payload=await data.json();
  assert.equal(payload.authenticatedRemote,true);
  const spoofed=await req('/api/status',{headers:{cookie,host:'evil.example.com'}});
  assert.equal(spoofed.status,403);
  const csrf=await req('/api/editor/projects',{method:'POST',
   headers:{cookie,origin:'https://evil.example','content-type':'application/json'},
   body:'{}'});
  assert.equal(csrf.status,403);
  const loggedOut=await req('/api/auth/logout',{method:'POST',
   headers:{cookie,origin:'https://studio.example.com','content-type':'application/json'},body:'{}'});
  assert.equal(loggedOut.status,200);
  assert.match(loggedOut.headers.get('set-cookie'),/Max-Age=0/);
 }finally{await terminate(child)}
});

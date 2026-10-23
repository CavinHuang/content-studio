/**
 * Real Next.js 16 HTTP/Proxy + Auth + agent NDJSON stream under synthetic
 * databases and simulated HTTPS headers. NO public TLS, no Traefik, no
 * external Dokploy platform is touched; the model provider is a synthetic
 * loopback endpoint and never a real paid service.
 * （Traefik 对 NDJSON 流的缓冲行为不在本测试范围，留操作者 curl -N 实测，
 * 见 EASEL-AGENT-SERVER-PLAN.md §8。）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {newCredentials} from '../src/remote-auth-v75.mjs';
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
const finalResponse=content=>JSON.stringify({choices:[{finish_reason:'stop',message:{role:'assistant',content}}],usage:{total_tokens:100}});
test('V76 dokploy+MULTIUSER topology: login → save draft → agent run → NDJSON → cancel → negatives + per-author isolation',
 {timeout:240000},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'cs-agent-v76-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const port=await freePort(),base='http://127.0.0.1:'+port;
 const password='synthetic-v76-testing-password-long';
 const creds=newCredentials(password);
 // 合成回环模型 provider：默认逐步给一个 write_suggestions 工具调用再收尾；
 // instruction 含「挂起」时把请求保持到 releaseGated()（供取消竞态用）。
 let releaseGated=()=>{};
 const gated=new Promise(r=>{releaseGated=r});
 const model=createServer((req,res)=>{
  let raw='';
  req.on('data',c=>raw+=c);
  req.on('end',()=>{
   let input={},payload={};
   try{input=JSON.parse(raw);payload=JSON.parse(input.messages.at(-1).content)}catch{}
   const toolCall=()=>{
    const from=(payload.markdown||'').indexOf('等待润色');
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:'',tool_calls:[{id:'call_smoke_1',type:'function',
     function:{name:'write_suggestions',arguments:JSON.stringify({reason:'合成冒烟建议，供作者审阅。',
      edits:[{from:Math.max(from,0),to:Math.max(from,0)+4,original:'等待润色',replacement:'已经润色'}]})}}]}}],usage:{total_tokens:100}}));
   };
   if(payload.instruction?.includes('挂起')){gated.then(()=>{res.setHeader('content-type','application/json');res.end(finalResponse('迟到收尾，取消后不覆盖状态'))},()=>{});return}
   if(input.messages?.at(-1)?.role==='tool'){res.setHeader('content-type','application/json');res.end(finalResponse('已提交建议，请作者审阅'));return}
   toolCall();
  });
 });
 const modelPort=await listen(model);
 const env={...process.env,NODE_ENV:'production',PORT:String(port),HOST:'0.0.0.0',HOSTNAME:'',
  CONTENT_STUDIO_DEPLOY_MODE:'dokploy',CONTENT_STUDIO_TEST_DIAGNOSTIC:'1',
  CONTENT_STUDIO_PUBLIC_ORIGIN:'https://studio.example.com',
  CONTENT_STUDIO_AUTH_PASSWORD_SCRYPT:creds.passwordScrypt,
  CONTENT_STUDIO_AUTH_SESSION_KEY:creds.sessionKey,
  CONTENT_STUDIO_MULTIUSER:'1',CONTENT_STUDIO_REGISTRATION_OPEN:'1',
  CONTENT_STUDIO_ALLOW_REMOTE:'0',ENABLE_SCENARIO:'0',
  CONTENT_STUDIO_ACCOUNTS_PATH:join(dir,'accounts'),
  CONTENT_STUDIO_DB_PATH:join(dir,'synthetic.sqlite'),NODE_OPTIONS:'',
  CONTENT_AI_API_KEY:'synthetic-smoke-key',CONTENT_AI_BASE_URL:`http://127.0.0.1:${modelPort}/v1/`,
  CONTENT_AI_MODEL:'synthetic-agent-model',
  CONTENT_IMAGE_API_KEY:'',
  CONTENT_IMAGE_OPENAI_API_KEY:'',CONTENT_IMAGE_GEMINI_API_KEY:'',
  CONTENT_IMAGE_QWEN_API_KEY:'',CONTENT_IMAGE_REVIEW_API_KEY:'',
  CONTENT_ILLUSTRATION_PLANNER_API_KEY:''};
 const child=spawn(process.execPath,['scripts/runtime-guard.mjs','start'],{
  cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
 const logs=[];for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{
  if(logs.length<25)logs.push(String(b).slice(0,180))
 });
 // 模拟 HTTPS 代理头（真实 TLS/Traefik 不在范围）。
 const headers={host:'studio.example.com',
  'x-forwarded-proto':'https','x-forwarded-host':'studio.example.com'};
 const req=(route,options={})=>fetch(base+route,{redirect:'manual',
  signal:AbortSignal.timeout(30000),...options,headers:{...headers,...options.headers}});
 const write=(route,cookie,payload,extra={})=>req(route,{method:'POST',
  headers:{cookie,origin:'https://studio.example.com','content-type':'application/json',...extra.headers},
  body:JSON.stringify(payload),...extra});
 try{
  // ① 匿名面：health 200 且无运行时身份；agent API 401
  let health;
  for(let i=0;i<40;i++){
   if(child.exitCode!==null||child.signalCode!==null)break;
   try{const r=await req('/api/health');if(r.ok){health=r;break}}catch{}
   await delay(300);
  }
  assert.ok(health,'Dokploy agent server did not start; '+logs.join(' ').slice(0,430));
  assert.equal((await health.json()).runtimeBuild,null);
  const anonSkills=await req('/api/creator/agent-skills');
  assert.equal(anonSkills.status,401);
  // ② 注册/登录，断言 __Host-studio_author cookie 属性
  const register=await write('/api/accounts/register','',
   {name:'冒烟作者甲',email:'author-a@example.test',password:'synthetic-strong-password-a'});
  assert.equal(register.status,201);
  const authorLogin=await write('/api/accounts/login','',
   {email:'author-a@example.test',password:'synthetic-strong-password-a'});
  assert.equal(authorLogin.status,200);
  const set=authorLogin.headers.get('set-cookie')||'';
  assert.match(set,/__Host-studio_author=/);
  assert.match(set,/HttpOnly/);assert.match(set,/Secure/);assert.match(set,/SameSite=Strict/);
  const cookieA=set.split(';')[0];
  // ③ 登录态：技能列表 7 个；经 /api/writing 建稿存稿（精确 Origin+JSON）
  const skills=await req('/api/creator/agent-skills',{headers:{cookie:cookieA}});
  assert.equal(skills.status,200);
  assert.equal((await skills.json()).skills.length,7);
  const created=await write('/api/writing/projects',cookieA,{title:'冒烟代理运行的文章'});
  assert.equal(created.status,201);
  const doc=await created.json();
  const seeded=await req(`/api/writing/projects/${doc.projectId}/master`,{method:'PUT',
   headers:{cookie:cookieA,origin:'https://studio.example.com','content-type':'application/json'},
   body:JSON.stringify({expectedRevision:doc.revision,markdown:'# 冒烟文章\n\n这里有一句等待润色的句子。'})});
  assert.equal(seeded.status,200);
  const savedDoc=await seeded.json();
  // ④ 发起运行（consent）→ 201 running
  const started=await write(`/api/creator/projects/${doc.projectId}/agent-runs`,cookieA,
   {skillId:'selection-rewriter',instruction:'请润色待推敲的句子',expectedRevision:savedDoc.revision,allowExternalAI:true,channel:'master'});
  assert.equal(started.status,201);
  const {run}=await started.json();
  assert.equal(run.status,'running');
  // ⑤ 事件流：NDJSON+nosniff，逐步读到 run_done
  const events=await req(`/api/creator/projects/${doc.projectId}/agent-runs/${run.id}/events`,
   {headers:{cookie:cookieA,'accept':'application/x-ndjson'}});
  assert.equal(events.headers.get('content-type'),'application/x-ndjson');
  assert.equal(events.headers.get('x-content-type-options'),'nosniff');
  const frames=await readFrames(events);
  assert.equal(frames.at(-1).kind,'run_done');
  assert.equal(frames.at(-1).status,'completed');
  assert.ok(frames.some(f=>f.kind==='tool'&&f.payload?.name==='write_suggestions'));
  // ⑥ gated provider：挂起的运行 → cancel → cancelled，且流以 run_done(cancelled) 收尾
  const saved2=await req(`/api/writing/projects/${doc.projectId}/master`,{headers:{cookie:cookieA}});
  const revision2=(await saved2.json()).revision;
  const gatedStart=await write(`/api/creator/projects/${doc.projectId}/agent-runs`,cookieA,
   {skillId:'selection-rewriter',instruction:'请挂起处理这份正文',expectedRevision:revision2,allowExternalAI:true,channel:'master'});
  assert.equal(gatedStart.status,201);
  const {run:gatedRun}=await gatedStart.json();
  const gatedEvents=await req(`/api/creator/projects/${doc.projectId}/agent-runs/${gatedRun.id}/events`,
   {headers:{cookie:cookieA,'accept':'application/x-ndjson'}});
  const gatedReader=gatedEvents.body.getReader(),gatedDec=new TextDecoder();let gatedBuf='';
  // 取消先于读尽：挂起期间无步骤帧，取消后下一轮轮询即以 run_done(cancelled) 收尾
  const cancelled=await write(`/api/creator/projects/${doc.projectId}/agent-runs/${gatedRun.id}/cancel`,cookieA,{});
  assert.equal(cancelled.status,200);
  assert.equal((await cancelled.json()).run.status,'cancelled');
  // 流以 run_done(cancelled) 收尾
  let lastFrame=null,guard=0;
  for(;;){const {done,value}=await gatedReader.read();if(done)break;gatedBuf+=gatedDec.decode(value,{stream:true});
   const lines=gatedBuf.split('\n');gatedBuf=lines.pop();
   for(const line of lines)if(line.trim()){const f=JSON.parse(line);if(f.kind)lastFrame=f}
   if(++guard>200)break}
  assert.equal(lastFrame?.kind,'run_done');
  assert.equal(lastFrame?.status,'cancelled');
  // ⑦ 负例：跨站 Origin 写 403；text/plain 写 400；伪造 forwarded host 403
  const crossSite=await req(`/api/writing/projects`,{method:'POST',
   headers:{cookie:cookieA,origin:'https://evil.example','content-type':'application/json'},body:'{}'});
  assert.equal(crossSite.status,403);
  const plainText=await req(`/api/writing/projects`,{method:'POST',
   headers:{cookie:cookieA,origin:'https://studio.example.com','content-type':'text/plain'},body:'{}'});
  assert.equal(plainText.status,400);
  const spoofed=await req('/api/creator/agent-skills',
   {headers:{cookie:cookieA,'x-forwarded-host':'evil.example.com'}});
  assert.equal(spoofed.status,403);
  // ⑧ workspace 隔离双断言：第二作者注册登录后，
  //   列表 GET → 200 且 runs: []（作者各自独立 SQLite，无行早退空数组）；
  //   具名 GET 编造 id → 404（run() 行不存在）。
  await write('/api/accounts/register','',
   {name:'冒烟作者乙',email:'author-b@example.test',password:'synthetic-strong-password-b'});
  const loginB=await write('/api/accounts/login','',
   {email:'author-b@example.test',password:'synthetic-strong-password-b'});
  assert.equal(loginB.status,200);
  const cookieB=(loginB.headers.get('set-cookie')||'').split(';')[0];
  const isolatedList=await req(`/api/creator/projects/${doc.projectId}/agent-runs`,{headers:{cookie:cookieB}});
  assert.equal(isolatedList.status,200);
  assert.deepEqual(await isolatedList.json(),{runs:[]});
  const isolatedNamed=await req(`/api/creator/projects/${doc.projectId}/agent-runs/ar_`+'0'.repeat(36),
   {headers:{cookie:cookieB}});
  assert.equal(isolatedNamed.status,404);
 }finally{
  releaseGated(); // 放行挂起的模型请求，让 provider 可以干净关闭
  await terminate(child);
  await new Promise(r=>model.close(r));
 }
});
async function listen(server){
 await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done)});
 return server.address().port;
}
async function readFrames(response){
 const reader=response.body.getReader(),dec=new TextDecoder();let buf='';const frames=[];
 for(;;){const {done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});
  const lines=buf.split('\n');buf=lines.pop();
  for(const line of lines)if(line.trim())frames.push(JSON.parse(line))}
 return frames;
}

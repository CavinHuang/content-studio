/**
 * V49 production-build process-level restart acceptance.
 * Run after npm run build, against a random 127.0.0.1 port and disposable SQLite.
 * No external network, payment, browser login, or publishing system.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function randomPort(){
 const s=createServer();
 await new Promise((done,fail)=>{s.once('error',fail);s.listen(0,'127.0.0.1',done)});
 const p=s.address().port;await new Promise(done=>s.close(done));return p;
}
async function launch({port,database,log}){
 const safe={
  ...process.env,PORT:String(port),CONTENT_STUDIO_DB_PATH:database,
  CONTENT_STUDIO_ALLOW_REMOTE:'0',ENABLE_SCENARIO:'0',
  CONTENT_IMAGE_OPENAI_API_KEY:'',CONTENT_IMAGE_API_KEY:'',CONTENT_IMAGE_GEMINI_API_KEY:'',
  CONTENT_IMAGE_QWEN_API_KEY:'',CONTENT_ILLUSTRATION_PLANNER_API_KEY:'',
  CONTENT_IMAGE_REVIEW_API_KEY:'',CONTENT_AI_API_KEY:'',
  HOST:'127.0.0.1',HOSTNAME:'',NODE_OPTIONS:''
 };
 for(const name of Object.keys(safe))if(name.startsWith('NEXT_PUBLIC_')&&/SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY|AUTH_KEY/.test(name))delete safe[name];
 const ps=spawn(process.execPath,['scripts/runtime-guard.mjs','start'],{
  cwd:process.cwd(),env:safe,stdio:['ignore','pipe','pipe'],windowsHide:true
 });
 ps.stdout.on('data',x=>{log.push(String(x).slice(0,800))});
 ps.stderr.on('data',x=>{log.push(String(x).slice(0,800))});
 const start=Date.now(),url='http://127.0.0.1:'+port;
 while(Date.now()-start<35000){
  if(ps.exitCode!==null||ps.signalCode!==null)throw Error('Production process exited prematurely: '+log.join('').slice(-1500));
  try{
   const response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1200)});
   if(response.ok){
    const data=await response.json();
    assert.equal(data.framework,'nextjs');assert.equal(data.mode,'local-only');
    return {process:ps,url,health:data};
   }
  }catch{}
  await sleep(250);
 }
 ps.kill('SIGKILL');
 throw Error('Next.js production process failed readiness check: '+log.join('').slice(-1500));
}
async function shutdown(ps){
 if(!ps||ps.exitCode!==null||ps.signalCode!==null)return;
 const finished=new Promise(done=>ps.once('exit',done));
 ps.kill('SIGTERM');
 await Promise.race([finished,sleep(6500)]);
 if(ps.exitCode===null&&ps.signalCode===null){ps.kill('SIGKILL');await Promise.race([finished,sleep(1000)])}
}
async function query(url,method='GET',payload,origin){
 const response=await fetch(url,{method,headers:{
  ...(payload?{'content-type':'application/json'}:{}),...(origin?{origin}:{})
 },body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(6500)});
 const body=await response.json();
 return {status:response.status,...body};
}
test('V49 actual Next.js production build persists editorial and manual review through a full process restart', {timeout:100000},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'content-studio-v49-production-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const db=join(dir,'real-durable.sqlite'),port=await randomPort(),url='http://127.0.0.1:'+port;
 const logs=[];
 let current=null;
 t.after(async()=>shutdown(current?.process));
 try{
  current=await launch({database:db,port,log:logs});
  const created=await query(url+'/api/editor/projects','POST',{title:'V49 production restart integration',paragraphs:[
   {text:'这篇持久化文章通过真正的 Next.js 生产服务器写入 SQLite。'},
   {text:'服务器关闭并重启之后，原始内容、审核和版本号必须保留。'}
  ]},url);
  assert.equal(created.status,201);
  assert.match(created.id,/^ep_/);
  assert.equal(created.channels.wechat.document.revision,1);
  const api='/api/composer/projects/'+created.id+'/wechat';
  const draft=await query(url+api);
  assert.equal(draft.layoutRevision,0);
  const reviewed=await query(url+api+'/review','POST',{
   expectedLayoutRevision:0,expectedDocumentRevision:draft.sourceDocumentRevision,markdown:draft.markdown
  },url);
  assert.equal(reviewed.status,200);
  const imported=await query(url+api,'PUT',{
   expectedLayoutRevision:0,expectedDocumentRevision:draft.sourceDocumentRevision,markdown:draft.markdown,
   reviewToken:reviewed.reviewToken,acknowledgeDrift:true
  },url);
  assert.equal(imported.status,200);
  const checked=await query(url+'/api/editor/projects/'+created.id+'/wechat/checks','POST',{
   expectedRevision:1,checks:{factual:true,privacy:true,rights:true,layout:true}
  },url);
  assert.equal(checked.status,200);
  const endpoint='/api/delivery/projects/'+created.id+'/wechat';
  const waiver=await query(url+endpoint+'/no-images','POST',{
   expectedSourceRevision:1,expectedChannelRevision:1,expectedLayoutRevision:1,
   reason:'该合成回归稿是文字流程验证，不使用任何图片或实际外部平台。'
  },url);
  assert.equal(waiver.status,201);
  assert.equal(waiver.ready,true);
  const snapshot=await query(url+endpoint+'/snapshots','POST',{
   expectedFingerprint:waiver.fingerprint,acknowledgeLocalOnly:true,
   note:'本记录仅用于恢复后状态核验，没有通过任何真实平台验收。'
  },url);
  assert.equal(snapshot.status,201);
  const blockedOrigin=await query(url+'/api/editor/projects','POST',{title:'Forbidden origin'},
    'http://attacker.example:'+port);
  assert.equal(blockedOrigin.status,403);
  const fixture=await query(url+'/api/fixture/seed','POST',{},url);
  assert.equal(fixture.status,403);
  await shutdown(current.process);current=null;
  const restarted=await launch({database:db,port,log:logs});current=restarted;
  const article=await query(url+'/api/editor/projects/'+created.id);
  assert.equal(article.status,200);
  assert.equal(article.title,created.title);
  assert.deepEqual(article.channels.master.document.paragraphs,created.channels.master.document.paragraphs);
  assert.equal(article.channels.wechat.document.revision,1);
  const layout=await query(url+api);
  assert.equal(layout.layoutRevision,1);
  assert.equal(layout.markdown,draft.markdown);
  const after=await query(url+endpoint);
  assert.equal(after.ready,true);
  assert.equal(after.latestSnapshot?.current,true);
  assert.equal(after.published,false);
  assert.equal(after.platformVerified,false);
  const history=await query(url+endpoint+'/history');
  assert.equal(history.history.length,1);
  assert.equal(history.history[0].current,true);
  const outdated=await query(url+'/api/editor/projects/'+created.id+'/master/document','PUT',{
   expectedRevision:0,paragraphs:[{text:'stale write'}]
  },url);
  assert.equal(outdated.status,409);
  const all=await query(url+'/api/editor/projects');
  assert.equal(all.projects.length,1,'Smoke must use only isolated private temporary database');
 }finally{await shutdown(current?.process)}
});

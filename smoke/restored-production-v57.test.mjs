/**
 * V57: boot the actual Next.js production build on a RESTORED copy of a
 * pre-V52 SQLite database and preserve the private source untouched.
 *
 * Synthetic fixture data only; never a customer's original DB, remote host
 * or publication API. Requires npm run build before running this suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createCore} from '../lib/core.mjs';
import {createBackup,restoreBackup,inspectDatabase,verifyBackup} from '../scripts/db-safety.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
const originalURL='https://cdn.example.org/v57-migrated.png';
const replacementURL='https://cdn.example.org/v57-replaced.png';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const fileSha=async(path)=>inspectDatabase(path,{includeContentDigest:true});
async function getPort(){
 const server=createServer();
 await new Promise((ok,fail)=>server.once('error',fail).listen(0,'127.0.0.1',ok));
 const port=server.address().port;
 await new Promise(done=>server.close(done));
 return port;
}
async function startServer(port,db){
 const output=[];
 const safeEnv={...process.env,PORT:String(port),HOST:'127.0.0.1',HOSTNAME:'',
  CONTENT_STUDIO_DB_PATH:db,CONTENT_STUDIO_ALLOW_REMOTE:'0',ENABLE_SCENARIO:'0',
  CONTENT_AI_API_KEY:'',CONTENT_IMAGE_API_KEY:'',CONTENT_IMAGE_OPENAI_API_KEY:'',
  CONTENT_IMAGE_GEMINI_API_KEY:'',CONTENT_IMAGE_QWEN_API_KEY:'',
  CONTENT_IMAGE_REVIEW_API_KEY:'',CONTENT_ILLUSTRATION_PLANNER_API_KEY:'',
  NODE_ENV:'production',NODE_OPTIONS:''};
 for(const key of Object.keys(safeEnv)){
  if(key.startsWith('NEXT_PUBLIC_')&&/(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|AUTH_KEY)/.test(key))
   delete safeEnv[key];
 }
 const child=spawn(process.execPath,['scripts/runtime-guard.mjs','start'],{
  cwd:process.cwd(),env:safeEnv,stdio:['ignore','pipe','pipe'],windowsHide:true
 });
 for(const stream of [child.stdout,child.stderr])
  stream.on('data',buf=>{if(output.length<18)output.push(String(buf).slice(0,160))});
 const url='http://127.0.0.1:'+port;
 let lastStatus='no_http_response',firstHttp=null,lastError='none';
 for(let attempt=0;attempt<130;attempt++){
  if(child.exitCode!==null||child.signalCode!==null)throw Error('Staged Next.js exited before ready');
  try{
   const response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(850)});
   lastStatus='HTTP '+response.status;
   firstHttp??={status:response.status,type:response.headers.get('content-type')};
   if(response.ok){
    const info=await response.json();
    lastStatus='health='+JSON.stringify({framework:info.framework,mode:info.mode,ok:info.ok});
    if(info.framework==='nextjs'&&info.mode==='local-only')return {child,url};
   }
  }catch(error){lastError=String(error?.message||error?.name||'unknown').slice(0,160)}
  await pause(250);
 }
 await stopServer(child);
 throw Error('Staged Next.js on restored copy did not become healthy: '+lastStatus+
  '; firstHttp='+JSON.stringify(firstHttp)+'; err='+lastError+'; startup='+
  output.join('|').replaceAll(db,'<restored-copy>').slice(0,1200));
}
async function stopServer(child){
 if(!child||child.exitCode!==null||child.signalCode!==null)return;
 const done=new Promise(resolve=>child.once('exit',resolve));
 child.kill('SIGTERM');
 await Promise.race([done,pause(5500)]);
 if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await Promise.race([done,pause(1000)])}
}
async function json(url,{method='GET',data,origin}={}){
 const res=await fetch(url,{method,headers:{...(data?{'content-type':'application/json'}:{}),
  ...(origin?{origin}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(6000)});
 return {status:res.status,data:await res.json()};
}
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'content-studio-v57-restore-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const source=join(dir,'untouched-original.sqlite');
 const archive=join(dir,'backup','pre-upgrade.sqlite');
 const restored=join(dir,'sandbox','staging-copy.sqlite');
 const core=createCore(source);
 const project=core.editorial.create({title:'V57 本地旧库升级合成文章',paragraphs:[
  {text:'合成历史内容必须经过真正的生产 Next.js 启动仍保持完整。'},
  {text:'Private original SQLite should never be used by the staging process.'}
 ]});
 const asset=core.assets.upload({name:'v57-synthetic.png',alt:'历史合成图',base64:png});
 core.assets.setMapping(asset.id,'wechat',{url:originalURL,
  note:'V57 测试登记：仅本地合成地址，并未实际上传图片'});
 core.store.db.prepare('INSERT INTO briefs VALUES(?,?,?,?)')
  .run('br_v57_historical','old-project',new Date().toISOString(),
   JSON.stringify({privateSentinel:'V57_SYNTHETIC_DATA_DO_NOT_EXPOSE'}));
 // The historical baseline predates V52 mapping change history. Booting the
 // latest production core must ADD the missing table, not wipe old rows.
 core.store.db.exec('DROP TABLE content_asset_mapping_history');
 core.store.db.exec('PRAGMA wal_autocheckpoint=0');
 const expected=core.editorial.get(project.id);
 t.after(()=>core.close());
 return {dir,source,archive,restored,project,asset,core,expected};
}
test('V57 production Next.js boots a verified pre-V52 restored SQLite copy, migrates additively and survives restart',
 {timeout:170000},async t=>{
 const f=fixture(t);
 const sourceBefore=await fileSha(f.source);
 assert.equal(sourceBefore.integrity,'ok');
 assert.equal(sourceBefore.tableCount>0,true);
 const archive=await createBackup(f.source,{outputPath:f.archive});
 assert.equal(archive.verified,true);
 const checked=await verifyBackup(f.archive,{includeContentDigest:true});
 assert.equal(checked.contentSha256,sourceBefore.contentSha256);
 assert.equal(checked.rowCountsSha256,sourceBefore.rowCountsSha256);
 const restored=await restoreBackup(f.archive,f.restored);
 assert.equal(restored.verified,true);
 assert.equal(restored.existingDatabaseOverwritten,false);
 const oldCopy=new DatabaseSync(f.restored,{readOnly:true});
 try{
  assert.equal(oldCopy.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='content_asset_mapping_history'").get().n,0);
  assert.equal(oldCopy.prepare('SELECT COUNT(*) AS n FROM editorial_projects').get().n,1);
 }finally{oldCopy.close()}
 const port=await getPort(),base='http://127.0.0.1:'+port;
 let server;
 try{
  server=await startServer(port,f.restored);
  const article=await json(base+'/api/editor/projects/'+f.project.id);
  assert.equal(article.status,200);
  assert.equal(article.data.title,f.expected.title);
  assert.deepEqual(article.data.channels.master.document.paragraphs,f.expected.channels.master.document.paragraphs);
  const asset=await json(base+'/api/assets/'+f.asset.id);
  assert.equal(asset.status,200);
  assert.equal(asset.data.mappings[0].url,originalURL);
  const preview=await fetch(base+'/api/assets/'+f.asset.id+'/preview',{signal:AbortSignal.timeout(6500)});
  assert.equal(preview.status,200);
  assert.equal(Buffer.from(await preview.arrayBuffer()).toString('base64'),png);
  const layout=await json(base+'/api/composer/projects/'+f.project.id+'/wechat');
  assert.equal(layout.status,200);
  const audit=await json(base+'/api/composer/projects/'+f.project.id+'/wechat/image-audit');
  assert.equal(audit.status,200);
  assert.equal(audit.data.platformVerified,false);
  const readiness=await json(base+'/api/delivery/projects/'+f.project.id+'/wechat');
  assert.equal(readiness.status,200);
  assert.equal(readiness.data.published,false);
  assert.equal(readiness.data.platformVerified,false);
  const forbidden=await json(base+'/api/fixture/seed',{method:'POST',data:{},origin:base});
  assert.equal(forbidden.status,403);
  // The upgraded table should be writable in staging, not in original.
  const mapping=await json(base+'/api/assets/'+f.asset.id+'/mappings/wechat',{
   method:'PUT',origin:base,data:{url:replacementURL,
    note:'V57 暂存副本上的合成图片地址变更，不代表真实图片上传'}
  });
  assert.equal(mapping.status,200);
  await stopServer(server.child);server=null;
  server=await startServer(port,f.restored);
  const again=await json(base+'/api/assets/'+f.asset.id);
  assert.equal(again.data.mappings[0].url,replacementURL);
  const upgraded=new DatabaseSync(f.restored,{readOnly:true});
  try{
   assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM content_asset_mapping_history').get().n,1);
   assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM editorial_projects').get().n,1);
   assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM briefs').get().n,1);
   assert.equal(Buffer.from(upgraded.prepare('SELECT body FROM content_assets WHERE id=?').get(f.asset.id).body).toString('base64'),png);
   assert.equal(upgraded.prepare('SELECT snapshot FROM briefs WHERE id=?').get('br_v57_historical').snapshot.includes('V57_SYNTHETIC_DATA_DO_NOT_EXPOSE'),true);
  }finally{upgraded.close()}
 }finally{await stopServer(server?.child)}
 const sourceAfter=await fileSha(f.source);
 assert.equal(sourceAfter.schemaSha256,sourceBefore.schemaSha256);
 assert.equal(sourceAfter.rowCountsSha256,sourceBefore.rowCountsSha256);
 assert.equal(sourceAfter.contentSha256,sourceBefore.contentSha256);
 assert.equal(f.core.assets.get(f.asset.id).mappings[0].url,originalURL);
 assert.equal(f.core.editorial.get(f.project.id).title,f.expected.title);
 const untouchedBackup=await verifyBackup(f.archive,{includeContentDigest:true});
 assert.equal(untouchedBackup.contentSha256,sourceBefore.contentSha256);
});
test('V57 tampered archive is refused before a restored production copy can be started',async t=>{
 const f=fixture(t);
 await createBackup(f.source,{outputPath:f.archive});
 const manifest=JSON.parse(readFileSync(f.archive+'.manifest.json','utf8'));
 manifest.sha256='0'.repeat(64);
 writeFileSync(f.archive+'.manifest.json',JSON.stringify(manifest));
 await assert.rejects(()=>restoreBackup(f.archive,f.restored),/SHA256 mismatch/);
 assert.equal(existsSync(f.restored),false);
 assert.equal(f.core.editorial.get(f.project.id).title,f.expected.title);
});

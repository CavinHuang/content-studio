/**
 * V47 end-to-end candidate rehearsal against a disposable restored SQLite copy.
 *
 * Never initializes, edits, overwrites or migrates the operator's original
 * database. Never calls real external image generation or publishing APIs.
 * All simulated author attestations and URLs are strictly test-only.
 */
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createBackup,restoreBackup,inspectDatabase} from './db-safety.mjs';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';

const MAX_PROJECT_SCAN=1000;
// Read every pre-existing table, not a curated list. New modules can register
// new tables without silently falling outside the preservation audit.
const insist=(condition,reason)=>{if(!condition)throw Error(reason)};
const digest=(buffer)=>createHash('sha256').update(buffer).digest('hex');
const quote=(name)=>'"'+name.replaceAll('"','""')+'"';
function hashRow(row){
 const hash=createHash('sha256');
 for(const [key,value] of Object.entries(row)){
  const type=value===null?'null':Buffer.isBuffer(value)||value instanceof Uint8Array?'binary':typeof value;
  const bytes=type==='binary'?Buffer.from(value):Buffer.from(type==='null'?'':String(value));
  hash.update(key+'|'+type+'|'+bytes.length+'|');hash.update(bytes);
 }
 return hash.digest('hex');
}
export function historicalInventory(db){
 const originalTables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
 const inventory={};
 for(const name of originalTables){
  const q=quote(name);
  const high=db.prepare('SELECT MAX(rowid) AS n FROM '+q).get().n||0;
  const h=createHash('sha256');let rows=0;
  for(const row of db.prepare('SELECT * FROM '+q+' ORDER BY rowid').iterate()){
   h.update(hashRow(row)+'\n');rows++;
  }
  inventory[name]={rows,maxRowid:high,sha256:h.digest('hex')};
 }
 return inventory;
}
export function checkHistoricalInventory(db,inventory){
 const missing=[],changed=[];
 for(const [name,previous] of Object.entries(inventory)){
  let result;try{
   const h=createHash('sha256');let rows=0;
   for(const row of db.prepare('SELECT * FROM '+quote(name)+' WHERE rowid<=? ORDER BY rowid').iterate(previous.maxRowid)){
    rows++;h.update(hashRow(row)+'\n');
   }
   result={rows,sha256:h.digest('hex')};
  }catch{missing.push(name);continue}
  if(previous.rows!==result.rows||previous.sha256!==result.sha256)changed.push(name);
 }
 return {passed:missing.length===0&&changed.length===0,
  comparedTables:Object.keys(inventory).length,
  priorRecords:Object.values(inventory).reduce((sum,x)=>sum+x.rows,0),
  missingTables:missing,changedTables:changed};
}
async function route(core,path,method='GET',data){
 const response=await dispatchApi(new Request('http://localhost:4312'+path,{method,
  headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined}),core);
 const result=await response.json();
 if(response.status>=400)throw Error('Synthetic HTTP '+response.status+' at '+method+' '+path+': '+String(result.error||'unknown').slice(0,140));
 return result;
}
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
function fixturePng(index){
 const original=Buffer.from(png,'base64');
 const marker=Buffer.from('v47-'+index);
 const payload=Buffer.concat([Buffer.from('tEXt'),marker]);
 let crc=0xffffffff;
 for(const octet of payload){crc^=octet;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}
 const chunk=Buffer.alloc(8+payload.length);
 chunk.writeUInt32BE(marker.length,0);payload.copy(chunk,4);
 chunk.writeUInt32BE((crc^0xffffffff)>>>0,4+payload.length);
 return Buffer.concat([original.subarray(0,original.length-12),chunk,original.subarray(original.length-12)]).toString('base64');
}
const TEXT=[
 {text:'这是离线升级验收生成的示例文章，只用于校验旧数据库恢复后的编辑与交付功能。'},
 {text:'这里的图像与渠道素材 URL 只是模拟对象，不代表用户真实的图片或第三方平台审核。'},
 {text:'每一个交付完成状态都必须由明确的人工审核记录产生，而不是自动模型生成。'}
];
async function importChannel(core,project,channel,markdown){
 const api='/api/composer/projects/'+project.id+'/'+channel;
 const current=await route(core,api);
 const content=markdown??current.markdown;
 const review=await route(core,api+'/review','POST',{expectedLayoutRevision:current.layoutRevision,
  expectedDocumentRevision:current.sourceDocumentRevision,markdown:content});
 await route(core,api,'PUT',{expectedLayoutRevision:current.layoutRevision,expectedDocumentRevision:current.sourceDocumentRevision,
  markdown:content,reviewToken:review.reviewToken,acknowledgeDrift:true});
 await route(core,'/api/editor/projects/'+project.id+'/'+channel+'/checks','POST',{
  expectedRevision:project.channels[channel].document.revision,
  checks:{factual:true,privacy:true,rights:true,layout:true}});
 return route(core,api);
}
async function textOnlyPath(core){
 const p=await route(core,'/api/editor/projects','POST',{title:'V47 text-only disposable acceptance',paragraphs:TEXT});
 for(const channel of ['wechat','zhihu']){
  const layout=await importChannel(core,p,channel);
  const endpoint='/api/delivery/projects/'+p.id+'/'+channel;
  const initial=await route(core,endpoint);
  insist(!initial.ready,'No-image article unexpectedly ready before explicit waiver');
  const granted=await route(core,endpoint+'/no-images','POST',{
   expectedSourceRevision:1,expectedChannelRevision:1,expectedLayoutRevision:layout.layoutRevision,
   reason:'合成测试中的文字文章不使用图片，需作者主动确认。'});
  insist(granted.ready&&!granted.platformVerified,'Explicit text-only author checklist was not met');
  await route(core,endpoint+'/snapshots','POST',{expectedFingerprint:granted.fingerprint,
   acknowledgeLocalOnly:true,note:'这是合成数据上的人工操作模拟，不代表实际已经在渠道平台发布。'});
  const checked=await route(core,endpoint);
  insist(checked.latestSnapshot?.current,'Stored text-only delivery snapshot not current');
  insist(checked.published===false,'Local test must never report published');
 }
 const updated=await route(core,'/api/editor/projects/'+p.id+'/master/document','PUT',{
  expectedRevision:1,paragraphs:TEXT.map(x=>({text:x.text+' [revision 2]'}))});
 insist(updated.channels.master.document.revision===2,'Synthetic source revision did not update');
 for(const channel of ['wechat','zhihu']){
  const stale=await route(core,'/api/delivery/projects/'+p.id+'/'+channel);
  insist(!stale.ready&&!stale.latestSnapshot?.current,'Changed article retained obsolete delivery readiness');
 }
 return {channels:2,snapshots:2,staleSnapshotsDetected:2};
}
async function illustratedPath(core){
 const p=await route(core,'/api/editor/projects','POST',{title:'V47 illustrated disposable acceptance',paragraphs:TEXT});
 const root='/api/illustrations/projects/'+p.id;
 const plan=await route(core,root+'/plan','POST',{expectedMasterRevision:1});
 core.illustrations.generator=async(_prompt,{provider})=>({
  base64:fixturePng(core.illustrations.__v47Index=(core.illustrations.__v47Index||0)+1),
  provider,model:'v47-local-deterministic-fake'
 });
 for(const shot of plan.shots){
  await route(core,root+'/shots/'+shot.id+'/generate','POST',{allowExternalAI:true,provider:'openai'});
  await route(core,root+'/shots/'+shot.id+'/decision','POST',{decision:'approve'});
  const state=await route(core,root),selected=state.shots.find(x=>x.id===shot.id);
  insist(selected?.status==='approved','Synthetic image not approved');
  for(const channel of ['wechat','zhihu']){
   await route(core,'/api/assets/'+selected.assetId+'/mappings/'+channel,'PUT',{
    url:'https://cdn.example.org/v47-'+channel+'-'+shot.ordinal+'.png',
    note:'合成测试模拟作者手动上传与地址登记'});
  }
  await route(core,root+'/shots/'+shot.id+'/quality-reviews','POST',{
   assetId:selected.assetId,expectedAssetSha256:selected.asset.sha256,
   expectedShotUpdatedAt:selected.updatedAt,expectedSourceRevision:state.sourceRevision,
   expectedProfileRevision:state.visualProfile.revision,
   ratings:{briefFit:4,clarity:4,mobileReadability:4,styleConsistency:4},
   riskFlags:[],rightsReviewed:true,factualReviewed:true,recommendation:'recommended',
   note:'合成验收为图片记录模拟作者的主观评价，不包含第三方授权或真实权利结论。'
  });
 }
 for(const channel of ['wechat','zhihu']){
  const proposal=await route(core,root+'/handoff/'+channel);
  insist(proposal.ready,'Synthetic image handoff unexpectedly blocked');
  await importChannel(core,p,channel,proposal.markdown);
  const match=await route(core,root+'/image-roundtrip/'+channel);
  insist(match.ready&&match.matchedCount===plan.shots.length,'Saved images differ from approved channel mappings');
  const qa=await route(core,root+'/handoff-qa/'+channel);
  insist(qa.readyForManualQA,'Synthetic handoff cannot be recorded');
  await route(core,root+'/handoff-qa/'+channel,'POST',{
   expectedSourceRevision:qa.sourceRevision,expectedLayoutRevision:qa.layoutRevision,
   expectedProposalSha256:qa.proposalSha256,
   checks:{rightsReviewed:true,uploadConfirmed:true,desktopPasteConfirmed:true,mobilePreviewConfirmed:true},
   note:'此记录来自本地合成回归演练，不代表真实公众号、知乎或浏览器已被检查。'
  });
  const stage=await route(core,'/api/delivery/projects/'+p.id+'/'+channel);
  insist(stage.ready&&stage.platformVerified===false&&!stage.published,'Synthetic illustrated delivery readiness blocked or misrepresented');
  await route(core,'/api/delivery/projects/'+p.id+'/'+channel+'/snapshots','POST',{
   expectedFingerprint:stage.fingerprint,acknowledgeLocalOnly:true,
   note:'这是完整配图工作流的本地模拟验收，绝不代表实际账号、价格或渠道审核通过。'
  });
 }
 const state=await route(core,root);
 await route(core,'/api/assets/'+state.shots[0].assetId+'/mappings/wechat','PUT',{
  url:'https://cdn.example.org/v47-wechat-updated.png',note:'模拟用户后续修改图片地址'});
 const stale=await route(core,'/api/delivery/projects/'+p.id+'/wechat');
 const unaffected=await route(core,'/api/delivery/projects/'+p.id+'/zhihu');
 insist(!stale.ready&&!stale.latestSnapshot?.current,'Changed image mapping did not invalidate WeChat');
 insist(unaffected.ready&&unaffected.latestSnapshot?.current,'WeChat image change leaked into Zhihu readiness');
 return {images:plan.shots.length,channels:2,snapshots:2,
  staleImageMappingDetected:true,otherChannelUnaffected:true};
}
export async function integrationRehearsal(sourcePath,{makeCore=createCore,backup=createBackup,restore=restoreBackup}={}){
 if(typeof sourcePath!=='string'||!sourcePath.trim())throw Error('Explicit --db path required for offline acceptance');
 const source=resolve(sourcePath);
 const base=await mkdtemp(join(tmpdir(),'content-studio-v47-'));
 try{
  const snapshot=join(base,'snapshot.sqlite'),copy=join(base,'candidate.sqlite');
  const backupResult=await backup(source,{outputPath:snapshot});
  insist(backupResult.verified,'SQLite backup not verified');
  await restore(snapshot,copy);
  const reader=new DatabaseSync(copy,{readOnly:true});let original;
  try{original=historicalInventory(reader)}finally{reader.close()}
  const core=makeCore(copy);
  let inspected=0,baseline,madeText,madeImages;
  try{
   const historical=core.store.db.prepare('SELECT id FROM editorial_projects ORDER BY id').all();
   insist(historical.length<=MAX_PROJECT_SCAN,'Historical projects exceed exhaustive acceptance scan limit');
   for(const row of historical){
    const item=core.editorial.get(row.id);
    insist(item.channels.master.document?.paragraphs?.length>0,'Historical article lacks master document');
    for(const channel of ['wechat','zhihu']){
     insist(!!item.channels[channel]?.document,'Historical article lacks channel document');
     core.editorial.layoutDraft(row.id,channel);
     const image=core.illustrations.get(row.id);
     if(image.plan)core.deliveryReadiness.get(row.id,channel);
    }
    inspected++;
   }
   baseline=checkHistoricalInventory(core.store.db,original);
   insist(baseline.passed,'Historical user data changed during candidate initialization');
   madeText=await textOnlyPath(core);
   madeImages=await illustratedPath(core);
   const unchanged=checkHistoricalInventory(core.store.db,original);
   insist(unchanged.passed,'Historical user data changed during synthetic workflow');
  }finally{core.close()}
  const verified=await inspectDatabase(copy);
  insist(verified.integrity==='ok','Restored candidate SQLite integrity failed');
  return {kind:'content-studio-v47-restored-acceptance',sourceUntouched:true,
   backupVerified:true,backupSha256:backupResult.sha256,restoredIntegrity:verified.integrity,
   historicProjectsInspected:inspected,historicTablesProtected:baseline.comparedTables,
   historicRowsProtected:baseline.priorRecords,
   synthetic:{textOnly:madeText,illustrated:madeImages},
   syntheticOnly:true,existingRowsUnchanged:true,
   paidModelRequests:0,platformVerified:false,actualPublishing:false,productionReady:false,
   temporaryCopiesDeleted:true,
   note:'Synthetic local author checks do not verify paid providers, external doocs/md or real WeChat/Zhihu platforms.'};
 }finally{await rm(base,{recursive:true,force:true})}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const argv=process.argv.slice(2);
 if(argv.length!==1||!argv[0].startsWith('--db=')||argv[0].length<=5){
  console.error('Usage: npm run release:rehearse -- --db=/absolute/path/content-studio.sqlite');
  process.exitCode=1;
 }else integrationRehearsal(argv[0].slice(5)).then(v=>console.log(JSON.stringify(v,null,2)))
  .catch(e=>{console.error('Restored acceptance failed: '+String(e.message).slice(0,240));process.exitCode=1});
}

import http from 'node:http';import {readFile} from 'node:fs/promises';import {join,dirname,extname,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
// 本遗留单用户演示服务器不含作者隔离（多用户模式的核心边界）。
// 在多用户姿态下拒绝启动（fail-closed），防止旁路绕过作者工作空间隔离。
if(process.env.CONTENT_STUDIO_MULTIUSER==='1'){console.error('Refusing to start: the legacy single-user server has no author isolation. Use `npm start` (Next.js) with CONTENT_STUDIO_MULTIUSER=1 instead.');process.exit(78)}
console.warn('Legacy single-user server: no author isolation; local demo/tests only.');
import {Store} from './store.mjs';import {SyncEngine} from './sync.mjs';import {defaultSources} from './adapters.mjs';import {seedScenario} from './fixtures.mjs';import {SelectedMirror} from './selected.mjs';import {rankEvents,withVerification,analyzeWithModel,modelConfigured} from './opportunities.mjs';import {VerificationService} from './verification.mjs';import {KnowledgeService} from './knowledge.mjs';import {PrecisionService} from './precision.mjs';import {EditorialService} from './editorial.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),port=Number(process.env.PORT||4312);const store=new Store(process.env.DB_PATH||join(root,'data','content-studio.sqlite'));const sync=new SyncEngine(store);const selected=new SelectedMirror(store);const verification=new VerificationService(store);const knowledge=new KnowledgeService(store,verification);const precision=new PrecisionService(store,verification,knowledge);const editorial=new EditorialService(store,knowledge,precision);editorial.attachPrecision();
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8'};
function json(res,obj,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj));}
const readBody=async(req)=>{let a='';for await(const chunk of req){a+=chunk;if(a.length>100_000)throw Error('Request payload too large');}return a?JSON.parse(a):{};};
const error=(res,e,status=400)=>json(res,{error:e.message},status);
const server=http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,'http://localhost'),p=u.pathname; if(['POST','PATCH','DELETE'].includes(req.method)&&req.headers.origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))return error(res,Error('Origin not permitted'),403);if(req.method==='GET'&&p==='/api/health')return json(res,{ok:true,mode:'real-connectors-ready',serverTime:new Date().toISOString()});
 if(req.method==='GET'&&p==='/api/status')return json(res,{mode:'real-api-not-auto-synced',sources:sync.sourceStatus(),selected:selected.status(),aiConfigured:modelConfigured(),stats:store.stats()});
 if(req.method==='POST'&&p==='/api/selected/sync'){const result=await selected.sync();return json(res,result,result.status==='error'?502:200);}
 if(req.method==='GET'&&p==='/api/opportunities')return json(res,{opportunities:withVerification(rankEvents(store.events({limit:10000}),{filter:u.searchParams.get('filter')||'all',limit:10000}),id=>verification.byEvent(id)).slice(0,Math.max(1,Math.min(Number(u.searchParams.get('limit'))||30,100))),mode:'rule-based with author-recorded verification; not independent validation',aiConfigured:modelConfigured()});
 if(req.method==='GET'&&p==='/api/editor/projects')return json(res,{projects:editorial.list(),scope:'Local editorial records; no platform integration'});
 if(req.method==='POST'&&p==='/api/editor/projects')return json(res,editorial.create(await readBody(req)),201);
 const editorMatch=p.match(/^\/api\/editor\/projects\/(ep_[a-z0-9-]+)(?:\/(master|wechat|zhihu)(?:\/(document|refresh|checks|export|exports|reported))?|\/knowledge)?$/);
 if(editorMatch){const id=editorMatch[1],channel=editorMatch[2],action=editorMatch[3];
  if(req.method==='GET'&&!channel&&!p.endsWith('/knowledge'))return json(res,editorial.get(id));
  if(req.method==='POST'&&!channel&&p.endsWith('/knowledge'))return json(res,editorial.attachKnowledge(id,await readBody(req)));
  if(req.method==='PUT'&&action==='document')return json(res,editorial.save(id,channel,await readBody(req)));
  if(req.method==='POST'&&action==='refresh')return json(res,editorial.copyMaster(id,channel,await readBody(req)));
  if(req.method==='POST'&&action==='checks')return json(res,editorial.setChecks(id,channel,await readBody(req)));
  if(req.method==='POST'&&action==='export')return json(res,editorial.exportChannel(id,channel,await readBody(req)));
  if(req.method==='GET'&&action==='exports')return json(res,{exports:editorial.exports(id,channel)});
  if(req.method==='POST'&&action==='reported')return json(res,editorial.reported(id,channel,await readBody(req)));
 }
 if(req.method==='GET'&&p==='/api/precision')return json(res,precision.overview());
 if(req.method==='POST'&&p==='/api/precision/documents')return json(res,precision.saveDocument(await readBody(req)),201);
 if(req.method==='GET'&&/^\/api\/precision\/documents\/cr_[a-z0-9-]+$/.test(p))return json(res,precision.document(p.split('/').pop())||{error:'No article draft'},precision.document(p.split('/').pop())?200:404);
 if(req.method==='GET'&&/^\/api\/precision\/documents\/cr_[a-z0-9-]+\/history$/.test(p))return json(res,{history:precision.history(p.split('/')[4])});
 if(req.method==='POST'&&p==='/api/precision/claims')return json(res,precision.addClaim(await readBody(req)),201);
 if(req.method==='POST'&&p==='/api/precision/corrections/scan')return json(res,precision.scan());
 if(req.method==='POST'&&/^\/api\/precision\/corrections\/ct_[a-z0-9-]+\/propose$/.test(p))return json(res,precision.propose(p.split('/')[4],await readBody(req)));
 if(req.method==='POST'&&/^\/api\/precision\/corrections\/ct_[a-z0-9-]+\/decide$/.test(p))return json(res,precision.decide(p.split('/')[4],await readBody(req)));
 if(req.method==='GET'&&p==='/api/knowledge')return json(res,knowledge.overview());
 if(req.method==='GET'&&/^\/api\/knowledge\/kc_[a-z0-9-]+$/.test(p))return json(res,knowledge.get(p.split('/').pop()));
 if(req.method==='POST'&&p==='/api/knowledge'){const b=await readBody(req);return json(res,knowledge.publish(b.caseId,b),201)}
 if(req.method==='GET'&&p==='/api/content-references')return json(res,{references:knowledge.references()});
 if(req.method==='POST'&&p==='/api/content-references')return json(res,knowledge.link(await readBody(req)),201);
 if(req.method==='POST'&&/^\/api\/content-references\/cr_[a-z0-9-]+\/review$/.test(p))return json(res,knowledge.review(p.split('/')[3],await readBody(req)));
 if(req.method==='GET'&&p==='/api/feedback')return json(res,{feedback:knowledge.feedback()});
 if(req.method==='POST'&&p==='/api/feedback'){const b=await readBody(req);return json(res,knowledge.addFeedback(b.referenceId,b),201)}
 if(req.method==='POST'&&/^\/api\/feedback\/fb_[a-z0-9-]+\/promote$/.test(p))return json(res,knowledge.promote(p.split('/')[3]),201);
 if(req.method==='GET'&&p==='/api/validations')return json(res,{cases:verification.list()});
 if(req.method==='POST'&&p==='/api/validations'){const b=await readBody(req);const ev=store.event(String(b.eventId||''));if(!ev)return error(res,Error('Event not found'),404);return json(res,verification.create(ev,b),201);}
 const vmatch=p.match(/^\/api\/validations\/(vc_[a-z0-9-]+)(?:\/(evidence|decision|reopen))?$/);
 if(vmatch){const id=vmatch[1],action=vmatch[2];if(req.method==='GET'&&!action)return json(res,verification.get(id));if(req.method==='PATCH'&&!action)return json(res,verification.update(id,await readBody(req)));if(req.method==='POST'&&action==='evidence')return json(res,verification.addEvidence(id,await readBody(req)),201);if(req.method==='POST'&&action==='decision')return json(res,verification.decide(id,await readBody(req)));if(req.method==='POST'&&action==='reopen')return json(res,verification.reopen(id,await readBody(req)));}
 
 if(req.method==='POST'&&p==='/api/opportunities/analyze'){if(!modelConfigured())return error(res,Error('Configure CONTENT_AI_API_KEY, CONTENT_AI_BASE_URL and CONTENT_AI_MODEL'),503);const b=await readBody(req);const ev=store.event(String(b.eventId||''));if(!ev)return error(res,Error('Event not found'),404);return json(res,await analyzeWithModel(ev));}
 if(req.method==='GET'&&p==='/api/events')return json(res,{events:store.events({q:u.searchParams.get('q')||'',limit:Math.min(Math.max(Number(u.searchParams.get('limit'))||80,1),300)}),stats:store.stats()});
 if(req.method==='GET'&&/^\/api\/events\/[a-f0-9]{24}$/.test(p)){const a=store.event(p.split('/').pop());return json(res,a||{error:'Not found'},a?200:404)}
 if(req.method==='GET'&&p==='/api/briefs')return json(res,{briefs:store.listBriefs()});
 if(req.method==='GET'&&/^\/api\/briefs\/br_[a-f0-9]{24}$/.test(p)){const b=store.brief(p.split('/').pop());return json(res,b||{error:'Not found'},b?200:404)}
 if(req.method==='POST'&&p==='/api/sync'){const b=await readBody(req);if(b.sourceId&&!defaultSources.find(x=>x.id===b.sourceId))return error(res,Error('Unknown configured source'));return json(res,await sync.sync({id:b.sourceId||null,force:Boolean(b.force)}));}
 if(req.method==='POST'&&p==='/api/fixture/seed'){if(process.env.ENABLE_SCENARIO!=='1')return error(res,Error('Enable with ENABLE_SCENARIO=1'),403);return json(res,await seedScenario(store,defaultSources));}
 if(req.method==='POST'&&p==='/api/briefs'){const b=await readBody(req),event=store.event(b.eventId)||verification.eventSnapshot(b.eventId);if(!event)return error(res,Error('Event not found'),404);return json(res,store.createBrief(event,verification.snapshotForBrief(event.id)),201);}
 if(req.method==='GET'&&['/','/live','/app','/opportunities','/verification','/knowledge','/precision','/editor','/favicon.ico'].includes(p)){const file=p==='/app'?'app.html':p==='/opportunities'?'opportunities.html':p==='/verification'?'verification.html':p==='/knowledge'?'knowledge.html':p==='/precision'?'precision.html':p==='/editor'?'editor.html':p==='/favicon.ico'?'favicon.svg':'live.html';if(file==='favicon.svg')return json(res,{error:'favicon unavailable'},404);const data=await readFile(join(root,'public',file));res.writeHead(200,{'Content-Type':MIME[extname(file)],'Cache-Control':'no-cache','Content-Security-Policy':"default-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:;"});res.end(data);return;}
 return json(res,{error:'Not found'},404);
 }catch(e){error(res,e,e.status||500)}});
if(process.env.NODE_ENV!=='test')server.listen(port,'127.0.0.1',()=>console.log(`Content Studio V27 → http://127.0.0.1:${port}/live`));
export {server,store,sync,selected,verification,knowledge,precision,editorial};

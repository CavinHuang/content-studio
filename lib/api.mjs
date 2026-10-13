import { getCore } from './core.mjs';
import { seedScenario } from '../src/fixtures.mjs';
import { rankEvents, withVerification, analyzeWithModel, modelConfigured } from '../src/opportunities.mjs';

const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff' } });
const fail = (message, status = 400) => json({ error:message },status);
const boundedLimit = (v, fallback=30, max=300) => Math.min(Math.max(Number(v)||fallback,1),max);
async function body(request) {
  const len = Number(request.headers.get('content-length'));
  if (len>250_000) throw Object.assign(new Error('Request payload too large'),{status:413});
  const raw = await request.text();
  if (raw.length>250_000) throw Object.assign(new Error('Request payload too large'),{status:413});
  try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('Invalid JSON body'),{status:400}); }
}
function enforceLocalHost(request) {
  // Fail closed until the application gains multi-user identity & authorization.
  const hostname = new URL(request.url).hostname;
  const fromHost = (request.headers.get('host') || '').split(':')[0];
  if (process.env.CONTENT_STUDIO_ALLOW_REMOTE === '1') return; // operator opt-in, NOT authentication
  if (!['localhost','127.0.0.1','[::1]','::1'].includes(hostname) || (fromHost && !['localhost','127.0.0.1','[::1]','::1'].includes(fromHost))) {
    throw Object.assign(new Error('Local-only application: remote exposure disabled'),{status:403});
  }
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).origin !== new URL(request.url).origin) throw Object.assign(new Error('Origin not permitted'),{status:403});
}
export async function dispatchApi(request, core = getCore()) {
  try {
    enforceLocalHost(request);
    const {store,sync,selected,verification,knowledge,precision,editorial,defaultSources} = core;
    const url = new URL(request.url), p=url.pathname, method=request.method;
    if (method==='GET' && p==='/api/health') return json({ ok:true, framework:'nextjs', mode:'local-only', serverTime:new Date().toISOString() });
    if (method==='GET' && p==='/api/status') return json({ mode:'real-api-not-auto-synced', sources:sync.sourceStatus(), selected:selected.status(), aiConfigured:modelConfigured(), stats:store.stats() });
    if (method==='POST' && p==='/api/selected/sync') { const r=await selected.sync(); return json(r,r.status==='error'?502:200); }
    if (method==='GET' && p==='/api/events') return json({events:store.events({q:url.searchParams.get('q')||'',limit:boundedLimit(url.searchParams.get('limit'),80)}),stats:store.stats()});
    if (method==='GET' && /^\/api\/events\/[a-f0-9]{24}$/.test(p)) { const e=store.event(p.split('/').pop()); return json(e||{error:'Event not found'},e?200:404); }
    if (method==='GET' && p==='/api/opportunities') {
      const events=rankEvents(store.events({limit:10000}),{filter:url.searchParams.get('filter')||'all',limit:10000});
      return json({opportunities:withVerification(events,id=>verification.byEvent(id)).slice(0,boundedLimit(url.searchParams.get('limit'),30,100)),aiConfigured:modelConfigured(),mode:'Explainable rules; unverified signals are not established needs'});
    }
    if (method==='POST' && p==='/api/opportunities/analyze') { if(!modelConfigured()) return fail('Configure CONTENT_AI_API_KEY, CONTENT_AI_BASE_URL, CONTENT_AI_MODEL',503); const b=await body(request),ev=store.event(String(b.eventId||'')); return ev?json(await analyzeWithModel(ev)):fail('Event not found',404); }
    if (method==='POST' && p==='/api/sync') {const b=await body(request); if(b.sourceId&&!defaultSources.find(s=>s.id===b.sourceId))return fail('Unknown configured source'); return json(await sync.sync({id:b.sourceId||null,force:!!b.force}));}
    if (method==='POST' && p==='/api/fixture/seed') {if(process.env.ENABLE_SCENARIO!=='1')return fail('Demo fixtures disabled',403);return json(await seedScenario(store,defaultSources));}
    if (method==='GET' && p==='/api/briefs') return json({briefs:store.listBriefs()});
    if (method==='GET' && /^\/api\/briefs\/br_[a-f0-9]{24}$/.test(p)) {const b=store.brief(p.split('/').pop());return json(b||{error:'Brief not found'},b?200:404);}
    if (method==='POST' && p==='/api/briefs') {const b=await body(request),ev=store.event(b.eventId)||verification.eventSnapshot(b.eventId);return ev?json(store.createBrief(ev,verification.snapshotForBrief(ev.id)),201):fail('Event not found',404);}
    if (method==='GET' && p==='/api/editor/projects') return json({projects:editorial.list(),scope:'Local-only; publication is never verified automatically'});
    if (method==='POST' && p==='/api/editor/projects') return json(editorial.create(await body(request)),201);
    const handoff = p.match(/^\/api\/composer\/projects\/(ep_[a-z0-9-]+)\/(wechat|zhihu)(?:\/(history))?$/);
    if(handoff){const [,id,ch,history]=handoff;
      if(method==='GET'&&history)return json({history:editorial.layoutHistory(id,ch)});
      if(method==='GET'&&!history)return json(editorial.layoutDraft(id,ch));
      if(method==='PUT'&&!history)return json(editorial.saveLayoutDraft(id,ch,await body(request)));
    }

    const ep=p.match(/^\/api\/editor\/projects\/(ep_[a-z0-9-]+)(?:\/(master|wechat|zhihu)(?:\/(document|refresh|checks|export|exports|reported))?|\/knowledge)?$/);
    if(ep){const [,id,ch,action]=ep;
      if(method==='GET'&&!ch&&!p.endsWith('/knowledge'))return json(editorial.get(id));
      if(method==='POST'&&!ch&&p.endsWith('/knowledge'))return json(editorial.attachKnowledge(id,await body(request)));
      if(method==='PUT'&&action==='document')return json(editorial.save(id,ch,await body(request)));
      if(method==='POST'&&action==='refresh')return json(editorial.copyMaster(id,ch,await body(request)));
      if(method==='POST'&&action==='checks')return json(editorial.setChecks(id,ch,await body(request)));
      if(method==='POST'&&action==='export')return json(editorial.exportChannel(id,ch,await body(request)));
      if(method==='GET'&&action==='exports')return json({exports:editorial.exports(id,ch)});
      if(method==='POST'&&action==='reported')return json(editorial.reported(id,ch,await body(request)));
    }
    if(method==='GET'&&p==='/api/precision')return json(precision.overview());
    if(method==='POST'&&p==='/api/precision/documents')return json(precision.saveDocument(await body(request)),201);
    if(method==='GET'&&/^\/api\/precision\/documents\/cr_[a-z0-9-]+$/.test(p)){const d=precision.document(p.split('/').pop());return json(d||{error:'Not found'},d?200:404);}
    if(method==='GET'&&/^\/api\/precision\/documents\/cr_[a-z0-9-]+\/history$/.test(p))return json({history:precision.history(p.split('/')[4])});
    if(method==='POST'&&p==='/api/precision/claims')return json(precision.addClaim(await body(request)),201);
    if(method==='POST'&&p==='/api/precision/corrections/scan')return json(precision.scan());
    if(method==='POST'&&/^\/api\/precision\/corrections\/ct_[a-z0-9-]+\/propose$/.test(p))return json(precision.propose(p.split('/')[4],await body(request)));
    if(method==='POST'&&/^\/api\/precision\/corrections\/ct_[a-z0-9-]+\/decide$/.test(p))return json(precision.decide(p.split('/')[4],await body(request)));
    if(method==='GET'&&p==='/api/knowledge')return json(knowledge.overview());
    if(method==='GET'&&/^\/api\/knowledge\/kc_[a-z0-9-]+$/.test(p))return json(knowledge.get(p.split('/').pop()));
    if(method==='POST'&&p==='/api/knowledge'){const b=await body(request);return json(knowledge.publish(b.caseId,b),201);}
    if(method==='GET'&&p==='/api/content-references')return json({references:knowledge.references()});
    if(method==='POST'&&p==='/api/content-references')return json(knowledge.link(await body(request)),201);
    if(method==='POST'&&/^\/api\/content-references\/cr_[a-z0-9-]+\/review$/.test(p))return json(knowledge.review(p.split('/')[3],await body(request)));
    if(method==='GET'&&p==='/api/feedback')return json({feedback:knowledge.feedback()});
    if(method==='POST'&&p==='/api/feedback'){const b=await body(request);return json(knowledge.addFeedback(b.referenceId,b),201);}
    if(method==='POST'&&/^\/api\/feedback\/fb_[a-z0-9-]+\/promote$/.test(p))return json(knowledge.promote(p.split('/')[3]),201);
    if(method==='GET'&&p==='/api/validations')return json({cases:verification.list()});
    if(method==='POST'&&p==='/api/validations'){const b=await body(request),ev=store.event(String(b.eventId||''));return ev?json(verification.create(ev,b),201):fail('Event not found',404);}
    const vc=p.match(/^\/api\/validations\/(vc_[a-z0-9-]+)(?:\/(evidence|decision|reopen))?$/);
    if(vc){const [,id,action]=vc;
      if(method==='GET'&&!action)return json(verification.get(id));
      if(method==='PATCH'&&!action)return json(verification.update(id,await body(request)));
      if(method==='POST'&&action==='evidence')return json(verification.addEvidence(id,await body(request)),201);
      if(method==='POST'&&action==='decision')return json(verification.decide(id,await body(request)));
      if(method==='POST'&&action==='reopen')return json(verification.reopen(id,await body(request)));
    }
    return fail('API route not found',404);
  }catch(e){const status=[400,401,403,404,409,413,422,429,500,502,503].includes(e?.status)?e.status:500;return fail(status===500?'Internal server error':String(e?.message||'Request failed'),status);}
}

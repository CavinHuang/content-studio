import { getCore } from './core.mjs';
import {env as runtimeEnv} from 'node:process';
import {activeDatabaseIdentity} from '../src/candidate-db-identity-v68.mjs';
import {currentCandidateOsProof} from '../src/candidate-os-boundary-v69.mjs';
import { validateStudioApiRequest } from '../src/local-api-boundary.mjs';
import {hasSession} from '../src/remote-auth-v75.mjs';
import { providerContractPreflight } from '../src/image-providers.mjs';
import { inspectDoocsService } from '../src/doocs-local-preflight.mjs';
import { inspectMappedChannelImages } from '../src/public-image-probe.mjs';
import { seedScenario } from '../src/fixtures.mjs';
import { rankEvents, withVerification, analyzeWithModel, modelConfigured } from '../src/opportunities.mjs';

const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff' } });
const fail = (message, status = 400) => json({ error:message },status);
const boundedLimit = (v, fallback=30, max=300) => Math.min(Math.max(Number(v)||fallback,1),max);
async function body(request, maxChars = 250_000) {
  const len = Number(request.headers.get('content-length'));
  if (len>maxChars) throw Object.assign(new Error('Request payload too large'),{status:413});
  const raw = await request.text();
  if (raw.length>maxChars) throw Object.assign(new Error('Request payload too large'),{status:413});
  try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error('Invalid JSON body'),{status:400}); }
}
export async function dispatchApi(request, core) {
  try {
    validateStudioApiRequest(request);
    // Authentication-free API requests must pass the boundary BEFORE SQLite is opened.
    const activeCore = core ?? getCore();
    const {store,sync,selected,verification,knowledge,precision,editorial,assets,illustrations,queue,deliveryQa,technicalAudit,qualityLedger,imageRoundtrip,deliveryReadiness,defaultSources} = activeCore;
    const url = new URL(request.url), p=url.pathname, method=request.method;
    if (method==='GET' && p==='/api/health') {
      const env=runtimeEnv;
      const marker=/^[a-f0-9]{40}$/.test(env.CONTENT_STUDIO_RUNTIME_COMMIT||'')&&
        /^[a-f0-9]{64}$/.test(env.CONTENT_STUDIO_RUNTIME_DIGEST||'')&&
        /^[a-f0-9]{64}$/.test(env.CONTENT_STUDIO_RUNTIME_LOCK_DIGEST||'')&&
        /^[a-f0-9]{32}$/.test(env.CONTENT_STUDIO_RUNTIME_NONCE||'')&&
        typeof env.CONTENT_STUDIO_RUNTIME_BUILD_ID==='string'&&
        env.CONTENT_STUDIO_RUNTIME_BUILD_ID.length<=200
        ? {candidateCommit:env.CONTENT_STUDIO_RUNTIME_COMMIT,
          artifactDigestSha256:env.CONTENT_STUDIO_RUNTIME_DIGEST,
          dependencyLockSha256:env.CONTENT_STUDIO_RUNTIME_LOCK_DIGEST,
          buildId:env.CONTENT_STUDIO_RUNTIME_BUILD_ID,
          runNonce:env.CONTENT_STUDIO_RUNTIME_NONCE,pid:process.pid,
          databaseIdentity:activeDatabaseIdentity(activeCore,env.CONTENT_STUDIO_RUNTIME_NONCE),
          osIsolation:currentCandidateOsProof(env),
          declarationOnly:true}:null;
      const remote=env.CONTENT_STUDIO_DEPLOY_MODE==='dokploy';
      const bootstrap=env.CONTENT_STUDIO_DEPLOY_MODE==='dokploy-bootstrap';
      return json({ok:true,framework:'nextjs',
        mode:bootstrap?'unauthenticated-bootstrap':remote?'authenticated-remote':'local-only',
        // A public bootstrap health probe must never leak build identity,
        // private DB identity or operating-system proof.
        runtimeBuild:bootstrap||remote&&!hasSession(request.headers,env)?null:marker,
        ...(remote||bootstrap?{}:{serverTime:new Date().toISOString()})});
    }
    if (method==='GET' && p==='/api/status') return json({ authenticatedRemote:runtimeEnv.CONTENT_STUDIO_DEPLOY_MODE==='dokploy', mode:'real-api-not-auto-synced', sources:sync.sourceStatus(), selected:selected.status(), aiConfigured:modelConfigured(), stats:store.stats() });
    if (method==='GET' && p==='/api/integrations/doocs/preflight') return json(await inspectDoocsService());
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
    if(method==='GET'&&p==='/api/assets')return json({assets:assets.list(),platformVerified:false});
    if(method==='POST'&&p==='/api/assets')return json(assets.upload(await body(request,8_500_000)),201);
    if(method==='POST'&&p==='/api/assets/prepare'){const b=await body(request);return json(assets.prepare(b.channel,b.markdown));}
    const assetPath=p.match(/^\/api\/assets\/(as_[a-f0-9]{32})(?:\/(preview|mappings\/(wechat|zhihu)))?$/);
    if(assetPath){const [,id,action,ch]=assetPath;
      if(method==='GET'&&action==='preview'){const a=assets.preview(id);return new Response(a.body,{headers:{'Content-Type':a.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':'inline'}});}
      if(method==='GET'&&!action)return json(assets.get(id));
      if(method==='PUT'&&ch)return json(assets.setMapping(id,ch,await body(request)));
    }
    // V37: series membership is explicit. Only members may inspect private series assets.
    const seriesProject=p.match(/^\/api\/illustrations\/projects\/(ep_[a-z0-9-]+)\/series(?:\/(join|leave|apply|references|references\/(vr_[a-z0-9-]+)|preferences|preferences\/(vp_[a-z0-9-]+)|history))?$/);
    if(seriesProject){const [,id,action,referenceId,preferenceId]=seriesProject;
      if(method==='GET'&&!action)return json(illustrations.series.list(id));
      if(method==='GET'&&action==='history')return json({versions:illustrations.series.history(id)});
      if(method==='POST'&&!action)return json(illustrations.series.create(id,await body(request)),201);
      if(method==='PUT'&&!action)return json(illustrations.series.update(id,await body(request)));
      if(method==='POST'&&action==='join')return json(illustrations.series.join(id,await body(request)));
      if(method==='POST'&&action==='leave')return json(illustrations.series.leave(id));
      if(method==='POST'&&action==='apply'){const b=await body(request),series=illustrations.series.view(id);if(b.expectedSeriesRevision!==series.revision)return fail('Series style changed; reload',409);return json(illustrations.setVisualProfile(id,{expectedRevision:b.expectedProfileRevision,profile:series.profile}));}
      if(method==='POST'&&action==='references')return json(illustrations.series.publishReference(id,await body(request)),201);
      if(method==='DELETE'&&referenceId)return json(illustrations.series.revokeReference(id,referenceId));
      if(method==='POST'&&action==='preferences')return json(illustrations.series.publishPreference(id,await body(request)),201);
      if(method==='DELETE'&&preferenceId)return json(illustrations.series.revokePreference(id,preferenceId));
    }
    const comparisonRoute=p.match(/^\/api\/illustrations\/projects\/(ep_[a-z0-9-]+)\/shots\/(il_[a-z0-9-]+)\/candidates\/(ic_[a-z0-9-]+)\/(comparison|feedback)$/);
    if(comparisonRoute){const [,projectId,shotId,candidateId,action]=comparisonRoute;
      if(method==='POST'&&action==='comparison')return json(await illustrations.compareCandidate(projectId,shotId,candidateId,await body(request)),201);
      if(method==='POST'&&action==='feedback')return json(illustrations.submitCandidateFeedback(projectId,shotId,candidateId,await body(request)),201);
    }
    const candidateRoute=p.match(/^\/api\/illustrations\/projects\/(ep_[a-z0-9-]+)\/shots\/(il_[a-z0-9-]+)\/(candidates|edits|candidates\/(ic_[a-z0-9-]+)\/decision)$/);
    if(candidateRoute){const [,id,shotId,action,candidateId]=candidateRoute;
      if(method==='GET'&&action==='candidates')return json({candidates:illustrations.candidates(id,shotId)});
      if(method==='GET'&&action==='edits')return json({attempts:illustrations.editAttempts(id,shotId)});
      if(method==='POST'&&action==='candidates')return json(await illustrations.editImage(id,shotId,await body(request)),201);
      if(method==='POST'&&candidateId)return json(illustrations.decideCandidate(id,shotId,candidateId,await body(request)));
    }
    // V44: unified read-only readiness with explicit, revision-bound author acknowledgements.
    const deliveryRoute=p.match(/^\/api\/delivery\/projects\/(ep_[a-z0-9-]+)\/(wechat|zhihu)(?:\/(no-images|snapshots|history))?$/);
    if(deliveryRoute){
      const [,projectId,channel,operation]=deliveryRoute;
      if(method==='GET'&&!operation)return json(deliveryReadiness.get(projectId,channel));
      if(method==='POST'&&operation==='no-images')return json(deliveryReadiness.waiveImages(projectId,channel,await body(request)),201);
      if(method==='POST'&&operation==='snapshots')return json(deliveryReadiness.recordSnapshot(projectId,channel,await body(request)),201);
      if(method==='GET'&&operation==='history')return json(deliveryReadiness.history(projectId,channel));
    }
    // V43: immutable author scores + read-only imported-image reconciliation.
    const qualityRoute=p.match(/^\/api\/illustrations\/projects\/(ep_[a-z0-9-]+)\/shots\/(il_[a-z0-9-]+)\/quality-reviews$/);
    if(qualityRoute){const [,projectId,shotId]=qualityRoute;
      if(method==='GET')return json(qualityLedger.view(projectId,shotId));
      if(method==='POST')return json(qualityLedger.record(projectId,shotId,await body(request)),201);
    }
    const roundtripRoute=p.match(/^\/api\/illustrations\/projects\/(ep_[a-z0-9-]+)\/image-roundtrip\/(wechat|zhihu)$/);
    if(roundtripRoute){const [,projectId,channel]=roundtripRoute;
      if(method==='GET')return json(imageRoundtrip.review(projectId,channel));
      if(method==='POST')return json(imageRoundtrip.review(projectId,channel,await body(request)));
    }
    // V42: local-only image technical checks; no external model or publishing call.
    const technicalAuditRoute=p.match(/^\/api\/illustrations\/projects\/(ep_[a-z0-9-]+)\/technical-audit$/);
    if(technicalAuditRoute&&method==='GET')return json(technicalAudit.inspect(technicalAuditRoute[1],{channel:url.searchParams.get('channel')||'wechat'}));
    // V40: these checks never contact a model or a publishing platform.
    if(method==='GET'&&p==='/api/illustrations/providers/preflight')return json({providers:providerContractPreflight(),networkCalls:0,chargedRequests:0});
    const qaRoute=p.match(/^\/api\/illustrations\/projects\/(ep_[a-z0-9-]+)\/handoff-qa\/(wechat|zhihu)(?:\/(history))?$/);
    if(qaRoute){const [,projectId,channel,action]=qaRoute;
      if(method==='GET'&&action==='history')return json({history:deliveryQa.history(projectId,channel)});
      if(method==='GET'&&!action)return json(deliveryQa.preflight(projectId,channel));
      if(method==='POST'&&!action)return json(deliveryQa.record(projectId,channel,await body(request)),201);
    }
    // V39: enqueuing is local. A separate start call is required before paid requests.
    if(p==='/api/illustrations/queue'&&method==='GET')return json(queue.get({projectId:url.searchParams.get('projectId')||''}));
    if(p==='/api/illustrations/queue/batches'&&method==='POST')return json(queue.enqueue(await body(request)),201);
    if(p==='/api/illustrations/queue/start'&&method==='POST')return json(queue.start(await body(request)));
    if(p==='/api/illustrations/queue/pause'&&method==='POST')return json(queue.pause());
    const queueJob=p.match(/^\/api\/illustrations\/queue\/jobs\/(qj_[a-z0-9-]+)(?:\/(cancel|retry|events))?$/);
    if(queueJob){const [,jobId,command]=queueJob;
      if(method==='GET'&&command==='events')return json({events:queue.events(jobId)});
      if(method==='POST'&&command==='cancel')return json(queue.cancel(jobId));
      if(method==='POST'&&command==='retry')return json(queue.retry(jobId,await body(request)));
    }
    const budgetRoute=p.match(/^\/api\/illustrations\/projects\/(ep_[a-z0-9-]+)\/budget$/);
    if(budgetRoute){const projectId=budgetRoute[1];
      if(method==='GET')return json(illustrations.requestBudget(projectId));
      if(method==='PUT')return json(illustrations.updateRequestBudget(projectId,await body(request)));
    }
    if(method==='GET'&&p==='/api/illustrations/visual-profiles')return json({profiles:illustrations.visualProfiles()});
    const illuRoute=p.match(/^\/api\/illustrations\/projects\/(ep_[a-z0-9-]+)(?:\/(plan|agent-plan|visual-profile|handoff\/(wechat|zhihu)|shots\/(il_[a-z0-9-]+)\/(generate|decision|prompt|prompt-preview|review|recover)))?$/);
    if(illuRoute){const [,id,action,ch,shotId,command]=illuRoute;
      if(method==='GET'&&!action)return json(illustrations.get(id));
      if(method==='PUT'&&action==='visual-profile')return json(illustrations.setVisualProfile(id,await body(request)));
      if(method==='POST'&&action==='plan')return json(illustrations.plan(id,await body(request)),201);
      if(method==='POST'&&action==='agent-plan')return json(await illustrations.agentPlan(id,await body(request)),201);
      if(method==='GET'&&ch)return json(illustrations.handoff(id,ch));
      if(method==='POST'&&command==='generate')return json(await illustrations.generate(id,shotId,await body(request)));
      if(method==='POST'&&command==='review')return json(await illustrations.review(id,shotId,await body(request)));
      if(method==='POST'&&command==='recover')return json(illustrations.recoverInterrupted(id,shotId,await body(request)));
      if(method==='GET'&&command==='prompt-preview')return json(illustrations.previewPrompt(id,shotId,url.searchParams.get('provider')||'openai'));
      if(method==='POST'&&command==='decision')return json(illustrations.decide(id,shotId,await body(request)));
      if(method==='PUT'&&command==='prompt')return json(illustrations.editPrompt(id,shotId,await body(request)));
    }
    if (method==='GET' && p==='/api/editor/projects') return json({projects:editorial.list(),scope:'Local-only; publication is never verified automatically'});
    if (method==='POST' && p==='/api/editor/projects') return json(editorial.create(await body(request)),201);
    const handoff = p.match(/^\/api\/composer\/projects\/(ep_[a-z0-9-]+)\/(wechat|zhihu)(?:\/(history|review|compatibility|image-audit|image-network-check))?$/);
    if(handoff){const [,id,ch,history]=handoff;
      if(method==='GET'&&history==='history')return json({history:editorial.layoutHistory(id,ch)});
      if(method==='GET'&&history==='image-audit')return json({projectId:id,layoutRevision:editorial.layoutDraft(id,ch).layoutRevision,...assets.auditChannelImages(ch,editorial.layoutDraft(id,ch).markdown)});
      if(method==='POST'&&history==='image-network-check'){
       const input=await body(request),draft=editorial.layoutDraft(id,ch);
       const audit=assets.auditChannelImages(ch,draft.markdown);
       return json({projectId:id,channel:ch,...await inspectMappedChannelImages({audit,layoutRevision:draft.layoutRevision,
        expectedLayoutRevision:input.expectedLayoutRevision,
        acknowledgeExternalRequests:input.acknowledgeExternalRequests})});
      }
      if(method==='GET'&&history==='compatibility')return json(editorial.layoutCompatibility(id,ch));
      if(method==='POST'&&history==='review')return json(editorial.reviewLayoutDraft(id,ch,await body(request)));
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

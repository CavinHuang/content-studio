/** V44 unified local delivery gates. "Ready" means local handoff work may
 * proceed, not that the external platform published, rendered, or verified it.
 * This service never invokes a provider, downloads remote assets or publishes.
 */
import {randomUUID,createHash} from 'node:crypto';
import {ValidationError} from './verification.mjs';
import {markdownImageTokens} from './image-roundtrip-reconciliation.mjs';
const channels=new Set(['wechat','zhihu']);
const checks=['factual','privacy','rights','layout'];
const bad=(message,status=400)=>{throw new ValidationError(message,status)};
const digest=o=>createHash('sha256').update(JSON.stringify(o)).digest('hex');
const make=(id,title,href)=>({id,title,href,status:'ready',issues:[],warnings:[],details:{}});
function block(stage,code){stage.issues.push(code);stage.status='blocked'}
function warn(stage,code){stage.warnings.push(code)}
export class DeliveryReadiness {
 constructor({store,editorial,illustrations,qualityLedger,deliveryQa,imageRoundtrip,technicalAudit,queue}){
  this.db=store.db;Object.assign(this,{editorial,illustrations,qualityLedger,deliveryQa,imageRoundtrip,technicalAudit,queue});
  this.db.exec(`
   CREATE TABLE IF NOT EXISTS delivery_no_image_decisions(
    id TEXT PRIMARY KEY,project_id TEXT NOT NULL,channel TEXT NOT NULL,
    source_revision INTEGER NOT NULL,channel_revision INTEGER NOT NULL,
    layout_revision INTEGER NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_delivery_no_image ON delivery_no_image_decisions(project_id,channel,created_at);
   CREATE TABLE IF NOT EXISTS delivery_readiness_snapshots(
    id TEXT PRIMARY KEY,project_id TEXT NOT NULL,channel TEXT NOT NULL,
    fingerprint TEXT NOT NULL,summary_json TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_delivery_readiness_history ON delivery_readiness_snapshots(project_id,channel,created_at);
  `);
 }
 _check(channel){if(!channels.has(channel))bad('Unsupported delivery channel')}
 _exemption(projectId,channel,editorial,layout){
  const row=this.db.prepare('SELECT * FROM delivery_no_image_decisions WHERE project_id=? AND channel=? ORDER BY rowid DESC LIMIT 1').get(projectId,channel);
  if(!row)return {exists:false,current:false};
  return {exists:true,current:row.source_revision===editorial.channels.master.document.revision&&
   row.channel_revision===editorial.channels[channel].document.revision&&row.layout_revision===layout.layoutRevision,
   id:row.id,reason:row.reason,createdAt:row.created_at};
 }
 waiveImages(projectId,channel,{expectedSourceRevision,expectedChannelRevision,expectedLayoutRevision,reason}={}){
  this._check(channel);
  const article=this.editorial.get(projectId),layout=this.editorial.layoutDraft(projectId,channel);
  const illustration=this.illustrations.get(projectId);
  if(illustration.plan)bad('Cannot exempt an article with an existing illustration plan; review its images',409);
  if(article.channels.master.document.revision!==expectedSourceRevision||
     article.channels[channel].document.revision!==expectedChannelRevision||
     layout.layoutRevision!==expectedLayoutRevision)bad('Article or layout revision changed; reload delivery checklist',409);
  if(typeof reason!=='string'||reason.trim().length<12||reason.trim().length>400)bad('Explain the deliberate no-images choice (12-400 characters)');
  if(markdownImageTokens(layout.markdown).length||/<img\\b/i.test(layout.markdown)||/!\\[[^\\]\\n]*\\]\\[[^\\]\\n]+\\]/.test(layout.markdown))
   bad('Channel layout contains Markdown/HTML/reference images; no-image exemption cannot be recorded',409);
  const id='din_'+randomUUID();
  this.db.prepare('INSERT INTO delivery_no_image_decisions VALUES(?,?,?,?,?,?,?,?)').run(id,projectId,channel,expectedSourceRevision,expectedChannelRevision,expectedLayoutRevision,reason.trim(),new Date().toISOString());
  return this.get(projectId,channel);
 }
 get(projectId,channel){
  this._check(channel);
  const article=this.editorial.get(projectId),main=article.channels.master,editor=article.channels[channel];
  const illustration=this.illustrations.get(projectId),layout=this.editorial.layoutDraft(projectId,channel);
  const exemption=this._exemption(projectId,channel,article,layout);
  const target='/delivery?project='+encodeURIComponent(projectId)+'&channel='+channel;
  const steps=[];
  const text=make('content','正文与版本','/editor?project='+encodeURIComponent(projectId)+'&channel='+channel);
  if(!main.document?.paragraphs?.some(p=>p.text?.trim()))block(text,'master_article_empty');
  if(!editor.document?.paragraphs?.some(p=>p.text?.trim()))block(text,'channel_article_empty');
  if(editor.masterOutdated)block(text,'channel_master_revision_outdated');
  if(layout.isSourceOutdated)block(text,'layout_source_revision_outdated');
  text.details={masterRevision:main.document.revision,channelRevision:editor.document.revision,layoutRevision:layout.layoutRevision};
  steps.push(text);
  const evidence=make('evidence','证据与精准更正','/editor?project='+encodeURIComponent(projectId)+'&channel='+channel);
  const uncertain=(editor.claims||[]).filter(c=>c.needsResearchReview||c.anchorStatus!=='matched');
  if(uncertain.length)block(evidence,'claim_anchors_unverified');
  if(editor.openCorrections>0)block(evidence,'open_correction_tasks');
  if(!(editor.claims||[]).length)warn(evidence,'no_claims_linked_manual_fact_check_still_required');
  evidence.details={linkedClaims:(editor.claims||[]).length,unverifiedClaims:uncertain.length,openCorrections:editor.openCorrections};
  steps.push(evidence);
  const review=make('editorial','渠道事实、隐私、版权与排版审核','/editor?project='+encodeURIComponent(projectId)+'&channel='+channel);
  const missing=checks.filter(key=>editor.checks?.[key]!==true);
  if(missing.length)block(review,'channel_checks_incomplete');
  review.details={checks:editor.checks,missing};
  steps.push(review);
  const image=make('images','图片计划、素材与人工质量评价','/illustrations?project='+encodeURIComponent(projectId));
  const qa=make('platform','作者报告的平台图片粘贴测试','/illustrations?project='+encodeURIComponent(projectId));
  const round=make('roundtrip','doocs/md 导回图片一致性','/compose?project='+encodeURIComponent(projectId)+'&channel='+channel);
  if(layout.layoutRevision===0)block(round,'channel_layout_not_imported');
  if(!illustration.plan){
   if(exemption.current){
    image.status='skipped';image.details={noImageDecision:exemption};
    qa.status='skipped';qa.details={noImageDecision:exemption};
    const tokens=markdownImageTokens(layout.markdown);
    if(tokens.length||/<img\\b/i.test(layout.markdown)||/!\\[[^\\]\\n]*\\]\\[[^\\]\\n]+\\]/.test(layout.markdown))block(round,'unexpected_images_in_text_only_layout');
   }else{
    block(image,'explicit_no_image_choice_or_plan_required');
    qa.status='waiting';qa.details={reason:'image_plan_or_no_image_exemption_required'};
   }
   round.details={layoutRevision:layout.layoutRevision,exemption};
  }else{
   if(illustration.stale)block(image,'illustration_plan_outdated');
   const queueState=this.queue.get({projectId});
   const active=(queueState.counts.queued||0)+(queueState.counts.running||0);
   if(active)block(image,'illustration_queue_unfinished');
   let rated=0,unrated=0,qualityIssues=0;
   const perShot=[];
   for(const shot of illustration.shots){
    const entry={shotId:shot.id,status:shot.status,assetId:shot.assetId||null,qualityCurrent:false,qualityRecommended:false};
    if(shot.status!=='approved'||!shot.assetId)block(image,'images_require_author_approval');
    else{
     if(!shot.asset.mappings?.some(m=>m.channel===channel))block(image,'approved_image_channel_url_missing');
     const rec=this.qualityLedger.view(projectId,shot.id).items.find(x=>x.assetId===shot.assetId);
     if(rec?.latestCurrent&&rec.latest?.recommendation==='recommended'&&rec.latest.rightsReviewed&&rec.latest.factualReviewed&&!rec.latest.riskFlags.length){
      rated++;entry.qualityCurrent=true;entry.qualityRecommended=true;
     }else{unrated++;qualityIssues++;block(image,'current_positive_quality_review_required')}
    }
    perShot.push(entry);
   }
   if(!illustration.shots.length)block(image,'image_plan_has_no_slots');
   // Purely technical warnings do not silently override the human image quality judgment.
   const tech=this.technicalAudit.inspect(projectId,{channel});
   if(tech.shots.some(x=>x.variants.some(v=>v.checks.issues.length)))warn(image,'technical_image_findings_require_review');
   image.details={planId:illustration.plan.id,shots:illustration.shots.length,rated,unrated,qualityIssues,queueOutstanding:active,perShot};
   const mappingQa=this.deliveryQa.preflight(projectId,channel);
   if(!mappingQa.readyForManualQA)block(qa,'image_handoff_not_ready_for_platform_qa');
   if(!(mappingQa.latestCurrent&&mappingQa.latest?.result==='passed'))block(qa,'current_author_platform_qa_pass_required');
   qa.details={latestId:mappingQa.latest?.id||null,latestResult:mappingQa.latest?.result||null,latestCurrent:!!mappingQa.latestCurrent,
     proposalSha256:mappingQa.proposalSha256,authorReportedOnly:true};
   const inspected=this.imageRoundtrip.review(projectId,channel);
   if(!inspected.ready)block(round,'saved_markdown_image_reconciliation_failed');
   round.details={layoutRevision:inspected.layoutRevision,documentHash:inspected.documentHash,expected:inspected.expectedCount,
    matched:inspected.matchedCount,issues:inspected.issues,warnings:inspected.warnings};
  }
  steps.push(image,round,qa);
  const blockers=steps.filter(s=>s.status==='blocked'),warnings=steps.reduce((n,s)=>n+s.warnings.length,0);
  const ready=blockers.length===0&&!steps.some(s=>s.status==='waiting');
  const facts={projectId,channel,sourceRevision:main.document.revision,channelRevision:editor.document.revision,
   layoutRevision:layout.layoutRevision,planId:illustration.plan?.id||null,
   steps:steps.map(s=>({id:s.id,status:s.status,issues:s.issues,warnings:s.warnings,details:s.details}))};
  const fingerprint=digest(facts);
  const last=this.db.prepare('SELECT id,fingerprint,created_at FROM delivery_readiness_snapshots WHERE project_id=? AND channel=? ORDER BY rowid DESC LIMIT 1').get(projectId,channel);
  return {projectId,title:article.title,channel,ready,decision:ready?'ready_for_author_final_review':'blocked',
   fingerprint,sourceRevision:main.document.revision,channelRevision:editor.document.revision,layoutRevision:layout.layoutRevision,
   blockers:blockers.length,warnings,steps,exemption,
   latestSnapshot:last?{id:last.id,createdAt:last.created_at,current:last.fingerprint===fingerprint}:null,
   platformVerified:false,published:false,readOnly:true,
   message:ready?'Local checklist satisfied; human must still confirm actual platform publishing and content accuracy.':'Complete the blocked steps. Local readiness is not platform publication.',
   navigation:target};
 }
 recordSnapshot(projectId,channel,{expectedFingerprint,note,acknowledgeLocalOnly=false}={}){
  this._check(channel);
  if(typeof note!=='string'||note.trim().length<12||note.trim().length>600)bad('Describe the author readiness review (12-600 characters)');
  if(acknowledgeLocalOnly!==true)bad('Explicitly acknowledge that this is local author review only',403);
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const view=this.get(projectId,channel);
   if(view.fingerprint!==expectedFingerprint)bad('Delivery checklist changed; rerun checks',409);
   if(!view.ready)bad('Delivery blockers remain; readiness snapshot not allowed',409);
   const id='drs_'+randomUUID(),createdAt=new Date().toISOString();
   const summary={projectId,channel,sourceRevision:view.sourceRevision,channelRevision:view.channelRevision,
    layoutRevision:view.layoutRevision,steps:view.steps.map(s=>({id:s.id,status:s.status,issues:s.issues,warnings:s.warnings})),
    decision:view.decision,platformVerified:false,published:false};
   this.db.prepare('INSERT INTO delivery_readiness_snapshots VALUES(?,?,?,?,?,?,?)').run(id,projectId,channel,view.fingerprint,JSON.stringify(summary),note.trim(),createdAt);
   this.db.exec('COMMIT');
   return {id,createdAt,fingerprint:view.fingerprint,note:note.trim(),summary,authorReported:true,platformVerified:false,published:false};
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 history(projectId,channel){
  this._check(channel);const current=this.get(projectId,channel);
  return {projectId,channel,history:this.db.prepare('SELECT * FROM delivery_readiness_snapshots WHERE project_id=? AND channel=? ORDER BY rowid DESC LIMIT 40').all(projectId,channel).map(r=>({
   id:r.id,fingerprint:r.fingerprint,note:r.note,createdAt:r.created_at,
   summary:JSON.parse(r.summary_json),current:r.fingerprint===current.fingerprint,
   authorReported:true,platformVerified:false,published:false
  }))};
 }
}

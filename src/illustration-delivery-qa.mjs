/** V40: local, revision-anchored image handoff readiness and author-reported platform QA.
 * No external network requests, no platform credentials and no automated publishing.
 */
import {randomUUID,createHash} from 'node:crypto';
import {ValidationError} from './verification.mjs';
const channels=new Set(['wechat','zhihu']);
const requiredChecks=['rightsReviewed','uploadConfirmed','desktopPasteConfirmed','mobilePreviewConfirmed'];
const fail=(msg,status=400)=>{throw new ValidationError(msg,status)};
const hash=s=>createHash('sha256').update(s).digest('hex');
export class IllustrationDeliveryQa {
 constructor(store,illustrations){
  this.db=store.db;this.illustrations=illustrations;
  this.db.exec(`
   CREATE TABLE IF NOT EXISTS illustration_delivery_qa (
    id TEXT PRIMARY KEY,project_id TEXT NOT NULL,channel TEXT NOT NULL,
    source_revision INTEGER NOT NULL,layout_revision INTEGER NOT NULL,
    proposal_sha256 TEXT NOT NULL,checks_json TEXT NOT NULL,note TEXT NOT NULL,
    author_reported_result TEXT NOT NULL,created_at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_illustration_delivery_qa_channel ON illustration_delivery_qa(project_id,channel,created_at);
  `);
 }
 _record(row){
  if(!row)return null;
  return {id:row.id,projectId:row.project_id,channel:row.channel,sourceRevision:row.source_revision,
   layoutRevision:row.layout_revision,proposalSha256:row.proposal_sha256,
   checks:JSON.parse(row.checks_json),note:row.note,result:row.author_reported_result,
   createdAt:row.created_at,authorReported:true,platformVerifiedAutomatically:false};
 }
 preflight(projectId,channel){
  if(!channels.has(channel))fail('Unsupported image handoff channel');
  const project=this.illustrations.get(projectId);
  const last=this.db.prepare('SELECT * FROM illustration_delivery_qa WHERE project_id=? AND channel=? ORDER BY rowid DESC LIMIT 1').get(projectId,channel);
  if(!project.plan||project.stale)return {projectId,channel,readyForManualQA:false,
   stale:project.stale,sourceRevision:project.sourceRevision,layoutRevision:null,proposalSha256:null,
   approved:0,pendingApproval:project.shots.filter(s=>s.status!=='approved').map(s=>s.id),
   unmapped:[],unplaced:[],issues:[project.stale?'source_changed':'plan_required'],
   latest:this._record(last),latestCurrent:false,authorReportedOnly:true};
  const handoff=this.illustrations.handoff(projectId,channel);
  const pendingApproval=project.shots.filter(s=>s.status!=='approved').map(s=>s.id);
  const readyForManualQA=handoff.ready&&pendingApproval.length===0;
  const digest=hash(handoff.markdown);
  const latest=this._record(last);
  const latestCurrent=!!latest&&latest.sourceRevision===project.sourceRevision&&latest.layoutRevision===handoff.layoutRevision&&latest.proposalSha256===digest&&readyForManualQA;
  return {projectId,channel,sourceRevision:project.sourceRevision,layoutRevision:handoff.layoutRevision,
   proposalSha256:digest,stale:false,readyForManualQA,
   approved:project.shots.length-pendingApproval.length,pendingApproval,
   inserted:handoff.inserted,unmapped:handoff.unmapped,unplaced:handoff.unplaced,
   issues:[...(!handoff.inserted.length?['no_inserted_image']:[]),...(pendingApproval.length?['images_need_approval']:[]),...(handoff.unmapped.length?['channel_url_missing']:[]),...(handoff.unplaced.length?['paragraph_not_found']:[])],
   latest,latestCurrent,authorReportedOnly:true,
   warning:'This is a local preparation check, not a live WeChat/Zhihu platform verification.'};
 }
 history(projectId,channel){
  this.illustrations._project(projectId);if(!channels.has(channel))fail('Unsupported channel');
  return this.db.prepare('SELECT * FROM illustration_delivery_qa WHERE project_id=? AND channel=? ORDER BY rowid DESC LIMIT 30').all(projectId,channel).map(x=>this._record(x));
 }
 record(projectId,channel,{expectedSourceRevision,expectedLayoutRevision,expectedProposalSha256,checks,note}={}){
  const view=this.preflight(projectId,channel);
  if(!view.proposalSha256)fail('No stable image handoff proposal to review',409);
  if(expectedSourceRevision!==view.sourceRevision||expectedLayoutRevision!==view.layoutRevision||expectedProposalSha256!==view.proposalSha256)fail('Article, channel layout or image mappings changed; rerun preflight',409);
  if(!checks||typeof checks!=='object'||requiredChecks.some(k=>typeof checks[k]!=='boolean'))fail('Record all four explicit manual QA checks');
  const outcome=requiredChecks.every(k=>checks[k])?'passed':'failed';
  if(outcome==='passed'&&!view.readyForManualQA)fail('Cannot report passing QA while image approvals or mappings are incomplete',409);
  if(typeof note!=='string'||note.trim().length<12||note.trim().length>600)fail('Record a specific manual platform observation (12-600 characters)');
  const row={id:'dq_'+randomUUID(),projectId,channel,sourceRevision:view.sourceRevision,layoutRevision:view.layoutRevision,
   proposalSha256:view.proposalSha256,checks:Object.fromEntries(requiredChecks.map(k=>[k,checks[k]])),
   note:note.trim(),outcome,createdAt:new Date().toISOString()};
  this.db.prepare('INSERT INTO illustration_delivery_qa VALUES(?,?,?,?,?,?,?,?,?,?)').run(row.id,projectId,channel,row.sourceRevision,row.layoutRevision,row.proposalSha256,JSON.stringify(row.checks),row.note,outcome,row.createdAt);
  return this.preflight(projectId,channel);
 }
}

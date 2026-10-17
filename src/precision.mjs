import {randomUUID} from 'node:crypto';
import {ValidationError} from './verification.mjs';
import {safeText} from './normalize.mjs';
const fail=(message,status=400)=>{throw new ValidationError(message,status)};
const iso=()=>new Date().toISOString();
const txt=(value,name,min=1,max=1500)=>{if(typeof value!=='string'||value.trim().length<min||value.length>max)fail(`${name} must be ${min}-${max} characters`);return safeText(value,max)};
const parse=(s)=>JSON.parse(s);
const pid=/^p_[a-zA-Z0-9_-]{4,70}$/;
const validateParagraphs=(blocks)=>{
 if(!Array.isArray(blocks)||blocks.length<1||blocks.length>24)fail('Document requires 1-24 paragraphs');
 const ids=new Set();return blocks.map((b,i)=>{
  if(!b||typeof b!=='object'||Array.isArray(b))fail('Invalid paragraph');
  const id=b.id==null?`p_${randomUUID()}`:b.id;
  if(typeof id!=='string'||!pid.test(id)||ids.has(id))fail('Paragraph IDs must be unique and stable');ids.add(id);
  return{id,text:txt(b.text,'Paragraph',3,2200),order:i};
 });
};
const plainSnapshot=(row)=>({referenceId:row.reference_id,revision:row.revision,paragraphs:parse(row.paragraphs_json),createdAt:row.created_at});
export class PrecisionService{
 constructor(store,verification,knowledge){this.store=store;this.db=store.db;this.verification=verification;this.knowledge=knowledge;
  this.db.exec(`
  CREATE TABLE IF NOT EXISTS article_documents(reference_id TEXT PRIMARY KEY, current_revision INTEGER NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS article_document_revisions(id TEXT PRIMARY KEY, reference_id TEXT NOT NULL,revision INTEGER NOT NULL,paragraphs_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(reference_id,revision));
  CREATE INDEX IF NOT EXISTS idx_article_document_revisions_ref ON article_document_revisions(reference_id);
  CREATE TABLE IF NOT EXISTS paragraph_claims(id TEXT PRIMARY KEY,reference_id TEXT NOT NULL,paragraph_id TEXT NOT NULL,quoted_text TEXT NOT NULL, evidence_ids_json TEXT NOT NULL,card_id TEXT NOT NULL,knowledge_revision INTEGER NOT NULL,case_version INTEGER NOT NULL,document_revision INTEGER NOT NULL,created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_paragraph_claims_ref ON paragraph_claims(reference_id);
  CREATE TABLE IF NOT EXISTS precision_corrections(id TEXT PRIMARY KEY,claim_id TEXT NOT NULL,trigger_knowledge_revision INTEGER NOT NULL,trigger_case_version INTEGER NOT NULL,status TEXT NOT NULL,proposed_text TEXT NOT NULL DEFAULT '',proposal_reason TEXT NOT NULL DEFAULT '',resolution_note TEXT NOT NULL DEFAULT '',base_document_revision INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(claim_id,trigger_knowledge_revision,trigger_case_version));
  CREATE INDEX IF NOT EXISTS idx_precision_corrections_claim ON precision_corrections(claim_id);
  CREATE TABLE IF NOT EXISTS precision_audit(id TEXT PRIMARY KEY,subject_type TEXT NOT NULL,subject_id TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
  `);
 }
 _audit(type,id,action,detail){this.db.prepare('INSERT INTO precision_audit VALUES(?,?,?,?,?,?)').run(randomUUID(),type,id,action,detail,iso())}
 _ref(id){const r=this.editor?.reference(id)||this.knowledge.references().find(x=>x.id===id);if(!r)fail('Content reference not found',404);return r}
 _docRow(id){return this.db.prepare('SELECT * FROM article_documents WHERE reference_id=?').get(id)}
 _latest(id){return this.db.prepare('SELECT * FROM article_document_revisions WHERE reference_id=? ORDER BY revision DESC LIMIT 1').get(id)}
 document(id){const state=this._docRow(id);if(!state)return null;return{...plainSnapshot(this._latest(id)),updatedAt:state.updated_at,reference:this._ref(id)}}
 history(id){this._ref(id);return this.db.prepare('SELECT * FROM article_document_revisions WHERE reference_id=? ORDER BY revision DESC').all(id).map(plainSnapshot)}
 saveDocument({referenceId,expectedRevision,paragraphs}={}){
  this._ref(referenceId);const normalized=validateParagraphs(paragraphs),current=this._docRow(referenceId),actual=current?.current_revision||0;
  if(!Number.isInteger(expectedRevision)||expectedRevision!==actual)fail('Document revision conflict: reload before saving',409);
  this.db.exec('BEGIN IMMEDIATE');try{this._insertDocumentRevision(referenceId,actual,normalized);this.db.exec('COMMIT');}
  catch(e){this.db.exec('ROLLBACK');throw e}return this.document(referenceId);
 }
 _insertDocumentRevision(referenceId,actual,normalized,{markdownWrite=false}={}){
   if(!markdownWrite&&this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='article_markdown_revisions'").get()&&this.db.prepare('SELECT 1 FROM article_markdown_revisions WHERE reference_id=? LIMIT 1').get(referenceId))fail('This document uses integrated Markdown. Open the writing workspace to preserve formatting and revision history.',409);
   const next=actual+1,at=iso();
   if(actual)this.db.prepare('UPDATE article_documents SET current_revision=?,updated_at=? WHERE reference_id=?').run(next,at,referenceId);
   else this.db.prepare('INSERT INTO article_documents VALUES (?,?,?)').run(referenceId,next,at);
   this.db.prepare('INSERT INTO article_document_revisions VALUES (?,?,?,?,?)').run('ad_'+randomUUID(),referenceId,next,JSON.stringify(normalized),at);
   this._audit('document',referenceId,'revision_saved',`Revision ${next}; paragraphs ${normalized.length}`);
 }
 _claim(id){const r=this.db.prepare('SELECT * FROM paragraph_claims WHERE id=?').get(id);if(!r)fail('Paragraph claim not found',404);return r}
 _expandedClaim(row){const doc=this.document(row.reference_id),ref=this._ref(row.reference_id),k=this.knowledge.get(row.card_id),c=this.verification.get(k.caseId);
  const block=doc?.paragraphs.find(p=>p.id===row.paragraph_id),anchorStatus=!block?'paragraph_missing':block.text.includes(row.quoted_text)?'matched':'quote_changed';
  return{id:row.id,referenceId:row.reference_id,paragraphId:row.paragraph_id,quote:row.quoted_text,evidenceIds:parse(row.evidence_ids_json),cardId:row.card_id,knowledgeRevisionAtLink:row.knowledge_revision,caseVersionAtLink:row.case_version,documentRevisionAtLink:row.document_revision,currentDocumentRevision:doc?.revision||0,currentKnowledgeRevision:k.revision,currentCaseVersion:c.version,channel:ref.channel,referenceTitle:ref.title,anchorStatus,paragraphText:block?.text||'',needsResearchReview:k.revision!==row.knowledge_revision||c.version!==row.case_version,createdAt:row.created_at,scope:'Author-linked quotation and evidence; not independently fact-checked'};
 }
 claims(referenceId){if(referenceId)this._ref(referenceId);const rows=referenceId?this.db.prepare('SELECT * FROM paragraph_claims WHERE reference_id=? ORDER BY created_at,id').all(referenceId):this.db.prepare('SELECT * FROM paragraph_claims ORDER BY created_at,id').all();return rows.map(r=>this._expandedClaim(r))}
 addClaim({referenceId,paragraphId,quote,evidenceIds}={}){
  const ref=this._ref(referenceId),doc=this.document(referenceId);if(!doc)fail('Create a document first',409);
  const block=doc.paragraphs.find(p=>p.id===paragraphId);if(!block)fail('Paragraph ID not found',404);
  const q=txt(quote,'Exact quote',5,700);if(!block.text.includes(q))fail('Quote is not present in selected paragraph',409);
  if(!Array.isArray(evidenceIds)||!evidenceIds.length||evidenceIds.length>12||new Set(evidenceIds).size!==evidenceIds.length)fail('Select 1-12 distinct evidence records');
  if(!ref.cardId)fail('Link a reviewed knowledge card before citing evidence',409);const card=this.knowledge.get(ref.cardId),rev=card.revisions[0],allowed=new Set(rev.evidence.map(e=>e.id));
  if(evidenceIds.some(id=>typeof id!=='string'||!allowed.has(id)))fail('Evidence must belong to the latest captured knowledge revision',409);
  const id='pc_'+randomUUID(),at=iso();this.db.prepare('INSERT INTO paragraph_claims VALUES (?,?,?,?,?,?,?,?,?,?)').run(id,referenceId,paragraphId,q,JSON.stringify(evidenceIds),ref.cardId,card.revision,rev.caseVersion,doc.revision,at);
  this._audit('claim',id,'linked',`Paragraph ${paragraphId}; knowledge v${card.revision}; case v${rev.caseVersion}`);return this._expandedClaim(this._claim(id));
 }
 _task(id){const row=this.db.prepare('SELECT * FROM precision_corrections WHERE id=?').get(id);if(!row)fail('Correction task not found',404);return row}
 _expandTask(t){const c=this._expandedClaim(this._claim(t.claim_id));return{id:t.id,claimId:c.id,referenceId:c.referenceId,paragraphId:c.paragraphId,channel:c.channel,referenceTitle:c.referenceTitle,quote:c.quote,paragraphText:c.paragraphText,anchorStatus:c.anchorStatus,triggerKnowledgeRevision:t.trigger_knowledge_revision,triggerCaseVersion:t.trigger_case_version,currentKnowledgeRevision:c.currentKnowledgeRevision,currentCaseVersion:c.currentCaseVersion,currentDocumentRevision:c.currentDocumentRevision,baseDocumentRevision:t.base_document_revision,status:t.status,proposedText:t.proposed_text,proposalReason:t.proposal_reason,resolutionNote:t.resolution_note,createdAt:t.created_at,updatedAt:t.updated_at,scope:'Requires human review; no automatic platform modification'};}
 scan(){let created=0;this.db.exec('BEGIN IMMEDIATE');try{
  for(const row of this.db.prepare('SELECT * FROM paragraph_claims').all()){
   const claim=this._expandedClaim(row);if(!claim.needsResearchReview)continue;
   const t=this.db.prepare('INSERT OR IGNORE INTO precision_corrections VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('ct_'+randomUUID(),claim.id,claim.currentKnowledgeRevision,claim.currentCaseVersion,'pending','','','',null,iso(),iso());created+=Number(t.changes||0);
  }
  if(created)this._audit('corrections','system','scan',`Created ${created} review tasks`);this.db.exec('COMMIT');
 }catch(e){this.db.exec('ROLLBACK');throw e}
 return{created,tasks:this.tasks()};}
 tasks(){return this.db.prepare('SELECT * FROM precision_corrections ORDER BY created_at DESC,id').all().map(t=>this._expandTask(t))}
 propose(id,{expectedDocumentRevision,proposedText,reason}={}){
  const t=this._task(id);if(!['pending','proposed','planned'].includes(t.status))fail('Correction task already resolved',409);
  const claim=this._expandedClaim(this._claim(t.claim_id));if(!Number.isInteger(expectedDocumentRevision)||expectedDocumentRevision!==claim.currentDocumentRevision)fail('Document revision conflict: reload before proposing',409);
  if(claim.anchorStatus!=='matched')fail('Quoted text has moved or changed: re-anchor manually before proposing',409);
  const proposal=txt(proposedText,'Proposed paragraph',10,2200),explanation=txt(reason,'Correction reasoning',20,900),at=iso();
  this.db.prepare("UPDATE precision_corrections SET status='proposed',proposed_text=?,proposal_reason=?,base_document_revision=?,updated_at=? WHERE id=?").run(proposal,explanation,expectedDocumentRevision,at,id);
  this._audit('correction',id,'proposed',explanation);return this._expandTask(this._task(id));
 }
 decide(id,{action,expectedDocumentRevision,note}={}){
  const t=this._task(id);if(!['pending','proposed','planned'].includes(t.status))fail('Correction task already resolved',409);
  const claim=this._expandedClaim(this._claim(t.claim_id)),ref=this._ref(claim.referenceId);
  const reason=txt(note,'Human review note',20,900);if(!Number.isInteger(expectedDocumentRevision)||expectedDocumentRevision!==claim.currentDocumentRevision)fail('Document revision conflict: reload before deciding',409);
  if(t.trigger_knowledge_revision!==claim.currentKnowledgeRevision||t.trigger_case_version!==claim.currentCaseVersion)fail('Research changed again: review the newer task',409);
  let status='';const at=iso();
  if(action==='apply_local'){
   if(!t.proposed_text||t.base_document_revision!==expectedDocumentRevision||claim.anchorStatus!=='matched')fail('Proposal or exact quote is stale',409);
   const doc=this.document(ref.id);const blocks=doc.paragraphs.map(x=>({id:x.id,text:x.id===claim.paragraphId?t.proposed_text:x.text}));
   const normalized=validateParagraphs(blocks);
   this.db.exec('BEGIN IMMEDIATE');try{
    // Paragraph revision, correction resolution and audit are committed atomically.
    if(this._docRow(ref.id).current_revision!==expectedDocumentRevision)fail('Document revision conflict',409);
    this._insertDocumentRevision(ref.id,expectedDocumentRevision,normalized);
    // A precision edit is still an editorial revision: invalidate manual checks
    // and the current publication status, preserving previous export/reports.
    const editorial=this.editor ? this.db.prepare('SELECT project_id FROM editorial_channel_refs WHERE id=?').get(ref.id) : null;
    if(editorial){
      this.db.prepare("UPDATE editorial_channel_refs SET checklist_json=?,status='draft',reported_url='',updated_at=? WHERE id=?")
        .run(JSON.stringify({factual:false,privacy:false,rights:false,layout:false}),at,ref.id);
      this.db.prepare('UPDATE editorial_projects SET updated_at=? WHERE id=?').run(at,editorial.project_id);
    }
    this.db.prepare('UPDATE precision_corrections SET status=?,resolution_note=?,updated_at=? WHERE id=?').run('local_applied',reason,at,id);
    this._audit('correction',id,action,`${reason}; no automatic platform changes`);
    this.db.exec('COMMIT');
   }catch(e){this.db.exec('ROLLBACK');throw e}
   return this._expandTask(this._task(id));
  }else if(action==='no_change')status='reviewed_no_change';
  else if(action==='plan')status='planned';
  else if(action==='report_external'){
   if(ref.status!=='reported_published'||!ref.reportedUrl)fail('External correction can only be author-reported for a published reference',409);
   status='externally_reported';
  }else fail('Invalid correction decision');
  this.db.prepare('UPDATE precision_corrections SET status=?,resolution_note=?,updated_at=? WHERE id=?').run(status,reason,at,id);
  this._audit('correction',id,action,`${reason}; no automatic platform changes`);return this._expandTask(this._task(id));
 }
 audit(id){return this.db.prepare('SELECT subject_type,subject_id,action,detail,created_at FROM precision_audit WHERE subject_id=? ORDER BY created_at,id').all(id)}
 overview(){const documents=this.db.prepare('SELECT reference_id FROM article_documents ORDER BY updated_at DESC').all().map(x=>this.document(x.reference_id));const references=this.knowledge.references();const claims=this.claims(),tasks=this.tasks();return{documents,references,claims,tasks,stats:{documents:documents.length,claims:claims.length,anchorMismatches:claims.filter(x=>x.anchorStatus!=='matched').length,pendingReview:tasks.filter(x=>['pending','proposed','planned'].includes(x.status)).length,resolved:tasks.filter(x=>['local_applied','reviewed_no_change','externally_reported'].includes(x.status)).length},scope:'Local author-recorded source annotations; quoted text is NOT independently verified; external content never auto-edited'};}
}

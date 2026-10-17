import {randomUUID} from 'node:crypto';
import {createHash} from 'node:crypto';
import {ValidationError} from './verification.mjs';
import {safeText} from './normalize.mjs';
import {markdownFromDocument,validateHandoffMarkdown} from '../lib/wechat-handoff.mjs';
import {analyzeMarkdownRoundtrip} from '../lib/markdown-audit.mjs';
import {compatibilityPreflight} from '../lib/markdown-compat.mjs';
const fail=(message,status=400)=>{throw new ValidationError(message,status)};
const now=()=>new Date().toISOString();
const channels=['master','wechat','zhihu','xiaohongshu'];
const checks=['factual','privacy','rights','layout'];
const parse=s=>JSON.parse(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validateBlocks=blocks=>{
 if(!Array.isArray(blocks)||blocks.length<1||blocks.length>24)fail('Require 1-24 paragraphs');
 let ids=new Set();return blocks.map((b,i)=>{
  if(typeof b?.text!=='string'||b.text.trim().length<3||b.text.length>2200)fail('Each paragraph needs 3-2200 characters');
  const id=b.id||'p_'+randomUUID();
  if(typeof id!=='string'||!/^p_[a-zA-Z0-9_-]{4,70}$/.test(id)||ids.has(id))fail('Duplicate or invalid paragraph ID');ids.add(id);
  return{id,text:safeText(b.text,2200),order:i};
 });
};
function titleField(t){if(typeof t!=='string'||t.trim().length<3||t.length>240)fail('Title needs 3-240 characters');return safeText(t,240)}
function cleanUrl(url){if(typeof url!=='string'||url.length>1500)fail('Invalid external URL');try{let u=new URL(url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error();return u.href}catch{fail('External URL must be http(s)')}}
const statusName={draft:'草稿',exported:'已导出（不是已发表）',reported_published:'作者报告已发表（未经平台核验）'};
export class EditorialService{
 constructor(store,knowledge,precision){this.store=store;this.db=store.db;this.knowledge=knowledge;this.precision=precision;
 this.db.exec(`
 CREATE TABLE IF NOT EXISTS editorial_projects(id TEXT PRIMARY KEY,brief_id TEXT NOT NULL DEFAULT '',title TEXT NOT NULL,card_id TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS editorial_channel_refs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,channel TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',reported_url TEXT NOT NULL DEFAULT '',source_master_revision INTEGER NOT NULL DEFAULT 0,ack_master_revision INTEGER NOT NULL DEFAULT 0,checklist_json TEXT NOT NULL,exported_revision INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,UNIQUE(project_id,channel));
 CREATE TABLE IF NOT EXISTS editorial_exports(id TEXT PRIMARY KEY,reference_id TEXT NOT NULL,document_revision INTEGER NOT NULL,content_text TEXT NOT NULL,content_html TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_editorial_exports_ref ON editorial_exports(reference_id);
 CREATE TABLE IF NOT EXISTS editorial_layout_drafts(reference_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,source_document_revision INTEGER NOT NULL,markdown TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS editorial_layout_history(id TEXT PRIMARY KEY,reference_id TEXT NOT NULL,revision INTEGER NOT NULL,source_document_revision INTEGER NOT NULL,markdown TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(reference_id,revision));
 CREATE INDEX IF NOT EXISTS idx_editorial_layout_history_ref ON editorial_layout_history(reference_id);
 CREATE TABLE IF NOT EXISTS editorial_layout_review_history(reference_id TEXT NOT NULL,revision INTEGER NOT NULL,review_json TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(reference_id,revision));
 CREATE TABLE IF NOT EXISTS editorial_publication_reports(id TEXT PRIMARY KEY,reference_id TEXT NOT NULL,exported_revision INTEGER NOT NULL,reported_url TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(reference_id,exported_revision,reported_url));
 `);
 }
 attachPrecision(){this.precision.editor=this;}
 _project(id){const p=this.db.prepare('SELECT * FROM editorial_projects WHERE id=?').get(id);if(!p)fail('Editorial project not found',404);return p}
 _refRow(id){return this.db.prepare('SELECT * FROM editorial_channel_refs WHERE id=?').get(id)}
 _channel(id,channel){if(!channels.includes(channel))fail('Invalid channel');const r=this.db.prepare('SELECT * FROM editorial_channel_refs WHERE project_id=? AND channel=?').get(id,channel);if(!r)fail('Editorial channel not found',404);return r}
 reference(id){const r=this._refRow(id);if(!r)return null;const p=this._project(r.project_id);return{id:r.id,projectId:p.id,cardId:p.card_id||'',briefId:p.brief_id,title:p.title,channel:r.channel,status:r.status,reportedUrl:r.reported_url,sourceMasterRevision:r.source_master_revision,ackMasterRevision:r.ack_master_revision,exportedRevision:r.exported_revision};}
 list(){return this.db.prepare('SELECT id FROM editorial_projects ORDER BY updated_at DESC').all().map(p=>this.get(p.id))}
 get(id){const p=this._project(id);const rows=this.db.prepare('SELECT * FROM editorial_channel_refs WHERE project_id=? ORDER BY CASE channel WHEN \'master\' THEN 0 WHEN \'wechat\' THEN 1 ELSE 2 END').all(id);const master=rows.find(r=>r.channel==='master'),masterDoc=this.precision.document(master.id);return{id:p.id,title:p.title,briefId:p.brief_id,cardId:p.card_id||'',createdAt:p.created_at,updatedAt:p.updated_at,channels:Object.fromEntries(rows.map(r=>{
  const doc=this.precision.document(r.id),claims=this.precision.claims(r.id),tasks=this.precision.tasks().filter(t=>t.referenceId===r.id);
  return[r.channel,{referenceId:r.id,document:doc,checks:parse(r.checklist_json),status:r.status,statusLabel:r.status==='reported_published'&&(this.db.prepare('SELECT exported_revision FROM editorial_publication_reports WHERE reference_id=? ORDER BY rowid DESC LIMIT 1').get(r.id)?.exported_revision??r.exported_revision)!==doc?.revision?'旧版作者报告已发表；当前稿未交付':statusName[r.status],reportedUrl:r.reported_url,sourceMasterRevision:r.source_master_revision,ackMasterRevision:r.ack_master_revision,masterRevision:masterDoc?.revision||0,masterOutdated:r.channel!=='master'&&(r.ack_master_revision<(masterDoc?.revision||0)),exportedRevision:r.exported_revision,publicationReports:this.db.prepare('SELECT exported_revision,reported_url,created_at FROM editorial_publication_reports WHERE reference_id=? ORDER BY rowid DESC').all(r.id),claims,tasks,openCorrections:tasks.filter(t=>['pending','proposed','planned'].includes(t.status)).length}];
 }))};}
 create({title,briefId='',paragraphs,idempotencyKey}={}){
 const titleText=titleField(title),blocks=validateBlocks(paragraphs||[{text:'请用自己的实践、观察和可靠来源逐段写作，未经核实的结论不可直接发表。'}]);
 if(briefId&&(!/^br_[a-f0-9]{24}$/.test(briefId)||!this.store.brief(briefId)))fail('Brief not found',404);
 if(idempotencyKey!==undefined&&(typeof idempotencyKey!=='string'||idempotencyKey.length>240))fail('Invalid project key');
 const id='ep_'+(idempotencyKey?createHash('sha256').update(idempotencyKey).digest('hex').slice(0,32):randomUUID()),at=now();
 if(idempotencyKey&&this.db.prepare('SELECT id FROM editorial_projects WHERE id=?').get(id))return this.get(id);
 this.db.exec('BEGIN IMMEDIATE');try{
  this.db.prepare('INSERT INTO editorial_projects VALUES(?,?,?,?,?,?)').run(id,briefId,titleText,'',at,at);
  for(const ch of channels.filter(c=>c!=='xiaohongshu')){const ref='cr_'+randomUUID();this.db.prepare('INSERT INTO editorial_channel_refs VALUES(?,?,?,?,?,?,?,?,?,?)').run(ref,id,ch,'draft','',1,1,JSON.stringify({factual:false,privacy:false,rights:false,layout:false}),0,at);this.precision._insertDocumentRevision(ref,0,blocks.map(x=>({...x})));}
  this.db.exec('COMMIT');
 }catch(e){this.db.exec('ROLLBACK');throw e}
 return this.get(id);
 }
 ensureChannel(id,channel){this._project(id);if(channel!=='xiaohongshu')return this._channel(id,channel);const existing=this.db.prepare('SELECT * FROM editorial_channel_refs WHERE project_id=? AND channel=?').get(id,channel);if(existing)return existing;this.db.exec('BEGIN IMMEDIATE');try{const ref='cr_'+randomUUID(),at=now();this.db.prepare('INSERT INTO editorial_channel_refs VALUES(?,?,?,?,?,?,?,?,?,?)').run(ref,id,channel,'draft','',0,0,JSON.stringify({factual:false,privacy:false,rights:false,layout:false}),0,at);this.precision._insertDocumentRevision(ref,0,[],{markdownWrite:true});this.db.prepare('INSERT INTO article_markdown_revisions VALUES(?,1,\'\',\'forest\',?)').run(ref,at);this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}return this._channel(id,channel)}
 save(id,channel,{expectedRevision,paragraphs}={}){const ref=this._channel(id,channel);const normalized=validateBlocks(paragraphs);const actual=this.precision.document(ref.id)?.revision||0;if(!Number.isInteger(expectedRevision)||expectedRevision!==actual)fail('Document revision conflict: reload',409);
 // Revision, check reset, and status update share a transaction.
 this.db.exec('BEGIN IMMEDIATE');try{
  this.precision._insertDocumentRevision(ref.id,actual,normalized);
  const p=this._project(id),masterRef=this._channel(id,'master');const masterRev=this.precision.document(masterRef.id)?.revision||0;
  this.db.prepare("UPDATE editorial_channel_refs SET checklist_json=?,ack_master_revision=?,status='draft',reported_url='',updated_at=? WHERE id=?").run(JSON.stringify({factual:false,privacy:false,rights:false,layout:false}),channel==='master'?actual+1:masterRev,now(),ref.id);
  this.db.prepare('UPDATE editorial_projects SET updated_at=? WHERE id=?').run(now(),p.id);
  this.db.exec('COMMIT');
 }catch(e){this.db.exec('ROLLBACK');throw e}
 return this.get(id);
 }
 copyMaster(id,channel,{expectedRevision,confirmOverwrite=false}={}){if(channel==='master')fail('Cannot copy master onto itself');const src=this._channel(id,'master'),dst=this._channel(id,channel),master=this.precision.document(src.id),current=this.precision.document(dst.id);
 if(current.revision!==expectedRevision)fail('Document revision conflict: reload',409);
 if(!confirmOverwrite)fail('Explicit acknowledgement required: existing channel edits will be superseded by a new revision',409);
 const next=this.save(id,channel,{expectedRevision,paragraphs:master.paragraphs.map(({id,text})=>({id,text}))});
 this.db.prepare('UPDATE editorial_channel_refs SET source_master_revision=?,ack_master_revision=? WHERE id=?').run(master.revision,master.revision,dst.id);
 return this.get(id);
 }
 setChecks(id,channel,{expectedRevision,checks:values}={}){if(channel==='master')fail('Checks belong to each publishing channel');const r=this._channel(id,channel),doc=this.precision.document(r.id);if(doc.revision!==expectedRevision)fail('Channel changed; reload before confirming',409);
 if(!values||typeof values!=='object'||Array.isArray(values)||checks.some(k=>typeof values[k]!=='boolean')||Object.keys(values).some(k=>!checks.includes(k)))fail('All four channel checks must be explicit booleans');
 this.db.prepare('UPDATE editorial_channel_refs SET checklist_json=?,ack_master_revision=?,updated_at=? WHERE id=?').run(JSON.stringify(Object.fromEntries(checks.map(k=>[k,values[k]]))),this.precision.document(this._channel(id,'master').id).revision,now(),r.id);
 return this.get(id);
 }
 attachKnowledge(id,{cardId}={}){const project=this._project(id);if(project.card_id)fail('A knowledge card is already linked; create a new project for a different study',409);const card=this.knowledge.get(cardId);if(project.brief_id){const brief=this.store.brief(project.brief_id);if(brief?.verification?.caseId!==card.caseId)fail('Knowledge card does not belong to this Brief research case',409)}
 this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('UPDATE editorial_projects SET card_id=?,updated_at=? WHERE id=?').run(cardId,now(),id);this.db.prepare("UPDATE editorial_channel_refs SET checklist_json=? WHERE project_id=?").run(JSON.stringify({factual:false,privacy:false,rights:false,layout:false}),id);this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}return this.get(id)}
 _markdown(referenceId,revision){
  if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='article_markdown_revisions'").get())return null;
  return this.db.prepare('SELECT markdown FROM article_markdown_revisions WHERE reference_id=? AND revision=?').get(referenceId,revision);
 }
 /** Legacy handoff stays readable; integrated Markdown is the current source. */
 layoutDraft(id,channel){
  const ref=this._channel(id,channel), doc=this.precision.document(ref.id);
  const saved=this.db.prepare('SELECT * FROM editorial_layout_drafts WHERE reference_id=?').get(ref.id);
  const savedReview=saved?this.db.prepare('SELECT review_json FROM editorial_layout_review_history WHERE reference_id=? AND revision=?').get(ref.id,saved.revision):null;
  return {projectId:id,channel,referenceId:ref.id,sourceDocumentRevision:doc.revision,
   layoutRevision:saved?.revision||0,savedSourceRevision:saved?.source_document_revision||0,
   lastImportReview:savedReview?parse(savedReview.review_json):null,
   isSourceOutdated:!!saved&&saved.source_document_revision!==doc.revision,
   markdown:this._markdown(ref.id,doc.revision)?.markdown??saved?.markdown??markdownFromDocument(this._project(id).title,doc.paragraphs),
   updatedAt:saved?.updated_at||null,source:'standalone-doocs-md',automaticallySynchronized:false,
   note:'微信排版在外部工具内完成；保存 Markdown 不代表微信后台已发表，也不代表证据重新核实。'};
 }
 reviewLayoutDraft(id,channel,{expectedLayoutRevision,expectedDocumentRevision,markdown}={}){
  if(channel==='master')fail('Typesetting handoff belongs to publishing channels');
  const ref=this._channel(id,channel),doc=this.precision.document(ref.id);
  const prev=this.db.prepare('SELECT revision FROM editorial_layout_drafts WHERE reference_id=?').get(ref.id);
  if(!Number.isInteger(expectedLayoutRevision)||expectedLayoutRevision!==(prev?.revision||0))fail('Layout draft revision conflict: reload',409);
  if(!Number.isInteger(expectedDocumentRevision)||expectedDocumentRevision!==doc.revision)fail('Source document changed: review before importing',409);
  const audit=analyzeMarkdownRoundtrip({title:this._project(id).title,paragraphs:doc.paragraphs,claims:this.precision.claims(ref.id),markdown,documentRevision:doc.revision,layoutRevision:prev?.revision||0});
  return {...audit,compatibility:compatibilityPreflight(markdown,channel)};
 }
 saveLayoutDraft(id,channel,{expectedLayoutRevision,expectedDocumentRevision,markdown,reviewToken,acknowledgeDrift=false}={}){
  if(channel==='master')fail('Typesetting handoff belongs to publishing channels');
  const ref=this._channel(id,channel),doc=this.precision.document(ref.id);
  if(this._markdown(ref.id,doc.revision))fail('This document uses integrated Markdown; save in the writing workspace',409);
  const prev=this.db.prepare('SELECT revision FROM editorial_layout_drafts WHERE reference_id=?').get(ref.id);
  if(!Number.isInteger(expectedLayoutRevision)||expectedLayoutRevision!==(prev?.revision||0))fail('Layout draft revision conflict: reload',409);
  if(!Number.isInteger(expectedDocumentRevision)||expectedDocumentRevision!==doc.revision)fail('Source document changed: review before importing',409);
  const content=validateHandoffMarkdown(markdown);
  const audit=this.reviewLayoutDraft(id,channel,{expectedLayoutRevision,expectedDocumentRevision,markdown:content});
  if(!audit.compatibility.canSaveLocally)fail('Markdown compatibility preflight blocked unsafe or nonportable content; revise before saving',422);
  if(audit.requiresHumanReview && (!acknowledgeDrift || reviewToken!==audit.reviewToken))fail('Review Markdown differences and acknowledge changes before importing',409);
  const rev=(prev?.revision||0)+1,at=now();
  this.db.exec('BEGIN IMMEDIATE');try{
   this.db.prepare('INSERT INTO editorial_layout_history VALUES(?,?,?,?,?,?)').run('lh_'+randomUUID(),ref.id,rev,doc.revision,content,at);
   this.db.prepare('INSERT INTO editorial_layout_review_history VALUES(?,?,?,?)').run(ref.id,rev,JSON.stringify({summary:audit.summary,hasMaterialDrift:audit.hasMaterialDrift,requiresHumanReview:audit.requiresHumanReview,acknowledgedByAuthor:!!acknowledgeDrift,compatibility:{summary:audit.compatibility.summary,features:audit.compatibility.features,contentHash:audit.compatibility.contentHash,platformVerified:false},scope:'Static preflight and author-reviewed text diff; platform not verified'}),at);
   this.db.prepare(`INSERT INTO editorial_layout_drafts VALUES(?,?,?,?,?) ON CONFLICT(reference_id) DO UPDATE SET revision=excluded.revision,source_document_revision=excluded.source_document_revision,markdown=excluded.markdown,updated_at=excluded.updated_at`).run(ref.id,rev,doc.revision,content,at);
   this.db.prepare("UPDATE editorial_channel_refs SET checklist_json=?,status='draft',reported_url='',updated_at=? WHERE id=?")
    .run(JSON.stringify({factual:false,privacy:false,rights:false,layout:false}),at,ref.id);
   this.db.prepare('UPDATE editorial_projects SET updated_at=? WHERE id=?').run(at,id);
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
  return this.layoutDraft(id,channel);
 }
 layoutCompatibility(id,channel){const draft=this.layoutDraft(id,channel);return {...compatibilityPreflight(draft.markdown,channel),projectId:id,layoutRevision:draft.layoutRevision,sourceDocumentRevision:draft.sourceDocumentRevision,isSourceOutdated:draft.isSourceOutdated};}
 layoutHistory(id,channel){const ref=this._channel(id,channel);return this.db.prepare('SELECT h.revision,h.source_document_revision,h.created_at,r.review_json FROM editorial_layout_history h LEFT JOIN editorial_layout_review_history r ON r.reference_id=h.reference_id AND r.revision=h.revision WHERE h.reference_id=? ORDER BY h.revision DESC').all(ref.id).map(({review_json,...row})=>({...row,importReview:review_json?parse(review_json):null}));}
 _canExport(id,channel){if(channel==='master')fail('Master draft is not a publishing destination');const r=this._channel(id,channel),doc=this.precision.document(r.id),c=parse(r.checklist_json),claims=this.precision.claims(r.id),tasks=this.precision.tasks().filter(t=>t.referenceId===r.id);const problems=[];
 if(!this._markdown(r.id,doc.revision)&&this.db.prepare('SELECT revision FROM editorial_layout_drafts WHERE reference_id=?').get(r.id))problems.push('此渠道已进入 doocs/md 排版流程，旧纯文本 HTML 导出已禁用；请在排版器复制排版成品并到真实平台核查');
 for(const k of checks)if(!c[k])problems.push(`人工核查未完成: ${k}`);
 if(r.ack_master_revision<this.precision.document(this._channel(id,'master').id).revision)problems.push('主稿更新后尚未明确复核渠道稿');
 for(const claim of claims)if(claim.anchorStatus!=='matched'||claim.needsResearchReview)problems.push('存在已变化或过时的段落证据锚点');
 if(tasks.some(t=>['pending','proposed','planned'].includes(t.status)))problems.push('存在未解决的精准更正任务');
 if(!doc?.paragraphs?.length)problems.push('没有可导出的正文');return{problems,doc};}
 exportChannel(id,channel,{expectedRevision}={}){const r=this._channel(id,channel),{problems,doc}=this._canExport(id,channel);if(doc.revision!==expectedRevision)fail('Revision changed; reload before export',409);if(problems.length)fail('Export blocked: '+problems.join('; '),409);
 if(this._markdown(r.id,doc.revision))fail('Use the writing workspace to export the current Markdown content',409);
 const project=this._project(id),plain=doc.paragraphs.map(p=>p.text).join('\n\n'),html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(project.title)}</title></head><body><article><h1>${esc(project.title)}</h1>${doc.paragraphs.map(p=>`<p>${esc(p.text)}</p>`).join('')}</article></body></html>`;
 this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT INTO editorial_exports VALUES(?,?,?,?,?,?)').run('ex_'+randomUUID(),r.id,doc.revision,plain,html,now());this.db.prepare("UPDATE editorial_channel_refs SET status='exported',reported_url='',exported_revision=?,updated_at=? WHERE id=?").run(doc.revision,now(),r.id);this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}
 return{referenceId:r.id,channel,revision:doc.revision,filename:`content-studio-${channel}-v${doc.revision}`,html,text:plain,status:'exported',publicationVerified:false,scope:'Local export, not platform publishing'};
 }
 exports(id,channel){const r=this._channel(id,channel);return this.db.prepare('SELECT id,document_revision,created_at FROM editorial_exports WHERE reference_id=? ORDER BY rowid DESC').all(r.id)}
 reported(id,channel,{url,expectedRevision}={}){if(channel==='master')fail('Master cannot be externally published');const r=this._channel(id,channel);if(r.exported_revision===0||r.exported_revision!==expectedRevision)fail('Export the current revision before author-reported publication',409);if(r.status!=='exported'&&r.status!=='reported_published')fail('Current revision must be exported before publication can be reported',409);const u=cleanUrl(url);this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT OR IGNORE INTO editorial_publication_reports VALUES(?,?,?,?,?)').run('pr_'+randomUUID(),r.id,expectedRevision,u,now());this.db.prepare("UPDATE editorial_channel_refs SET status='reported_published',reported_url=?,updated_at=? WHERE id=?").run(u,now(),r.id);this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}return this.get(id)}
}

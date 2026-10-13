/** V37 opt-in visual series. Local single-user domain isolation, NOT tenant authorization.
 * Joining a series never uploads images and never changes publication state.
 */
import {randomUUID} from 'node:crypto';
import {ValidationError} from './verification.mjs';
import {validateVisualProfile} from './visual-quality.mjs';
import {preferencePrompt} from './image-feedback.mjs';
const fail=(m,status=400)=>{throw new ValidationError(m,status)};
const timestamp=()=>new Date().toISOString();
const compact=s=>String(s||'').trim().replace(/[\r\n\t]+/g,' ');
export class VisualSeriesService {
 constructor(db,editorial,assets){this.db=db;this.editorial=editorial;this.assets=assets;db.exec(`
 CREATE TABLE IF NOT EXISTS visual_series(id TEXT PRIMARY KEY,owner_project_id TEXT NOT NULL,name TEXT NOT NULL,revision INTEGER NOT NULL,profile_json TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS visual_series_versions(id TEXT PRIMARY KEY,series_id TEXT NOT NULL,revision INTEGER NOT NULL,profile_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(series_id,revision));
 CREATE TABLE IF NOT EXISTS visual_series_members(project_id TEXT PRIMARY KEY,series_id TEXT NOT NULL,joined_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_visual_series_member ON visual_series_members(series_id);
 CREATE TABLE IF NOT EXISTS visual_series_references(id TEXT PRIMARY KEY,series_id TEXT NOT NULL,source_project_id TEXT NOT NULL,asset_id TEXT NOT NULL,note TEXT NOT NULL,active INTEGER NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_visual_series_refs ON visual_series_references(series_id,active);
 CREATE TABLE IF NOT EXISTS visual_series_preferences(id TEXT PRIMARY KEY,series_id TEXT NOT NULL,source_project_id TEXT NOT NULL,feedback_id TEXT NOT NULL,note TEXT NOT NULL,active INTEGER NOT NULL,created_at TEXT NOT NULL,UNIQUE(series_id,feedback_id));
 `);}
 _project(projectId){return this.editorial.get(projectId)}
 _member(projectId,required=true){this._project(projectId);const row=this.db.prepare('SELECT * FROM visual_series_members WHERE project_id=?').get(projectId);if(required&&!row)fail('This article has not joined a visual series',403);return row;}
 _series(seriesId){const s=this.db.prepare('SELECT * FROM visual_series WHERE id=?').get(seriesId);if(!s)fail('Visual series not found',404);return s;}
 _isCurrentApproved(projectId,assetId){
  const revision=this._project(projectId).channels.master.document.revision;
  return !!this.db.prepare(`SELECT 1 FROM article_illustration_shots shot JOIN article_illustration_plans plan ON plan.id=shot.plan_id WHERE plan.project_id=? AND plan.master_revision=? AND shot.asset_id=? AND shot.status='approved' AND plan.id=(SELECT id FROM article_illustration_plans WHERE project_id=? ORDER BY rowid DESC LIMIT 1) LIMIT 1`).get(projectId,revision,assetId,projectId);
 }
 _joined(projectId,seriesId){const m=this._member(projectId);if(m.series_id!==seriesId)fail('Article does not belong to this series',403);return this._series(seriesId)}
 list(projectId){const m=this._member(projectId,false);const available=this.db.prepare('SELECT id,name,revision FROM visual_series ORDER BY rowid DESC LIMIT 60').all();return {membership:m?.series_id||null,available,series:m?this.view(projectId):null};}
 view(projectId){const m=this._member(projectId);const s=this._series(m.series_id);const members=this.db.prepare('SELECT project_id AS projectId,joined_at AS joinedAt FROM visual_series_members WHERE series_id=? ORDER BY rowid').all(s.id);
  const references=this.db.prepare('SELECT id,source_project_id AS sourceProjectId,asset_id AS assetId,note,created_at AS createdAt FROM visual_series_references WHERE series_id=? AND active=1 ORDER BY rowid DESC LIMIT 30').all(s.id)
   .filter(r=>members.some(x=>x.projectId===r.sourceProjectId)&&this._isCurrentApproved(r.sourceProjectId,r.assetId)).map(r=>{const a=this.assets.get(r.assetId);return {...r,asset:{id:a.id,mime:a.mime,size:a.size,previewUrl:a.previewUrl,alt:a.alt}};});
  const preferences=this.db.prepare('SELECT id,source_project_id AS sourceProjectId,note,created_at AS createdAt FROM visual_series_preferences WHERE series_id=? AND active=1 ORDER BY rowid DESC LIMIT 12').all(s.id).filter(r=>members.some(x=>x.projectId===r.sourceProjectId));
  return {id:s.id,name:s.name,revision:s.revision,profile:JSON.parse(s.profile_json),ownerProjectId:s.owner_project_id,updatedAt:s.updated_at,members,references,preferences};
 }
 create(projectId,{name,profile}={}){this._project(projectId);if(this._member(projectId,false))fail('Article is already in a series; leave first',409);name=compact(name);if(name.length<2||name.length>70)fail('Series name must be 2-70 characters');const p=validateVisualProfile(profile),id='vs_'+randomUUID(),time=timestamp();this.db.exec('BEGIN IMMEDIATE');try{
  this.db.prepare('INSERT INTO visual_series VALUES(?,?,?,?,?,?)').run(id,projectId,name,1,JSON.stringify(p),time);
  this.db.prepare('INSERT INTO visual_series_versions VALUES(?,?,?,?,?)').run('vv_'+randomUUID(),id,1,JSON.stringify(p),time);
  this.db.prepare('INSERT INTO visual_series_members VALUES(?,?,?)').run(projectId,id,time);
  this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e}return this.view(projectId);
 }
 join(projectId,{seriesId}={}){this._project(projectId);if(this._member(projectId,false))fail('Leave current series before joining another',409);this._series(seriesId);this.db.prepare('INSERT INTO visual_series_members VALUES(?,?,?)').run(projectId,seriesId,timestamp());return this.view(projectId);}
 leave(projectId){const m=this._member(projectId),s=this._series(m.series_id);if(s.owner_project_id===projectId&&this.db.prepare('SELECT COUNT(*) AS n FROM visual_series_members WHERE series_id=?').get(s.id).n>1)fail('Series owner cannot leave while members remain',409);
  this.db.exec('BEGIN IMMEDIATE');try{
   this.db.prepare('UPDATE visual_series_references SET active=0 WHERE source_project_id=? AND series_id=?').run(projectId,s.id);
   this.db.prepare('UPDATE visual_series_preferences SET active=0 WHERE source_project_id=? AND series_id=?').run(projectId,s.id);
   this.db.prepare('DELETE FROM visual_series_members WHERE project_id=?').run(projectId);
   this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e}
  return this.list(projectId);
 }
 update(projectId,{expectedRevision,profile,name}={}){const m=this._member(projectId),s=this._series(m.series_id);if(s.owner_project_id!==projectId)fail('Only series owner can change shared style',403);if(!Number.isInteger(expectedRevision)||expectedRevision!==s.revision)fail('Series style changed; reload',409);
  const p=validateVisualProfile(profile),n=name===undefined?s.name:compact(name);if(n.length<2||n.length>70)fail('Invalid series name');const time=timestamp(),newVersion=s.revision+1;
  this.db.exec('BEGIN IMMEDIATE');try{
   const changed=this.db.prepare('UPDATE visual_series SET name=?,revision=?,profile_json=?,updated_at=? WHERE id=? AND revision=?').run(n,newVersion,JSON.stringify(p),time,s.id,s.revision);if(changed.changes!==1)fail('Series style changed; reload',409);
   this.db.prepare('INSERT INTO visual_series_versions VALUES(?,?,?,?,?)').run('vv_'+randomUUID(),s.id,newVersion,JSON.stringify(p),time);
   this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e}
  return this.view(projectId);
 }
 history(projectId){const m=this._member(projectId);return this.db.prepare('SELECT revision,profile_json AS profileJson,created_at AS createdAt FROM visual_series_versions WHERE series_id=? ORDER BY revision DESC').all(m.series_id).map(x=>({revision:x.revision,profile:JSON.parse(x.profileJson),createdAt:x.createdAt}));}
 publishReference(projectId,{assetId,note}={}){const m=this._member(projectId),n=compact(note);if(n.length<8||n.length>180)fail('Describe what the shared reference should illustrate (8-180 characters)');
  if(!this._isCurrentApproved(projectId,assetId))fail('Only approved images from this article can be shared',403);
  this.assets.get(assetId);
  const existing=this.db.prepare('SELECT id FROM visual_series_references WHERE series_id=? AND source_project_id=? AND asset_id=? AND active=1').get(m.series_id,projectId,assetId);
  if(existing)fail('This image is already in the series gallery',409);
  this.db.prepare('INSERT INTO visual_series_references VALUES(?,?,?,?,?,?,?)').run('vr_'+randomUUID(),m.series_id,projectId,assetId,n,1,timestamp());return this.view(projectId);
 }
 revokeProjectReferences(projectId,assetId=null){if(assetId)this.db.prepare('UPDATE visual_series_references SET active=0 WHERE source_project_id=? AND asset_id=? AND active=1').run(projectId,assetId);else this.db.prepare('UPDATE visual_series_references SET active=0 WHERE source_project_id=? AND active=1').run(projectId);}
 revokeReference(projectId,referenceId){const m=this._member(projectId);const ref=this.db.prepare('SELECT * FROM visual_series_references WHERE id=? AND series_id=? AND active=1').get(referenceId,m.series_id);if(!ref)fail('Reference not in this series',404);const series=this._series(m.series_id);if(ref.source_project_id!==projectId&&series.owner_project_id!==projectId)fail('Only source article or series owner can revoke',403);
  this.db.prepare('UPDATE visual_series_references SET active=0 WHERE id=?').run(referenceId);return this.view(projectId);
 }
 assertReference(projectId,assetId){const m=this._member(projectId);const ref=this.db.prepare(`SELECT r.id FROM visual_series_references r JOIN visual_series_members owner ON owner.project_id=r.source_project_id AND owner.series_id=r.series_id WHERE r.series_id=? AND r.asset_id=? AND r.active=1 ORDER BY r.rowid DESC LIMIT 1`).get(m.series_id,assetId);if(!ref)fail('Reference image is not shared with this article',403);
  const source=this.db.prepare('SELECT source_project_id FROM visual_series_references WHERE id=?').get(ref.id);if(!this._isCurrentApproved(source.source_project_id,assetId))fail('Source reference is no longer approved or current',403);return ref;}
 publishPreference(projectId,{feedbackId}={}){const m=this._member(projectId);
  const feedback=this.db.prepare('SELECT * FROM article_illustration_feedback WHERE id=? AND project_id=? AND remember=1').get(feedbackId,projectId);if(!feedback)fail('Only explicitly remembered feedback from this article may be shared',403);
  const duplicate=this.db.prepare('SELECT id FROM visual_series_preferences WHERE series_id=? AND feedback_id=?').get(m.series_id,feedbackId);if(duplicate)fail('This feedback has already been shared',409);
  this.db.prepare('INSERT INTO visual_series_preferences VALUES(?,?,?,?,?,?,?)').run('vp_'+randomUUID(),m.series_id,projectId,feedbackId,feedback.note,1,timestamp());return this.view(projectId);
 }
 revokePreference(projectId,preferenceId){const m=this._member(projectId),row=this.db.prepare('SELECT * FROM visual_series_preferences WHERE id=? AND series_id=? AND active=1').get(preferenceId,m.series_id);if(!row)fail('Series preference not found',404);if(row.source_project_id!==projectId&&this._series(m.series_id).owner_project_id!==projectId)fail('Not allowed to revoke another article feedback',403);
  this.db.prepare('UPDATE visual_series_preferences SET active=0 WHERE id=?').run(preferenceId);return this.view(projectId);
 }
 seriesMemoryPrompt(projectId){const m=this._member(projectId,false);if(!m)return '';const rows=this.db.prepare(`SELECT v.note FROM visual_series_preferences v JOIN visual_series_members owner ON owner.project_id=v.source_project_id AND owner.series_id=v.series_id WHERE v.series_id=? AND v.active=1 ORDER BY v.rowid DESC LIMIT 6`).all(m.series_id);return preferencePrompt(rows.map(x=>x.note));}
}

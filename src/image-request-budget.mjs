/** V38: durable per-article UTC-day cap on outbound model requests.
 * Counts reserved requests, not actual charges: failures or crashes may still cost money.
 * No prompt, image, key, or provider response is written to this ledger.
 */
import {randomUUID} from 'node:crypto';
import {ValidationError} from './verification.mjs';

const DEFAULT_LIMIT=12;
const VALID_KINDS=new Set(['plan','generate','edit','review','compare']);
const VALID_PROVIDERS=new Set(['openai','gemini','qwen','planner','vision']);
function reject(message,status=400){throw new ValidationError(message,status)}

export class ImageRequestBudget {
 constructor(db,clock=()=>new Date()){
  this.db=db;this.clock=clock;
  db.exec(`
   CREATE TABLE IF NOT EXISTS image_request_limits (
    project_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    daily_limit INTEGER NOT NULL CHECK(daily_limit BETWEEN 1 AND 100),
    updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS image_request_ledger (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    shot_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    provider TEXT NOT NULL,
    day_utc TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT
   );
   CREATE INDEX IF NOT EXISTS idx_image_request_day ON image_request_ledger(project_id,day_utc);
  `);
 }
 _at(){const value=this.clock();const date=value instanceof Date?value:new Date(value);if(!Number.isFinite(date.getTime()))throw Error('Invalid budget clock');return date.toISOString()}
 _limit(projectId){return this.db.prepare('SELECT * FROM image_request_limits WHERE project_id=?').get(projectId)}
 get(projectId){
  const limit=this._limit(projectId),dayUtc=this._at().slice(0,10);
  const counts=this.db.prepare("SELECT status,kind,COUNT(*) AS n FROM image_request_ledger WHERE project_id=? AND day_utc=? GROUP BY status,kind").all(projectId,dayUtc);
  const used=counts.reduce((n,r)=>n+r.n,0),reserved=counts.filter(r=>r.status==='reserved').reduce((n,r)=>n+r.n,0);
  return {projectId,dayUtc,dailyLimit:limit?.daily_limit??DEFAULT_LIMIT,revision:limit?.revision??0,used,remaining:Math.max(0,(limit?.daily_limit??DEFAULT_LIMIT)-used),reserved,breakdown:counts.map(r=>({kind:r.kind,status:r.status,count:r.n})),accounting:'requests-reserved-not-currency'};
 }
 history(projectId,limit=40){
  return this.db.prepare('SELECT id,shot_id AS shotId,kind,provider,day_utc AS dayUtc,status,started_at AS startedAt,finished_at AS finishedAt FROM image_request_ledger WHERE project_id=? ORDER BY rowid DESC LIMIT ?').all(projectId,Math.max(1,Math.min(100,Number(limit)||40)));
 }
 setLimit(projectId,{expectedRevision,dailyLimit}={}){
  if(!Number.isInteger(expectedRevision)||expectedRevision<0)reject('Expected budget revision is required');
  if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>100)reject('Daily request limit must be between 1 and 100');
  this.db.exec('BEGIN IMMEDIATE');try{
   const prev=this._limit(projectId);
   if(expectedRevision!==(prev?.revision??0))reject('Request budget changed; reload before saving',409);
   const at=this._at();
   this.db.prepare('INSERT INTO image_request_limits(project_id,revision,daily_limit,updated_at) VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,daily_limit=excluded.daily_limit,updated_at=excluded.updated_at').run(projectId,expectedRevision+1,dailyLimit,at);
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
  return this.get(projectId);
 }
 reserve(projectId,{shotId='',kind,provider}={}){
  if(!VALID_KINDS.has(kind)||!VALID_PROVIDERS.has(provider))reject('Unsupported budget request kind or provider');
  this.db.exec('BEGIN IMMEDIATE');try{
   const at=this._at(),dayUtc=at.slice(0,10);
   const row=this._limit(projectId),dailyLimit=row?.daily_limit??DEFAULT_LIMIT;
   const used=this.db.prepare('SELECT COUNT(*) AS n FROM image_request_ledger WHERE project_id=? AND day_utc=?').get(projectId,dayUtc).n;
   if(used>=dailyLimit)reject('Daily external-model request cap reached (UTC). No additional provider call made.',429);
   const id='ir_'+randomUUID();
   this.db.prepare('INSERT INTO image_request_ledger VALUES(?,?,?,?,?,?,?,?,?)').run(id,projectId,shotId,kind,provider,dayUtc,'reserved',at,null);
   this.db.exec('COMMIT');
   return {id,dayUtc};
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 finish(id,status){
  if(!['success','failed'].includes(status))reject('Invalid request completion state');
  this.db.prepare("UPDATE image_request_ledger SET status=?,finished_at=? WHERE id=? AND status='reserved'").run(status,this._at(),id);
 }
}

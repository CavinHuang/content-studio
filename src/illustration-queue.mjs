/** V39 local single-process illustration queue.
 * Jobs and transitions survive restarts. No automatic replay after a restart:
 * the author must explicitly start/resume outbound work again.
 * Never stores prompts, images or API credentials in the queue.
 */
import {randomUUID,createHash} from 'node:crypto';
import {ValidationError} from './verification.mjs';

const providers=new Set(['openai','gemini','qwen']);
const terminal=new Set(['completed','failed','cancelled','blocked_budget','interrupted','obsolete']);
const stamp=()=>new Date().toISOString();
function fail(message,status=400){throw new ValidationError(message,status)}
const safeError=e=>String(e?.message||'Image job failed').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/sk-[a-z0-9_-]+/gi,'[redacted]').slice(0,180);
const fingerprint=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');

export class IllustrationQueue {
 constructor(db,illustrations){
  this.db=db;this.illustrations=illustrations;this.running=null;this.stopping=false;
  db.exec(`
   CREATE TABLE IF NOT EXISTS illustration_queue_batches(
     id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL,created_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS illustration_queue_jobs(
     id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,project_id TEXT NOT NULL,shot_id TEXT NOT NULL,
     plan_id TEXT NOT NULL,source_revision INTEGER NOT NULL,shot_updated_at TEXT NOT NULL,
     provider TEXT NOT NULL,fallback_json TEXT NOT NULL,max_attempts INTEGER NOT NULL,
     status TEXT NOT NULL,cancel_requested INTEGER NOT NULL DEFAULT 0,error TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,started_at TEXT,finished_at TEXT,
     UNIQUE(batch_id,project_id,shot_id)
   );
   CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_one_active_shot ON illustration_queue_jobs(project_id,shot_id)
     WHERE status IN ('queued','running');
   CREATE INDEX IF NOT EXISTS idx_queue_status ON illustration_queue_jobs(status,created_at);
   CREATE TABLE IF NOT EXISTS illustration_queue_events(
     id TEXT PRIMARY KEY,job_id TEXT NOT NULL,event TEXT NOT NULL,detail TEXT NOT NULL,at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_queue_events_job ON illustration_queue_events(job_id,at);
  `);
  // Process was previously terminated: never infer successful/failed provider delivery.
  // Leave image slots as 'generating'; V38 manual recovery handles them after grace period.
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const rows=this.db.prepare("SELECT id FROM illustration_queue_jobs WHERE status='running'").all();
   for(const row of rows){
    this.db.prepare("UPDATE illustration_queue_jobs SET status='interrupted',error=?,finished_at=? WHERE id=?").run('Worker restarted; provider outcome unknown. Review provider and recover the image slot manually.',stamp(),row.id);
    this._event(row.id,'interrupted','worker_restart');
   }
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 _event(id,event,detail=''){
  this.db.prepare('INSERT INTO illustration_queue_events VALUES(?,?,?,?,?)').run('qe_'+randomUUID(),id,event,String(detail).slice(0,100),stamp());
 }
 _job(id){
  const row=this.db.prepare('SELECT * FROM illustration_queue_jobs WHERE id=?').get(id);
  if(!row)fail('Queue job not found',404);
  return row;
 }
 _view(row){
  return {id:row.id,batchId:row.batch_id,projectId:row.project_id,shotId:row.shot_id,
   status:row.status,cancelRequested:!!row.cancel_requested,provider:row.provider,
   maxAttempts:row.max_attempts,error:row.error||null,createdAt:row.created_at,
   startedAt:row.started_at||null,finishedAt:row.finished_at||null};
 }
 get({projectId='',limit=80}={}){
  if(projectId)this.illustrations._project(projectId);
  const cap=Math.min(150,Math.max(1,Number(limit)||80));
  const rows=projectId?
   this.db.prepare('SELECT * FROM illustration_queue_jobs WHERE project_id=? ORDER BY rowid DESC LIMIT ?').all(projectId,cap):
   this.db.prepare('SELECT * FROM illustration_queue_jobs ORDER BY rowid DESC LIMIT ?').all(cap);
  const counts=projectId?
   this.db.prepare('SELECT status,COUNT(*) AS n FROM illustration_queue_jobs WHERE project_id=? GROUP BY status').all(projectId):
   this.db.prepare('SELECT status,COUNT(*) AS n FROM illustration_queue_jobs GROUP BY status').all();
  return {active:this.running!==null,stopping:this.stopping,counts:Object.fromEntries(counts.map(x=>[x.status,x.n])),jobs:rows.map(x=>this._view(x)),requiresConsent:true,autoResumed:false};
 }
 events(jobId){
  this._job(jobId);
  return this.db.prepare('SELECT event,detail,at FROM illustration_queue_events WHERE job_id=? ORDER BY rowid DESC LIMIT 30').all(jobId);
 }
 enqueue({idempotencyKey,allowExternalAI=false,items=[],provider='openai',fallbackProviders=[],maxAttempts=1}={}){
  if(!allowExternalAI)fail('Explicit permission required to schedule external image calls',403);
  if(typeof idempotencyKey!=='string'||!(/^[a-zA-Z0-9_-]{8,100}$/).test(idempotencyKey))fail('Provide a stable 8-100 character idempotencyKey');
  if(!Array.isArray(items)||items.length<1||items.length>30)fail('Select 1-30 image slots for a batch');
  if(!providers.has(provider)||!Array.isArray(fallbackProviders)||fallbackProviders.length>2||fallbackProviders.some(p=>!providers.has(p)))fail('Invalid image provider fallback list');
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)fail('maxAttempts must be 1-3');
  const choices=[...new Set([provider,...fallbackProviders])].slice(0,maxAttempts);
  const input=items.map(({projectId,shotId,expectedUpdatedAt})=>({projectId,shotId,expectedUpdatedAt}));
  for(const item of input)if(!/^ep_[a-z0-9-]+$/.test(item.projectId||'')||!/^il_[a-z0-9-]+$/.test(item.shotId||'')||typeof item.expectedUpdatedAt!=='string')fail('Invalid project, image slot, or expected update time');
  if(new Set(input.map(x=>x.projectId+':'+x.shotId)).size!==input.length)fail('Duplicate image slots in batch');
  const digest=fingerprint({input,provider,choices,maxAttempts});
  const existing=this.db.prepare('SELECT * FROM illustration_queue_batches WHERE idempotency_key=?').get(idempotencyKey);
  if(existing){
   if(existing.fingerprint!==digest)fail('Idempotency key was used with a different batch',409);
   return this.batch(existing.id);
  }
  // Validate every item before creating a single job. Queueing is never a provider call.
  const prepared=input.map(x=>{
   const shot=this.illustrations._shot(x.projectId,x.shotId);
   const project=this.illustrations._project(x.projectId);
   if(shot.updated_at!==x.expectedUpdatedAt)fail('Illustration slot changed; refresh before queueing',409);
   if(shot.master_revision!==project.channels.master.document.revision||shot.plan_id!==this.illustrations._latest(x.projectId)?.id)fail('Latest article or illustration plan changed',409);
   if(!['planned','failed'].includes(shot.status))fail('Only planned or failed image slots may be queued',409);
   if(this.illustrations.inflight.has(x.shotId))fail('Image slot is running already',409);
   return {...x,planId:shot.plan_id,revision:shot.master_revision};
  });
  const batchId='qb_'+randomUUID();
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const raced=this.db.prepare('SELECT * FROM illustration_queue_batches WHERE idempotency_key=?').get(idempotencyKey);
   if(raced)fail('Batch was enqueued concurrently; retry using the same key',409);
   this.db.prepare('INSERT INTO illustration_queue_batches VALUES(?,?,?,?)').run(batchId,idempotencyKey,digest,stamp());
   for(const item of prepared){
    const id='qj_'+randomUUID();
    this.db.prepare(`INSERT INTO illustration_queue_jobs(id,batch_id,project_id,shot_id,plan_id,source_revision,shot_updated_at,provider,fallback_json,max_attempts,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
     .run(id,batchId,item.projectId,item.shotId,item.planId,item.revision,item.expectedUpdatedAt,provider,JSON.stringify(choices.slice(1)),maxAttempts,'queued',stamp());
    this._event(id,'queued','explicit_consent');
   }
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');if(/UNIQUE constraint/.test(String(e?.message)))fail('Image slot is already queued or running',409);throw e}
  return this.batch(batchId);
 }
 batch(id){
  const b=this.db.prepare('SELECT * FROM illustration_queue_batches WHERE id=?').get(id);
  if(!b)fail('Queue batch not found',404);
  return {id:b.id,createdAt:b.created_at,jobs:this.db.prepare('SELECT * FROM illustration_queue_jobs WHERE batch_id=? ORDER BY rowid').all(id).map(x=>this._view(x))};
 }
 cancel(jobId){
  const row=this._job(jobId);
  if(terminal.has(row.status))return this._view(row);
  if(row.status==='queued'){
   this.db.prepare("UPDATE illustration_queue_jobs SET status='cancelled',cancel_requested=1,finished_at=? WHERE id=? AND status='queued'").run(stamp(),jobId);
   this._event(jobId,'cancelled','before_dispatch');
  }else if(row.status==='running'){
   this.db.prepare("UPDATE illustration_queue_jobs SET cancel_requested=1 WHERE id=? AND status='running'").run(jobId);
   this._event(jobId,'cancel_requested','inflight_may_be_billed');
  }
  return this._view(this._job(jobId));
 }
 retry(jobId,{allowExternalAI=false}={}){
  if(!allowExternalAI)fail('Explicit permission required for another image request',403);
  const row=this._job(jobId);
  if(!['failed','blocked_budget','obsolete'].includes(row.status))fail('Only failed, budget-blocked or obsolete queue jobs may be retried',409);
  const shot=this.illustrations._shot(row.project_id,row.shot_id),project=this.illustrations._project(row.project_id);
  if(shot.plan_id!==this.illustrations._latest(row.project_id)?.id||shot.master_revision!==project.channels.master.document.revision)fail('Old illustration plan is not reusable; replan and enqueue',409);
  if(!['planned','failed'].includes(shot.status))fail('Image slot must be manually recovered before retrying',409);
  this.db.exec('BEGIN IMMEDIATE');
  try{
   this.db.prepare("UPDATE illustration_queue_jobs SET status='queued',cancel_requested=0,shot_updated_at=?,error='',started_at=NULL,finished_at=NULL WHERE id=?").run(shot.updated_at,jobId);
   this._event(jobId,'requeued','explicit_consent');
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');if(/UNIQUE constraint/.test(String(e?.message)))fail('Image slot already has an active job',409);throw e}
  return this._view(this._job(jobId));
 }
 // Explicit action required for first start AND for resuming after server restart.
 start({allowExternalAI=false}={}){
  if(!allowExternalAI)fail('Explicit consent required to start or resume queued external calls',403);
  if(!this.running){
   this.stopping=false;
   this.running=Promise.resolve().then(()=>this._drain()).finally(()=>{this.running=null});
  }
  return this.get();
 }
 pause(){
  this.stopping=true; // Future jobs won't start; no attempt to undo an in-flight paid request.
  return this.get();
 }
 async waitForIdle(){if(this.running)await this.running;return this.get()}
 _claim(){
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const row=this.db.prepare("SELECT * FROM illustration_queue_jobs WHERE status='queued' ORDER BY rowid LIMIT 1").get();
   if(!row){this.db.exec('COMMIT');return null}
   this.db.prepare("UPDATE illustration_queue_jobs SET status='running',started_at=?,finished_at=NULL WHERE id=? AND status='queued'").run(stamp(),row.id);
   this._event(row.id,'started','single_worker');
   this.db.exec('COMMIT');
   return this._job(row.id);
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 _finish(row,status,error=''){
  const was=this._job(row.id);
  const decision=was.cancel_requested?'cancelled':status;
  this.db.prepare('UPDATE illustration_queue_jobs SET status=?,error=?,finished_at=? WHERE id=? AND status=\'running\'').run(decision,safeError({message:error}),stamp(),row.id);
  this._event(row.id,decision,decision==='cancelled'?'completed_after_cancel_request':status==='completed'?'generated_not_approved':'manual_review_required');
  return decision;
 }
 async _drain(){
  while(!this.stopping){
   const row=this._claim();
   if(!row)return;
   try{
    // Freshness must be checked again at dispatch, never just at queue creation.
    const shot=this.illustrations._shot(row.project_id,row.shot_id);
    const project=this.illustrations._project(row.project_id);
    if(shot.plan_id!==row.plan_id||shot.master_revision!==row.source_revision||
       project.channels.master.document.revision!==row.source_revision||shot.updated_at!==row.shot_updated_at||
       !['planned','failed'].includes(shot.status)){
       this._finish(row,'obsolete','Article or image slot changed after queueing');
       continue;
    }
    await this.illustrations.generate(row.project_id,row.shot_id,{
     allowExternalAI:true,provider:row.provider,
     fallbackProviders:JSON.parse(row.fallback_json),maxAttempts:row.max_attempts,
     shouldContinue:()=>!this._job(row.id).cancel_requested&&!this.stopping
    });
    this._finish(row,'completed','');
   }catch(e){
    const blocked=Number(e?.status)===429;
    this._finish(row,blocked?'blocked_budget':'failed',safeError(e));
    if(blocked){this.stopping=true;return}
   }
  }
 }
}

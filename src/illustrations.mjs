/** Article-to-illustration agent. A plan is NOT a generated image or evidence of any claim.
 * Images stay private until an author explicitly approves them and maps a destination URL.
 */
import {randomUUID} from 'node:crypto';
import {ValidationError} from './verification.mjs';
import {anyImageProvider,configuredProviders,generateProviderImage,editProviderImage} from './image-providers.mjs';
import {composeImagePrompt,plannerConfigured,planScenesWithModel} from './illustration-agent.mjs';
import {DEFAULT_VISUAL_PROFILE,validateVisualProfile,localImageCheck,imageQualityConfigured,visionReviewImage} from './visual-quality.mjs';
import {compareImagePair,compareConfigured,validateAuthorFeedback,preferencePrompt} from './image-feedback.mjs';
import {VisualSeriesService} from './visual-series.mjs';
import {ImageRequestBudget} from './image-request-budget.mjs';
import {markdownImageTokens} from './image-roundtrip-reconciliation.mjs';

const fail=(message,status=400)=>{throw new ValidationError(message,status)};
const now=()=>new Date().toISOString();
const parse=x=>JSON.parse(x);
const normalize=s=>String(s||'').replace(/\s+/gu,' ').trim();
const CHANNELS=new Set(['wechat','zhihu']);
const maxExcerpts=140;
export function illustrationsConfigured(){return anyImageProvider();}
// Kept for V32 callers/tests; V33 dispatches to provider-specific implementations.
export async function requestImageGeneration(prompt,options){return generateProviderImage(prompt,options)}
function slotPlan(project,doc,visualProfile){
 const paragraphs=(doc.paragraphs||[]).filter(x=>normalize(x.text).length>18);
 const indexes=[Math.max(0,Math.floor(paragraphs.length/3)),Math.max(0,Math.floor(paragraphs.length*2/3))];
 const slots=[{role:'cover',paragraphId:'',excerpt:project.title,alt:`${project.title}：概念封面插画`,scene:`Create an editorial metaphor for the central theme of ${normalize(project.title).slice(0,130)}; one visual focus with generous whitespace`,style:'editorial'}];
 for(const index of [...new Set(indexes)]){const p=paragraphs[index];if(!p)continue;const caption=normalize(p.text).slice(0,maxExcerpts);
 slots.push({role:'section',paragraphId:p.id,excerpt:caption,alt:`章节概念配图：${caption.slice(0,40)}`,scene:`An editorial illustration communicating the section's central technical concept: ${caption}`,style:'editorial'});
 }
 return slots.slice(0,3).map((shot,i)=>({...shot,ordinal:i+1,prompt:composeImagePrompt({...shot,title:project.title,visualProfile})}));
}
export class IllustrationService {
 constructor(store,editorial,assets,generator=requestImageGeneration,editor=editProviderImage){this.editor=editor;this.db=store.db;this.editorial=editorial;this.assets=assets;this.generator=generator;this.inflight=new Set();this.db.exec(`
 CREATE TABLE IF NOT EXISTS article_illustration_plans(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,master_revision INTEGER NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_illustration_plans_project ON article_illustration_plans(project_id,created_at);
 CREATE TABLE IF NOT EXISTS article_illustration_shots(id TEXT PRIMARY KEY,plan_id TEXT NOT NULL,role TEXT NOT NULL,ordinal INTEGER NOT NULL,paragraph_id TEXT NOT NULL,alt TEXT NOT NULL,prompt TEXT NOT NULL,status TEXT NOT NULL,asset_id TEXT NOT NULL DEFAULT '',model TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_illustration_shots_plan ON article_illustration_shots(plan_id,ordinal);
 CREATE TABLE IF NOT EXISTS article_illustration_profiles(project_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,profile_json TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS article_illustration_attempts(id TEXT PRIMARY KEY,shot_id TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,result TEXT NOT NULL,elapsed_ms INTEGER NOT NULL,error TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_illustration_attempts_shot ON article_illustration_attempts(shot_id,created_at);
 CREATE TABLE IF NOT EXISTS article_illustration_candidates(id TEXT PRIMARY KEY,shot_id TEXT NOT NULL,reference_asset_id TEXT NOT NULL,asset_id TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,instruction TEXT NOT NULL,prompt TEXT NOT NULL,status TEXT NOT NULL,master_revision INTEGER NOT NULL,profile_revision INTEGER NOT NULL,shot_updated_at TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_illustration_candidates_shot ON article_illustration_candidates(shot_id,created_at);
 CREATE TABLE IF NOT EXISTS article_illustration_edits(id TEXT PRIMARY KEY,shot_id TEXT NOT NULL,reference_asset_id TEXT NOT NULL,provider TEXT NOT NULL,result TEXT NOT NULL,error TEXT NOT NULL,elapsed_ms INTEGER NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_illustration_edits_shot ON article_illustration_edits(shot_id,created_at);
 CREATE TABLE IF NOT EXISTS article_illustration_comparisons(id TEXT PRIMARY KEY,shot_id TEXT NOT NULL,candidate_id TEXT NOT NULL,reference_asset_id TEXT NOT NULL,asset_id TEXT NOT NULL,assessment_json TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_illustration_comparison_candidate ON article_illustration_comparisons(candidate_id,created_at);
 CREATE TABLE IF NOT EXISTS article_illustration_feedback(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,shot_id TEXT NOT NULL,candidate_id TEXT NOT NULL UNIQUE,rating TEXT NOT NULL,note TEXT NOT NULL,remember INTEGER NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_illustration_feedback_project ON article_illustration_feedback(project_id,created_at);

 `);
 this.series=new VisualSeriesService(this.db,this.editorial,this.assets);
 this.budget=new ImageRequestBudget(this.db);
 const candidateFields=this.db.prepare('PRAGMA table_info(article_illustration_candidates)').all().map(x=>x.name);
 if(!candidateFields.includes('reference_is_shared'))this.db.exec('ALTER TABLE article_illustration_candidates ADD COLUMN reference_is_shared INTEGER NOT NULL DEFAULT 0');
 const fields=this.db.prepare('PRAGMA table_info(article_illustration_shots)').all().map(x=>x.name);
 for(const [name,type] of [['scene',"TEXT NOT NULL DEFAULT ''"],['style',"TEXT NOT NULL DEFAULT 'editorial'"],['provider',"TEXT NOT NULL DEFAULT ''"],['review_json',"TEXT NOT NULL DEFAULT ''"]])if(!fields.includes(name))this.db.exec(`ALTER TABLE article_illustration_shots ADD COLUMN ${name} ${type}`);
 }
 /** Explicit opt-in only. Private feedback never crosses project boundaries. */
 visualMemory(projectId){this._project(projectId);const items=this.db.prepare('SELECT id,candidate_id AS candidateId,rating,note,created_at AS createdAt FROM article_illustration_feedback WHERE project_id=? AND remember=1 ORDER BY rowid DESC LIMIT 6').all(projectId);return {projectId,preferences:items};}
 _memoryPrompt(projectId){return preferencePrompt(this.visualMemory(projectId).preferences.map(x=>x.note))+this.series.seriesMemoryPrompt(projectId);}
 requestBudget(projectId){this._project(projectId);return {...this.budget.get(projectId),recent:this.budget.history(projectId,15)};}
 updateRequestBudget(projectId,value){this._project(projectId);return this.budget.setLimit(projectId,value);}
 visualProfiles(){return this.db.prepare('SELECT project_id,revision,profile_json FROM article_illustration_profiles ORDER BY rowid DESC LIMIT 50').all().map(row=>({projectId:row.project_id,revision:row.revision,...JSON.parse(row.profile_json)}));}
 visualProfile(projectId){this._project(projectId);const row=this.db.prepare('SELECT * FROM article_illustration_profiles WHERE project_id=?').get(projectId);return row?{...JSON.parse(row.profile_json),revision:row.revision,updatedAt:row.updated_at}:{...DEFAULT_VISUAL_PROFILE,revision:0,updatedAt:null};}
 setVisualProfile(projectId,{expectedRevision,profile}={}){
  const before=this.visualProfile(projectId);if(!Number.isInteger(expectedRevision)||before.revision!==expectedRevision)fail('Visual style changed; reload before updating',409);
  const value=validateVisualProfile(profile),time=now();
  if(this.inflight.size){const shots=this._latest(projectId);if(shots&&this.db.prepare("SELECT 1 FROM article_illustration_shots WHERE plan_id=? AND status='generating' LIMIT 1").get(shots.id))fail('Cannot change visual profile while generating images',409);}
  this.db.exec('BEGIN IMMEDIATE');try{
   this.db.prepare('INSERT INTO article_illustration_profiles VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,profile_json=excluded.profile_json,updated_at=excluded.updated_at').run(projectId,expectedRevision+1,JSON.stringify(value),time);
   this.series.revokeProjectReferences(projectId); // a changed style unapproves current images
   const plan=this._latest(projectId);if(plan){
    const project=this._project(projectId),visualProfile={...value,revision:expectedRevision+1};
    for(const row of this.db.prepare('SELECT * FROM article_illustration_shots WHERE plan_id=?').all(plan.id)){
     const fresh=composeImagePrompt({title:project.title,role:row.role,scene:row.scene,style:row.style,visualProfile});
     const changedAt=new Date(Math.max(Date.now(),Date.parse(row.updated_at)+1)).toISOString();
     this.db.prepare("UPDATE article_illustration_shots SET status='planned',asset_id='',model='',provider='',error='',review_json='',prompt=?,updated_at=? WHERE id=?").run(fresh,changedAt,row.id);
    }
   }
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
  return this.get(projectId);
 }
 attempts(projectId,shotId){this._shot(projectId,shotId);return this.db.prepare('SELECT provider,model,result,elapsed_ms AS elapsedMs,error,created_at AS createdAt FROM article_illustration_attempts WHERE shot_id=? ORDER BY rowid').all(shotId);}
 _attempt(shotId,provider,result,elapsed,model='',error=''){
  this.db.prepare('INSERT INTO article_illustration_attempts VALUES(?,?,?,?,?,?,?,?)').run('ia_'+randomUUID(),shotId,provider,String(model).slice(0,100),result,Math.max(0,Math.round(elapsed)),String(error).slice(0,160),now());
 }
 _project(projectId){return this.editorial.get(projectId);}
 _latest(projectId){return this.db.prepare('SELECT * FROM article_illustration_plans WHERE project_id=? ORDER BY rowid DESC LIMIT 1').get(projectId);}
 _shot(projectId,id){const row=this.db.prepare('SELECT s.*,p.project_id,p.master_revision FROM article_illustration_shots s JOIN article_illustration_plans p ON p.id=s.plan_id WHERE s.id=? AND p.project_id=?').get(id,projectId);if(!row)fail('Illustration task not found',404);return row;}
 _present(row){return {candidates:this.candidates(row.project_id||this.db.prepare('SELECT project_id FROM article_illustration_plans WHERE id=?').get(row.plan_id).project_id,row.id),id:row.id,role:row.role,ordinal:row.ordinal,paragraphId:row.paragraph_id,alt:row.alt,prompt:row.prompt,status:row.status,assetId:row.asset_id||null,asset:row.asset_id?this.assets.get(row.asset_id):null,model:row.model||null,provider:row.provider||null,scene:row.scene||'',style:row.style||'editorial',error:row.error||null,review:row.review_json?JSON.parse(row.review_json):null,editAttempts:this.editAttempts(row.project_id||this.db.prepare('SELECT project_id FROM article_illustration_plans WHERE id=?').get(row.plan_id).project_id,row.id),attempts:this.attempts(row.project_id||this.db.prepare('SELECT project_id FROM article_illustration_plans WHERE id=?').get(row.plan_id).project_id,row.id),updatedAt:row.updated_at};}
 get(projectId){const project=this._project(projectId),plan=this._latest(projectId),revision=project.channels.master.document.revision;
  if(!plan)return {projectId,title:project.title,sourceRevision:revision,visualProfile:this.visualProfile(projectId),reviewerConfigured:imageQualityConfigured(),comparatorConfigured:compareConfigured(),visualMemory:this.visualMemory(projectId),plan:null,stale:false,shots:[],requestBudget:this.budget.get(projectId),configured:illustrationsConfigured(),providers:configuredProviders(),plannerConfigured:plannerConfigured(),requiresConsent:true};
  const rows=this.db.prepare('SELECT * FROM article_illustration_shots WHERE plan_id=? ORDER BY ordinal').all(plan.id);
  return {projectId,title:project.title,sourceRevision:revision,visualProfile:this.visualProfile(projectId),reviewerConfigured:imageQualityConfigured(),comparatorConfigured:compareConfigured(),visualMemory:this.visualMemory(projectId),plan:{id:plan.id,masterRevision:plan.master_revision,createdAt:plan.created_at},stale:plan.master_revision!==revision,shots:rows.map(x=>this._present(x)),requestBudget:this.budget.get(projectId),configured:illustrationsConfigured(),providers:configuredProviders(),plannerConfigured:plannerConfigured(),requiresConsent:true};
 }
 _insertPlan(projectId,doc,slots){const id='ip_'+randomUUID(),time=now();
  this.db.exec('BEGIN IMMEDIATE');try{
   this.series.revokeProjectReferences(projectId); // old article image anchors are no longer current
   this.db.prepare('INSERT INTO article_illustration_plans VALUES(?,?,?,?)').run(id,projectId,doc.revision,time);
   for(const shot of slots)this.db.prepare(`INSERT INTO article_illustration_shots(id,plan_id,role,ordinal,paragraph_id,alt,prompt,status,asset_id,model,error,created_at,updated_at,scene,style,provider) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('il_'+randomUUID(),id,shot.role,shot.ordinal,shot.paragraphId,shot.alt,shot.prompt,'planned','','','',time,time,shot.scene,shot.style,'');
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
  return this.get(projectId);
 }
 plan(projectId,{expectedMasterRevision}={}){const project=this._project(projectId),doc=project.channels.master.document;
  if(!Number.isInteger(expectedMasterRevision)||expectedMasterRevision!==doc.revision)fail('Article changed; reload before creating illustration plan',409);
  return this._insertPlan(projectId,doc,slotPlan(project,doc,this.visualProfile(projectId)));
 }
 async agentPlan(projectId,{expectedMasterRevision,allowExternalAI=false}={}){
  if(!allowExternalAI)fail('Explicit consent required before sending excerpts to a planning model',403);
  const project=this._project(projectId),doc=project.channels.master.document;
  if(!Number.isInteger(expectedMasterRevision)||expectedMasterRevision!==doc.revision)fail('Article changed; reload before planning illustrations',409);
  if(!plannerConfigured())fail('Planner model is not configured',503);
  const original=slotPlan(project,doc,this.visualProfile(projectId));
  const reservation=this.budget.reserve(projectId,{kind:'plan',provider:'planner'});
  let scenes;
  try{scenes=await planScenesWithModel(project,doc,original);this.budget.finish(reservation.id,'success');}
  catch(e){this.budget.finish(reservation.id,'failed');throw e;}
  if(this._project(projectId).channels.master.document.revision!==doc.revision)fail('Article changed while planning illustrations',409);
  return this._insertPlan(projectId,doc,original.map((slot,i)=>({...slot,...scenes[i],prompt:composeImagePrompt({...slot,...scenes[i],title:project.title,visualProfile:this.visualProfile(projectId)})})));
 }
 previewPrompt(projectId,shotId,provider='openai'){
  const row=this._shot(projectId,shotId),project=this._project(projectId);
  const source=slotPlan(project,project.channels.master.document,this.visualProfile(projectId)).find(x=>x.role===row.role&&x.paragraphId===row.paragraph_id);
  return {provider,role:row.role,style:row.style||'editorial',prompt:composeImagePrompt({title:project.title,role:row.role,scene:row.scene||row.prompt,style:row.style||'editorial',excerpt:source?.excerpt||'',provider,visualProfile:this.visualProfile(projectId)})+this._memoryPrompt(projectId),sourceRevision:row.master_revision,stale:row.master_revision!==project.channels.master.document.revision};
 }
 editPrompt(projectId,shotId,{expectedUpdatedAt,scene,style='editorial',provider='openai'}={}){
  const row=this._shot(projectId,shotId),project=this._project(projectId);
  if(row.master_revision!==project.channels.master.document.revision)fail('Article changed; illustration plan is stale',409);
  if(typeof expectedUpdatedAt!=='string'||row.updated_at!==expectedUpdatedAt)fail('Illustration prompt changed; reload before editing',409);
  if(row.status==='generating')fail('Cannot edit while generating image',409);
  if(typeof scene!=='string'||scene.trim().length<12||scene.length>800)fail('Visual scene must be 12-800 characters');
  const source=slotPlan(project,project.channels.master.document,this.visualProfile(projectId)).find(x=>x.role===row.role&&x.paragraphId===row.paragraph_id);
  const prompt=composeImagePrompt({title:project.title,role:row.role,excerpt:source?.excerpt||'',scene,style,provider,visualProfile:this.visualProfile(projectId)});
  const updated=new Date(Math.max(Date.now(),Date.parse(row.updated_at)+1)).toISOString();
  if(row.asset_id)this.series.revokeProjectReferences(projectId,row.asset_id);
  this.db.prepare("UPDATE article_illustration_shots SET scene=?,style=?,prompt=?,asset_id='',model='',provider='',status='planned',error='',review_json='',updated_at=? WHERE id=?").run(scene.trim(),style,prompt,updated,shotId);
  return this._present(this._shot(projectId,shotId));
 }
 async generate(projectId,shotId,{allowExternalAI=false,provider='openai',fallbackProviders=[],maxAttempts=1,shouldContinue=null}={}){
  const row=this._shot(projectId,shotId),project=this._project(projectId);
  if(row.master_revision!==project.channels.master.document.revision)fail('Article changed; illustration plan is stale',409);
  if(!allowExternalAI)fail('Explicit consent required before sending a contextual image prompt to a configured image provider',403);
  if(!['planned','failed'].includes(row.status))fail('Only planned or failed images can be generated',409);
  if(!['openai','gemini','qwen'].includes(provider))fail('Unsupported image provider');
  if(!Array.isArray(fallbackProviders)||fallbackProviders.length>2||fallbackProviders.some(x=>!['openai','gemini','qwen'].includes(x)))fail('Invalid fallback provider list');
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>3)fail('maxAttempts must be 1-3');
  const choices=[...new Set([provider,...fallbackProviders])].slice(0,maxAttempts);
  // Explicit configured provider selection. A custom test generator can be injected without real keys.
  if(this.generator===requestImageGeneration){const ready=new Set(configuredProviders().filter(x=>x.configured).map(x=>x.id));if(choices.some(x=>!ready.has(x)))fail('One or more image providers are not configured',503);}
  if(this.inflight.has(shotId))fail('Image generation is already in progress',409);
  this.inflight.add(shotId);this.db.prepare("UPDATE article_illustration_shots SET status='generating',error='',review_json='',updated_at=? WHERE id=?").run(now(),shotId);
  try{
   let lastError=null;
   for(let i=0;i<choices.length;i++){
    if(typeof shouldContinue==='function'&&!shouldContinue())fail('Queue job cancelled; no further provider calls',409);
    const current=choices[i],start=Date.now();
    let reservation=null;
    try{
     const prompt=composeImagePrompt({title:project.title,role:row.role,scene:row.scene||row.prompt,style:row.style||'editorial',provider:current,visualProfile:this.visualProfile(projectId)})+this._memoryPrompt(projectId);
     reservation=this.budget.reserve(projectId,{shotId,kind:'generate',provider:current});
     const response=await this.generator(prompt,{provider:current,role:row.role});
     if(this._project(projectId).channels.master.document.revision!==row.master_revision)fail('Article changed during image generation; renew the illustration plan',409);
     if(!response?.base64||typeof response.base64!=='string')fail('Image provider returned invalid image data',502);
     const head=Buffer.from(response.base64.slice(0,24),'base64');const extension=head[0]===0xff&&head[1]===0xd8?'jpg':head.toString('ascii',0,4)==='RIFF'?'webp':'png';
     const asset=this.assets.upload({name:`article-${row.role}-${row.ordinal}.${extension}`,alt:row.alt,base64:response.base64});
     this.budget.finish(reservation.id,'success');
     this._attempt(shotId,current,'success',Date.now()-start,response.model||'', '');
     this.db.prepare("UPDATE article_illustration_shots SET status='generated',asset_id=?,model=?,provider=?,prompt=?,review_json=?,updated_at=? WHERE id=?").run(asset.id,String(response.model||'configured-image-provider').slice(0,100),response.provider||current,prompt,JSON.stringify({...localImageCheck(asset),advisoryOnly:true,kind:'local',checkedAt:now()}),now(),shotId);
     return this._present(this._shot(projectId,shotId));
    }catch(e){lastError=e;
     if(reservation)this.budget.finish(reservation.id,'failed');
     if(e?.status===429&&!reservation)throw e;
     const safeError=String(e?.message||'Image generation failed').slice(0,160).replace(/(Bearer\s+)[^\s]+/gi,'$1[redacted]');
     this._attempt(shotId,current,'failed',Date.now()-start,'',safeError);
     // Only retry transient provider/network responses, never invalid image or stale source.
     if(!(typeof e?.retryable==='boolean'?e.retryable:[429,502,503,504].includes(Number(e?.status)))||/Article changed|invalid image data|Unsupported image bytes|Invalid PNG/.test(safeError))break;
    }
   }
   throw lastError||new Error('Image generation failed');
  }catch(e){this.db.prepare("UPDATE article_illustration_shots SET status='failed',error=?,updated_at=? WHERE id=?").run(String(e?.message||'Image generation failed').slice(0,220),now(),shotId);throw e;}
  finally{this.inflight.delete(shotId)}
 }
 /** Explicitly clear a task abandoned by a process crash; never restart the provider call. */
 recoverInterrupted(projectId,shotId,{expectedUpdatedAt}={}){
  const row=this._shot(projectId,shotId);
  if(row.master_revision!==this._project(projectId).channels.master.document.revision)fail('Source article changed; create a new illustration plan',409);
  if(row.status!=='generating')fail('Only interrupted generating slots can be recovered',409);
  if(this.inflight.has(shotId))fail('Image generation is still active in this process',409);
  if(!expectedUpdatedAt||row.updated_at!==expectedUpdatedAt)fail('Image task changed; reload before recovery',409);
  const since=Date.parse(row.updated_at);
  if(!Number.isFinite(since)||Date.now()-since<5*60*1000)fail('Allow at least 5 minutes before marking an image request as interrupted',409);
  const updated=new Date(Math.max(Date.now(),since+1)).toISOString();
  this.db.exec('BEGIN IMMEDIATE');try{
   this.budget.interruptGeneration(projectId,shotId);
   this.db.prepare("UPDATE article_illustration_shots SET status='failed',error=?,updated_at=? WHERE id=? AND status='generating'").run('Previous generation interrupted. Provider outcome and billing are unknown. Review your provider dashboard before retrying.',updated,shotId);
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
  return this._present(this._shot(projectId,shotId));
 }
 async review(projectId,shotId,{allowExternalAI=false}={}){
  const row=this._shot(projectId,shotId),project=this._project(projectId);
  if(row.master_revision!==project.channels.master.document.revision)fail('Article changed; illustration plan is stale',409);
  if(!['generated','approved','rejected'].includes(row.status)||!row.asset_id)fail('Generate an image before requesting quality review',409);
  if(!allowExternalAI)fail('Explicit image-sharing consent required for vision review',403);
  if(!imageQualityConfigured())fail('Vision reviewer is not configured',503);
  const asset=this.assets.get(row.asset_id),data=this.assets.preview(row.asset_id);
  const reservation=this.budget.reserve(projectId,{shotId,kind:'review',provider:'vision'});
  let result;
  try{result=await visionReviewImage({asset,body:data.body,prompt:row.prompt,profile:this.visualProfile(projectId)});this.budget.finish(reservation.id,'success');}
  catch(e){this.budget.finish(reservation.id,'failed');throw e;}
  const current=this._shot(projectId,shotId);
  if(current.asset_id!==row.asset_id||current.updated_at!==row.updated_at)fail('Image changed while being reviewed; reload first',409);
  const recorded={...result,kind:'vision',checkedAt:now()};
  if(row.status==='approved')this.series.revokeProjectReferences(projectId,row.asset_id);
  this.db.prepare("UPDATE article_illustration_shots SET review_json=?,status='generated' WHERE id=?").run(JSON.stringify(recorded),shotId);
  return this._present(this._shot(projectId,shotId));
 }
 decide(projectId,shotId,{decision}={}){
  const row=this._shot(projectId,shotId),project=this._project(projectId);
  if(row.master_revision!==project.channels.master.document.revision)fail('Article changed; plan must be renewed',409);
  if(!['approve','reject'].includes(decision))fail('Decision must be approve or reject');
  if(!['generated','approved','rejected'].includes(row.status))fail('Generate this image before approval',409);
  if(decision==='reject'&&row.asset_id)this.series.revokeProjectReferences(projectId,row.asset_id);
  this.db.prepare('UPDATE article_illustration_shots SET status=?,updated_at=? WHERE id=?').run(decision==='approve'?'approved':'rejected',now(),shotId);
  return this._present(this._shot(projectId,shotId));
 }
 /** Candidate revisions are immutable; the accepted asset remains untouched until an explicit selection. */
 candidates(projectId,shotId){this._shot(projectId,shotId);const rows=this.db.prepare('SELECT * FROM article_illustration_candidates WHERE shot_id=? ORDER BY rowid DESC LIMIT 20').all(shotId);
  return rows.map(row=>({id:row.id,assetId:row.asset_id,asset:this.assets.get(row.asset_id),referenceAssetId:row.reference_asset_id,referenceAsset:this._canSeeReference(projectId,shotId,row.reference_asset_id,!!row.reference_is_shared)?this.assets.get(row.reference_asset_id):null,comparison:this.latestComparison(row.id),feedback:this.candidateFeedback(row.id),provider:row.provider,model:row.model,instruction:row.instruction,prompt:row.prompt,status:row.status,createdAt:row.created_at,sourceRevision:row.master_revision,profileRevision:row.profile_revision}));
 }
 _canSeeReference(projectId,shotId,assetId,shared=false){if(shared){try{this.series.assertReference(projectId,assetId);return true}catch{return false}}const shot=this._shot(projectId,shotId);if(shot.asset_id===assetId||this.db.prepare('SELECT 1 FROM article_illustration_candidates WHERE shot_id=? AND asset_id=?').get(shotId,assetId))return true;try{this.series.assertReference(projectId,assetId);return true}catch{return false}}
 latestComparison(candidateId){const row=this.db.prepare('SELECT * FROM article_illustration_comparisons WHERE candidate_id=? ORDER BY rowid DESC LIMIT 1').get(candidateId);return row?{id:row.id,...JSON.parse(row.assessment_json),createdAt:row.created_at}:null;}
 candidateFeedback(candidateId){const row=this.db.prepare('SELECT rating,note,remember,created_at AS createdAt FROM article_illustration_feedback WHERE candidate_id=?').get(candidateId);return row?{...row,remember:!!row.remember}:null;}
 _candidate(projectId,shotId,candidateId){this._shot(projectId,shotId);const row=this.db.prepare('SELECT * FROM article_illustration_candidates WHERE id=? AND shot_id=?').get(candidateId,shotId);if(!row)fail('Candidate not found in this image slot',404);return row;}
 async compareCandidate(projectId,shotId,candidateId,{allowExternalAI=false,expectedUpdatedAt}={}){
  const shot=this._shot(projectId,shotId),candidate=this._candidate(projectId,shotId,candidateId),profile=this.visualProfile(projectId);
  if(!allowExternalAI)fail('Explicit two-image transmission consent is required',403);
  if(!compareConfigured())fail('Vision image comparison is not configured',503);
  if(!expectedUpdatedAt||shot.updated_at!==expectedUpdatedAt)fail('Image changed; reload comparison',409);
  if(shot.master_revision!==this._project(projectId).channels.master.document.revision||candidate.master_revision!==shot.master_revision||candidate.profile_revision!==profile.revision)fail('Candidate is stale',409);
  if(!['generated','selected'].includes(candidate.status))fail('Only active candidates can be assessed',409);
  if(this.inflight.has(shotId))fail('Image operation already running',409);
  const image=id=>{const asset=this.assets.get(id);return {mime:asset.mime,body:this.assets.preview(id).body}};
  this.inflight.add(shotId);
  try{
   const reservation=this.budget.reserve(projectId,{shotId,kind:'compare',provider:'vision'});
   let assessment;
   try{assessment=await compareImagePair({reference:image(candidate.reference_asset_id),candidate:image(candidate.asset_id),instruction:candidate.instruction,profile});this.budget.finish(reservation.id,'success');}
   catch(e){this.budget.finish(reservation.id,'failed');throw e;}
   const after=this._shot(projectId,shotId),again=this._candidate(projectId,shotId,candidateId);
   if(after.updated_at!==expectedUpdatedAt||again.status!==candidate.status||profile.revision!==this.visualProfile(projectId).revision||after.master_revision!==this._project(projectId).channels.master.document.revision)fail('Candidate or article changed during image comparison',409);
   const id='iq_'+randomUUID();this.db.prepare('INSERT INTO article_illustration_comparisons VALUES(?,?,?,?,?,?,?)').run(id,shotId,candidateId,candidate.reference_asset_id,candidate.asset_id,JSON.stringify(assessment),now());
   return this.latestComparison(candidateId);
  }finally{this.inflight.delete(shotId)}
 }
 submitCandidateFeedback(projectId,shotId,candidateId,{expectedUpdatedAt,...value}={}){
  const shot=this._shot(projectId,shotId),candidate=this._candidate(projectId,shotId,candidateId),profile=this.visualProfile(projectId);
  const {rating,note,remember}=validateAuthorFeedback(value);
  if(!expectedUpdatedAt||shot.updated_at!==expectedUpdatedAt)fail('Image changed; refresh before recording feedback',409);
  if(shot.master_revision!==this._project(projectId).channels.master.document.revision||candidate.master_revision!==shot.master_revision||candidate.profile_revision!==profile.revision)fail('Article or visual profile changed; old candidate is stale',409);
  if(this.inflight.has(shotId))fail('Wait for image operation to finish',409);
  if(this.candidateFeedback(candidateId))fail('Feedback already recorded; history is immutable',409);
  const id='if_'+randomUUID();this.db.prepare('INSERT INTO article_illustration_feedback VALUES(?,?,?,?,?,?,?,?)').run(id,projectId,shotId,candidateId,rating,note,remember?1:0,now());
  return {feedback:this.candidateFeedback(candidateId),memory:this.visualMemory(projectId)};
 }
 editAttempts(projectId,shotId){this._shot(projectId,shotId);return this.db.prepare('SELECT provider,result,error,elapsed_ms AS elapsedMs,created_at AS createdAt FROM article_illustration_edits WHERE shot_id=? ORDER BY rowid DESC LIMIT 20').all(shotId);}
 _editLog(shotId,assetId,provider,result,error,elapsed){this.db.prepare('INSERT INTO article_illustration_edits VALUES(?,?,?,?,?,?,?,?)').run('ie_'+randomUUID(),shotId,assetId,provider,result,String(error||'').slice(0,160),Math.max(0,Math.round(elapsed)),now());}
 async editImage(projectId,shotId,{allowExternalAI=false,expectedUpdatedAt,referenceAssetId,provider='openai',instruction}={}){
  const row=this._shot(projectId,shotId),project=this._project(projectId),profile=this.visualProfile(projectId);
  if(!allowExternalAI)fail('Explicit consent required before sending a reference image to an external model',403);
  if(row.master_revision!==project.channels.master.document.revision)fail('Article changed; refresh image plan',409);
  if(!expectedUpdatedAt||row.updated_at!==expectedUpdatedAt)fail('Image changed; reload before editing',409);
  if(!['generated','approved','rejected'].includes(row.status)||!row.asset_id)fail('Generate an image before editing',409);
  if(typeof instruction!=='string'||instruction.trim().length<12||instruction.length>800)fail('Image edit instruction must be 12-800 characters');
  if(!['openai','gemini','qwen'].includes(provider))fail('Unsupported image edit provider');
  const known=[row.asset_id,...this.db.prepare('SELECT asset_id FROM article_illustration_candidates WHERE shot_id=?').all(shotId).map(x=>x.asset_id)];
  const shared=typeof referenceAssetId==='string'&&!known.includes(referenceAssetId);
  if(typeof referenceAssetId!=='string'||!referenceAssetId)fail('Reference image is required',400);
  if(shared)this.series.assertReference(projectId,referenceAssetId);
  if(this.editor===editProviderImage&&!configuredProviders().some(x=>x.id===provider&&x.configured))fail('Image edit provider is not configured',503);
  if(this.inflight.has(shotId))fail('Image operation is already in progress',409);
  const reference=this.assets.preview(referenceAssetId);const record=this.assets.get(referenceAssetId);
  if(!['image/png','image/jpeg','image/webp'].includes(record.mime))fail('Unsupported reference image format',422);
  // Editing respects the original visual identity but never asks the model to invent evidence.
  const prompt=`Edit the supplied reference illustration for a Chinese technology article. Keep the established visual identity: ${profile.name}, palette ${profile.palette}, mood ${profile.mood}, avoid ${profile.avoid}. Art-director instruction: ${instruction.trim()}. Preserve the recognizable subject and composition except for the requested modification. No fabricated screenshots, data, people, logos, or unreadable written labels. The output is a conceptual editorial illustration, not documentary evidence.`+this._memoryPrompt(projectId);
  this.inflight.add(shotId);const start=Date.now();let reservation=null;
  try{
   reservation=this.budget.reserve(projectId,{shotId,kind:'edit',provider});
   const response=await this.editor(prompt,{provider,role:row.role,referenceBytes:reference.body,referenceMime:record.mime});
   const current=this._shot(projectId,shotId),currentProfile=this.visualProfile(projectId);
   if(current.updated_at!==expectedUpdatedAt||current.master_revision!==this._project(projectId).channels.master.document.revision||currentProfile.revision!==profile.revision)fail('Image or visual style changed during edit; candidate not saved',409);
   if(shared)this.series.assertReference(projectId,referenceAssetId); // revocation during paid API call blocks candidate storage
   if(typeof response?.base64!=='string')fail('Image editor returned no image bytes',502);
   const alt=`${row.alt}（候选修改）`;const asset=this.assets.upload({name:`candidate-${shotId}.png`,alt,base64:response.base64});
   const id='ic_'+randomUUID();this.db.prepare('INSERT INTO article_illustration_candidates(id,shot_id,reference_asset_id,asset_id,provider,model,instruction,prompt,status,master_revision,profile_revision,shot_updated_at,created_at,reference_is_shared) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,shotId,referenceAssetId,asset.id,response.provider||provider,String(response.model||'image-edit').slice(0,100),instruction.trim(),prompt,'generated',row.master_revision,profile.revision,expectedUpdatedAt,now(),shared?1:0);
   this.budget.finish(reservation.id,'success');
   this._editLog(shotId,referenceAssetId,provider,'success','',Date.now()-start);
   return {candidate:this.candidates(projectId,shotId).find(x=>x.id===id),shot:this._present(this._shot(projectId,shotId))};
  }catch(e){if(reservation)this.budget.finish(reservation.id,'failed');if(e?.status===429&&!reservation)throw e;this._editLog(shotId,referenceAssetId,provider,'failed',String(e?.message||'Image edit failed').replace(/(Bearer\s+)[^\s]+/gi,'$1[redacted]'),Date.now()-start);throw e;}
  finally{this.inflight.delete(shotId)}
 }
 decideCandidate(projectId,shotId,candidateId,{decision,expectedUpdatedAt}={}){
  const row=this._shot(projectId,shotId),project=this._project(projectId),profile=this.visualProfile(projectId);
  const candidate=this.db.prepare('SELECT * FROM article_illustration_candidates WHERE id=? AND shot_id=?').get(candidateId,shotId);
  if(!candidate)fail('Candidate not found for this image slot',404);
  if(!['select','reject'].includes(decision))fail('Candidate decision must be select or reject');
  if(!expectedUpdatedAt||row.updated_at!==expectedUpdatedAt)fail('Image changed; reload before selecting candidate',409);
  if(row.master_revision!==project.channels.master.document.revision||candidate.master_revision!==row.master_revision||candidate.profile_revision!==profile.revision)fail('Candidate belongs to an obsolete article or visual style',409);
  if(this.inflight.has(shotId))fail('Wait for current image operation to finish',409);
  if(decision==='reject'){
   if(candidate.status==='selected')fail('Current selected image cannot be rejected as a candidate; use shot decision',409);
   this.db.prepare("UPDATE article_illustration_candidates SET status='rejected' WHERE id=?").run(candidateId);return this._present(this._shot(projectId,shotId));
  }
  if(candidate.status!=='generated')fail('Only unselected candidates can be chosen',409);
  if(!this._canSeeReference(projectId,shotId,candidate.reference_asset_id,!!candidate.reference_is_shared))fail('Shared reference revoked before candidate selection',403);
  // Do not use old candidate after an unrelated edit of the main shot.
  if(row.asset_id!==candidate.reference_asset_id&&candidate.shot_updated_at!==row.updated_at)fail('Reference image has changed; create a new candidate',409);
  const updated=new Date(Math.max(Date.now(),Date.parse(row.updated_at)+1)).toISOString();
  this.db.exec('BEGIN IMMEDIATE');try{
   this.db.prepare("UPDATE article_illustration_candidates SET status='generated' WHERE shot_id=? AND status='selected'").run(shotId);
   this.db.prepare("UPDATE article_illustration_candidates SET status='selected' WHERE id=?").run(candidateId);
   if(row.asset_id)this.series.revokeProjectReferences(projectId,row.asset_id);
   this.db.prepare("UPDATE article_illustration_shots SET asset_id=?,provider=?,model=?,prompt=?,status='generated',review_json='',error='',updated_at=? WHERE id=?").run(candidate.asset_id,candidate.provider,candidate.model,candidate.prompt,updated,shotId);
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
  return this._present(this._shot(projectId,shotId));
 }
 /** Read-only handoff, never mutates the layout or bypasses V30/V31 review. */
 handoff(projectId,channel){if(!CHANNELS.has(channel))fail('Unsupported channel');const data=this.get(projectId);
  if(!data.plan)fail('Create an illustration plan first',409);
  if(data.stale)fail('Article has changed; illustration plan is stale',409);
  const draft=this.editorial.layoutDraft(projectId,channel);
  let markdown=draft.markdown;const unplaced=[],unmapped=[],inserted=[];
  // Existing imported images should not be duplicated on a second proposal.
  // Count by URL to handle repeated use of one asset across multiple slots.
  const existing=markdownImageTokens(markdown),consumed=new Map();
  const approved=data.shots.filter(s=>s.status==='approved');
  for(const shot of approved){const mapping=shot.asset?.mappings?.find(x=>x.channel===channel);
   if(!mapping){unmapped.push(shot.id);continue;}
   const key=mapping.url.replace(/%28/gi,'(').replace(/%29/gi,')');
   const alreadyUsed=consumed.get(key)||0;
   if(existing.filter(t=>t.url===key).length>alreadyUsed){
    consumed.set(key,alreadyUsed+1);
    inserted.push({id:shot.id,assetId:shot.assetId,after:shot.role==='cover'?'cover':shot.paragraphId,alreadyPresent:true});
    continue;
   }
   const alt=shot.alt.replace(/[\[\]\\\r\n]/g,' ');
   const safeUrl=mapping.url.replace(/\(/g,'%28').replace(/\)/g,'%29');
   const img=`![${alt}](${safeUrl})`;
   if(shot.role==='cover'){
    const m=markdown.match(/^# .+$/mu);if(!m){unplaced.push(shot.id);continue;}
    markdown=markdown.replace(m[0],m[0]+'\n\n'+img);inserted.push({id:shot.id,assetId:shot.assetId,after:'cover'});
   }else{
    const para=this._project(projectId).channels.master.document.paragraphs.find(p=>p.id===shot.paragraphId);
    if(!para||markdown.split(para.text).length!==2){unplaced.push(shot.id);continue;}
    markdown=markdown.replace(para.text,para.text+'\n\n'+img);inserted.push({id:shot.id,assetId:shot.assetId,after:shot.paragraphId});
   }
  }
  return {projectId,channel,layoutRevision:draft.layoutRevision,sourceRevision:data.sourceRevision,markdown,inserted,unmapped,unplaced,ready:unmapped.length===0&&unplaced.length===0&&inserted.length>0,platformVerified:false,warning:'Read-only proposed Markdown. Review changes with V30 audit before saving; image addresses are author-provided and must be tested on the target platform.'};
 }
}

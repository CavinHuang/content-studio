/** Article-to-illustration agent. A plan is NOT a generated image or evidence of any claim.
 * Images stay private until an author explicitly approves them and maps a destination URL.
 */
import {randomUUID} from 'node:crypto';
import {ValidationError} from './verification.mjs';
import {anyImageProvider,configuredProviders,generateProviderImage} from './image-providers.mjs';
import {composeImagePrompt,plannerConfigured,planScenesWithModel} from './illustration-agent.mjs';

const fail=(message,status=400)=>{throw new ValidationError(message,status)};
const now=()=>new Date().toISOString();
const parse=x=>JSON.parse(x);
const normalize=s=>String(s||'').replace(/\s+/gu,' ').trim();
const CHANNELS=new Set(['wechat','zhihu']);
const maxExcerpts=140;
export function illustrationsConfigured(){return anyImageProvider();}
// Kept for V32 callers/tests; V33 dispatches to provider-specific implementations.
export async function requestImageGeneration(prompt,options){return generateProviderImage(prompt,options)}
function slotPlan(project,doc){
 const paragraphs=(doc.paragraphs||[]).filter(x=>normalize(x.text).length>18);
 const indexes=[Math.max(0,Math.floor(paragraphs.length/3)),Math.max(0,Math.floor(paragraphs.length*2/3))];
 const slots=[{role:'cover',paragraphId:'',excerpt:project.title,alt:`${project.title}：概念封面插画`,scene:`Create an editorial metaphor for the central theme of ${normalize(project.title).slice(0,130)}; one visual focus with generous whitespace`,style:'editorial'}];
 for(const index of [...new Set(indexes)]){const p=paragraphs[index];if(!p)continue;const caption=normalize(p.text).slice(0,maxExcerpts);
 slots.push({role:'section',paragraphId:p.id,excerpt:caption,alt:`章节概念配图：${caption.slice(0,40)}`,scene:`An editorial illustration communicating the section's central technical concept: ${caption}`,style:'editorial'});
 }
 return slots.slice(0,3).map((shot,i)=>({...shot,ordinal:i+1,prompt:composeImagePrompt({...shot,title:project.title})}));
}
export class IllustrationService {
 constructor(store,editorial,assets,generator=requestImageGeneration){this.db=store.db;this.editorial=editorial;this.assets=assets;this.generator=generator;this.inflight=new Set();this.db.exec(`
 CREATE TABLE IF NOT EXISTS article_illustration_plans(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,master_revision INTEGER NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_illustration_plans_project ON article_illustration_plans(project_id,created_at);
 CREATE TABLE IF NOT EXISTS article_illustration_shots(id TEXT PRIMARY KEY,plan_id TEXT NOT NULL,role TEXT NOT NULL,ordinal INTEGER NOT NULL,paragraph_id TEXT NOT NULL,alt TEXT NOT NULL,prompt TEXT NOT NULL,status TEXT NOT NULL,asset_id TEXT NOT NULL DEFAULT '',model TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_illustration_shots_plan ON article_illustration_shots(plan_id,ordinal);
 `);
 const fields=this.db.prepare('PRAGMA table_info(article_illustration_shots)').all().map(x=>x.name);
 for(const [name,type] of [['scene',"TEXT NOT NULL DEFAULT ''"],['style',"TEXT NOT NULL DEFAULT 'editorial'"],['provider',"TEXT NOT NULL DEFAULT ''"]])if(!fields.includes(name))this.db.exec(`ALTER TABLE article_illustration_shots ADD COLUMN ${name} ${type}`);
 }
 _project(projectId){return this.editorial.get(projectId);}
 _latest(projectId){return this.db.prepare('SELECT * FROM article_illustration_plans WHERE project_id=? ORDER BY rowid DESC LIMIT 1').get(projectId);}
 _shot(projectId,id){const row=this.db.prepare('SELECT s.*,p.project_id,p.master_revision FROM article_illustration_shots s JOIN article_illustration_plans p ON p.id=s.plan_id WHERE s.id=? AND p.project_id=?').get(id,projectId);if(!row)fail('Illustration task not found',404);return row;}
 _present(row){return {id:row.id,role:row.role,ordinal:row.ordinal,paragraphId:row.paragraph_id,alt:row.alt,prompt:row.prompt,status:row.status,assetId:row.asset_id||null,asset:row.asset_id?this.assets.get(row.asset_id):null,model:row.model||null,provider:row.provider||null,scene:row.scene||'',style:row.style||'editorial',error:row.error||null,updatedAt:row.updated_at};}
 get(projectId){const project=this._project(projectId),plan=this._latest(projectId),revision=project.channels.master.document.revision;
  if(!plan)return {projectId,title:project.title,sourceRevision:revision,plan:null,stale:false,shots:[],configured:illustrationsConfigured(),providers:configuredProviders(),plannerConfigured:plannerConfigured(),requiresConsent:true};
  const rows=this.db.prepare('SELECT * FROM article_illustration_shots WHERE plan_id=? ORDER BY ordinal').all(plan.id);
  return {projectId,title:project.title,sourceRevision:revision,plan:{id:plan.id,masterRevision:plan.master_revision,createdAt:plan.created_at},stale:plan.master_revision!==revision,shots:rows.map(x=>this._present(x)),configured:illustrationsConfigured(),providers:configuredProviders(),plannerConfigured:plannerConfigured(),requiresConsent:true};
 }
 _insertPlan(projectId,doc,slots){const id='ip_'+randomUUID(),time=now();
  this.db.exec('BEGIN IMMEDIATE');try{
   this.db.prepare('INSERT INTO article_illustration_plans VALUES(?,?,?,?)').run(id,projectId,doc.revision,time);
   for(const shot of slots)this.db.prepare(`INSERT INTO article_illustration_shots(id,plan_id,role,ordinal,paragraph_id,alt,prompt,status,asset_id,model,error,created_at,updated_at,scene,style,provider) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('il_'+randomUUID(),id,shot.role,shot.ordinal,shot.paragraphId,shot.alt,shot.prompt,'planned','','','',time,time,shot.scene,shot.style,'');
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
  return this.get(projectId);
 }
 plan(projectId,{expectedMasterRevision}={}){const project=this._project(projectId),doc=project.channels.master.document;
  if(!Number.isInteger(expectedMasterRevision)||expectedMasterRevision!==doc.revision)fail('Article changed; reload before creating illustration plan',409);
  return this._insertPlan(projectId,doc,slotPlan(project,doc));
 }
 async agentPlan(projectId,{expectedMasterRevision,allowExternalAI=false}={}){
  if(!allowExternalAI)fail('Explicit consent required before sending excerpts to a planning model',403);
  const project=this._project(projectId),doc=project.channels.master.document;
  if(!Number.isInteger(expectedMasterRevision)||expectedMasterRevision!==doc.revision)fail('Article changed; reload before planning illustrations',409);
  const original=slotPlan(project,doc),scenes=await planScenesWithModel(project,doc,original);
  if(this._project(projectId).channels.master.document.revision!==doc.revision)fail('Article changed while planning illustrations',409);
  return this._insertPlan(projectId,doc,original.map((slot,i)=>({...slot,...scenes[i],prompt:composeImagePrompt({...slot,...scenes[i],title:project.title})})));
 }
 previewPrompt(projectId,shotId,provider='openai'){
  const row=this._shot(projectId,shotId),project=this._project(projectId);
  const source=slotPlan(project,project.channels.master.document).find(x=>x.role===row.role&&x.paragraphId===row.paragraph_id);
  return {provider,role:row.role,style:row.style||'editorial',prompt:composeImagePrompt({title:project.title,role:row.role,scene:row.scene||row.prompt,style:row.style||'editorial',excerpt:source?.excerpt||'',provider}),sourceRevision:row.master_revision,stale:row.master_revision!==project.channels.master.document.revision};
 }
 editPrompt(projectId,shotId,{expectedUpdatedAt,scene,style='editorial',provider='openai'}={}){
  const row=this._shot(projectId,shotId),project=this._project(projectId);
  if(row.master_revision!==project.channels.master.document.revision)fail('Article changed; illustration plan is stale',409);
  if(typeof expectedUpdatedAt!=='string'||row.updated_at!==expectedUpdatedAt)fail('Illustration prompt changed; reload before editing',409);
  if(row.status==='generating')fail('Cannot edit while generating image',409);
  if(typeof scene!=='string'||scene.trim().length<12||scene.length>800)fail('Visual scene must be 12-800 characters');
  const source=slotPlan(project,project.channels.master.document).find(x=>x.role===row.role&&x.paragraphId===row.paragraph_id);
  const prompt=composeImagePrompt({title:project.title,role:row.role,excerpt:source?.excerpt||'',scene,style,provider});
  const updated=new Date(Math.max(Date.now(),Date.parse(row.updated_at)+1)).toISOString();
  this.db.prepare("UPDATE article_illustration_shots SET scene=?,style=?,prompt=?,asset_id='',model='',provider='',status='planned',error='',updated_at=? WHERE id=?").run(scene.trim(),style,prompt,updated,shotId);
  return this._present(this._shot(projectId,shotId));
 }
 async generate(projectId,shotId,{allowExternalAI=false,provider='openai'}={}){
  const row=this._shot(projectId,shotId),project=this._project(projectId);
  if(row.master_revision!==project.channels.master.document.revision)fail('Article changed; illustration plan is stale',409);
  if(!allowExternalAI)fail('Explicit consent required before sending a contextual image prompt to the configured provider',403);
  if(!['planned','failed'].includes(row.status))fail('Only planned or failed images can be generated',409);
  if(this.inflight.has(shotId))fail('Image generation is already in progress',409);
  this.inflight.add(shotId);
  this.db.prepare("UPDATE article_illustration_shots SET status='generating',error='',updated_at=? WHERE id=?").run(now(),shotId);
  try{
   const response=await this.generator(composeImagePrompt({title:project.title,role:row.role,scene:row.scene||row.prompt,style:row.style||'editorial',provider}),{provider,role:row.role});
   if(this._project(projectId).channels.master.document.revision!==row.master_revision)fail('Article changed during image generation; renew the illustration plan',409);
   const head=Buffer.from(response.base64.slice(0,24),'base64');const extension=head[0]===0xff&&head[1]===0xd8?'jpg':head.toString('ascii',0,4)==='RIFF'?'webp':'png';
   const asset=this.assets.upload({name:`article-${row.role}-${row.ordinal}.${extension}`,alt:row.alt,base64:response.base64});
   this.db.prepare("UPDATE article_illustration_shots SET status='generated',asset_id=?,model=?,provider=?,prompt=?,updated_at=? WHERE id=?").run(asset.id,String(response.model||'configured-image-provider').slice(0,100),response.provider||provider,composeImagePrompt({title:project.title,role:row.role,scene:row.scene||row.prompt,style:row.style||'editorial',provider}),now(),shotId);
   return this._present(this._shot(projectId,shotId));
  }catch(e){this.db.prepare("UPDATE article_illustration_shots SET status='failed',error=?,updated_at=? WHERE id=?").run(String(e?.message||'Image generation failed').slice(0,220),now(),shotId);throw e;}
  finally{this.inflight.delete(shotId)}
 }
 decide(projectId,shotId,{decision}={}){
  const row=this._shot(projectId,shotId),project=this._project(projectId);
  if(row.master_revision!==project.channels.master.document.revision)fail('Article changed; plan must be renewed',409);
  if(!['approve','reject'].includes(decision))fail('Decision must be approve or reject');
  if(!['generated','approved','rejected'].includes(row.status))fail('Generate this image before approval',409);
  this.db.prepare('UPDATE article_illustration_shots SET status=?,updated_at=? WHERE id=?').run(decision==='approve'?'approved':'rejected',now(),shotId);
  return this._present(this._shot(projectId,shotId));
 }
 /** Read-only handoff, never mutates the layout or bypasses V30/V31 review. */
 handoff(projectId,channel){if(!CHANNELS.has(channel))fail('Unsupported channel');const data=this.get(projectId);
  if(!data.plan)fail('Create an illustration plan first',409);
  if(data.stale)fail('Article has changed; illustration plan is stale',409);
  const draft=this.editorial.layoutDraft(projectId,channel);
  let markdown=draft.markdown;const unplaced=[],unmapped=[],inserted=[];
  const approved=data.shots.filter(s=>s.status==='approved');
  for(const shot of approved){const mapping=shot.asset?.mappings?.find(x=>x.channel===channel);
   if(!mapping){unmapped.push(shot.id);continue;}
   const img=`![${shot.alt.replace(/[\[\]\n]/g,' ')}](${mapping.url})`;
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

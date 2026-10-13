/** Article-to-illustration agent. A plan is NOT a generated image or evidence of any claim.
 * Images stay private until an author explicitly approves them and maps a destination URL.
 */
import {randomUUID} from 'node:crypto';
import {ValidationError} from './verification.mjs';

const fail=(message,status=400)=>{throw new ValidationError(message,status)};
const now=()=>new Date().toISOString();
const parse=x=>JSON.parse(x);
const normalize=s=>String(s||'').replace(/\s+/gu,' ').trim();
const CHANNELS=new Set(['wechat','zhihu']);
const maxExcerpts=140;
const suggestStyle='Editorial illustration; modern minimalist visual, white or warm neutral background, muted forest green as an accent; no text, logos, trademarks, UI screenshots, watermarks, identifiable real people or fabricated measurements. This is a conceptual illustration, NOT documented evidence or a literal depiction of events.';
function imageConfig(){return {baseUrl:process.env.CONTENT_IMAGE_API_BASE_URL||'',apiKey:process.env.CONTENT_IMAGE_API_KEY||'',model:process.env.CONTENT_IMAGE_MODEL||''};}
export function illustrationsConfigured(){const c=imageConfig();return !!(c.baseUrl&&c.apiKey&&c.model);}
export async function requestImageGeneration(prompt){
 const c=imageConfig();if(!illustrationsConfigured())fail('Configure CONTENT_IMAGE_API_BASE_URL, CONTENT_IMAGE_API_KEY and CONTENT_IMAGE_MODEL to generate illustrations',503);
 let endpoint;try{const base=new URL(c.baseUrl.endsWith('/')?c.baseUrl:c.baseUrl+'/');endpoint=new URL('images/generations',base);}catch{fail('Invalid image API base URL',503)}
 if(!['https:','http:'].includes(endpoint.protocol))fail('Invalid image generation endpoint protocol',503);
 if(endpoint.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))fail('Remote image generation endpoint must use HTTPS',503);
 const response=await fetch(endpoint,{method:'POST',headers:{'authorization':`Bearer ${c.apiKey}`,'content-type':'application/json'},body:JSON.stringify({model:c.model,prompt,size:'1024x1024',n:1,response_format:'b64_json'}),signal:AbortSignal.timeout(75000),redirect:'error'});
 if(!response.ok)fail(`Image provider returned HTTP ${response.status}`,502);
 if(Number(response.headers.get('content-length'))>12_000_000)fail('Image provider response exceeds the configured safety limit',502);
 const json=await response.json();const encoded=json?.data?.[0]?.b64_json;
 if(typeof encoded!=='string'||!encoded)fail('Image provider returned no base64 image; URL-only responses are not downloaded for safety',502);
 return {base64:encoded,model:c.model};
}
function slotPlan(project, doc){
 const candidates=[{role:'cover',paragraphId:'',alt:`${project.title}：概念封面插画`,excerpt:project.title}];
 const paragraphs=(doc.paragraphs||[]).filter(x=>normalize(x.text).length>18);
 const indexes=[Math.max(0,Math.floor(paragraphs.length/3)),Math.max(0,Math.floor(paragraphs.length*2/3))];
 for(const index of [...new Set(indexes)]){const p=paragraphs[index];if(!p)continue;
  const caption=normalize(p.text).slice(0,maxExcerpts);
  candidates.push({role:'section',paragraphId:p.id,alt:`章节概念配图：${caption.slice(0,40)}`,excerpt:caption});
 }
 return candidates.slice(0,3).map((shot,i)=>({...shot,ordinal:i+1,prompt:`Create a high-quality visual to accompany a Chinese-language technical article. Article title: ${normalize(project.title).slice(0,130)}. ${shot.role==='cover'?'Composition: landscape editorial cover with generous negative space.':'Composition: standalone illustrative vignette matching this section, landscape.'} Section context (do not depict as verified fact): ${shot.excerpt}. ${suggestStyle}`}));
}
export class IllustrationService {
 constructor(store,editorial,assets,generator=requestImageGeneration){this.db=store.db;this.editorial=editorial;this.assets=assets;this.generator=generator;this.inflight=new Set();this.db.exec(`
 CREATE TABLE IF NOT EXISTS article_illustration_plans(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,master_revision INTEGER NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_illustration_plans_project ON article_illustration_plans(project_id,created_at);
 CREATE TABLE IF NOT EXISTS article_illustration_shots(id TEXT PRIMARY KEY,plan_id TEXT NOT NULL,role TEXT NOT NULL,ordinal INTEGER NOT NULL,paragraph_id TEXT NOT NULL,alt TEXT NOT NULL,prompt TEXT NOT NULL,status TEXT NOT NULL,asset_id TEXT NOT NULL DEFAULT '',model TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_illustration_shots_plan ON article_illustration_shots(plan_id,ordinal);
 `);}
 _project(projectId){return this.editorial.get(projectId);}
 _latest(projectId){return this.db.prepare('SELECT * FROM article_illustration_plans WHERE project_id=? ORDER BY rowid DESC LIMIT 1').get(projectId);}
 _shot(projectId,id){const row=this.db.prepare('SELECT s.*,p.project_id,p.master_revision FROM article_illustration_shots s JOIN article_illustration_plans p ON p.id=s.plan_id WHERE s.id=? AND p.project_id=?').get(id,projectId);if(!row)fail('Illustration task not found',404);return row;}
 _present(row){return {id:row.id,role:row.role,ordinal:row.ordinal,paragraphId:row.paragraph_id,alt:row.alt,prompt:row.prompt,status:row.status,assetId:row.asset_id||null,asset:row.asset_id?this.assets.get(row.asset_id):null,model:row.model||null,error:row.error||null,updatedAt:row.updated_at};}
 get(projectId){const project=this._project(projectId),plan=this._latest(projectId),revision=project.channels.master.document.revision;
  if(!plan)return {projectId,title:project.title,sourceRevision:revision,plan:null,stale:false,shots:[],configured:illustrationsConfigured(),requiresConsent:true};
  const rows=this.db.prepare('SELECT * FROM article_illustration_shots WHERE plan_id=? ORDER BY ordinal').all(plan.id);
  return {projectId,title:project.title,sourceRevision:revision,plan:{id:plan.id,masterRevision:plan.master_revision,createdAt:plan.created_at},stale:plan.master_revision!==revision,shots:rows.map(x=>this._present(x)),configured:illustrationsConfigured(),requiresConsent:true};
 }
 plan(projectId,{expectedMasterRevision}={}){const project=this._project(projectId),doc=project.channels.master.document;
  if(!Number.isInteger(expectedMasterRevision)||expectedMasterRevision!==doc.revision)fail('Article changed; reload before creating illustration plan',409);
  const slots=slotPlan(project,doc),id='ip_'+randomUUID(),time=now();
  this.db.exec('BEGIN IMMEDIATE');try{
   this.db.prepare('INSERT INTO article_illustration_plans VALUES(?,?,?,?)').run(id,projectId,doc.revision,time);
   for(const shot of slots)this.db.prepare('INSERT INTO article_illustration_shots VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('il_'+randomUUID(),id,shot.role,shot.ordinal,shot.paragraphId,shot.alt,shot.prompt,'planned','','','',time,time);
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
  return this.get(projectId);
 }
 async generate(projectId,shotId,{allowExternalAI=false}={}){
  const row=this._shot(projectId,shotId),project=this._project(projectId);
  if(row.master_revision!==project.channels.master.document.revision)fail('Article changed; illustration plan is stale',409);
  if(!allowExternalAI)fail('Explicit consent required before sending a contextual image prompt to the configured provider',403);
  if(!['planned','failed'].includes(row.status))fail('Only planned or failed images can be generated',409);
  if(this.inflight.has(shotId))fail('Image generation is already in progress',409);
  this.inflight.add(shotId);
  this.db.prepare("UPDATE article_illustration_shots SET status='generating',error='',updated_at=? WHERE id=?").run(now(),shotId);
  try{
   const response=await this.generator(row.prompt);
   if(this._project(projectId).channels.master.document.revision!==row.master_revision)fail('Article changed during image generation; renew the illustration plan',409);
   const asset=this.assets.upload({name:`article-${row.role}-${row.ordinal}.png`,alt:row.alt,base64:response.base64});
   this.db.prepare("UPDATE article_illustration_shots SET status='generated',asset_id=?,model=?,updated_at=? WHERE id=?").run(asset.id,String(response.model||'configured-image-provider').slice(0,100),now(),shotId);
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

/** V43: immutable author quality rubric. No model calls, never authorizes an
 * image or certifies intellectual property, factual correctness, or publishing.
 */
import {randomUUID} from 'node:crypto';
import {ValidationError} from './verification.mjs';
const fail=(message,status=400)=>{throw new ValidationError(message,status)};
export const IMAGE_RUBRIC_KEYS=Object.freeze(['briefFit','clarity','mobileReadability','styleConsistency']);
const RISK_TAGS=new Set(['misleading_data','fabricated_ui','text_errors','rights_unclear','sensitive_content','accessibility','other']);

export class ImageQualityLedger {
 constructor(db,illustrations,assets){
  this.db=db;this.illustrations=illustrations;this.assets=assets;
  db.exec(`
   CREATE TABLE IF NOT EXISTS article_image_quality_reviews(
    id TEXT PRIMARY KEY,project_id TEXT NOT NULL,shot_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,asset_sha256 TEXT NOT NULL,provider TEXT NOT NULL,
    plan_id TEXT NOT NULL,source_revision INTEGER NOT NULL,profile_revision INTEGER NOT NULL,
    shot_updated_at TEXT NOT NULL,ratings_json TEXT NOT NULL,risks_json TEXT NOT NULL,
    rights_reviewed INTEGER NOT NULL,factual_reviewed INTEGER NOT NULL,
    recommendation TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_image_quality_reviews_shot ON article_image_quality_reviews(project_id,shot_id,created_at);
  `);
 }
 _context(projectId,shotId,assetId){
  const data=this.illustrations.get(projectId);
  if(!data.plan||data.stale)fail('Current article needs an up-to-date illustration plan',409);
  const shot=data.shots.find(s=>s.id===shotId);
  if(!shot)fail('Illustration slot not found',404);
  const choices=[...(shot.assetId?[{assetId:shot.assetId,provider:shot.provider,kind:'selected'}]:[]),
   ...shot.candidates.map(c=>({assetId:c.assetId,provider:c.provider,kind:'candidate'}))];
  const selected=choices.find(c=>c.assetId===assetId);
  if(!selected)fail('Image is not a current selected asset or known candidate of this slot',403);
  if(!['generated','approved','rejected'].includes(shot.status))fail('Image must be generated before recording quality',409);
  const asset=this.assets.get(assetId);
  return {data,shot,asset,selected};
 }
 _row(r){
  if(!r)return null;
  return {id:r.id,projectId:r.project_id,shotId:r.shot_id,assetId:r.asset_id,
   assetSha256:r.asset_sha256,provider:r.provider,planId:r.plan_id,
   sourceRevision:r.source_revision,profileRevision:r.profile_revision,
   shotUpdatedAt:r.shot_updated_at,ratings:JSON.parse(r.ratings_json),
   riskFlags:JSON.parse(r.risks_json),rightsReviewed:!!r.rights_reviewed,
   factualReviewed:!!r.factual_reviewed,recommendation:r.recommendation,
   note:r.note,createdAt:r.created_at,authorReported:true,modelReviewed:false,
   approvalChanged:false};
 }
 view(projectId,shotId){
  const data=this.illustrations.get(projectId);
  const shot=data.shots.find(s=>s.id===shotId);
  if(!shot)fail('Illustration slot not found',404);
  const assetIds=[...(shot.assetId?[shot.assetId]:[]),...shot.candidates.map(c=>c.assetId)];
  const entries=this.db.prepare('SELECT * FROM article_image_quality_reviews WHERE project_id=? AND shot_id=? ORDER BY rowid DESC LIMIT 50').all(projectId,shotId).map(r=>this._row(r));
  const items=assetIds.map(assetId=>{
   const asset=this.assets.get(assetId);
   const latest=entries.find(r=>r.assetId===assetId)||null;
   return {assetId,sha256:asset.sha256,previewUrl:asset.previewUrl,
    provider:shot.assetId===assetId?shot.provider:shot.candidates.find(c=>c.assetId===assetId)?.provider,
    selected:shot.assetId===assetId,latest,
    latestCurrent:!!latest&&!!data.plan&&!data.stale&&
      latest.planId===data.plan.id&&latest.sourceRevision===data.sourceRevision&&
      latest.profileRevision===data.visualProfile.revision&&
      latest.shotUpdatedAt===shot.updatedAt&&latest.assetSha256===asset.sha256};
  });
  const counted=entries.filter(r=>items.some(i=>i.assetId===r.assetId));
  const byProvider=Object.values(counted.reduce((groups,r)=>{
   const group=groups[r.provider]||(groups[r.provider]={provider:r.provider,reviewCount:0,ratingTotals:Object.fromEntries(IMAGE_RUBRIC_KEYS.map(k=>[k,0]))});
   group.reviewCount++;
   for(const key of IMAGE_RUBRIC_KEYS)group.ratingTotals[key]+=r.ratings[key];
   return groups;
  },{})).map(g=>({provider:g.provider,reviewCount:g.reviewCount,
    meanRatings:Object.fromEntries(IMAGE_RUBRIC_KEYS.map(k=>[k,Math.round(g.ratingTotals[k]/g.reviewCount*100)/100]))}));
  return {projectId,shotId,items,reviews:entries,byProvider,
   sampleScope:'author-reported-reviews-of-current-slot-history-only',
   comparisonsControlled:false,modelRanking:false,authorApprovalUnaffected:true,
   warning:'Ratings reflect subjective author reports on different assets and prompts; they are not blind A/B tests or independent claims about model quality.'};
 }
 record(projectId,shotId,{assetId,expectedAssetSha256,expectedShotUpdatedAt,expectedSourceRevision,expectedProfileRevision,ratings,riskFlags=[],rightsReviewed,factualReviewed,recommendation,note}={}){
  const {data,shot,asset,selected}=this._context(projectId,shotId,assetId);
  if(expectedAssetSha256!==asset.sha256||expectedShotUpdatedAt!==shot.updatedAt||
     expectedSourceRevision!==data.sourceRevision||expectedProfileRevision!==data.visualProfile.revision)
   fail('Image, article or visual style changed since quality form was loaded',409);
  if(!ratings||typeof ratings!=='object'||Array.isArray(ratings)||IMAGE_RUBRIC_KEYS.some(k=>!Number.isInteger(ratings[k])||ratings[k]<1||ratings[k]>5))
   fail('Rate briefFit, clarity, mobileReadability and styleConsistency from 1 to 5');
  if(!Array.isArray(riskFlags)||riskFlags.length>7||riskFlags.some(x=>!RISK_TAGS.has(x))||new Set(riskFlags).size!==riskFlags.length)fail('Invalid or duplicate risk flags');
  if(typeof rightsReviewed!=='boolean'||typeof factualReviewed!=='boolean')fail('Both manual rights and factual review flags must be provided');
  if(!['recommended','revise','reject'].includes(recommendation))fail('Invalid author recommendation');
  if(recommendation==='recommended'&&(!rightsReviewed||!factualReviewed||riskFlags.length||IMAGE_RUBRIC_KEYS.some(k=>ratings[k]<3)))
   fail('Recommendation needs all manual reviews, no risk flags, and ratings of at least 3',409);
  if(typeof note!=='string'||note.trim().length<12||note.trim().length>600)fail('Write a specific quality observation (12-600 characters)');
  const id='iqr_'+randomUUID(),at=new Date().toISOString();
  this.db.prepare(`INSERT INTO article_image_quality_reviews VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
   id,projectId,shotId,assetId,asset.sha256,selected.provider||'unknown',data.plan.id,data.sourceRevision,
   data.visualProfile.revision,shot.updatedAt,JSON.stringify(Object.fromEntries(IMAGE_RUBRIC_KEYS.map(k=>[k,ratings[k]]))),
   JSON.stringify(riskFlags),rightsReviewed?1:0,factualReviewed?1:0,recommendation,note.trim(),at);
  return this.view(projectId,shotId);
 }
}

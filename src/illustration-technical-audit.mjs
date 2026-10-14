/** V42 read-only technical image audit. Checks bytes and proposal integrity, NOT
 * semantic correctness, model aesthetics, copyright, or live platform rendering.
 * Never calls providers or downloads a channel image URL.
 */
import {ValidationError} from './verification.mjs';
const reject=(message,status=400)=>{throw new ValidationError(message,status)};
const signatures={
 png:Buffer.from('89504e470d0a1a0a','hex'),
 jpeg:Buffer.from('ffd8ff','hex')
};
const isPng=b=>b.length>=24&&b.subarray(0,8).equals(signatures.png);
const isJpeg=b=>b.length>=4&&b.subarray(0,3).equals(signatures.jpeg);
const isWebp=b=>b.length>=20&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';
function dimensions(body,mime){
 const b=Buffer.from(body);
 if(mime==='image/png'&&isPng(b))return {width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
 if(mime==='image/jpeg'&&isJpeg(b)){
  // Bounds-aware SOF marker walk, does not scan compressed entropy as JPEG markers.
  for(let offset=2;offset<b.length-9;){
   if(b[offset]!==255)break;
   while(offset<b.length&&b[offset]===255)offset++;
   const marker=b[offset++];
   if(marker===0xda||marker===0xd9)break;
   if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;
   if(offset+2>b.length)break;
   const size=b.readUInt16BE(offset);if(size<2||offset+size>b.length)break;
   if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&size>=7)
    return {width:b.readUInt16BE(offset+5),height:b.readUInt16BE(offset+3)};
   offset+=size;
  }
 }
 if(mime==='image/webp'&&isWebp(b)){
  const fourcc=b.toString('ascii',12,16);
  if(fourcc==='VP8X'&&b.length>=30)return {width:1+b.readUIntLE(24,3),height:1+b.readUIntLE(27,3)};
  if(fourcc==='VP8L'&&b.length>=25&&b[20]===0x2f){
   return {width:1+(((b[22]&0x3f)<<8)|b[21]),height:1+(((b[24]&0x0f)<<10)|(b[23]<<2)|((b[22]&0xc0)>>6))};
  }
  if(fourcc==='VP8 '&&b.length>=30&&b[23]===0x9d&&b[24]===0x01&&b[25]===0x2a)
   return {width:b.readUInt16LE(26)&0x3fff,height:b.readUInt16LE(28)&0x3fff};
 }
 return null;
}
export function inspectImageBytes({body,mime,role='section',alt='',size}={}){
 const bytes=Buffer.isBuffer(body)?body:Buffer.from(body||[]);
 if(!['cover','section'].includes(role))reject('Invalid illustration role');
 const w=dimensions(bytes,mime),issues=[];
 if(bytes.length<24||bytes.length>6*1024*1024)issues.push('invalid_size');
 if(!w||!w.width||!w.height||w.width>8192||w.height>8192)issues.push('dimensions_unreadable');
 const expectedRatio=role==='cover'?16/9:3/2;
 const ratio=w&&w.height>0?Number((w.width/w.height).toFixed(3)):null;
 if(ratio!==null){
  if(Math.abs(ratio-expectedRatio)/expectedRatio>0.12)issues.push('aspect_ratio_mismatch');
  if(w.width<(role==='cover'?1200:960)||w.height<(role==='cover'?675:640))issues.push('resolution_low');
 }
 if(typeof alt!=='string'||!alt.trim())issues.push('alt_missing');
 if(size!==undefined&&size!==bytes.length)issues.push('stored_size_mismatch');
 return {mime,width:w?.width??null,height:w?.height??null,aspectRatio:ratio,
  expectedRatio:Number(expectedRatio.toFixed(3)),bytes:bytes.length,
  issues,technicalStatus:issues.length?'review_needed':'technical_checks_passed',
  semanticVerified:false,platformVerified:false,advisoryOnly:true};
}
export class IllustrationTechnicalAudit {
 constructor(illustrations,assets,deliveryQa){this.illustrations=illustrations;this.assets=assets;this.deliveryQa=deliveryQa}
 inspect(projectId,{channel='wechat'}={}){
  if(!['wechat','zhihu'].includes(channel))reject('Unsupported target channel');
  const project=this.illustrations.get(projectId);
  const qa=this.deliveryQa.preflight(projectId,channel);
  const entries=[];
  for(const shot of project.shots){
   const candidates=[];
   if(shot.assetId)candidates.push({assetId:shot.assetId,provider:shot.provider||'',model:shot.model||'',kind:'selected',status:shot.status});
   for(const candidate of shot.candidates||[]){
    if(candidate.assetId&&!candidates.some(e=>e.assetId===candidate.assetId))
     candidates.push({assetId:candidate.assetId,provider:candidate.provider||'',model:candidate.model||'',kind:'candidate',status:candidate.status});
   }
   const variants=candidates.map(item=>{
    const asset=this.assets.get(item.assetId);
    const body=this.assets.preview(item.assetId).body;
    return {...item,sha256:asset.sha256,previewUrl:asset.previewUrl,
     checks:inspectImageBytes({body,mime:asset.mime,role:shot.role,alt:asset.alt||shot.alt,size:asset.size})};
   });
   const issues=[];
   if(shot.status!=='approved')issues.push('not_approved');
   if(shot.status==='approved'&&!shot.asset?.mappings?.some(x=>x.channel===channel))issues.push('channel_mapping_missing');
   if(!shot.alt?.trim())issues.push('alt_missing');
   entries.push({shotId:shot.id,role:shot.role,ordinal:shot.ordinal,status:shot.status,
    paragraphId:shot.paragraphId,issues,variants});
  }
  // This snapshot is independent from source image bytes: no private images leak
  // through the audit endpoint. URLs are strictly same-origin local preview paths.
  return {projectId,channel,sourceRevision:project.sourceRevision,planId:project.plan?.id||null,
   stale:project.stale,deliveryProposalSha256:qa.proposalSha256||null,
   layoutRevision:qa.layoutRevision,
   deliveryReadyForManualQA:qa.readyForManualQA,
   handoffIssues:qa.issues,
   shots:entries,
   compareScope:'file-metadata-only-not-controlled-model-quality',
   extraModelRequests:0,paidComparisonsPerformed:false,semanticVerified:false,
   platformVerified:false,warning:'Dimensions, aspect ratio, size and alt-text metadata only. Human art direction, factual accuracy, licensing, channel image availability and real platform rendering are not verified.'};
 }
}

/** V43 read-only, conservative image reconciliation for doocs/md round-trips.
 * Does not make network requests, modify Markdown, or infer actual publishing.
 */
import {createHash} from 'node:crypto';
import {ValidationError} from './verification.mjs';
const fail=(message,status=400)=>{throw new ValidationError(message,status)};
const sha=s=>createHash('sha256').update(s).digest('hex');
const normalizedUrl=s=>String(s).replace(/\\([()])/g,'$1').replace(/%28/gi,'(').replace(/%29/gi,')');
/** Extract Markdown inline images, skip fenced code and inline code. No HTML parser. */
export function markdownImageTokens(markdown){
 if(typeof markdown!=='string'||markdown.length>250000)fail('Markdown must be a string <= 250000 characters');
 const tokens=[];let fence='',offset=0;
 for(const line of markdown.split('\n')){
  const marker=line.match(/^\s{0,3}(`{3,}|~{3,})/);
  if(marker){if(!fence)fence=marker[1][0];else if(marker[1][0]===fence)fence='';offset+=line.length+1;continue}
  if(fence){offset+=line.length+1;continue}
  let inline=false,backticks=0;
  for(let i=0;i<line.length;i++){
   if(line[i]==='`'){let count=1;while(line[i+count]==='`')count++;if(!inline){inline=true;backticks=count}else if(count===backticks)inline=false;i+=count-1;continue}
   if(inline||line[i]!=='!'||line[i+1]!=='['||(i&&line[i-1]==='\\'))continue;
   let cursor=i+2,alt='';
   for(;cursor<line.length;cursor++){
    if(line[cursor]==='\\'&&cursor+1<line.length){alt+=line[++cursor];continue}
    if(line[cursor]===']')break;
    alt+=line[cursor];
   }
   if(line[cursor]!==']'||line[cursor+1]!=='(')continue;
   cursor+=2;const angle=line[cursor]==='<';if(angle)cursor++;
   let url='',depth=0;
   for(;cursor<line.length;cursor++){
    const c=line[cursor];
    if(c==='\\'&&cursor+1<line.length){url+=line[++cursor];continue}
    if(angle&&c==='>'){cursor++;break}
    if(!angle&&c==='('){depth++;url+=c;continue}
    if(!angle&&c===')'){if(depth===0)break;depth--;url+=c;continue}
    if(!angle&&/\s/.test(c)&&depth===0)break;
    url+=c;
   }
   if(!url)continue;
   // Permit a Markdown title after whitespace but reject unknown trailing text.
   let close=cursor;
   if(line[close]!==')'){
    const tail=line.slice(close).match(/^\s+(?:"[^"]*"|'[^']*')\s*\)/);
    if(tail)close+=tail[0].length-1;
   }
   if(line[close]!==')')continue;
   tokens.push({alt,url:normalizedUrl(url),position:offset+i,kind:'markdown'});
   i=close;
  }
  offset+=line.length+1;
 }
 return tokens;
}
export class ImageRoundtripReconciliation {
 constructor(illustrations,editorial){this.illustrations=illustrations;this.editorial=editorial}
 review(projectId,channel,{markdown,expectedLayoutRevision,expectedSourceRevision}={}){
  if(!['wechat','zhihu'].includes(channel))fail('Unsupported channel');
  const article=this.illustrations.get(projectId),draft=this.editorial.layoutDraft(projectId,channel);
  if(markdown!==undefined){
   if(typeof markdown!=='string'||markdown.length>250000)fail('Markdown must be a string <= 250000 characters');
   if(expectedLayoutRevision!==draft.layoutRevision||expectedSourceRevision!==article.sourceRevision)
    fail('Article or layout changed before image roundtrip preview',409);
  }
  const text=markdown===undefined?draft.markdown:markdown;
  const tokens=markdownImageTokens(text);
  const expected=[],issues=[],warnings=[];
  if(!article.plan)issues.push('plan_required');
  if(article.stale)issues.push('plan_stale');
  if(draft.isSourceOutdated)issues.push('channel_document_changed');
  if(markdown===undefined&&draft.layoutRevision===0)issues.push('no_imported_layout');
  for(const shot of article.shots){
   if(shot.status!=='approved'){issues.push('image_not_approved:'+shot.id);continue}
   const mapping=shot.asset?.mappings?.find(m=>m.channel===channel);
   if(!mapping){issues.push('image_mapping_missing:'+shot.id);continue}
   expected.push({shotId:shot.id,role:shot.role,ordinal:shot.ordinal,paragraphId:shot.paragraphId,
    url:normalizedUrl(mapping.url)});
  }
  if(!expected.length)issues.push('no_expected_approved_images');
  const used=new Set(),matched=[];
  for(const item of expected){
   const at=tokens.findIndex((t,i)=>!used.has(i)&&t.url===item.url);
   if(at<0){issues.push('image_missing:'+item.shotId);continue}
   used.add(at);matched.push({shotId:item.shotId,role:item.role,ordinal:item.ordinal,
    position:tokens[at].position,tokenIndex:at,altPresent:!!tokens[at].alt.trim()});
   if(!tokens[at].alt.trim())warnings.push('image_alt_missing:'+item.shotId);
  }
  for(let i=0;i<tokens.length;i++)if(!used.has(i)){
   const code=expected.some(e=>e.url===tokens[i].url)?'image_duplicate':'unmapped_or_extra_image';
   issues.push(code+':'+sha(tokens[i].url).slice(0,12));
  }
  if(matched.some((m,i)=>i&&m.position<matched[i-1].position))issues.push('image_order_changed');
  const master=this.illustrations._project(projectId).channels.master.document.paragraphs;
  for(const item of expected){
   const chosen=matched.find(m=>m.shotId===item.shotId);
   if(!chosen)continue;
   if(item.role==='cover'){
    const heading=text.search(/^#\s+[^\n]+/m);
    if(heading<0||chosen.position<heading)warnings.push('cover_position_unverifiable:'+item.shotId);
   }else{
    const source=master.find(p=>p.id===item.paragraphId);
    const anchor=source?.text?text.indexOf(source.text):-1;
    if(anchor<0)warnings.push('paragraph_anchor_unverifiable:'+item.shotId);
    else if(chosen.position<anchor+source.text.length)issues.push('image_before_paragraph:'+item.shotId);
   }
  }
  // HTML <img> and reference-style image links are not silently accepted as mapped images.
  if(/<img\b/i.test(text))issues.push('html_img_needs_manual_review');
  if(/!\[[^\]\n]*\]\[[^\]\n]+\]/.test(text))warnings.push('reference_style_image_needs_manual_review');
  const uniqueIssues=[...new Set(issues)],uniqueWarnings=[...new Set(warnings)];
  return {projectId,channel,sourceRevision:article.sourceRevision,layoutRevision:draft.layoutRevision,
   documentHash:sha(text),origin:markdown===undefined?'saved-layout':'supplied-preview',
   importedLayoutExists:draft.layoutRevision>0,expectedCount:expected.length,actualCount:tokens.length,
   matchedCount:matched.length,matched:matched.map(({shotId,role,ordinal,altPresent})=>({shotId,role,ordinal,altPresent})),
   issues:uniqueIssues,warnings:uniqueWarnings,ready:uniqueIssues.length===0&&uniqueWarnings.length===0&&expected.length>0,
   markdownModified:false,externalRequests:0,platformVerified:false,
   warning:'Only locally anchored image URLs, approximate order and paragraph text placement are checked. Copy/paste rendering, semantic correctness, rights and remote image reachability require manual review.'};
 }
}

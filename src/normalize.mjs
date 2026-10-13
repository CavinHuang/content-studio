import {createHash} from 'node:crypto';
export const hash=(s)=>createHash('sha256').update(String(s)).digest('hex').slice(0,24);
export function canonical(input){
 try{const u=new URL(input); if(!['https:','http:'].includes(u.protocol))return null;
 u.protocol='https:';u.hostname=u.hostname.toLowerCase().replace(/^www\./,'');u.hash='';
 for(const k of Array.from(u.searchParams.keys()))if(/^(utm_.*|fbclid|gclid|mc_cid|mc_eid|ref|source)$/i.test(k))u.searchParams.delete(k);
 u.searchParams.sort();u.pathname=u.pathname.replace(/\/+$/,'')||'/';return u.toString();}catch{return null;}
}
export const safeText=(s,max=500)=>String(s??'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
export function validDate(s){const t=new Date(s);return Number.isFinite(t.getTime())?t.toISOString():null;}
export function item(o){const url=canonical(o.url);if(!url||!safeText(o.title))return null;
const id=hash(`${o.sourceId}:${o.nativeId||url}`);return {id,sourceId:o.sourceId,nativeId:String(o.nativeId||url),url,originalUrl:o.url,title:safeText(o.title,220),summary:safeText(o.summary,700),publishedAt:validDate(o.publishedAt),seenAt:new Date().toISOString(),role:o.role||'syndication',category:safeText(o.category||'other',50),score:Number.isFinite(Number(o.score))?Number(o.score):0,storyKey:hash(url),provider:o.provider||'',claimedFirstParty:o.role==='primary_statement'};
}
export function xmlDecode(s){return String(s??'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&(amp|lt|gt|quot|apos|nbsp);/gi,(_,k)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[k.toLowerCase()]));}
const tag=(xml,name)=>{const m=xml.match(new RegExp(`<(?:(?:\\w+):)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:\\w+):)?${name}\\s*>`,'i'));return m?xmlDecode(m[1]).trim():'';};
export function parseFeed(xml,baseUrl,max=20){
 if(!/<(?:rss|feed|rdf:RDF)\b/i.test(xml))throw new Error('Not an RSS/Atom feed');
 const atom=/<feed\b/i.test(xml), blocks=[...xml.matchAll(atom?/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi:/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,max);
 return blocks.map(([,raw])=>{let link=tag(raw,'link');if(atom){const m=raw.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i);link=m?.[1]||link;}try{link=new URL(xmlDecode(link),baseUrl).href;}catch{return null;}return{nativeId:tag(raw,'guid')||tag(raw,'id')||link,url:link,title:tag(raw,'title'),summary:tag(raw,'description')||tag(raw,'summary')||tag(raw,'content'),publishedAt:tag(raw,'pubDate')||tag(raw,'published')||tag(raw,'updated')};}).filter(Boolean);
}
export function classifyEvent(items){const original=items.filter(x=>x.role==='primary_statement');const discussion=items.filter(x=>x.role==='discussion_signal');return {primaryStatements:original.length,discussions:discussion.length,reports:items.filter(x=>x.role==='syndication').length,independentConfirmed:0,warning:original.length?'包含一手来源陈述，但效果仍需独立验证':'未发现一手来源；不能将社区热度当作事实证据'};}

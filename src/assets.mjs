/** Local-only image asset library. No public hosting and no automatic upload to WeChat/Zhihu. */
import { createHash,randomUUID } from 'node:crypto';
import { markdownImageTokens } from './image-roundtrip-reconciliation.mjs';
import { ValidationError } from './verification.mjs';

const MAX_BYTES = 6 * 1024 * 1024;
const MAX_BASE64 = 8_400_000;
const CHANNELS = new Set(['wechat', 'zhihu']);
const at = () => new Date().toISOString();
function reject(message,status=400) { throw new ValidationError(message,status); }
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
function kind(buf) {
 if (buf.length >= 24 && buf.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))) return {mime:'image/png',ext:'png'};
 if (buf.length >= 20 && buf.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))) return {mime:'image/jpeg',ext:'jpg'};
 if (buf.length >= 20 && (buf.subarray(0,6).toString()==='GIF89a'||buf.subarray(0,6).toString()==='GIF87a')) return {mime:'image/gif',ext:'gif'};
 if (buf.length >= 20 && buf.toString('ascii',0,4)==='RIFF' && buf.toString('ascii',8,12)==='WEBP') return {mime:'image/webp',ext:'webp'};
 return null;
}
export function publicImageURL(value) {
 let u;
 try {u=new URL(String(value||''));} catch {reject('Image URL must be an absolute HTTPS URL');}
 if (u.protocol!=='https:'||u.username||u.password||u.port && u.port!=='443')reject('Only HTTPS image URLs without credentials are allowed');
 const h=u.hostname.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
 if (!h || h==='localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h==='0.0.0.0' || h==='::1' || h==='::' || h.startsWith('fc') && h.includes(':') || h.startsWith('fd')&&h.includes(':') || h.startsWith('fe80:'))reject('Local or private image hosts are not allowed');
 // Reject IPv4 numeric tricks, private/reserved ranges and non-public domain aliases.
 const m=h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
 if (m){const n=m.slice(1).map(Number);if(n.some(x=>x>255)||n[0]===0||n[0]===10||n[0]===127||n[0]>=224||n[0]===169&&n[1]===254||n[0]===172&&n[1]>=16&&n[1]<=31||n[0]===192&&n[1]===168||n[0]===100&&n[1]>=64&&n[1]<=127||n[0]===198&&n[1]>=18&&n[1]<=19)reject('Local or reserved network is not a permitted image host');}
 else if(h.includes(':')||!h.includes('.')||h==='example.invalid')reject('Enter a public domain name');
 if(/\s/.test(u.href))reject('Invalid image URL');
 return u.href;
}
export class AssetService {
 constructor(store){this.db=store.db;this.db.exec(`
 CREATE TABLE IF NOT EXISTS content_assets(id TEXT PRIMARY KEY,sha256 TEXT NOT NULL UNIQUE,mime TEXT NOT NULL,filename TEXT NOT NULL,alt TEXT NOT NULL,byte_count INTEGER NOT NULL,body BLOB NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS content_asset_mappings(asset_id TEXT NOT NULL REFERENCES content_assets(id),channel TEXT NOT NULL,url TEXT NOT NULL,note TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(asset_id,channel));
 CREATE TABLE IF NOT EXISTS content_asset_mapping_history(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL REFERENCES content_assets(id),channel TEXT NOT NULL,old_url TEXT NOT NULL,new_url TEXT NOT NULL,changed_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_asset_mapping_history_lookup ON content_asset_mapping_history(channel,old_url);
 `);}
 upload({name,alt,base64}={}) {
  if(typeof base64!=='string'||base64.length>MAX_BASE64||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)||base64.length%4!==0)reject('Invalid image base64 payload',400);
  const buf=Buffer.from(base64,'base64');if(buf.length===0||buf.length>MAX_BYTES)reject('Image exceeds 6 MiB limit',413);
  const detected=kind(buf);if(!detected)reject('Unsupported image bytes; use PNG, JPEG, GIF or WebP',422);
  const digest=sha(buf),id='as_'+digest.slice(0,32);
  if(detected.mime==='image/png'){const w=buf.readUInt32BE(16),h=buf.readUInt32BE(20);if(!w||!h||w>8192||h>8192)reject('Invalid PNG dimensions',422);}
  const existing=!!this.db.prepare('SELECT id FROM content_assets WHERE sha256=?').get(digest);
  const filename=String(name||'image').replace(/[\\/\x00-\x1f<>:"|?*]/g,'-').trim().slice(0,96)||'image';
  const safeAlt=String(alt||'').trim().slice(0,180);
  this.db.prepare('INSERT OR IGNORE INTO content_assets VALUES(?,?,?,?,?,?,?,?)').run(id,digest,detected.mime,filename,safeAlt,buf.length,buf,at());
  return {...this.get(id),deduplicated:existing};
 }
 get(id) {
  const row=this.db.prepare('SELECT id,sha256,mime,filename,alt,byte_count,created_at FROM content_assets WHERE id=?').get(id);
  if(!row)reject('Asset not found',404);
  const mappings=this.db.prepare('SELECT channel,url,note,updated_at FROM content_asset_mappings WHERE asset_id=? ORDER BY channel').all(id);
  return {id:row.id,sha256:row.sha256,mime:row.mime,filename:row.filename,alt:row.alt,size:row.byte_count,createdAt:row.created_at,mappings,previewUrl:`/api/assets/${row.id}/preview`,platformVerified:false};
 }
 list(){return this.db.prepare('SELECT id FROM content_assets ORDER BY created_at DESC, rowid DESC LIMIT 100').all().map(r=>this.get(r.id));}
 preview(id){this.get(id);return this.db.prepare('SELECT mime,body FROM content_assets WHERE id=?').get(id);}
 setMapping(id,channel,{url,note}={}){
  this.get(id);if(!CHANNELS.has(channel))reject('Unsupported channel');
  const href=publicImageURL(url),reason=String(note||'').trim();if(reason.length<8||reason.length>400)reject('Include a brief manual upload/mapping record (8-400 characters)');
  const previous=this.db.prepare('SELECT url FROM content_asset_mappings WHERE asset_id=? AND channel=?').get(id,channel);
  // History and current pointer must commit as one operation. Merely editing
  // the mapping note does not create a false image URL change.
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const timestamp=at();
   if(previous&&previous.url!==href){
    this.db.prepare('INSERT INTO content_asset_mapping_history VALUES(?,?,?,?,?,?)').run(
     'amh_'+randomUUID(),id,channel,previous.url,href,timestamp);
   }
   this.db.prepare('INSERT INTO content_asset_mappings VALUES(?,?,?,?,?) ON CONFLICT(asset_id,channel) DO UPDATE SET url=excluded.url,note=excluded.note,updated_at=excluded.updated_at').run(id,channel,href,reason,timestamp);
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error}
  return this.get(id);
 }
 /**
  * Read-only audit of a saved channel Markdown document. No browser/image
  * fetch, no assumption that a mapped URL is live or authorized on a platform.
  */
 auditChannelImages(channel,markdown){
  if(!CHANNELS.has(channel))reject('Unsupported channel');
  const tokens=markdownImageTokens(markdown);
  const current=this.db.prepare('SELECT asset_id FROM content_asset_mappings WHERE channel=? AND url=? LIMIT 1');
  const historic=this.db.prepare(`SELECT h.asset_id,m.url AS current_url
   FROM content_asset_mapping_history h JOIN content_asset_mappings m
    ON m.asset_id=h.asset_id AND m.channel=h.channel
   WHERE h.channel=? AND h.old_url=? ORDER BY h.rowid DESC LIMIT 1`);
  const references=tokens.map(({url,alt})=>{
   const matching=current.get(channel,url);
   if(matching)return {status:'current_mapping',assetId:matching.asset_id,url,altPresent:!!alt.trim()};
   const outdated=historic.get(channel,url);
   if(outdated&&outdated.current_url!==url)return {status:'stale_mapping',assetId:outdated.asset_id,
    url,currentUrl:outdated.current_url,altPresent:!!alt.trim()};
   if(url.startsWith('asset://'))return {status:'unresolved_asset_token',url,altPresent:!!alt.trim()};
   return {status:'external_unverified',url,altPresent:!!alt.trim()};
  });
  const summary={total:references.length,current:references.filter(r=>r.status==='current_mapping').length,
   stale:references.filter(r=>r.status==='stale_mapping').length,
   unresolved:references.filter(r=>r.status==='unresolved_asset_token').length,
   external:references.filter(r=>r.status==='external_unverified').length};
  return {channel,summary,references,status:summary.stale||summary.unresolved?'needs_remapping':
   summary.external?'needs_manual_review':'local_mapping_consistent',
   networkCalls:0,platformVerified:false,cdnReachabilityVerified:false,
   warning:'Local mapping history only. No remote image, CDN, rights, doocs paste or platform acceptance verification was performed.'};
 }
 /** Explicitly replaces only exact image asset tokens for a single target channel. */
 prepare(channel,markdown){
  if(!CHANNELS.has(channel))reject('Unsupported channel');
  if(typeof markdown!=='string'||markdown.length>150_000)reject('Markdown is too large');
  const found=[],missing=[];
  const output=markdown.replace(/!\[([^\]\n]*)\]\(asset:\/\/(as_[0-9a-f]{32})\)/g,(token,alt,id)=>{
   const row=this.db.prepare('SELECT url FROM content_asset_mappings WHERE asset_id=? AND channel=?').get(id,channel);
   if(!row){missing.push(id);return token;}
   found.push({id,url:row.url,alt});return `![${alt}](${row.url})`;
  });
  return {markdown:output,resolved:found,missing:[...new Set(missing)],ready:missing.length===0,platformVerified:false,warning:'Image URLs were supplied manually; accessibility, ownership and target platform rendering are not verified.'};
 }
}

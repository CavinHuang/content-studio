import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';import {dirname} from 'node:path';
import {hash,classifyEvent} from './normalize.mjs';
export class Store{
 constructor(file=':memory:'){
  if(file!==':memory:')mkdirSync(dirname(file),{recursive:true});this.db=new DatabaseSync(file);this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA busy_timeout=4000;
 CREATE TABLE IF NOT EXISTS source_state(id TEXT PRIMARY KEY, last_attempt TEXT,last_success TEXT,status TEXT DEFAULT 'never',etag TEXT,next_retry TEXT,last_error TEXT,last_http INT,seen_total INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,native_id TEXT,url TEXT,original_url TEXT,title TEXT,summary TEXT,published_at TEXT,seen_at TEXT,role TEXT,category TEXT,score REAL,story_key TEXT,provider TEXT, UNIQUE(source_id,native_id));
 CREATE INDEX IF NOT EXISTS idx_items_story ON items(story_key);CREATE INDEX IF NOT EXISTS idx_items_seen ON items(seen_at);
 CREATE TABLE IF NOT EXISTS briefs(id TEXT PRIMARY KEY,event_id TEXT,created_at TEXT,snapshot TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sync_runs(id TEXT PRIMARY KEY,source_id TEXT,at TEXT,status TEXT,http_status INT,inserted INT,error TEXT);
 CREATE TABLE IF NOT EXISTS selected_mirror(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS selected_sync_state(id INTEGER PRIMARY KEY CHECK(id=1),cursor TEXT,last_attempt TEXT,last_success TEXT,status TEXT DEFAULT 'never',last_error TEXT,next_retry TEXT,failure_count INTEGER DEFAULT 0);
 INSERT OR IGNORE INTO selected_sync_state(id,status) VALUES(1,'never');
 `);
 }
 selectedState(){return this.db.prepare('SELECT * FROM selected_sync_state WHERE id=1').get();}
 selectedCount(){return this.db.prepare('SELECT COUNT(*) n FROM selected_mirror').get().n;}
 updateSelectedState(obj){const cols=Object.keys(obj);if(!cols.length)return;this.db.prepare(`UPDATE selected_sync_state SET ${cols.map(k=>`${k}=?`).join(',')} WHERE id=1`).run(...cols.map(k=>obj[k]));}
 replaceSelected(entries,cursor,normalize){
  // No writes until all snapshot pages have been obtained and validated.
  this.db.exec('BEGIN IMMEDIATE');try{
   this.db.exec("DELETE FROM selected_mirror; DELETE FROM items WHERE source_id='aihot'");
   const mirror=this.db.prepare('INSERT INTO selected_mirror(id,payload) VALUES(?,?)');
   for(const value of entries){if(value?.id===undefined)throw Error('Snapshot item missing ID');const normalized=normalize(value);if(!normalized)throw Error('Snapshot item invalid');mirror.run(String(value.id),JSON.stringify(value));this._putSelectedItem(normalized);}
   this.updateSelectedState({cursor,status:'success',failure_count:0});this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 _putSelectedItem(x){this.db.prepare(`INSERT INTO items (id,source_id,native_id,url,original_url,title,summary,published_at,seen_at,role,category,score,story_key,provider) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,original_url=excluded.original_url,title=excluded.title,summary=excluded.summary,published_at=excluded.published_at,role=excluded.role,category=excluded.category,score=excluded.score,story_key=excluded.story_key,provider=excluded.provider`).run(x.id,x.sourceId,x.nativeId,x.url,x.originalUrl,x.title,x.summary,x.publishedAt,x.seenAt,x.role,x.category,x.score,x.storyKey,x.provider);}
 applySelectedChanges(changes,cursor){
  this.db.exec('BEGIN IMMEDIATE');try{
   const upsert=this.db.prepare('INSERT INTO selected_mirror(id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
   const del=this.db.prepare('DELETE FROM selected_mirror WHERE id=?');const delItem=this.db.prepare("DELETE FROM items WHERE source_id='aihot' AND native_id=?");
   for(const c of changes){if(c.op==='remove'){del.run(c.id);delItem.run(c.id);}else{upsert.run(c.id,JSON.stringify(c.value));this._putSelectedItem(c.normalizedItem);}}
   this.updateSelectedState({cursor,status:'success',failure_count:0});this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 register(sources){for(const s of sources)this.db.prepare('INSERT INTO source_state(id,status) VALUES (?,?) ON CONFLICT(id) DO NOTHING').run(s.id,'never');}
 sourceState(id){return this.db.prepare('SELECT * FROM source_state WHERE id=?').get(id)||{};}
 updateSource(id,obj){const cols=Object.keys(obj);if(!cols.length)return;this.db.prepare(`UPDATE source_state SET ${cols.map(c=>`${c}=?`).join(',')} WHERE id=?`).run(...cols.map(k=>obj[k]),id);}
 log(sourceId,status,httpStatus,inserted,error){const at=new Date().toISOString();this.db.prepare('INSERT INTO sync_runs VALUES(?,?,?,?,?,?,?)').run(hash(sourceId+at+Math.random()),sourceId,at,status,httpStatus||null,inserted||0,error||null);}
 upsert(items){const stmt=this.db.prepare(`INSERT INTO items (id,source_id,native_id,url,original_url,title,summary,published_at,seen_at,role,category,score,story_key,provider) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url, original_url=excluded.original_url,title=excluded.title,summary=excluded.summary,published_at=excluded.published_at,role=excluded.role,category=excluded.category,score=excluded.score,story_key=excluded.story_key,provider=excluded.provider`);
  let inserted=0;this.db.exec('BEGIN');try{for(const x of items){const exists=this.db.prepare('SELECT id FROM items WHERE id=?').get(x.id);stmt.run(x.id,x.sourceId,x.nativeId,x.url,x.originalUrl,x.title,x.summary,x.publishedAt,x.seenAt,x.role,x.category,x.score,x.storyKey,x.provider);if(!exists)inserted++;}this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}return inserted;
 }
 allItems(){return this.db.prepare('SELECT * FROM items ORDER BY COALESCE(published_at,seen_at) DESC').all().map(r=>({id:r.id,sourceId:r.source_id,originalUrl:r.original_url,url:r.url,title:r.title,summary:r.summary,publishedAt:r.published_at,seenAt:r.seen_at,role:r.role,category:r.category,score:r.score,storyKey:r.story_key,provider:r.provider}));}
 events({q='',limit=100}={}){
  const groups=new Map();for(const row of this.allItems()){if(!groups.has(row.storyKey))groups.set(row.storyKey,[]);groups.get(row.storyKey).push(row);}
  return [...groups.entries()].map(([id,items])=>{const lead=[...items].sort((a,b)=>((a.role==='primary_statement')?-2:(a.role==='discussion_signal'?1:0))-((b.role==='primary_statement')?-2:(b.role==='discussion_signal'?1:0)))[0];return{id,title:lead.title,url:lead.url,publishedAt:lead.publishedAt||lead.seenAt,sources:[...new Set(items.map(x=>x.sourceId))],items,assessment:classifyEvent(items),count:items.length,score:Math.max(...items.map(x=>x.score||0))};}).filter(x=>!q||[x.title,...x.items.map(i=>i.summary)].join(' ').toLowerCase().includes(q.toLowerCase())).sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,limit);
 }
 event(id){return this.events({limit:10000}).find(x=>x.id===id)||null;}
 createBrief(event,verificationSnapshot=null){const id='br_'+hash(event.id+Date.now()+Math.random());const snapshot={eventId:event.id,title:event.title,sourceItems:event.items.map(x=>({id:x.id,sourceId:x.sourceId,url:x.originalUrl,role:x.role,seenAt:x.seenAt})),warning:event.assessment.warning,independentVerified:false,audience:'关注 AI、Agent 与独立开发的读者',stance:'待作者根据亲身实验与证据填写',evidence:'当前仅收集新闻、官方声明和讨论线索。需逐项核实后再发表。',verification:verificationSnapshot,createdAt:new Date().toISOString()};this.db.prepare('INSERT INTO briefs VALUES(?,?,?,?)').run(id,event.id,snapshot.createdAt,JSON.stringify(snapshot));return{id,...snapshot};}
 listBriefs(){return this.db.prepare('SELECT * FROM briefs ORDER BY created_at DESC').all().map(r=>({id:r.id,...JSON.parse(r.snapshot)}));}
 brief(id){const r=this.db.prepare('SELECT * FROM briefs WHERE id=?').get(id);return r?{id:r.id,...JSON.parse(r.snapshot)}:null;}
 stats(){return{items:this.db.prepare('SELECT COUNT(*) as n FROM items').get().n,events:this.db.prepare('SELECT COUNT(DISTINCT story_key) as n FROM items').get().n,briefs:this.db.prepare('SELECT COUNT(*) as n FROM briefs').get().n};}
 close(){this.db.close()}
}

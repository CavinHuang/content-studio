import {item} from './normalize.mjs';
import {createClient,waitTime} from './net.mjs';
const BASE='https://aihot.news/api/v1/selected';
export const selectedItem=(v)=>item({sourceId:'aihot',nativeId:v.id,url:v.links?.original||v.links?.aihot,title:v.title,summary:v.summary||'',publishedAt:v.publishedAt||v.discoveredAt,category:v.category,score:v.score,role:'syndication',provider:'aihot-selected'});
const validCursor=(v)=>typeof v==='string'&&v.length>0&&v.length<8192;
const readJSON=(v)=>{if(v.notModified)throw Error('Unexpected 304 without page cache');let o;try{o=JSON.parse(v.body)}catch{throw Error('Invalid AIHOT JSON')};if(!o||typeof o!=='object')throw Error('Invalid AIHOT payload');return o;};
export class SelectedMirror{
 constructor(store,{client=createClient(),clock=()=>Date.now(),minGapMs=3*60_000,pageLimit=500,maxPages=50}={}){this.store=store;this.client=client;this.clock=clock;this.minGapMs=minGapMs;this.pageLimit=pageLimit;this.maxPages=maxPages;this.busy=false;}
 status(){const s=this.store.selectedState();return {...s,items:this.store.selectedCount(),busy:this.busy};}
 async sync({force=false}={}){
  if(this.busy)return {status:'busy'};
  const previous=this.store.selectedState(), now=this.clock();
  if(previous.next_retry&&Date.parse(previous.next_retry)>now)return {status:'backoff',nextRetry:previous.next_retry};
  if(previous.last_attempt&&now-Date.parse(previous.last_attempt)<this.minGapMs)return {status:'throttled',nextEligible:new Date(Date.parse(previous.last_attempt)+this.minGapMs).toISOString()};
  if(!force&&previous.last_success&&now-Date.parse(previous.last_success)<this.minGapMs)return {status:'fresh-cache'};
  this.busy=true;this.store.updateSelectedState({last_attempt:new Date(now).toISOString(),status:'syncing',last_error:null});
  try{
   const out=previous.cursor?await this.changes(previous.cursor):await this.snapshot();
   this.store.updateSelectedState({status:'success',last_success:new Date(this.clock()).toISOString(),next_retry:null,last_error:null});
   return {...out,status:'success',items:this.store.selectedCount()};
  }catch(e){
   // Only a 409 snapshot_required may invalidate an old cursor. Other errors retain state unchanged.
   if(e.status===409 && (e.code==='snapshot_required'||e.message==='snapshot_required')){
    try{const result=await this.snapshot();this.store.updateSelectedState({status:'success',last_success:new Date(this.clock()).toISOString(),next_retry:null,last_error:null});return {...result,status:'rebuilt-after-409',items:this.store.selectedCount()};}
    catch(err){e=err;}
   }
   const delay=e.status===429||e.status===503?waitTime(e,now):Math.min(30*60_000,Math.max(60_000,(previous.failure_count||0)+1)*60_000);
   const retry=new Date(now+delay).toISOString();this.store.updateSelectedState({status:'error',last_error:String(e.message).slice(0,240),next_retry:retry,failure_count:(previous.failure_count||0)+1});
   return {status:'error',error:e.message,nextRetry:retry,items:this.store.selectedCount()};
  }finally{this.busy=false;}
 }
 async snapshot(){
  const records=[];let cursor=null,page=null,count=0;const seenPages=new Set();
  for(let i=0;i<this.maxPages;i++){
   const url=new URL(BASE+'/snapshot');url.searchParams.set('fields','default');url.searchParams.set('limit',String(this.pageLimit));if(page)url.searchParams.set('page',page);
   const data=readJSON(await this.client(url.toString(),{sourceId:'aihot-selected',conditional:false}));
   if(!Array.isArray(data.items)||typeof data.hasMore!=='boolean'||!validCursor(data.cursor))throw Error('Invalid snapshot page contract');
   if(i===0)cursor=data.cursor;else if(data.cursor!==cursor)throw Error('Snapshot watermark changed during pagination');
   records.push(...data.items);count++;
   if(!data.hasMore){this.store.replaceSelected(records,cursor,selectedItem);return{mode:'snapshot',pages:count,received:records.length,cursorStored:true};}
   if(!validCursor(data.nextPage)||seenPages.has(data.nextPage))throw Error('Invalid or repeated snapshot nextPage');seenPages.add(data.nextPage);page=data.nextPage;
  }
  throw Error('Snapshot exceeds max pages; no partial data applied');
 }
 async changes(initialCursor){
  let cursor=initialCursor,processed=0,pages=0,upserts=0,removes=0;const seen=new Set();
  for(let i=0;i<this.maxPages;i++){
   const url=new URL(BASE+'/changes');url.searchParams.set('cursor',cursor);url.searchParams.set('limit','100');
   let response;
   try{response=await this.client(url.toString(),{sourceId:'aihot-selected',conditional:false})}catch(e){throw e;}
   if(response.notModified)return{mode:'changes',pages,processed,upserts,removes,notModified:true};
   const data=readJSON(response);if(!Array.isArray(data.changes)||typeof data.hasMore!=='boolean'||!validCursor(data.cursor))throw Error('Invalid selected changes contract');
   if(data.cursor===cursor&&data.hasMore)throw Error('Non-progressing changes cursor');
   if(seen.has(data.cursor))throw Error('Repeated changes cursor');seen.add(data.cursor);
   const normalized=[];
   for(const change of data.changes){if(!change||!['upsert','remove'].includes(change.op))throw Error('Unknown AIHOT change operation');if(change.op==='remove'){
    if(change.id===undefined||change.id===null||!String(change.id))throw Error('Remove missing id');normalized.push({op:'remove',id:String(change.id)});removes++;
   }else{const value=change.item;if(!value||value.id===undefined)throw Error('Upsert missing item');const normalizedItem=selectedItem(value);if(!normalizedItem)throw Error('Invalid upsert item');normalized.push({op:'upsert',id:String(value.id),value,normalizedItem});upserts++;}}
   // Atomic page application and cursor update. A failure never advances the cursor.
   this.store.applySelectedChanges(normalized,data.cursor);cursor=data.cursor;pages++;processed+=data.changes.length;
   if(!data.hasMore)return{mode:'changes',pages,processed,upserts,removes,cursorStored:true};
  }
  return{mode:'changes',pages,processed,upserts,removes,pending:true,cursorStored:true};
 }
}

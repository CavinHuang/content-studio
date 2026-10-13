import {ingestSource,defaultSources} from './adapters.mjs';import {createClient,waitTime} from './net.mjs';
export class SyncEngine{
 constructor(store,{sources=defaultSources,client=null,clock=()=>Date.now()}={}){this.store=store;this.sources=sources;this.clock=clock;store.register(sources);this.client=client||createClient({getEtag:id=>store.sourceState(id).etag});this.running=false;}
 sourceStatus(){return this.sources.map(s=>({...s,connection:'not-yet-verified',...this.store.sourceState(s.id)}));}
 async sync({id=null,force=false}={}){
  if(this.running)return {busy:true,message:'Already syncing'};
  this.running=true;const results=[];
  try{for(const s of this.sources.filter(s=>s.enabled&&(id===null||id===s.id))){
   if(s.id==='aihot'&&this.store.selectedState()?.cursor){results.push({source:s.id,status:'mirror-managed'});continue;}
   const prev=this.store.sourceState(s.id);const now=this.clock();const minGap=s.provider==='aihot'?60_000:20_000;
   if(prev.next_retry&&Date.parse(prev.next_retry)>now){results.push({source:s.id,status:'backoff',nextRetry:prev.next_retry});continue;}
   if(prev.last_attempt&&now-Date.parse(prev.last_attempt)<minGap){results.push({source:s.id,status:'throttled',nextEligible:new Date(Date.parse(prev.last_attempt)+minGap).toISOString()});continue;}
   if(!force&&prev.last_success&&now-Date.parse(prev.last_success)<s.intervalMinutes*60_000){results.push({source:s.id,status:'fresh-cache'});continue;}
   this.store.updateSource(s.id,{last_attempt:new Date(now).toISOString(),status:'syncing',last_error:null});
   try{const r=await ingestSource(s,this.client);const n=this.store.upsert(r.items);this.store.updateSource(s.id,{last_success:new Date(now).toISOString(),status:r.notModified?'not-modified':'success',etag:r.etag||prev.etag||null,next_retry:null,last_error:r.warning||null,last_http:r.httpStatus,seen_total:(prev.seen_total||0)+n});this.store.log(s.id,r.notModified?'not-modified':'success',r.httpStatus,n,r.warning);results.push({source:s.id,status:r.notModified?'not-modified':'success',inserted:n,received:r.items.length,warning:r.warning});
   }catch(e){const secs=e.status===429||e.status===403?waitTime(e,now):e.status>=500?60_000:2*60_000;const retry=new Date(now+secs).toISOString();this.store.updateSource(s.id,{status:'error',last_http:e.status||null,last_error:String(e.message).slice(0,240),next_retry:retry});this.store.log(s.id,'error',e.status,0,e.message);results.push({source:s.id,status:'error',error:e.message,nextRetry:retry});}
  }return{busy:false,results,stats:this.store.stats()};
  }finally{this.running=false;}
 }
}

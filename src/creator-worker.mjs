import {accountsEnabled,getAccounts} from './author-accounts.mjs';
import {getCore,getAuthorCore} from '../lib/core.mjs';
const key=Symbol.for('studio.creator-scheduler');
export async function runCreatorTick({cores,authors,openCore}={}){
 if(cores){for(const core of cores)try{await core.services.using(()=>core.creator.runDue())}catch{}return}
 const accounts=authors?null:getAccounts();for(const author of authors||accounts.authors())try{const core=openCore?openCore(author):getAuthorCore(accounts,author);await core.services.using(()=>core.creator.runDue())}catch{/* One workspace failure must not stop other authors' work. */}
}
export function startCreatorWorker(){
 if(globalThis[key]||process.env.CONTENT_STUDIO_WORKER_DISABLED==='1')return;
 let running=false;const tick=async()=>{if(running)return;running=true;try{await runCreatorTick(accountsEnabled()?{}:{cores:[getCore()]})}catch{}finally{running=false}};
 const timer=setInterval(tick,3000);timer.unref();globalThis[key]={timer,tick};void tick();
}

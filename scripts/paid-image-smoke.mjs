/** V41 one-call, opt-in, disposable provider acceptance smoke.
 * Defaults to offline preflight; no public publishing or content ingestion.
 * No API keys, image bytes or original prompt in stdout/stderr.
 */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCore} from '../lib/core.mjs';
import {providerContractPreflight} from '../src/image-providers.mjs';

export const CONSENT_PHRASE='I_ACCEPT_ONE_BILLABLE_IMAGE_REQUEST';
const VALID=new Set(['openai','gemini','qwen']);
const example='一张展示三个抽象方块以细线相连的中性技术示意插画，不包含文字、真实公司标识或个人信息。';

export function parseSmokeArgs(argv=[]){
 let provider='openai',execute=false,maxRequests=null;
 for(const arg of argv){
  if(arg==='--execute'){if(execute)throw Error('Duplicate --execute');execute=true;}
  else if(arg.startsWith('--provider=')){provider=arg.slice('--provider='.length);}
  else if(arg.startsWith('--max-requests=')){maxRequests=Number(arg.slice('--max-requests='.length));}
  else if(arg==='--help')return {help:true};
  else throw Error('Unknown argument. Supported: --provider=openai|gemini|qwen, --max-requests=1, --execute');
 }
 if(!VALID.has(provider))throw Error('Select exactly one supported provider');
 if(maxRequests!==null&&maxRequests!==1)throw Error('The smoke harness supports exactly one model request');
 if(execute&&maxRequests!==1)throw Error('Paid execution requires --max-requests=1');
 return {provider,execute,maxRequests};
}

export async function runSmoke(args,{environment=process.env,generator,output=console.log}={}){
 const opts=Array.isArray(args)?parseSmokeArgs(args):args;
 if(opts.help){output('Usage: npm run smoke:image -- --provider=openai --max-requests=1 [--execute]');return {mode:'help',requests:0};}
 if(opts.execute&&environment.CONTENT_STUDIO_PAID_SMOKE_CONSENT!==CONSENT_PHRASE)throw Error('Paid image test blocked: set CONTENT_STUDIO_PAID_SMOKE_CONSENT to the documented exact consent phrase');
 const state=providerContractPreflight().find(p=>p.id===opts.provider);
 if(!state)throw Error('Invalid provider');
 const plan={mode:opts.execute?'paid_single_request':'offline_only',provider:opts.provider,model:state.model,
  configured:state.configured,problems:state.problems,maxRequests:opts.execute?1:0,
  usesSyntheticArticle:true,noPublication:true,storesImagePersistently:false};
 if(!opts.execute){output(JSON.stringify(plan));return {...plan,requests:0};}
 if(!state.configured)throw Error('Selected provider is not configured; run offline preflight first');
 // Do not create a persistent SQLite, even if the operator has CONTENT_STUDIO_DB_PATH.
 // Exactly one outbound image attempt; no fallback, retries, optional vision or text planning.
 const core=createCore(':memory:');
 try{
  if(generator)core.illustrations.generator=generator;
  const p=core.editorial.create({title:'Synthetic illustration provider verification',paragraphs:[{text:example}]});
  const current=core.illustrations.get(p.id);
  core.illustrations.budget.setLimit(p.id,{expectedRevision:0,dailyLimit:1});
  const planned=core.illustrations.plan(p.id,{expectedMasterRevision:current.sourceRevision});
  const cover=planned.shots.find(x=>x.role==='cover')||planned.shots[0];
  const started=Date.now();
  let outcome='failed',result=null,error=null;
  try{
   const completed=await core.illustrations.generate(p.id,cover.id,{
    allowExternalAI:true,provider:opts.provider,maxAttempts:1,fallbackProviders:[]
   });
   outcome='generated_unapproved';
   result={mime:completed.asset?.mime||null,bytes:completed.asset?.size||null,provider:completed.provider};
  }catch(e){
   error={status:Number.isInteger(e?.status)?e.status:null,classification:e?.retryable===true?'transient':'non_transient_or_unknown'};
  }
  const budget=core.illustrations.budget.get(p.id);
  const summary={mode:'paid_single_request',outcome,provider:opts.provider,model:state.model,
   elapsedMs:Date.now()-started,requestsReserved:budget.used,requestsAttemptedAtMost:1,
   requestCostUnknown:true,asset:result,error,noPublication:true,imageApproved:false,
   ephemeralDb:true,requiresProviderBillingReview:true};
  output(JSON.stringify(summary));
  if(outcome!=='generated_unapproved')throw Object.assign(new Error('Paid smoke returned an unsuccessful model result; inspect provider dashboard'),{smokeSummary:summary});
  return summary;
 }finally{core.close()}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 runSmoke(process.argv.slice(2)).catch(e=>{
  // Deliberately do not print raw provider errors or any request payload.
  console.error('Image smoke stopped: '+String(e?.smokeSummary?'provider call failed; inspect last sanitized JSON record':e?.message||'unknown').slice(0,200));
  process.exitCode=1;
 });
}

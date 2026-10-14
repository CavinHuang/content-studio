/** Server-only image backends. Never serialize keys into UI responses. */
import {ValidationError} from './verification.mjs';
const bad=(message,status=400,retryable=false)=>{const error=new ValidationError(message,status);error.retryable=retryable;throw error};
const base=x=>String(x||'').trim();
const settings=()=>({
 openai:{key:base(process.env.CONTENT_IMAGE_OPENAI_API_KEY||process.env.CONTENT_IMAGE_API_KEY),model:base(process.env.CONTENT_IMAGE_OPENAI_MODEL||process.env.CONTENT_IMAGE_MODEL||'gpt-image-2'),url:base(process.env.CONTENT_IMAGE_OPENAI_BASE_URL||process.env.CONTENT_IMAGE_API_BASE_URL||'https://api.openai.com/v1/')},
 gemini:{key:base(process.env.CONTENT_IMAGE_GEMINI_API_KEY),model:base(process.env.CONTENT_IMAGE_GEMINI_MODEL||'gemini-nano-banana-2.1'),url:base(process.env.CONTENT_IMAGE_GEMINI_BASE_URL||'https://generativelanguage.googleapis.com/v1beta/')},
 qwen:{key:base(process.env.CONTENT_IMAGE_QWEN_API_KEY),model:base(process.env.CONTENT_IMAGE_QWEN_MODEL||'qwen-image-3.0'),url:base(process.env.CONTENT_IMAGE_QWEN_BASE_URL||'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/')},
});
export function configuredProviders(){const s=settings();return Object.entries(s).map(([id,x])=>({id,model:x.model,configured:!!(x.key&&x.url),label:{openai:'OpenAI GPT Image',gemini:'Google Nano Banana',qwen:'Qwen Image'}[id]}));}
export function anyImageProvider(){return configuredProviders().some(p=>p.configured)};
function endpoint(value,route){let x;try{x=new URL(value.endsWith('/')?value:value+'/');x=new URL(route,x)}catch{bad('Invalid image provider URL',503)}
 if(x.protocol!=='https:'&&!(x.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(x.hostname)))bad('Remote image generation endpoint must use HTTPS',503);
 if(x.username||x.password)bad('Image provider URL cannot contain credentials',503);return x;
}
const MAX_JSON=11_000_000,MAX_IMAGE=6*1024*1024;
// Narrow host check. A random service under aliyuncs.com is not necessarily an image object store.
function isAlibabaOssHost(host){
 const value=String(host||'').toLowerCase().replace(/\.$/,'');
 return /^[a-z0-9][a-z0-9.-]*\.oss-(?:[a-z0-9-]+)\.aliyuncs\.com$/.test(value)||
        /^[a-z0-9][a-z0-9.-]*\.oss\.aliyuncs\.com$/.test(value);
}
// Disclose a safe HTTP status only, never provider response bodies/headers containing secrets.
// Only rate limits and transient upstream failures should trigger paid fallback attempts.
function providerHttpError(context,status){
 const transient=status===408||status===425||status===429||status>=500&&status<=599;
 const localStatus=status===429?429:transient?502:status===401?401:status===403?403:422;
 bad(`${context} HTTP ${status}`,localStatus,transient);
}
/** Local-only protocol readiness; does not fetch, bill, or upload content. */
export function providerContractPreflight(){
 return Object.entries(settings()).map(([id,setting])=>{
  const contract={openai:{generation:'POST /images/generations',editing:'POST /images/edits (multipart)',response:'data[0].b64_json'},
   gemini:{generation:'POST models/:model:generateContent',editing:'POST models/:model:generateContent (inlineData)',response:'candidates[].content.parts[].inlineData'},
   qwen:{generation:'POST /images/generations',editing:'POST /images/generations (image data URI)',response:'data[0].url or b64_json; constrained HTTPS OSS download'}}[id];
  const problems=[];
  if(!setting.key)problems.push('missing_api_key');
  if(!setting.model)problems.push('missing_model');
  try{endpoint(setting.url,id==='gemini'?`models/${encodeURIComponent(setting.model)}:generateContent`:'images/generations')}
  catch{problems.push('invalid_base_url')}
  return {id,model:setting.model,configured:problems.length===0,problems,contract,liveApiChecked:false,mayIncurCost:false};
 });
}
async function boundedResponse(response,cap=MAX_JSON){const type=Number(response.headers.get('content-length'));if(type>cap)bad('Provider response exceeds image size limit',502);
 let bytes=0;const parts=[];if(!response.body)bad('Empty image response',502);for await(const chunk of response.body){bytes+=chunk.length;if(bytes>cap){await response.body.cancel?.().catch(()=>{});bad('Provider response exceeds image size limit',502)}parts.push(chunk)}return Buffer.concat(parts);
}
function imageMagic(buffer){
 if(buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'image/png';
 if(buffer.subarray(0,3).equals(Buffer.from('ffd8ff','hex')))return 'image/jpeg';
 if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')return 'image/webp';
 return null;
}
const decode=b64=>{
 if(typeof b64!=='string'||!b64||b64.length>8_500_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)||b64.length%4!==0)bad('Provider returned invalid base64 image',502);
 const buf=Buffer.from(b64,'base64');
 if(buf.length<24||buf.length>MAX_IMAGE)bad('Provider image exceeds local asset limits',502);
 if(!imageMagic(buf))bad('Provider returned unsupported image bytes',502);
 return b64;
};
async function callJson(url,headers,body,timeoutMs=180000){let response;try{response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs),redirect:'error'})}catch{bad('Image provider request failed or timed out',502,true)}
 if(!response.ok)providerHttpError('Image provider',response.status);
 let data;try{data=JSON.parse((await boundedResponse(response)).toString('utf8'))}catch(e){if(e instanceof ValidationError)throw e;bad('Provider returned invalid JSON',502)}return data;
}
async function qwenDownload(value){let u;try{u=new URL(value)}catch{bad('Qwen returned invalid image URL',502)}
 // Qwen's returned links are expiring OSS links. Strict allowlist avoids SSRF and credential leakage.
 if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!isAlibabaOssHost(u.hostname))bad('Qwen image URL does not match trusted Alibaba OSS hosts',502);
 let response;try{response=await fetch(u,{method:'GET',redirect:'error',signal:AbortSignal.timeout(60000)})}catch{bad('Could not download Qwen temporary image',502,true)}
 if(!response.ok)providerHttpError('Qwen temporary image',response.status);
 const responseType=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
 if(responseType&&!['image/png','image/jpeg','image/webp','application/octet-stream','binary/octet-stream'].includes(responseType))bad('Qwen temporary image returned unexpected content type',502);
 const bytes=await boundedResponse(response,MAX_IMAGE+1);if(bytes.length>MAX_IMAGE)bad('Qwen image exceeds asset size limit',502);
 return decode(bytes.toString('base64'));
}
/** API contract is uniform; request payloads and outputs are provider-specific. */
export async function generateProviderImage(prompt,{provider='openai',role='section'}={}){
 if(!['openai','gemini','qwen'].includes(provider))bad('Unsupported image provider');
 const config=settings()[provider];if(!config.key||!config.model)bad(`${provider} image provider is not configured`,503);
 if(typeof prompt!=='string'||prompt.trim().length<1||prompt.length>12000)bad('Image prompt must be 12-12000 characters');
 if(provider==='openai'){
  const newer=/^(gpt-image-2(?:\.|$)|gpt-image-2\.5)/.test(config.model);
  const size=role==='cover'&&newer?'1536x864':role==='cover'?'1536x1024':'1536x1024';
  const result=await callJson(endpoint(config.url,'images/generations'),{authorization:`Bearer ${config.key}`},{model:config.model,prompt,size,n:1});
  if(!result?.data?.[0]?.b64_json)bad('Image provider returned no base64 image; URL-only responses are not downloaded for safety',502);
  return {base64:decode(result.data[0].b64_json),model:config.model,provider};
 }
 if(provider==='gemini'){
  const url=endpoint(config.url,`models/${encodeURIComponent(config.model)}:generateContent`);
  const result=await callJson(url,{'x-goog-api-key':config.key},{contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{responseModalities:['IMAGE'],imageConfig:{aspectRatio:role==='cover'?'16:9':'3:2'}}});
  const parts=result?.candidates?.[0]?.content?.parts||[];
  const b64=parts.find(p=>!p.thought&&p.inlineData?.data&&p.inlineData.mimeType?.startsWith('image/'))?.inlineData.data;
  if(!b64)bad('Nano Banana did not return image bytes (possibly blocked)',502);
  return {base64:decode(b64),model:config.model,provider};
 }
 const result=await callJson(endpoint(config.url,'images/generations'),{authorization:`Bearer ${config.key}`},{model:config.model,prompt,n:1,size:role==='cover'?'1536x864':'1536x1024'} ,600000);
 const b64=result?.data?.[0]?.b64_json,url=result?.data?.[0]?.url;
 if(b64)return {base64:decode(b64),model:config.model,provider};
 if(!url)bad('Qwen returned neither image bytes nor download URL',502);
 return {base64:await qwenDownload(url),model:config.model,provider};
}


/** V35 reference-driven editing: input is a local approved/generated image's bytes.
 * Provider protocols differ; Qwen uses generations.image rather than /images/edits.
 * One explicit API call only, no implicit provider fallback or automatic promotion.
 */
export async function editProviderImage(prompt,{provider='openai',role='section',referenceBytes,referenceMime}={}){
 if(!['openai','gemini','qwen'].includes(provider))bad('Unsupported image edit provider');
 const config=settings()[provider];if(!config?.key||!config.model)bad(`${provider} image provider is not configured`,503);
 if(typeof prompt!=='string'||prompt.trim().length<12||prompt.length>12000)bad('Image edit prompt must be 12-12000 characters');
 const bytes=Buffer.isBuffer(referenceBytes)?referenceBytes:Buffer.from(referenceBytes||[]);
 if(bytes.length<24||bytes.length>MAX_IMAGE||!['image/png','image/jpeg','image/webp'].includes(referenceMime))bad('Reference must be a supported local image (PNG/JPEG/WebP, <=6 MiB)',422);
 const prefix=referenceMime==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):referenceMime==='image/jpeg'?bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!prefix)bad('Reference image MIME does not match bytes',422);
 if(provider==='openai'){
  const url=endpoint(config.url,'images/edits');const form=new FormData();form.append('model',config.model);form.append('prompt',prompt);form.append('n','1');
  const ext={ 'image/png':'png','image/jpeg':'jpg','image/webp':'webp' }[referenceMime];
  form.append('image',new Blob([bytes],{type:referenceMime}),`reference.${ext}`);
  let response;try{response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${config.key}`},body:form,signal:AbortSignal.timeout(180000),redirect:'error'})}catch{bad('Image edit provider request failed or timed out',502,true)}
  if(!response.ok)providerHttpError('Image edit provider',response.status);
  let result;try{result=JSON.parse((await boundedResponse(response)).toString('utf8'))}catch(e){if(e instanceof ValidationError)throw e;bad('Image edit provider returned invalid JSON',502)}
  if(!result?.data?.[0]?.b64_json)bad('OpenAI edit returned no image bytes',502);
  return {base64:decode(result.data[0].b64_json),provider,model:config.model};
 }
 const imageData=bytes.toString('base64');
 if(provider==='gemini'){
  const result=await callJson(endpoint(config.url,`models/${encodeURIComponent(config.model)}:generateContent`),{'x-goog-api-key':config.key},{contents:[{role:'user',parts:[{text:prompt},{inlineData:{mimeType:referenceMime,data:imageData}}]}],generationConfig:{responseModalities:['IMAGE'],imageConfig:{aspectRatio:role==='cover'?'16:9':'3:2'}}});
  const parts=result?.candidates?.[0]?.content?.parts||[];const out=parts.find(p=>!p.thought&&p.inlineData?.data&&p.inlineData.mimeType?.startsWith('image/'))?.inlineData.data;
  if(!out)bad('Nano Banana edit returned no image bytes',502);
  return {base64:decode(out),provider,model:config.model};
 }
 // Qwen 3.0 I2I documents the image extension on images/generations.
 const result=await callJson(endpoint(config.url,'images/generations'),{authorization:`Bearer ${config.key}`},{model:config.model,prompt,image:`data:${referenceMime};base64,${imageData}`,n:1},600000);
 if(result?.data?.[0]?.b64_json)return {base64:decode(result.data[0].b64_json),provider,model:config.model};
 if(!result?.data?.[0]?.url)bad('Qwen edit returned no image URL or bytes',502);
 return {base64:await qwenDownload(result.data[0].url),provider,model:config.model};
}

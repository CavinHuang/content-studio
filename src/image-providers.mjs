/** Server-only image backends. Never serialize keys into UI responses. */
import {ValidationError} from './verification.mjs';
const bad=(message,status=400)=>{throw new ValidationError(message,status)};
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
async function boundedResponse(response,cap=MAX_JSON){const type=Number(response.headers.get('content-length'));if(type>cap)bad('Provider response exceeds image size limit',502);
 let bytes=0;const parts=[];if(!response.body)bad('Empty image response',502);for await(const chunk of response.body){bytes+=chunk.length;if(bytes>cap){await response.body.cancel?.().catch(()=>{});bad('Provider response exceeds image size limit',502)}parts.push(chunk)}return Buffer.concat(parts);
}
const decode=b64=>{if(typeof b64!=='string'||!b64||b64.length>8_500_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)||b64.length%4!==0)bad('Provider returned invalid base64 image',502);const buf=Buffer.from(b64,'base64');if(buf.length<24||buf.length>MAX_IMAGE)bad('Provider image exceeds local asset limits',502);return b64;};
async function callJson(url,headers,body,timeoutMs=180000){let response;try{response=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs),redirect:'error'})}catch{bad('Image provider request failed or timed out',502)}
 if(!response.ok)bad(`Image provider HTTP ${response.status}`,response.status===429?429:502);
 let data;try{data=JSON.parse((await boundedResponse(response)).toString('utf8'))}catch(e){if(e instanceof ValidationError)throw e;bad('Provider returned invalid JSON',502)}return data;
}
async function qwenDownload(value){let u;try{u=new URL(value)}catch{bad('Qwen returned invalid image URL',502)}
 // Qwen's returned links are expiring OSS links. Strict allowlist avoids SSRF and credential leakage.
 if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!u.hostname.toLowerCase().endsWith('.aliyuncs.com'))bad('Qwen image URL does not match trusted Alibaba OSS hosts',502);
 let response;try{response=await fetch(u,{method:'GET',redirect:'error',signal:AbortSignal.timeout(60000)})}catch{bad('Could not download Qwen temporary image',502)}
 if(!response.ok)bad(`Qwen temporary image returned HTTP ${response.status}`,502);
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

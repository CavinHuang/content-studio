import {providerEnvironment,providerFetch} from './provider-context.mjs';
/** Agent planning: produce visual briefs, not factual images. One explicit user-approved LLM request per plan. */
import {ValidationError} from './verification.mjs';
const bad=(msg,status=400)=>{throw new ValidationError(msg,status)};
const norm=s=>String(s||'').replace(/\s+/gu,' ').trim();
const STYLE={editorial:'Contemporary editorial illustration, crisp visual hierarchy, soft natural light, warm off-white background, low-saturation forest green accent, refined shapes.',diagram:'Minimal conceptual infographic with connected blocks and clear direction, faithful to the concept but no fabricated measurements, restrained white/gray/green palette.',abstract:'Minimal abstract editorial shapes and spatial relationships, deliberate negative space, elegant muted colors, grounded in the section topic.'};
export function composeImagePrompt({title,excerpt='',role='section',scene='',style='editorial',provider='openai',visualProfile=null}={}){
 if(!['cover','section'].includes(role))bad('Unsupported image role');if(!['editorial','diagram','abstract'].includes(style))bad('Unsupported style');
 const vision=norm(scene).slice(0,800)||`Visually communicate the key idea: ${norm(excerpt).slice(0,280)}`;
 const identity=visualProfile?`Consistent visual series identity: ${visualProfile.name}; palette: ${visualProfile.palette}; mood: ${visualProfile.mood}; avoid: ${visualProfile.avoid}. `:'';
 const shared=`${identity}Illustrate a Chinese-language technology article. Topic: ${norm(title).slice(0,140)}. Visual brief: ${vision}. ${STYLE[style]} ${role==='cover'?'16:9 wide cover, single dominant focal point, room for a title to be overlaid later outside the image.':'3:2 landscape chapter image, concrete focal point and consistent visual language.'} No written words, pseudo-text, labels, charts with numbers, brand logos, watermarks, UI screenshots, realistic depictions of unobserved experiments, or identifiable people. This is a conceptual illustration, NOT documented evidence or a literal depiction of real events.`;
 if(provider==='qwen')return `Create a precise editorial illustration with carefully composed foreground and background. ${shared} Clear silhouette, high material consistency, no visual clutter.`;
 if(provider==='gemini')return `You are an expert art director creating one polished illustration, not a mood board. Preserve a recognizable visual hierarchy and coherent geometry. ${shared}`;
 return `Produce one print-quality digital editorial illustration. Strong composition, harmonious restrained colors, expressive metaphor without unsupported factual claims. ${shared}`;
}
function cfg(){return {url:providerEnvironment().CONTENT_ILLUSTRATION_PLANNER_BASE_URL||'',key:providerEnvironment().CONTENT_ILLUSTRATION_PLANNER_API_KEY||'',model:providerEnvironment().CONTENT_ILLUSTRATION_PLANNER_MODEL||''}}
export function plannerConfigured(){const c=cfg();return !!(c.url&&c.key&&c.model)};
/** LLM returns only scene ideas per stable paragraph anchor, not executable operations. */
export async function planScenesWithModel(project,doc,slots){const c=cfg();if(!plannerConfigured())bad('Planner model is not configured',503);
 let url;try{url=new URL('chat/completions',c.url.endsWith('/')?c.url:c.url+'/')}catch{bad('Invalid planner URL',503)}
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))bad('Planner requires HTTPS',503);
 const payload={model:c.model,temperature:0.4,response_format:{type:'json_object'},messages:[{role:'system',content:'You are an editorial illustration director for technical articles. Respond with a JSON object {"scenes":[{"role":"cover|section","paragraphId":"...","scene":"...","style":"editorial|diagram|abstract"}]}. Exactly one scene per provided slot in the same order. Use only existing paragraphId from input; do not claim evidence or invent measurements. Output concise visual descriptions, not prompts with API syntax.'},{role:'user',content:JSON.stringify({title:project.title,slots:slots.map(s=>({role:s.role,paragraphId:s.paragraphId,excerpt:s.excerpt}))})}]};
 let response;try{response=await providerFetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${c.key}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000),redirect:'error'})}catch{bad('Planner API failed or timed out',502)}
 if(!response.ok)bad(`Planner API HTTP ${response.status}`,502);
 const text=await response.text();if(text.length>30000)bad('Planner response too large',502);
 let parsed;try{parsed=JSON.parse(JSON.parse(text)?.choices?.[0]?.message?.content)}catch{bad('Planner response was not valid JSON',502)}
 if(!Array.isArray(parsed.scenes)||parsed.scenes.length!==slots.length)bad('Planner did not return one scene per requested image',502);
 return parsed.scenes.map((x,i)=>{const slot=slots[i];if(x.role!==slot.role||x.paragraphId!==slot.paragraphId||typeof x.scene!=='string'||x.scene.trim().length<12||x.scene.length>800||!['editorial','diagram','abstract'].includes(x.style))bad('Planner returned an invalid or unanchored scene',502);return {scene:norm(x.scene),style:x.style}});
}

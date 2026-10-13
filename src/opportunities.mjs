import {hash,safeText} from './normalize.mjs';
const topical=[
 {name:'Agent 与自动化',rx:/\b(agent|agents|workflow|mcp|codex|claude code|opencode|tool call|browser automation|computer use|自动化|智能体|代理执行)\b/i,zh:/智能体|自动化|工具调用|执行链|浏览器操作|桌面操作/},
 {name:'独立开发与产品',rx:/\b(indie|saas|startup|product|shipping|launch|customer|developer experience|side project)\b/i,zh:/独立开发|产品|创业|用户反馈|发布上线|开发者体验/},
 {name:'模型与评估',rx:/\b(llm|benchmark|model|reasoning|evaluation|inference|token|context)\b/i,zh:/大模型|推理|评测|上下文|模型|幻觉/},
 {name:'开源工具',rx:/\b(github|opensource|open.source|repository|self.hosted|release|library)\b/i,zh:/开源|仓库|自部署|版本更新|工具链/},
];
const issues=[
 {type:'操作失败',rx:/\b(fail(?:ed|ure|s)?|broken|error|bug|crash|doesn.t work|unstable|trouble|problem|issue|regression)\b|失败|报错|崩溃|无法|不稳定|异常|回归问题/ig},
 {type:'使用障碍',rx:/\b(hard to|difficult|confusing|frustrat(?:ing|ed)|slow|latency|expensive|costly|manual|pain(?:ful)?|workaround)\b|太难|复杂|费时|卡顿|慢|昂贵|繁琐|难用|绕过|工作量/ig},
 {type:'明确诉求',rx:/\b(how do (?:i|we)|how (?:can|could|should) (?:i|we)|how to|wish|need|looking for|any way to|would love|feature request|help me)\b|有没有办法|希望支持|需要|怎么实现|如何解决|求助|功能请求/ig},
 {type:'可信性担忧',rx:/\b(verify|evidence|hallucinat|trust|traceab|audit|reproducib|privacy|security|permission|data leak)\b|验证|证据|幻觉|可信|审计|追溯|复现|隐私|权限|泄露/ig}
];
const clamp=n=>Math.max(0,Math.min(100,Math.round(n)));
const excerpt=(s,match,max=135)=>{const text=safeText(s,1600);let start=Math.max(0,match.index-48);return text.slice(start,Math.min(text.length,start+max));};
export function rankEvent(event){
 const sources=event.items||[];const sourceIds=[...new Set(sources.map(x=>x.sourceId))];const text=sources.map(x=>`${x.title}. ${x.summary||''}`).join(' ');
 const area=topical.filter(x=>x.rx.test(text)||x.zh.test(text)).map(x=>x.name);
 const signals=[];
 for(const source of sources){const candidate=`${source.title}. ${source.summary||''}`;
  const hits=[];
  for(const p of issues){p.rx.lastIndex=0;const match=p.rx.exec(candidate);if(match)hits.push({label:p.type,match});}
  if(hits.length)signals.push({itemId:source.id,sourceId:source.sourceId,role:source.role,type:hits.map(x=>x.label).join(' · '),excerpt:excerpt(candidate,hits[0].match),inference:source.role==='discussion_signal'?'来自单条社区讨论，尚未确认普遍性':'来自单条来源记录的关键词线索，尚非实际用户验证'});
 }
 const primary=sources.some(x=>x.role==='primary_statement'),discuss=sources.some(x=>x.role==='discussion_signal'),reprint=sources.some(x=>x.role==='syndication');
 const discussionSignals=signals.filter(x=>x.role==='discussion_signal');
 const challenge=discussionSignals.length>0;
 const painScore=challenge?Math.min(36,18+discussionSignals.length*6):Math.min(15,signals.length*4);
 const relevance=Math.min(26,area.length*12);
 const evidence=(primary?11:0)+(discuss?5:0)+(reprint?2:0);
 const score=clamp(12+painScore+relevance+evidence);
 const risk=[];
 if(!challenge)risk.push('缺少社区中的直接问题陈述，不能认定已有真实用户需求');
 if(!primary)risk.push('缺少一手声明，需要回到原始来源核实');
 if(!area.length)risk.push('与当前重点创作领域匹配较弱');
 if(reprint&&!primary)risk.push('聚合／转载不能代替独立证据');
 const tier=score>=72&&challenge?'值得研究':score>=45?'继续观察':'素材归档';
 return {eventId:event.id,title:event.title,score,tier,areas:area,reason:challenge?'出现可回看的社区问题措辞，值得进行一手复现或访谈':signals.length?'存在潜在使用问题线索，需要查证真实场景':'暂未检测到直接问题线索，不应因热度直接立题',problemSignals:signals.slice(0,6),risks:risk,sourceCount:sourceIds.length,sourceItemCount:sources.length,hasPrimary:primary,hasCommunity:discuss,validatedUserProblem:false,mode:'deterministic-candidate',suggestedAction:challenge?'确认频次与使用场景，再做产品实验':'先找到真实用户反馈或自己的复现实验'};
}
export const rankEvents=(events,{limit=30,filter='all'}={})=>events.map(rankEvent).filter(x=>filter==='all'||x.tier===filter).sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title)).slice(0,limit);
export function modelConfigured(){return !!(process.env.CONTENT_AI_API_KEY&&process.env.CONTENT_AI_BASE_URL&&process.env.CONTENT_AI_MODEL);}
export async function analyzeWithModel(event,{fetchImpl=globalThis.fetch}={}){
 if(!modelConfigured())throw Error('AI provider not configured');
 // Only public feed title + excerpt metadata. Never send private practice or API credentials in prompt.
 const snippets=event.items.slice(0,8).map(x=>({itemId:x.id,role:x.role,title:safeText(x.title,180),summary:safeText(x.summary,400),source:x.sourceId}));
 const allowed=new Set(snippets.map(x=>x.itemId));const base=new URL(process.env.CONTENT_AI_BASE_URL);
 if(base.protocol!=='https:'&&!(['localhost','127.0.0.1'].includes(base.hostname)&&base.protocol==='http:'))throw Error('AI endpoint must be HTTPS or local HTTP');
 const endpoint=new URL('chat/completions',base.toString().endsWith('/')?base.toString():base.toString()+'/');
 const input={model:process.env.CONTENT_AI_MODEL,temperature:0.1,max_tokens:650,messages:[{role:'system',content:'你是谨慎的内容选题研究助手。只利用提供的公开元数据。必须区分来源文本直接陈述、推论和未验证假设。不要编造用户原话、数据、案例或已独立验证的事实。仅输出 JSON 对象：{"realProblemHypothesis":"短句","audience":"可能的人群","whyWorthWriting":"为何值得进一步研究","verifySteps":["具体可执行的核实任务"],"evidenceItemIds":["提供过的itemId"],"uncertainty":"尚不确定的内容"}。没有真实问题证据时直接指出。'},{role:'user',content:JSON.stringify({eventId:event.id,items:snippets})}]};
 const resp=await fetchImpl(endpoint,{method:'POST',headers:{'Authorization':'Bearer '+process.env.CONTENT_AI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(16000),redirect:'error'});
 if(!resp.ok)throw Error(`AI provider HTTP ${resp.status}`);
 const data=await resp.json();let content=data.choices?.[0]?.message?.content||'';
 if(typeof content!=='string')throw Error('AI response missing text');content=content.trim().replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim();let out;try{out=JSON.parse(content);}catch{throw Error('AI response not JSON')};
 if(typeof out.realProblemHypothesis!=='string'||!Array.isArray(out.evidenceItemIds)||!Array.isArray(out.verifySteps))throw Error('AI response schema invalid');
 const evidences=out.evidenceItemIds.filter(x=>allowed.has(x));
 return {eventId:event.id,mode:'model-hypothesis-unverified',realProblemHypothesis:safeText(out.realProblemHypothesis,280),audience:safeText(out.audience,160),whyWorthWriting:safeText(out.whyWorthWriting,320),verifySteps:out.verifySteps.slice(0,6).map(x=>safeText(x,180)),evidenceItemIds:evidences,uncertainty:safeText(out.uncertainty,300),validatedUserProblem:false,disclaimer:'AI 推断，非真实用户调研或独立事实验证'};
}
/** Personal editorial triage only; never rewrites the underlying deterministic signal score. */
export function withVerification(candidates, getCase){
 return candidates.map(o=>{
  const c=getCase(o.eventId);
  const delta=!c?0:c.status==='rejected'?-26:c.status==='inconclusive'?-9:c.status==='confirmed'?(c.validatedUserProblem?16:c.reproduced?7:2):0;
  const editorialNote=!c?'尚无人工验证记录':c.status==='rejected'?'作者记录的反证：降低推荐顺位，不删除历史':c.status==='inconclusive'?'证据不足：暂时降权，仍可继续研究':c.status==='confirmed'&&c.validatedUserProblem?'作者记录了支持性的用户观察，尚未独立核验普遍性':c.status==='confirmed'?'作者记录了技术复现，尚未证明真实用户需求':'研究尚在进行，仍以原始信号为主';
  return {...o,editorialPriority:Math.max(0,o.score+delta),editorialNote,verification:c?{caseId:c.id,status:c.status,evidenceCount:c.evidenceCount,reproduced:c.reproduced,validatedUserProblem:c.validatedUserProblem,scope:c.verificationScope}:null,validatedUserProblem:c?.validatedUserProblem??false};
 }).sort((a,b)=>b.editorialPriority-a.editorialPriority||b.score-a.score||a.title.localeCompare(b.title));
}

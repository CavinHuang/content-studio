/** Conservative Markdown portability preflight. Not a renderer or live platform verification. */
import {createHash} from 'node:crypto';
import {validateHandoffMarkdown} from './wechat-handoff.mjs';
const channels=['wechat','zhihu'];
const labels={
 wechat:['在公众号后台粘贴并核对标题和段落','逐张核对图片展示与使用权','确认代码高亮和换行','确认手机端表格可读','确认外链在微信文章中能否打开','核对素材授权与隐私'],
 zhihu:['在知乎后台粘贴并核对标题和段落','逐张核对图片上传与使用权','确认代码块及语言标记','确认表格移动端显示','确认引用与链接可用','核对素材授权与隐私']
};
export function compatibilityPreflight(markdown,channel='wechat'){
 if(!channels.includes(channel))throw Object.assign(new Error('Unsupported publishing channel'),{status:400});
 const content=validateHandoffMarkdown(markdown),issues=[],seen=new Set();
 const features={images:0,codeBlocks:0,tables:0,quotes:0,links:0,inlineHtml:0};
 const issue=(rule,severity,line,detail)=>{
  const key=rule+':'+line;
  if(!seen.has(key)&&issues.length<80){seen.add(key);issues.push({rule,severity,line,detail});}
 };
 let fence=null,tableRun=false;
 const lines=content.split('\n');
 for(let i=0;i<lines.length;i++){
  const line=lines[i],number=i+1;
  const marker=line.match(/^ {0,3}(\x60{3,}|~{3,})(.*)$/u);
  if(fence){
   if(marker&&marker[1][0]===fence.marker[0]&&marker[1].length>=fence.marker.length&&!marker[2].trim())fence=null;
   continue;
  }
  if(marker){features.codeBlocks++;fence={marker:marker[1],line:number};tableRun=false;continue;}
  if(/^ {0,3}>/u.test(line))features.quotes++;
  if(/^\s*\|.+\|\s*$/u.test(line)){
   if(!tableRun&&/^\s*\|[\s:|\-]+\|\s*$/u.test(lines[i+1]||'')){features.tables++;tableRun=true;}
  }else tableRun=false;
  if(/<\s*\/?\s*[a-z][^>]*>/iu.test(line)){features.inlineHtml++;issue('raw-html','warning',number,'内嵌 HTML 需在平台核对结构与样式');}
  if(/<\s*(script|iframe|object|embed|form|meta|base)\b|\bon\w+\s*=|\bsrcdoc\s*=/iu.test(line))issue('unsafe-html','block',number,'动态 HTML 或事件属性不能作为可信排版稿保存');
  const link=/(!?)\[([^\]\n]*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+[^)]*)?\s*\)/gu;
  for(const m of line.matchAll(link)){
   const image=m[1]==='!',raw=m[3].replace(/^<|>$/gu,'').trim();
   image?features.images++:features.links++;
   const relative=/^(\.\/|\.\.\/|\/[^/]|#)/u.test(raw)||(!/^[a-z][\w+.-]*:/iu.test(raw)&&!/^\/\//u.test(raw));
   if(/^(javascript|vbscript|data):/iu.test(raw))issue('unsafe-uri','block',number,'危险或内嵌式 URL');
   else if(/^(file:|[a-z]:[\\\/]|\\\\)/iu.test(raw)||(image&&relative))issue('local-media','block',number,'本地或相对图片路径须重新上传');
   else if(/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?:\/|:|$)/iu.test(raw))issue('local-url','block',number,'本地 URL 不能成为公共发布素材');
   else if(/^(http:\/\/|\/\/)/iu.test(raw))issue('insecure-url','warning',number,'HTTP 地址需核对可访问性');
   if(image&&/^https:\/\//iu.test(raw))issue('remote-image','manual',number,'远程图片必须在目标平台核对是否被正常转存');
   if(!image&&relative&&raw!=='#')issue('relative-link','warning',number,'相对链接可能无法从文章打开');
  }
  const html=line.match(/<\s*(?:img|a)\b[^>]*(?:href|src)\s*=\s*['"]?([^'"\s>]+)/iu);
  if(html){
   if(/^(javascript:|data:|file:|\.\/|\.\.\/|\/[^/])/iu.test(html[1]))issue('unsafe-html-url','block',number,'HTML 标签包含不可用于外部发布的链接');
   if(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?:\/|:|$)/iu.test(html[1]))issue('local-url','block',number,'HTML 本机资源不能公开访问');
  }
  const reference=line.match(/^\s{0,3}\[[^\]]+\]:\s*(\S+)/u);
  if(reference&&/^(javascript:|data:|file:)/iu.test(reference[1]))issue('unsafe-uri','block',number,'引用式链接声明含危险 URL');
 }
 if(fence)issue('unclosed-code-fence','block',fence.line,'代码块未闭合，后续正文可能被误作代码');
 if(features.codeBlocks)issue('code-render','manual',1,'代码需在真实平台核对语言、换行和高亮');
 if(features.tables)issue('table-render','manual',1,'表格需在真实平台核对手机端布局');
 if(features.quotes)issue('quote-render','manual',1,'引用块需在平台核对样式');
 const summary={blockers:issues.filter(x=>x.severity==='block').length,warnings:issues.filter(x=>x.severity==='warning').length,manualSignals:issues.filter(x=>x.severity==='manual').length};
 return{channel,contentHash:createHash('sha256').update(content).digest('hex'),summary,features,issues,manualChecklist:labels[channel].map((label,i)=>({id:channel+'-'+i,label,status:'pending'})),canSaveLocally:summary.blockers===0,platformVerified:false,scope:'Static analysis only; neither platform paste nor publication is verified.'};
}
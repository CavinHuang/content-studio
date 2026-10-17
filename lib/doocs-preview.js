import createDOMPurify from 'dompurify';
import {initRenderer} from '../vendor/doocs/core/src/renderer/renderer-impl';

export const writingThemes={forest:{label:'森林绿',accent:'#285c45',background:'#fffefa'},ink:{label:'墨色',accent:'#303b46',background:'#ffffff'},warm:{label:'暖棕',accent:'#895b3a',background:'#fffcf7'}};
/** Render locally: no remote editor, script, font or automatic image request. */
export function renderDoocs(markdown,theme='forest',{forClipboard=false}={}){
 const renderer=initRenderer({isMacCodeBlock:false,isShowLineNumber:false,components:{},themeMode:'light'});
 const source=markdown.replace(/\(asset:\/\/(as_[a-f0-9]{32})\)/g,'(/api/assets/$1/preview)');
 const raw=renderer.renderMarkdownToHtml(source),purify=createDOMPurify(window);
 purify.addHook('uponSanitizeAttribute',(_node,data)=>{
  if(data.attrName==='id'){
   if(/^fn(?:Def|Ref)-[\w-]{1,80}$/.test(data.attrValue))data.attrValue='writing-'+data.attrValue;
   else data.keepAttr=false;
  }
  if(data.attrName==='src'){
   const local=/^\/api\/assets\/as_[a-f0-9]{32}\/preview$/.test(data.attrValue);
   const remote=forClipboard&&/^https:\/\//i.test(data.attrValue);
   if(!local&&!remote)data.keepAttr=false;
  }
  if(data.attrName==='href'&&!/^(https?:\/\/|#|mailto:)/i.test(data.attrValue))data.keepAttr=false;
  if(data.attrName==='href'&&/^#fn(?:Def|Ref)-[\w-]{1,80}$/.test(data.attrValue))data.attrValue='#writing-'+data.attrValue.slice(1);
 });
 const fragment=purify.sanitize(raw,{RETURN_DOM_FRAGMENT:true,USE_PROFILES:{html:true},FORBID_TAGS:['style','script','iframe','form','input','button','video','audio','object','embed'],FORBID_ATTR:['style','srcset','poster','background','name']});
 const root=document.createElement('section');root.append(fragment);
 const palette=writingThemes[theme]||writingThemes.forest;
 root.style.cssText=`font-family:system-ui,-apple-system,sans-serif;line-height:1.9;font-size:16px;color:#28352e;background:${palette.background};overflow-wrap:anywhere;`;
 const styles={h1:`font-size:28px;line-height:1.5;color:${palette.accent};margin:28px 0 20px;font-weight:700;`,h2:`font-size:22px;color:${palette.accent};border-bottom:1px solid #dce5dd;padding-bottom:10px;margin:28px 0 16px;font-weight:700;`,h3:`font-size:18px;color:${palette.accent};margin:22px 0 12px;font-weight:700;`,p:'margin:0 0 18px;line-height:1.9;',blockquote:`border-left:3px solid ${palette.accent};margin:20px 0;padding:12px 18px;background:#f1f5ef;`,pre:'padding:16px;background:#f2f3f0;overflow:auto;white-space:pre-wrap;font-size:13px;border-radius:8px;',table:'border-collapse:collapse;width:100%;margin:18px 0;',th:'border:1px solid #dce2db;padding:8px;text-align:left;background:#f2f5ee;',td:'border:1px solid #dce2db;padding:8px;',img:'max-width:100%;height:auto;border-radius:8px;',a:`color:${palette.accent};text-decoration:underline;`,ul:'padding-left:24px;margin:16px 0;',ol:'padding-left:24px;margin:16px 0;',li:'margin:6px 0;',strong:`font-weight:700;color:${palette.accent};`};
 for(const [tag,style] of Object.entries(styles))for(const el of root.querySelectorAll(tag))el.style.cssText=style;
 for(const image of root.querySelectorAll('img:not([src])')){
  const placeholder=document.createElement('span');placeholder.className='writing-image-placeholder';placeholder.textContent='图片：'+(image.alt||'外部图片（预览未加载）');image.replaceWith(placeholder);
 }
 for(const link of root.querySelectorAll('a')){link.setAttribute('rel','noopener noreferrer');link.setAttribute('target','_blank')}
 return root.outerHTML;
}

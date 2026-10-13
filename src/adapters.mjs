import {parseFeed,item} from './normalize.mjs';
const clean=(s)=>String(s||'').trim();
export const defaultSources=[
 {id:'aihot',name:'AIHOT 精选',provider:'aihot',enabled:true,priority:'P0',url:'https://aihot.news/api/v1/items?mode=selected&window=24h&limit=20',intervalMinutes:15,rights:'personal-internal-only'},
 {id:'github-claude',name:'GitHub · Claude Code Releases',provider:'github',enabled:true,priority:'P0',url:'https://api.github.com/repos/anthropics/claude-code/releases?per_page=6',intervalMinutes:30,rights:'public-metadata'},
 {id:'github-opencode',name:'GitHub · OpenCode Releases',provider:'github',enabled:true,priority:'P0',url:'https://api.github.com/repos/anomalyco/opencode/releases?per_page=6',intervalMinutes:30,rights:'public-metadata'},
 {id:'hackernews',name:'Hacker News · Top Stories',provider:'hackernews',enabled:true,priority:'P0',url:'https://hacker-news.firebaseio.com/v0/topstories.json',intervalMinutes:20,rights:'public-metadata'},
 {id:'rss-openai',name:'OpenAI · 官方新闻',provider:'rss',enabled:true,priority:'P0',url:'https://openai.com/news/rss.xml',intervalMinutes:60,rights:'public-metadata'},
 {id:'rss-deepmind',name:'Google DeepMind · 官方博客',provider:'rss',enabled:true,priority:'P0',url:'https://deepmind.google/blog/rss.xml',intervalMinutes:60,rights:'public-metadata'}
];
const ensureArray=(v)=>Array.isArray(v)?v:[];
export async function ingestSource(source,client,{hnLimit=12}={}){
 const fetch=async(url,opts={})=>client(url,opts);
 const result=await fetch(source.url,{sourceId:source.id,conditional:true});
 if(result.notModified)return {notModified:true,items:[],etag:result.etag||null,httpStatus:304};
 let out=[];
 if(source.provider==='aihot'){
  const o=JSON.parse(result.body);if(!Array.isArray(o.items))throw Error('AIHOT response missing items[]');
  out=o.items.map(x=>item({sourceId:source.id,provider:'aihot',nativeId:x.id,url:x.links?.original||x.links?.aihot,title:x.title,summary:x.summary||x.reason||'',publishedAt:x.publishedAt||x.discoveredAt,category:x.category,score:x.score,role:'syndication'}));
 }else if(source.provider==='github'){
  const a=JSON.parse(result.body);if(!Array.isArray(a))throw Error('GitHub releases response is not an array');
  out=a.filter(x=>!x.draft).map(x=>item({sourceId:source.id,provider:'github',nativeId:x.id,url:x.html_url,title:`${x.name||x.tag_name} · ${source.name.replace(/^GitHub · /,'')}`,summary:x.body,publishedAt:x.published_at,role:'primary_statement',category:'opensource'}));
 }else if(source.provider==='hackernews'){
  const ids=JSON.parse(result.body);if(!Array.isArray(ids))throw Error('HN story IDs response is not an array');
  // Serial fetching avoids a burst of HN requests; partial item failure is logged, not a total failure.
  let failures=0;for(const id of ids.slice(0,hnLimit))try{
    const response=await fetch(`https://hacker-news.firebaseio.com/v0/item/${Number(id)}.json`,{sourceId:source.id,conditional:false});const x=JSON.parse(response.body);if(!x||x.deleted||x.dead||!x.title)continue;
    out.push(item({sourceId:source.id,provider:'hackernews',nativeId:x.id,url:x.url||`https://news.ycombinator.com/item?id=${x.id}`,title:x.title,summary:x.text||`HN points: ${x.score||0}, discussion: ${x.descendants||0}`,publishedAt:x.time?new Date(x.time*1000).toISOString():null,score:x.score,category:'discussion',role:'discussion_signal'}));
  }catch{failures++;}
  if(failures)result.warning=`${failures} HN item requests failed`;
 }else if(source.provider==='rss'){
  out=parseFeed(result.body,source.url,20).map(x=>item({...x,sourceId:source.id,provider:'rss',role:'primary_statement',category:'official'}));
 }else throw Error('Unsupported provider '+source.provider);
 return {items:out.filter(Boolean),etag:result.etag||null,warning:result.warning||null,httpStatus:result.httpStatus||200};
}

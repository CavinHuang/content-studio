import test from 'node:test';
import assert from 'node:assert/strict';
import {HOTLIST_APIS,matchHotlistApi,parseHotlistPayload} from '../src/hotlist-sources.mjs';

test('hotlist whitelist matches only known endpoints by origin+path',()=>{
  const a=matchHotlistApi('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30');
  assert.equal(a.id,'hn-frontpage');
  assert.equal(matchHotlistApi('https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=10').id,'hn-frontpage');
  assert.equal(matchHotlistApi('https://evil.example/api/v1/search?tags=front_page'),null,'same path other host denied');
  assert.equal(matchHotlistApi('https://hn.algolia.com/api/v2/search'),null,'other path denied');
  assert.equal(matchHotlistApi('not a url'),null);
  for(const a of HOTLIST_APIS){
    assert.ok(a.name.length>4);
    assert.ok(typeof a.parse==='function');
  }
  assert.equal(matchHotlistApi('https://60s.viki.moe/v2/weibo').id,'60s-weibo');
  assert.equal(matchHotlistApi('https://60s.viki.moe/v2/baidu/hot').id,'60s-baidu-hot');
  assert.equal(matchHotlistApi('https://60s.viki.moe/v2/unknown'),null,'unlisted 60s path denied');
  assert.equal(matchHotlistApi('https://v2.xxapi.cn/api/weibohot').id,'xxapi-weibohot');
});

test('hotlist payload parsing maps hits and degrades without fabricating',()=>{
  const a=matchHotlistApi('https://hn.algolia.com/api/v1/search?tags=front_page');
  const rows=parseHotlistPayload(a,{hits:[
    {objectID:'1',title:'<b>标题一</b>',url:'https://example-a.example/1',created_at:'2026-10-21T01:00:00Z'},
    {objectID:'2',title:'只有讨论',story_text:'<p>正文</p>',created_at:'2026-10-21T02:00:00Z'},
    {objectID:'3',title:'',url:'https://example-c.example/3'},
  ]});
  assert.equal(rows.length,2);
  assert.equal(rows[0].title,'标题一');
  assert.equal(rows[1].url,'https://news.ycombinator.com/item?id=2');
  assert.match(rows[1].summary,/正文/);
  assert.throws(()=>parseHotlistPayload(a,{nope:true}),'unexpected shape throws');
  assert.throws(()=>parseHotlistPayload(a,null));
});

test('60s payloads normalize varying field names, nesting and heat values',()=>{
  const wb=matchHotlistApi('https://60s.viki.moe/v2/weibo');
  const rows=parseHotlistPayload(wb,{code:200,data:[
    {title:'问界回应起火',hot_value:1371126,link:'https://s.weibo.com/weibo?q=x'},
    {title:'<b>无链接条目</b>'},
  ]});
  assert.equal(rows.length,1,'entries without url are dropped honestly');
  assert.equal(rows[0].title,'问界回应起火');
  assert.equal(rows[0].summary,'热度 1371126');
  const rn=parseHotlistPayload(wb,{code:200,data:{data:[
    {rank:1,title:'旅行拍照',score:'947.5w',link:'https://www.xiaohongshu.com/s?k=y'},
  ]}});
  assert.equal(rn.length,1,'nested data.data supported');
  assert.equal(rn[0].summary,'热度 947.5w');
  const it=parseHotlistPayload(wb,{code:200,data:[
    {title:'Chrome 156 稳定版',description:'修复 353 个漏洞',link:'https://www.ithome.com/x',created_at:'2026-10-21T03:00:00Z'},
  ]});
  assert.equal(it[0].summary,'修复 353 个漏洞');
  assert.equal(it[0].publishedAt,'2026-10-21T03:00:00Z');
  assert.throws(()=>parseHotlistPayload(wb,{code:500,data:[]}),'non-200 code throws');
  assert.throws(()=>parseHotlistPayload(wb,{code:200,data:'oops'}),'non-array data throws');
});

test('xxapi fallback payloads map hot strings and require data array',()=>{
  const a=matchHotlistApi('https://v2.xxapi.cn/api/weibohot');
  const rows=parseHotlistPayload(a,{code:200,msg:'数据请求成功',data:[
    {hot:'120万',index:1,title:'台独给周杰伦扣帽子国台办回应',url:'https://s.weibo.com/weibo?q=x'},
    {hot:'80万',index:2,title:'<i>无链接</i>'},
  ]});
  assert.equal(rows.length,1);
  assert.equal(rows[0].summary,'热度 120万');
  assert.throws(()=>parseHotlistPayload(a,{code:200,msg:'x'}),'missing data array throws');
});

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

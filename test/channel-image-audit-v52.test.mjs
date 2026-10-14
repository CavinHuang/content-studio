import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
const oldUrl='https://cdn.example.org/v52-original.png';
const newUrl='https://cdn.example.org/v52-updated.png';
const note='模拟作者登记的图片地址；真实远程服务尚未验证。';
const r=(core,path,method='GET',data,origin)=>dispatchApi(new Request('http://localhost:4312'+path,{
 method,headers:{...(data?{'content-type':'application/json'}:{}),...(origin?{Origin:origin}:{})},
 body:data?JSON.stringify(data):undefined
}),core);
function make(t){
 const core=createCore(':memory:');t.after(()=>core.close());
 const asset=core.assets.upload({name:'synthetic.png',alt:'真实 PNG 字节的离线合成图',base64:png});
 return {core,asset};
}
test('V52 update records historical URL only when the mapping URL changes',t=>{
 const {core,asset}=make(t);
 const md='# 仅本地映射核查\n\n![合成图]('+oldUrl+')';
 core.assets.setMapping(asset.id,'wechat',{url:oldUrl,note});
 assert.equal(core.assets.auditChannelImages('wechat',md).summary.current,1);
 core.assets.setMapping(asset.id,'wechat',{url:oldUrl,note:'只是补充人工备注，没有改动原始 URL'});
 assert.equal(core.store.db.prepare('SELECT COUNT(*) AS n FROM content_asset_mapping_history').get().n,0);
 core.assets.setMapping(asset.id,'wechat',{url:newUrl,note});
 const audit=core.assets.auditChannelImages('wechat',md);
 assert.equal(audit.summary.total,1);assert.equal(audit.summary.stale,1);
 assert.equal(audit.status,'needs_remapping');
 assert.equal(audit.references[0].assetId,asset.id);
 assert.equal(audit.references[0].url,oldUrl);
 assert.equal(audit.references[0].currentUrl,newUrl);
 assert.equal(audit.networkCalls,0);
 assert.equal(audit.platformVerified,false);
 assert.equal(audit.cdnReachabilityVerified,false);
 assert.equal(core.store.db.prepare('SELECT COUNT(*) AS n FROM content_asset_mapping_history').get().n,1);
 assert.equal(core.assets.auditChannelImages('wechat',md.replace(oldUrl,newUrl)).summary.current,1);
 assert.equal(core.assets.auditChannelImages('zhihu',md).summary.current,0);
});
test('V52 review distinguishes missing asset tokens, external images, and code-fenced fake images',t=>{
 const {core,asset}=make(t);
 core.assets.setMapping(asset.id,'wechat',{url:oldUrl,note});
 const content=[
  '# 本地图片审阅','![匹配图]('+oldUrl+')',
  '![需要映射](asset://'+asset.id+')',
  '![外部图片](https://another.example.org/unverified.png)',
  '`![行内代码](https://another.example.org/in-code.png)`',
  '```md','![代码围栏](https://another.example.org/in-fence.png)','```'
 ].join('\n');
 const result=core.assets.auditChannelImages('wechat',content);
 assert.deepEqual(result.summary,{total:3,current:1,stale:0,unresolved:1,external:1});
 assert.equal(result.status,'needs_remapping');
 assert.equal(result.networkCalls,0);
 assert.equal(result.platformVerified,false);
 assert.ok(!result.references.some(x=>x.url.includes('in-code')||x.url.includes('in-fence')));
});
test('V52 exact same image URL is always channel-specific, never automatically published',t=>{
 const {core,asset}=make(t);
 core.assets.setMapping(asset.id,'wechat',{url:oldUrl,note});
 const text='![image]('+oldUrl+')';
 const wechat=core.assets.auditChannelImages('wechat',text);
 const zhihu=core.assets.auditChannelImages('zhihu',text);
 assert.equal(wechat.summary.current,1);
 assert.equal(zhihu.summary.external,1);
 assert.equal(zhihu.summary.current,0);
 assert.equal(wechat.platformVerified,false);
 assert.equal(zhihu.platformVerified,false);
});
test('V52 API reads saved layout and identifies changed historical URL without editing Markdown',async t=>{
 const {core,asset}=make(t);
 const response=await r(core,'/api/editor/projects','POST',{title:'V52 测试跨服务图片交接',paragraphs:[
  {text:'这段文字作为图片排版的离线测试正文。'}
 ]});
 assert.equal(response.status,201);
 const p=await response.json(),id=p.id,base='/api/composer/projects/'+id+'/wechat';
 core.assets.setMapping(asset.id,'wechat',{url:oldUrl,note});
 const draft=await (await r(core,base)).json();
 const imported=draft.markdown+'\n\n![合成图]('+oldUrl+')';
 const review=await r(core,base+'/review','POST',{
  expectedLayoutRevision:draft.layoutRevision,expectedDocumentRevision:draft.sourceDocumentRevision,markdown:imported
 });
 assert.equal(review.status,200);
 const checked=await review.json();
 const put=await r(core,base,'PUT',{expectedLayoutRevision:draft.layoutRevision,
  expectedDocumentRevision:draft.sourceDocumentRevision,markdown:imported,
  reviewToken:checked.reviewToken,acknowledgeDrift:true});
 assert.equal(put.status,200);
 let report=await (await r(core,base+'/image-audit')).json();
 assert.equal(report.projectId,id);
 assert.equal(report.summary.current,1);
 assert.equal(report.layoutRevision,1);
 core.assets.setMapping(asset.id,'wechat',{url:newUrl,note});
 report=await (await r(core,base+'/image-audit')).json();
 assert.equal(report.summary.stale,1);
 assert.equal(report.status,'needs_remapping');
 const saved=(await (await r(core,base)).json()).markdown;
 assert.equal(saved,imported);
 assert.ok(!saved.includes(newUrl),'historical Markdown must not be silently replaced');
 const noLeak=await r(core,base+'/image-audit','GET',undefined,'https://malicious.example');
 assert.equal(noLeak.status,403);
});
test('V52 historical mappings survive a real SQLite close/reopen',t=>{
 const dir=mkdtempSync(join(tmpdir(),'studio-v52-history-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'test.sqlite');
 let core=createCore(path);
 const asset=core.assets.upload({name:'stored.png',alt:'持久化测试素材',base64:png});
 core.assets.setMapping(asset.id,'wechat',{url:oldUrl,note});
 core.assets.setMapping(asset.id,'wechat',{url:newUrl,note});
 core.close();
 core=createCore(path);
 try{
  const result=core.assets.auditChannelImages('wechat','![历史图]('+oldUrl+')');
  assert.equal(result.summary.stale,1);
  assert.equal(result.references[0].currentUrl,newUrl);
  assert.equal(result.networkCalls,0);
 }finally{core.close()}
});

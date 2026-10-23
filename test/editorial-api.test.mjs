import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const path=mkdtempSync(join(tmpdir(),'cs27-http-')),port=54427,base=`http://127.0.0.1:${port}`;let proc;
const call=async(p,method='GET',body,origin)=>{const res=await fetch(base+p,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(origin?{Origin:origin}:{})},body:body?JSON.stringify(body):undefined});const ct=res.headers.get('content-type')||'';return{status:res.status,body:ct.includes('application/json')?await res.json():await res.text()}};
test('V27 HTTP: unified master → separate channel → checks → local export → reported publication',async()=>{proc=spawn(process.execPath,['src/server.mjs'],{cwd:process.cwd(),env:{...process.env,DB_PATH:join(path,'temp.sqlite'),PORT:String(port),NODE_ENV:'http-check'},stdio:'ignore'});try{
 let ok=false;for(let i=0;i<70;i++){try{let h=await call('/api/health');if(h.status===200){ok=true;break}}catch{}await new Promise(r=>setTimeout(r,65))}assert.ok(ok,'server should become healthy');
 let x=await call('/editor');assert.equal(x.status,200);assert.match(x.body,/统一创作编辑器/);assert.match(x.body,/id="document"/);
 x=await call('/api/editor/projects','POST',{title:'一篇准备核查的真实作者稿',paragraphs:[{id:'p_ready01',text:'我在本机做了一次受控实验，但还没有证据证明所有用户都会遇到类似情况。'}]});assert.equal(x.status,201);const id=x.body.id;assert.equal(x.body.channels.master.document.revision,1);
 let get=await call('/api/editor/projects/'+id);assert.equal(get.status,200);assert.equal(get.body.channels.zhihu.document.paragraphs.length,1);
 let d=await call('/api/editor/projects/'+id+'/wechat/document','PUT',{expectedRevision:1,paragraphs:[{id:'p_ready01',text:'公众号稿经过独立编辑，保留实验局限，不传播尚未核实的需求。'}]});assert.equal(d.status,200);assert.equal(d.body.channels.wechat.document.revision,2);assert.equal(d.body.channels.master.document.revision,1);
 let stale=await call('/api/editor/projects/'+id+'/wechat/document','PUT',{expectedRevision:1,paragraphs:[{id:'p_ready01',text:'覆盖错误'}]});assert.equal(stale.status,409);
 let exportBlocked=await call('/api/editor/projects/'+id+'/wechat/export','POST',{expectedRevision:2});assert.equal(exportBlocked.status,409);
 let checks=await call('/api/editor/projects/'+id+'/wechat/checks','POST',{expectedRevision:2,checks:{factual:true,privacy:true,rights:true,layout:true}});assert.equal(checks.status,200);
 // RD-01：HTTP 载荷 checks 保持四布尔形态，指针以同层独立字段 checkedRevision 透出
 let checksGet=await call('/api/editor/projects/'+id);assert.equal(checksGet.status,200);assert.deepEqual(checksGet.body.channels.wechat.checks,{factual:true,privacy:true,rights:true,layout:true});assert.equal(checksGet.body.channels.wechat.checkedRevision,2);
 let badChecks=await call('/api/editor/projects/'+id+'/wechat/checks','POST',{expectedRevision:2,checks:{factual:true,privacy:true,rights:true,layout:true,extra:true}});assert.equal(badChecks.status,400);
 let expo=await call('/api/editor/projects/'+id+'/wechat/export','POST',{expectedRevision:2});assert.equal(expo.status,200);assert.equal(expo.body.publicationVerified,false);assert.match(expo.body.html,/公众号稿经过独立编辑/);
 let z=(await call('/api/editor/projects/'+id)).body.channels.zhihu;assert.equal(z.status,'draft');
 let report=await call('/api/editor/projects/'+id+'/wechat/reported','POST',{url:'https://mp.weixin.qq.com/s/local-author-report',expectedRevision:2});assert.equal(report.status,200);assert.equal(report.body.channels.wechat.status,'reported_published');
 let history=await call('/api/precision/documents/'+get.body.channels.wechat.referenceId+'/history');assert.equal(history.status,200);assert.equal(history.body.history.length,2);
 let bad=await call('/api/editor/projects','POST',{title:'not permitted',paragraphs:[{text:'跨域提交应该被服务器拒绝'}]},'https://untrusted.example');assert.equal(bad.status,403);
 }finally{proc?.kill();rmSync(path,{recursive:true,force:true})}});

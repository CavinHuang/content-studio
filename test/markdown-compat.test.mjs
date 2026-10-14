import test from 'node:test';
import assert from 'node:assert/strict';
import {compatibilityPreflight} from '../lib/markdown-compat.mjs';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';
const request=(p,c,method='GET',data)=>dispatchApi(new Request('http://localhost:4312'+p,{method,headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined}),c);
test('local images and javascript URLs block unsafe imports',()=>{
 const r=compatibilityPreflight('# Case\n\n![Local](./image.png)\n\n[click](javascript:alert(1))');
 assert.equal(r.canSaveLocally,false);assert.ok(r.summary.blockers>=2);assert.equal(r.platformVerified,false);
});
test('unsafe HTML and unclosed code fences contain specific blocking line numbers',()=>{
 const r=compatibilityPreflight('# A\n\n<script>alert(1)</script>\n\n\x60\x60\x60js\nconst x=1;');
 assert.ok(r.issues.some(x=>x.rule==='unsafe-html'&&x.line===3));
 assert.ok(r.issues.some(x=>x.rule==='unclosed-code-fence'&&x.line===5));
});
test('fenced code examples are not treated as real embedded image URLs',()=>{
 const r=compatibilityPreflight('# A\n\n\x60\x60\x60md\n![img](./private.png)\n\x60\x60\x60\n\nReal text.','zhihu');
 assert.equal(r.features.images,0);assert.equal(r.summary.blockers,0);
});
test('table, code and images require manual verification on both platforms',()=>{
 const md='# A\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n\x60\x60\x60js\nconsole.log(1)\n\x60\x60\x60\n\n![pic](https://example.com/a.png)';
 const w=compatibilityPreflight(md,'wechat'),z=compatibilityPreflight(md,'zhihu');
 assert.equal(w.features.images,1);assert.equal(w.features.tables,1);assert.equal(w.features.codeBlocks,1);
 assert.equal(w.summary.blockers,0);assert.ok(w.summary.manualSignals>=2);
 assert.deepEqual(w.manualChecklist.map(x=>x.status),Array(6).fill('pending'));
 assert.notDeepEqual(w.manualChecklist,z.manualChecklist);
 assert.equal(w.contentHash,z.contentHash);
});
test('rejects dangerous reference style links and HTML local media',()=>{
 const r=compatibilityPreflight('# A\n\n<img src="./private.png"/>\n\n[ref]: javascript:alert(1)');
 assert.equal(r.canSaveLocally,false);
});
test('API preflight blocks unsafe save and saves unrelated channel history independently',async t=>{
 const core=createCore(':memory:');t.after(()=>core.close());
 const p=await (await request('/api/editor/projects',core,'POST',{title:'微信知乎排版检查'})).json();
 const route='/api/composer/projects/'+p.id+'/wechat';
 const bad={expectedLayoutRevision:0,expectedDocumentRevision:1,markdown:'# Test\n\n![image](file:///private.png)'};
 const audit=await(await request(route+'/review',core,'POST',bad)).json();
 assert.ok(audit.compatibility.summary.blockers>0);
 assert.equal((await request(route,core,'PUT',{...bad,reviewToken:audit.reviewToken,acknowledgeDrift:true})).status,422);
 assert.equal((await(await request(route,core)).json()).layoutRevision,0);
 const good={...bad,markdown:'# Test\n\n![image](https://example.com/photo.png)'};
 const approved=await(await request(route+'/review',core,'POST',good)).json();
 assert.equal(approved.compatibility.summary.blockers,0);
 assert.equal((await request(route,core,'PUT',{...good,reviewToken:approved.reviewToken,acknowledgeDrift:true})).status,200);
 const check=await(await request(route+'/compatibility',core)).json();assert.equal(check.platformVerified,false);assert.equal(check.layoutRevision,1);
 const history=await(await request(route+'/history',core)).json();
 assert.equal(history.history[0].importReview.compatibility.platformVerified,false);
 const other=await(await request('/api/composer/projects/'+p.id+'/zhihu/compatibility',core)).json();
 assert.equal(other.layoutRevision,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';
import {inspectImageBytes} from '../src/illustration-technical-audit.mjs';

const req=(core,path,method='GET',data)=>dispatchApi(new Request('http://localhost:4312'+path,{
 method,headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined
}),core);
function png(width,height){
 const b=Buffer.alloc(32);Buffer.from('89504e470d0a1a0a','hex').copy(b,0);
 b.write('IHDR',12,'ascii');b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);
 return b;
}
function jpeg(width,height){
 return Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x04,0,0,0xff,0xc0,0,11,8,
 (height>>8)&255,height&255,(width>>8)&255,width&255,1,1,0x11,0,0xff,0xd9,0,0,0]);
}
function webp(width,height){
 const b=Buffer.alloc(32);b.write('RIFF',0,'ascii');b.write('WEBP',8,'ascii');
 b.write('VP8X',12,'ascii');b.writeUIntLE(width-1,24,3);b.writeUIntLE(height-1,27,3);return b;
}
async function setup(t){
 const core=createCore(':memory:');t.after(()=>core.close());
 const r=await req(core,'/api/editor/projects','POST',{title:'本地图片技术验收',paragraphs:[
  {text:'自动配图需要在保证内容可验证、结构完整的前提下进行尺寸检查和人工审核。'},
  {text:'来源不同的图片可以比较文件属性，却不能据此宣称模型具有更高的审美质量。'},
  {text:'交接微信或知乎时，要确保图片插入位置和人工上传的素材地址一致。'}
 ]});
 assert.equal(r.status,201);const project=await r.json();
 const root='/api/illustrations/projects/'+project.id;
 const planRes=await req(core,root+'/plan','POST',{expectedMasterRevision:1});
 assert.equal(planRes.status,201);
 return {core,project,root,plan:await planRes.json()};
}
test('technical image parser supports PNG, JPEG SOF and WebP extended dimensions',()=>{
 const checks=[
  {body:png(1536,864),mime:'image/png',role:'cover',width:1536,height:864},
  {body:jpeg(1200,800),mime:'image/jpeg',role:'section',width:1200,height:800},
  {body:webp(1600,900),mime:'image/webp',role:'cover',width:1600,height:900}
 ];
 for(const entry of checks){
  const x=inspectImageBytes({...entry,alt:'技术概念示意图'});
  assert.equal(x.width,entry.width);
  assert.equal(x.height,entry.height);
  assert.deepEqual(x.issues,[]);
  assert.equal(x.technicalStatus,'technical_checks_passed');
  assert.equal(x.semanticVerified,false);
  assert.equal(x.platformVerified,false);
 }
});
test('technical inspection flags low resolution, wrong ratio, missing alt and tampered size',()=>{
 const x=inspectImageBytes({body:png(100,100),mime:'image/png',role:'cover',alt:'',size:99999});
 assert.deepEqual(x.issues,['aspect_ratio_mismatch','resolution_low','alt_missing','stored_size_mismatch']);
 const truncated=inspectImageBytes({body:Buffer.from('<html>not an image</html>'),mime:'image/png',role:'section',alt:'ok'});
 assert.ok(truncated.issues.includes('dimensions_unreadable'));
 assert.equal(truncated.advisoryOnly,true);
});
test('technical audit is read-only and shows provider artifacts without claiming model quality or publication',async t=>{
 const {core,root,plan,project}=await setup(t);
 let calls=0;
 core.illustrations.generator=async(prompt,{provider})=>{
  calls++;return {base64:png(provider==='openai'?1536:1200,provider==='openai'?864:800).toString('base64'),model:'mock-',provider};
 };
 let audit=await (await req(core,root+'/technical-audit?channel=wechat')).json();
 assert.equal(audit.extraModelRequests,0);
 assert.equal(audit.paidComparisonsPerformed,false);
 assert.equal(audit.platformVerified,false);
 assert.equal(audit.shots[0].variants.length,0);
 assert.equal((await req(core,root+'/technical-audit?channel=unknown')).status,400);
 for(const [index,shot] of plan.shots.slice(0,2).entries()){
  const provider=index===0?'openai':'gemini';
  const generated=await req(core,root+'/shots/'+shot.id+'/generate','POST',{allowExternalAI:true,provider});
  assert.equal(generated.status,200);
 }
 audit=await (await req(core,root+'/technical-audit?channel=wechat')).json();
 assert.equal(audit.shots[0].variants[0].provider,'openai');
 assert.equal(audit.shots[1].variants[0].provider,'gemini');
 assert.equal(audit.shots[0].variants[0].checks.width,1536);
 assert.equal(audit.shots[1].variants[0].checks.width,1200);
 assert.equal(audit.shots[0].variants[0].checks.semanticVerified,false);
 assert.equal(audit.compareScope,'file-metadata-only-not-controlled-model-quality');
 const before=(await (await req(core,root+'/budget')).json()).used;
 await req(core,root+'/technical-audit?channel=wechat');
 await req(core,root+'/technical-audit?channel=zhihu');
 assert.equal((await (await req(core,root+'/budget')).json()).used,before);
 assert.equal(calls,2,'offline checks must not create new paid model requests');
 assert.equal(audit.deliveryReadyForManualQA,false);
 assert.ok(audit.shots[0].issues.includes('not_approved'));
 assert.match(audit.shots[0].variants[0].previewUrl,/^\/api\/assets\/as_/);
 assert.equal(audit.projectId,project.id);
});
test('Markdown handoff escapes parentheses in HTTPS image URLs and alt bracket control chars',async t=>{
 const {core,root,plan}=await setup(t);
 const shot=plan.shots[0];
 core.illustrations.generator=async()=>({base64:png(1536,864).toString('base64'),model:'mock',provider:'openai'});
 const generated=await (await req(core,root+'/shots/'+shot.id+'/generate','POST',{allowExternalAI:true})).json();
 assert.equal((await req(core,root+'/shots/'+shot.id+'/decision','POST',{decision:'approve'})).status,200);
 core.store.db.prepare('UPDATE article_illustration_shots SET alt=? WHERE id=?').run('配图 [不能] 打断 \\ Markdown',shot.id);
 const link='https://cdn.example.org/figure(example).png';
 assert.equal((await req(core,'/api/assets/'+generated.assetId+'/mappings/wechat','PUT',
  {url:link,note:'作者上传到微信公众号素材库时记录的链接'})).status,200);
 const handoff=await (await req(core,root+'/handoff/wechat')).json();
 assert.equal(handoff.ready,true);
 assert.match(handoff.markdown,/figure%28example%29\.png/);
 assert.ok(!handoff.markdown.includes('![配图 [不能]'));
 assert.ok(handoff.markdown.includes('![配图 不能  打断   Markdown]('));
 const qa=await (await req(core,root+'/handoff-qa/wechat')).json();
 const technical=await (await req(core,root+'/technical-audit?channel=wechat')).json();
 assert.equal(qa.proposalSha256,technical.deliveryProposalSha256);
 assert.equal(technical.shots[0].variants[0].checks.issues.length,0);
});

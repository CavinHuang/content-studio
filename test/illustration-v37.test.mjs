import test from 'node:test';
import assert from 'node:assert/strict';
import {createCore} from '../lib/core.mjs';
import {dispatchApi} from '../lib/api.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';
const other=Buffer.concat([Buffer.from(png,'base64'),Buffer.from([17,18,19])]).toString('base64');
const req=(c,path,method='GET',data)=>dispatchApi(new Request('http://localhost:4312'+path,{method,headers:data?{'content-type':'application/json'}:{},body:data?JSON.stringify(data):undefined}),c);
const json=async(c,path,method='GET',data)=>{const r=await req(c,path,method,data);return {status:r.status,value:await r.json()}};
const profile={name:'Editorial Series',palette:'warm ivory and forest green',mood:'quiet and professional',avoid:'logos and invented diagrams'};
async function setup(t){
 const c=createCore(':memory:');t.after(()=>c.close());
 const project=async title=>(await json(c,'/api/editor/projects','POST',{title,paragraphs:[{text:'本文章专注于桌面 Agent 的工具交互、实际反馈与可靠性问题，并给出真实的技术分析。'}]})).value;
 const p=await project('Source article'),q=await project('Second article'),outsider=await project('Unrelated private article');
 const s=(await json(c,'/api/illustrations/series','POST',{name:'Research graphics',profile})).value;
 const path='/api/illustrations/series/'+s.id;
 return {c,p,q,outsider,s,path,project};
}
async function planAndApprove(c,project,base64=png){
 const root='/api/illustrations/projects/'+project.id;
 const plan=(await json(c,root+'/plan','POST',{expectedMasterRevision:1})).value;
 const shot=plan.shots[0];
 c.illustrations.generator=async()=>({base64,provider:'openai',model:'mock'});
 const generated=await req(c,root+'/shots/'+shot.id+'/generate','POST',{allowExternalAI:true});
 assert.equal(generated.status,200);
 const decided=await json(c,root+'/shots/'+shot.id+'/decision','POST',{decision:'approve'});
 assert.equal(decided.status,200);
 return decided.value;
}

test('V37 series requires explicit membership, immutable profile versions and optimistic concurrency',async t=>{
 const x=await setup(t);
 assert.equal((await req(x.c,x.path+'?projectId='+x.p.id)).status,403);
 const listed=(await json(x.c,'/api/illustrations/series')).value.series;assert.equal(listed.length,1);assert.equal(listed[0].members,0);
 assert.equal((await req(x.c,x.path+'/members','POST',{projectId:x.p.id,expectedRevision:999})).status,409);
 assert.equal((await req(x.c,x.path+'/members','POST',{projectId:x.p.id,expectedRevision:1})).status,200);
 const updated=await json(x.c,x.path,'PUT',{expectedRevision:1,profile:{...profile,palette:'soft neutral ochre'},name:'New Name'});
 assert.equal(updated.status,200);assert.equal(updated.value.revision,2);
 assert.equal((await req(x.c,x.path,'PUT',{expectedRevision:1,profile,name:'Old Name'})).status,409);
 const detail=(await json(x.c,x.path+'?projectId='+x.p.id)).value;
 assert.deepEqual(detail.versions.map(v=>v.revision),[2,1]);assert.equal(detail.profile.palette,'soft neutral ochre');
 assert.equal((await req(x.c,x.path+'/members','POST',{projectId:x.p.id,expectedRevision:2})).status,409);
});

test('V37 reference images only come from fresh approved shots with explicit sharing',async t=>{
 const x=await setup(t);
 await req(x.c,x.path+'/members','POST',{projectId:x.p.id,expectedRevision:1});
 const planned=(await json(x.c,'/api/illustrations/projects/'+x.p.id+'/plan','POST',{expectedMasterRevision:1})).value.shots[0];
 const entry={projectId:x.p.id,shotId:planned.id,caption:'Muted green diagonal composition with large ivory margins',expectedRevision:1};
 assert.equal((await req(x.c,x.path+'/references','POST',entry)).status,409);
 const shot=await planAndApprove(x.c,x.p);
 const ref=await json(x.c,x.path+'/references','POST',{...entry,shotId:shot.id});
 assert.equal(ref.status,201);assert.equal(ref.value.references.length,1);
 assert.equal((await req(x.c,x.path+'/references','POST',{...entry,shotId:shot.id})).status,409);
 assert.equal((await req(x.c,x.path+'?projectId='+x.q.id)).status,403);
 assert.equal((await json(x.c,'/api/illustrations/projects/'+x.q.id)).value.visualSeries,null);
 assert.match(x.c.illustrations._memoryPrompt(x.p.id),/Muted green diagonal/);
 assert.doesNotMatch(x.c.illustrations._memoryPrompt(x.q.id),/Muted green diagonal/);
});

test('V37 only explicit same-series members can use shared reference image for editing',async t=>{
 const x=await setup(t);await req(x.c,x.path+'/members','POST',{projectId:x.p.id,expectedRevision:1});
 const shot=await planAndApprove(x.c,x.p,png);
 await req(x.c,x.path+'/references','POST',{projectId:x.p.id,shotId:shot.id,caption:'Approved ivory background with minimal center form',expectedRevision:1});
 const target=await planAndApprove(x.c,x.q,other);
 const root='/api/illustrations/projects/'+x.q.id;
 x.c.illustrations.editor=async()=>({base64:other,provider:'openai',model:'mock'});
 const edit={allowExternalAI:true,expectedUpdatedAt:target.updatedAt,referenceAssetId:shot.assetId,provider:'openai',instruction:'Keep reference focal point and produce a different quieter image'};
 assert.equal((await req(x.c,root+'/shots/'+target.id+'/candidates','POST',edit)).status,403);
 await req(x.c,x.path+'/members','POST',{projectId:x.q.id,expectedRevision:1});
 const permitted=await json(x.c,root+'/shots/'+target.id+'/candidates','POST',edit);
 assert.equal(permitted.status,201);assert.equal(permitted.value.candidate.referenceAssetId,shot.assetId);
 const third=await planAndApprove(x.c,x.outsider,other);
 assert.equal((await req(x.c,'/api/illustrations/projects/'+x.outsider.id+'/shots/'+third.id+'/candidates','POST',{...edit,expectedUpdatedAt:third.updatedAt})).status,403);
});

test('V37 leaving series revokes only departing article references and membership',async t=>{
 const x=await setup(t);
 for(const projectId of [x.p.id,x.q.id])assert.equal((await req(x.c,x.path+'/members','POST',{projectId,expectedRevision:1})).status,200);
 const shot=await planAndApprove(x.c,x.p);
 const added=(await json(x.c,x.path+'/references','POST',{projectId:x.p.id,shotId:shot.id,caption:'A restrained green concept with generous whitespace',expectedRevision:1})).value;
 const ref=added.references[0];
 assert.equal((await req(x.c,x.path+'/references/'+ref.id,'DELETE',{projectId:x.q.id})).status,403);
 assert.equal((await req(x.c,x.path+'/members/leave','POST',{projectId:x.p.id})).status,200);
 const detail=(await json(x.c,x.path+'?projectId='+x.q.id)).value;
 assert.equal(detail.references.length,0);assert.equal(detail.members,1);
 assert.equal((await req(x.c,x.path+'?projectId='+x.p.id)).status,403);
 assert.equal((await req(x.c,x.path+'/references','POST',{projectId:x.p.id,shotId:shot.id,caption:'A new cross-series reference example',expectedRevision:1})).status,403);
});

test('V37 changing series while external generation runs rejects stale image',async t=>{
 const x=await setup(t);await req(x.c,x.path+'/members','POST',{projectId:x.p.id,expectedRevision:1});
 const plan=(await json(x.c,'/api/illustrations/projects/'+x.p.id+'/plan','POST',{expectedMasterRevision:1})).value;
 const shotId=plan.shots[0].id;
 x.c.illustrations.generator=async()=>{
  x.c.series.update(x.s.id,{expectedRevision:1,profile:{...profile,mood:'more restrained and airy'}});
  return {base64:png,provider:'openai',model:'mock'};
 };
 const result=await req(x.c,'/api/illustrations/projects/'+x.p.id+'/shots/'+shotId+'/generate','POST',{allowExternalAI:true});
 assert.equal(result.status,409);
 const state=(await json(x.c,'/api/illustrations/projects/'+x.p.id)).value;
 assert.equal(state.shots[0].assetId,null);assert.equal(state.shots[0].status,'failed');
});

test('V37 validates series profile fields, reference captions and cross-series membership',async t=>{
 const x=await setup(t);
 assert.equal((await req(x.c,'/api/illustrations/series','POST',{name:'X',profile})).status,400);
 assert.equal((await req(x.c,'/api/illustrations/series','POST',{name:'Nice name',profile:{name:'Invalid'}})).status,400);
 await req(x.c,x.path+'/members','POST',{projectId:x.p.id,expectedRevision:1});
 const another=(await json(x.c,'/api/illustrations/series','POST',{name:'Another Design System',profile})).value;
 assert.equal((await req(x.c,'/api/illustrations/series/'+another.id+'/members','POST',{projectId:x.p.id,expectedRevision:1})).status,409);
 const shot=await planAndApprove(x.c,x.p);
 assert.equal((await req(x.c,x.path+'/references','POST',{projectId:x.p.id,shotId:shot.id,caption:'too short',expectedRevision:1})).status,400);
 assert.equal((await req(x.c,'/api/illustrations/series/'+another.id+'?projectId='+x.p.id)).status,403);
});

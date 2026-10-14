import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
 V59_TARGET,parseV59Args,assessGithubEvidence,assessOperatorPacket,
 requestGithubJson,readOperatorPacket,collectV59Evidence
} from '../scripts/remote-release-evidence-v59.mjs';

const sha='a'.repeat(40);
function fakeGithub(){
 const repo={full_name:V59_TARGET.repository};
 const run=(event,id,created_at)=>({event,id,created_at,path:V59_TARGET.workflow,
  status:'completed',conclusion:'success',head_sha:sha,head_branch:V59_TARGET.branch,
  head_repository:repo,pull_requests:[{number:26}]});
 return {
  pr:{number:26,state:'open',draft:true,merged:false,
   base:{ref:'main',repo},head:{ref:V59_TARGET.branch,repo,sha}},
  branch:{name:V59_TARGET.branch,commit:{sha}},
  main:{name:'main',commit:{sha:V59_TARGET.mainSha}},
  runs:{workflow_runs:[run('push',11,'2026-10-14T05:00:00Z'),run('pull_request',12,'2026-10-14T05:00:01Z')]}
 };
}
function packet(){return {
 kind:'content-studio-v55-operator-release-evidence',candidateCommit:sha,
 mainCommit:V59_TARGET.mainSha,packetComplete:true,localEvidenceComplete:true,blockers:[],
 local:{originalDatabaseUnchanged:true,backupContentMatchesDatabase:true,
  backupManifest:'passed',restoredUpgrade:'passed',restoredIntegration:'passed'},
 manualReview:{recorded:true},mergeAuthorized:false,deployAuthorized:false,productionReady:false
};}
function fakeRequest(data,visited=[]){
 return async (url,options)=>{
  visited.push({url,options:{...options,headers:{...options.headers,authorization:'[REDACTED]'}}});
  const path=new URL(url).pathname;
  const body=path.endsWith('/pulls/26')?data.pr:
   path.endsWith('/branches/main')?data.main:
   path.includes('/branches/')?data.branch:data.runs;
  return {ok:true,status:200,json:async()=>body};
 };
}
test('V59 strict SHA and absolute path CLI parsing',()=>{
 assert.deepEqual(parseV59Args(['--sha='+sha]),{sha});
 for(const args of [[],['--sha=HEAD'],['--sha='+sha,'--sha='+sha],['--sha='+sha,'--operator-evidence=relative.json'],['--sha='+sha,'--token=secret']])
  assert.throws(()=>parseV59Args(args));
});
test('V59 real-shaped GitHub PR, both CI events and main anchor are consistent',()=>{
 const result=assessGithubEvidence(fakeGithub(),sha);
 assert.equal(result.githubCheckPassed,true);
 assert.deepEqual(result.blockers,[]);
 assert.equal(result.checks.push.verified,true);
 assert.equal(result.checks.pull_request.verified,true);
 assert.equal(result.mergeAuthorized,false);
});
test('V59 branch/head/main tampering refuses stale CI and unreviewed main',()=>{
 for(const change of [
  x=>x.pr.head.sha='b'.repeat(40),x=>x.branch.commit.sha='b'.repeat(40),
  x=>x.main.commit.sha='b'.repeat(40),x=>x.pr.base.ref='release',
  x=>x.pr.draft=false,x=>x.pr.state='closed',x=>x.pr.head.repo.full_name='stranger/fork'
 ]){
  const x=fakeGithub();change(x);
  assert.equal(assessGithubEvidence(x,sha).githubCheckPassed,false);
 }
});
test('V59 latest failed/cancelled CI cannot be hidden by earlier green',()=>{
 for(const status of [{status:'completed',conclusion:'failure'},{status:'in_progress',conclusion:null}]){
  const x=fakeGithub();x.runs.workflow_runs.push({
   ...x.runs.workflow_runs[0],id:1000,created_at:'2026-10-14T06:00:00Z',...status});
  assert.equal(assessGithubEvidence(x,sha).githubCheckPassed,false);
 }
});
test('V59 rejects wrong event, workflow, repo, SHA or unrelated PR approval',()=>{
 for(const change of [
  x=>x.runs.workflow_runs[0].head_sha='b'.repeat(40),
  x=>x.runs.workflow_runs[0].path='.github/workflows/evil.yml',
  x=>x.runs.workflow_runs[0].head_repository.full_name='stranger/other',
  x=>x.runs.workflow_runs[1].pull_requests=[{number:9}],
  x=>x.runs.workflow_runs[1].event='workflow_dispatch',
  x=>x.runs={workflow_runs:'not-array'}
 ]){
  const x=fakeGithub();change(x);
  assert.equal(assessGithubEvidence(x,sha).githubCheckPassed,false);
 }
});
test('V59 complete V55 local evidence remains self-reported and never merge approval',()=>{
 const p=assessOperatorPacket(packet(),sha);
 assert.equal(p.localOperatorEvidenceRecorded,true);
 for(const change of [
  x=>x.candidateCommit='b'.repeat(40),x=>x.mainCommit='b'.repeat(40),
  x=>x.local.backupContentMatchesDatabase=false,x=>x.manualReview.recorded=false,
  x=>x.blockers=['tampered'],x=>x.packetComplete=false,x=>x.mergeAuthorized=true
 ]){
  const x=packet();change(x);
  assert.equal(assessOperatorPacket(x,sha).localOperatorEvidenceRecorded,false);
 }
 assert.equal(assessOperatorPacket(null,sha).localOperatorEvidenceRecorded,false);
});
test('V59 validates operator evidence file type/length and symlinks',t=>{
 const dir=mkdtempSync(join(tmpdir(),'v59-file-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const normal=join(dir,'packet.json');writeFileSync(normal,JSON.stringify(packet()));
 assert.equal(readOperatorPacket(normal).candidateCommit,sha);
 const link=join(dir,'link.json');symlinkSync(normal,link);
 assert.throws(()=>readOperatorPacket(link));
 const large=join(dir,'large.json');writeFileSync(large,'x'.repeat(16385));
 assert.throws(()=>readOperatorPacket(large));
});
test('V59 does not let arbitrary hosts/paths receive GitHub token',async()=>{
 const paths=['https://evil.test/repos/CavinHuang/content-studio/pulls/26',
  '/repos/evil/other/pulls/26','/repos/CavinHuang/content-studio/pulls/20',
  '/repos/CavinHuang/content-studio/actions/runs?head_sha=bad&per_page=100'];
 for(const path of paths)await assert.rejects(()=>requestGithubJson(path,{request:()=>{throw Error('request attempted')}}));
});
test('V59 HTTPS read-only calls, fixed host and redacted output',async()=>{
 const hits=[],data=fakeGithub();const request=fakeRequest(data,hits);
 const actual=await collectV59Evidence({sha,'operator-evidence':'/non-existent/private.json'},
  {request,token:'SENSITIVE-V59-TOKEN',readPacket:()=>packet()});
 assert.equal(actual.githubCI.githubCheckPassed,true);
 assert.equal(actual.githubCI.githubApiWasQueried,true);
 assert.equal(actual.operatorPacket.recorded,true);
 assert.equal(actual.technicalEvidenceComplete,true);
 assert.equal(actual.releaseAuthorized,false);
 assert.equal(actual.productionReady,false);
 assert.equal(actual.mergeAuthorized,false);
 assert.equal(actual.deployAuthorized,false);
 assert.ok(actual.blockers.includes('external_deployment_inventory_unverified'));
 assert.ok(actual.blockers.includes('explicit_release_approval_missing'));
 assert.equal(hits.length,4);
 assert.ok(hits.every(h=>h.url.startsWith('https://api.github.com/repos/CavinHuang/content-studio/')&&h.options.method==='GET'&&h.options.redirect==='error'));
 assert.ok(!JSON.stringify(actual).includes('SENSITIVE-V59-TOKEN'));
 assert.ok(!JSON.stringify(actual).includes('/non-existent/private.json'));
});
test('V59 absent operator packet cannot count as technical evidence',async()=>{
 const r=await collectV59Evidence({sha},{request:fakeRequest(fakeGithub()),token:''});
 assert.equal(r.githubCI.githubCheckPassed,true);
 assert.equal(r.technicalEvidenceComplete,false);
 assert.equal(r.operatorPacket.recorded,false);
 assert.ok(r.blockers.includes('operator_packet_not_supplied'));
});
test('V59 network failure and GitHub non-2xx fail closed without token in error',async()=>{
 await assert.rejects(()=>collectV59Evidence({sha},{request:()=>{throw Error('token-SUPERPRIVATE')},token:'token-SUPERPRIVATE'}),
  e=>!e.message.includes('SUPERPRIVATE'));
 await assert.rejects(()=>requestGithubJson('/repos/CavinHuang/content-studio/pulls/26',{
  request:async()=>({ok:false,status:403}),token:'SUPERPRIVATE'}),
  e=>!e.message.includes('SUPERPRIVATE'));
});

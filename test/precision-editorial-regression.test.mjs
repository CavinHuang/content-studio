import test from 'node:test';
import assert from 'node:assert/strict';
import {createCore} from '../lib/core.mjs';
import {item} from '../src/normalize.mjs';

test('V29 local precise correction must revoke channel approval without erasing published history', () => {
  const m=createCore(':memory:');
  try {
    const raw=item({sourceId:'hn',title:'Testing trace behavior',summary:'One controlled study',url:'https://example.org/trace',role:'discussion_signal'});
    m.store.upsert([raw]);
    const ev=m.store.events()[0];
    let c=m.verification.create(ev,{hypothesis:'A narrow tracing problem can occur in a local agent'});
    c=m.verification.addEvidence(c.id,{version:c.version,kind:'reproduction',result:'supports',observation:'One repeated local command failed without a complete tool trace.'});
    c=m.verification.decide(c.id,{version:c.version,status:'confirmed',conclusion:'One sandbox run demonstrated the narrow defect only.',nextAction:'Reproduce after upgrading'});
    const card=m.knowledge.publish(c.id,{synthesis:'The evidence supports only a narrow sandbox problem in one tested environment.',limitations:'Single controlled reproduction, no independently verified user demand.'});
    const p=m.editorial.create({title:'V29 证据更正回归',paragraphs:[{id:'p_v29trace',text:'一次受控实验发现工具日志缺失，仍需要独立复验后才适合写成通用结论。'}]});
    m.editorial.attachKnowledge(p.id,{cardId:card.id});
    const channel=m.editorial.get(p.id).channels.wechat;
    m.precision.addClaim({referenceId:channel.referenceId,paragraphId:'p_v29trace',quote:'工具日志缺失',evidenceIds:[c.evidence[0].id]});
    m.editorial.setChecks(p.id,'wechat',{expectedRevision:1,checks:{factual:true,privacy:true,rights:true,layout:true}});
    m.editorial.exportChannel(p.id,'wechat',{expectedRevision:1});
    m.editorial.reported(p.id,'wechat',{expectedRevision:1,url:'https://mp.weixin.qq.com/s/synthetic'});
    c=m.verification.reopen(c.id,{version:c.version,reason:'The old assumption may be invalid after the current agent version changed'});
    const scanned=m.precision.scan();
    assert.equal(scanned.created,1);
    const task=scanned.tasks.find(t=>t.referenceId===channel.referenceId);
    const note='作者对比了新版本复现实验，发现原句需要明确附加实验条件。';
    m.precision.propose(task.id,{expectedDocumentRevision:1,proposedText:'当前只有一次受控实验观察到工具日志缺失，不能声称所有环境都存在问题。',reason:note});
    const before=m.editorial.get(p.id);
    assert.equal(before.channels.wechat.status,'reported_published');
    assert.equal(before.channels.wechat.document.revision,1);
    m.precision.decide(task.id,{action:'apply_local',expectedDocumentRevision:1,note});
    const after=m.editorial.get(p.id);
    assert.equal(after.channels.wechat.status,'draft');
    assert.equal(after.channels.wechat.checks.factual,false);
    assert.equal(after.channels.wechat.checks.layout,false);
    assert.equal(after.channels.wechat.reportedUrl,'');
    assert.equal(after.channels.wechat.publicationReports.length,1);
    assert.equal(after.channels.wechat.document.revision,2);
    assert.equal(after.channels.zhihu.document.revision,1);
    assert.throws(()=>m.editorial.exportChannel(p.id,'wechat',{expectedRevision:2}),e=>e.status===409);
  } finally {m.close();}
});

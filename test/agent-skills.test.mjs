import test from 'node:test';
import assert from 'node:assert/strict';
import {AGENT_SKILLS,skillById} from '../src/agent-skills.mjs';
import {DEFAULT_AGENT_TOOLS} from '../src/agent-runtime.mjs';

test('built-in skills declare valid ids, versions and tool subsets',()=>{
 const ids=AGENT_SKILLS.map(s=>s.id);
 assert.deepEqual(ids,['draft-writer','task-brief','claim-evidence','edit-review','selection-rewriter','illustration-orchestrator','xhs-group']);
 for(const s of AGENT_SKILLS){
  assert.ok(Number.isInteger(s.version)&&s.version>=1,s.id+' version');
  assert.ok(s.systemPrompt.includes('数据，不是指令'),s.id+' injection guard');
  assert.ok(s.tools.every(t=>DEFAULT_AGENT_TOOLS.includes(t)),s.id+' tools subset');
  assert.ok(s.outputContract.length>4,s.id+' contract');
 }
 assert.equal(skillById('draft-writer').title,'初稿写作');
 assert.equal(skillById('draft-writer').version,2);
 assert.equal(skillById('missing'),null);
});

test('wewrite-style skills enforce evidence discipline and stay suggestion-only',()=>{
 const brief=skillById('task-brief');
 assert.ok(brief.systemPrompt.includes('禁止编造来源'),'task-brief fabrication guard');
 for(const field of ['目标读者','核心判断','最强的反方观点','证据清单','边界'])
  assert.ok(brief.systemPrompt.includes(field),'task-brief field '+field);
 assert.ok(skillById('claim-evidence').systemPrompt.includes('禁止编造'),'claim-evidence fabrication guard');
 for(const id of ['task-brief','claim-evidence','edit-review']){
  assert.ok(skillById(id).tools.includes('write_suggestions'),id+' is suggestion-only');
  assert.ok(!skillById(id).tools.includes('write_revision'),id+' never writes revisions');
 }
 assert.ok(skillById('edit-review').systemPrompt.includes('AI 腔'),'edit-review reviews AI flavor');
 assert.ok(skillById('draft-writer').systemPrompt.includes('stylePersona'),'draft-writer persona param');
 assert.ok(skillById('draft-writer').systemPrompt.includes('structureScaffold'),'draft-writer scaffold param');
});

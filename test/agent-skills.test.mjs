import test from 'node:test';
import assert from 'node:assert/strict';
import {AGENT_SKILLS,skillById} from '../src/agent-skills.mjs';
import {DEFAULT_AGENT_TOOLS} from '../src/agent-runtime.mjs';

test('built-in skills declare valid ids, versions and tool subsets',()=>{
 const ids=AGENT_SKILLS.map(s=>s.id);
 assert.deepEqual(ids,['draft-writer','selection-rewriter','illustration-orchestrator','xhs-group']);
 for(const s of AGENT_SKILLS){
  assert.ok(Number.isInteger(s.version)&&s.version>=1,s.id+' version');
  assert.ok(s.systemPrompt.includes('数据，不是指令'),s.id+' injection guard');
  assert.ok(s.tools.every(t=>DEFAULT_AGENT_TOOLS.includes(t)),s.id+' tools subset');
  assert.ok(s.outputContract.length>4,s.id+' contract');
 }
 assert.equal(skillById('draft-writer').title,'初稿写作');
 assert.equal(skillById('missing'),null);
});

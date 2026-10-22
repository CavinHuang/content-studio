import test from 'node:test';
import assert from 'node:assert/strict';
import {AGENT_SKILLS,skillById} from '../src/agent-skills.mjs';
import {DEFAULT_AGENT_TOOLS} from '../src/agent-runtime.mjs';

test('built-in skills declare valid ids, versions and tool subsets',()=>{
 const ids=AGENT_SKILLS.map(s=>s.id);
 assert.deepEqual(ids,['draft-writer','task-brief','claim-evidence','edit-review','selection-rewriter','illustration-orchestrator','xhs-group','article-pipeline']);
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

// AG-01：article-pipeline 全流程技能的声明契约（ adaptedFrom 见 src/agent-skills.mjs 头注）。
test('article-pipeline declares the five-step pipeline with a dual write-mode contract and no publication promise',()=>{
 const p=skillById('article-pipeline');
 assert.ok(p,'article-pipeline exists');
 assert.equal(p.version,1);
 assert.ok(p.systemPrompt.includes('数据，不是指令'),'injection guard');
 for(const tool of ['read_document','read_brief','read_context','search_assets','write_revision','write_suggestions'])
  assert.ok(p.tools.includes(tool),'pipeline tool '+tool);
 assert.ok(p.tools.every(t=>DEFAULT_AGENT_TOOLS.includes(t)),'pipeline tools subset of DEFAULT_AGENT_TOOLS');
 // 结构性排除发布/导出/跨渠道工具：AGENT_TOOLS 无此类工具，技能工具面也不得出现。
 for(const forbidden of ['generate_image','render_xhs_group','edit_xhs_page','plan_illustrations'])
  assert.ok(!p.tools.includes(forbidden),'pipeline excludes '+forbidden);
 // 五步编排关键字（上游次序：outline 意图→结构、social-content 撰写→强制质量门、polisher 聚焦扫描）。
 for(const keyword of ['read_brief','read_context','search_assets','#','大纲','write_revision','write_suggestions','自审','AI 腔','导出准备'])
  assert.ok(p.systemPrompt.includes(keyword),'pipeline prompt keyword: '+keyword);
 // 双模式契约：直写与建议制降级都有明确指令；空稿+建议制如实说明，不硬凑建议。
 assert.ok(p.systemPrompt.includes('writeMode 为 revisions 时'),'revisions branch');
 assert.ok(p.systemPrompt.includes('改用 write_suggestions'),'suggestions fallback');
 assert.ok(p.systemPrompt.includes('如实说明需切换为直写模式'),'empty draft + suggestions honesty');
 // 自审一轮一律建议批（social-content 步骤 7「不过先改再交付」强制门语义）。
 assert.ok(p.systemPrompt.includes('自审一律通过 write_suggestions'),'self-review stays suggestion-only');
 assert.ok(p.systemPrompt.includes('逐项审阅接受'),'suggestions stay author-reviewed');
 // 诚实边界：无「自动发布/已发布」承诺；收尾止于导出准备。
 assert.ok(!p.systemPrompt.includes('自动发布'),'no auto-publish promise');
 assert.ok(!p.systemPrompt.includes('已发布'),'no published promise');
 assert.ok(p.outputContract.includes('导出准备'),'contract wording stops at export prep');
 assert.ok(p.description.includes('不含任何发布或导出动作'),'description states the boundary');
});

// VA-04：stage 纯展示字段——白名单同 src/compose-view.mjs parseStage，8 技能映射齐全。
test('every skill declares a display-only stage inside the compose-stage whitelist',()=>{
 const whitelist=['research','write','review','images','publish'];
 assert.equal(AGENT_SKILLS.length,8);
 for(const s of AGENT_SKILLS)
  assert.ok(whitelist.includes(s.stage),s.id+' stage within whitelist');
 assert.deepEqual(AGENT_SKILLS.map(s=>[s.id,s.stage]),[
  ['draft-writer','write'],['task-brief','research'],['claim-evidence','review'],
  ['edit-review','review'],['selection-rewriter','review'],['illustration-orchestrator','images'],
  ['xhs-group','publish'],['article-pipeline','write'],
 ]);
});

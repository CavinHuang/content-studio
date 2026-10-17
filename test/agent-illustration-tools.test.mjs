import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCore } from '../lib/core.mjs';
import { AGENT_TOOLS } from '../src/agent-tools.mjs';
import { ValidationError } from '../src/verification.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/gHcAAAAASUVORK5CYII=';

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'agent-illustration-')), file = join(root, 'test.sqlite');
  const core = createCore(file);
  t.after(() => { core.close(); rmSync(root, { recursive: true, force: true }); });
  return core;
}

// 写作模型环境变量，模式与 test/agent-runtime.test.mjs 的 provider(t) 相同。
// 故意不配置 CONTENT_ILLUSTRATION_PLANNER_*：plan_illustrations 必须走本地模板方案。
function provider(t) {
  const names = ['CONTENT_AI_BASE_URL', 'CONTENT_AI_MODEL', 'CONTENT_AI_API_KEY'], old = names.map(n => process.env[n]);
  t.after(() => names.forEach((n, i) => { if (old[i] === undefined) delete process.env[n]; else process.env[n] = old[i]; }));
  process.env.CONTENT_AI_BASE_URL = 'https://writing.example/v1/';
  process.env.CONTENT_AI_MODEL = 'synthetic-writing-model';
  process.env.CONTENT_AI_API_KEY = 'synthetic-test-key';
}

// 图片供应商 stub，模式与 test/image-request-budget-v38.test.mjs /
// test/illustration-agent-v33.test.mjs 相同：CONTENT_IMAGE_OPENAI_* 指向合成端点，
// fetch 层回包 1×1 PNG base64（成功）或非 2xx（失败）。
function imageProvider(t, respond) {
  const names = ['CONTENT_IMAGE_OPENAI_API_KEY', 'CONTENT_IMAGE_OPENAI_MODEL', 'CONTENT_IMAGE_OPENAI_BASE_URL'];
  const old = names.map(n => process.env[n]);
  t.after(() => names.forEach((n, i) => { if (old[i] === undefined) delete process.env[n]; else process.env[n] = old[i]; }));
  process.env.CONTENT_IMAGE_OPENAI_API_KEY = 'synthetic-image-key';
  process.env.CONTENT_IMAGE_OPENAI_MODEL = 'gpt-image-2';
  process.env.CONTENT_IMAGE_OPENAI_BASE_URL = 'https://api.openai.com/v1/';
  const previous = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, options) => { calls++; return respond(new URL(String(url)), options); };
  t.after(() => { globalThis.fetch = previous; });
  return { calls: () => calls };
}

async function article(t, core) {
  const doc = core.writing.create({ title: '配图编排' });
  const saved = core.writing.save(doc.projectId, 'master', { expectedRevision: doc.revision,
    markdown: '# 配图编排\n\n第一段正文内容足够长，讨论配图计划与图片生成的完整链路。\n\n第二段正文内容同样足够长，讨论失败如何如实反馈给代理运行。\n\n第三段正文继续足够长，讨论用量记账与请求预算的关系。\n' });
  return { projectId: doc.projectId, revision: saved.revision };
}

const ctx = (projectId, revision) => ({ projectId, channel: 'master', runId: 'ar_img', skillTitle: '配图编排',
  expectedRevision: () => revision, onWritten: () => {} });

test('plan_illustrations builds the local template plan and generate_image bills one image request', async t => {
  provider(t);
  const core = setup(t);
  const image = imageProvider(t, (url, options) => {
    assert.equal(url.pathname, '/v1/images/generations');
    assert.match(String(options.headers.authorization), /^Bearer synthetic-image-key$/);
    assert.equal(JSON.parse(options.body).model, 'gpt-image-2');
    return Response.json({ data: [{ b64_json: png }] });
  });
  const { projectId, revision } = await article(t, core);
  const context = ctx(projectId, revision);
  const plan = await AGENT_TOOLS.plan_illustrations.execute(core, context, {});
  assert.ok(plan.plan, 'template plan is created without any planning model');
  assert.equal(plan.plan.masterRevision, revision);
  assert.equal(plan.stale, false);
  assert.equal(plan.plannerConfigured, false, 'the template path never needs a planning model');
  assert.equal(plan.requiresConsent, true, 'author consent is still required before real generation');
  assert.ok(plan.shots.length >= 1);
  assert.ok(plan.shots.every(s => s.status === 'planned'));
  const shot = plan.shots[0];
  assert.equal(shot.role, 'cover');
  // 生产一致性：dispatchApi 把每个请求包在 services.using 里（lib/api.mjs），
  // 因此运行期触发的图片请求会以 service_usage kind "image" 计入用量。
  const result = await core.services.using(() =>
    AGENT_TOOLS.generate_image.execute(core, context, { shotId: shot.id, provider: 'openai' }));
  assert.equal(result.status, 'generated');
  assert.ok(result.assetId);
  assert.equal(result.asset.mime, 'image/png');
  assert.equal(result.provider, 'openai');
  assert.equal(result.model, 'gpt-image-2');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].result, 'success');
  assert.equal(image.calls(), 1);
  const usage = core.services.usage();
  const row = usage.today.find(r => r.kind === 'image');
  assert.ok(row, 'run-level authorization produced an image-kind service usage record');
  assert.equal(row.state, 'completed');
  assert.equal(row.requests, 1);
  assert.ok(usage.recent.find(r => r.kind === 'image' && r.state === 'completed'));
  const budget = core.illustrations.requestBudget(projectId);
  assert.equal(budget.used, 1, 'the per-shot UTC image request budget is charged too');
  assert.equal(budget.recent[0].kind, 'generate');
  assert.equal(budget.recent[0].status, 'success');
});

test('a failing image provider surfaces a non-409 tool error and marks the shot failed', async t => {
  provider(t);
  const core = setup(t);
  imageProvider(t, () => new Response(JSON.stringify({ error: { message: 'synthetic upstream outage' } }),
    { status: 500, headers: { 'content-type': 'application/json' } }));
  const { projectId, revision } = await article(t, core);
  const context = ctx(projectId, revision);
  const plan = await AGENT_TOOLS.plan_illustrations.execute(core, context, {});
  const shot = plan.shots[0];
  const outcome = await core.services.using(() =>
    AGENT_TOOLS.generate_image.execute(core, context, { shotId: shot.id, provider: 'openai' })
  ).then(() => { throw new Error('generate_image must not succeed against a failing provider'); }, e => e);
  assert.ok(outcome instanceof ValidationError);
  assert.equal(outcome.status, 502, 'upstream 5xx is reported as a retryable provider failure');
  assert.notEqual(outcome.status, 409, 'the agent loop treats any non-409 tool error as {error} feedback and keeps running');
  const failed = core.illustrations.get(projectId).shots.find(s => s.id === shot.id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /HTTP 500/);
  assert.doesNotMatch(failed.error, /synthetic upstream outage/, 'provider response bodies never enter the shot record');
  const usage = core.services.usage();
  const imageRow = usage.today.find(r => r.kind === 'image');
  assert.ok(imageRow, 'image usage row should exist');
  assert.equal(imageRow.state, 'unknown', '5xx stays conservatively billed as unresolved');
  assert.equal(core.illustrations.requestBudget(projectId).recent[0].status, 'failed');
});

test('an agent run completes with a failed generate_image as honest tool feedback', async t => {
  provider(t);
  const core = setup(t);
  imageProvider(t, () => new Response(JSON.stringify({ error: { message: 'synthetic upstream outage' } }),
    { status: 500, headers: { 'content-type': 'application/json' } }));
  const { projectId, revision } = await article(t, core);
  const reply = (content, toolCalls) => new Response(JSON.stringify({ choices: [{
      finish_reason: toolCalls ? 'tool_calls' : 'stop',
      message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) } }] }),
    { headers: { 'content-type': 'application/json' } });
  let phase = 0;
  const fetchImpl = async () => {
    if (phase === 0) { phase = 1;
      return reply(null, [{ id: 'c1', type: 'function', function: { name: 'plan_illustrations', arguments: '{}' } }]); }
    if (phase === 1) { phase = 2;
      const shot = core.illustrations.get(projectId).shots[0];
      return reply(null, [{ id: 'c2', type: 'function', function: { name: 'generate_image',
        arguments: JSON.stringify({ shotId: shot.id, provider: 'openai' }) } }]); }
    return reply('图片生成失败已如实记录，本步骤不中断运行。');
  };
  const run = await core.agent.startRun(projectId, 'master', { skillId: 'illustration-orchestrator',
    instruction: '为文章规划并生成配图', expectedRevision: revision, allowExternalAI: true, fetchImpl });
  await core.agent.runSettled(run.id);
  const done = core.agent.run(projectId, run.id);
  assert.equal(done.status, 'completed', 'a failed image request must not halt or fail the run');
  const tools = done.steps.filter(s => s.kind === 'tool');
  assert.equal(tools[0].payload.name, 'plan_illustrations');
  assert.ok(tools[0].payload.outcome.result.shots.length >= 1);
  assert.equal(tools[1].payload.name, 'generate_image');
  assert.match(tools[1].payload.outcome.error, /HTTP 500/);
  const last = done.steps.at(-1);
  assert.equal(last.kind, 'model', 'the loop kept running after the tool error');
  assert.match(last.payload.content, /不中断运行/);
  assert.equal(core.illustrations.get(projectId).shots[0].status, 'failed');
});

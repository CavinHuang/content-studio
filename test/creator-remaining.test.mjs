import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createCore } from "../lib/core.mjs";
import { dispatchApi } from "../lib/api.mjs";
import {
  readWritingResponse,
  partialWritingText,
} from "../src/writing-stream.mjs";
import { publicRequestStream } from "../src/public-http.mjs";
const setup = (t) => {
  const c = createCore(":memory:");
  t.after(() => c.close());
  return c;
};
const conn = (c, name = "模型甲", model = "model-a") =>
  c.services.save({
    kind: "text",
    name,
    model,
    apiKey: "synthetic-key-" + model,
    baseUrl: "https://" + model + ".example/v1/",
  });
const article = (c) => {
  const d = c.writing.create({ title: "剩余计划的合成文章" });
  return c.writing.save(d.projectId, "master", {
    expectedRevision: d.revision,
    markdown: "开头🌲。\n\n中段观察。\n\n结尾建议。",
  });
};
const reply = (result) =>
  Response.json({
    choices: [
      { finish_reason: "stop", message: { content: JSON.stringify(result) } },
    ],
    usage: { total_tokens: 20 },
  });
const input = (d, extra = {}) => ({
  expectedRevision: d.revision,
  instruction: "请把表达写清楚",
  allowExternalAI: true,
  ...extra,
});
const event = (value) => "data: " + JSON.stringify(value) + "\r\n\r\n";
function wire(content, { done = true, finish = "stop" } = {}) {
  return (
    event({ choices: [{ delta: { content }, finish_reason: null }] }) +
    event({
      choices: [{ delta: {}, finish_reason: finish }],
      usage: { total_tokens: 42 },
    }) +
    (done ? "data: [DONE]\r\n\r\n" : "")
  );
}
function sse(text, split = 7) {
  const bytes = new TextEncoder().encode(text);
  let p = 0;
  return new Response(
    new ReadableStream({
      pull(c) {
        if (p >= bytes.length) {
          c.close();
          return;
        }
        c.enqueue(bytes.slice(p, (p += split)));
      },
    }),
    { headers: { "content-type": "text/event-stream" } }
  );
}
const parseEvents = async (response) =>
  (await response.text()).trim().split("\n").filter(Boolean).map(JSON.parse);
const api = (c, path, method = "GET", data) =>
  dispatchApi(
    new Request("http://127.0.0.1:4312" + path, {
      method,
      headers: data ? { "content-type": "application/json" } : {},
      ...(data ? { body: JSON.stringify(data) } : {}),
    }),
    c
  );

test("queued model binding survives default selection switches and has a task ledger", async (t) => {
  const c = setup(t),
    a = conn(c),
    series = c.creator.createSeries({
      name: "绑定模型的系列",
      goal: "只使用排队时的模型",
      backgroundAI: true,
    });
  const job = c.creator.enqueueSeries(series.id, "pinned");
  conn(c, "模型乙", "model-b");
  let called;
  c.services.publicTransport = async (url, options) => {
    called = { host: new URL(url).host, model: JSON.parse(options.body).model };
    return reply({
      outline: "## 绑定结果",
      angle: "固定来源",
      audience: "作者",
    });
  };
  await c.creator.runDue();
  assert.deepEqual(called, { host: "model-a.example", model: "model-a" });
  assert.equal(c.creator.job(job.id).status, "completed");
  assert.equal(c.creator.job(job.id).summary.service.id, a.id);
  assert.equal(
    c.store.db
      .prepare("SELECT COUNT(*) AS n FROM service_usage_tasks WHERE task_id=?")
      .get(job.id).n,
    1
  );
});
test("changed bound credentials block old jobs; reviewed rebind is explicit and creates a new attempt", async (t) => {
  const c = setup(t),
    a = conn(c),
    s = c.creator.createSeries({
      name: "重新绑定的系列",
      goal: "凭据变更后必须核对",
      backgroundAI: true,
    }),
    job = c.creator.enqueueSeries(s.id, "before-rotation");
  c.services.save({ ...a, apiKey: "rotated-synthetic-key", selected: true });
  let calls = 0;
  c.services.publicTransport = async () => {
    calls++;
    return reply({
      outline: "## 已重新授权",
      angle: "作者核对",
      audience: "作者",
    });
  };
  await c.creator.runDue();
  assert.equal(c.creator.job(job.id).status, "blocked");
  assert.equal(calls, 0);
  const reviewed = c.creator.reviewJob(job.id, {
    expectedStatus: "blocked",
    outcome: "retry",
    note: "已核对原任务，重新授权更新后的服务连接",
    allowExternalAI: true,
    rebindService: true,
  });
  await c.creator.runDue();
  assert.equal(c.creator.job(reviewed.retryJob.id).status, "completed");
  assert.equal(calls, 1);
});
test("task request cap cannot be refunded by fee reconciliation and does not cross author cores", async (t) => {
  const c = setup(t),
    other = setup(t);
  conn(c);
  conn(other);
  c.services.publicTransport = async () => new Response("", { status: 503 });
  const binding = c.services.captureBinding();
  await c.services
    .usingTask("task-limit", binding, 1, () =>
      c.services.chat("test", {}, { allowExternalAI: true })
    )
    .catch(() => {});
  const usage = c.services.usage().recent[0];
  c.services.settle(usage.id, { state: "failed" });
  await assert.rejects(
    () =>
      c.services.usingTask("task-limit", binding, 1, () =>
        c.services.chat("test", {}, { allowExternalAI: true })
      ),
    (e) => e.status === 429
  );
  assert.equal(other.services.usage().recent.length, 0);
  assert.throws(
    () => c.services.usingTask("task-limit", binding, 2, () => {}),
    (e) => e.status === 409
  );
});
test("one model batch yields separate edits that rebase safely after each acceptance", async (t) => {
  const c = setup(t);
  conn(c);
  const d = article(c),
    from = d.markdown.indexOf("中段"),
    to = d.markdown.indexOf("结尾");
  const result = {
    reason: "分别调整两处表达",
    edits: [
      {
        from: 0,
        to: 5,
        original: d.markdown.slice(0, 5),
        replacement: "更具体的开头🌲。",
      },
      { from, to: from + 5, replacement: "更具体的中段观察。" },
      { from: to, to: to + 5, replacement: "更克制的结尾建议。" },
    ],
  };
  c.services.publicTransport = async () => reply(result);
  const first = await c.services.using(() =>
    c.writing.suggest(d.projectId, "master", input(d))
  );
  assert.equal(first.suggestions.length, 3);
  const [a, b, z] = first.suggestions;
  let next = c.writing.decide(d.projectId, "master", b.id, {
    action: "accept",
    expectedRevision: d.revision,
  });
  let pending = c.writing.suggestions(d.projectId, "master");
  assert.equal(pending.find((s) => s.id === z.id).baseRevision, next.revision);
  assert.equal(
    pending.find((s) => s.id === z.id).originalBaseRevision,
    d.revision
  );
  next = c.writing.decide(d.projectId, "master", a.id, {
    action: "accept",
    expectedRevision: next.revision,
  });
  next = c.writing.decide(d.projectId, "master", z.id, {
    action: "accept",
    expectedRevision: next.revision,
  });
  assert.match(next.markdown, /具体的开头/);
  assert.match(next.markdown, /具体的中段/);
  assert.match(next.markdown, /克制的结尾/);
  assert.equal(
    c.writing
      .history(d.projectId, "master")
      .find((h) => h.revision === d.revision).markdown,
    d.markdown
  );
});
test("overlapping edits or broken Unicode boundaries save no partial batch; author edits still block old suggestions", async (t) => {
  const c = setup(t);
  conn(c);
  const d = article(c);
  c.services.publicTransport = async () =>
    reply({
      reason: "无效重叠",
      edits: [
        { from: 0, to: 6, replacement: "甲" },
        { from: 2, to: 7, replacement: "乙" },
      ],
    });
  await assert.rejects(
    () =>
      c.services.using(() =>
        c.writing.suggest(d.projectId, "master", input(d))
      ),
    (e) => e.status === 502
  );
  assert.equal(c.writing.suggestions(d.projectId, "master").length, 0);
  c.services.publicTransport = async () =>
    reply({ replacement: "新的全文建议。", reason: "等待审阅" });
  const s = await c.services.using(() =>
    c.writing.suggest(d.projectId, "master", input(d))
  );
  c.writing.save(d.projectId, "master", {
    expectedRevision: d.revision,
    markdown: d.markdown + "作者后来自己写的内容。",
  });
  assert.throws(
    () =>
      c.writing.decide(d.projectId, "master", s.id, {
        action: "accept",
        expectedRevision: d.revision + 1,
      }),
    (e) => e.status === 409
  );
});
test("SSE parsing preserves split UTF-8 and JSON escapes and refuses incomplete streams", async () => {
  const text = JSON.stringify({
      replacement: "含🌲的第一段。\n第二段。",
      reason: "完整回复",
    }),
    partials = [];
  const r = await readWritingResponse(sse(wire(text), 1), {
    onPartial: (p) => partials.push(p),
  });
  assert.equal(r.replacement, "含🌲的第一段。\n第二段。");
  assert.ok(partials.some((p) => p.includes("🌲")));
  assert.equal(
    partialWritingText('{"replacement":"第一行\\n\\u4e2d'),
    "第一行\n中"
  );
  await assert.rejects(
    () => readWritingResponse(sse(wire(text, { done: false }))),
    (e) => e.status === 502
  );
  await assert.rejects(
    () => readWritingResponse(sse(wire(text, { finish: "length" }))),
    (e) => e.status === 502
  );
});
test("generation streams visible partial text but writes only a validated suggestion, with request usage", async (t) => {
  const c = setup(t);
  conn(c);
  const d = article(c);
  c.services.publicStreamTransport = async () =>
    sse(
      wire(
        JSON.stringify({ replacement: "完整的新段落。", reason: "请作者审阅" })
      ),
      9
    );
  const events = await parseEvents(
    c.services.using(() =>
      c.writing.streamGeneration(d.projectId, "master", input(d))
    )
  );
  assert.equal(events[0].type, "started");
  assert.ok(events.some((e) => e.type === "delta"));
  const final = events.find((e) => e.type === "completed");
  assert.ok(final.result.id);
  assert.equal(c.writing.document(d.projectId, "master").markdown, d.markdown);
  assert.equal(
    c.writing.generations(d.projectId, "master")[0].status,
    "completed"
  );
  assert.equal(c.services.usage().recent[0].state, "completed");
  assert.equal(c.services.usage().recent[0].providerUsage.includes("42"), true);
});
test("truncated generation keeps a non-applicable partial and resume requires new consent and an unchanged source", async (t) => {
  const c = setup(t);
  conn(c);
  const d = article(c);
  c.services.publicStreamTransport = async () =>
    sse(wire('{"replacement":"保留中断片段', { done: false }));
  await parseEvents(
    c.services.using(() =>
      c.writing.streamGeneration(d.projectId, "master", input(d))
    )
  );
  const old = c.writing.generations(d.projectId, "master")[0];
  assert.equal(old.status, "failed");
  assert.match(old.partial, /中断片段/);
  assert.equal(c.writing.suggestions(d.projectId, "master").length, 0);
  assert.equal(c.services.usage().recent[0].state, "unknown");
  assert.throws(
    () =>
      c.services.using(() =>
        c.writing.streamGeneration(
          d.projectId,
          "master",
          input(d, { resumeOf: old.id, allowExternalAI: false })
        )
      ),
    (e) => e.status === 403
  );
  c.services.publicStreamTransport = async () =>
    sse(
      wire(
        JSON.stringify({
          replacement: "重新生成的完整结果。",
          reason: "新请求",
        })
      )
    );
  const events = await parseEvents(
    c.services.using(() =>
      c.writing.streamGeneration(
        d.projectId,
        "master",
        input(d, { resumeOf: old.id })
      )
    )
  );
  assert.ok(events.some((e) => e.type === "completed"));
  assert.equal(c.services.usage().recent.length, 2);
  assert.equal(
    c.writing.generation(d.projectId, "master", old.id).status,
    "failed"
  );
});
test("generation recovery marks previous process work interrupted and hides foreign author IDs", async (t) => {
  const c = setup(t),
    other = setup(t);
  conn(c);
  const d = article(c);
  c.services.publicStreamTransport = async () =>
    sse(
      wire(
        JSON.stringify({ replacement: "完整内容。", reason: "用于重启记录" })
      )
    );
  await parseEvents(
    c.services.using(() =>
      c.writing.streamGeneration(d.projectId, "master", input(d))
    )
  );
  const row = c.writing.generations(d.projectId, "master")[0];
  c.store.db
    .prepare(
      "UPDATE writing_generations SET status='running',owner='previous-process' WHERE id=?"
    )
    .run(row.id);
  assert.equal(
    c.writing.generations(d.projectId, "master")[0].status,
    "interrupted"
  );
  const path =
    "/api/writing/projects/" + d.projectId + "/master/generations/" + row.id;
  assert.equal((await api(other, path)).status, 404);
  assert.equal((await api(other, path + "/cancel", "POST", {})).status, 404);
});
test("source removal revokes inferred fields while preserving explicit preferences, article history and evidence versions", async (t) => {
  const c = setup(t),
    d = article(c),
    material = c.creator.addMaterial({
      title: "要移除的实践笔记",
      body: "ORIGINAL_PRIVATE_MATERIAL",
    });
  c.creator.saveProfile({
    expectedRevision: 1,
    data: { tone: "明确写下的原始语气" },
  });
  c.creator.setContext(d.projectId, {
    expectedRevision: 0,
    refs: [{ kind: "material", id: material.id }],
  });
  c.services.chat = async () => ({
    tone: "由素材推断的语气",
    structure: "先例子后方法",
    avoid: "夸张承诺",
    length: "短文",
  });
  const learned = await c.creator.inferStyle({
    projectIds: [d.projectId],
    allowExternalAI: true,
  });
  c.creator.decideStyle(learned.id, { action: "accept", expectedRevision: 2 });
  c.creator.saveProfile({
    expectedRevision: 3,
    data: { goals: "作者后来明确填写的目标" },
  });
  const history = c.writing.history(d.projectId, "master"),
    preview = c.creator.sourceRemovalPreview({
      kind: "material",
      id: material.id,
    });
  assert.ok(preview.profileFields.includes("tone"));
  c.creator.removeSource({ ...preview, confirmRemove: true });
  assert.equal(c.creator.profile().tone, "明确写下的原始语气");
  assert.equal(c.creator.profile().goals, "作者后来明确填写的目标");
  assert.equal(c.creator.material(material.id).body, "");
  assert.equal(
    (
      await api(
        c,
        "/api/creator/library/removal-preview?kind=material&id=" + material.id
      )
    ).status,
    410
  );
  assert.equal(c.creator.styleSuggestions()[0].status, "revoked");
  assert.deepEqual(c.writing.history(d.projectId, "master"), history);
  assert.throws(
    () =>
      c.creator.restoreProfile({
        expectedRevision: c.creator.profile().revision,
        restoreRevision: 3,
      }),
    (e) => e.status === 409
  );
  await assert.rejects(
    () =>
      c.creator.inferStyle({
        projectIds: [d.projectId],
        allowExternalAI: true,
      }),
    (e) => e.status === 409
  );
  assert.equal(
    c.creator.resolveRefs([{ kind: "material", id: material.id }])[0]
      .unavailable,
    true
  );
  assert.equal(
    c.creator
      .library({ q: "ORIGINAL_PRIVATE_MATERIAL" })
      .some((a) => a.id === material.id),
    false
  );
});
test("source removal preserves an independently edited tone and refuses foreign or stale deletion approvals", async (t) => {
  const c = setup(t),
    other = setup(t),
    d = article(c);
  c.services.chat = async () => ({ tone: "推断语气", structure: "推断结构" });
  const learned = await c.creator.inferStyle({
    projectIds: [d.projectId],
    allowExternalAI: true,
  });
  c.creator.decideStyle(learned.id, { action: "accept", expectedRevision: 1 });
  c.creator.decideStyle(learned.id, { action: "delete" });
  c.creator.saveProfile({
    expectedRevision: 2,
    data: { tone: "作者重新明确设置的语气" },
  });
  const preview = c.creator.sourceRemovalPreview({
    kind: "article",
    id: d.projectId,
  });
  assert.equal(preview.profileFields.includes("tone"), false);
  assert.throws(
    () =>
      other.creator.sourceRemovalPreview({ kind: "article", id: d.projectId }),
    (e) => e.status === 404
  );
  assert.throws(
    () => c.creator.removeSource({ ...preview, confirmRemove: false }),
    (e) => e.status === 403
  );
  c.creator.saveProfile({
    expectedRevision: 3,
    data: { goals: "新的明确目标" },
  });
  assert.throws(
    () => c.creator.removeSource({ ...preview, confirmRemove: true }),
    (e) => e.status === 409
  );
  c.creator.removeSource({
    ...c.creator.sourceRemovalPreview({ kind: "article", id: d.projectId }),
    confirmRemove: true,
  });
  assert.equal(c.creator.profile().tone, "作者重新明确设置的语气");
  assert.ok(c.writing.document(d.projectId, "master").markdown);
  assert.equal(c.creator.styleSuggestions()[0].status, "deleted");
});
test("source removal and profile reset roll back together on persistence failure", (t) => {
  const c = setup(t),
    m = c.creator.addMaterial({
      title: "事务回滚的素材",
      body: "不能丢失的原始内容",
    }),
    preview = c.creator.sourceRemovalPreview({ kind: "material", id: m.id });
  c.store.db.exec(
    "CREATE TRIGGER reject_removal BEFORE INSERT ON creator_source_removals BEGIN SELECT RAISE(ABORT,'synthetic removal failure'); END;"
  );
  assert.throws(
    () => c.creator.removeSource({ ...preview, confirmRemove: true }),
    /synthetic removal failure/
  );
  assert.equal(c.creator.material(m.id).body, "不能丢失的原始内容");
  assert.equal(c.creator.sourceRemoved("material", m.id), false);
});
test("account profile overrides are isolated, versioned and lower precedence than article preferences", async (t) => {
  const c = setup(t),
    other = setup(t),
    d = article(c),
    a = c.publishing.saveAccount({ platform: "zhihu", name: "技术长文账号" });
  c.publishing.saveAccountProfile(a.id, {
    expectedRevision: 0,
    data: {
      positioning: "面向独立开发者的深入解释",
      tone: "清楚严谨",
      length: "长文",
    },
  });
  c.creator.setContext(
    d.projectId,
    { expectedRevision: 0, accountId: a.id, overrides: { tone: "本篇更亲切" } },
    "zhihu"
  );
  const context = c.creator.context(d.projectId, "zhihu");
  assert.equal(context.profile.tone, "本篇更亲切");
  assert.equal(context.profile.length, "长文");
  assert.equal(context.account.positioning, "面向独立开发者的深入解释");
  assert.throws(
    () =>
      c.creator.setContext(
        d.projectId,
        { expectedRevision: 1, accountId: a.id },
        "wechat"
      ),
    (e) => e.status === 400
  );
  assert.throws(
    () =>
      c.publishing.saveAccountProfile(a.id, {
        expectedRevision: 0,
        data: { tone: "旧设置覆盖" },
      }),
    (e) => e.status === 409
  );
  assert.equal(
    (await api(other, "/api/creator/platforms/accounts/" + a.id + "/profile"))
      .status,
    404
  );
});
test("account profile changes invalidate a generated suggestion without changing the platform draft", async (t) => {
  const c = setup(t);
  conn(c);
  const d = article(c),
    a = c.publishing.saveAccount({ platform: "zhihu", name: "风格版本账号" });
  let platform = c.writing.document(d.projectId, "zhihu");
  platform = c.writing.save(d.projectId, "zhihu", {
    expectedRevision: platform.revision,
    markdown: "这是独立的知乎稿。",
    sourceMasterRevision: d.revision,
  });
  c.creator.setContext(
    d.projectId,
    { expectedRevision: 0, accountId: a.id },
    "zhihu"
  );
  c.services.publicTransport = async () =>
    reply({ replacement: "带账号定位的新建议。", reason: "等待作者确认" });
  const s = await c.services.using(() =>
    c.writing.suggest(d.projectId, "zhihu", input(platform))
  );
  assert.equal(s.contextSnapshot.account.id, a.id);
  c.publishing.saveAccountProfile(a.id, {
    expectedRevision: 0,
    data: { tone: "后来调整的账号语气" },
  });
  assert.throws(
    () =>
      c.writing.decide(d.projectId, "zhihu", s.id, {
        action: "accept",
        expectedRevision: platform.revision,
      }),
    (e) => e.status === 409
  );
  assert.equal(
    c.writing.document(d.projectId, "zhihu").markdown,
    platform.markdown
  );
});
test("streaming public transport validates all DNS answers before opening TLS", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      publicRequestStream("https://model.example/v1/", {
        resolve: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ],
        transport: () => {
          calls++;
        },
      }),
    (e) => e.status === 403
  );
  assert.equal(calls, 0);
});

test("stream TLS boundary pins validated DNS and cancels the socket without redirects or oversized bodies", async () => {
  const { Readable } = await import("node:stream");
  let options,
    destroyed = 0;
  const transport = (url, opts, callback) => {
    options = opts;
    const req = new EventEmitter();
    req.write = () => {};
    req.destroy = () => {
      destroyed++;
    };
    req.end = () =>
      queueMicrotask(() => {
        const response = Readable.from([
          Buffer.from("hello"),
          Buffer.from(" world"),
        ]);
        response.statusCode = 200;
        response.headers = { "content-type": "text/plain" };
        callback(response);
      });
    return req;
  };
  const response = await publicRequestStream("https://model.example/v1/", {
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    transport,
  });
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.servername, "model.example");
  await new Promise((resolve, reject) =>
    options.lookup("model.example", {}, (e, address) =>
      e ? reject(e) : (assert.equal(address, "93.184.216.34"), resolve())
    )
  );
  assert.equal(await response.text(), "hello world");
  const over = await publicRequestStream("https://model.example/v1/", {
    maxBytes: 3,
    resolve: async () => [{ address: "93.184.216.34", family: 4 }],
    transport,
  });
  await assert.rejects(() => over.text());
  assert.ok(destroyed > 0);
  const redirected = (url, opts, callback) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.destroy = () => {};
    req.end = () =>
      queueMicrotask(() => {
        const res = Readable.from([]);
        res.statusCode = 302;
        res.headers = { location: "https://elsewhere.example" };
        callback(res);
      });
    return req;
  };
  await assert.rejects(
    () =>
      publicRequestStream("https://model.example/", {
        resolve: async () => [{ address: "93.184.216.34", family: 4 }],
        transport: redirected,
      }),
    (e) => e.status === 502
  );
});

test("explicit cancellation discards even a late provider return and leaves a recoverable generation", async (t) => {
  const c = setup(t);
  conn(c);
  const d = article(c);
  let release, entered;
  const started = new Promise((r) => (entered = r));
  c.services.publicStreamTransport = async () => {
    entered();
    await new Promise((r) => (release = r));
    return sse(
      wire(
        JSON.stringify({
          replacement: "取消后不应进入建议。",
          reason: "迟到结果",
        })
      )
    );
  };
  const response = c.services.using(() =>
      c.writing.streamGeneration(d.projectId, "master", input(d))
    ),
    events = parseEvents(response);
  await started;
  const g = c.writing.generations(d.projectId, "master")[0];
  c.writing.cancelGeneration(d.projectId, "master", g.id);
  release();
  await events;
  assert.equal(
    c.writing.generation(d.projectId, "master", g.id).status,
    "interrupted"
  );
  assert.equal(c.writing.suggestions(d.projectId, "master").length, 0);
  assert.equal(c.writing.document(d.projectId, "master").markdown, d.markdown);
});
test("removing a source during inference and streaming revokes late results and clears the active preview", async (t) => {
  const c = setup(t);
  conn(c);
  const d = article(c),
    m = c.creator.addMaterial({
      title: "执行中移除的来源",
      body: "PRIVATE_SOURCE_BEFORE_REMOVAL",
    });
  c.creator.setContext(d.projectId, {
    expectedRevision: 0,
    refs: [{ kind: "material", id: m.id }],
  });
  let finishInference;
  c.services.chat = () => new Promise((r) => (finishInference = r));
  const pending = c.creator.inferStyle({
    projectIds: [d.projectId],
    allowExternalAI: true,
  });
  let release, entered;
  const started = new Promise((r) => (entered = r));
  c.services.publicStreamTransport = async () => {
    entered();
    await new Promise((r) => (release = r));
    return sse(
      wire(
        JSON.stringify({
          replacement: "不可采纳的迟到片段。",
          reason: "来源已撤销",
        })
      )
    );
  };
  const events = parseEvents(
    c.services.using(() =>
      c.writing.streamGeneration(d.projectId, "master", input(d))
    )
  );
  await started;
  c.creator.removeSource({
    ...c.creator.sourceRemovalPreview({ kind: "material", id: m.id }),
    confirmRemove: true,
  });
  finishInference({ tone: "不应入库的推断" });
  release();
  await assert.rejects(
    () => pending,
    (e) => e.status === 409
  );
  await events;
  assert.equal(c.creator.styleSuggestions().length, 0);
  assert.equal(c.writing.suggestions(d.projectId, "master").length, 0);
  const g = c.writing.generations(d.projectId, "master")[0];
  assert.equal(g.status, "revoked");
  assert.equal(g.partial, "");
});

test("partial provenance migration repairs missing fields before revoking inherited inferred preferences", async (t) => {
  const c = setup(t),
    d = article(c);
  c.services.chat = async () => ({
    tone: "需要保留来源的语气",
    structure: "先观察后结论",
  });
  const learned = await c.creator.inferStyle({
    projectIds: [d.projectId],
    allowExternalAI: true,
  });
  c.creator.decideStyle(learned.id, { action: "accept", expectedRevision: 1 });
  c.creator.saveProfile({
    expectedRevision: 2,
    data: { goals: "后来明确设定的目标" },
  });
  c.store.db
    .prepare(
      "DELETE FROM creator_profile_field_sources WHERE revision=3 AND field='tone'"
    )
    .run();
  c.creator._ensureProfileFieldSources();
  assert.equal(c.creator.fieldSources(3).tone[0].projectId, d.projectId);
  c.creator.removeSource({
    ...c.creator.sourceRemovalPreview({ kind: "article", id: d.projectId }),
    confirmRemove: true,
  });
  assert.equal(c.creator.profile().tone, "");
  assert.equal(c.creator.profile().goals, "后来明确设定的目标");
});

test("author can explicitly disable streaming for compatible JSON-only providers without an automatic retry", async (t) => {
  const c = setup(t);
  conn(c);
  const d = article(c);
  let calls = 0;
  c.services.publicStreamTransport = async (_url, options) => {
    calls++;
    const payload = JSON.parse(options.body);
    assert.equal(payload.stream, false);
    assert.equal(payload.stream_options, undefined);
    return reply({
      replacement: "非流式服务返回的完整结果。",
      reason: "作者明确选择兼容模式",
    });
  };
  const events = await parseEvents(
    c.services.using(() =>
      c.writing.streamGeneration(
        d.projectId,
        "master",
        input(d, { stream: false })
      )
    )
  );
  assert.ok(events.some((e) => e.type === "completed"));
  assert.equal(calls, 1);
  assert.equal(
    c.writing.generations(d.projectId, "master")[0].input.stream,
    false
  );
});

test("source removal approval binds the exact dependency scope even when the profile version stays unchanged", (t) => {
  const c = setup(t),
    a = article(c),
    m = c.creator.addMaterial({
      title: "需要固定影响范围的素材",
      body: "作者待核对的参考内容",
    });
  c.creator.setContext(a.projectId, {
    expectedRevision: 0,
    refs: [{ kind: "material", id: m.id }],
  });
  const reviewed = c.creator.sourceRemovalPreview({
    kind: "material",
    id: m.id,
  });
  const b = article(c);
  c.creator.setContext(b.projectId, {
    expectedRevision: 0,
    refs: [{ kind: "material", id: m.id }],
  });
  assert.equal(c.creator.profile().revision, reviewed.expectedProfileRevision);
  assert.throws(
    () => c.creator.removeSource({ ...reviewed, confirmRemove: true }),
    (e) => e.status === 409
  );
  assert.ok(c.creator.material(m.id).body);
  const fresh = c.creator.sourceRemovalPreview({ kind: "material", id: m.id });
  assert.equal(fresh.projectIds.length, 2);
  c.creator.removeSource({ ...fresh, confirmRemove: true });
  assert.equal(c.creator.material(m.id).body, "");
});

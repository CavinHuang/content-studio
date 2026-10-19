import test from "node:test";
import assert from "node:assert/strict";
import { createCore } from "../lib/core.mjs";
import { dispatchApi } from "../lib/api.mjs";
import { providerEnvironment } from "../src/provider-context.mjs";

const setup = (t) => {
  const c = createCore(":memory:");
  t.after(() => c.close());
  return c;
};
const conn = (
  c,
  { name = "模型甲", model = "model-a", models, selected = true } = {}
) =>
  c.services.save({
    kind: "text",
    name,
    model,
    models,
    selected,
    apiKey: "synthetic-key-" + model,
    baseUrl: "https://" + model + ".example/v1/",
  });
const article = (c) => {
  const d = c.writing.create({ title: "模型对比的合成文章" });
  return c.writing.save(d.projectId, "master", {
    expectedRevision: d.revision,
    markdown: "开头🌲。\n\n中段观察。\n\n结尾建议。",
  });
};
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

test("模型列表请求需要显式授权，且仅接受公网 HTTPS 地址与有效密钥", async (t) => {
  const c = setup(t);
  await assert.rejects(
    () =>
      c.services.listRemoteModels({
        baseUrl: "https://api.example.com/v1/",
        apiKey: "synthetic-key-1234",
      }),
    (e) => e.status === 403
  );
  await assert.rejects(
    () =>
      c.services.listRemoteModels({
        baseUrl: "http://127.0.0.1:4312/v1/",
        apiKey: "synthetic-key-1234",
        allowExternalCheck: true,
      }),
    (e) => /公网 HTTPS/.test(e.message)
  );
  await assert.rejects(
    () =>
      c.services.listRemoteModels({
        baseUrl: "https://api.example.com/v1/",
        apiKey: "abc",
        allowExternalCheck: true,
      }),
    (e) => /API Key/.test(e.message)
  );
});

test("拉取并解析服务商模型列表：去重、裁剪、诚实的失败提示", async (t) => {
  const c = setup(t);
  let seen;
  c.services.publicTransport = async (url, options) => {
    seen = { url: String(url), auth: options.headers.authorization };
    return Response.json({
      data: [
        { id: "m-b" },
        { id: " m-c " },
        { id: "m-b" },
        { id: "x".repeat(161) },
        { unsupported: true },
      ],
    });
  };
  const r = await c.services.listRemoteModels({
    baseUrl: "https://api.example.com/v1/",
    apiKey: "synthetic-key-1234",
    allowExternalCheck: true,
  });
  assert.equal(seen.url, "https://api.example.com/v1/models");
  assert.equal(seen.auth, "Bearer synthetic-key-1234");
  assert.deepEqual(r, { models: ["m-b", "m-c"], truncated: false });
  c.services.publicTransport = async () =>
    new Response("denied", { status: 401 });
  await assert.rejects(
    () =>
      c.services.listRemoteModels({
        baseUrl: "https://api.example.com/v1/",
        apiKey: "synthetic-key-1234",
        allowExternalCheck: true,
      }),
    (e) => e.status === 502 && /401/.test(e.message)
  );
  c.services.publicTransport = async () =>
    new Response("<html>not json</html>", { status: 200 });
  await assert.rejects(
    () =>
      c.services.listRemoteModels({
        baseUrl: "https://api.example.com/v1/",
        apiKey: "synthetic-key-1234",
        allowExternalCheck: true,
      }),
    (e) => e.status === 502
  );
  c.services.publicTransport = async () => Response.json({ data: [] });
  await assert.rejects(
    () =>
      c.services.listRemoteModels({
        baseUrl: "https://api.example.com/v1/",
        apiKey: "synthetic-key-1234",
        allowExternalCheck: true,
      }),
    (e) => e.status === 502 && /未返回可用模型/.test(e.message)
  );
});

test("保存连接可多选开放模型：默认模型始终开放，集合按次整体替换", (t) => {
  const c = setup(t);
  const a = conn(c, { models: ["model-b", "model-c"] });
  let row = c.services.connections().find((x) => x.id === a.id);
  assert.deepEqual(row.models, ["model-a", "model-b", "model-c"]);
  c.services.save({
    id: a.id,
    kind: "text",
    name: "模型甲",
    model: "model-a",
    baseUrl: "https://model-a.example/v1/",
    models: ["model-d"],
  });
  row = c.services.connections().find((x) => x.id === a.id);
  assert.deepEqual(row.models, ["model-a", "model-d"]);
  c.services.save({
    id: a.id,
    kind: "text",
    name: "模型甲",
    model: "model-a",
    baseUrl: "https://model-a.example/v1/",
  });
  row = c.services.connections().find((x) => x.id === a.id);
  assert.deepEqual(row.models, ["model-a", "model-d"]);
  const b = conn(c, { name: "模型乙", model: "model-b" });
  assert.deepEqual(
    c.services.connections().find((x) => x.id === b.id).models,
    ["model-b"]
  );
  c.services.remove(b.id);
  assert.equal(
    c.store.db
      .prepare("SELECT COUNT(*) AS n FROM service_connection_models")
      .get().n,
    2
  );
  assert.throws(
    () =>
      c.services.save({
        kind: "text",
        name: "模型丙",
        model: "model-p",
        apiKey: "synthetic-key-model-p",
        baseUrl: "https://model-p.example/v1/",
        models: Array.from({ length: 101 }, (_, i) => "m-" + i),
      }),
    (e) => /100 个模型/.test(e.message)
  );
});

test("绑定可指定备用连接的任一开放模型，指纹按所选模型计算", (t) => {
  const c = setup(t);
  const a = conn(c, { models: ["model-a2"] });
  const b = conn(c, {
    name: "模型乙",
    model: "model-b",
    models: ["model-b2"],
    selected: false,
  });
  const chosen = c.services.captureBinding("text", {
    connectionId: b.id,
    model: "model-b2",
  });
  assert.equal(chosen.id, b.id);
  assert.equal(chosen.model, "model-b2");
  assert.equal(chosen.configured, true);
  assert.throws(
    () =>
      c.services.captureBinding("text", {
        connectionId: b.id,
        model: "model-b-not-open",
      }),
    (e) => e.status === 403
  );
  assert.throws(
    () =>
      c.services.captureBinding("text", {
        connectionId: "sc_missing",
        model: "model-b2",
      }),
    (e) => e.status === 404
  );
  // 平台标识不是连接 ID：choice 等价于未指定（生成记录回填恢复请求的场景）。
  const legacy = c.services.captureBinding();
  assert.deepEqual(
    c.services.captureBinding("text", {
      connectionId: "platform",
      model: legacy.model,
    }),
    legacy
  );
  assert.equal(legacy.id, a.id);
  assert.equal(legacy.model, "model-a");
  return c.services.usingTask("t_legacy", legacy, 1, () => {
    assert.equal(providerEnvironment().CONTENT_AI_MODEL, "model-a");
  });
});

test("任务内 env 使用所选模型；开放集合收回后旧任务失败关闭", async (t) => {
  const c = setup(t);
  const a = conn(c, { models: ["model-b"] });
  const binding = c.services.captureBinding("text", {
    connectionId: a.id,
    model: "model-b",
  });
  await c.services.usingTask("t1", binding, 1, () => {
    assert.equal(providerEnvironment().CONTENT_AI_MODEL, "model-b");
  });
  c.services.save({
    id: a.id,
    kind: "text",
    name: "模型甲",
    model: "model-a",
    baseUrl: "https://model-a.example/v1/",
    models: ["model-c"],
  });
  assert.throws(
    () => c.services.usingTask("t2", binding, 1, () => {}),
    (e) => e.status === 403 && /未在该连接开放/.test(e.message)
  );
  const legacy = JSON.parse(
    JSON.stringify(c.services.captureBinding("text"))
  );
  await c.services.usingTask("t3", legacy, 1, () => {
    assert.equal(providerEnvironment().CONTENT_AI_MODEL, "model-a");
  });
});

test("streamGeneration 按所选开放模型生成，记录暴露所用模型", async (t) => {
  const c = setup(t);
  const a = conn(c, { models: ["model-b"] });
  const d = article(c);
  let seen;
  c.services.publicStreamTransport = async (url, options) => {
    seen = { host: new URL(url).host, model: JSON.parse(options.body).model };
    return sse(
      wire(
        JSON.stringify({ replacement: "完整的新段落。", reason: "请作者审阅" })
      ),
      9
    );
  };
  const events = await parseEvents(
    c.services.using(() =>
      c.writing.streamGeneration(
        d.projectId,
        "master",
        input(d, {
          model: { connectionId: a.id, model: "model-b" },
        })
      )
    )
  );
  assert.deepEqual(seen, { host: "model-a.example", model: "model-b" });
  const completed = events.find((e) => e.type === "completed");
  assert.ok(completed.result.id);
  const record = c.writing.generations(d.projectId, "master")[0];
  assert.deepEqual(record.model, {
    id: a.id,
    name: "模型甲",
    model: "model-b",
  });
  assert.equal(c.services.usage().recent[0].state, "completed");
  assert.throws(
    () =>
      c.services.using(() =>
        c.writing.streamGeneration(
          d.projectId,
          "master",
          input(d, {
            model: { connectionId: a.id, model: "model-not-open" },
          })
        )
      ),
    (e) => e.status === 403
  );
  assert.throws(
    () =>
      c.services.using(() =>
        c.writing.streamGeneration(
          d.projectId,
          "master",
          input(d, { model: { connectionId: a.id } })
        )
      ),
    (e) => e.status === 400
  );
});

test("恢复请求须沿用原模型；沿用或省略时按原绑定继续", async (t) => {
  const c = setup(t);
  const a = conn(c, { models: ["model-b"] });
  const d = article(c);
  c.services.publicStreamTransport = async () =>
    sse(wire('{"replacement":"保留中断片段', { done: false }));
  await parseEvents(
    c.services.using(() =>
      c.writing.streamGeneration(
        d.projectId,
        "master",
        input(d, { model: { connectionId: a.id, model: "model-b" } })
      )
    )
  );
  const old = c.writing.generations(d.projectId, "master")[0];
  assert.equal(old.status, "failed");
  assert.throws(
    () =>
      c.services.using(() =>
        c.writing.streamGeneration(
          d.projectId,
          "master",
          input(d, {
            resumeOf: old.id,
            model: { connectionId: a.id, model: "model-a" },
          })
        )
      ),
    (e) => e.status === 409
  );
  c.services.publicStreamTransport = async () =>
    sse(
      wire(
        JSON.stringify({ replacement: "重新生成的结果。", reason: "新请求" })
      )
    );
  const events = await parseEvents(
    c.services.using(() =>
      c.writing.streamGeneration(
        d.projectId,
        "master",
        input(d, {
          resumeOf: old.id,
          model: { connectionId: a.id, model: "model-b" },
        })
      )
    )
  );
  assert.ok(events.some((e) => e.type === "completed"));
});

test("API：模型列表路由需要授权；服务列表返回开放模型集合", async (t) => {
  const c = setup(t);
  conn(c, { models: ["model-b"] });
  const denied = await api(c, "/api/creator/services/models", "POST", {
    baseUrl: "https://api.example.com/v1/",
    apiKey: "synthetic-key-1234",
  });
  assert.equal(denied.status, 403);
  let called;
  c.services.publicTransport = async (url, options) => {
    called = String(url);
    return Response.json({ data: [{ id: "remote-1" }, { id: "remote-2" }] });
  };
  const ok = await api(c, "/api/creator/services/models", "POST", {
    baseUrl: "https://api.example.com/v1/",
    apiKey: "synthetic-key-1234",
    allowExternalCheck: true,
  });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).models, ["remote-1", "remote-2"]);
  assert.equal(called, "https://api.example.com/v1/models");
  const listing = await api(c, "/api/creator/services");
  assert.equal(listing.status, 200);
  const body = await listing.json();
  assert.deepEqual(body.connections[0].models, ["model-a", "model-b"]);
  const saved = await api(c, "/api/creator/services", "POST", {
    kind: "text",
    name: "模型乙",
    model: "model-x",
    apiKey: "synthetic-key-model-x",
    baseUrl: "https://model-x.example/v1/",
    models: ["model-y"],
  });
  assert.equal(saved.status, 201);
  assert.deepEqual((await saved.json()).models, ["model-x", "model-y"]);
});

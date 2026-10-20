import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../lib/core.mjs";
import { dispatchApi } from "../lib/api.mjs";
import {
  buildInsightsView,
  latestEntriesInRange,
  rangeDays,
  rangeLabel,
  trendBuckets,
} from "../src/insights-view.mjs";
import { addDays } from "../src/calendar-view.mjs";

// Pure derivation tests first (fixed clock), then the real SQLite-backed
// /api/creator/insights adapter through dispatchApi (V58 boundary incl.).
// Honesty rules under test: no fabricated metrics (— not 0), latest-entry
// aggregation only, explicit 暂无已验证平台数据, style learning only from
// author-confirmed decisions.

const NOW = new Date("2026-10-20T04:00:00.000Z"); // 上海时间 2026-10-20 12:00

const baseProjects = [
  {
    id: "ep_1",
    title: "作品甲",
    channels: {
      wechat: { status: "reported_published" },
      zhihu: { status: "exported" },
    },
  },
  { id: "ep_2", title: "作品乙", channels: { wechat: { status: "draft" } } },
];

const baseMetrics = [
  {
    id: "m1",
    project_id: "ep_1",
    channel: "wechat",
    views: 2000,
    likes: 100,
    comments: 20,
    url: "https://mp.example.test/1",
    note: "首发一周记录",
    created_at: "2026-10-19T02:00:00.000Z",
  },
  {
    id: "m2",
    project_id: "ep_1",
    channel: "wechat",
    views: 1500,
    likes: 60,
    comments: 10,
    note: "",
    created_at: "2026-10-12T02:00:00.000Z",
  },
  {
    id: "m3",
    project_id: "ep_1",
    channel: "zhihu",
    views: null,
    likes: null,
    comments: null,
    note: "还没看后台",
    created_at: "2026-10-18T02:00:00.000Z",
  },
  {
    id: "m4",
    project_id: "ep_2",
    channel: "wechat",
    views: 480,
    likes: 26,
    comments: null,
    note: "",
    created_at: "2026-08-01T02:00:00.000Z",
  },
];

test("range helpers cover the three design segments", () => {
  assert.deepEqual(rangeDays("7d"), 7);
  assert.deepEqual(rangeDays("30d"), 30);
  assert.deepEqual(rangeDays("90d"), 90);
  assert.deepEqual(rangeDays("bogus"), 7);
  assert.equal(rangeLabel("30d"), "30 天");
  assert.equal(rangeLabel("nope"), "7 天");
});

test("trend buckets: daily for 7 天, weekly-ish for 30/90, always ending today", () => {
  const week = trendBuckets("7d", NOW);
  assert.equal(week.count, 7);
  assert.equal(week.size, 1);
  assert.equal(week.today, "2026-10-20");
  assert.equal(week.buckets.at(-1).endKey, "2026-10-20");
  assert.equal(week.buckets[0].startKey, "2026-10-14");

  const month = trendBuckets("30d", NOW);
  assert.equal(month.count, 10);
  assert.equal(month.size, 3);
  assert.equal(month.buckets.at(-1).endKey, "2026-10-20");

  const quarter = trendBuckets("90d", NOW);
  assert.equal(quarter.count, 13);
  assert.equal(quarter.size, 7);
  // 90/7 的余数由最旧的一桶吸收（6 天），最新一桶止于今天。
  assert.equal(quarter.buckets[0].startKey, "2026-07-23");
  assert.equal(quarter.buckets[0].endKey, "2026-07-29");
  assert.equal(quarter.buckets.at(-1).endKey, "2026-10-20");
  // 所有桶保持 start ≤ end、首尾相接且时间有序（旧 → 新）。
  for (const b of quarter.buckets) assert.ok(b.startKey <= b.endKey);
  for (let i = 1; i < quarter.buckets.length; i++)
    assert.equal(quarter.buckets[i].startKey, addDays(quarter.buckets[i - 1].endKey, 1));
});

test("latestEntriesInRange keeps the newest snapshot per project+channel and honours Shanghai day edges", () => {
  const latest = latestEntriesInRange(baseMetrics, "7d", NOW);
  // 7 天窗口内 ep_1:wechat 有两条 → 只留 10-19 的 m1（10-12 是旧快照）。
  assert.equal(latest.size, 2);
  assert.equal(latest.get("ep_1:wechat").id, "m1");
  assert.equal(latest.get("ep_1:zhihu").id, "m3");
  // 30 天同样排除 08-01。
  assert.equal(latestEntriesInRange(baseMetrics, "30d", NOW).size, 2);
  // 90 天窗口纳入 ep_2 的 08-01 记录。
  assert.equal(latestEntriesInRange(baseMetrics, "90d", NOW).size, 3);
  // 上海日界：UTC 10-13T17:00Z = 上海 10-14 01:00，属于 7 天窗口首日。
  const edge = latestEntriesInRange(
    [{ project_id: "ep_x", channel: "wechat", created_at: "2026-10-13T17:00:00.000Z" }],
    "7d",
    NOW
  );
  assert.equal(edge.size, 1);
});

test("KPI aggregation sums only latest in-range entries; missing values stay missing, never zero", () => {
  const view = buildInsightsView({
    projects: baseProjects,
    metrics: baseMetrics,
    suggestions: [],
    profile: null,
    range: "7d",
    now: NOW,
  });
  // 阅读量=2000（m1 最新）；zhihu 未填 → missing，不估算；08-01 不在范围。
  assert.equal(view.kpi.views.value, 2000);
  assert.equal(view.kpi.views.missing, 1);
  assert.equal(view.kpi.engagement.value, 120);
  assert.equal(view.kpi.engagement.missing, 1);
  // 作者报告已发表=wechat reported_published 的作品数；语义是未核验报告。
  assert.equal(view.kpi.reportedPublished, 1);
  assert.equal(view.hasAnyMetrics, true);
  // 结构性事实：本产品没有平台统计接入，永不为真。
  assert.equal(view.hasVerifiedPlatformData, false);
  // 行：最新快照 + 全部录入次数（ep_1:wechat 共 2 次）。
  assert.equal(view.rows.length, 2);
  const wechatRow = view.rows.find((r) => r.channel === "wechat");
  assert.equal(wechatRow.projectTitle, "作品甲");
  assert.equal(wechatRow.views, 2000);
  assert.equal(wechatRow.entryCount, 2);
  assert.equal(wechatRow.stage.label, "作者报告已发表（未核验）");
  assert.equal(view.rows[0].channel, "wechat"); // 按录入时间倒序

  // 90 天：纳入 ep_2 → 2480/146（与设计示例数值巧合，但这里全部来自录入行）。
  const quarter = buildInsightsView({
    projects: baseProjects,
    metrics: baseMetrics,
    suggestions: [],
    profile: null,
    range: "90d",
    now: NOW,
  });
  assert.equal(quarter.kpi.views.value, 2480);
  assert.equal(quarter.kpi.engagement.value, 146);
  assert.equal(quarter.rows.length, 3);
});

test("empty author gets the honest empty state: null KPIs, no trend data, no fake rows", () => {
  const view = buildInsightsView({
    projects: [],
    metrics: [],
    suggestions: [],
    profile: null,
    range: "7d",
    now: NOW,
  });
  assert.equal(view.hasAnyMetrics, false);
  assert.equal(view.kpi.views.value, null);
  assert.equal(view.kpi.engagement.value, null);
  assert.equal(view.kpi.reportedPublished, 0);
  assert.equal(view.trend.hasData, false);
  assert.deepEqual(view.trend.days.map((d) => d.label), [
    "三",
    "四",
    "五",
    "六",
    "日",
    "一",
    "二",
  ]);
  assert.equal(view.rows.length, 0);
});

test("trend bars plot recorded snapshots only; same-day entries keep the latest", () => {
  const view = buildInsightsView({
    projects: [],
    metrics: [
      { project_id: "ep_1", channel: "wechat", views: 100, created_at: "2026-10-19T02:00:00.000Z" },
      { project_id: "ep_1", channel: "wechat", views: 300, created_at: "2026-10-19T06:00:00.000Z" },
      { project_id: "ep_1", channel: "wechat", views: 200, created_at: "2026-10-17T02:00:00.000Z" },
    ],
    suggestions: [],
    profile: null,
    range: "7d",
    now: NOW,
  });
  assert.equal(view.trend.hasData, true);
  assert.equal(view.trend.maxValue, 300);
  const byLabel = Object.fromEntries(view.trend.days.map((d) => [d.label, d]));
  assert.equal(byLabel["六"].value, 200); // 10-17 是周六
  assert.equal(byLabel["一"].value, 300); // 10-19 同日两条取最新
  assert.equal(byLabel["一"].height, 100);
  assert.equal(byLabel["六"].height, 67);
  assert.equal(byLabel["二"].value, null); // 10-20 没有录入 → 无柱
  assert.equal(byLabel["二"].height, 0);
});

test("style learning groups only real suggestion states; revoked never re-enters", () => {
  const suggestions = [
    {
      id: "st_p",
      status: "pending",
      data: { tone: "克制直接", structure: "", avoid: "夸张的保证", length: "" },
      evidence: [{ projectId: "ep_1", title: "作品甲", revision: 3 }],
      decisions: [],
    },
    {
      id: "st_a",
      status: "accepted",
      data: { tone: "自然" },
      evidence: [{ title: "作品甲", revision: 2 }],
      decisions: [{ createdAt: "2026-10-18T02:00:00.000Z", data: { action: "accept" } }],
    },
    { id: "st_r", status: "rejected", data: { tone: "幽默" }, evidence: [], decisions: [] },
    { id: "st_d", status: "deleted", data: { tone: "x" }, evidence: [], decisions: [] },
    { id: "st_v", status: "revoked", data: {}, evidence: [], decisions: [] },
  ];
  const view = buildInsightsView({
    projects: [],
    metrics: [],
    suggestions,
    profile: { learningEnabled: true, revision: 4 },
    range: "7d",
    now: NOW,
  });
  assert.equal(view.styleLearning.learningEnabled, true);
  assert.deepEqual(
    view.styleLearning.pending.map((s) => s.id),
    ["st_p"]
  );
  const pending = view.styleLearning.pending[0];
  assert.deepEqual(pending.lines, [
    ["表达语气", "克制直接"],
    ["避免表达", "夸张的保证"],
  ]);
  assert.equal(pending.summary, "表达语气：克制直接");
  assert.deepEqual(pending.evidenceTitles, ["作品甲 v3"]);
  assert.deepEqual(
    view.styleLearning.accepted.map((s) => s.id),
    ["st_a"]
  );
  assert.match(view.styleLearning.accepted[0].decidedLabel, /^10-18 /);
  assert.deepEqual(
    view.styleLearning.rejected.map((s) => s.id),
    ["st_r"]
  );
  assert.equal(view.styleLearning.revoked, 1);
  // 学习暂停时如实透出。
  const paused = buildInsightsView({
    projects: [],
    metrics: [],
    suggestions,
    profile: { learningEnabled: false },
    range: "7d",
    now: NOW,
  });
  assert.equal(paused.styleLearning.learningEnabled, false);
});

// ── Real backend adapter: GET /api/creator/insights ─────────────────────

function request(method, path, body, core) {
  return dispatchApi(
    new Request("http://127.0.0.1:4312" + path, {
      method,
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    }),
    core
  );
}

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "studio-insights-"));
  let core = createCore(join(root, "data.sqlite"));
  t.after(() => {
    core.close();
    rmSync(root, { recursive: true, force: true });
  });
  return () => core;
}

test("GET /api/creator/insights aggregates real metrics with project titles; endpoint is read-only", async (t) => {
  const core = setup(t)();
  // 空作者：诚实空态载荷。
  const empty = await request("GET", "/api/creator/insights", undefined, core);
  assert.equal(empty.status, 200);
  const emptyBody = await empty.json();
  assert.equal(emptyBody.insights.hasAnyMetrics, false);
  assert.equal(emptyBody.insights.kpi.views.value, null);
  assert.equal(emptyBody.insights.hasVerifiedPlatformData, false);
  assert.deepEqual(emptyBody.metrics, []);

  // 真实作品 + 人工录入指标（既有 POST 契约）。
  const d = core.writing.create({ title: "复盘聚合的实践文章" });
  core.writing.save(d.projectId, "master", {
    expectedRevision: d.revision,
    markdown: "第一段。\n\n第二段。",
  });
  const added = await request(
    "POST",
    "/api/creator/projects/" + d.projectId + "/metrics",
    { channel: "wechat", views: 2480, likes: 126, comments: null, note: "人工记录" },
    core
  );
  assert.equal(added.status, 201);
  assert.equal((await added.json()).metrics.length, 1);

  const res = await request("GET", "/api/creator/insights", undefined, core);
  const body = await res.json();
  assert.equal(body.metrics.length, 1);
  assert.equal(body.metrics[0].projectTitle, "复盘聚合的实践文章");
  assert.equal(body.insights.kpi.views.value, 2480);
  assert.equal(body.insights.kpi.views.missing, 0);
  assert.equal(body.insights.rows[0].channelLabel, "微信公众号");
  assert.equal(body.insights.trend.hasData, true);
  assert.equal(body.insights.styleLearning.pending.length, 0);
  assert.ok(body.profile && Number.isInteger(body.profile.revision));

  // 只读端点：写方法不被路由。
  const forbiddenPost = await request("POST", "/api/creator/insights", {}, core);
  assert.equal(forbiddenPost.status, 404);

  // V58 边界：写入仍要求 JSON content-type（text/plain 表单跨站被拒）。
  const plain = await dispatchApi(
    new Request("http://127.0.0.1:4312/api/creator/projects/" + d.projectId + "/metrics", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ channel: "wechat" }),
    }),
    core
  );
  assert.equal(plain.status, 400);
});

test("style suggestions reach the page only after the author confirms them", async (t) => {
  const core = setup(t)();
  const d = core.writing.create({ title: "风格学习的文章" });
  core.writing.save(d.projectId, "master", {
    expectedRevision: d.revision,
    markdown: "作者自己的实践记录。",
  });
  core.services.chat = async () => ({
    tone: "清晰克制",
    structure: "从例子开始",
    avoid: "空话",
    length: "千字内",
  });
  const created = await request(
    "POST",
    "/api/creator/style-suggestions",
    { projectIds: [d.projectId], allowExternalAI: true },
    core
  );
  assert.equal(created.status, 201);
  const suggestion = await created.json();
  const pendingId = suggestion.id;

  // 确认前：建议是 pending，画像未变。
  let body = await (await request("GET", "/api/creator/insights", undefined, core)).json();
  assert.equal(body.styleSuggestions[0].status, "pending");
  assert.equal(body.insights.styleLearning.pending.length, 1);
  assert.deepEqual(body.insights.styleLearning.pending[0].lines[0], ["表达语气", "清晰克制"]);
  assert.equal(body.profile.tone, "");

  // 修订冲突保护：错 revision 的采纳必须 409。
  const conflict = await request(
    "POST",
    "/api/creator/style-suggestions/" + pendingId,
    { action: "accept", expectedRevision: body.profile.revision + 9 },
    core
  );
  assert.equal(conflict.status, 409);

  // 作者确认后：画像更新，页面分组变为已采纳。
  const accepted = await request(
    "POST",
    "/api/creator/style-suggestions/" + pendingId,
    { action: "accept", expectedRevision: body.profile.revision },
    core
  );
  assert.equal(accepted.status, 200);
  body = await (await request("GET", "/api/creator/insights", undefined, core)).json();
  assert.equal(body.profile.tone, "清晰克制");
  assert.equal(body.insights.styleLearning.pending.length, 0);
  assert.equal(body.insights.styleLearning.accepted.length, 1);
  assert.equal(body.insights.styleLearning.accepted[0].summary, "表达语气：清晰克制");

  // 同一建议不可二次处理。
  const twice = await request(
    "POST",
    "/api/creator/style-suggestions/" + pendingId,
    { action: "reject", expectedRevision: body.profile.revision },
    core
  );
  assert.equal(twice.status, 409);
});

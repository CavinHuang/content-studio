import test from "node:test";
import assert from "node:assert/strict";
import { buildCreatorHome, projectStage } from "../src/creator-home.mjs";
import { SEED_PARAGRAPH_TEXT } from "../src/seed-paragraph.mjs";

const project = (over = {}) => ({
  id: "ep_1",
  title: "桌面 AI Agent 的价值",
  updatedAt: "2026-10-19T10:00:00.000Z",
  channels: {
    master: { referenceId: "cr_m", document: { revision: 3 }, openCorrections: 0 },
    wechat: {
      referenceId: "cr_w",
      status: "draft",
      checks: { factual: false, privacy: false, rights: false, layout: false },
      masterOutdated: false,
      openCorrections: 0,
    },
    zhihu: {
      referenceId: "cr_z",
      status: "draft",
      checks: { factual: false, privacy: false, rights: false, layout: false },
      masterOutdated: false,
      openCorrections: 0,
    },
  },
  ...over,
});

test("empty workspace yields honest zero counts and no fabricated items", () => {
  const home = buildCreatorHome({});
  assert.deepEqual(home.counts, { inProgress: 0, pendingDecisions: 0, clues: 0 });
  assert.equal(home.focusProjectId, null);
  assert.deepEqual(home.pending, []);
  assert.deepEqual(home.clues, []);
});

test("open master corrections become a 事实核对 task bound to the project", () => {
  const p = project({
    channels: { ...project().channels, master: { referenceId: "cr_m", document: { revision: 2 }, openCorrections: 2 } },
  });
  const home = buildCreatorHome({ projects: [p] });
  assert.equal(home.counts.pendingDecisions, 1);
  assert.equal(home.counts.inProgress, 1);
  const task = home.pending[0];
  assert.equal(task.kind, "corrections");
  assert.ok(task.title.includes("2 处事实"));
  assert.equal(task.href, "/compose?project=ep_1");
  assert.equal(task.actionLabel, "去核对");
});

test("partially completed channel checks surface only for the unfinished channel", () => {
  const p = project({
    channels: {
      ...project().channels,
      wechat: {
        status: "draft",
        checks: { factual: true, privacy: true, rights: false, layout: false },
        masterOutdated: false,
        openCorrections: 0,
      },
    },
  });
  const home = buildCreatorHome({ projects: [p] });
  const checks = home.pending.filter((t) => t.kind === "checks");
  assert.equal(checks.length, 1);
  assert.ok(checks[0].title.includes("公众号稿"));
  assert.ok(checks[0].description.includes("还剩 2 项"));
  assert.equal(checks[0].href, "/compose?project=ep_1&channel=wechat");
  // fully-unchecked or fully-checked channels produce no checks task
  const none = buildCreatorHome({
    projects: [
      project(),
      project({
        id: "ep_2",
        channels: {
          ...project().channels,
          wechat: {
            status: "draft",
            checks: { factual: true, privacy: true, rights: true, layout: true },
            masterOutdated: false,
            openCorrections: 0,
          },
        },
      }),
    ],
  });
  assert.equal(none.pending.filter((t) => t.kind === "checks").length, 0);
});

test("exported channel produces a delivery confirmation task that keeps 导出≠发布 explicit", () => {
  const p = project({
    channels: {
      ...project().channels,
      zhihu: {
        status: "exported",
        checks: { factual: false, privacy: false, rights: false, layout: false },
        masterOutdated: false,
        openCorrections: 0,
      },
    },
  });
  const home = buildCreatorHome({ projects: [p] });
  const task = home.pending.find((t) => t.kind === "delivery");
  assert.ok(task);
  assert.ok(task.description.includes("已导出不等于已发布"));
  const stage = projectStage(p);
  assert.equal(stage.status, "exported");
  assert.ok(stage.label.includes("未发布"));
  assert.equal(stage.tone, "warning");
});

test("author-reported publication stays excluded from 正在创作 and keeps the unverified caveat", () => {
  const p = project({
    channels: {
      ...project().channels,
      wechat: {
        status: "reported_published",
        checks: { factual: true, privacy: true, rights: true, layout: true },
        masterOutdated: false,
        openCorrections: 0,
      },
    },
  });
  const home = buildCreatorHome({ projects: [p] });
  assert.equal(home.counts.inProgress, 0);
  const stage = projectStage(p);
  assert.equal(stage.status, "reported_published");
  assert.ok(stage.label.includes("未核验"));
});

test("master-outdated platform draft becomes a sync task per channel only when it has content", () => {
  const p = project({
    channels: {
      ...project().channels,
      zhihu: {
        status: "draft",
        document: { revision: 1, paragraphs: [{ id: "p1", text: "知乎稿已有的一段真实内容。" }] },
        checks: { factual: false, privacy: false, rights: false, layout: false },
        masterOutdated: true,
        openCorrections: 0,
      },
    },
  });
  const home = buildCreatorHome({ projects: [p] });
  const task = home.pending.find((t) => t.kind === "master-sync");
  assert.ok(task);
  assert.ok(task.title.includes("知乎稿"));
  assert.equal(task.href, "/compose?project=ep_1&channel=zhihu");
  // A never-written platform draft (editorial's seed paragraph only, the
  // real state of fresh projects) is not an actionable sync decision.
  const seeded = buildCreatorHome({
    projects: [
      project({
        channels: {
          ...project().channels,
          zhihu: {
            status: "draft",
            document: { revision: 1, paragraphs: [{ id: "p_seed", text: SEED_PARAGRAPH_TEXT }] },
            checks: { factual: false, privacy: false, rights: false, layout: false },
            masterOutdated: true,
            openCorrections: 0,
          },
        },
      }),
    ],
  });
  assert.equal(seeded.pending.filter((t) => t.kind === "master-sync").length, 0);
  assert.equal(seeded.counts.pendingDecisions, 0);
});

test("unread notifications and blocked jobs enter the pending queue; read/healthy ones do not", () => {
  const home = buildCreatorHome({
    notifications: [
      { id: "nt_1", title: "新的写作画像建议待审阅", href: "/settings", read: 0, created_at: "2026-10-19" },
      { id: "nt_2", title: "已读通知", href: "/topics", read: 1, created_at: "2026-10-19" },
    ],
    jobs: [
      { id: "cj_1", kind: "series_prepare", status: "blocked" },
      { id: "cj_2", kind: "series_prepare", status: "completed" },
      { id: "cj_3", kind: "style_learn", status: "queued" },
    ],
  });
  assert.equal(home.counts.pendingDecisions, 2);
  assert.ok(home.pending.some((t) => t.kind === "notification" && t.href === "/settings"));
  assert.ok(home.pending.some((t) => t.kind === "job" && t.title.includes("内容准备")));
});

test("clues exclude dismissed/writing topics and ones already turned into projects; favorites lead", () => {
  const topics = [
    { id: "tp_a", title: "普通线索", status: "draft", favorite: false, refs: [], createdAt: "2026-10-18", projectId: null },
    { id: "tp_b", title: "收藏线索", status: "prepared", favorite: true, refs: [1, 2], createdAt: "2026-10-17", projectId: null },
    { id: "tp_c", title: "已开始写作", status: "writing", favorite: true, refs: [], createdAt: "2026-10-19", projectId: "ep_9" },
    { id: "tp_d", title: "已放弃", status: "dismissed", favorite: false, refs: [], createdAt: "2026-10-19", projectId: null },
  ];
  const home = buildCreatorHome({ topics });
  assert.equal(home.counts.clues, 2);
  assert.equal(home.clues[0].id, "tp_b");
  assert.equal(home.clues[0].statusLabel, "已准备");
  assert.equal(home.clues[0].refsCount, 2);
  assert.equal(home.clues[1].id, "tp_a");
});

test("pending list is capped but the decision count stays the real total", () => {
  const projects = Array.from({ length: 6 }, (_, i) =>
    project({
      id: "ep_" + i,
      channels: {
        ...project().channels,
        master: { referenceId: "cr_" + i, document: { revision: 1 }, openCorrections: 1 },
      },
    })
  );
  const home = buildCreatorHome({ projects });
  assert.equal(home.counts.pendingDecisions, 6);
  assert.equal(home.pending.length, 4);
  assert.equal(home.counts.inProgress, 6);
  assert.equal(home.focusProjectId, "ep_0");
});

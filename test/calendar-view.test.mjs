import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../lib/core.mjs";
import { dispatchApi } from "../lib/api.mjs";
import {
  addDays,
  buildEvents,
  dayCopy,
  dayLabel,
  describeSeries,
  eventsByDate,
  isDayKey,
  isoToDayKey,
  monthCells,
  monthLabel,
  moveIsoToDay,
  periodPill,
  todayKey,
  weekOf,
  weekdayLabel,
} from "../src/calendar-view.mjs";

// Pure derivation tests first (no IO), then the real SQLite-backed
// targetDate adaptation through dispatchApi (V58 boundary included).

test("day keys, weeks and labels follow real calendar math", () => {
  assert.equal(isDayKey("2026-10-21"), true);
  assert.equal(isDayKey("2026-02-30"), false);
  assert.equal(isDayKey("2026-10-21T00:00:00Z"), false);
  assert.deepEqual(weekOf("2026-10-21"), [
    "2026-10-19",
    "2026-10-20",
    "2026-10-21",
    "2026-10-22",
    "2026-10-23",
    "2026-10-24",
    "2026-10-25",
  ]);
  assert.deepEqual(weekOf("2026-10-21").map(weekdayLabel), [
    "周一",
    "周二",
    "周三",
    "周四",
    "周五",
    "周六",
    "周日",
  ]);
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(dayLabel("2026-10-21"), "10 月 21 日");
  assert.equal(monthLabel("2026-10-21"), "2026 年 10 月");
});

test("month grid emits 35 or 42 Monday-aligned cells so every month fits", () => {
  // 2026-10: 1st is Thursday (lead 3), 31 days → 3+31=34 → 35 cells.
  const oct = monthCells("2026-10-21");
  assert.equal(oct.length, 35);
  assert.equal(oct[0].key, "2026-09-28");
  assert.equal(oct[0].off, true);
  const firstDay = oct.find((c) => c.key === "2026-10-01");
  assert.equal(firstDay.off, false);
  assert.equal(oct.filter((c) => !c.off).length, 31);
  // 2026-08: 1st is Saturday (lead 5), 31 days → 36 → 42 cells.
  const aug = monthCells("2026-08-15");
  assert.equal(aug.length, 42);
  assert.equal(aug.filter((c) => !c.off).length, 31);
  assert.equal(aug[aug.length - 1].off, true);
  // 2026-02 (28 days, 1st Sunday → lead 6): 34 → 35 cells.
  assert.equal(monthCells("2026-02-10").length, 35);
});

test("todayKey/isoToDayKey honour the zone; moveIsoToDay keeps wall clock", () => {
  // 2026-10-19T20:00:00Z is already 2026-10-20 in Asia/Shanghai.
  assert.equal(isoToDayKey("2026-10-19T20:00:00.000Z", "Asia/Shanghai"), "2026-10-20");
  assert.equal(isoToDayKey("2026-10-19T20:00:00.000Z", "UTC"), "2026-10-19");
  assert.equal(isoToDayKey("not-a-date", "Asia/Shanghai"), "");
  const moved = moveIsoToDay("2026-10-21T02:30:00.000Z", "Asia/Shanghai", "2026-11-05");
  assert.equal(isoToDayKey(moved, "Asia/Shanghai"), "2026-11-05");
  // 02:30Z == 10:30 in Shanghai; the moved instant keeps that wall clock.
  const wall = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(moved));
  assert.equal(wall, "10:30");
});

test("buildEvents derives calendar events only from real author plans", () => {
  const events = buildEvents({
    topics: [
      { id: "tp_a", targetDate: "2026-10-21", title: "公众号待发布稿", status: "confirmed", projectId: null },
      { id: "tp_b", targetDate: "", title: "未排期选题", status: "draft" },
      { id: "tp_c", targetDate: "2026-10-22", title: "已搁置选题", status: "dismissed" },
      { id: "tp_d", targetDate: "2026-13-99", title: "坏日期不入历", status: "draft" },
      { id: "tp_e", targetDate: "2026-10-21", title: "已开写", status: "writing", projectId: "ep_1" },
    ],
    series: [
      {
        id: "sr_1",
        status: "active",
        nextRunAt: "2026-10-24T02:00:00.000Z",
        timezone: "Asia/Shanghai",
        cadenceDays: 7,
        name: "独立开发者的真实工作流",
        entries: [{ status: "pending", topic: { title: "下一篇：小而确定的工具" } }],
      },
      { id: "sr_2", status: "paused", nextRunAt: "2026-10-25T02:00:00.000Z", timezone: "Asia/Shanghai", entries: [] },
    ],
  });
  const map = eventsByDate(events);
  // 10-21: two topic plans; dismissed/undated/invalid never appear.
  assert.deepEqual(
    map.get("2026-10-21").map((e) => [e.kind, e.id]),
    [["topic", "tp_a"], ["topic", "tp_e"]]
  );
  // 10-24 (10:00 Shanghai) series prep; paused series excluded.
  assert.equal(map.get("2026-10-24").length, 1);
  assert.equal(map.get("2026-10-24")[0].kind, "series");
  assert.equal(map.get("2026-10-24")[0].nextEntryTitle, "下一篇：小而确定的工具");
  assert.equal(map.get("2026-10-22"), undefined);
  assert.equal(map.get("2026-10-25"), undefined);
  // toolbar pill over the design week (19–25): 3 events.
  assert.equal(periodPill(weekOf("2026-10-21"), map), "3 项计划");
  assert.equal(periodPill(weekOf("2026-11-02"), map), "暂无排期");
});

test("dayCopy keeps the honest empty-state wording", () => {
  const empty = dayCopy("2026-10-20", []);
  assert.equal(empty.empty, true);
  assert.ok(empty.heading.includes("10 月 20 日"));
  assert.match(empty.hint, /还没有已排定的计划/);
  const full = dayCopy("2026-10-21", [{ kind: "topic" }]);
  assert.equal(full.empty, false);
  assert.match(full.hint, /不会自动生成或发布/);
});

test("describeSeries exposes only real series fields", () => {
  const s = describeSeries({
    id: "sr_1",
    revision: 3,
    name: "独立开发者的真实工作流",
    goal: "持续输出",
    status: "active",
    timezone: "Asia/Shanghai",
    cadenceDays: 7,
    nextRunAt: "2026-10-24T02:00:00.000Z",
    entries: [
      { status: "writing", topic: { title: "已开始" } },
      { status: "pending", topic: { title: "待确认篇" } },
    ],
  });
  assert.equal(s.statusLabel, "计划中");
  assert.equal(s.nextRunKey, "2026-10-24");
  assert.equal(s.nextRunAt, "2026-10-24T02:00:00.000Z"); // 原始 ISO 供 moveIsoToDay 使用
  assert.equal(s.timezone, "Asia/Shanghai");
  assert.equal(s.nextEntryTitle, "待确认篇");
  assert.equal(s.pendingCount, 1);
});

test("todayKey tracks the Shanghai calendar day", () => {
  assert.equal(todayKey("Asia/Shanghai", new Date("2026-10-19T20:00:00.000Z")), "2026-10-20");
  assert.equal(todayKey("Asia/Shanghai", new Date("2026-10-19T15:00:00.000Z")), "2026-10-19");
});

// ── Real backend adaptation: targetDate on creator_topics ────────────────

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

test("topics persist targetDate through the real API with conflict protection", async () => {
  const root = mkdtempSync(join(tmpdir(), "studio-calendar-"));
  let core = createCore(join(root, "data.sqlite"));
  try {
    const created = await request("POST", "/api/creator/topics", {
      title: "内容日历排期的选题",
      targetDate: "2026-10-21",
      reason: "内容日历安排",
    }, core);
    assert.equal(created.status, 201);
    const topic = await created.json();
    assert.equal(topic.targetDate, "2026-10-21");

    const listed = await request("GET", "/api/creator/topics", undefined, core);
    const listedTopic = (await listed.json()).topics.find((t) => t.id === topic.id);
    assert.equal(listedTopic.targetDate, "2026-10-21");

    // 修订冲突保护仍然生效（expectedRevision 不匹配 → 409）。
    const conflict = await request("PUT", "/api/creator/topics/" + topic.id, {
      expectedRevision: topic.revision + 5,
      targetDate: "2026-10-22",
    }, core);
    assert.equal(conflict.status, 409);

    // 正确修订号可改期；历史记录保留变更轨迹。
    const moved = await request("PUT", "/api/creator/topics/" + topic.id, {
      expectedRevision: topic.revision,
      targetDate: "2026-10-22",
    }, core);
    assert.equal((await moved.json()).targetDate, "2026-10-22");
    const history = await request(
      "GET",
      "/api/creator/topics/" + topic.id + "/history",
      undefined,
      core
    );
    assert.deepEqual((await history.json()).history.map((h) => h.data.targetDate), [
      "2026-10-22",
      "2026-10-21",
    ]);

    // 可清空排期；清空后事件不再出现（buildEvents 消费同一载荷）。
    const cleared = await request("PUT", "/api/creator/topics/" + topic.id, {
      expectedRevision: topic.revision + 1,
      targetDate: "",
    }, core);
    const clearedTopic = await cleared.json();
    assert.equal(clearedTopic.targetDate, "");
    assert.equal(
      buildEvents({ topics: [clearedTopic], series: [] }).length,
      0
    );
  } finally {
    core.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid schedule dates fail closed with actionable errors", async () => {
  const root = mkdtempSync(join(tmpdir(), "studio-calendar-bad-"));
  let core = createCore(join(root, "data.sqlite"));
  try {
    for (const bad of ["2026-13-01", "21/10/2026", "2026-02-30", 123, "2026-10-21T00:00:00Z"]) {
      const res = await request("POST", "/api/creator/topics", {
        title: "坏日期应被拒绝",
        targetDate: bad,
      }, core);
      assert.equal(res.status, 400, "expected 400 for " + JSON.stringify(bad));
      assert.match((await res.json()).error, /排期日期/);
    }
    // 不带日期的常规创建不受影响（默认未排期）。
    const ok = await request(
      "POST",
      "/api/creator/topics",
      { title: "普通选题没有日期" },
      core
    );
    assert.equal(ok.status, 201);
    assert.equal((await ok.json()).targetDate, "");
  } finally {
    core.close();
    rmSync(root, { recursive: true, force: true });
  }
});

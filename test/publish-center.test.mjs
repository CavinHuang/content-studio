import test from "node:test";
import assert from "node:assert/strict";
import {
  CHECK_ORDER,
  PUBLISH_CHANNELS,
  channelState,
  publishState,
  buildDeliveryTimeline,
  previewBlocks,
  previewReady,
} from "../src/publish-center.mjs";
import { SEED_PARAGRAPH_TEXT } from "../src/seed-paragraph.mjs";

const channel = (over = {}) => ({
  status: "draft",
  checks: { factual: false, privacy: false, rights: false, layout: false },
  masterOutdated: false,
  openCorrections: 0,
  document: { revision: 1, paragraphs: [{ id: "p1", text: "正文第一段，足够长。" }] },
  ...over,
});

const project = (over = {}) => ({
  id: "ep_1",
  title: "桌面 AI Agent 的价值",
  channels: {
    master: { referenceId: "cr_m", document: { revision: 3 }, openCorrections: 0 },
    wechat: channel(),
    zhihu: channel(),
  },
  ...over,
});

test("channelState maps the four domain check keys and flips the status tag", () => {
  const fresh = channelState(channel());
  assert.equal(fresh.done, 0);
  assert.equal(fresh.allChecked, false);
  assert.deepEqual(fresh.statusTag, { label: "待确认", tone: "warning" });

  const partial = channelState(
    channel({ checks: { factual: true, privacy: true, rights: false, layout: false } })
  );
  assert.equal(partial.done, 2);
  assert.equal(partial.allChecked, false);

  const done = channelState(
    channel({ checks: { factual: true, privacy: true, rights: true, layout: true } })
  );
  assert.deepEqual(done.statusTag, { label: "检查完成", tone: "success" });
});

test("channelState surfaces only real export blockers", () => {
  const base = channelState(channel());
  assert.deepEqual(base.blockers, []);
  const stale = channelState(channel({ masterOutdated: true, openCorrections: 2 }));
  assert.deepEqual(stale.blockers, ["主稿更新后尚未复核渠道稿", "存在 2 项待处理的更正任务"]);
  const seedOnly = channelState(
    channel({ document: { revision: 1, paragraphs: [{ id: "p1", text: SEED_PARAGRAPH_TEXT }] } })
  );
  assert.ok(seedOnly.blockers.includes("渠道稿还没有正文（仍是初始段落）"));
});

test("publishState pill follows both channels' real checkboxes", () => {
  assert.deepEqual(publishState(project()).pill, { label: "有检查项未完成", tone: "warning" });
  const allDone = project({
    channels: {
      master: { document: { revision: 1 } },
      wechat: channel({ checks: { factual: true, privacy: true, rights: true, layout: true } }),
      zhihu: channel({ checks: { factual: true, privacy: true, rights: true, layout: true } }),
    },
  });
  assert.deepEqual(publishState(allDone).pill, { label: "两渠道检查已完成", tone: "success" });
});

test("delivery timeline: fresh project keeps 真实发布状态尚未确认 pending", () => {
  const rows = buildDeliveryTimeline({ project: project(), history: { operations: [], facts: [] } });
  assert.equal(rows[0].title, "已准备主稿与平台版本");
  assert.ok(rows[0].detail.includes("主稿 v3"));
  assert.ok(rows.some((r) => r.tone === "pending" && r.title === "等待完成发布前核查"));
  const last = rows.at(-1);
  assert.equal(last.tone, "pending");
  assert.equal(last.title, "真实发布状态尚未确认");
});

test("delivery timeline rows come only from real facts and operations", () => {
  const p = project({
    channels: {
      master: { document: { revision: 4 } },
      wechat: channel({ checks: { factual: true, privacy: true, rights: true, layout: true } }),
      zhihu: channel(),
    },
  });
  const history = {
    operations: [
      {
        id: "po_1",
        channel: "wechat",
        revision: 2,
        state: "outcome_unknown",
        detail: "微信发送结果待核实，不会自动重试",
        createdAt: "2026-10-19T02:00:00.000Z",
        updatedAt: "2026-10-19T02:01:00.000Z",
      },
    ],
    facts: [
      {
        id: "pf_1",
        channel: "wechat",
        revision: 2,
        kind: "exported",
        evidence: "local_export",
        value: {},
        createdAt: "2026-10-19T01:00:00.000Z",
      },
      {
        id: "pf_2",
        channel: "wechat",
        revision: 2,
        kind: "published",
        evidence: "author_report",
        value: { url: "https://mp.example.test/s/1", platformVerified: false },
        createdAt: "2026-10-19T03:00:00.000Z",
      },
    ],
  };
  const rows = buildDeliveryTimeline({ project: p, history });
  const titles = rows.map((r) => r.title);
  assert.ok(titles.includes("人工核查完成：微信公众号"));
  // zhihu is still unchecked in this fixture → the pending row stays, with real counts
  const pendingChecks = rows.find((r) => r.title === "等待完成发布前核查");
  assert.ok(pendingChecks.detail.includes("公众号 4/4"));
  assert.ok(pendingChecks.detail.includes("知乎 0/4"));
  // facts chronological ascending
  const factTitles = titles.filter((t) => t.includes("已导出") || t.includes("作者报告"));
  assert.deepEqual(factTitles, ["已导出本地交付包", "作者报告已发表（未经平台核验）"]);
  const publishedRow = rows.find((r) => r.kind === undefined && r.title.includes("作者报告"));
  assert.ok(publishedRow.detail.includes("https://mp.example.test/s/1"));
  assert.ok(publishedRow.detail.includes("平台未独立核验"));
  const opRow = rows.find((r) => r.operationId === "po_1");
  assert.equal(opRow.tone, "pending");
  assert.ok(opRow.title.includes("发送结果待核实"));
  // a real author_report fact clears the pending 真实发布状态尚未确认 row
  assert.ok(!titles.includes("真实发布状态尚未确认"));
});

test("succeeded draft operation is not duplicated next to its draft_saved fact", () => {
  const history = {
    operations: [
      {
        id: "po_2",
        channel: "wechat",
        revision: 1,
        state: "succeeded",
        detail: "Draft saved; not published",
        createdAt: "2026-10-19T02:00:00.000Z",
        updatedAt: "2026-10-19T02:00:00.000Z",
      },
    ],
    facts: [
      {
        id: "pf_3",
        channel: "wechat",
        revision: 1,
        kind: "draft_saved",
        evidence: "provider_response",
        value: { mediaId: "MEDIA_1" },
        createdAt: "2026-10-19T02:00:00.000Z",
      },
    ],
  };
  const rows = buildDeliveryTimeline({ project: project(), history });
  assert.equal(rows.filter((r) => r.title.includes("公众号草稿已保存")).length, 1);
  assert.ok(!rows.some((r) => r.title.includes("草稿发送")));
  const factRow = rows.find((r) => r.title === "公众号草稿已保存");
  assert.ok(factRow.detail.includes("MEDIA_1"));
  assert.ok(factRow.detail.includes("草稿保存不是发布"));
});

test("previewBlocks renders the real channel markdown without loading remote content", () => {
  const md = [
    "# 标题",
    "",
    "第一段 **加粗** 与 [链接文字](https://example.test)。",
    "",
    "> 引用一句",
    "",
    "- 列表项 `code`",
    "![封面](asset://as_1)",
    "![外链](https://cdn.example.test/x.png)",
  ].join("\n");
  const blocks = previewBlocks(md);
  assert.deepEqual(blocks[0], { type: "h", text: "标题" });
  assert.equal(blocks[1].type, "p");
  assert.equal(blocks[1].text, "第一段 加粗 与 链接文字。");
  assert.deepEqual(blocks[2], { type: "quote", text: "引用一句" });
  assert.deepEqual(blocks[3], { type: "li", text: "列表项 code" });
  assert.deepEqual(blocks[4], { type: "image", alt: "封面", local: true });
  assert.deepEqual(blocks[5], { type: "image", alt: "外链", local: false });
  assert.deepEqual(previewBlocks(""), []);
  assert.deepEqual(previewBlocks(undefined), []);
  assert.ok(previewBlocks(md, { limit: 3 }).length <= 3);
});

test("previewReady requires real content beyond the untouched seed paragraph", () => {
  assert.equal(previewReady(channel()), true);
  assert.equal(
    previewReady(channel({ document: { revision: 1, paragraphs: [{ id: "p1", text: SEED_PARAGRAPH_TEXT }] } })),
    false
  );
  assert.equal(previewReady(undefined), false);
});

test("check labels stay channel-specific over the same four domain keys", () => {
  assert.equal(PUBLISH_CHANNELS.length, 2);
  for (const meta of PUBLISH_CHANNELS) {
    assert.deepEqual(Object.keys(meta.checkLabels), CHECK_ORDER);
  }
  assert.equal(PUBLISH_CHANNELS[0].checkLabels.factual, "事实、数据与引用来源");
  assert.equal(PUBLISH_CHANNELS[1].checkLabels.factual, "关键观点与资料出处");
});

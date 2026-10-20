import test from "node:test";
import assert from "node:assert/strict";
import {
  WORK_STAGES,
  buildWorksLibrary,
  channelHasContent,
  describeWork,
  filterWorks,
  worksStage,
} from "../src/works-library.mjs";
import { SEED_PARAGRAPH_TEXT } from "../src/seed-paragraph.mjs";

const CHECKS = { factual: false, privacy: false, rights: false, layout: false };
const CHECKS_DONE = { factual: true, privacy: true, rights: true, layout: true };

const project = (over = {}) => ({
  id: "ep_1",
  title: "桌面 AI Agent 的真正价值",
  updatedAt: "2026-10-19T10:00:00.000Z",
  channels: {
    master: { referenceId: "cr_m", document: { revision: 2, paragraphs: [] }, openCorrections: 0 },
    wechat: {
      referenceId: "cr_w",
      status: "draft",
      statusLabel: "草稿",
      document: { revision: 1, paragraphs: [] },
      checks: { ...CHECKS },
      masterOutdated: false,
      openCorrections: 0,
    },
    zhihu: {
      referenceId: "cr_z",
      status: "draft",
      statusLabel: "草稿",
      document: { revision: 1, paragraphs: [] },
      checks: { ...CHECKS },
      masterOutdated: false,
      openCorrections: 0,
    },
  },
  ...over,
});

test("fresh projects land in 草稿中 with an honest no-content subtitle", () => {
  const stage = worksStage(project());
  assert.deepEqual(stage, { key: "draft", label: "草稿中", tone: "info" });
  const work = describeWork(project());
  assert.equal(work.subtitle, "还没有正文；从主稿开始写");
  assert.deepEqual(
    work.channelTags.map((t) => t.name),
    ["主稿", "公众号", "知乎"]
  );
  assert.ok(work.channelTags[0].title.includes("修订 v2"));
  assert.ok(work.channelTags[1].title.includes("草稿"));
});

test("open master corrections move a work to 审稿中 and say what is being checked", () => {
  const p = project({
    channels: {
      ...project().channels,
      master: { referenceId: "cr_m", document: { revision: 3, paragraphs: [] }, openCorrections: 2 },
    },
  });
  assert.equal(worksStage(p).key, "review");
  assert.ok(describeWork(p).subtitle.includes("正在核对主稿的 2 处事实"));
});

test("partially completed channel checks are a review signal naming the channel", () => {
  const p = project({
    channels: {
      ...project().channels,
      wechat: {
        ...project().channels.wechat,
        checks: { factual: true, privacy: true, rights: false, layout: false },
      },
    },
  });
  assert.equal(worksStage(p).key, "review");
  assert.ok(describeWork(p).subtitle.includes("公众号稿人工检查进行中（2/4）"));
});

test("master-outdated platform drafts count as review only with real content, not the seed paragraph", () => {
  const real = project({
    channels: {
      ...project().channels,
      zhihu: {
        ...project().channels.zhihu,
        document: { revision: 1, paragraphs: [{ id: "p1", text: "知乎稿已有的一段真实内容。" }] },
        masterOutdated: true,
      },
    },
  });
  assert.equal(worksStage(real).key, "review");
  assert.ok(describeWork(real).subtitle.includes("知乎稿落后于主稿"));

  const seeded = project({
    channels: {
      ...project().channels,
      zhihu: {
        ...project().channels.zhihu,
        document: { revision: 1, paragraphs: [{ id: "p_seed", text: SEED_PARAGRAPH_TEXT }] },
        masterOutdated: true,
      },
    },
  });
  assert.equal(worksStage(seeded).key, "draft");
});

test("exported channels are 待发布 and the subtitle keeps 导出≠发布 explicit", () => {
  const p = project({
    channels: {
      ...project().channels,
      wechat: {
        ...project().channels.wechat,
        status: "exported",
        statusLabel: "已导出（不是已发表）",
        checks: { ...CHECKS_DONE },
      },
    },
  });
  const stage = worksStage(p);
  assert.equal(stage.key, "ready");
  assert.equal(stage.tone, "warning");
  const work = describeWork(p);
  assert.ok(work.subtitle.includes("公众号稿已导出"));
  assert.ok(work.subtitle.includes("导出不等于已发布"));
  assert.ok(!work.subtitle.includes("已发表"));
});

test("author-reported publication is the 已发布 bucket but stays explicitly unverified", () => {
  const p = project({
    channels: {
      ...project().channels,
      wechat: {
        ...project().channels.wechat,
        status: "reported_published",
        statusLabel: "作者报告已发表（未经平台核验）",
        checks: { ...CHECKS_DONE },
      },
    },
  });
  const stage = worksStage(p);
  assert.equal(stage.key, "published");
  assert.equal(stage.tone, "success");
  const work = describeWork(p);
  assert.ok(work.stage.label.includes("未核验"));
  assert.ok(work.subtitle.includes("作者报告已发表（未经平台核验）"));
});

test("reported publication outranks exported; exported outranks review signals", () => {
  const both = project({
    channels: {
      ...project().channels,
      wechat: { ...project().channels.wechat, status: "exported" },
      zhihu: { ...project().channels.zhihu, status: "reported_published" },
    },
  });
  assert.equal(worksStage(both).key, "published");
  const exportedAndReview = project({
    channels: {
      ...project().channels,
      master: { referenceId: "cr_m", document: { revision: 2, paragraphs: [] }, openCorrections: 1 },
      wechat: { ...project().channels.wechat, status: "exported" },
    },
  });
  assert.equal(worksStage(exportedAndReview).key, "ready");
});

test("pipeline counts are the real totals across all five buckets", () => {
  const works = [
    project({ id: "ep_1" }),
    project({ id: "ep_2", title: "审稿中的作品", channels: { ...project().channels, master: { referenceId: "cr_m", document: { revision: 2, paragraphs: [] }, openCorrections: 1 } } }),
    project({ id: "ep_3", title: "待发布的作品", channels: { ...project().channels, wechat: { ...project().channels.wechat, status: "exported" } } }),
    project({ id: "ep_4", title: "已发布的作品", channels: { ...project().channels, zhihu: { ...project().channels.zhihu, status: "reported_published" } } }),
  ];
  const lib = buildWorksLibrary({ projects: works });
  assert.deepEqual(lib.counts, { all: 4, draft: 1, review: 1, ready: 1, published: 1 });
  assert.equal(lib.works.length, 4);
  assert.equal(lib.visible.length, 4);
});

test("stage filter and search narrow the visible list without touching counts", () => {
  const works = buildWorksLibrary({
    projects: [
      project({ id: "ep_1", title: "桌面 AI Agent 的行动闭环" }),
      project({ id: "ep_2", title: "一个人做产品的三种成本", channels: { ...project().channels, wechat: { ...project().channels.wechat, status: "exported" } } }),
    ],
  });
  const ready = filterWorks(works.works, { stage: "ready" });
  assert.equal(ready.length, 1);
  assert.equal(ready[0].id, "ep_2");
  const searched = filterWorks(works.works, { query: "成本" });
  assert.equal(searched.length, 1);
  assert.equal(searched[0].id, "ep_2");
  const caseInsensitive = filterWorks(works.works, { query: "  AI AGENT " });
  assert.equal(caseInsensitive.length, 1);
  assert.equal(caseInsensitive[0].id, "ep_1");
  const both = buildWorksLibrary({ stage: "ready", query: "成本", projects: [
    project({ id: "ep_1", title: "桌面 AI Agent 的行动闭环" }),
    project({ id: "ep_2", title: "一个人做产品的三种成本", channels: { ...project().channels, wechat: { ...project().channels.wechat, status: "exported" } } }),
  ] });
  assert.equal(both.counts.all, 2);
  assert.equal(both.visible.length, 1);
});

test("an empty library yields honest zeros and empty visibility", () => {
  const lib = buildWorksLibrary({});
  assert.deepEqual(lib.counts, { all: 0, draft: 0, review: 0, ready: 0, published: 0 });
  assert.deepEqual(lib.works, []);
  assert.deepEqual(lib.visible, []);
});

test("work stage table keeps the five design buckets with their hints", () => {
  assert.deepEqual(
    WORK_STAGES.map((s) => [s.key, s.label, s.hint]),
    [
      ["all", "全部", "所有作品"],
      ["draft", "草稿中", "整理思路"],
      ["review", "审稿中", "验证事实"],
      ["ready", "待发布", "等待确认"],
      ["published", "已发布", "观察表现"],
    ]
  );
});

test("channelHasContent distinguishes real paragraphs from the untouched seed", () => {
  assert.equal(channelHasContent({ document: { paragraphs: [] } }), false);
  assert.equal(
    channelHasContent({ document: { paragraphs: [{ id: "p", text: SEED_PARAGRAPH_TEXT }] } }),
    false
  );
  assert.equal(
    channelHasContent({ document: { paragraphs: [{ id: "p", text: "真实段落内容" }] } }),
    true
  );
  assert.equal(channelHasContent(undefined), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCore } from "../lib/core.mjs";
import { dispatchApi } from "../lib/api.mjs";
import {
  LIBRARY_COLLECTIONS,
  LIBRARY_KIND_CHIPS,
  collectionByKey,
  collectionPlaceholder,
  describeEntry,
  emptyCopy,
} from "../src/library-view.mjs";

const entry = (over = {}) => ({
  id: "mt_1",
  kind: "material",
  title: "研究素材",
  text: "正文摘录",
  url: "",
  tags: [],
  createdAt: "2026-10-19T00:00:00.000Z",
  archived: false,
  usage: [],
  series: [],
  platforms: [],
  ...over,
});

test("collections and chips map onto the real library kind parameter", () => {
  // 设计 :182 三张集合格 / :163 四个 chip — 全部落到既有 API 的 kind 值
  assert.deepEqual(
    LIBRARY_COLLECTIONS.map((c) => [c.key, c.kind]),
    [
      ["all", ""],
      ["links", "material"],
      ["visual", "image"],
    ]
  );
  assert.deepEqual(
    LIBRARY_KIND_CHIPS.map((c) => [c.key, c.kind]),
    [
      ["all", ""],
      ["article", "article"],
      ["material", "material"],
      ["image", "image"],
    ]
  );
  assert.equal(collectionByKey("links").name, "参考线索");
  assert.equal(collectionByKey("unknown"), LIBRARY_COLLECTIONS[0]);
});

test("search placeholder follows the design's collection linkage", () => {
  assert.equal(collectionPlaceholder("all"), "搜索素材或作品…");
  assert.equal(collectionPlaceholder("links"), "在「参考线索」中搜索…");
  assert.equal(collectionPlaceholder("visual"), "在「视觉素材」中搜索…");
});

test("describeEntry maps real kinds onto the four design card types", () => {
  // 公开线索 = 带 url 的素材；研究资料 = 笔记/文件素材
  const link = describeEntry(entry({ url: "https://example.test/a" }));
  assert.equal(link.typeTag, "公开线索");
  assert.equal(link.icon, "link");
  assert.equal(link.variant, "two");
  assert.equal(link.subtitle, "公开来源 · 等待核实");

  const note = describeEntry(entry({ url: "" }));
  assert.equal(note.typeTag, "研究资料");
  assert.equal(note.icon, "book");
  assert.equal(note.variant, "one");

  const article = describeEntry(
    entry({ kind: "article", id: "ep_1", platforms: ["wechat", "zhihu"] })
  );
  assert.equal(article.typeTag, "作品参考");
  assert.equal(article.icon, "file");
  assert.equal(article.variant, "one");

  const image = describeEntry(entry({ kind: "image", id: "as_1" }));
  assert.equal(image.typeTag, "视觉资产");
  assert.equal(image.icon, "image");
  assert.equal(image.variant, "three");
});

test("subtitles come only from real usage/platform fields, never invented counts", () => {
  // 无引用时如实说明，不编造数字
  assert.equal(describeEntry(entry()).subtitle, "参考素材 · 尚未被作品引用");
  assert.equal(describeEntry(entry({ kind: "image" })).subtitle, "尚未被作品使用");
  assert.equal(describeEntry(entry({ kind: "article" })).subtitle, "主稿可继续创作");
  assert.equal(
    describeEntry(entry({ kind: "article", platforms: ["xiaohongshu"] })).subtitle,
    "已有渠道稿：小红书"
  );
  // usage 行数即真实的被引用次数
  const used = describeEntry(
    entry({ usage: [{ projectId: "ep_1", revision: 2 }, { projectId: "ep_2", revision: 1 }] })
  );
  assert.equal(used.subtitle, "已关联 2 篇作品");
  assert.equal(used.usageCount, 2);
});

test("emptyCopy keeps filtered, archived and first-use cases honest", () => {
  assert.equal(emptyCopy({}).title, "素材库还是空的");
  assert.equal(emptyCopy({ hasQuery: true }).title, "没有匹配的素材");
  assert.equal(emptyCopy({ kind: "image" }).title, "没有匹配的素材");
  assert.equal(emptyCopy({ archived: true }).title, "没有已归档的素材");
});

test("visualSeriesOverview lists existing series read-only without leaking assets", (t) => {
  const root = mkdtempSync(join(tmpdir(), "studio-library-test-"));
  const core = createCore(join(root, "studio.sqlite"));
  t.after(() => {
    core.close();
    rmSync(root, { recursive: true, force: true });
  });
  assert.deepEqual(core.creator.visualSeriesOverview().series, []);

  const d = core.writing.create({ title: "系列所属作品" });
  const series = core.illustrations.series.create(d.projectId, {
    name: "统一视觉系列",
    profile: { name: "克制科技", palette: "蓝紫", mood: "可信", avoid: "虚假截图" },
  });
  // 再建一篇未入系列的作品，确认总览仍只报系列本身
  core.writing.create({ title: "无关作品" });
  const { series: rows } = core.creator.visualSeriesOverview();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, series.id);
  assert.equal(rows[0].name, "统一视觉系列");
  assert.equal(rows[0].memberCount, 1);
  assert.equal(rows[0].ownerTitle, "系列所属作品");
  assert.equal(rows[0].ownerProjectId, d.projectId);
  assert.ok(rows[0].revision >= 1);
  // 只读总览绝不携带图片资产、引用内容或偏好（这些仍须成员身份）
  assert.deepEqual(
    Object.keys(rows[0]).sort(),
    ["id", "memberCount", "name", "ownerProjectId", "ownerTitle", "revision", "updatedAt"].sort()
  );
  // 既有能力不回退：成员视角的 view() 仍须 membership，list() 仍按项目
  assert.throws(() => core.illustrations.series.view(d.projectId + "_x"), e => e.status === 404);
});

test("GET /api/creator/library/visual-series serves the overview through the V58 boundary", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "studio-library-route-"));
  const core = createCore(join(root, "studio.sqlite"));
  t.after(() => {
    core.close();
    rmSync(root, { recursive: true, force: true });
  });
  const d = core.writing.create({ title: "路由验证作品" });
  core.illustrations.series.create(d.projectId, {
    name: "路由验证系列",
    profile: { name: "杂志叙事", palette: "暖白", mood: "克制", avoid: "夸张" },
  });
  const r = await dispatchApi(
    new Request("http://127.0.0.1:4312/api/creator/library/visual-series"),
    core
  );
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.series.length, 1);
  assert.equal(body.series[0].name, "路由验证系列");
  assert.equal(body.series[0].ownerTitle, "路由验证作品");
  // 只读端点：未匹配的写方法必须被拒绝（fail-closed 404）
  const blocked = await dispatchApi(
    new Request("http://127.0.0.1:4312/api/creator/library/visual-series", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    core
  );
  assert.equal(blocked.status, 404);
});

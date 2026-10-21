import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkSummary,
  composeSteps,
  outlineItems,
  parseStage,
  shotTitle,
  slotView,
} from "../src/compose-view.mjs";

test("composeSteps derives done/now only from real backend facts", () => {
  // Empty new draft: 大纲 is the honest current step, nothing is "done".
  assert.deepEqual(composeSteps({}), [
    { label: "研究", state: "todo" },
    { label: "大纲", state: "now" },
    { label: "写作", state: "todo" },
    { label: "审稿", state: "todo" },
    { label: "配图", state: "todo" },
    { label: "发布", state: "todo" },
  ]);
  // Brief + outline present: writing becomes the current step.
  assert.deepEqual(composeSteps({ hasBrief: true, hasOutline: true }), [
    { label: "研究", state: "done" },
    { label: "大纲", state: "done" },
    { label: "写作", state: "now" },
    { label: "审稿", state: "todo" },
    { label: "配图", state: "todo" },
    { label: "发布", state: "todo" },
  ]);
  // A decided suggestion and an inserted asset:// image are real facts.
  const steps = composeSteps({
    hasBrief: true,
    hasOutline: true,
    hasDecidedSuggestions: true,
    hasInsertedImages: true,
  });
  assert.deepEqual(
    steps.map((s) => s.state),
    ["done", "done", "now", "done", "done", "todo"]
  );
  // 发布 never claims completion: the writing document carries no export
  // or author-report facts, so the last step stays a plain number.
  assert.equal(steps.at(-1).state, "todo");
});

test("composeSteps rejects non-boolean input instead of guessing", () => {
  assert.throws(() => composeSteps({ hasBrief: 1 }), TypeError);
  assert.throws(() => composeSteps({ hasOutline: "yes" }), TypeError);
});

test("outlineItems reads real markdown headings with level and cap", () => {
  const markdown = [
    "# 主标题",
    "",
    "正文段落，不是标题。",
    "##第一节缺空格不算",
    "## 第二节",
    "### 小节 · 附注 #",
    "####更深层",
    "## 第三节",
  ].join("\n");
  assert.deepEqual(outlineItems(markdown), [
    { level: 1, text: "主标题" },
    { level: 2, text: "第二节" },
    { level: 3, text: "小节 · 附注" },
    { level: 2, text: "第三节" },
  ]);
  assert.deepEqual(outlineItems(markdown, 2), [
    { level: 1, text: "主标题" },
    { level: 2, text: "第二节" },
  ]);
  assert.deepEqual(outlineItems(""), []);
  assert.deepEqual(outlineItems(null), []);
  // Over-long headings are truncated for the narrow rail.
  const long = "# " + "长".repeat(120);
  assert.equal(outlineItems(long)[0].text.length, 80);
});

test("checkSummary counts the four per-channel manual checks honestly", () => {
  assert.deepEqual(checkSummary(undefined), {
    done: 0,
    total: 4,
    complete: false,
  });
  assert.deepEqual(
    checkSummary({ factual: true, privacy: true, rights: false, layout: false }),
    { done: 2, total: 4, complete: false }
  );
  assert.deepEqual(
    checkSummary({ factual: true, privacy: true, rights: true, layout: true }),
    { done: 4, total: 4, complete: true }
  );
});

test("slotView maps real shot statuses without inventing states", () => {
  assert.deepEqual(slotView("planned"), { label: "待生成", tone: "warning" });
  assert.deepEqual(slotView("generating"), { label: "正在生成", tone: "info" });
  assert.deepEqual(slotView("generated"), { label: "待审阅", tone: "info" });
  assert.deepEqual(slotView("approved"), { label: "已选用", tone: "success" });
  assert.deepEqual(slotView("failed"), { label: "生成失败", tone: "error" });
  assert.deepEqual(slotView("rejected"), { label: "已拒绝", tone: "default" });
  assert.deepEqual(slotView("mystery"), { label: "mystery", tone: "default" });
  assert.deepEqual(slotView(""), { label: "未知", tone: "default" });
});

test("parseStage keeps the five-stage whitelist and falls back to write", () => {
  // 白名单五个焦点视图原样通过。
  for (const s of ["research", "write", "review", "images", "publish"])
    assert.equal(parseStage(s), s);
  // 非法值（伪造参数、手输、大小写、尾随空白）一律安全落回写作阶段。
  assert.equal(parseStage("publishx"), "write");
  assert.equal(parseStage("PUBLISH"), "write");
  assert.equal(parseStage("write "), "write");
  assert.equal(parseStage("../write"), "write");
  // 缺省（?stage= 不存在或为空）也是写作阶段：缺省即 write。
  assert.equal(parseStage(""), "write");
  assert.equal(parseStage(null), "write");
  assert.equal(parseStage(undefined), "write");
});

test("shotTitle keeps cover and numbered section figures apart", () => {
  assert.equal(shotTitle({ role: "cover", ordinal: 1 }), "文章封面");
  assert.equal(shotTitle({ role: "section", ordinal: 2 }), "正文配图 02");
  assert.equal(shotTitle(null), "配图");
});

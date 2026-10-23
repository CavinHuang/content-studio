import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeOutlineIndex,
  checkSummary,
  composeSteps,
  markdownLineOffsets,
  outlineItems,
  parseStage,
  readinessFacts,
  shotTitle,
  slotView,
  suggestionCompareView,
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

test("outlineItems reads real markdown headings with level, line and cap", () => {
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
    { level: 1, text: "主标题", line: 1 },
    { level: 2, text: "第二节", line: 5 },
    { level: 3, text: "小节 · 附注", line: 6 },
    { level: 2, text: "第三节", line: 8 },
  ]);
  assert.deepEqual(outlineItems(markdown, 2), [
    { level: 1, text: "主标题", line: 1 },
    { level: 2, text: "第二节", line: 5 },
  ]);
  assert.deepEqual(outlineItems(""), []);
  assert.deepEqual(outlineItems(null), []);
  // Over-long headings are truncated for the narrow rail.
  const long = "# " + "长".repeat(120);
  assert.equal(outlineItems(long)[0].text.length, 80);
  assert.equal(outlineItems(long)[0].line, 1);
});

test("markdownLineOffsets 累计每行起始 UTF-16 偏移（多字节与末行无换行）", () => {
  // 多字节（中文 BMP 字符按 1 个码元计）行
  assert.deepEqual(markdownLineOffsets("第一行中文\n第二行"), [0, 6]);
  // 代理对（emoji）按 2 个码元计，与 CodeMirror 的 UTF-16 偏移一致
  assert.deepEqual(markdownLineOffsets("🌲标题\n下一行"), [0, 5]);
  // 末行无换行：最后一项仍然成立，项数等于行数
  const text = "# 标题\n\n段落一\n段落二末行无换行";
  const offsets = markdownLineOffsets(text);
  assert.equal(offsets.length, 4);
  assert.equal(text.slice(offsets[2], offsets[2] + 3), "段落一");
  assert.equal(text.slice(offsets[3]), "段落二末行无换行");
  assert.deepEqual(markdownLineOffsets("单行"), [0]);
  assert.deepEqual(markdownLineOffsets(""), [0]);
  assert.deepEqual(markdownLineOffsets(null), []);
});

test("activeOutlineIndex 覆盖标题前/标题行上/两标题之间/空文档四种位置", () => {
  const markdown = "# 甲\n\n正文。\n\n## 乙\n\n更多正文。";
  const items = outlineItems(markdown);
  const offsets = markdownLineOffsets(markdown);
  // 标题前（文档开头，光标在第 0 偏移之前没有标题覆盖）→ -1
  assert.equal(activeOutlineIndex(items, 0, []), -1);
  assert.equal(activeOutlineIndex([], 0, offsets), -1);
  // 光标在第一个标题行行首：起始偏移 0 <= 0，覆盖 → 0
  assert.equal(activeOutlineIndex(items, 0, offsets), 0);
  // 标题行上（第二个标题行首，行 5 起始偏移 offsets[4]）→ 1
  assert.equal(activeOutlineIndex(items, offsets[4], offsets), 1);
  // 两标题之间（第一个标题的正文里）→ 0
  assert.equal(activeOutlineIndex(items, offsets[2], offsets), 0);
  // 文档末尾（最后一个标题之后）→ 1
  assert.equal(activeOutlineIndex(items, markdown.length, offsets), 1);
  // 空文档：无 items → -1
  assert.equal(activeOutlineIndex([], 10, [0]), -1);
});

test("readinessFacts 陈述既有事实，诚实上限是人工检查 4/4 完成", () => {
  // 全 done：简报/大纲/配图就绪、建议已处理、四项检查全勾
  const all = readinessFacts({
    brief: { title: "简报" },
    outlineCount: 3,
    pendingSuggestions: 0,
    decidedSuggestions: 2,
    checks: { factual: true, privacy: true, rights: true, layout: true },
    insertedImages: true,
  });
  assert.deepEqual(
    all.map((f) => f.tone),
    ["good", "good", "info", "good", "good"]
  );
  assert.deepEqual(
    all.map((f) => f.key),
    ["brief", "outline", "suggestions", "checks", "images"]
  );
  assert.equal(
    all.find((f) => f.key === "checks").label,
    "人工检查 4/4 完成（该渠道独立记录）"
  );
  // 诚实性：任何 chip 都不含「已发布/可发布」字样
  for (const f of all) assert.doesNotMatch(f.label, /已发布|可发布/);

  // 空稿：诚实空态 + 检查未完成 warn
  const empty = readinessFacts({});
  assert.deepEqual(
    empty.map((f) => f.tone),
    ["detail", "detail", "detail", "warn", "detail"]
  );
  assert.equal(empty.find((f) => f.key === "outline").label, "大纲尚无标题");
  assert.equal(empty.find((f) => f.key === "brief").label, "研究简报暂无");
  assert.equal(
    empty.find((f) => f.key === "checks").label,
    "待完成人工检查 0/4"
  );
  assert.equal(empty.find((f) => f.key === "images").label, "未插图");

  // 混合：有待采纳建议 warn、检查 1/4 warn、配图计划过期 warn
  const mixed = readinessFacts({
    brief: { title: "简报" },
    outlineCount: 2,
    pendingSuggestions: 3,
    decidedSuggestions: 1,
    checks: { factual: true },
    staleImagePlan: true,
  });
  assert.deepEqual(
    mixed.map((f) => f.tone),
    ["good", "good", "warn", "warn", "warn"]
  );
  assert.equal(
    mixed.find((f) => f.key === "suggestions").label,
    "待采纳建议 3 条"
  );
  assert.equal(
    mixed.find((f) => f.key === "checks").label,
    "待完成人工检查 1/4"
  );
  assert.equal(mixed.find((f) => f.key === "images").label, "计划已过期");

  // 配图三态与 checkSummary 复用（total 可显式传入，缺省取 checkSummary）
  assert.equal(
    readinessFacts({ insertedImages: true }).find((f) => f.key === "images")
      .label,
    "已插图"
  );
  assert.equal(
    readinessFacts({ insertedImages: true, staleImagePlan: true }).find(
      (f) => f.key === "images"
    ).label,
    "已插图"
  );
  const custom = readinessFacts({ checks: { factual: true }, checkTotal: 4 });
  assert.equal(
    custom.find((f) => f.key === "checks").label,
    "待完成人工检查 1/4"
  );
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

// AW-01（Phase 4 切片二）：待审建议卡就地对比的纯派生——四态矩阵。
test("suggestionCompareView 四态：both/replacement-only/original===replacement/revoked 空原文", () => {
  // both：original 为非空字符串且 !== replacement
  assert.deepEqual(suggestionCompareView({ original: "旧句", replacement: "新句" }), {
    mode: "both",
    original: "旧句",
    replacement: "新句",
  });
  // replacement-only：original 缺失（revoked 行撤销置空 ''，src/writing.mjs 投影）
  assert.deepEqual(suggestionCompareView({ original: "", replacement: "新句" }), {
    mode: "replacement-only",
    replacement: "新句",
  });
  // 退化：original === replacement 不伪装对比
  assert.deepEqual(suggestionCompareView({ original: "同句", replacement: "同句" }), {
    mode: "replacement-only",
    replacement: "同句",
  });
  // 双空（异常数据）不伪装对比
  assert.deepEqual(suggestionCompareView({ original: "", replacement: "" }), {
    mode: "replacement-only",
    replacement: "",
  });
  assert.deepEqual(suggestionCompareView(undefined), {
    mode: "replacement-only",
    replacement: undefined,
  });
  // 诚实边界：输出不含「已发布」措辞
  for (const view of [
    suggestionCompareView({ original: "旧句", replacement: "新句" }),
    suggestionCompareView({ original: "", replacement: "新句" }),
  ])
    assert.ok(!JSON.stringify(view).includes("已发布"), "无已发布措辞");
});

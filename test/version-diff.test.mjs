import test from "node:test";
import assert from "node:assert/strict";
import { diffLines, diffSummary } from "../src/version-diff.mjs";

const types = (ops) => ops.map((o) => o.type).join(",");
const textOf = (ops, type) =>
  ops.filter((o) => o.type === type).map((o) => o.text);

test("RD-03 diffLines: identical text collapses to all-same ops", () => {
  const md = "# 标题\n\n第一段。\n";
  const { tooLarge, ops } = diffLines(md, md);
  assert.equal(tooLarge, false);
  assert.ok(ops.length > 0);
  assert.ok(ops.every((o) => o.type === "same"));
  assert.deepEqual(diffSummary(ops), { added: 0, removed: 0 });
});

test("RD-03 diffLines: empty inputs stay honest (single empty line participates)", () => {
  // 空串按行切分是单个空行：与「x」对比 = 删一个空行 + 增一行（不伪造零变化）
  const { tooLarge, ops } = diffLines("", "x");
  assert.equal(tooLarge, false);
  assert.equal(types(ops), "del,add");
  assert.deepEqual(textOf(ops, "del"), [""]);
  assert.deepEqual(textOf(ops, "add"), ["x"]);
  const bothEmpty = diffLines("", "");
  assert.deepEqual(diffSummary(bothEmpty.ops), { added: 0, removed: 0 });
  assert.ok(bothEmpty.ops.every((o) => o.type === "same"));
});

test("RD-03 diffLines: pure insertion and pure deletion", () => {
  // 夹具不带尾随换行：行级 diff 中空行是真实一行，避免噪声参与计数
  const before = "# 标题\n\n第一段。";
  const after = "# 标题\n\n第一段。\n新增的第二段。";
  const ins = diffLines(before, after);
  assert.deepEqual(textOf(ins.ops, "add"), ["新增的第二段。"]);
  assert.deepEqual(diffSummary(ins.ops), { added: 1, removed: 0 });
  assert.equal(types(ins.ops), "same,same,same,add");

  const del = diffLines(after, before);
  assert.deepEqual(textOf(del.ops, "del"), ["新增的第二段。"]);
  assert.deepEqual(diffSummary(del.ops), { added: 0, removed: 1 });
});

test("RD-03 diffLines: rewrite of one line keeps the rest as same", () => {
  const before = "# 标题\n\n等待润色的旧句子。\n\n结尾。";
  const after = "# 标题\n\n已经润色的新句子。\n\n结尾。";
  const { tooLarge, ops } = diffLines(before, after);
  assert.equal(tooLarge, false);
  assert.deepEqual(textOf(ops, "del"), ["等待润色的旧句子。"]);
  assert.deepEqual(textOf(ops, "add"), ["已经润色的新句子。"]);
  assert.equal(ops.filter((o) => o.type === "same").length, 4);
  assert.deepEqual(diffSummary(ops), { added: 1, removed: 1 });
  // 行号真实：del 带旧行号，add 带新行号
  assert.equal(ops.find((o) => o.type === "del").oldLine, 3);
  assert.equal(ops.find((o) => o.type === "add").newLine, 3);
});

test("RD-03 diffLines: multi-byte Chinese lines are compared per line, not per byte", () => {
  const before = "中文第一行。\n中文第二行。";
  const after = "中文第一行。\n中文第二行改。";
  const { ops } = diffLines(before, after);
  assert.deepEqual(textOf(ops, "del"), ["中文第二行。"]);
  assert.deepEqual(textOf(ops, "add"), ["中文第二行改。"]);
  // 完整中文段落多行改写
  const a = "春眠不觉晓，\n处处闻啼鸟。";
  const b = "春眠不觉晓，\n夜来风雨声，\n花落知多少。";
  const poem = diffLines(a, b);
  assert.deepEqual(diffSummary(poem.ops), { added: 2, removed: 1 });
  assert.deepEqual(textOf(poem.ops, "del"), ["处处闻啼鸟。"]);
});

test("RD-03 diffLines: over-2000-line input degrades honestly via tooLarge", () => {
  const big = Array.from({ length: 2001 }, (_, i) => `第 ${i} 行`).join("\n");
  const small = "只有一行。";
  for (const [x, y] of [
    [big, small],
    [small, big],
    [big, big],
  ]) {
    const r = diffLines(x, y);
    assert.equal(r.tooLarge, true);
    assert.deepEqual(r.ops, []);
    assert.deepEqual(diffSummary(r.ops), { added: 0, removed: 0 });
  }
  // 恰好 2000 行不降级（改写末行 → added 1 / removed 1）
  const lines = Array.from({ length: 2000 }, (_, i) => `行 ${i}`);
  const ok = diffLines(lines.join("\n"), [...lines.slice(0, -1), "末行改写"].join("\n"));
  assert.equal(ok.tooLarge, false);
  assert.deepEqual(diffSummary(ok.ops), { added: 1, removed: 1 });
});

test("RD-03 diffLines handles CRLF and null-ish input without throwing", () => {
  const { ops } = diffLines("a\r\nb", "a\r\nc");
  assert.deepEqual(textOf(ops, "del"), ["b"]);
  assert.deepEqual(textOf(ops, "add"), ["c"]);
  assert.equal(diffLines(null, undefined).tooLarge, false);
});

test("RD-03 output wording makes no publication claim", () => {
  const { ops } = diffLines("旧句。\n", "新句。\n");
  const rendered = JSON.stringify({ ops, summary: diffSummary(ops) });
  assert.ok(!rendered.includes("已发布"));
  assert.ok(!rendered.includes("自动发布"));
});

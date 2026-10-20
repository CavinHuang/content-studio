// Creator V2 compose (/compose) view derivation — pure functions over the
// REAL writing / illustration payloads. No demo data and no fabricated
// progress: a pipeline step is only "done" when a backend fact supports it
// (研究 = the topic brief exists, 大纲 = real headings in the current
// markdown, 审稿 = at least one decided suggestion, 配图 = at least one
// asset:// image actually inserted), and the strip is explicitly
// non-blocking guidance (docs/design/CREATOR-V2-2-FULL-UX-SPEC.md:41).
// Unit-tested in test/compose-view.test.mjs.

const STEP_LABELS = ["研究", "大纲", "写作", "审稿", "配图", "发布"];

export function composeSteps({
  hasBrief = false,
  hasOutline = false,
  hasDecidedSuggestions = false,
  hasInsertedImages = false,
} = {}) {
  if (
    ![hasBrief, hasOutline, hasDecidedSuggestions, hasInsertedImages].every(
      (v) => typeof v === "boolean"
    )
  )
    throw new TypeError("composeSteps expects boolean facts");
  return STEP_LABELS.map((label) => {
    let state = "todo";
    if (label === "研究" && hasBrief) state = "done";
    // The composer always sits in the writing stage; an empty document
    // honestly shows 大纲 as the current step instead.
    if (label === "大纲") state = hasOutline ? "done" : "now";
    if (label === "写作") state = hasOutline ? "now" : "todo";
    if (label === "审稿" && hasDecidedSuggestions) state = "done";
    if (label === "配图" && hasInsertedImages) state = "done";
    return { label, state };
  });
}

// Outline entries for the left rail, derived from the CURRENT editor
// markdown (heading lines only), capped like the design's short rail.
export function outlineItems(markdown, limit = 12) {
  if (typeof markdown !== "string") return [];
  const rows = [];
  for (const line of markdown.split("\n")) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match)
      rows.push({
        level: match[1].length,
        text: match[2].trim().slice(0, 80),
      });
    if (rows.length >= limit) break;
  }
  return rows;
}

// Real per-channel four-check progress (editorial checks are stored per
// channel and never shared between 主稿 and platform drafts).
export function checkSummary(checks) {
  const keys = ["factual", "privacy", "rights", "layout"];
  const done = keys.filter((k) => checks?.[k] === true).length;
  return { done, total: keys.length, complete: done === keys.length };
}

// Illustration slot view state — straight from the shot status column;
// "已选用" keeps the 选中≠已采用 wording used by the illustration domain
// (approval/insertion is recorded separately; this label reflects the
// shot row itself, stale plans are flagged by the caller).
export function slotView(status) {
  const map = {
    planned: { label: "待生成", tone: "warning" },
    generating: { label: "正在生成", tone: "info" },
    generated: { label: "待审阅", tone: "info" },
    approved: { label: "已选用", tone: "success" },
    failed: { label: "生成失败", tone: "error" },
    rejected: { label: "已拒绝", tone: "default" },
  };
  return map[status] || { label: String(status || "未知"), tone: "default" };
}

export function shotTitle(shot) {
  if (!shot) return "配图";
  if (shot.role === "cover") return "文章封面";
  return "正文配图 " + String(shot.ordinal || "").padStart(2, "0");
}

// Creator V2 compose (/compose) view derivation — pure functions over the
// REAL writing / illustration payloads. No demo data and no fabricated
// progress: a pipeline step is only "done" when a backend fact supports it
// (研究 = the topic brief exists, 大纲 = real headings in the current
// markdown, 审稿 = at least one decided suggestion, 配图 = at least one
// asset:// image actually inserted), and the strip is explicitly
// non-blocking guidance (docs/design/CREATOR-V2-2-FULL-UX-SPEC.md:41).
// Unit-tested in test/compose-view.test.mjs.

const STEP_LABELS = ["研究", "大纲", "写作", "审稿", "配图", "发布"];

// Easel 式阶段焦点视图的 URL 阶段参数解析（?stage=）：白名单五个焦点视图，
// 非法/伪造/过期的值与缺失一律安全落回写作阶段。stage 只是呈现层焦点
// 状态——解析结果不携带也不产生任何领域事实（诚实呈现规则见文件头注释）。
const STAGE_WHITELIST = ["research", "write", "review", "images", "publish"];

export function parseStage(value) {
  return STAGE_WHITELIST.includes(value) ? value : "write";
}

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
// `line` is the 1-based source line, consumed by DoocsEditor's revealLine
// (P2-02 大纲点击真跳转).
export function outlineItems(markdown, limit = 12) {
  if (typeof markdown !== "string") return [];
  const rows = [];
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (match)
      rows.push({
        level: match[1].length,
        text: match[2].trim().slice(0, 80),
        line: i + 1,
      });
    if (rows.length >= limit) break;
  }
  return rows;
}

// 行偏移表（P2-02）：第 i 项是 1-based 第 i 行在全文中的起始 UTF-16 偏移。
// 逐行累计（本函数是唯一生产者，组件不做偏移累加）；中文等多字节 BMP 字符
// 按其码元数计入，代理对（如 emoji）按 2 个码元计入——与 CodeMirror 的
// UTF-16 偏移一致。末行无换行符时最后一项仍然成立。
export function markdownLineOffsets(markdown) {
  if (typeof markdown !== "string") return [];
  const offsets = [];
  let offset = 0;
  for (const line of markdown.split("\n")) {
    offsets.push(offset);
    offset += line.length + 1; // +1 是行分隔符 "\n" 本身
  }
  return offsets;
}

// 光标所在/之前的最后一个标题下标（P2-02 active 跟随）：标题行起始偏移
// <= 光标 from 即视为光标落在该标题之后。返回 -1 表示光标在第一个标题
// 之前（或文档/行偏移表为空），调用方据此不高亮任何大纲项。
export function activeOutlineIndex(items, cursorFrom, lineOffsets) {
  if (!Array.isArray(items) || !Array.isArray(lineOffsets)) return -1;
  let active = -1;
  for (let i = 0; i < items.length; i++) {
    const start = lineOffsets[items[i].line - 1];
    if (typeof start !== "number") continue;
    if (start > cursorFrom) break;
    active = i;
  }
  return active;
}

// Real per-channel four-check progress (editorial checks are stored per
// channel and never shared between 主稿 and platform drafts).
export function checkSummary(checks) {
  const keys = ["factual", "privacy", "rights", "layout"];
  const done = keys.filter((k) => checks?.[k] === true).length;
  return { done, total: keys.length, complete: done === keys.length };
}

// P2-01 发布就绪度条：把 composeSteps 同源的真实事实整理成有序 chips
// （key/label/tone good|warn|info|detail）。只陈述既有事实——研究简报、
// 大纲标题数、待采纳建议、四项人工检查（复用 checkSummary，按渠道独立）、
// 配图插入/计划过期；不发明新事实，也绝不含「已发布/可发布」字样：就绪度
// 的诚实上限是「人工检查 4/4 完成（该渠道独立记录）」。
export function readinessFacts({
  brief = null,
  outlineCount = 0,
  pendingSuggestions = 0,
  decidedSuggestions = 0,
  checks = undefined,
  checkTotal,
  staleImagePlan = false,
  insertedImages = false,
} = {}) {
  const summary = checkSummary(checks);
  const total = Number.isInteger(checkTotal) ? checkTotal : summary.total;
  return [
    brief
      ? { key: "brief", label: "研究简报已有", tone: "good" }
      : { key: "brief", label: "研究简报暂无", tone: "detail" },
    outlineCount > 0
      ? {
          key: "outline",
          label: `大纲 ${outlineCount} 个标题`,
          tone: "good",
        }
      : { key: "outline", label: "大纲尚无标题", tone: "detail" },
    pendingSuggestions > 0
      ? {
          key: "suggestions",
          label: `待采纳建议 ${pendingSuggestions} 条`,
          tone: "warn",
        }
      : decidedSuggestions > 0
      ? {
          key: "suggestions",
          label: `建议已处理 ${decidedSuggestions} 条`,
          tone: "info",
        }
      : { key: "suggestions", label: "暂无待审建议", tone: "detail" },
    summary.complete
      ? {
          key: "checks",
          label: `人工检查 ${summary.done}/${total} 完成（该渠道独立记录）`,
          tone: "good",
        }
      : {
          key: "checks",
          label: `待完成人工检查 ${summary.done}/${total}`,
          tone: "warn",
        },
    insertedImages
      ? { key: "images", label: "已插图", tone: "good" }
      : staleImagePlan
      ? { key: "images", label: "计划已过期", tone: "warn" }
      : { key: "images", label: "未插图", tone: "detail" },
  ];
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

// AW-01（Phase 4 切片二）：待审建议卡的就地对比视图。original 为非空字符串且
// 不等于 replacement 时给 both（卡内常显 原文片段→替换内容 两行）；revoked 行
// 的 original 被撤销置空为 ''（src/writing.mjs suggestion 投影已证实）、
// original===replacement 的退化数据一律降级 replacement-only——异常数据不伪装
// 成对比。纯派生：original/replacement 都是建议载荷既有字段，零新增请求。
export function suggestionCompareView(s) {
  const original = s?.original, replacement = s?.replacement;
  if (typeof original === "string" && original.length > 0 && original !== replacement)
    return { mode: "both", original, replacement };
  return { mode: "replacement-only", replacement };
}

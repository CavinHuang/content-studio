// Creator V2 topic discovery (/topics) — pure display derivation.
// Visual/interaction spec: public/design/creator-v2.2.html discoverView
// (:155) + the V2.2 refinement (:172 step line, :175 banner + evidence
// grid). Like src/hotspots-radar.mjs / src/works-library.mjs this module
// holds only pure logic over the REAL payload of GET /api/creator/topics
// (src/creator.mjs topic(): id/revision/title/angle/audience/outline/
// refs/status/favorite/reason/createdAt/problem/keyPoints/evidenceGaps/
// platforms/feedback/projectId) plus GET /api/creator/library assets, so
// the React component stays declarative and the rules stay unit-testable
// (test/topics-discovery.test.mjs).
//
// Honest-derivation rules (root AGENTS.md / implementation prompt §2):
//   - "为我推荐" is provenance, not a score: a topic is "recommended"
//     only when its persisted reason is NOT the default marker the
//     server writes for author-typed topics (src/creator.mjs:641
//     reason = "作者提出的选题"). Source-radar conversions, material
//     recommendations, AI candidates and series prep all carry a real
//     reason string. No relevance/heat value is ever derived.
//   - The design's theme chips (全部主题/AI 产品/独立开发/效率工具) have
//     no backend category field, so the chip row filters by the real
//     topic status instead (registered design deviation).

export const TOPIC_TABS = [
  { key: "recommended", label: "为我推荐" },
  { key: "all", label: "全部线索" },
  { key: "saved", label: "已收藏" },
];

// Server-side status values (src/creator.mjs:673-677) → design tag label
// + tone (design .tag tones: info/success/warning/default).
export const TOPIC_STATUS = {
  draft: { label: "待讨论", tone: "info" },
  prepared: { label: "大纲已准备", tone: "info" },
  confirmed: { label: "已确认", tone: "success" },
  writing: { label: "写作中", tone: "success" },
  dismissed: { label: "暂不创作", tone: "" },
};

export const AUTHOR_TOPIC_REASON = "作者提出的选题";

// The server writes this default reason only in createTopic's parameter
// default (src/creator.mjs:641); every pipeline-provided topic carries a
// real reason ("热点雷达转入 · …", "来自你的素材库…", "来源候选，需核实…",
// series prep reasons). Anything else = recommended provenance.
export function isRecommendedOrigin(topic) {
  return Boolean(topic) && topic.reason !== AUTHOR_TOPIC_REASON;
}

// 今天 / 昨天 / 10 月 17 日 — design card time labels (discoverView
// demoStories time field). Returns '' for missing/invalid values instead
// of printing "Invalid Date".
export function dayLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const midnight = (x) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((midnight(now) - midnight(d)) / 86400000);
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function statusInfo(topic) {
  return TOPIC_STATUS[topic?.status] || { label: topic?.status || "状态未知", tone: "" };
}

const REF_KIND_LABEL = { material: "素材", article: "历史文章", image: "图片" };

// Resolve topic.refs ([{kind,id,revision?}]) against the author's library
// payload (GET /api/creator/library → assets[{id,kind,title}]).
// A ref whose id is no longer in the library renders honestly as
// "来源已不可用" — never silently dropped, never renamed to something
// plausible.
export function describeRefs(refs = [], library = []) {
  if (!Array.isArray(refs)) return [];
  const byId = new Map(
    (Array.isArray(library) ? library : []).map((a) => [a.id, a])
  );
  return refs.map((ref, i) => {
    const asset = byId.get(ref?.id);
    return {
      key: `${ref?.kind || "ref"}:${ref?.id || i}:${i}`,
      kindLabel: REF_KIND_LABEL[ref?.kind] || "参考来源",
      title: asset?.title || "",
      revision: ref?.revision,
      unavailable: !asset,
    };
  });
}

export function sourceLine(topic, library = []) {
  const n = Array.isArray(topic?.refs) ? topic.refs.length : 0;
  if (!n) return "暂无关联素材";
  return `${n} 条参考素材`;
}

// List derivation over the real topics payload: tab provenance filter,
// real-status chip filter, stable createdAt-desc order (topics() already
// returns created_at DESC, kept here as a defensive sort).
export function buildTopicsDiscovery({ topics = [], tab = "all", status = "all", library = [] } = {}) {
  const list = (Array.isArray(topics) ? topics : [])
    .slice()
    .sort((a, b) => String(b?.createdAt || "").localeCompare(String(a?.createdAt || "")));
  const byTab = list.filter((t) => {
    if (tab === "saved") return !!t.favorite;
    if (tab === "recommended") return isRecommendedOrigin(t);
    return true;
  });
  const rows =
    status === "all" ? byTab : byTab.filter((t) => (t?.status || "") === status);
  return {
    rows,
    refs: Object.fromEntries(rows.map((t) => [t.id, describeRefs(t.refs, library)])),
    counts: {
      all: list.length,
      recommended: list.filter(isRecommendedOrigin).length,
      saved: list.filter((t) => t.favorite).length,
      shown: rows.length,
    },
  };
}

// 编辑判断卡 completeness — the four ask-named fields. Pure display fact
// used for an honest hint ("判断还缺 X"), never a score.
export function judgmentGaps(topic) {
  const gaps = [];
  if (!String(topic?.problem || "").trim()) gaps.push("读者问题");
  if (!String(topic?.angle || "").trim()) gaps.push("写作角度");
  if (!Array.isArray(topic?.refs) || !topic.refs.length) gaps.push("来源依据");
  if (!String(topic?.evidenceGaps || "").trim()) gaps.push("证据缺口");
  return gaps;
}

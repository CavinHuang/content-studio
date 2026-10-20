// Creator V2.3 visual studio (/illustrations) view derivation — pure
// functions over the REAL illustration payloads returned by
// GET /api/illustrations/projects/:id (+ the master document from
// GET /api/editor/projects/:id). No demo data and no fabricated states:
// every label maps to a persisted shot column, "已插入" is only true when
// the master markdown really references asset://<assetId> (the compose
// editor's insertion convention), and "已批准/已插入/平台验证" stay three
// different facts (assets carry platformVerified:false by design).
// Unit-tested in test/illustrations-studio.test.mjs.
import { shotTitle } from "./compose-view.mjs";

export { shotTitle };

// Real per-shot style enum of the illustration domain (see the pre-V2
// studio's 风格 select). Swatch colors keep the V2.3 视觉方向 chip look
// (creator-v2.3-visual.html :7 .stylebtn) while the labels/name the real
// options — the prototype's 克制科技/杂志叙事/自然编辑 demo styles have no
// backend field (registered deviation).
export const STYLE_OPTIONS = [
  ["editorial", "高级杂志插画", ["#303f70", "#9baee0", "#f1f3fb"]],
  ["diagram", "抽象结构示意", ["#2d8558", "#8fc3a4", "#e9f4ed"]],
  ["abstract", "抽象隐喻", ["#98642c", "#ddb289", "#fff1e7"]],
];

const TONES = { good: "good", blue: "blue", warn: "warn", danger: "danger", muted: "muted" };

// Status pill derived ONLY from the persisted shot row. `inserted` is a
// separate backend fact (master markdown contains asset://<assetId>) and
// strictly implies approved — a generated/unapproved shot is never shown
// as inserted even if its markdown token lingers from an older revision.
export function shotStatusView(shot, { inserted = false } = {}) {
  if (!shot || typeof shot.status !== "string") return { label: "未知", tone: TONES.muted };
  if (shot.status === "generating") return { label: "生成中", tone: TONES.blue };
  if (shot.status === "planned") return { label: "待生成", tone: TONES.warn };
  if (shot.status === "failed") return { label: "生成失败", tone: TONES.danger };
  if (shot.status === "approved")
    return inserted ? { label: "已插入", tone: TONES.good } : { label: "已批准", tone: TONES.good };
  if (shot.status === "generated") return { label: "待审阅", tone: TONES.blue };
  if (shot.status === "rejected") return { label: "已拒绝", tone: TONES.muted };
  return { label: shot.status, tone: TONES.muted };
}

// Design's anchor line (标题上方 · 公众号头图 / 第一节之后 · 工作流程)
// rebuilt from real data: the cover anchors under the H1 (handoff inserts
// after the title), a section shot anchors after its master paragraph.
export function shotAnchor(shot, paragraphs = []) {
  if (!shot) return "";
  if (shot.role === "cover") return "文章标题下方 · 封面";
  const list = Array.isArray(paragraphs) ? paragraphs : [];
  const index = list.findIndex((p) => p && p.id === shot.paragraphId);
  if (index < 0) return "原段落不在当前主稿 · 需重新规划";
  const text = String(list[index].text || "").replace(/\s+/gu, " ").trim();
  return `第 ${index + 1} 段之后 · ${text.slice(0, 14)}${text.length > 14 ? "…" : ""}`;
}

// 封面 / 完整配图 / 指定段落 three planning modes (V2.3 editor inspector,
// creator-v2.3-visual.html :41) over real planning capabilities:
// POST plan (default = full), POST plan {scope:'cover'}, POST plan {paragraphId}.
export function planningModes(paragraphs = []) {
  const list = Array.isArray(paragraphs) ? paragraphs : [];
  const eligible = list.filter((p) => String(p?.text || "").trim().length > 18);
  return [
    {
      id: "cover",
      label: "只做封面",
      summary: "仅规划文章封面 1 处，用于公众号头图与知乎题图。",
      count: 1,
    },
    {
      id: "full",
      label: "完整配图",
      summary: "封面 1 处 + 系统从正文识别的最多 2 处章节配图，不会为凑图增加装饰图。",
      count: Math.min(3, 1 + Math.min(2, eligible.length)),
    },
    {
      id: "paragraph",
      label: "指定段落",
      summary: "为选定的一段正文单独规划 1 处配图，替换当前计划（原图保留在素材库）。",
      count: 1,
      paragraphs: eligible.map((p) => ({
        id: p.id,
        text: String(p.text || "").replace(/\s+/gu, " ").trim().slice(0, 60),
      })),
    },
  ];
}

// Candidate/variant grid: the shot's current asset plus its non-rejected
// candidate versions. Rejected history is counted, not hidden entirely.
export function variantCards(shot) {
  if (!shot) return { cards: [], rejected: 0 };
  const candidates = Array.isArray(shot.candidates) ? shot.candidates : [];
  const usable = candidates.filter((c) => c && c.status !== "rejected" && c.asset);
  const seen = new Set();
  const cards = [];
  if (shot.asset) {
    cards.push({
      key: "current:" + shot.assetId,
      assetId: shot.assetId,
      previewUrl: shot.asset.previewUrl,
      selected: true,
      label: "当前方案",
      note: shot.provider ? `${shot.provider} 生成 · 保留历史` : "保留历史",
      candidateId: (usable.find((c) => c.assetId === shot.assetId) || {}).id || null,
    });
    seen.add(shot.assetId);
  }
  for (const c of usable) {
    if (seen.has(c.assetId)) continue;
    seen.add(c.assetId);
    cards.push({
      key: "candidate:" + c.id,
      assetId: c.assetId,
      previewUrl: c.asset.previewUrl,
      selected: false,
      label: "候选版本",
      note: `${c.provider || "未知供应商"} · ${c.instruction ? "修改迭代" : "生成版本"}`,
      candidateId: c.id,
    });
  }
  return { cards, rejected: candidates.filter((c) => c && c.status === "rejected").length };
}

// 查看最终效果 preview modal blocks: real master paragraphs plus ONLY
// approved shots (选中≠批准；未采用位置不渲染图). Per channel, a mapped
// platform URL is reported separately from the local preview — a missing
// mapping never blocks the preview but is stated honestly.
export function previewBlocks(document, shots, channel) {
  const doc = document || {};
  const title = String(doc.title || "").trim();
  const paragraphs = Array.isArray(doc.paragraphs) ? doc.paragraphs : [];
  const approved = (Array.isArray(shots) ? shots : []).filter(
    (s) => s && s.status === "approved" && s.asset
  );
  const imageFor = (shot) => {
    const mapping = (shot.asset.mappings || []).find((m) => m && m.channel === channel);
    return {
      type: "image",
      shotId: shot.id,
      alt: shot.alt,
      previewUrl: shot.asset.previewUrl,
      mapped: Boolean(mapping && mapping.url),
      role: shot.role,
    };
  };
  const blocks = [];
  if (title) blocks.push({ type: "title", text: title });
  const byParagraph = new Map(approved.filter((s) => s.role !== "cover").map((s) => [s.paragraphId, s]));
  if (approved.some((s) => s.role === "cover")) {
    const cover = approved.find((s) => s.role === "cover");
    blocks.push(imageFor(cover));
  }
  for (const p of paragraphs) {
    const raw = String(p?.text || "").trim();
    const heading = /^#{1,6}\s+/.exec(raw);
    if (raw) blocks.push({ type: heading ? "heading" : "text", text: heading ? raw.replace(/^#{1,6}\s+/, "") : raw });
    const shot = byParagraph.get(p?.id);
    if (shot) blocks.push(imageFor(shot));
  }
  return {
    blocks,
    adopted: approved.length,
    total: (Array.isArray(shots) ? shots : []).length,
  };
}

// Budget copy — reserved requests, never currency (V38 accounting).
export function budgetLine(budget) {
  if (!budget || typeof budget !== "object") return "";
  const used = Number(budget.used) || 0;
  const limit = Number(budget.dailyLimit) || 0;
  const remaining = Number(budget.remaining) || 0;
  return `今日已占用 ${used} / ${limit} 次 · 剩余 ${remaining} 次（按请求预留计数，不是费用估算）`;
}

// Real "已插入" derivation over the master markdown (compose inserts
// ![alt](asset://<id>)). Keeps 选中≠批准≠插入 explicit in the UI.
export function insertedAssetIds(markdown, shots = []) {
  const text = typeof markdown === "string" ? markdown : "";
  return new Set(
    (Array.isArray(shots) ? shots : [])
      .map((s) => s?.assetId)
      .filter((id) => id && text.includes("asset://" + id))
  );
}

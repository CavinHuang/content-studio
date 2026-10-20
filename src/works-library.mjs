// Creator V2 works library (/works) aggregation — small read-only adapter
// over the payload of GET /api/editor/projects (editorial.list(), see
// .superpowers/v2-audit.md §1: the endpoint has no server-side search or
// stage-filter parameter, so filtering happens here, purely in memory).
//
// Design source: public/design/creator-v2.2.html worksView (:156) + the
// V2.2 refinement (:176): five-bucket stage pipeline (全部/草稿中/审稿中/
// 待发布/已发布), tab filters, three-column work cards and the dashed
// "从一个想法开始" create card, via the design manifest §2.
//
// This module is PURE: it derives display facts only from the real
// editorial payload (per-channel status/checks/masterOutdated/
// openCorrections/document). It stores nothing, calls nothing, and
// fabricates no metric. Honesty rules (root AGENTS.md / implementation
// prompt §2) encoded here:
//   - "已发布" bucket only contains channels whose status is
//     reported_published, and the card label/tooltip keep the domain's
//     "作者报告已发表（未经平台核验）" caveat (src/editorial.mjs:25) —
//     an author report is never a verified publication;
//   - "待发布" only contains exported channels and every subtitle keeps
//     "导出不等于已发布" explicit;
//   - a platform draft that only carries editorial's untouched seed
//     paragraph (the real state of fresh projects) is not treated as a
//     review signal — same decision as src/creator-home.mjs:50.
import { SEED_PARAGRAPH_TEXT } from "./seed-paragraph.mjs";

export const WORK_STAGES = [
  { key: "all", label: "全部", hint: "所有作品" },
  { key: "draft", label: "草稿中", hint: "整理思路" },
  { key: "review", label: "审稿中", hint: "验证事实" },
  { key: "ready", label: "待发布", hint: "等待确认" },
  { key: "published", label: "已发布", hint: "观察表现" },
];

const CHANNEL_ORDER = ["master", "wechat", "zhihu"];
const CHANNEL_SHORT = { master: "主稿", wechat: "公众号", zhihu: "知乎" };
const CHANNEL_NAMES = { master: "主稿", wechat: "公众号稿", zhihu: "知乎稿" };
const CHECK_COUNT = 4; // four per-channel manual checks, kept independent

// A channel "has content" when at least one paragraph carries real text
// beyond editorial's untouched seed paragraph (see src/creator-home.mjs).
export function channelHasContent(channel) {
  return (channel?.document?.paragraphs || []).some((p) => {
    const text = typeof p?.text === "string" ? p.text.trim() : "";
    return text.length > 0 && text !== SEED_PARAGRAPH_TEXT;
  });
}

function checksDone(channel) {
  const values =
    channel?.checks && typeof channel.checks === "object"
      ? Object.values(channel.checks)
      : [];
  return values.filter(Boolean).length;
}

function platformChannels(project) {
  const channels = project?.channels || {};
  return CHANNEL_ORDER.filter((c) => c !== "master" && channels[c]);
}

// Aggregate, honest stage of one project derived from its independent
// channel statuses. Priority: author-reported publication > exported
// (awaiting delivery confirmation) > open review work > plain draft.
export function worksStage(project) {
  const channels = project?.channels || {};
  const platform = platformChannels(project);
  const statuses = platform.map((c) => channels[c].status);
  if (statuses.includes("reported_published"))
    return { key: "published", label: "作者报告已发表（未核验）", tone: "success" };
  if (statuses.includes("exported"))
    return { key: "ready", label: "待发布", tone: "warning" };
  const open = Number(channels.master?.openCorrections) || 0;
  const partialChecks = platform.some((c) => {
    const done = checksDone(channels[c]);
    return done > 0 && done < CHECK_COUNT;
  });
  const staleDraft = platform.some(
    (c) => channels[c].masterOutdated && channelHasContent(channels[c])
  );
  if (open > 0 || partialChecks || staleDraft)
    return { key: "review", label: "审稿中", tone: "info" };
  return { key: "draft", label: "草稿中", tone: "info" };
}

function nameList(channels) {
  return channels.map((c) => CHANNEL_NAMES[c]).join("、");
}

// One concise, honest state line per work. The date part (今天 14:32 /
// 10 月 16 日, design :135) is rendered client-side by the component.
export function describeWork(project) {
  const channels = project?.channels || {};
  const stage = worksStage(project);
  const platform = platformChannels(project);
  const withContent = platform.filter((c) => channelHasContent(channels[c]));
  const open = Number(channels.master?.openCorrections) || 0;

  let subtitle;
  if (stage.key === "published") {
    const reported = platform.filter(
      (c) => channels[c].status === "reported_published"
    );
    subtitle = `${nameList(reported)} · 作者报告已发表（未经平台核验）`;
  } else if (stage.key === "ready") {
    const exported = platform.filter((c) => channels[c].status === "exported");
    subtitle = `${nameList(exported)}已导出 · 等待发布确认（导出不等于已发布）`;
  } else {
    const parts = [];
    if (open > 0) parts.push(`正在核对主稿的 ${open} 处事实`);
    for (const c of platform) {
      const done = checksDone(channels[c]);
      if (done > 0 && done < CHECK_COUNT)
        parts.push(`${CHANNEL_NAMES[c]}人工检查进行中（${done}/${CHECK_COUNT}）`);
    }
    for (const c of platform) {
      if (channels[c].masterOutdated && channelHasContent(channels[c]))
        parts.push(`${CHANNEL_NAMES[c]}落后于主稿，需要同步核对`);
    }
    subtitle = parts.length
      ? parts.slice(0, 2).join(" · ")
      : withContent.length
        ? `已有初稿：${nameList(withContent)}`
        : "还没有正文；从主稿开始写";
  }

  // Channel attribution: master vs 公众号稿/知乎稿, each tooltip carrying
  // that channel's real revision/status (never a fabricated state).
  const channelTags = CHANNEL_ORDER.filter((c) => channels[c]).map((c) => {
    const ch = channels[c];
    const detail =
      c === "master"
        ? `修订 v${ch.document?.revision ?? 0}`
        : ch.statusLabel || ch.status || "状态未知";
    return { name: CHANNEL_SHORT[c], title: `${CHANNEL_NAMES[c]} · ${detail}` };
  });

  return {
    id: project.id,
    title: project.title,
    updatedAt: project.updatedAt || "",
    stage,
    subtitle,
    channelTags,
  };
}

export function filterWorks(works, { stage = "all", query = "" } = {}) {
  const q = String(query || "").trim().toLowerCase();
  return (Array.isArray(works) ? works : []).filter(
    (w) =>
      w?.id &&
      (stage === "all" || w.stage?.key === stage) &&
      (!q || String(w.title || "").toLowerCase().includes(q))
  );
}

export function buildWorksLibrary({ projects = [], stage = "all", query = "" } = {}) {
  const works = (Array.isArray(projects) ? projects : [])
    .filter((p) => p?.id)
    .map(describeWork);
  const counts = { all: works.length, draft: 0, review: 0, ready: 0, published: 0 };
  for (const w of works) counts[w.stage.key] += 1;
  return { counts, works, visible: filterWorks(works, { stage, query }) };
}

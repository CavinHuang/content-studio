// Creator V2 home workspace aggregation — small read-only adapter for
// GET /api/creator/overview (see .superpowers/v2-audit.md §1: the V2.2
// home needs "待处理事项" and "精选线索" groupings that the raw overview
// payload does not expose directly).
//
// Design source: public/design/creator-v2.2.html:141,173 (hero + overview
// band + task list / recent works / featured clues) via the approved
// design manifest §1. This module is PURE: it derives display facts only
// from data the overview endpoint already returns (editorial projects
// with per-channel checks/openCorrections, topics, notifications, jobs).
// It stores nothing, calls nothing, and fabricates no metric — every
// number is grounded in real domain state:
//   - openCorrections / masterOutdated / checks / status come from
//     EditorialService.get() (src/editorial.mjs:46-49);
//   - topic statuses are the creator_topics enum draft/prepared/
//     confirmed/dismissed/writing (src/creator.mjs:671-676);
//   - notification rows carry read + href (src/creator.mjs:2192-2196);
//   - job statuses queued/running/completed/cancelled/blocked/unknown
//     (src/creator.mjs creator_jobs table, :124).
// Honesty rules encoded here (root AGENTS.md / implementation prompt §2):
//   - "导出≠发布" and author-reported publication stays explicitly
//     unverified in the stage label;
//   - "正在创作" excludes only works the author reported as published on
//     a platform channel — nothing else is treated as "done";
//   - clues exclude topics already turned into a project (status
//     writing) or dismissed, so the home never resells finished work.
import { SEED_PARAGRAPH_TEXT } from "./seed-paragraph.mjs";

const CHANNEL_NAMES = { wechat: "公众号稿", zhihu: "知乎稿" };
const CHECK_COUNT = 4; // four per-channel manual checks, kept independent
const MAX_PENDING = 4;
const MAX_CLUES = 4;

const CLUE_STATUS_LABELS = {
  draft: "待整理",
  prepared: "已准备",
  confirmed: "已确认",
};

const JOB_KIND_LABELS = {
  series_prepare: "内容准备",
  style_learn: "风格学习",
};

// A channel "has content" when at least one paragraph carries real text
// beyond editorial's untouched seed paragraph. Fresh projects keep the
// seed paragraph on every platform channel, so revision bookkeeping
// alone (masterOutdated on a never-written draft) is not an actionable
// decision and must not become noise on the home screen.
function channelHasContent(channel) {
  return (channel?.document?.paragraphs || []).some((p) => {
    const text = typeof p?.text === "string" ? p.text.trim() : "";
    return text.length > 0 && text !== SEED_PARAGRAPH_TEXT;
  });
}

// Aggregate, honest stage of one project derived from its independent
// channel statuses. Labels reuse the exact caveats of
// src/editorial.mjs:25 (statusName) so the UI cannot imply that an
// export or an author report equals a verified publication.
export function projectStage(project) {
  const statuses = ["wechat", "zhihu"]
    .map((c) => project?.channels?.[c]?.status)
    .filter(Boolean);
  if (statuses.includes("reported_published"))
    return { status: "reported_published", label: "作者报告已发表（未核验）", tone: "success" };
  if (statuses.includes("exported"))
    return { status: "exported", label: "已导出（未发布）", tone: "warning" };
  return { status: "draft", label: "草稿中", tone: "info" };
}

export function buildCreatorHome({
  projects = [],
  topics = [],
  notifications = [],
  jobs = [],
} = {}) {
  const pending = [];
  for (const project of Array.isArray(projects) ? projects : []) {
    if (!project?.id) continue;
    const channels = project.channels || {};
    const master = channels.master;
    const open = Number(master?.openCorrections) || 0;
    if (open > 0)
      pending.push({
        id: `${project.id}:master:corrections`,
        kind: "corrections",
        projectTitle: project.title,
        title: `核对《${project.title}》主稿中的 ${open} 处事实`,
        description: "主稿里仍有待核对的判断，发布前需要补齐来源。",
        href: `/compose?project=${project.id}`,
        actionLabel: "去核对",
      });
    for (const channel of ["wechat", "zhihu"]) {
      const ch = channels[channel];
      if (!ch) continue;
      const name = CHANNEL_NAMES[channel];
      if (ch.masterOutdated && channelHasContent(ch))
        pending.push({
          id: `${project.id}:${channel}:outdated`,
          kind: "master-sync",
          projectTitle: project.title,
          title: `《${project.title}》${name}落后于主稿`,
          description: "主稿已更新；平台稿需要重新核对，不能直接沿用旧版。",
          href: `/compose?project=${project.id}&channel=${channel}`,
          actionLabel: "去同步",
        });
      const values = ch.checks && typeof ch.checks === "object" ? Object.values(ch.checks) : [];
      const done = values.filter(Boolean).length;
      if (done > 0 && done < CHECK_COUNT)
        pending.push({
          id: `${project.id}:${channel}:checks`,
          kind: "checks",
          projectTitle: project.title,
          title: `完成《${project.title}》${name}的人工检查`,
          description: `该渠道四项检查已确认 ${done} 项，还剩 ${CHECK_COUNT - done} 项。`,
          href: `/compose?project=${project.id}&channel=${channel}`,
          actionLabel: "去检查",
        });
      if (ch.status === "exported")
        pending.push({
          id: `${project.id}:${channel}:delivery`,
          kind: "delivery",
          projectTitle: project.title,
          title: `确认《${project.title}》${name}的交付状态`,
          description: "已导出不等于已发布；交付前完成渠道预览与人工检查。",
          href: `/compose?project=${project.id}&channel=${channel}`,
          actionLabel: "去确认",
        });
    }
  }
  for (const n of Array.isArray(notifications) ? notifications : []) {
    if (!n?.id || n.read) continue;
    pending.push({
      id: String(n.id),
      kind: "notification",
      projectTitle: "",
      title: n.title || "有新的准备结果待查看",
      description: "系列准备或画像建议已完成，等待你查看。",
      href: n.href || "/topics",
      actionLabel: "去查看",
    });
  }
  for (const j of Array.isArray(jobs) ? jobs : []) {
    if (!j?.id || !["blocked", "unknown"].includes(j.status)) continue;
    pending.push({
      id: String(j.id),
      kind: "job",
      projectTitle: "",
      title: `核对${JOB_KIND_LABELS[j.kind] || "后台"}任务`,
      description: "任务被中断或结果不确定，需要核对后取消或重试。",
      href: "/topics?view=jobs",
      actionLabel: "去核对",
    });
  }

  const clues = (Array.isArray(topics) ? topics : [])
    .filter(
      (t) =>
        t?.id &&
        !["dismissed", "writing"].includes(t.status) &&
        !t.projectId
    )
    .sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) ||
        String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    )
    .map((t) => ({
      id: t.id,
      title: t.title,
      angle: t.angle || t.problem || "",
      status: t.status,
      statusLabel: CLUE_STATUS_LABELS[t.status] || t.status,
      refsCount: Array.isArray(t.refs) ? t.refs.length : 0,
      platforms: Array.isArray(t.platforms) ? t.platforms : [],
      favorite: !!t.favorite,
      createdAt: t.createdAt || "",
    }));

  const reported = (Array.isArray(projects) ? projects : []).filter(
    (p) => projectStage(p).status === "reported_published"
  ).length;

  return {
    focusProjectId:
      projects.find((p) => p?.id && p?.title)?.id || null,
    counts: {
      inProgress: (Array.isArray(projects) ? projects.length : 0) - reported,
      pendingDecisions: pending.length,
      clues: clues.length,
    },
    pending: pending.slice(0, MAX_PENDING),
    clues: clues.slice(0, MAX_CLUES),
  };
}

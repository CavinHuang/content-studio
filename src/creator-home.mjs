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
//
// Adapted from ZJU-REAL/Easel (Apache-2.0) for projectProgress (VA-03 六槽进度点):
//   - skills/shared/scripts/manifest.py（steps[] 每层 status 行「一眼看到每个项目
//     走到哪层」的展示契约思想，:26-33）
//   - web/frontend/src/components/DashboardPage.tsx:238-243（最近产物行 = 名称 +
//     单 badge 的原型，我们升级为进度点串）
//   - docs/SKILL-SPEC.md:48,151（layer/status 枚举驱动前端分色）
//   modified: manifest.py 是 Python CLI 落盘脚本（.easel.json + atomic_write +
//   EASEL_ROOT env）——不执行 Python、零新存储：六槽全部请求时派生，不建表、
//   不加列、不新增端点/响应字段；Easel 的 failed 步「断点续跑」语义由既有
//   SA-02 resumeOf 与 resumeGeneration 承担，首页不呈现 failed 态。
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

// Fixed six progress slots for one recent-works row (VA-03). Pure derivation
// over the editorial.get() payload rows the overview already returns
// (src/editorial.mjs:47-49) — no slot is invented for facts the payload does
// not carry (大纲标题数 / 待采纳建议数 / 配图状态 are NOT in the payload, so
// there are no slots for them and none may be added here without a backend
// fact). Honest ceiling stays "作者报告已发表（未核验）": the word 已发布 never
// appears (asserted in test/creator-home.test.mjs). Checks are the sum of the
// two independent per-channel 4-check records (wechat + zhihu, checkSummary
// semantics from src/compose-view.mjs:99-103) — a display sum, never a merged
// state; the label says 两渠道独立记录.
export function projectProgress(project) {
  const channels = project?.channels || {};
  const master = channels.master;
  const hasMasterContent = channelHasContent(master);
  const openCorrections = Number(master?.openCorrections) || 0;
  const platform = ["wechat", "zhihu"]
    .map((c) => channels[c])
    .filter(Boolean);
  const checksDone = platform.reduce((sum, ch) => {
    const values = ch?.checks && typeof ch.checks === "object" ? Object.values(ch.checks) : [];
    return sum + values.filter(Boolean).length;
  }, 0);
  const exported = platform.some((ch) => ch?.status === "exported");
  const reported = platform.some((ch) => ch?.status === "reported_published");
  return [
    {
      key: "research",
      tone: project?.briefId ? "good" : "todo",
      title: project?.briefId ? "研究：写作任务书已建" : "研究：尚未建立写作任务书",
    },
    {
      key: "body",
      tone: hasMasterContent ? "good" : "todo",
      title: hasMasterContent ? "正文：主稿已有内容" : "正文：主稿还是空稿",
    },
    {
      key: "review",
      tone: !hasMasterContent ? "todo" : openCorrections === 0 ? "good" : "warn",
      title: !hasMasterContent
        ? "核对：主稿暂无内容可核对"
        : openCorrections === 0
        ? "核对：无待核对事实"
        : `核对：主稿还有 ${openCorrections} 处待核对事实`,
    },
    {
      key: "checks",
      tone: checksDone === 8 ? "good" : checksDone === 0 ? "todo" : "warn",
      title: `检查：两渠道人工检查合计 ${checksDone}/8（公众号稿与知乎稿独立记录）`,
    },
    {
      key: "delivery",
      tone: exported ? "info" : "todo",
      title: exported ? "交付：已导出（未发布）" : "交付：尚未导出",
    },
    {
      key: "publish",
      tone: reported ? "warn" : "todo",
      title: reported
        ? "发表：作者报告已发表（未核验）"
        : "发表：暂无作者发表报告",
    },
  ];
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

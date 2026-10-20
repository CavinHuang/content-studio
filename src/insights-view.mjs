// Creator V2 insights (效果复盘) view derivation — small read-only adapter
// for GET /api/creator/insights (see .superpowers/v2-audit.md §1 /insights
// row: there is NO platform-analytics endpoint, so the page must surface
// an explicit 暂无已验证平台数据 state and never fabricate views/CTR).
//
// Design source: public/design/creator-v2.2.html reviewView (:161) + the
// V2.2 refinement (:181) via the approved design manifest §10 — the
// range segments (7/30/90 天), the three KPI cards, the 内容表现 column,
// the 写作风格 column and the three v2-learning principle cards.
//
// This module is PURE: it derives display facts only from real domain
// state the endpoint already loads (editorial projects, creator_metrics
// rows, creator_style_suggestions, the creator profile). It stores
// nothing, calls nothing, and fabricates no metric. Honesty rules
// encoded here (root AGENTS.md / implementation prompt §3 P1):
//   - hasVerifiedPlatformData is structurally false — the product has no
//     platform connection, so recorded numbers are always labelled as
//     author-entered (作者手工录入) and unverified;
//   - KPI values aggregate the LATEST entry per (project, channel) inside
//     the selected range — never a sum over repeated snapshots of the
//     same channel, which would double count;
//   - trend bars plot the view snapshots the author actually recorded on
//     each day (快照), not invented daily deltas; days without records
//     have no bar;
//   - style learning lists ONLY real suggestions, split by their real
//     status; nothing enters 画像 without the author's accept decision
//     (src/creator.mjs decideStyle);
//   - "已发表" appears only as 作者报告已发表（未经平台核验） via the same
//     projectStage derivation the home uses (src/creator-home.mjs).
import { projectStage } from "./creator-home.mjs";
import { addDays, isoToDayKey, todayKey, weekdayLabel } from "./calendar-view.mjs";

export const RANGES = [
  ["7d", "7 天"],
  ["30d", "30 天"],
  ["90d", "90 天"],
];

const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 };
const CHANNEL_LABELS = {
  wechat: "微信公众号",
  zhihu: "知乎",
  xiaohongshu: "小红书",
  master: "主稿",
};
const STYLE_FIELD_LABELS = {
  tone: "表达语气",
  structure: "结构偏好",
  avoid: "避免表达",
  length: "篇幅习惯",
};

// Timezone kept identical to the calendar derivation (Asia/Shanghai).
const ZONE = "Asia/Shanghai";

export function rangeDays(range) {
  return RANGE_DAYS[range] || RANGE_DAYS["7d"];
}

export function rangeLabel(range) {
  const hit = RANGES.find(([key]) => key === range);
  return hit ? hit[1] : RANGES[0][1];
}

// Bucket layout for the trend bars: 7 天 → daily buckets (design shows 7
// day-labelled bars), 30 天 → 10×3-day buckets, 90 天 → 13×7-day buckets
// (the oldest bucket absorbs the 90/7 remainder). Buckets are [startKey,
// endKey] inclusive, listed oldest → newest, always ending on today.
export function trendBuckets(range, now = new Date()) {
  const today = todayKey(ZONE, now);
  const days = rangeDays(range);
  const size = days === 7 ? 1 : days === 30 ? 3 : 7;
  const count = Math.ceil(days / size);
  const buckets = [];
  let startOffset = days; // inclusive day offset from today
  while (startOffset >= 1) {
    const endOffset = Math.max(1, startOffset - size + 1);
    buckets.push({
      startKey: addDays(today, -(startOffset - 1)),
      endKey: addDays(today, -(endOffset - 1)),
    });
    startOffset = endOffset - 1;
  }
  return { today, size, count, buckets };
}

function bucketLabel(key, size) {
  if (size === 1) return weekdayLabel(key).slice(1); // 周一 → 一 (design labels)
  return `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
}

function recordedLabel(iso) {
  if (!iso) return "";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(parsed);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  return `${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function suggestionLines(data) {
  return Object.entries(STYLE_FIELD_LABELS)
    .map(([key, label]) => [label, typeof data?.[key] === "string" ? data[key].trim() : ""])
    .filter(([, value]) => value);
}

function describeSuggestion(s) {
  const lines = suggestionLines(s?.data || {});
  const decidedAt = (s?.decisions || []).at(-1)?.createdAt || "";
  return {
    id: s?.id || "",
    status: s?.status || "",
    lines,
    summary: lines[0] ? `${lines[0][0]}：${lines[0][1]}` : "",
    evidenceTitles: (Array.isArray(s?.evidence) ? s.evidence : [])
      .filter((e) => e && !e.revoked && e.title)
      .map((e) => `${e.title} v${e.revision}`),
    createdAt: s?.createdAt || "",
    decidedAt,
    decidedLabel: decidedAt ? recordedLabel(decidedAt) : "",
  };
}

// Latest metric entry per (project, channel) inside the range window.
// Windows compare Shanghai day keys (same convention as the trend), so a
// record counts for the local day it was entered on, not its UTC instant.
export function latestEntriesInRange(metrics, range, now = new Date()) {
  const days = rangeDays(range);
  const today = todayKey(ZONE, now);
  const startKey = addDays(today, -(days - 1));
  const latest = new Map();
  for (const row of Array.isArray(metrics) ? metrics : []) {
    if (!row || typeof row.created_at !== "string") continue;
    const day = isoToDayKey(row.created_at, ZONE);
    if (!day || day < startKey) continue;
    const key = `${row.project_id}:${row.channel}`;
    const current = latest.get(key);
    if (!current || current.created_at < row.created_at) latest.set(key, row);
  }
  return latest;
}

export function buildInsightsView({
  projects = [],
  metrics = [],
  suggestions = [],
  profile = null,
  range = "7d",
  now = new Date(),
} = {}) {
  const projectList = Array.isArray(projects) ? projects : [];
  const stageOf = new Map(
    projectList.filter((p) => p?.id).map((p) => [p.id, projectStage(p)])
  );
  const titleOf = new Map(
    projectList
      .filter((p) => p?.id)
      .map((p) => [p.id, p.title || ""])
  );

  const latest = latestEntriesInRange(metrics, range, now);
  let viewsSum = 0;
  let viewsSeen = false;
  let viewsMissing = 0;
  let engagementSum = 0;
  let engagementSeen = false;
  let engagementMissing = 0;
  const rows = [];
  for (const [key, row] of latest) {
    const hasViews = Number.isInteger(row.views);
    const hasEngagement =
      Number.isInteger(row.likes) || Number.isInteger(row.comments);
    if (hasViews) {
      viewsSum += row.views;
      viewsSeen = true;
    } else {
      viewsMissing += 1;
    }
    if (hasEngagement) {
      engagementSum += (row.likes || 0) + (row.comments || 0);
      engagementSeen = true;
    } else {
      engagementMissing += 1;
    }
    rows.push({
      key,
      projectId: row.project_id,
      projectTitle: titleOf.get(row.project_id) || row.projectTitle || "未命名作品",
      channel: row.channel,
      channelLabel: CHANNEL_LABELS[row.channel] || row.channel,
      url: row.url || "",
      views: hasViews ? row.views : null,
      likes: Number.isInteger(row.likes) ? row.likes : null,
      comments: Number.isInteger(row.comments) ? row.comments : null,
      note: row.note || "",
      recordedAt: row.created_at,
      recordedLabel: recordedLabel(row.created_at),
      entryCount: (Array.isArray(metrics) ? metrics : []).filter(
        (m) => m && m.project_id === row.project_id && m.channel === row.channel
      ).length,
      stage: stageOf.get(row.project_id) || null,
    });
  }
  rows.sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));

  // KPI cards (design :161 .insight-kpis). "—" (null) when nothing was
  // recorded — never zero-faked into looking like measured data.
  const reportedPublished = projectList.filter(
    (p) => projectStage(p).status === "reported_published"
  ).length;

  // Trend bars (design :9 .trend-bars): per bucket, the latest view
  // snapshot the author recorded inside it. No records → no bar.
  const { today, size, buckets } = trendBuckets(range, now);
  const dayKeyOf = (iso) => isoToDayKey(iso, ZONE);
  const trendDays = buckets.map(({ startKey, endKey }) => {
    let value = null;
    let recordedAt = "";
    for (const row of Array.isArray(metrics) ? metrics : []) {
      if (!row || !Number.isInteger(row.views)) continue;
      const key = dayKeyOf(row.created_at);
      if (!key || key < startKey || key > endKey) continue;
      if (!recordedAt || row.created_at > recordedAt) {
        recordedAt = row.created_at;
        value = row.views;
      }
    }
    return { key: startKey, label: bucketLabel(startKey, size), value };
  });
  const trendMax = Math.max(0, ...trendDays.map((d) => d.value || 0));
  const trend = {
    days: trendDays.map((d) => ({
      ...d,
      height: d.value != null && trendMax > 0 ? Math.max(6, Math.round((d.value / trendMax) * 100)) : 0,
    })),
    maxValue: trendMax,
    hasData: trendDays.some((d) => d.value != null),
    note:
      size === 1
        ? "柱高为你当天手工录入的最新阅读量快照；快照不是逐日增量，空白表示当天没有录入。"
        : "柱高为该时段内手工录入的最新阅读量快照；快照不是逐日增量，空白表示该时段没有录入。",
    todayKey: today,
  };

  // Style learning — real suggestions grouped by real status; revoked
  // suggestions carry no data any more and never re-enter the list.
  const list = Array.isArray(suggestions) ? suggestions : [];
  const styleLearning = {
    learningEnabled: profile ? profile.learningEnabled !== false : true,
    pending: list.filter((s) => s?.status === "pending").map(describeSuggestion),
    accepted: list.filter((s) => s?.status === "accepted").map(describeSuggestion),
    rejected: list.filter((s) => s?.status === "rejected").map(describeSuggestion),
    revoked: list.filter((s) => s?.status === "revoked").length,
  };

  return {
    ranges: RANGES,
    range,
    rangeLabelText: rangeLabel(range),
    // Structural fact: no platform analytics connection exists in this
    // product, so nothing on the page may claim verified platform data.
    hasVerifiedPlatformData: false,
    hasAnyMetrics: (Array.isArray(metrics) ? metrics : []).length > 0,
    recordedCount: (Array.isArray(metrics) ? metrics : []).length,
    kpi: {
      views: { value: viewsSeen ? viewsSum : null, missing: viewsMissing },
      engagement: {
        value: engagementSeen ? engagementSum : null,
        missing: engagementMissing,
      },
      reportedPublished,
    },
    trend,
    rows,
    styleLearning,
  };
}

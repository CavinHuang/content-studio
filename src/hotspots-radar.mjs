// Creator V2 hotspot radar (/hotspots) — pure display derivation.
// Visual/interaction spec: public/design/creator-v2.2.html hotspotsView
// (:142-153) + V2.2 refinement (:174). Like src/works-library.mjs this
// module holds only pure logic over the REAL payload of
// GET /api/creator/sources + GET /api/creator/source-items
// (src/creator.mjs:1980-2018) so the React component stays declarative
// and the rules are unit-testable (test/creator-v2-hotspots.test.mjs).
//
// Honest-metric rule (任务书 P0-B): source items carry no trend, heat or
// relevance fields, so this module never derives 升温中/热度分/与我相关 —
// those design-demo widgets stay hidden instead of being faked.

export const HOTSPOT_TABS = [
  { key: "all", label: "全部热点" },
  { key: "followed", label: "我关注的" },
];

// 今天 09:12 / 昨天 20:16 / 10 月 16 日 — same wall-clock rules as
// components/WorksLibrary.jsx dayLabel; returns '' for missing values so
// rows with an unsynced timestamp degrade instead of printing "Invalid Date".
export function dayClock(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((midnight(now) - midnight(d)) / 86400000);
  const time = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (diff <= 0) return `今天 ${time}`;
  if (diff === 1) return `昨天 ${time}`;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

// Most recent real sync across the author's sources (creator_sources.last_run).
// '' when nothing has ever synced — the masthead then says so instead of
// showing a fabricated freshness number.
export function latestSyncAt(sources = []) {
  const times = sources
    .map((s) => Date.parse(s?.last_run || ""))
    .filter((t) => !Number.isNaN(t) && t > 0);
  if (!times.length) return "";
  return new Date(Math.max(...times)).toISOString();
}

export function buildHotspotsRadar({ items = [], tab = "all", query = "", followed = [] } = {}) {
  const q = String(query || "").trim().toLowerCase();
  const byTab =
    tab === "followed" ? items.filter((i) => followed.includes(i.id)) : items;
  const rows = q
    ? byTab.filter((i) =>
        `${i.title || ""}${i.summary || ""}${i.sourceName || ""}`.toLowerCase().includes(q)
      )
    : byTab;
  return {
    rows,
    counts: { all: items.length, followed: followed.length, shown: rows.length },
  };
}

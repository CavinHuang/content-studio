// Creator V2 calendar (/calendar) derivation — small pure adapter over
// GET /api/creator/overview (projects/topics/series) for the V2.2
// 内容日历 (public/design/creator-v2.2.html calendarView :162 + the V2.2
// refinement :180, via the design manifest §9). No storage, no fetches.
//
// Honesty rules encoded here (implementation prompt P1 /calendar:
// "周/月视图基于已有内容系列与真实作品；无排期时为空，不捏造发布日期
// 或默认自动发布"):
//   - the only calendar events are REAL author plans: a topic's
//     targetDate (creator_topic_details JSON, set through POST/PUT
//     /api/creator/topics) and an active series' next_run_at
//     (creator_series — the date the next series preparation job
//     becomes due, src/creator.mjs:1803-1810);
//   - editorial works have NO schedule field, so they never become
//     calendar events; they appear only in the page's honest 未排期
//     strip (projectStage from src/creator-home.mjs);
//   - dismissed topics stop occupying the calendar; paused/completed
//     series stop producing 系列准备 events (updateSeries already
//     cancels queued jobs for non-active series, src/creator.mjs);
//   - no default date is ever invented: an unscheduled topic has
//     targetDate "" and simply is not on the calendar.
// Date math is string-based on YYYY-MM-DD keys (UTC-safe), weeks start
// Monday like the design strip; month grids emit 35 or 42 cells so
// every real month fits (the prototype hardcoded 35).

export const WEEKDAY_LABELS = [
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
  "周日",
];

export const SERIES_STATUS = {
  active: { label: "计划中", tone: "info" },
  paused: { label: "已暂停", tone: "warning" },
  completed: { label: "已完成", tone: "success" },
};

// creator_topics.status enum (src/creator.mjs updateTopic).
export const TOPIC_STATUS_LABELS = {
  draft: "候选",
  prepared: "已准备",
  confirmed: "已确认",
  writing: "创作中",
};

const DAY_MS = 86400000;
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function keyToUtc(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function utcToKey(dt) {
  return dt.toISOString().slice(0, 10);
}

export function isDayKey(key) {
  if (typeof key !== "string" || !KEY_RE.test(key)) return false;
  return keyToUtc(key).toISOString().slice(0, 10) === key;
}

// Today as a day key in the given IANA zone (the app convention is
// Asia/Shanghai, see lib/creator-client.js when()).
export function todayKey(timeZone = "Asia/Shanghai", at = new Date()) {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return isDayKey(key) ? key : "";
}

// An ISO instant → its day key in `timeZone` (series.next_run_at is
// stored as ISO; the series carries its own timezone).
export function isoToDayKey(iso, timeZone = "Asia/Shanghai") {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return todayKey(timeZone, new Date(t));
}

// Replace the DATE of an ISO instant while keeping its wall-clock
// time-of-day in `timeZone` — used when the author moves a series'
// 下次准备 date from the calendar's 调整安排 modal. Pure math.
export function moveIsoToDay(iso, timeZone, dayKey) {
  const base = Date.parse(iso);
  if (!Number.isFinite(base) || !isDayKey(dayKey)) return "";
  const wall = (ms) =>
    Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(ms))
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, Number(p.value)])
    );
  const cur = wall(base);
  const [y, m, d] = dayKey.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d, cur.hour, cur.minute, cur.second);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const zone = wall(guess);
    const asUtc = Date.UTC(
      zone.year,
      zone.month - 1,
      zone.day,
      zone.hour,
      zone.minute,
      zone.second
    );
    guess += target - asUtc;
  }
  return new Date(guess).toISOString();
}

export function addDays(key, n) {
  if (!isDayKey(key)) return "";
  return utcToKey(new Date(keyToUtc(key).getTime() + n * DAY_MS));
}

// Monday-start week containing key — the design strip order (周一看起).
export function weekOf(key) {
  if (!isDayKey(key)) return [];
  const utc = keyToUtc(key);
  const dow = (utc.getUTCDay() + 6) % 7;
  const monday = utc.getTime() - dow * DAY_MS;
  return Array.from({ length: 7 }, (_, i) =>
    utcToKey(new Date(monday + i * DAY_MS))
  );
}

// Month grid cells (no header): leading/trailing off-month days filled
// to whole Monday-start weeks — 35 or 42 cells, every real month fits.
export function monthCells(key) {
  if (!isDayKey(key)) return [];
  const utc = keyToUtc(key);
  const year = utc.getUTCFullYear();
  const month = utc.getUTCMonth();
  const first = Date.UTC(year, month, 1);
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const count = Math.ceil((lead + days) / 7) * 7;
  return Array.from({ length: count }, (_, i) => {
    const dt = new Date(first + (i - lead) * DAY_MS);
    return { key: utcToKey(dt), day: dt.getUTCDate(), off: dt.getUTCMonth() !== month };
  });
}

export function monthOf(key) {
  const d = keyToUtc(key);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

export function monthLabel(key) {
  const { year, month } = monthOf(key);
  return `${year} 年 ${month} 月`;
}

export function dayLabel(key) {
  if (!isDayKey(key)) return "";
  const d = keyToUtc(key);
  return `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日`;
}

export function weekdayLabel(key) {
  if (!isDayKey(key)) return "";
  return WEEKDAY_LABELS[(keyToUtc(key).getUTCDay() + 6) % 7];
}

// The toolbar pill — 设计 :180 的 v2-pill 位置放真实计数，不放"演示排期"。
export function periodPill(keys, eventsByDate) {
  const count = (keys || []).reduce(
    (n, k) => n + (eventsByDate.get(k)?.length || 0),
    0
  );
  return count === 0 ? "暂无排期" : `${count} 项计划`;
}

// Calendar events from the two real plan sources only.
export function buildEvents({ topics = [], series = [] } = {}) {
  const events = [];
  for (const t of Array.isArray(topics) ? topics : []) {
    if (!t || !isDayKey(t.targetDate)) continue;
    if (t.status === "dismissed") continue;
    events.push({
      kind: "topic",
      id: t.id,
      date: t.targetDate,
      title: t.title,
      status: t.status,
      projectId: t.projectId || null,
    });
  }
  for (const s of Array.isArray(series) ? series : []) {
    if (!s || s.status !== "active") continue;
    const date = isoToDayKey(s.nextRunAt, s.timezone || "Asia/Shanghai");
    if (!date) continue;
    const pending = (s.entries || []).filter((e) => e?.status === "pending");
    events.push({
      kind: "series",
      id: s.id,
      date,
      title: s.name,
      goal: s.goal,
      cadenceDays: s.cadenceDays,
      nextEntryTitle: pending[0]?.topic?.title || "",
    });
  }
  return events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function eventsByDate(events) {
  const map = new Map();
  for (const e of Array.isArray(events) ? events : []) {
    if (!map.has(e.date)) map.set(e.date, []);
    map.get(e.date).push(e);
  }
  return map;
}

// 设计 :162 —— 「10 月 21 日的安排」说明行；没有安排就如实说没有。
export function dayCopy(dayKey, dayEvents) {
  const list = dayEvents || [];
  return {
    heading: `${dayLabel(dayKey)}的安排`,
    empty: list.length === 0,
    hint: list.length
      ? "安排只是计划；到日期前需要你人工推进，不会自动生成或发布。"
      : "这一天还没有已排定的计划。可以从上方「安排内容」添加，或先去作品库继续写作。",
  };
}

export function describeSeries(s = {}) {
  const pending = (s.entries || []).filter((e) => e?.status === "pending");
  const meta = SERIES_STATUS[s.status] || { label: s.status || "", tone: "default" };
  return {
    id: s.id,
    revision: s.revision,
    name: s.name,
    goal: s.goal,
    status: s.status,
    statusLabel: meta.label,
    timezone: s.timezone || "Asia/Shanghai",
    // 原始 ISO 保留给 moveIsoToDay（调整安排时只换日期、保留原时刻）。
    nextRunAt: s.nextRunAt,
    cadenceDays: s.cadenceDays,
    nextRunKey: isoToDayKey(s.nextRunAt, s.timezone || "Asia/Shanghai"),
    nextEntryTitle: pending[0]?.topic?.title || "",
    pendingCount: pending.length,
  };
}

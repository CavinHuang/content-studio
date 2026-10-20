'use client';
// Creator V2 calendar (/calendar) — the real 内容日历 that takes over the
// V2 route placeholder (设计对应表：V2.2 内容日历 → /calendar).
// Visual form follows the approved design source
// public/design/creator-v2.2.html calendarView (:162) + the V2.2
// refinement (:180): the CONTENT CALENDAR page head with 安排内容, the
// shared toolbar (月份/计划 pill + 周视图/月视图 segments), the week
// strip with event pills and the selected-day 安排 row, the month grid
// with off-month cells and focused inset, the 长期内容系列 card, and the
// 日历不应该是隐藏的自动发布器 completion band. The prototype lost its
// toolbar in month view to a String.replace bug (design manifest §9,
// known-boundary #4) — the real page keeps the toolbar and the selected-
// day 安排 row shared by both views.
//
// Real data only (v2-audit.md §1 /calendar row) — no fabricated dates:
//   - GET /api/creator/overview (the same payload the home uses) supplies
//     topics / series / projects in one call;
//   - calendar events come ONLY from real author plans: a topic's
//     targetDate (small backend adaptation stored in the existing
//     creator_topic_details JSON, unit-tested in test/calendar-view.test.mjs)
//     and an active series' next_run_at;
//   - editorial works have no schedule field, so they appear only in the
//     honest 未排期的进行中作品 strip — never as fake calendar events;
//   - 安排内容 creates a real topic via POST /api/creator/topics (with the
//     author-chosen date; no default date) and 调整安排 moves a series'
//     next preparation date via PUT /api/creator/series/:id with
//     expectedRevision conflict protection. Nothing auto-generates,
//     auto-publishes, or implies a release date.
// Pure derivation lives in src/calendar-view.mjs; unavailable data
// surfaces an actionable error with retry.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CreatorShell from './CreatorShell';
import Icon from './creator/Icon';
import { EmptyState, ErrorState, InlineStatus, PageHeader, Tag } from './creator/primitives';
import { api, send } from '../lib/creator-client';
import { projectStage } from '../src/creator-home.mjs';
import {
  addDays,
  buildEvents,
  dayCopy,
  dayLabel,
  describeSeries,
  eventsByDate,
  monthCells,
  monthLabel,
  moveIsoToDay,
  periodPill,
  todayKey,
  weekOf,
  weekdayLabel,
} from '../src/calendar-view.mjs';

const TOPIC_STATUS_LABELS = {
  draft: '候选',
  prepared: '已准备',
  confirmed: '已确认',
  writing: '创作中',
};
const MAX_WORK_ROWS = 5;
const MAX_PILLS = 2;

// 系列卡 meta 行是单行摘要：长篇目标题截断显示，完整标题在当日安排与选题页可见。
const shortTitle = (t) => (t.length > 18 ? t.slice(0, 18) + '…' : t);

function ScheduleModal({ open, defaultDate, busy, onClose, onNotice, onDone }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultDate || '');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const inputRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDate(defaultDate || '');
    setError('');
    setPending(false);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, defaultDate]);

  if (!open) return null;

  async function save() {
    setError('');
    setPending(true);
    try {
      await send('/api/creator/topics', 'POST', {
        title: title.trim(),
        targetDate: date,
        reason: '内容日历排期计划',
      });
      onNotice('已加入内容日历；安排只是计划，不会自动生成或发布。');
      onDone(date);
    } catch (e) {
      setError(e.message || '保存未完成');
      setPending(false);
    }
  }

  const disabled = busy || pending || title.trim().length < 3 || !date;
  return (
    <div className="cv2-modal-overlay">
      <div className="cv2-modal" role="dialog" aria-modal="true" aria-label="安排下一篇">
        <h3>安排下一篇</h3>
        <p>计划会进入内容日历，不会自动生成、计费或发布；到日期前仍需你人工推进。</p>
        <input
          ref={inputRef}
          aria-label="内容主题"
          placeholder="这次打算写什么？"
          maxLength={240}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={pending}
        />
        <label className="cv2-cal-field">
          目标日期（计划日期，不是发布日期）
          <input
            type="date"
            aria-label="目标日期"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={pending}
          />
        </label>
        {error ? (
          <p className="cv2-status is-error" role="status">
            <span className="cv2-status-dot" aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
        <div className="cv2-modal-foot cv2-cal-modal-foot">
          <button type="button" className="cv2-btn" onClick={onClose} disabled={pending}>
            取消
          </button>
          <button type="button" className="cv2-btn primary" onClick={save} disabled={disabled}>
            {pending ? '正在保存…' : (
              <>
                保存计划 <Icon name="arrow" size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function SeriesAdjustModal({ series, busy, onClose, onNotice, onDone }) {
  // series 在弹窗关闭时为 null：SSR 预渲染会完整执行本组件，
  // useState 初始化器必须容忍空值（不能依赖下方 early-return）。
  const [date, setDate] = useState(series?.nextRunKey || '');
  const [cadence, setCadence] = useState(String(series?.cadenceDays ?? ''));
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!series) return;
    setDate(series.nextRunKey || '');
    setCadence(String(series.cadenceDays || ''));
    setError('');
    setPending(false);
  }, [series]);
  useEffect(() => {
    if (!series) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [series]);

  if (!series) return null;

  async function save() {
    setError('');
    const nextRunAt = moveIsoToDay(series.nextRunAt || '', series.timezone || 'Asia/Shanghai', date);
    if (!nextRunAt) {
      setError('请选择一个真实的日历日期');
      return;
    }
    setPending(true);
    try {
      await send('/api/creator/series/' + series.id, 'PUT', {
        expectedRevision: series.revision,
        nextRunAt,
        cadenceDays: Number(cadence),
      });
      onNotice('系列安排已更新；到期的准备任务完成后仍需你确认。');
      onDone();
    } catch (e) {
      setError(e.status === 409 ? '系列已变化，请重新打开后调整。' : e.message || '调整未完成');
      setPending(false);
    }
  }

  const cadenceNumber = Number(cadence);
  const disabled =
    busy || pending || !date || !Number.isInteger(cadenceNumber) || cadenceNumber < 1 || cadenceNumber > 365;
  return (
    <div className="cv2-modal-overlay">
      <div className="cv2-modal" role="dialog" aria-modal="true" aria-label="调整系列安排">
        <h3>调整安排 · {series.name}</h3>
        <p>下次准备日期与间隔只影响系列计划，不会自动发布任何内容。</p>
        <label className="cv2-cal-field">
          下次准备日期
          <input
            type="date"
            aria-label="下次准备日期"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={pending}
          />
        </label>
        <label className="cv2-cal-field">
          准备间隔（天，1–365）
          <input
            type="number"
            min="1"
            max="365"
            aria-label="准备间隔天数"
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
            disabled={pending}
          />
        </label>
        {error ? (
          <p className="cv2-status is-error" role="status">
            <span className="cv2-status-dot" aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
        <div className="cv2-modal-foot cv2-cal-modal-foot">
          <button type="button" className="cv2-btn" onClick={onClose} disabled={pending}>
            取消
          </button>
          <button type="button" className="cv2-btn primary" onClick={save} disabled={disabled}>
            {pending ? '正在保存…' : '保存安排'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EventPills({ dayEvents, className }) {
  if (!dayEvents?.length) return null;
  const shown = dayEvents.slice(0, MAX_PILLS);
  const rest = dayEvents.length - shown.length;
  return (
    <>
      {shown.map((e) => (
        <span className={className} key={e.kind + ':' + e.id}>
          {e.kind === 'series' ? '系列准备 · ' + e.title : e.title}
        </span>
      ))}
      {rest > 0 ? (
        <span className={className + ' cv2-cal-pill-more'} key="more">
          +{rest}
        </span>
      ) : null}
    </>
  );
}

function DayDetail({ dayKey, dayEvents }) {
  const copy = dayCopy(dayKey, dayEvents);
  return (
    <section className="cv2-cal-day-detail" aria-label="当日安排">
      <div className="cv2-section-top">
        <div>
          <h3>{copy.heading}</h3>
          <p>{copy.hint}</p>
        </div>
        <Link className="cv2-btn tiny" href="/works">
          去作品库 <Icon name="arrow" size={12} />
        </Link>
      </div>
      {copy.empty ? null : (
        <ul className="cv2-cal-day-list">
          {dayEvents.map((e) => (
            <li key={e.kind + ':' + e.id} className="cv2-cal-day-event">
              {e.kind === 'series' ? (
                <>
                  <Tag tone="info">系列准备</Tag>
                  <strong>{e.title}</strong>
                  <span className="cv2-micro">
                    {e.nextEntryTitle ? `下一篇：${e.nextEntryTitle} · ` : ''}每 {e.cadenceDays} 天准备一篇
                  </span>
                  <Link className="cv2-btn tiny" href="/topics?view=series">
                    去系列 <Icon name="arrow" size={12} />
                  </Link>
                </>
              ) : (
                <>
                  <Tag tone="info">选题计划</Tag>
                  <strong>{e.title}</strong>
                  <span className="cv2-micro">
                    {TOPIC_STATUS_LABELS[e.status] || e.status} · 计划日期，非发布日期
                  </span>
                  {e.projectId ? (
                    <Link className="cv2-btn tiny" href={'/compose?project=' + encodeURIComponent(e.projectId)}>
                      打开作品 <Icon name="arrow" size={12} />
                    </Link>
                  ) : (
                    <Link className="cv2-btn tiny" href={'/topics?topic=' + encodeURIComponent(e.id)}>
                      去选题 <Icon name="arrow" size={12} />
                    </Link>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function CalendarWorkspace() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('week');
  const [anchor, setAnchor] = useState(() => todayKey() || '1970-01-04'); // Monday-safe fallback
  const [selected, setSelected] = useState(() => todayKey() || '');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [adjustId, setAdjustId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api('/api/creator/overview')
      .then((r) => {
        setData(r);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const events = useMemo(
    () =>
      buildEvents({
        topics: data?.topics || [],
        series: data?.series || [],
      }),
    [data]
  );
  const byDate = useMemo(() => eventsByDate(events), [events]);
  const seriesRows = useMemo(() => (data?.series || []).map(describeSeries), [data]);
  const adjusting = seriesRows.find((s) => s.id === adjustId) || null;
  const works = useMemo(() => {
    const list = (data?.projects || []).map((p) => ({ id: p.id, title: p.title, stage: projectStage(p) }));
    return { shown: list.slice(0, MAX_WORK_ROWS), rest: Math.max(0, list.length - MAX_WORK_ROWS) };
  }, [data]);

  const weekKeys = useMemo(() => weekOf(anchor), [anchor]);
  const monthDays = useMemo(() => monthCells(anchor), [anchor]);
  const viewKeys = mode === 'week' ? weekKeys : monthDays.map((c) => c.key);
  const weekRange = weekKeys.length
    ? dayLabel(weekKeys[0]) + ' — ' + dayLabel(weekKeys[6])
    : '';

  async function act(fn) {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setNotice(e.message || '操作未完成');
    } finally {
      setBusy(false);
    }
  }

  function stepPeriod(dir) {
    const next = mode === 'week' ? addDays(anchor, 7 * dir) : shiftMonth(anchor, dir);
    if (next) setAnchor(next);
  }

  return (
    <CreatorShell>
      <PageHeader
        eyebrow="CONTENT CALENDAR"
        title="把创作节奏，安排得从容一点"
        description="只展示已经安排的作品；AI 可以建议节奏，但不会擅自发布。"
        actions={
          <button
            type="button"
            className="cv2-btn primary"
            onClick={() => setScheduleOpen(true)}
          >
            <Icon name="plus" size={16} />
            <span>安排内容</span>
          </button>
        }
      />

      {notice ? (
        <p className="cv2-status is-success" role="status">
          <span className="cv2-status-dot" aria-hidden="true" />
          <span>{notice}</span>
        </p>
      ) : null}
      {loadError ? (
        <ErrorState
          title="内容日历加载失败"
          error={loadError}
          hint="检查本地服务是否在运行，然后重试。"
          onRetry={load}
        />
      ) : null}
      {loading && !data ? <InlineStatus busy>正在打开内容日历…</InlineStatus> : null}

      {data ? (
        <>
          {/* 共用工具栏 — creator-v2.2.html:180 .v2-calendar-toolbar/.v2-insight-bar/.v2-segments。
              原型月视图因 replace 未命中丢失工具栏（设计基准已知边界 #4），正式页两视图常驻。 */}
          <div className="cv2-cal-toolbar">
            <div className="cv2-insight-bar">
              <span>{monthLabel(anchor)}</span>
              <span className="v2-pill">{periodPill(viewKeys, byDate)}</span>
              <span>计划属于作品，Agent 不会直接发布</span>
            </div>
            <div className="cv2-cal-toolbar-actions">
              <div className="cv2-cal-step" role="group" aria-label="切换周期">
                <button type="button" aria-label="上一周期" onClick={() => stepPeriod(-1)}>
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const today = todayKey();
                    if (today) {
                      setAnchor(today);
                      setSelected(today);
                    }
                  }}
                >
                  今天
                </button>
                <button type="button" aria-label="下一周期" onClick={() => stepPeriod(1)}>
                  ›
                </button>
              </div>
              <div className="cv2-segments" role="group" aria-label="日历视图">
                {[
                  ['week', '周视图'],
                  ['month', '月视图'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    onClick={() => setMode(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {mode === 'week' ? (
            /* 周视图 — creator-v2.2.html:9 .calendar-strip/.day/.day .event + :162 说明行 */
            <section className="cv2-surface cv2-surface-pad" aria-label="本周安排">
              <div className="cv2-section-top">
                <div>
                  <h3>{monthLabel(anchor)} · 本周</h3>
                  <p>{weekRange}</p>
                </div>
                <Tag tone="info">周视图</Tag>
              </div>
              <div className="cv2-week" role="group" aria-label="本周日程">
                {weekKeys.map((key) => {
                  const dayEvents = byDate.get(key) || [];
                  const isSelected = key === selected;
                  return (
                    <button
                      type="button"
                      key={key}
                      className={'cv2-day' + (isSelected ? ' selected' : '')}
                      aria-pressed={isSelected}
                      aria-label={`${dayLabel(key)} ${weekdayLabel(key)}，${dayEvents.length} 项计划`}
                      onClick={() => setSelected(key)}
                    >
                      <small>{weekdayLabel(key)}</small>
                      <b>{Number(key.slice(-2))}</b>
                      <EventPills dayEvents={dayEvents} className="cv2-day-event" />
                    </button>
                  );
                })}
              </div>
              <DayDetail dayKey={selected} dayEvents={byDate.get(selected) || []} />
            </section>
          ) : (
            /* 月视图 — creator-v2.2.html:180 .v2-month（表头灰底/off 态/em 胶囊/focused inset） */
            <section className="cv2-surface cv2-surface-pad" aria-label="全月计划">
              <div className="cv2-section-top">
                <div>
                  <h3>{monthLabel(anchor)} · 全月计划</h3>
                  <p>按日期查看计划；变更不会自动发布</p>
                </div>
                <Tag>月视图</Tag>
              </div>
              <div className="cv2-month" role="group" aria-label={monthLabel(anchor) + '月历'}>
                {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((d) => (
                  <div key={d} className="cv2-month-head">
                    {d}
                  </div>
                ))}
                {monthDays.map((cell) => {
                  const dayEvents = byDate.get(cell.key) || [];
                  if (cell.off) {
                    return (
                      <div key={cell.key} className="cv2-month-cell off" aria-hidden="true">
                        {cell.day}
                      </div>
                    );
                  }
                  const isSelected = cell.key === selected;
                  return (
                    <button
                      type="button"
                      key={cell.key}
                      className={'cv2-month-cell' + (isSelected ? ' focused' : '')}
                      aria-pressed={isSelected}
                      aria-label={`${dayLabel(cell.key)} ${weekdayLabel(cell.key)}，${dayEvents.length} 项计划`}
                      onClick={() => setSelected(cell.key)}
                    >
                      {cell.day}
                      <EventPills dayEvents={dayEvents} className="cv2-month-event" />
                    </button>
                  );
                })}
              </div>
              <DayDetail dayKey={selected} dayEvents={byDate.get(selected) || []} />
            </section>
          )}

          {/* 长期内容系列 — creator-v2.2.html:162 系列卡；真实 series 数据 + 调整安排（PUT series） */}
          <section className="cv2-surface cv2-surface-pad cv2-cal-series" aria-label="长期内容系列">
            <div className="cv2-section-top">
              <div>
                <h3>长期内容系列</h3>
                <p>每次只准备下一篇，根据本周的时间与资料成熟度灵活调整。</p>
              </div>
            </div>
            {seriesRows.length ? (
              seriesRows.map((s) => (
                <div className="cv2-cal-series-row" key={s.id}>
                  <div>
                    <b>{s.name}</b>
                    <p className="cv2-micro">
                      {s.goal}
                    </p>
                    <p className="cv2-micro">
                      每 {s.cadenceDays} 天准备一篇
                      {s.nextRunKey ? ` · 下次准备 ${dayLabel(s.nextRunKey)}` : ''}
                      {s.nextEntryTitle ? ` · 下一篇：${shortTitle(s.nextEntryTitle)}` : ''}
                      {s.pendingCount ? ` · 待确认 ${s.pendingCount} 篇` : ''}
                    </p>
                  </div>
                  <div className="cv2-cal-series-actions">
                    <Tag tone={s.status === 'active' ? 'info' : s.status === 'paused' ? 'warning' : 'success'}>
                      {s.statusLabel}
                    </Tag>
                    <button type="button" className="cv2-btn tiny" onClick={() => setAdjustId(s.id)}>
                      调整安排
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState
                icon="book"
                title="还没有长期内容系列"
                hint="系列在选题页规划：设定目标与节奏后，下次准备日期会出现在日历上。"
                action={
                  <Link className="cv2-btn tiny" href="/topics?view=series">
                    去规划系列 <Icon name="arrow" size={12} />
                  </Link>
                }
              />
            )}
          </section>

          {/* 真实作品的诚实位置：作品没有排期字段，只在此列出，绝不伪装成日历事件 */}
          {works.shown.length ? (
            <section className="cv2-surface cv2-surface-pad cv2-cal-works" aria-label="未排期的进行中作品">
              <div className="cv2-section-top">
                <div>
                  <h3>未排期的进行中作品</h3>
                  <p>这些作品还没有计划日期；日历只展示你明确安排的内容。</p>
                </div>
                <Link className="cv2-btn tiny" href="/works">
                  全部作品 <Icon name="arrow" size={12} />
                </Link>
              </div>
              <ul className="cv2-cal-work-list">
                {works.shown.map((w) => (
                  <li key={w.id}>
                    <strong>{w.title}</strong>
                    <Tag tone={w.stage.tone}>{w.stage.label}</Tag>
                    <Link
                        className="cv2-btn tiny"
                        href={'/compose?project=' + encodeURIComponent(w.id)}
                      >
                      继续创作 <Icon name="arrow" size={12} />
                    </Link>
                  </li>
                ))}
              </ul>
              {works.rest > 0 ? (
                <p className="cv2-micro">
                  还有 {works.rest} 篇在作品库。
                </p>
              ) : null}
            </section>
          ) : null}

          {/* 完成条 — creator-v2.2.html:70,180 .v2-completion */}
          <div className="cv2-completion">
            <div>
              <strong>日历不应该是隐藏的自动发布器</strong>
              <p>每个日期展示已计划的作品、人工待办和执行证据；安排只是计划，不替你发送内容。</p>
            </div>
            <Link className="cv2-btn" href="/publish">
              查看待交付内容 <Icon name="arrow" size={14} />
            </Link>
          </div>
        </>
      ) : null}

      <ScheduleModal
        open={scheduleOpen}
        defaultDate={selected}
        busy={busy}
        onClose={() => setScheduleOpen(false)}
        onNotice={setNotice}
        onDone={(date) => {
          setScheduleOpen(false);
          if (date) {
            setAnchor(date);
            setSelected(date);
          }
          load();
        }}
      />
      <SeriesAdjustModal
        series={adjusting}
        busy={busy}
        onClose={() => setAdjustId(null)}
        onNotice={setNotice}
        onDone={() => {
          setAdjustId(null);
          load();
        }}
      />
    </CreatorShell>
  );
}

function shiftMonth(key, dir) {
  const [y, m] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + dir, 1));
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-01`;
}

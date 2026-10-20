'use client';
// Creator V2 insights (/insights) — the real 效果复盘 that takes over the
// V2 route placeholder (设计对应表：V2.2 效果复盘 → /insights).
// Visual form follows the approved design source
// public/design/creator-v2.2.html reviewView (:161) + the V2.2
// refinement (:181): the INSIGHTS / LEARNING page head, the data-source
// declaration band, the shared range toolbar (7/30/90 天 segments +
// 未连接 pill), the three KPI cards, the 内容表现 column (trend bars +
// recorded-entries table), the 写作风格 column (suggestion card with an
// explicit confirm step + preference rows) and the three v2-learning
// principle cards.
//
// Honesty contract for this page (implementation prompt §3 P1):
//   - There is NO platform-analytics connection in this product. The
//     未连接平台统计 pill is permanent and the trend/KPI numbers come
//     ONLY from author-entered 复盘 records (creator_metrics via
//     POST /api/creator/projects/:id/metrics — the same contract the
//     old library detail form used, moved here per the /library
//     deviation "人工复盘随 /insights 承接"). Nothing fabricates
//     clicks, reads or CTR; missing values render as —.
//   - Style learning lists ONLY real suggestions from
//     /api/creator/style-suggestions and writes to the profile solely
//     through the author's accept decision (decideStyle with
//     expectedRevision conflict protection). 提炼 new suggestions stays
//     in 偏好与连接, where the consent checkbox lives.
// Pure derivation lives in src/insights-view.mjs; unavailable data
// surfaces an actionable error with retry.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CreatorShell from './CreatorShell';
import Icon from './creator/Icon';
import {
  EmptyState,
  ErrorState,
  InlineStatus,
  PageHeader,
  SectionCard,
  Tag,
} from './creator/primitives';
import { api, send } from '../lib/creator-client';
import { RANGES, buildInsightsView } from '../src/insights-view.mjs';

const CHANNEL_OPTIONS = [
  ['wechat', '微信公众号'],
  ['zhihu', '知乎'],
  ['xiaohongshu', '小红书'],
];

const fmt = (n) => (n == null ? '—' : n.toLocaleString('en-US'));

function RecordModal({ open, projects, onClose, onNotice, onDone }) {
  const [projectId, setProjectId] = useState('');
  const [channel, setChannel] = useState('wechat');
  const [views, setViews] = useState('');
  const [likes, setLikes] = useState('');
  const [comments, setComments] = useState('');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const selectRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    setProjectId('');
    setChannel('wechat');
    setViews('');
    setLikes('');
    setComments('');
    setUrl('');
    setNote('');
    setError('');
    setPending(false);
    const t = setTimeout(() => selectRef.current?.focus(), 0);
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!open) return null;

  async function save() {
    setError('');
    if (!projectId) {
      setError('请选择要复盘的作品');
      return;
    }
    setPending(true);
    try {
      const num = (v) => (v === '' ? null : Number(v));
      await send('/api/creator/projects/' + projectId + '/metrics', 'POST', {
        channel,
        url: url.trim(),
        views: num(views),
        likes: num(likes),
        comments: num(comments),
        note: note.trim(),
      });
      onNotice('复盘数据已保存，来源标记为人工录入；平台自动统计仍未连接。');
      onDone();
    } catch (e) {
      setError(e.message || '保存未完成');
      setPending(false);
    }
  }

  return (
    <div className="cv2-modal-overlay">
      <div className="cv2-modal" role="dialog" aria-modal="true" aria-label="记录复盘数据">
        <h3>记录复盘数据</h3>
        <p>
          这里没有平台自动统计：数字来自你发布后到平台后台看到的手工记录。每条都会标注渠道与录入时间，缺失项显示为
          —。
        </p>
        <label className="cv2-ins-field">
          复盘作品
          <select
            ref={selectRef}
            aria-label="复盘作品"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={pending}
          >
            <option value="">请选择作品…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label className="cv2-ins-field">
          渠道
          <select
            aria-label="复盘渠道"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            disabled={pending}
          >
            {CHANNEL_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="cv2-ins-field-row">
          <label className="cv2-ins-field">
            阅读量（选填）
            <input
              type="number"
              min="0"
              step="1"
              aria-label="阅读量"
              value={views}
              onChange={(e) => setViews(e.target.value)}
              disabled={pending}
            />
          </label>
          <label className="cv2-ins-field">
            点赞（选填）
            <input
              type="number"
              min="0"
              step="1"
              aria-label="点赞数"
              value={likes}
              onChange={(e) => setLikes(e.target.value)}
              disabled={pending}
            />
          </label>
          <label className="cv2-ins-field">
            评论（选填）
            <input
              type="number"
              min="0"
              step="1"
              aria-label="评论数"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              disabled={pending}
            />
          </label>
        </div>
        <label className="cv2-ins-field">
          文章链接（选填，用于核对来源）
          <input
            type="url"
            aria-label="文章链接"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={pending}
          />
        </label>
        <label className="cv2-ins-field">
          复盘备注（哪些表达有效？下一篇怎样调整？）
          <textarea
            aria-label="复盘备注"
            rows={2}
            maxLength={4000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending}
          />
        </label>
        {error ? (
          <p className="cv2-status is-error" role="status">
            <span className="cv2-status-dot" aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
        <div className="cv2-modal-foot cv2-ins-modal-foot">
          <button type="button" className="cv2-btn" onClick={onClose} disabled={pending}>
            取消
          </button>
          <button type="button" className="cv2-btn primary" onClick={save} disabled={pending}>
            {pending ? '正在保存…' : (
              <>
                保存复盘记录 <Icon name="arrow" size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function TrendBars({ trend, rangeLabelText }) {
  const withData = trend.days.filter((d) => d.value != null).length;
  return (
    <>
      <div
        className="cv2-ins-trend"
        role="img"
        aria-label={`最近${rangeLabelText}阅读量快照柱状图：${withData} 个时段有录入记录，最高 ${fmt(trend.maxValue)}`}
      >
        {trend.days.map((d) => (
          <div key={d.key}>
            {d.value != null ? <span style={{ height: d.height + '%' }} /> : null}
            <small>{d.label}</small>
          </div>
        ))}
      </div>
      <p className="cv2-micro cv2-ins-trend-note">{trend.note}</p>
    </>
  );
}

function EntryTable({ rows }) {
  return (
    <table className="cv2-ins-table">
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="cv2-ins-table-main">
              <Link
                className="cv2-ins-table-title"
                href={'/compose?project=' + encodeURIComponent(r.projectId)}
              >
                {r.projectTitle}
              </Link>
              <span className="cv2-micro">
                {r.recordedLabel} 录入
                {r.entryCount > 1 ? ` · 该渠道共 ${r.entryCount} 次记录` : ''}
              </span>
              {r.note ? <span className="cv2-micro cv2-ins-table-note">{r.note}</span> : null}
            </td>
            <td>
              <span className="cv2-ins-tags">
                <Tag>{r.channelLabel}</Tag>
                {r.stage ? <Tag tone={r.stage.tone}>{r.stage.label}</Tag> : null}
              </span>
            </td>
            <td className="cv2-ins-num">
              阅读 <b>{fmt(r.views)}</b>
              <span className="cv2-ins-num-sub">
                赞 {fmt(r.likes)} · 评 {fmt(r.comments)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SuggestionRow({ s, tone, tagText }) {
  return (
    <details className="cv2-ins-pref">
      <summary>
        <span className="cv2-ins-pref-text">{s.summary || '（建议内容为空）'}</span>
        <span className="cv2-ins-pref-side">
          {s.decidedLabel ? <span className="cv2-micro">{s.decidedLabel}</span> : null}
          <Tag tone={tone}>{tagText}</Tag>
        </span>
      </summary>
      <ul className="cv2-ins-suggest-lines">
        {s.lines.map(([label, value]) => (
          <li key={label}>
            <b>{label}</b>
            <span>{value}</span>
          </li>
        ))}
      </ul>
      <p className="cv2-micro">
        依据：{s.evidenceTitles.length ? s.evidenceTitles.join('、') : '建议历史（来源保留在服务端）'}
      </p>
    </details>
  );
}

export default function CreatorInsights() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState('7d');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api('/api/creator/insights')
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

  const view = useMemo(
    () =>
      data
        ? buildInsightsView({
            projects: data.projects || [],
            metrics: data.metrics || [],
            suggestions: data.styleSuggestions || [],
            profile: data.profile || null,
            range,
          })
        : null,
    [data, range]
  );
  const projects = useMemo(
    () => (data?.projects || []).filter((p) => p?.id && p?.title),
    [data]
  );
  const learning = view?.styleLearning;
  const noSuggestionsAtAll =
    learning && !learning.pending.length && !learning.accepted.length && !learning.rejected.length;

  async function decide(id, action) {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await send('/api/creator/style-suggestions/' + id, 'POST', {
        action,
        expectedRevision: data.profile.revision,
      });
      setNotice(
        action === 'accept'
          ? '已按你确认的内容更新创作画像；建议依据保留在历史中。'
          : '已暂不采纳这条建议；创作画像没有变化。'
      );
      load();
    } catch (e) {
      setNotice(
        e.status === 409 ? '画像已变化，请根据最新状态重新确认。' : e.message || '操作未完成'
      );
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <CreatorShell>
      <PageHeader
        eyebrow="INSIGHTS / LEARNING"
        title="发布后，让经验回到下一篇"
        description="查看真实表现、记录写作判断，并让 AI 学习你明确认可的修改。"
        actions={
          <button type="button" className="cv2-btn" onClick={() => setRecordOpen(true)}>
            <Icon name="edit" size={16} />
            <span>记录复盘数据</span>
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
          title="效果复盘加载失败"
          error={loadError}
          hint="检查本地服务是否在运行，然后重试。"
          onRetry={load}
        />
      ) : null}
      {loading && !data ? <InlineStatus busy>正在打开效果复盘…</InlineStatus> : null}

      {data && view ? (
        <>
          {/* 数据来源声明 — 设计 :161 setting-note 的真实化：本产品没有平台
              自动统计接入，声明条常驻说明页面数字的真实来源。 */}
          <p className="cv2-ins-note">
            这里<strong>没有连接任何平台的自动统计</strong>
            。页面只显示你能核对的两类数据：你发布后手工记录的复盘数据（每条标注渠道与录入时间），以及你明确确认过的风格学习。缺失项显示为
            —，不会被估算或补齐。
          </p>

          {/* 共用范围工具栏 — creator-v2.2.html:181 .v2-insight-bar/.v2-segments */}
          <div className="cv2-ins-bar">
            <div className="cv2-segments" role="group" aria-label="统计范围">
              {RANGES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={range === value}
                  onClick={() => setRange(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <span>选中的范围：{view.rangeLabelText} · 只统计这段时间内录入的复盘记录</span>
            <span className="v2-pill warn">未连接平台统计</span>
          </div>

          {/* KPI 三格 — creator-v2.2.html:161 .insight-kpis；无录入时为 — 而非 0 */}
          <div className="cv2-ins-kpis">
            <div className="cv2-surface cv2-surface-pad">
              <span className="cv2-micro">已记录阅读量</span>
              <strong>{fmt(view.kpi.views.value)}</strong>
              <small>
                作者手工录入 · 各渠道最新一次
                {view.kpi.views.missing ? ` · ${view.kpi.views.missing} 条未填` : ''}
              </small>
            </div>
            <div className="cv2-surface cv2-surface-pad">
              <span className="cv2-micro">已记录互动</span>
              <strong>{fmt(view.kpi.engagement.value)}</strong>
              <small>
                点赞与评论 · 作者手工录入
                {view.kpi.engagement.missing ? ` · ${view.kpi.engagement.missing} 条未填` : ''}
              </small>
            </div>
            <div className="cv2-surface cv2-surface-pad">
              <span className="cv2-micro">作者报告已发表</span>
              <strong>{view.kpi.reportedPublished}</strong>
              <small>作品库状态 · 未经平台核验，导出与报告不是平台发布成功</small>
            </div>
          </div>

          <div className="cv2-ins-cols">
            {/* 内容表现 — 设计左栏：趋势柱 + 记录表；真实数据=手工录入快照 */}
            <SectionCard
              title="内容表现"
              description="不只看浏览量，也看哪些内容真正帮助了读者"
              aside={<Tag tone="info">{view.rangeLabelText} · 人工录入</Tag>}
            >
              {view.trend.hasData ? (
                <TrendBars trend={view.trend} rangeLabelText={view.rangeLabelText} />
              ) : (
                <EmptyState
                  icon="book"
                  title="暂无已验证平台数据"
                  hint="产品未连接平台统计，这里不会出现自动抓取的阅读量。可以在本页手工记录复盘数据；所有数字都会标注为人工录入。"
                  action={
                    <button
                      type="button"
                      className="cv2-btn tiny"
                      onClick={() => setRecordOpen(true)}
                    >
                      记录一条复盘
                    </button>
                  }
                />
              )}
              {view.rows.length ? (
                <>
                  <div className="cv2-ins-table-head" />
                  <EntryTable rows={view.rows} />
                </>
              ) : null}
            </SectionCard>

            {/* 写作风格 — 设计右栏：建议卡（确认学习/暂不学习）+ 偏好行；
                真实语义=style-suggestions 的 accept/reject 决策流 */}
            <SectionCard
              title="你的写作风格，正在积累"
              description="学习必须由你确认，不能让一次改稿改变长期偏好"
            >
              {!learning.learningEnabled ? (
                <InlineStatus tone="warning">
                  画像学习已暂停：你可以在偏好与连接中重新开启。
                </InlineStatus>
              ) : null}
              {learning.pending.map((s) => (
                <article className="cv2-ins-suggest" key={s.id}>
                  <div className="cv2-ins-suggest-head">
                    <Tag tone="info">编辑习惯建议</Tag>
                    {s.evidenceTitles.length ? (
                      <span className="cv2-micro">依据：{s.evidenceTitles.join('、')}</span>
                    ) : null}
                  </div>
                  <ul className="cv2-ins-suggest-lines">
                    {s.lines.map(([label, value]) => (
                      <li key={label}>
                        <b>{label}</b>
                        <span>{value}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="cv2-micro">
                    采纳前不会写入画像；采纳后原建议与依据保留，可在画像历史中恢复。
                  </p>
                  <div className="cv2-ins-suggest-actions">
                    <button
                      type="button"
                      className="cv2-btn tiny primary"
                      disabled={busy}
                      onClick={() => decide(s.id, 'accept')}
                    >
                      采纳到画像
                    </button>
                    <button
                      type="button"
                      className="cv2-btn tiny"
                      disabled={busy}
                      onClick={() => decide(s.id, 'reject')}
                    >
                      暂不采纳
                    </button>
                  </div>
                </article>
              ))}
              {learning.accepted.map((s) => (
                <SuggestionRow key={s.id} s={s} tone="success" tagText="已采纳" />
              ))}
              {learning.rejected.map((s) => (
                <SuggestionRow key={s.id} s={s} tone="default" tagText="已拒绝" />
              ))}
              {noSuggestionsAtAll ? (
                <EmptyState
                  icon="spark"
                  title="还没有风格学习记录"
                  hint="风格建议在「偏好与连接」中从你选择的文章里提炼（发送前需确认范围）；只有你明确采纳的建议才会写入创作画像。"
                  action={
                    <Link className="cv2-btn tiny" href="/settings">
                      去偏好与连接 <Icon name="arrow" size={12} />
                    </Link>
                  }
                />
              ) : null}
            </SectionCard>
          </div>

          {/* 学习原则三卡 — creator-v2.2.html:181 .v2-learning（原则声明，非数据） */}
          <div className="cv2-learning">
            <article>
              <span className="v2-pill">选题判断</span>
              <strong>哪些问题真正触发阅读？</strong>
              <p>观察读者的实际问题和平台反馈，避免将一次高流量直接解释为选题有效。</p>
            </article>
            <article>
              <span className="v2-pill">文章质量</span>
              <strong>证据是否带来信任？</strong>
              <p>记录来源数量、纠错成本与发布后需要补充的信息。</p>
            </article>
            <article>
              <span className="v2-pill">风格学习</span>
              <strong>哪些人工修改值得沉淀？</strong>
              <p>只学习明确确认过的编辑习惯，所有规则保留出处与撤销能力。</p>
            </article>
          </div>
        </>
      ) : null}

      <RecordModal
        open={recordOpen}
        projects={projects}
        onClose={() => setRecordOpen(false)}
        onNotice={setNotice}
        onDone={() => {
          setRecordOpen(false);
          load();
        }}
      />
    </CreatorShell>
  );
}

'use client';
// Creator V2 home workspace — renders / (工作台) and the legacy /create
// entry. Visual form follows the approved design source
// public/design/creator-v2.2.html (homeView :141 + V2.2 refinements :173)
// and the design manifest §1: gradient hero, three-metric overview band,
// "接下来做什么" task list, recent works table, featured clues column and
// the closing completion band.
// Data comes only from GET /api/creator/overview; the pending/clue
// groupings are computed by src/creator-home.mjs (unit-tested in
// test/creator-home.test.mjs). There are no demo metrics: every number
// is a real count, every task links to a real workspace, and an empty
// workspace renders honest first-use guidance instead of fake KPIs.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import CreatorShell from './CreatorShell';
import Icon from './creator/Icon';
import { ErrorState, InlineStatus, SectionCard, Tag } from './creator/primitives';
import { api, send } from '../lib/creator-client';
import { projectStage, projectProgress } from '../src/creator-home.mjs';

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const TASK_ICONS = {
  corrections: 'shield',
  'master-sync': 'clock',
  checks: 'check',
  delivery: 'send',
  notification: 'spark',
  job: 'alert',
};
const EMPTY_HOME = { focusProjectId: null, counts: { inProgress: 0, pendingDecisions: 0, clues: 0 }, pending: [], clues: [] };

const pad2 = (n) => String(n).padStart(2, '0');

// 今天 14:32 / 昨天 20:16 / 10 月 16 日 — client-side only (data arrives
// after mount), so locale/timezone can never cause a hydration mismatch.
function dayLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((midnight(now) - midnight(d)) / 86400000);
  if (diff <= 0) return `今天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  if (diff === 1) return `昨天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function TaskRow({ task, onMarkRead }) {
  return (
    <div className="cv2-task-card">
      <span className="cv2-task-ico" aria-hidden="true">
        <Icon name={TASK_ICONS[task.kind] || 'clock'} />
      </span>
      <span className="cv2-task-copy">
        <strong>{task.title}</strong>
        <p>{task.description}</p>
      </span>
      <span className="cv2-task-actions">
        <Link className="cv2-btn tiny" href={task.href}>
          {task.actionLabel} <Icon name="chevron" size={13} />
        </Link>
        {onMarkRead ? (
          <button type="button" className="cv2-btn tiny ghost" onClick={onMarkRead}>
            标为已读
          </button>
        ) : null}
      </span>
    </div>
  );
}

function SignalRow({ clue }) {
  return (
    <div className="cv2-signal">
      <div className="cv2-signal-meta">
        <Tag tone="info">{clue.statusLabel}</Tag>
        <span className="cv2-micro">{dayLabel(clue.createdAt)}</span>
        {clue.favorite ? <Tag>已收藏</Tag> : null}
      </div>
      <Link className="cv2-signal-title" href={`/topics?topic=${encodeURIComponent(clue.id)}`}>
        {clue.title}
      </Link>
      {clue.angle ? <p>{clue.angle}</p> : null}
      <span className="cv2-source-line">{clue.refsCount ? `${clue.refsCount} 条参考素材` : '尚无关联素材'}</span>
    </div>
  );
}

export default function CreatorHome({ creation = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [today, setToday] = useState(null);
  const createInputRef = useRef(null);

  function load() {
    setError(null);
    api('/api/creator/overview').then(setData).catch(setError);
  }
  useEffect(() => {
    load();
    setToday(new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    // Legacy /create entry: put the quick-create input first in focus order
    // (the input mounts once the overview has loaded).
    if (creation && data) createInputRef.current?.focus();
  }, [creation, data]);

  async function create(e) {
    e.preventDefault();
    const name = title.trim();
    if (!name) {
      setNotice('先写下一个标题或想法');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const d = await send('/api/writing/projects', 'POST', { title: name });
      window.location.assign('/compose?project=' + d.projectId);
    } catch (err) {
      setNotice(err.message || '创建未完成');
      setBusy(false);
    }
  }

  // Preserve the legacy home capability: unread notifications (surfaced
  // here as pending tasks) can be marked read via the existing API.
  async function markNotificationRead(id) {
    try {
      await send('/api/creator/notifications/' + encodeURIComponent(id), 'POST');
      load();
    } catch (err) {
      setNotice(err.message || '操作未完成');
    }
  }

  const home = data?.home || EMPTY_HOME;
  const projects = data?.projects || [];
  const counts = home.counts;
  const focus = home.focusProjectId ? projects.find((p) => p.id === home.focusProjectId) : null;
  const firstUse = !!data && !projects.length && !counts.clues;
  const dateLabel = today
    ? `${WEEKDAYS[today.getDay()]} · ${MONTHS[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`
    : '';

  return (
    <CreatorShell>
      {creation && (
        <InlineStatus tone="info">
          把想法写成作品：写下标题即可开始；主稿、公众号稿与知乎稿在同一个创作空间里完成。
        </InlineStatus>
      )}
      {error ? (
        <ErrorState title="工作台加载失败" error={error} hint="检查本地服务是否在运行，然后重试。" onRetry={load} />
      ) : null}
      {!data && !error ? <InlineStatus busy tone="info">正在打开你的创作空间…</InlineStatus> : null}
      {notice ? (
        <p className="cv2-status is-error" role="status">
          <span className="cv2-status-dot" aria-hidden="true" />
          <span>{notice}</span>
        </p>
      ) : null}

      {data ? (
        <>
          {/* 主视觉横幅 — creator-v2.2.html:141 .hero */}
          <section className="cv2-hero">
            <div className="cv2-hero-copy">
              <p className="cv2-eyebrow">{dateLabel}</p>
              <h2>今天，先把一篇好文章写完。</h2>
              {firstUse ? (
                <p>
                  工作台还是空的：写下第一个标题就能创建作品，
                  <br />
                  也可以先去热点雷达和选题发现里找方向。
                </p>
              ) : (
                <p>
                  你有 {counts.inProgress} 篇正在创作的作品、{counts.clues} 个值得判断的线索。
                  <br />
                  先完成最重要的一件事，剩下的交给 AI 协助。
                </p>
              )}
              <div className="cv2-hero-actions">
                {focus ? (
                  <Link className="cv2-btn primary" href={`/compose?project=${encodeURIComponent(focus.id)}`}>
                    继续创作 <Icon name="arrow" size={16} />
                  </Link>
                ) : (
                  <button type="button" className="cv2-btn primary" onClick={() => createInputRef.current?.focus()}>
                    写下第一篇 <Icon name="arrow" size={16} />
                  </button>
                )}
                <Link className="cv2-btn" href="/topics">
                  看看今天的选题
                </Link>
              </div>
            </div>
            <div className="cv2-hero-art" aria-hidden="true">
              <div className="cv2-orb" />
              <div className="cv2-orb2" />
              <div className="cv2-paper">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
          </section>

          {/* 三格概览带 — creator-v2.2.html:173 .v2-overview-band；数字全部来自真实领域状态 */}
          <div className="cv2-overview-band">
            <article className="cv2-insight">
              <span className="cv2-label">正在创作</span>
              <div className="metric">
                {pad2(counts.inProgress)} <span className="unit">篇</span>
              </div>
              <p>先完成一篇，再开始下一篇</p>
            </article>
            <article className="cv2-insight">
              <span className="cv2-label">等待你的决策</span>
              <div className="metric">
                {pad2(counts.pendingDecisions)} <span className="unit">项</span>
              </div>
              <p>事实核查 · 发布确认</p>
            </article>
            <article className="cv2-insight">
              <span className="cv2-label">值得判断的线索</span>
              <div className="metric">
                {pad2(counts.clues)} <span className="unit">条</span>
              </div>
              <p>来源已记录，尚未核验</p>
            </article>
          </div>

          {firstUse ? (
            <SectionCard
              className="cv2-firstuse"
              title="为你的创作做好准备"
              description="三步开始；基础的新建、编辑、保存和导出不依赖任何配置。"
            >
              <div className="cv2-guide-grid">
                <div className="cv2-guide-step">
                  <Tag tone={data.profile?.domain ? 'success' : 'info'}>01 · 画像</Tag>
                  <strong>完善创作画像</strong>
                  <p>
                    {data.profile?.domain
                      ? '画像已填写，可以随时在偏好与连接中调整。'
                      : '帮助选题与写作助手理解你的读者和表达方式。'}
                  </p>
                  <Link className="cv2-btn tiny" href="/settings">
                    完善画像
                  </Link>
                </div>
                <div className="cv2-guide-step">
                  <Tag tone={data.services?.text ? 'success' : 'info'}>02 · 模型</Tag>
                  <strong>连接模型（可选）</strong>
                  <p>
                    {data.services?.text
                      ? '模型已连接；调用前会展示范围与费用。'
                      : '不连接模型也能完成写作；连接后 AI 功能才可用。'}
                  </p>
                  <Link className="cv2-btn tiny" href="/settings">
                    查看服务连接
                  </Link>
                </div>
                <div className="cv2-guide-step">
                  <Tag>03 · 方向</Tag>
                  <strong>找一个值得写的方向</strong>
                  <p>从热点雷达把线索收为选题候选，或直接在下方写下你自己的题目。</p>
                  <Link className="cv2-btn tiny" href="/hotspots">
                    打开热点雷达
                  </Link>
                </div>
              </div>
            </SectionCard>
          ) : null}

          <div className="cv2-home-cols">
            <div className="cv2-home-main">
              {/* 接下来做什么 — 真实待办（src/creator-home.mjs 聚合） */}
              <SectionCard
                title="接下来做什么"
                description="直接进入任务，不需要先理解复杂流程"
                aside={<Tag tone="info">{counts.pendingDecisions} 件待办</Tag>}
              >
                {home.pending.length ? (
                  home.pending.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onMarkRead={task.kind === 'notification' ? () => markNotificationRead(task.id) : undefined}
                    />
                  ))
                ) : (
                  <p className="cv2-home-line">
                    {projects.length
                      ? '没有等待处理的事项。继续写作，或看看值得判断的选题。'
                      : '创建第一篇作品后，需要核对的事实与发布检查会出现在这里。'}
                  </p>
                )}
              </SectionCard>

              {/* 最近的作品 — editorial.list() 按更新时间排序 */}
              <SectionCard
                className="cv2-recent"
                title="最近的作品"
                aside={
                  <Link className="cv2-section-link" href="/works">
                    查看全部 →
                  </Link>
                }
              >
                {projects.length ? (
                  <table className="cv2-works-table">
                    <tbody>
                      {projects.slice(0, 3).map((p) => {
                        const stage = projectStage(p);
                        // VA-03 六槽进度点（adapted from Easel DashboardPage
                        // 最近产物行）：单 projectStage Tag 保留承载终态文字，
                        // 点串只陈述 src/creator-home.mjs 派生的既有事实，
                        // title 承载诚实文案（无「已发布」，上限是「未核验」）。
                        const progress = projectProgress(p);
                        return (
                          <tr key={p.id}>
                            <td>
                              <Link className="cv2-table-title" href={`/compose?project=${encodeURIComponent(p.id)}`}>
                                {p.title}
                              </Link>
                            </td>
                            <td className="cv2-works-stage">
                              <Tag tone={stage.tone}>{stage.label}</Tag>
                              <span className="cv2-progress-dots">
                                {progress.map((slot) => (
                                  <span
                                    key={slot.key}
                                    className={`cv2-progress-dot is-${slot.tone}`}
                                    title={slot.title}
                                  />
                                ))}
                              </span>
                            </td>
                            <td className="cv2-works-time">{dayLabel(p.updatedAt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <p className="cv2-home-line">还没有作品。写下第一个标题，或先去挑一个选题。</p>
                )}
              </SectionCard>

              {/* 快捷建文 — POST /api/writing/projects，成功后进入创作空间 */}
              <section className="cv2-quick-create">
                <strong>从一个想法开始</strong>
                <p>写下标题或一个问题；选题、证据与大纲可以在创作中逐步完善。</p>
                <form onSubmit={create}>
                  <input
                    ref={createInputRef}
                    aria-label="文章标题"
                    required
                    minLength={3}
                    maxLength={240}
                    placeholder="例如：我想讨论 AI 工具真正解决了什么问题"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    disabled={busy}
                  />
                  <button type="submit" className="cv2-btn primary" disabled={busy}>
                    {busy ? '正在创建…' : '创建作品'}
                  </button>
                </form>
              </section>
            </div>

            {/* 值得研究的选题 — 未开始写作且未放弃的真实选题 */}
            <SectionCard
              className="cv2-home-side"
              title="值得研究的选题"
              description="已从热点和信源中筛出的写作方向"
              aside={
                <Link className="cv2-section-link" href="/topics">
                  进入选题 →
                </Link>
              }
            >
              {home.clues.length ? (
                home.clues.map((clue) => <SignalRow key={clue.id} clue={clue} />)
              ) : (
                <div className="cv2-empty">
                  <strong>还没有可判断的选题</strong>
                  <p>去热点雷达看看正在发生的事并把线索收为候选，或自己在选题页记下一个方向。</p>
                  <Link className="cv2-btn tiny" href="/hotspots">
                    打开热点雷达
                  </Link>
                </div>
              )}
            </SectionCard>
          </div>

          {/* 完成条 — creator-v2.2.html:173 .v2-completion */}
          <div className="cv2-completion">
            <div>
              <strong>把下一步留给真正的创作</strong>
              <p>模型、素材和发布账号只有使用时才出现；遇到中断，仍能继续编辑文章。</p>
            </div>
            <Link className="cv2-btn" href="/hotspots">
              前往独立热点雷达 <Icon name="arrow" size={14} />
            </Link>
          </div>
        </>
      ) : null}
    </CreatorShell>
  );
}

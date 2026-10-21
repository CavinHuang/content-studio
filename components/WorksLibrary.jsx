'use client';
// Creator V2 works library (/works) — the real 作品库. Visual form follows
// the approved design source public/design/creator-v2.2.html worksView
// (:156) + the V2.2 refinement (:176): page header with the primary
// 创建新作品 action, five-bucket stage pipeline, tab filters, the
// three-column work-card grid with the dashed "从一个想法开始" card and
// the closing "所有版本都属于同一篇作品" completion band.
// Data comes only from GET /api/editor/projects (editorial.list()); the
// stage buckets, subtitles and channel attribution are derived by
// src/works-library.mjs (unit-tested in test/works-library.test.mjs).
// Search and stage filtering are in-memory over that real payload — the
// endpoint has no server-side filter parameters (v2-audit.md §1). Create
// reuses POST /api/writing/projects exactly like the home quick-create;
// opening a card goes to /compose?project=… so the work continues on its
// actual master draft. No demo rows: an empty library renders the
// honest zero pipeline plus first-use guidance.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import CreatorShell from './CreatorShell';
import Icon from './creator/Icon';
import { ErrorState, InlineStatus, PageHeader, WorkCard } from './creator/primitives';
import { api, send } from '../lib/creator-client';
import { WORK_STAGES, buildWorksLibrary } from '../src/works-library.mjs';

// 今天 14:32 / 昨天 20:16 / 10 月 16 日 — client-side only (data arrives
// after mount), so locale/timezone can never cause a hydration mismatch.
// Same rules as components/CreatorHome.jsx:37.
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

function CreateWorkModal({ open, busy, inputRef, onClose, onCreate }) {
  const [title, setTitle] = useState('');
  // The parent passes a fresh inline onClose on every render; reading it
  // through a ref keeps the open-effect from re-running (and re-clearing the
  // title the author already typed) while the modal stays open.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    setTitle('');
    // autofocus like the prototype's modal input (creator-v2.2.html:165)
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current?.();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, inputRef]);

  if (!open) return null;
  return (
    <div className="cv2-modal-overlay">
      <div className="cv2-modal" role="dialog" aria-modal="true" aria-label="从一个想法开始">
        <h3>从一个想法开始</h3>
        <p>只需要写下标题或一个问题。选题、证据与大纲可以在创作中逐步完善。</p>
        <input
          ref={inputRef}
          aria-label="文章标题或想法"
          placeholder="例如：我想讨论 AI 工具真正解决了什么问题"
          maxLength={100}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCreate?.(title);
          }}
          disabled={busy}
        />
        <div className="cv2-modal-foot">
          <button type="button" className="cv2-btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="button" className="cv2-btn primary" onClick={() => onCreate?.(title)} disabled={busy}>
            {busy ? '正在创建…' : (
              <>
                创建作品 <Icon name="arrow" size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WorksLibrary() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [stage, setStage] = useState('all');
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const createInputRef = useRef(null);

  function load() {
    setError(null);
    api('/api/editor/projects')
      .then((d) => setData(d.projects || []))
      .catch(setError);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function create(rawTitle) {
    const name = String(rawTitle || '').trim();
    if (!name) {
      setNotice('先写下一个标题或想法');
      createInputRef.current?.focus();
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

  const lib = data ? buildWorksLibrary({ projects: data, stage, query }) : null;
  const emptyLibrary = !!lib && lib.counts.all === 0;

  return (
    <CreatorShell>
      <PageHeader
        eyebrow="YOUR LIBRARY"
        title="每篇作品，都有清晰的下一步"
        description="主稿、公众号稿、知乎稿与素材归于同一篇作品，不再分散在多个页面。"
        actions={
          <button type="button" className="cv2-btn primary cv2-works-create" onClick={() => setModalOpen(true)}>
            <Icon name="plus" size={16} />
            <span>创建新作品</span>
          </button>
        }
      />

      {error ? (
        <ErrorState title="作品库加载失败" error={error} hint="检查本地服务是否在运行，然后重试。" onRetry={load} />
      ) : null}
      {!data && !error ? <InlineStatus busy tone="info">正在打开作品库…</InlineStatus> : null}
      {notice ? (
        <p className="cv2-status is-error" role="status">
          <span className="cv2-status-dot" aria-hidden="true" />
          <span>{notice}</span>
        </p>
      ) : null}

      {lib ? (
        <>
          {/* 五格阶段管线 — creator-v2.2.html:176 .v2-pipeline；数字全部来自真实项目状态 */}
          <div className="cv2-pipeline" role="group" aria-label="按阶段查看作品">
            {WORK_STAGES.map((s) => (
              <button key={s.key} type="button" aria-pressed={stage === s.key} onClick={() => setStage(s.key)}>
                <small>{s.label}</small>
                <strong>{lib.counts[s.key]} 篇</strong>
                <span>
                  {s.hint}
                  {stage === s.key ? ' ✓' : ''}
                </span>
              </button>
            ))}
          </div>

          <div className="cv2-works-toolbar">
            {/* 同组 tab 筛选 — creator-v2.2.html:156 .tabbar */}
            <div className="cv2-tabbar" role="group" aria-label="阶段筛选">
              {WORK_STAGES.map((s) => (
                <button key={s.key} type="button" className="cv2-tab" aria-pressed={stage === s.key} onClick={() => setStage(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
            <label className="cv2-searchbox">
              <Icon name="search" size={16} />
              <input
                aria-label="搜索作品"
                placeholder="搜索作品标题…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>

          {/* 作品三列网格 — creator-v2.2.html:156 .work-grid；点卡片回到该作品主稿 */}
          <div className="cv2-work-grid">
            {lib.visible.map((w) => (
              <WorkCard
                key={w.id}
                href={`/compose?project=${encodeURIComponent(w.id)}`}
                title={w.title}
                subtitle={w.subtitle}
                stage={w.stage.label}
                stageTone={w.stage.tone}
                updated={dayLabel(w.updatedAt)}
                channels={w.channelTags}
                footer={
                  <span className="cv2-work-arrow" aria-hidden="true">
                    <Icon name="arrow" size={16} />
                  </span>
                }
              />
            ))}
            {stage === 'all' && !query ? (
              <button type="button" className="cv2-work-card cv2-work-new" onClick={() => setModalOpen(true)}>
                <span className="cv2-work-new-icon" aria-hidden="true">
                  <Icon name="plus" size={30} />
                </span>
                <b>从一个想法开始</b>
                <p>无需先填写复杂表单</p>
              </button>
            ) : null}
          </div>

          {lib.visible.length === 0 ? (
            <div className="cv2-empty" style={{ marginTop: 16 }}>
              {query ? (
                <>
                  <strong>没有匹配的作品</strong>
                  <p>换个关键词试试，或回到「全部」查看所有阶段。</p>
                </>
              ) : emptyLibrary ? (
                <>
                  <strong>作品库还是空的</strong>
                  <p>写下第一个标题即可创建作品；也可以先去热点雷达和选题发现里找方向。</p>
                </>
              ) : (
                <>
                  <strong>此阶段暂无作品</strong>
                  <p>这个阶段还没有作品；切换到「全部」查看其他阶段。</p>
                </>
              )}
            </div>
          ) : null}

          {/* 完成条 — creator-v2.2.html:176 .v2-completion */}
          <div className="cv2-completion">
            <div>
              <strong>所有版本都属于同一篇作品</strong>
              <p>主稿、公众号稿、知乎稿、历史修订与配图只管理一次，不再跨多个业务页面反复建档。</p>
            </div>
            <Link className="cv2-btn" href="/calendar">
              查看内容排期 <Icon name="arrow" size={14} />
            </Link>
          </div>
        </>
      ) : null}

      <CreateWorkModal
        open={modalOpen}
        busy={busy}
        inputRef={createInputRef}
        onClose={() => setModalOpen(false)}
        onCreate={create}
      />
    </CreatorShell>
  );
}

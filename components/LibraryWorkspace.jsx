'use client';
// Creator V2 library (/library) — the real 素材库 that takes over the
// legacy CreatorLibrary entry (设计对应表：V2.2 素材库 → /library).
// Visual form follows the approved design source
// public/design/creator-v2.2.html libraryView (:163) + the V2.2
// refinement (:182): the CONTENT LIBRARY page head with the 导入素材
// action, the 我的内容资料夹 collection strip (全部素材/参考线索/
// 视觉素材 — clicking a collection switches the kind filter and the
// search placeholder below, :185), the filter row with search + the
// 全部/文章/链接/图片 chips, the three-column asset grid with the
// colored icon tiles, and the 每条素材保留上下文 completion band.
//
// Real data only (v2-audit.md §1 /library row) — every action below is an
// existing SQLite-backed API; no mock success, no localStorage:
//   - GET /api/creator/library?q&kind&tag&archived&series&platform&from&to
//     → the only list source (server-side filtering, debounced);
//   - GET /api/creator/materials/:id → full note body for the detail;
//   - PUT /api/creator/library/meta → tags + archive (images included);
//   - POST /api/creator/materials (note/file) + POST /api/assets (image)
//     + POST /api/creator/materials/import-url (explicit consent, public
//     HTTPS only) → the three real import paths behind the 导入素材 modal;
//   - GET /api/creator/library/removal-preview + POST …/remove-source →
//     the 移除影响 flow with expectedProfileRevision/reviewToken;
//   - POST /api/creator/topics → 以此为素材创建选题 (deep link /topics);
//   - GET /api/creator/projects/:id/publishing → real delivery facts;
//   - GET /api/writing/projects/:id/master → real master download;
//   - GET /api/creator/library/visual-series → the reusable visual-series
//     overview (small read-only adapter, unit-tested in
//     test/library-view.test.mjs).
// Unavailable things surface actionable errors (retry / consent / server
// message) — never a static simulation. Empty library renders the honest
// first-use empty state.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import CreatorShell from './CreatorShell';
import Icon from './creator/Icon';
import { EmptyState, ErrorState, FilterChips, InlineStatus, PageHeader, Tag } from './creator/primitives';
import { api, send, downloadBlob, when } from '../lib/creator-client';
import {
  LIBRARY_COLLECTIONS,
  LIBRARY_KIND_CHIPS,
  collectionByKey,
  collectionPlaceholder,
  describeEntry,
  emptyCopy,
} from '../src/library-view.mjs';

const KINDS = { material: '参考素材', article: '文章', image: '图片' };
const FACT_LABELS = { published: '作者报告已发表', draft_saved: '已保存草稿', exported: '已导出' };
const EVIDENCE_LABELS = { provider_response: '平台接口回执', author_report: '作者记录', local_export: '本地导出' };
const isUrl = (v) => /^https?:\/\/\S+/i.test(String(v || '').trim());

function ImportModal({ open, busy, onClose, onNotice, onDone }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const inputRef = useRef(null);
  // onClose 经 ref 传递：弹窗内部状态只能在 open 变化时重置，
  // 不能因父组件（如防抖列表刷新）重渲染新的回调身份而被清空。
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setBody('');
    setConsent(false);
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
  }, [open]);

  if (!open) return null;
  const urlMode = isUrl(title);
  const disabled = busy || pending;

  async function importUrl() {
    setError('');
    setPending(true);
    try {
      await send('/api/creator/materials/import-url', 'POST', {
        url: title.trim(),
        allowExternalRequest: consent,
      });
      onNotice('公开链接已导入，内容仍需核对。');
      onDone();
    } catch (e) {
      setError(e.message || '导入未完成');
      setPending(false);
    }
  }

  async function saveNote() {
    setError('');
    setPending(true);
    try {
      await send('/api/creator/materials', 'POST', { kind: 'note', title: title.trim(), body });
      onNotice('参考笔记已保存。');
      onDone();
    } catch (e) {
      setError(e.message || '保存未完成');
      setPending(false);
    }
  }

  async function importFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    setPending(true);
    try {
      if (f.size > 6 * 1024 * 1024) throw Error('文件请控制在 6 MiB 内');
      if (f.type.startsWith('image/')) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        await send('/api/assets', 'POST', { name: f.name, alt: f.name, base64: btoa(binary) });
      } else {
        if (!/\.(md|txt|csv|json)$/i.test(f.name))
          throw Error('参考文档支持 Markdown、TXT、CSV、JSON；图片支持 PNG、JPEG、GIF、WebP');
        if (f.size > 150000) throw Error('文本素材请控制在 150 KB 内');
        await send('/api/creator/materials', 'POST', { kind: 'file', title: f.name, body: await f.text() });
      }
      onNotice('文件已保存到资产库。');
      onDone();
    } catch (err) {
      setError(err.message || '导入未完成');
      setPending(false);
    }
  }

  return (
    <div className="cv2-modal-overlay">
      <div className="cv2-modal" role="dialog" aria-modal="true" aria-label="导入素材">
        <h3>导入素材</h3>
        <p>可导入公开链接、上传本地文件或写下参考笔记。链接只读取公开 HTTPS 页面，付费或登录页请手动摘录。</p>
        <input
          ref={inputRef}
          aria-label="素材标题或网址"
          placeholder="粘贴 https://… 链接，或写下素材标题"
          maxLength={240}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={disabled}
        />
        {urlMode ? (
          <label className="cv2-lib-check">
            <input
              type="checkbox"
              checked={consent}
              disabled={disabled}
              onChange={(e) => setConsent(e.target.checked)}
            />
            确认读取此链接并保存摘录（仅公开页面，本次授权）
          </label>
        ) : (
          <textarea
            aria-label="内容或摘录"
            rows={4}
            placeholder="可选：粘贴摘录或写下要点"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={disabled}
          />
        )}
        {error ? (
          <p className="cv2-status is-error" role="status">
            <span className="cv2-status-dot" aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
        <div className="cv2-modal-foot">
          <label className={'cv2-lib-upload' + (disabled ? ' cv2-lib-upload-busy' : '')}>
            <Icon name="upload" size={14} />
            上传本地文件
            <input
              type="file"
              hidden
              accept=".md,.txt,.csv,.json,image/png,image/jpeg,image/webp,image/gif"
              onChange={importFile}
              disabled={disabled}
            />
          </label>
          <span className="cv2-lib-modal-actions">
            <button type="button" className="cv2-btn" onClick={onClose} disabled={disabled}>
              取消
            </button>
            {urlMode ? (
              <button type="button" className="cv2-btn primary" onClick={importUrl} disabled={disabled || !consent}>
                {pending ? '正在读取…' : (
                  <>
                    导入链接内容 <Icon name="arrow" size={14} />
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                className="cv2-btn primary"
                onClick={saveNote}
                disabled={disabled || title.trim().length < 2}
              >
                {pending ? '正在保存…' : (
                  <>
                    保存素材 <Icon name="arrow" size={14} />
                  </>
                )}
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

// V2-native 移除来源 block — same real endpoints as the legacy
// CreatorSourceRemoval (removal-preview → remove-source with
// expectedProfileRevision + reviewToken), restyled for the V2 tokens so
// the detail panel stays in the approved visual language.
function RemovalPanel({ kind, id, busy, onNotice, onDone }) {
  const [preview, setPreview] = useState(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');

  async function loadPreview() {
    setError('');
    try {
      setPreview(await api('/api/creator/library/removal-preview?' + new URLSearchParams({ kind, id })));
      setConsent(false);
    } catch (e) {
      setError(e.message || '影响范围查询未完成');
    }
  }

  async function remove() {
    setError('');
    try {
      await send('/api/creator/library/remove-source', 'POST', {
        kind,
        id,
        expectedProfileRevision: preview.expectedProfileRevision,
        reviewToken: preview.reviewToken,
        confirmRemove: true,
      });
      onNotice('来源已移除，关联推断和任务已处理；历史及备份按说明保留。');
      onDone();
    } catch (e) {
      setError(e.message || '移除未完成');
    }
  }

  return (
    <details className="cv2-lib-removal">
      <summary>{kind === 'article' ? '停用学习来源并查看影响' : '移除素材并查看画像影响'}</summary>
      {!preview ? (
        <>
          <p className="cv2-micro">先查看影响范围（涉及的作品、风格建议与画像字段），确认后才会执行移除。</p>
          <button type="button" className="cv2-btn tiny" onClick={loadPreview} disabled={busy}>
            查看影响范围
          </button>
        </>
      ) : (
        <div className="cv2-lib-removal-preview">
          <p>
            涉及 {preview.projectIds.length} 篇文章，{preview.suggestionIds.length} 条风格建议，
            {preview.profileFields.length} 个当前画像字段。作者手动改写过的独立偏好会保留。
          </p>
          <p>{preview.retention}</p>
          <p>相关生成与准备任务会停止，受影响文章停止参与画像学习。文章来源移除不会删除文章正文。</p>
          <label className="cv2-lib-check">
            <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} />
            我已核对影响范围，并理解历史与备份保留
          </label>
          <button type="button" className="cv2-btn" onClick={remove} disabled={busy || !consent}>
            确认移除来源并撤销相关推断
          </button>
        </div>
      )}
      {error ? (
        <p className="cv2-status is-error" role="status">
          <span className="cv2-status-dot" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </details>
  );
}

export default function LibraryWorkspace() {
  const [entries, setEntries] = useState(null);
  const [listError, setListError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [collection, setCollection] = useState('all');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [advanced, setAdvanced] = useState({ series: '', platform: '', from: '', to: '', tag: '' });
  const [seriesOptions, setSeriesOptions] = useState([]);
  const [visualSeries, setVisualSeries] = useState(null);
  const [seriesError, setSeriesError] = useState(null);
  const [projectTitles, setProjectTitles] = useState({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [tagsDraft, setTagsDraft] = useState('');
  const listEpoch = useRef(0);

  const queryParams = () =>
    new URLSearchParams({
      q,
      kind,
      tag: advanced.tag,
      archived: archived ? '1' : '0',
      series: advanced.series,
      platform: advanced.platform,
      from: advanced.from,
      to: advanced.to,
    }).toString();

  function loadList() {
    const version = ++listEpoch.current;
    setLoading(true);
    api('/api/creator/library?' + queryParams())
      .then((r) => {
        if (listEpoch.current !== version) return;
        setEntries(r.assets);
        setListError(null);
      })
      .catch((e) => {
        if (listEpoch.current !== version) return;
        setListError(e);
      })
      .finally(() => {
        if (listEpoch.current === version) setLoading(false);
      });
  }

  // 列表筛选由既有 API 服务端执行（q/kind/tag/archived/系列/平台/日期），
  // 防抖仅用于减少请求次数，不改变过滤语义。
  useEffect(() => {
    const timer = setTimeout(loadList, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, kind, archived, advanced]);

  useEffect(() => {
    api('/api/creator/series')
      .then((r) => setSeriesOptions(r.series))
      .catch(() => {});
    api('/api/editor/projects')
      .then((d) =>
        setProjectTitles(Object.fromEntries((d.projects || []).map((p) => [p.id, p.title])))
      )
      .catch(() => {});
    loadVisualSeries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadVisualSeries() {
    setSeriesError(null);
    api('/api/creator/library/visual-series')
      .then(setVisualSeries)
      .catch(setSeriesError);
  }

  function pickCollection(key) {
    // 设计 :185 — 集合点击联动下方 kind 筛选并清空搜索
    const c = collectionByKey(key);
    setCollection(c.key);
    setKind(c.kind);
    setQ('');
    if (archived) setArchived(false);
  }

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

  async function openDetail(a) {
    setSelectedId(a.id);
    setSelected(a);
    setTagsDraft(a.tags.join(', '));
    setPreviewFailed(false);
    setDetail({ loading: true });
    try {
      if (a.kind === 'material') {
        const m = await api('/api/creator/materials/' + a.id);
        setDetail({ body: m.body, url: m.url });
      } else if (a.kind === 'article') {
        const p = await api('/api/creator/projects/' + a.id + '/publishing');
        setDetail({ publishing: p });
      } else {
        setDetail({});
      }
    } catch (e) {
      setDetail({ error: e });
    }
  }

  function closeDetail() {
    setSelectedId(null);
    setSelected(null);
    setDetail(null);
  }

  async function saveTags() {
    await act(async () => {
      await send('/api/creator/library/meta', 'PUT', {
        kind: selected.kind,
        id: selected.id,
        tags: tagsDraft
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
        archived: selected.archived,
      });
      setNotice('标签已保存。');
      loadList();
    });
  }

  async function toggleArchive() {
    await act(async () => {
      await send('/api/creator/library/meta', 'PUT', {
        kind: selected.kind,
        id: selected.id,
        tags: selected.tags,
        archived: !selected.archived,
      });
      setNotice(selected.archived ? '资产已恢复。' : '资产已归档；勾选「已归档」可随时找回。');
      closeDetail();
      loadList();
    });
  }

  function createTopic() {
    act(async () => {
      const t = await send('/api/creator/topics', 'POST', {
        title: '基于 ' + selected.title.slice(0, 180) + ' 继续创作',
        refs: [{ kind: selected.kind, id: selected.id }],
        reason: '复用自己的创作资产',
      });
      window.location.assign('/topics?topic=' + t.id);
    });
  }

  function downloadMaster() {
    act(async () => {
      const d = await api('/api/writing/projects/' + selected.id + '/master');
      downloadBlob(
        new Blob([d.markdown], { type: 'text/markdown;charset=utf-8' }),
        'article-v' + d.revision + '.md'
      );
    });
  }

  const cards = (entries || []).map(describeEntry).filter(Boolean);
  const copy = emptyCopy({ hasQuery: !!q.trim(), kind, archived });
  const placeholder = collectionPlaceholder(collection);

  return (
    <CreatorShell>
      <PageHeader
        eyebrow="CONTENT LIBRARY"
        title="素材不是仓库，是作品的上下文"
        description="所有引用、图片和历史文章都能从作品中直接找到，不必来回切换。"
        actions={
          <button type="button" className="cv2-btn cv2-lib-import" onClick={() => setImportOpen(true)}>
            <Icon name="upload" size={16} />
            <span>导入素材</span>
          </button>
        }
      />

      {notice ? (
        <p className="cv2-status is-success" role="status">
          <span className="cv2-status-dot" aria-hidden="true" />
          <span>{notice}</span>
        </p>
      ) : null}
      {listError ? (
        <ErrorState
          title="素材库加载失败"
          error={listError}
          hint="检查本地服务是否在运行，然后重试。"
          onRetry={loadList}
        />
      ) : null}

      {/* 我的内容资料夹 — creator-v2.2.html:100-105,182 .v2-assets-head/.v2-collections */}
      <div className="cv2-assets-head">
        <div>
          <strong>我的内容资料夹</strong>
          <p>按来源与用途组织，而不是把抓取的全部数据直接加入模型上下文。</p>
        </div>
        <span className="v2-pill">点击分类切换下方素材</span>
      </div>
      <div className="cv2-collections" role="group" aria-label="内容资料夹分类">
        {LIBRARY_COLLECTIONS.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={collection === c.key}
            onClick={() => pickCollection(c.key)}
          >
            <span className={'v2-pill' + (collection === c.key ? ' good' : '')}>{c.pill}</span>
            <strong>{c.name}</strong>
            <p>{c.sub}</p>
          </button>
        ))}
      </div>

      {/* filter 行 — creator-v2.2.html:9 .filter-row + :163 chips */}
      <div className="cv2-lib-toolbar">
        <label className="cv2-searchbox">
          <Icon name="search" size={16} />
          <input
            aria-label="搜索素材或作品"
            placeholder={placeholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <FilterChips
          label="按类型筛选"
          options={LIBRARY_KIND_CHIPS.map((c) => ({ value: c.key, label: c.label }))}
          value={collection === 'all' && kind === '' ? 'all' : kind || 'all'}
          onChange={(key) => {
            const chip = LIBRARY_KIND_CHIPS.find((c) => c.key === key);
            setKind(chip?.kind || '');
            setCollection('all');
          }}
        />
        <button
          type="button"
          className="cv2-chip cv2-lib-archived"
          aria-pressed={archived}
          onClick={() => setArchived((v) => !v)}
        >
          {archived ? '正在查看已归档' : '查看已归档'}
        </button>
      </div>

      {/* 既有 API 的高级筛选（系列/平台/日期/标签）保留为折叠区，避免占据设计首屏 */}
      <details className="cv2-lib-advanced">
        <summary>更多筛选（系列、平台、日期与标签）</summary>
        <div className="cv2-lib-advanced-grid">
          <label>
            内容系列
            <select
              aria-label="筛选内容系列"
              value={advanced.series}
              onChange={(e) => setAdvanced({ ...advanced, series: e.target.value })}
            >
              <option value="">全部系列</option>
              {seriesOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            关联平台
            <select
              aria-label="筛选关联平台"
              value={advanced.platform}
              onChange={(e) => setAdvanced({ ...advanced, platform: e.target.value })}
            >
              <option value="">全部平台</option>
              {[
                ['wechat', '微信公众号'],
                ['zhihu', '知乎'],
                ['xiaohongshu', '小红书'],
              ].map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            创建日期起（北京时间）
            <input
              type="date"
              aria-label="创建日期起"
              value={advanced.from}
              onChange={(e) => setAdvanced({ ...advanced, from: e.target.value })}
            />
          </label>
          <label>
            创建日期止（北京时间，含当天）
            <input
              type="date"
              aria-label="创建日期止"
              value={advanced.to}
              onChange={(e) => setAdvanced({ ...advanced, to: e.target.value })}
            />
          </label>
          <label>
            标签
            <input
              aria-label="筛选标签"
              placeholder="精确匹配一个标签"
              value={advanced.tag}
              onChange={(e) => setAdvanced({ ...advanced, tag: e.target.value })}
            />
          </label>
        </div>
        <button
          type="button"
          className="cv2-btn tiny"
          onClick={() => {
            setAdvanced({ series: '', platform: '', from: '', to: '', tag: '' });
            setQ('');
            setKind('');
            setArchived(false);
          }}
        >
          清除筛选条件
        </button>
      </details>

      {/* 素材详情：设计原型此处只有 toast；正式页按 /publish 先例以真实
          详情面板承接（来源、引用关联、移除影响），偏差已登记。 */}
      {selected ? (
        <section className="cv2-surface cv2-lib-detail" aria-label="素材详情">
          <div className="cv2-lib-detail-head">
            <div className="cv2-lib-detail-title">
              <div className="cv2-chips">
                <Tag>{KINDS[selected.kind] || selected.kind}</Tag>
                {selected.archived ? <Tag tone="warning">已归档</Tag> : null}
                {selected.platforms?.length
                  ? selected.platforms.map((p) => (
                      <Tag key={p} title="来自真实交付记录或渠道稿内容">
                        {p === 'wechat' ? '公众号' : p === 'zhihu' ? '知乎' : '小红书'}
                      </Tag>
                    ))
                  : null}
              </div>
              <h3>{selected.title}</h3>
              <p className="cv2-micro">
                加入时间 {when(selected.createdAt)} ·{' '}
                {selected.usage?.length
                  ? `已被 ${selected.usage.length} 篇作品引用；归档会保留这些引用。`
                  : '当前还没有文章引用此资产。'}
              </p>
            </div>
            <button type="button" className="cv2-btn tiny" onClick={closeDetail}>
              关闭详情
            </button>
          </div>

          {detail?.loading ? <InlineStatus busy>正在打开素材内容…</InlineStatus> : null}
          {detail?.error ? (
            <div className="cv2-error-state" role="alert">
              <span className="cv2-error-icon">
                <Icon name="alert" size={20} />
              </span>
              <strong>素材内容加载失败</strong>
              <p>{String(detail.error.message || detail.error)}</p>
              <button type="button" className="cv2-btn" onClick={() => openDetail(selected)}>
                重试
              </button>
            </div>
          ) : null}

          {selected.kind === 'image' ? (
            <div className="cv2-lib-figure">
              {/* 真实本地预览（/api/assets/:id/preview，绝不外链）；加载失败给出可操作提示 */}
              {previewFailed ? (
                <p className="cv2-status is-error" role="status">
                  <span className="cv2-status-dot" aria-hidden="true" />
                  <span>
                    预览加载失败。图片文件仍在资产库中，可重试或前往创作空间的配图流程核查该素材映射。
                  </span>
                </p>
              ) : (
                <img
                  src={selected.previewUrl}
                  alt={selected.title}
                  onError={() => setPreviewFailed(true)}
                />
              )}
            </div>
          ) : detail?.body !== undefined && detail?.body !== null ? (
            <pre className="cv2-lib-text">{detail.body || '（素材尚未写入内容）'}</pre>
          ) : selected.kind === 'article' && !detail?.error ? (
            <pre className="cv2-lib-text">{selected.text || '（主稿还没有正文）'}</pre>
          ) : null}

          {selected.hasUrl || detail?.url ? (
            <a className="cv2-lib-source" href={detail?.url || selected.url} target="_blank" rel="noreferrer">
              查看原始来源 ↗
            </a>
          ) : null}

          <div className="cv2-lib-detail-actions">
            <input
              aria-label="资产标签"
              value={tagsDraft}
              placeholder="标签，以逗号分隔"
              onChange={(e) => setTagsDraft(e.target.value)}
              disabled={busy}
            />
            <button type="button" className="cv2-btn tiny" onClick={saveTags} disabled={busy}>
              保存标签
            </button>
            <button type="button" className="cv2-btn tiny" onClick={toggleArchive} disabled={busy}>
              {selected.archived ? '恢复资产' : '归档资产'}
            </button>
            <button type="button" className="cv2-btn tiny" onClick={createTopic} disabled={busy}>
              以此为素材创建选题 →
            </button>
            {selected.kind === 'article' ? (
              <>
                <Link className="cv2-btn tiny" href={'/compose?project=' + selected.id}>
                  打开文章
                </Link>
                <button type="button" className="cv2-btn tiny" onClick={downloadMaster} disabled={busy}>
                  下载主稿
                </button>
              </>
            ) : null}
          </div>

          {selected.usage?.length ? (
            <div className="cv2-lib-usage">
              <h4>关联作品</h4>
              {selected.usage.map((u) => (
                <Link
                  key={u.projectId + ':' + u.revision}
                  className="cv2-lib-usage-row"
                  href={'/compose?project=' + encodeURIComponent(u.projectId)}
                >
                  <span>{projectTitles[u.projectId] || u.projectId}</span>
                  <span className="cv2-micro">
                    引用于 v{u.revision} · {when(u.createdAt)}
                  </span>
                </Link>
              ))}
            </div>
          ) : null}

          {selected.kind === 'article' && detail?.publishing ? (
            <div className="cv2-lib-usage">
              <h4>发布与交付记录</h4>
              {detail.publishing.facts?.length ? (
                detail.publishing.facts.map((f) => (
                  <p className="cv2-lib-fact" key={f.id}>
                    {f.channel === 'wechat' ? '公众号' : f.channel === 'zhihu' ? '知乎' : f.channel} · v{f.revision} ·{' '}
                    {FACT_LABELS[f.kind] || f.kind} · {EVIDENCE_LABELS[f.evidence] || f.evidence} · {when(f.createdAt)}{' '}
                    {f.value?.url ? (
                      <a href={f.value.url} target="_blank" rel="noreferrer">
                        查看链接 ↗
                      </a>
                    ) : null}
                  </p>
                ))
              ) : (
                <p className="cv2-micro">尚无交付记录。文章从创建起就会保存，交付记录与效果数据在发布后继续积累。</p>
              )}
            </div>
          ) : null}

          {selected.kind === 'article' || selected.kind === 'material' ? (
            <RemovalPanel
              kind={selected.kind}
              id={selected.id}
              busy={busy}
              onNotice={setNotice}
              onDone={() => {
                closeDetail();
                loadList();
              }}
            />
          ) : null}
        </section>
      ) : null}

      {/* 素材三列网格 — creator-v2.2.html:9 .asset-grid/.asset-card/.asset-visual */}
      {loading && !entries ? <InlineStatus busy>正在打开素材库…</InlineStatus> : null}
      {entries ? (
        <div className="cv2-asset-grid" aria-busy={loading || undefined}>
          {cards.map((c) => (
            <button
              key={c.id}
              type="button"
              className="cv2-asset-card"
              aria-label={`查看素材详情：${c.title}`}
              onClick={() => openDetail(entries.find((e) => e.id === c.id))}
            >
              <span className={'cv2-asset-visual ' + c.variant}>
                <Icon name={c.kind === 'image' ? 'image' : c.icon} size={30} />
                {c.kind === 'image' ? (
                  // 真实缩略图覆盖图块底色；加载失败自动回退为示意图标
                  <img
                    src={entries.find((e) => e.id === c.id)?.previewUrl}
                    alt=""
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                ) : null}
              </span>
              <span className="cv2-asset-row">
                <Tag>{c.typeTag}</Tag>
                <span className="cv2-micro">
                  查看 <Icon name="arrow" size={12} />
                </span>
              </span>
              <h3>{c.title}</h3>
              <p>{c.subtitle}</p>
            </button>
          ))}
        </div>
      ) : null}
      {entries && cards.length === 0 && !listError ? (
        <EmptyState title={copy.title} hint={copy.hint} icon="folder" />
      ) : null}

      {/* 可复用视觉系列 — 任务书 P1 点名能力（设计未画，偏差登记）：
          真实 /api/creator/library/visual-series 只读总览 */}
      <section className="cv2-surface cv2-lib-series" aria-label="可复用视觉系列">
        <div className="cv2-section-top">
          <div>
            <h3>可复用视觉系列</h3>
            <p>在视觉工作台创建或加入系列；共享的是风格基调与已批准参考，不会自动改稿或发布。</p>
          </div>
          <Link className="cv2-btn tiny" href="/illustrations">
            前往视觉工作台 <Icon name="arrow" size={13} />
          </Link>
        </div>
        {seriesError ? (
          <div className="cv2-lib-series-state">
            <p className="cv2-status is-error" role="status">
              <span className="cv2-status-dot" aria-hidden="true" />
              <span>视觉系列总览加载失败：{String(seriesError.message || seriesError)}</span>
            </p>
            <button type="button" className="cv2-btn tiny" onClick={loadVisualSeries}>
              重试
            </button>
          </div>
        ) : !visualSeries ? (
          <InlineStatus busy>正在读取视觉系列…</InlineStatus>
        ) : visualSeries.series.length ? (
          <div className="cv2-lib-series-rows">
            {visualSeries.series.map((s) => (
              <div className="cv2-lib-series-row" key={s.id}>
                <strong>{s.name}</strong>
                <span className="cv2-micro">
                  修订 v{s.revision} · {s.memberCount} 篇作品
                  {s.ownerTitle ? ` · 所属作品《${s.ownerTitle}》` : ''}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="cv2-micro">还没有视觉系列；在视觉工作台为作品创建或加入系列后，会在这里汇总。</p>
        )}
      </section>

      {/* 完成条 — creator-v2.2.html:70-71,182 .v2-completion；措辞按真实能力改写 */}
      <div className="cv2-completion">
        <div>
          <strong>每条素材保留上下文</strong>
          <p>每条素材都保留来源、加入时间、标签与关联作品；引用前先核实，移除前先看影响范围。</p>
        </div>
        <Link className="cv2-btn" href="/topics">
          用素材发现选题 <Icon name="arrow" size={14} />
        </Link>
      </div>

      <ImportModal
        open={importOpen}
        busy={busy}
        onClose={() => setImportOpen(false)}
        onNotice={setNotice}
        onDone={() => {
          setImportOpen(false);
          loadList();
        }}
      />
    </CreatorShell>
  );
}

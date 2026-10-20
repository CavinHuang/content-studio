'use client';
// Creator V2 publish center (/publish) — the real 发布中心 that takes over
// the legacy StudioApp publish entry (设计对应表：V2.2 发布中心 → /publish).
// Visual form follows the approved design source
// public/design/creator-v2.2.html publishView (:160) + the V2.2
// refinement (:179): the 可交付≠已发布 platform-state strip, the
// 1fr/360px grid with two independent per-channel cards (four manual
// checks each), the phone preview rail, and the delivery-log band.
//
// Real data only (v2-audit.md §1 /publish row):
//   - GET /api/editor/projects (+?project= deep link) → project select;
//   - GET /api/editor/projects/:id → per-channel checks / statusLabel /
//     document.revision / masterOutdated / openCorrections;
//   - POST /api/editor/projects/:id/:channel/checks → the four manual
//     checks (expectedRevision conflict protection preserved);
//   - GET /api/creator/platforms + GET /api/assets → wechat draft
//     account / cover pickers;
//   - GET /api/creator/projects/:id/publishing → real delivery facts and
//     operations for the timeline;
//   - POST …/publishing/bundle | draft | report | reconcile → the only
//     delivery mutations, each keeping 导出≠草稿箱≠真实发布 explicit;
//   - GET /api/writing/projects/:id/:channel → the channel's REAL
//     markdown for the local layout preview (labelled 本地排版示意, never
//     a platform render; external image URLs are not loaded).
// No mock success states: send failures, outcome_unknown reconciliation
// and blocked exports all surface the server's honest message.
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import CreatorShell from './CreatorShell';
import Icon from './creator/Icon';
import { EmptyState, ErrorState, InlineStatus, PageHeader, Tag } from './creator/primitives';
import { api, send, downloadPackage, when } from '../lib/creator-client';
import {
  CHECK_ORDER,
  PUBLISH_CHANNELS,
  buildDeliveryTimeline,
  channelState,
  previewBlocks,
  previewReady,
  publishState,
  seedParagraphPreviewNote,
} from '../src/publish-center.mjs';

function ChannelCard({
  meta,
  entry,
  detail,
  accounts,
  assets,
  panelOpen,
  busy,
  history,
  onToggleCheck,
  onPrimary,
  onPanelToggle,
  onExportBundle,
  onSendDraft,
  onRecordReport,
  draft,
  setDraft,
}) {
  const state = channelState(entry);
  const pending = state.total - state.done;
  const wechat = meta.key === 'wechat';
  // 一次真实发送在途/已完成/待核实时不允许对同一账号+版本重复发送
  // （服务端同样拒绝，src/publishing.mjs:582-587）。
  const activeDraftOp = wechat
    ? (history?.operations || []).some(
        (o) =>
          o.channel === 'wechat' &&
          o.revision === entry.document?.revision &&
          ['sending', 'succeeded', 'outcome_unknown'].includes(o.state)
      )
    : false;
  const channelAccounts = accounts.filter((a) => a.platform === meta.key);
  const account = channelAccounts.find((a) => a.id === draft.accountId);
  const capabilityReady = !wechat || account?.capabilities?.draftRead === true;
  const canSend =
    wechat && !!account && capabilityReady && !!draft.coverAssetId && draft.consent && !activeDraftOp;

  return (
    <section className="cv2-surface cv2-channel-card" aria-label={`${meta.name}发布准备`}>
      <div className="cv2-channel-head">
        <div className="cv2-channel-id">
          <span className={'cv2-channel-logo ' + meta.key} aria-hidden="true">
            {meta.logo}
          </span>
          <div>
            <h3>{meta.name}</h3>
            <p>
              《{detail.title}》
            </p>
          </div>
        </div>
        <Tag tone={state.statusTag.tone}>{state.statusTag.label}</Tag>
      </div>

      {state.blockers.length ? (
        <ul className="cv2-channel-blockers">
          {state.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}

      <div className="cv2-checklist" role="group" aria-label={`${meta.name}四项人工检查`}>
        {CHECK_ORDER.map((key, i) => (
          <label className="cv2-check-item" key={key}>
            <input
              type="checkbox"
              checked={state.values[i]}
              disabled={busy !== null}
              aria-label={`${meta.name}发布前检查：${meta.checkLabels[key]}`}
              onChange={(e) => onToggleCheck(meta.key, key, e.target.checked)}
            />
            <span>{meta.checkLabels[key]}</span>
            <span className="cv2-check-state">{state.values[i] ? '已检查' : '待检查'}</span>
          </label>
        ))}
      </div>

      <p className="cv2-channel-status">
        渠道状态：{entry.statusLabel || entry.status || '草稿'}
        {entry.exportedRevision ? ` · 已交付版本 v${entry.exportedRevision}` : ''}
      </p>

      <div className="cv2-channel-foot">
        <Link className="cv2-btn tiny" href={`/compose?project=${encodeURIComponent(detail.id)}&channel=${meta.key}`}>
          {meta.editLabel}
        </Link>
        <button
          type="button"
          className="cv2-btn primary"
          disabled={busy !== null}
          onClick={() => (state.allChecked ? onPanelToggle(meta.key) : onPrimary(meta.key, pending))}
        >
          {state.allChecked ? (panelOpen ? '收起交付操作' : meta.draftReady) : '继续完成发布检查'}
          <Icon name="arrow" size={14} />
        </button>
      </div>

      {panelOpen ? (
        <div className="cv2-delivery-panel">
          {/* 交付操作区为真实功能所必需（设计原型此处只有 toast）；
              渐进披露保持卡片密度与设计一致（偏差登记 #4）。 */}
          <h4>{meta.name} · 交付操作</h4>
          <p className="cv2-delivery-note">
            以下均为<strong>本地交付或作者报告</strong>操作：导出与草稿箱推送都不是发布；真实发布由你在平台后台完成。
          </p>
          <div className="cv2-delivery-row">
            <button
              type="button"
              className="cv2-btn"
              disabled={busy !== null}
              onClick={() => onExportBundle(meta.key)}
            >
              <Icon name="download" size={15} /> 下载文章与图片交付包
            </button>
          </div>
          {wechat ? (
            <>
              <label className="cv2-delivery-field">
                发布账号
                <select
                  value={draft.accountId}
                  onChange={(e) => setDraft({ ...draft, accountId: e.target.value })}
                >
                  <option value="">选择账号（本地导出可不选）</option>
                  {channelAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.capabilities?.draftRead ? '（能力已检查）' : '（未检查能力）'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="cv2-delivery-field">
                封面图片
                <select
                  value={draft.coverAssetId}
                  onChange={(e) => setDraft({ ...draft, coverAssetId: e.target.value })}
                >
                  <option value="">从本地素材库选择封面</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.alt || a.filename}
                    </option>
                  ))}
                </select>
              </label>
              {!channelAccounts.length ? (
                <p className="cv2-delivery-hint">
                  还没有公众号账号；在
                  <Link href="/settings"> 偏好与连接 </Link>
                  添加账号并完成能力检查后，才能发送草稿。
                </p>
              ) : null}
              {account && !capabilityReady ? (
                <p className="cv2-delivery-hint">
                  该账号还没有通过草稿接口能力检查；先在
                  <Link href="/settings"> 偏好与连接 </Link>
                  中执行「检查能力」，再回到这里发送。
                </p>
              ) : null}
              <label className="cv2-delivery-consent">
                <input
                  type="checkbox"
                  checked={draft.consent}
                  onChange={(e) => setDraft({ ...draft, consent: e.target.checked })}
                />
                <span>确认发送当前公众号稿、封面和正文图片到所选账号</span>
              </label>
              <div className="cv2-delivery-row">
                <button
                  type="button"
                  className="cv2-btn primary"
                  disabled={busy !== null || !canSend}
                  onClick={onSendDraft}
                >
                  <Icon name="send" size={15} />
                  {busy === 'draft:wechat' ? '正在处理…' : '发送到公众号草稿箱'}
                </button>
              </div>
              {activeDraftOp ? (
                <p className="cv2-delivery-hint">
                  该账号在此版本上已有一次发送记录（见下方交付时间线）；同一版本不能重复发送。
                </p>
              ) : null}
            </>
          ) : null}
          <div className="cv2-delivery-report">
            <label className="cv2-delivery-field">
              真实发布链接（作者报告）
              <input
                type="url"
                placeholder="发布完成后填写平台文章的 https 链接"
                value={draft.reportUrl}
                onChange={(e) => setDraft({ ...draft, reportUrl: e.target.value })}
              />
            </label>
            <button
              type="button"
              className="cv2-btn tiny"
              disabled={busy !== null || !String(draft.reportUrl || '').trim()}
              onClick={() => onRecordReport(meta.key)}
            >
              记录作者报告
            </button>
            <p className="cv2-delivery-hint">
              仅在你已在平台后台真实发布后填写；记录会标注“作者报告 · 未经平台核验”。
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PreviewPanel({ detail, docs, tab, onTab }) {
  const meta = PUBLISH_CHANNELS.find((c) => c.key === tab) || PUBLISH_CHANNELS[0];
  const doc = docs?.[tab];
  const entry = detail.channels?.[tab];
  const ready = previewReady(entry);
  let blocks = ready && doc?.markdown ? previewBlocks(doc.markdown) : [];
  // 渠道稿 Markdown 常以「# 标题」开头（与项目标题一致）；手机壳已渲染
  // 标题行，去掉重复的首个同名标题，避免出现两遍。
  if (blocks.length && blocks[0].type === 'h' && blocks[0].text === detail.title) {
    blocks = blocks.slice(1);
  }
  return (
    <aside className="cv2-surface cv2-surface-pad cv2-publish-preview" aria-label="发布效果预览">
      <div className="cv2-section-top">
        <h3>发布效果预览</h3>
        <Tag>模拟预览</Tag>
      </div>
      <div className="cv2-channel-tabs" role="group" aria-label="预览渠道">
        {PUBLISH_CHANNELS.map((c) => (
          <button
            key={c.key}
            type="button"
            className={tab === c.key ? 'active' : ''}
            aria-pressed={tab === c.key}
            onClick={() => onTab(c.key)}
          >
            {c.short}
          </button>
        ))}
      </div>
      <div className="cv2-preview-phone">
        <p className="cv2-micro">
          {meta.name} · 移动端 · 本地排版示意
        </p>
        <h4>{detail.title}</h4>
        {!ready ? (
          <p className="cv2-preview-empty">{seedParagraphPreviewNote()}</p>
        ) : !doc ? (
          <InlineStatus busy tone="info">
            正在读取{meta.short}稿…
          </InlineStatus>
        ) : (
          blocks.map((b, i) => {
            if (b.type === 'h') return <h5 key={i}>{b.text}</h5>;
            if (b.type === 'quote') return <blockquote key={i}>{b.text}</blockquote>;
            if (b.type === 'li') return <p key={i} className="cv2-preview-li">· {b.text}</p>;
            if (b.type === 'hr') return <hr key={i} />;
            if (b.type === 'image')
              return (
                <span key={i} className="cv2-preview-image" role="img" aria-label={`图片占位：${b.alt}`}>
                  {b.alt}
                  <small>{b.local ? '本地素材 · 未上传平台' : '外链图片 · 预览不加载外部内容'}</small>
                </span>
              );
            return <p key={i}>{b.text}</p>;
          })
        )}
      </div>
      <p className="cv2-micro" style={{ lineHeight: 1.8, marginTop: 14 }}>
        这不是平台真实渲染；正文为当前{meta.short}稿的本地排版示意，正式排版以公众号/知乎后台实际效果为准。
      </p>
    </aside>
  );
}

function ReconcileForm({ state, onChange, onSave, busy, onCancel }) {
  return (
    <div className="cv2-reconcile">
      <label className="cv2-delivery-field">
        平台核对结果
        <select value={state.outcome} onChange={(e) => onChange({ ...state, outcome: e.target.value })}>
          <option value="saved">草稿已保存</option>
          <option value="not_saved">未保存草稿</option>
        </select>
      </label>
      {state.outcome === 'saved' ? (
        <label className="cv2-delivery-field">
          平台草稿标识
          <input
            value={state.mediaId}
            onChange={(e) => onChange({ ...state, mediaId: e.target.value })}
          />
        </label>
      ) : null}
      <label className="cv2-delivery-field">
        核对依据（至少 8 字）
        <textarea
          rows={2}
          value={state.note}
          onChange={(e) => onChange({ ...state, note: e.target.value })}
        />
      </label>
      <div className="cv2-reconcile-actions">
        <button
          type="button"
          className="cv2-btn tiny primary"
          disabled={busy !== null || state.note.trim().length < 8 || (state.outcome === 'saved' && !state.mediaId.trim())}
          onClick={onSave}
        >
          保存作者核对结果
        </button>
        <button type="button" className="cv2-btn tiny ghost" onClick={onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

export default function PublishCenter() {
  const query = useSearchParams();
  const [projects, setProjects] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [history, setHistory] = useState(null);
  const [platforms, setPlatforms] = useState({ accounts: [] });
  const [assets, setAssets] = useState([]);
  const [docs, setDocs] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);
  const [panel, setPanel] = useState({ wechat: false, zhihu: false });
  const [previewTab, setPreviewTab] = useState('wechat');
  const [draft, setDraft] = useState({
    wechat: { accountId: '', coverAssetId: '', consent: false, reportUrl: '' },
    zhihu: { accountId: '', coverAssetId: '', consent: false, reportUrl: '' },
  });
  const [reconcile, setReconcile] = useState(null); // {operationId,outcome,mediaId,note}
  const [reloadNonce, setReloadNonce] = useState(0);
  // 乐观勾选：点击立即反映在复选框上；服务端确认后以服务器事实覆盖，
  // 冲突/失败时回滚并给出真实错误。时间线只由服务器返回的 detail/history
  // 派生，永不显示未经确认的交付状态。
  const [optimistic, setOptimistic] = useState({});
  const draftKeys = useRef({});

  // 项目清单 + 深链 ?project=
  useEffect(() => {
    let alive = true;
    api('/api/editor/projects')
      .then((d) => {
        if (!alive) return;
        const list = d.projects || [];
        setProjects(list);
        const wanted = query.get('project');
        if (wanted && list.some((p) => p.id === wanted)) setProjectId(wanted);
        else if (list.length) setProjectId(list[0].id);
      })
      .catch((e) => alive && setLoadError(e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 选中项目后的完整数据：渠道详情 + 交付历史 + 账号/素材 + 预览稿
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setLoadError(null);
    setDetail(null);
    setHistory(null);
    setDocs(null);
    setPanel({ wechat: false, zhihu: false });
    Promise.all([
      api(`/api/editor/projects/${projectId}`),
      api(`/api/creator/projects/${projectId}/publishing`),
      api('/api/creator/platforms'),
      api('/api/assets'),
      api(`/api/writing/projects/${projectId}/wechat`),
      api(`/api/writing/projects/${projectId}/zhihu`),
    ])
      .then(([d, h, p, a, wDoc, zDoc]) => {
        if (!alive) return;
        setDetail(d);
        setHistory(h);
        setPlatforms(p);
        setAssets(a.assets || []);
        setDocs({ wechat: wDoc, zhihu: zDoc });
      })
      .catch((e) => alive && setLoadError(e));
    return () => {
      alive = false;
    };
  }, [projectId, reloadNonce]);

  function retryLoad() {
    setLoadError(null);
    api('/api/editor/projects')
      .then((d) => {
        const list = d.projects || [];
        setProjects((prev) => prev || list);
        setProjectId((cur) => cur || list[0]?.id || null);
        setReloadNonce((n) => n + 1);
      })
      .catch((e) => setLoadError(e));
  }

  async function reloadProjectAndHistory() {
    const [d, h] = await Promise.all([
      api(`/api/editor/projects/${projectId}`),
      api(`/api/creator/projects/${projectId}/publishing`),
    ]);
    setDetail(d);
    setHistory(h);
  }

  function clearOptimistic(channelKey) {
    setOptimistic((o) => {
      const next = { ...o };
      delete next[channelKey];
      return next;
    });
  }

  async function toggleCheck(channelKey, key, checked) {
    if (busy) return;
    const entry = detail?.channels?.[channelKey];
    if (!entry?.document) return;
    setBusy(`check:${channelKey}`);
    setNotice(null);
    setOptimistic((o) => ({
      ...o,
      [channelKey]: { ...(entry.checks || {}), ...(o[channelKey] || {}), [key]: checked },
    }));
    try {
      const values = Object.fromEntries(
        CHECK_ORDER.map((k) => [k, k === key ? checked : entry.checks?.[k] === true])
      );
      const next = await send(`/api/editor/projects/${projectId}/${channelKey}/checks`, 'POST', {
        expectedRevision: entry.document.revision,
        checks: values,
      });
      setDetail(next);
      clearOptimistic(channelKey);
    } catch (e) {
      clearOptimistic(channelKey);
      setNotice({ tone: 'error', text: e.message || '检查状态未保存' });
      if (e.status === 409) reloadProjectAndHistory().catch(() => {});
    } finally {
      setBusy(null);
    }
  }

  function onPrimary(channelKey, pending) {
    setNotice({
      tone: 'warning',
      text: `还有 ${pending} 项${PUBLISH_CHANNELS.find((c) => c.key === channelKey)?.name || ''}发布前检查未完成；请在当前卡片内逐项确认。`,
    });
  }

  function togglePanel(channelKey) {
    setPanel((p) => ({ ...p, [channelKey]: !p[channelKey] }));
    setNotice(null);
  }

  async function exportBundle(channelKey) {
    if (busy) return;
    const entry = detail?.channels?.[channelKey];
    if (!entry?.document) return;
    setBusy(`bundle:${channelKey}`);
    setNotice(null);
    try {
      await downloadPackage(
        `/api/creator/projects/${projectId}/publishing/bundle`,
        {
          channel: channelKey,
          accountId: channelKey === 'wechat' ? draft.wechat.accountId : '',
          expectedRevision: entry.document.revision,
        },
        `content-${channelKey}-v${entry.document.revision}.zip`
      );
      await reloadProjectAndHistory();
      setNotice({
        tone: 'success',
        text: '已导出文章与图片交付包（本地导出，不是发布）；发布完成后回到本页记录结果。',
      });
    } catch (e) {
      setNotice({ tone: 'error', text: e.message || '导出未完成' });
    } finally {
      setBusy(null);
    }
  }

  async function sendWechatDraft() {
    if (busy) return;
    const entry = detail?.channels?.wechat;
    const account = draft.wechat.accountId;
    if (!entry?.document) return;
    setBusy('draft:wechat');
    setNotice(null);
    try {
      const keyBase = account + '/' + entry.document.revision;
      const failed = (history?.operations || []).some(
        (o) => o.accountId === account && o.revision === entry.document.revision && o.state === 'failed'
      );
      if (failed) draftKeys.current[keyBase] = 'draft/' + crypto.randomUUID();
      draftKeys.current[keyBase] ??= 'draft/' + crypto.randomUUID();
      const h = await send(`/api/creator/projects/${projectId}/publishing/draft`, 'POST', {
        expectedRevision: entry.document.revision,
        accountId: account,
        coverAssetId: draft.wechat.coverAssetId,
        idempotencyKey: draftKeys.current[keyBase],
        allowExternalCall: true,
      });
      setHistory(h);
      const last = (h.operations || []).find(
        (o) => o.accountId === account && o.revision === entry.document.revision
      );
      if (last?.state === 'succeeded')
        setNotice({
          tone: 'success',
          text: '草稿已保存到公众号草稿箱（平台回执已记录）。草稿保存不是发布；请到公众号后台人工检查并发布。',
        });
      else if (last?.state === 'outcome_unknown')
        setNotice({
          tone: 'warning',
          text: '微信发送结果待核实，不会自动重试；请在公众号后台核对后，在下方交付时间线记录核对结果。',
        });
      else
        setNotice({
          tone: 'error',
          text: last?.detail || '发送未完成，未产生草稿；请检查账号与素材后重试。',
        });
    } catch (e) {
      setNotice({ tone: 'error', text: e.message || '发送未完成' });
    } finally {
      setBusy(null);
    }
  }

  async function recordReport(channelKey) {
    if (busy) return;
    const entry = detail?.channels?.[channelKey];
    if (!entry?.document) return;
    setBusy(`report:${channelKey}`);
    setNotice(null);
    try {
      await send(`/api/creator/projects/${projectId}/publishing/report`, 'POST', {
        expectedRevision: entry.document.revision,
        channel: channelKey,
        accountId: '',
        url: draft[channelKey].reportUrl,
      });
      // 作者报告会更新渠道状态（statusLabel）与交付事实，两者一起从服务器重取
      await reloadProjectAndHistory();
      setDraft((d) => ({ ...d, [channelKey]: { ...d[channelKey], reportUrl: '' } }));
      setNotice({
        tone: 'success',
        text: '作者报告已记录（未经平台核验）；链接与时间已进入交付时间线。',
      });
    } catch (e) {
      setNotice({ tone: 'error', text: e.message || '记录未完成' });
    } finally {
      setBusy(null);
    }
  }

  async function saveReconcile() {
    if (busy || !reconcile) return;
    setBusy('reconcile');
    setNotice(null);
    try {
      const h = await send(`/api/creator/projects/${projectId}/publishing/reconcile`, 'POST', {
        operationId: reconcile.operationId,
        outcome: reconcile.outcome,
        mediaId: reconcile.mediaId,
        note: reconcile.note,
      });
      setHistory(h);
      setReconcile(null);
      setNotice({ tone: 'success', text: '核对结果已记录到交付时间线。' });
    } catch (e) {
      setNotice({ tone: 'error', text: e.message || '核对结果未保存' });
    } finally {
      setBusy(null);
    }
  }

  const summary = detail ? publishState(detail) : null;
  const timeline =
    detail && history ? buildDeliveryTimeline({ project: detail, history }) : null;

  return (
    <CreatorShell>
      <PageHeader
        eyebrow="PUBLISH / DELIVERY"
        title="发布之前，再确认一次"
        description="一个作品，多份平台稿；事实、图片和排版检查按平台独立记录。"
        actions={
          <>
            {projects && projects.length > 1 ? (
              <label className="cv2-publish-select">
                <span className="cv2-visually-hidden">选择作品</span>
                <select
                  value={projectId || ''}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Link className="cv2-btn cv2-publish-back" href="/works">
              <Icon name="file" size={15} />
              <span>返回作品</span>
            </Link>
          </>
        }
      />

      {loadError ? (
        <ErrorState title="发布中心加载失败" error={loadError} hint="检查本地服务是否在运行，然后重试。" onRetry={retryLoad} />
      ) : null}
      {projects && projects.length === 0 ? (
        <EmptyState
          icon="send"
          title="还没有可交付的作品"
          hint="发布中心按渠道跟踪一篇作品的人工检查与交付记录。先去作品库创建或继续一篇作品。"
          action={
            <Link className="cv2-btn primary" href="/works">
              去作品库 <Icon name="arrow" size={14} />
            </Link>
          }
        />
      ) : null}
      {!projects && !loadError ? <InlineStatus busy tone="info">正在打开发布中心…</InlineStatus> : null}
      {notice ? (
        <p className={'cv2-status is-' + (notice.tone || 'info')} role="status">
          <span className="cv2-status-dot" aria-hidden="true" />
          <span>{notice.text}</span>
        </p>
      ) : null}

      {detail && summary ? (
        <>
          {/* 顶部状态条 — .v2-platform-state (creator-v2.2.html:179) */}
          <div className="cv2-platform-state">
            <Tag tone={summary.pill.tone}>{summary.pill.label}</Tag>
            <div>
              <strong>状态必须区分：可交付 ≠ 已发布</strong>
              <small>微信草稿箱推送、知乎手动交付、真实发布确认是不同事件，必须保留记录。</small>
            </div>
            <Link className="cv2-btn tiny cv2-publish-related" href="/works">
              查看关联作品 <Icon name="arrow" size={13} />
            </Link>
          </div>

          <div className="cv2-publish-grid">
            <div>
              {PUBLISH_CHANNELS.map((meta) => {
                const raw = detail.channels?.[meta.key];
                if (!raw) return null;
                const entry = optimistic[meta.key]
                  ? { ...raw, checks: { ...raw.checks, ...optimistic[meta.key] } }
                  : raw;
                return (
                  <ChannelCard
                    key={meta.key}
                    meta={meta}
                    entry={entry}
                    detail={detail}
                    accounts={platforms.accounts || []}
                    assets={assets}
                    panelOpen={panel[meta.key]}
                    busy={busy}
                    history={history}
                    draft={draft[meta.key]}
                    setDraft={(next) => setDraft((d) => ({ ...d, [meta.key]: next }))}
                    onToggleCheck={toggleCheck}
                    onPrimary={onPrimary}
                    onPanelToggle={togglePanel}
                    onExportBundle={exportBundle}
                    onSendDraft={sendWechatDraft}
                    onRecordReport={recordReport}
                  />
                );
              })}
            </div>
            <PreviewPanel detail={detail} docs={docs} tab={previewTab} onTab={setPreviewTab} />
          </div>

          {/* 交付时间线 — .v2-delivery-log (creator-v2.2.html:179)；全部来自真实事实 */}
          <div className="cv2-delivery-log">
            <section className="cv2-surface cv2-surface-pad">
              <div className="cv2-section-top">
                <h3>本篇交付时间线</h3>
                <Tag tone={summary.pill.tone}>{summary.pill.label}</Tag>
              </div>
              {timeline ? (
                timeline.map((row, i) => (
                  <div key={i} className="cv2-log-row">
                    <span className={'cv2-log-dot' + (row.tone === 'pending' ? ' pending' : '')} aria-hidden="true" />
                    <div>
                      <strong>{row.title}</strong>
                      <p>{row.detail}</p>
                      {row.at ? <p className="cv2-log-time">{when(row.at)}</p> : null}
                      {row.operationId && !reconcile ? (
                        <button
                          type="button"
                          className="cv2-btn tiny"
                          onClick={() =>
                            setReconcile({ operationId: row.operationId, outcome: 'saved', mediaId: '', note: '' })
                          }
                        >
                          记录在平台核对的结果
                        </button>
                      ) : null}
                      {row.operationId && reconcile?.operationId === row.operationId ? (
                        <ReconcileForm
                          state={reconcile}
                          onChange={setReconcile}
                          onSave={saveReconcile}
                          onCancel={() => setReconcile(null)}
                          busy={busy}
                        />
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <InlineStatus busy tone="info">
                  正在读取交付记录…
                </InlineStatus>
              )}
            </section>
            <section className="cv2-surface cv2-surface-pad">
              <div className="cv2-section-top">
                <h3>交付原则</h3>
              </div>
              <div className="cv2-principles">
                <article>
                  <h4>失败可恢复</h4>
                  <p>网络中断需要保留上一次发送结果与平台返回 ID，不能默认重试导致重复发布。</p>
                </article>
                <article>
                  <h4>发布前人工确认</h4>
                  <p>渠道分别预览，正式发布由创作者决定；导出和草稿推送不是发布成功。</p>
                </article>
              </div>
            </section>
          </div>
        </>
      ) : null}
    </CreatorShell>
  );
}

'use client';
// Creator V2.3 视觉工作台 (/illustrations) — the real visual studio.
// Layout and interaction form follow the approved design source
// public/design/creator-v2.3-visual.html (studio :7/:45-53, compare
// modal :49, preview modal :50, generate confirm :51, mobile :14) via
// app/creator-v2-illustrations.css; the shell is the shared V2.2
// CreatorShell (视觉工作台 entry). Tokens: app/creator-v2.css.
//
// Everything below runs on the REAL illustration domain services —
// no demo art, no mock success:
//   GET  /api/illustrations/projects/:id            shots/plan/budget/providers/profile
//   POST .../plan {expectedMasterRevision[,scope|paragraphId]}
//   POST .../shots/:id/generate|decision|recover    PUT .../shots/:id/prompt
//   GET/POST .../shots/:id/candidates               POST .../candidates/:cid/decision
//   PUT  /api/assets/:id/mappings/:channel          GET .../handoff/:channel
//   GET/POST .../handoff-qa/:channel                GET .../technical-audit
//   GET  /api/illustrations/queue + /batches + /start (budget-aware batch)
//   GET  /api/editor/projects(+/:id)  GET /api/writing/projects/:id/master
//
// Invariants kept intact (see AGENTS.md / implementation prompt P0-C):
//   选中候选 ≠ 批准（select 仅切换当前素材，状态回到待审阅）；
//   采用 = 明确的批准决定（decision:approve），才允许登记渠道映射/交接；
//   已插入是独立事实（主稿 markdown 真实引用 asset://<id>）；
//   平台验证永远是 false（assets.platformVerified 由领域层持有）；
//   一张图失败不阻塞其他图（逐张生成 + 队列作业独立）；单图有界重试。
// The V40/V42/V43 operational depth (mapping, handoff QA, offline audit,
// quality ledger, series profile) stays reachable in the operations band
// below the studio grid (registered design deviation).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import CreatorShell from './CreatorShell';
import Icon from './creator/Icon';
import { EmptyState, ErrorState, InlineStatus, Tag } from './creator/primitives';
import QualityEvidencePanel from './QualityEvidencePanel';
import VisualSeriesPanel from './VisualSeriesPanel';
import { api, send, when } from '../lib/creator-client';
import {
  STYLE_OPTIONS,
  budgetLine,
  insertedAssetIds,
  planningModes,
  previewBlocks,
  shotAnchor,
  shotStatusView,
  shotTitle,
  variantCards,
} from '../src/illustrations-studio.mjs';

const CHANNELS = [
  ['wechat', '公众号'],
  ['zhihu', '知乎'],
];
const CHANNEL_NAMES = { wechat: '微信公众号', zhihu: '知乎' };
const QA_ITEMS = [
  ['rightsReviewed', '图片内容、素材使用权与版权已经人工核实'],
  ['uploadConfirmed', '目标渠道已实际上传相关图片'],
  ['desktopPasteConfirmed', '平台桌面编辑器粘贴和显示已验证'],
  ['mobilePreviewConfirmed', '目标平台移动端预览已验证'],
];
const EMPTY_QA = {
  rightsReviewed: false,
  uploadConfirmed: false,
  desktopPasteConfirmed: false,
  mobilePreviewConfirmed: false,
};
const STYLE_LABELS = Object.fromEntries(STYLE_OPTIONS.map(([id, label]) => [id, label]));

export default function IllustrationStudio() {
  const query = useSearchParams();
  const [projects, setProjects] = useState(null);
  const [projectId, setProjectId] = useState('');
  const [state, setState] = useState(null);
  const [doc, setDoc] = useState(null);
  const [masterMarkdown, setMasterMarkdown] = useState('');
  const [loadError, setLoadError] = useState(null);
  const [message, setMessage] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [shotId, setShotId] = useState('');
  const [channel, setChannel] = useState('wechat');

  // generation settings
  const [consent, setConsent] = useState(false);
  const [provider, setProvider] = useState('openai');
  const [attemptLimit, setAttemptLimit] = useState(1);
  const [providerChecks, setProviderChecks] = useState(null);
  const [budgetLimit, setBudgetLimit] = useState(null);

  // planning band
  const [planMode, setPlanMode] = useState('full');
  const [planParagraphId, setPlanParagraphId] = useState('');
  const [planOpen, setPlanOpen] = useState(false);

  // right-rail drafts
  const [instruction, setInstruction] = useState('');
  const [styleDraft, setStyleDraft] = useState(null);
  const [altDraft, setAltDraft] = useState(null);

  // modals + queue
  const [modal, setModal] = useState('');
  const [compareSelect, setCompareSelect] = useState('');
  const [queueStatus, setQueueStatus] = useState(null);
  const [platform, setPlatform] = useState('wechat');
  const pollRef = useRef(null);
  const toastRef = useRef(null);

  // operations band (mapping / handoff / audit)
  const [mappingDrafts, setMappingDrafts] = useState({});
  const [handoffPreview, setHandoffPreview] = useState(null);
  const [handoffCheck, setHandoffCheck] = useState(null);
  const [qaChecks, setQaChecks] = useState(EMPTY_QA);
  const [qaNote, setQaNote] = useState('');
  const [technicalAudit, setTechnicalAudit] = useState(null);
  const [seriesData, setSeriesData] = useState(null);
  const [seriesRun, setSeriesRun] = useState(false);

  const showToast = useCallback((text) => {
    setToast(text);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(''), 2900);
  }, []);

  const loadState = useCallback(async (id) => {
    if (!id) return;
    const [data, project, writing] = await Promise.all([
      api(`/api/illustrations/projects/${id}`),
      api(`/api/editor/projects/${id}`).catch(() => null),
      api(`/api/writing/projects/${id}/master`).catch(() => null),
    ]);
    setState(data);
    setDoc(
      project
        ? {
            title: project.title,
            updatedAt: project.updatedAt,
            paragraphs: project.channels?.master?.document?.paragraphs || [],
          }
        : null
    );
    setMasterMarkdown(writing?.markdown || '');
    setBudgetLimit((current) => current ?? data.requestBudget?.dailyLimit ?? 12);
    setProvider((current) => {
      if (data.providers?.some((p) => p.id === current && p.configured)) return current;
      return data.providers?.find((p) => p.configured)?.id || current;
    });
    setShotId((current) =>
      data.shots?.some((s) => s.id === current) ? current : data.shots?.[0]?.id || ''
    );
  }, []);

  // Project list + deep link (?project=) — same entry the compose editor uses.
  useEffect(() => {
    let alive = true;
    api('/api/editor/projects')
      .then((x) => {
        if (!alive) return;
        const list = x.projects || [];
        setProjects(list);
        const fromQuery = query.get('project');
        setProjectId(
          fromQuery && list.some((p) => p.id === fromQuery)
            ? fromQuery
            : list[0]?.id || ''
        );
      })
      .catch((e) => {
        if (alive) setLoadError(e);
      });
    return () => {
      alive = false;
    };
  }, [query]);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setLoadError(null);
    setState(null);
    setDoc(null);
    setMasterMarkdown('');
    setHandoffPreview(null);
    setHandoffCheck(null);
    setTechnicalAudit(null);
    setMappingDrafts({});
    setQaChecks(EMPTY_QA);
    setQaNote('');
    setSeriesData(null);
    setInstruction('');
    setStyleDraft(null);
    setAltDraft(null);
    setConsent(false);
    setBudgetLimit(null);
    setQueueStatus(null);
    setPlanOpen(false);
    setPlanParagraphId('');
    clearInterval(pollRef.current);
    pollRef.current = null;
    loadState(projectId).catch((e) => alive && setLoadError(e));
    api(`/api/illustrations/projects/${projectId}/series`)
      .then((x) => alive && setSeriesData(x))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId, loadState]);

  // Stop queue polling whenever the project changes or the page unmounts.
  useEffect(
    () => () => {
      clearInterval(pollRef.current);
      clearTimeout(toastRef.current);
    },
    []
  );

  const shots = state?.shots || [];
  const shot = shots.find((s) => s.id === shotId) || shots[0] || null;
  const inserted = useMemo(
    () => insertedAssetIds(masterMarkdown, shots),
    [masterMarkdown, shots]
  );
  const stale = Boolean(state?.stale);
  const providerInfo = state?.providers?.find((p) => p.id === provider);
  const providerReady = Boolean(providerInfo?.configured);
  const variants = useMemo(() => variantCards(shot), [shot]);
  const modes = useMemo(() => planningModes(doc?.paragraphs || []), [doc]);
  const preview = useMemo(
    () =>
      previewBlocks(
        { title: doc?.title || state?.title || '', paragraphs: doc?.paragraphs || [] },
        shots,
        platform
      ),
    [doc, shots, platform, state]
  );
  const pendingShots = shots.filter((s) => ['planned', 'failed'].includes(s.status));
  const seriesRunBusy = busy || seriesRun;

  async function run(task, { quiet } = {}) {
    setBusy(true);
    setMessage('');
    try {
      await task();
      if (!quiet) await loadState(projectId);
      return true;
    } catch (e) {
      setMessage(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function selectShot(id) {
    setShotId(id);
    setInstruction('');
    setStyleDraft(null);
    setAltDraft(null);
    setCompareSelect('');
  }

  // ---- planning (封面 / 完整配图 / 指定段落 three real modes) ----
  async function createPlan() {
    const mode = modes.find((m) => m.id === planMode) || modes[1];
    // Replacing an existing plan is explicit: current slot layout is replaced,
    // generated images stay in the asset library (same semantics as the
    // compose editor's plan action).
    if (
      state.plan &&
      shots.length > 0 &&
      !window.confirm('创建新配图计划？当前计划的图位布局会被替换，原图仍保存在素材库。')
    )
      return;
    const payload = { expectedMasterRevision: state.sourceRevision };
    if (mode.id === 'cover') payload.scope = 'cover';
    if (mode.id === 'paragraph') {
      if (!planParagraphId) {
        setMessage('请先选择要配图的段落。');
        return;
      }
      payload.paragraphId = planParagraphId;
    }
    const ok = await run(async () => {
      await send(`${root()}/plan`, 'POST', payload);
      setToast(`${mode.label}计划已创建；生成前不会调用图片服务。`);
    });
    if (ok) {
      setPlanOpen(false);
      setPlanParagraphId('');
    }
  }
  function root() {
    return `/api/illustrations/projects/${projectId}`;
  }

  // ---- generation: single (bounded) + queue batch (budget aware) ----
  async function generateShot(target) {
    await run(async () => {
      await send(`${root()}/shots/${target.id}/generate`, 'POST', {
        allowExternalAI: true,
        provider,
        maxAttempts: attemptLimit,
        fallbackProviders: [],
      });
      showToast(`「${shotTitle(target)}」已生成，等待审阅。`);
    });
  }

  async function startBatch() {
    const key =
      'v2batch-' +
      (globalThis.crypto?.randomUUID?.().replace(/-/g, '') ||
        String(Date.now()) + Math.random().toString(36).slice(2, 10));
    await run(async () => {
      await send('/api/illustrations/queue/batches', 'POST', {
        idempotencyKey: key,
        allowExternalAI: true,
        items: pendingShots.map((s) => ({
          projectId,
          shotId: s.id,
          expectedUpdatedAt: s.updatedAt,
        })),
        provider,
        maxAttempts: attemptLimit,
      });
      await send('/api/illustrations/queue/start', 'POST', { allowExternalAI: true });
      setModal('');
      showToast('批次已进入本地队列；一张失败不会阻塞其他图片。');
      pollQueue();
    });
  }

  function pollQueue() {
    clearInterval(pollRef.current);
    const tick = async () => {
      try {
        const q = await api('/api/illustrations/queue?projectId=' + projectId);
        setQueueStatus(q);
        if (!q.active) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          await loadState(projectId);
          showToast('队列执行结束，请逐张审阅生成结果。');
        }
      } catch {
        /* transient network error keeps polling */
      }
    };
    pollRef.current = setInterval(tick, 2500);
    tick();
  }

  // ---- prompt / style / alt (PUT prompt; resets the slot to 待生成) ----
  async function savePromptFields(target, fields) {
    await run(async () => {
      await send(`${root()}/shots/${target.id}/prompt`, 'PUT', {
        expectedUpdatedAt: target.updatedAt,
        scene: target.scene,
        style: target.style || 'editorial',
        ...fields,
      });
    });
  }

  // ---- candidates (选中 ≠ 批准) ----
  async function selectCandidate(target, card) {
    if (!card.candidateId || card.selected) return;
    if (
      target.status === 'approved' &&
      !window.confirm(
        '选择其他候选会把该图位退回「待审阅」，已批准状态需要重新确认。继续？'
      )
    )
      return;
    await run(async () => {
      await send(`${root()}/shots/${target.id}/candidates/${card.candidateId}/decision`, 'POST', {
        decision: 'select',
        expectedUpdatedAt: target.updatedAt,
      });
      showToast('已切换预览候选；点击「采用这张图」批准后才会进入渠道交付。');
    });
  }

  async function editImage(target) {
    if (instruction.trim().length < 12) {
      setMessage('请先用至少 12 个字描述修改方向。');
      return;
    }
    const referenceAssetId = target.assetId || variants.cards[0]?.assetId;
    if (!referenceAssetId) {
      setMessage('还没有可作参考的图片，请先生成第一版。');
      return;
    }
    await run(async () => {
      await send(`${root()}/shots/${target.id}/candidates`, 'POST', {
        allowExternalAI: true,
        expectedUpdatedAt: target.updatedAt,
        referenceAssetId,
        provider,
        instruction: instruction.trim(),
      });
      setInstruction('');
      showToast('修改版已加入候选；需要点击「采用这张图」批准才会写入交付。');
    });
  }

  async function decide(target, decision) {
    await run(async () => {
      await send(`${root()}/shots/${target.id}/decision`, 'POST', { decision });
      showToast(
        decision === 'approve'
          ? `「${shotTitle(target)}」已批准；其他图位不受影响。`
          : `「${shotTitle(target)}」已标记为不采用，原图保留。`
      );
    });
  }

  async function recover(target) {
    await run(async () => {
      await send(`${root()}/shots/${target.id}/recover`, 'POST', {
        expectedUpdatedAt: target.updatedAt,
      });
    });
  }

  // ---- operations band ----
  function setMap(id, field, value) {
    setMappingDrafts((old) => ({ ...old, [id]: { ...old[id], [field]: value } }));
  }
  async function saveMapping(target) {
    const entry = mappingDrafts[target.id] || {};
    const match = target.asset?.mappings?.find((m) => m.channel === channel);
    await run(async () => {
      await api(`/api/assets/${target.assetId}/mappings/${channel}`, {
        method: 'PUT',
        body: JSON.stringify({ url: entry.url ?? match?.url ?? '', note: entry.note ?? match?.note ?? '' }),
      });
      showToast('渠道地址已登记；尚未验证平台显示效果。');
    });
  }
  async function buildHandoff() {
    setBusy(true);
    setMessage('');
    try {
      setHandoffPreview(await api(`${root()}/handoff/${channel}`));
    } catch (e) {
      setHandoffPreview(null);
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function checkHandoff() {
    setBusy(true);
    setMessage('');
    try {
      const data = await api(`${root()}/handoff-qa/${channel}`);
      setHandoffCheck(data);
      setQaChecks(EMPTY_QA);
      setQaNote('');
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveManualQa() {
    if (!handoffCheck?.proposalSha256) {
      setMessage('请先检查当前渠道交接提案。');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const data = await api(`${root()}/handoff-qa/${channel}`, {
        method: 'POST',
        body: JSON.stringify({
          expectedSourceRevision: handoffCheck.sourceRevision,
          expectedLayoutRevision: handoffCheck.layoutRevision,
          expectedProposalSha256: handoffCheck.proposalSha256,
          checks: qaChecks,
          note: qaNote,
        }),
      });
      setHandoffCheck(data);
      showToast('人工验收结果已作为不可变记录保存。这不是系统自动验证的发布状态。');
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function checkTechnical() {
    setBusy(true);
    setMessage('');
    try {
      setTechnicalAudit(await api(`${root()}/technical-audit?channel=${channel}`));
    } catch (e) {
      setTechnicalAudit(null);
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function checkProviders() {
    setBusy(true);
    setMessage('');
    try {
      const data = await api('/api/illustrations/providers/preflight');
      setProviderChecks(data.providers);
      showToast('供应商协议检查完成（本地，不调用 API）。');
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveBudget() {
    await run(async () => {
      await send(`${root()}/budget`, 'PUT', {
        expectedRevision: state.requestBudget.revision,
        dailyLimit: budgetLimit,
      });
      showToast('每日请求上限已保存。');
    });
  }
  async function copyProposal() {
    try {
      await navigator.clipboard.writeText(handoffPreview.markdown);
      showToast('含图 Markdown 已复制；请在 doocs/md 中排版并按 V30 差异审阅导回。');
    } catch {
      setMessage('复制被浏览器拦截，请手动选择下方 Markdown。');
    }
  }
  async function runSeries(task) {
    setSeriesRun(true);
    try {
      await task();
      await loadState(projectId);
    } catch (e) {
      setMessage(e.message);
    } finally {
      setSeriesRun(false);
    }
  }

  // ---- modal plumbing ----
  useEffect(() => {
    if (!modal) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setModal('');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modal]);
  function openCompare() {
    const other = variants.cards.find((c) => !c.selected);
    setCompareSelect(other ? other.key : '');
    setModal('compare');
  }
  const compareCard = variants.cards.find((c) => c.key === compareSelect) || null;

  // ---- render ----
  const statusView = shot ? shotStatusView(shot, { inserted: inserted.has(shot.assetId) }) : null;

  return (
    <CreatorShell>
      <div className="cv2-illu">
        {/* jobline（design :36）：作品标题 + 真实修订状态 + 编辑/队列入口 */}
        <div className="cv2-illu-jobline">
          <div className="cv2-illu-jobmain">
            <small>作品 / 配图工作台 · 最近更新 {when(doc?.updatedAt || null)}</small>
            <div className="cv2-illu-jobrow">
              {projects && projects.length ? (
                <select
                  className="cv2-illu-projectselect"
                  aria-label="配图文章"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              ) : (
                <strong>{doc?.title || state?.title || '…'}</strong>
              )}
              {state ? (
                <Tag tone={stale ? 'warning' : 'info'} title={stale ? '主稿已更新，需重新规划' : undefined}>
                  主稿 v{state.sourceRevision} · {stale ? '计划已过期' : '方案可用'}
                </Tag>
              ) : null}
            </div>
          </div>
          <div className="cv2-illu-jobactions">
            <Link className="cv2-btn" href={`/compose?project=${encodeURIComponent(projectId)}`}>
              <Icon name="edit" size={14} /> 正文编辑
            </Link>
            <Link className="cv2-btn" href="/illustrations/queue">
              <Icon name="clock" size={14} /> 跨文章队列
            </Link>
            <button
              type="button"
              className="cv2-btn primary"
              onClick={() => setModal('preview')}
              disabled={!state}
            >
              <Icon name="image" size={14} /> 视觉工作台
            </button>
          </div>
        </div>

        {message ? (
          <div className="cv2-illu-alert" role="alert">
            <span>{message}</span>
            <button type="button" onClick={() => setMessage('')} aria-label="关闭错误提示">
              ×
            </button>
          </div>
        ) : null}

        {loadError ? (
          <ErrorState
            title="配图方案加载失败"
            error={loadError}
            hint="网络或服务恢复后可重试；已有图片与计划保留在本地数据库。"
            onRetry={() =>
              loadState(projectId).catch((e) => setLoadError(e))
            }
          />
        ) : !state ? (
          projects && projects.length === 0 ? (
            <EmptyState
              icon="image"
              title="还没有可配图的作品"
              hint="先在创作空间写好正文，再回到这里规划封面与章节配图。"
              action={
                <Link className="cv2-btn primary" href="/compose">
                  去创作空间
                </Link>
              }
            />
          ) : (
            <InlineStatus busy>正在加载配图方案…</InlineStatus>
          )
        ) : (
          <>
            {/* studiohead（design :48） */}
            <header className="cv2-illu-head">
              <div>
                <p className="cv2-eyebrow">Visual Studio · Creator V2.3</p>
                <h1>让每一张图片都有它的位置</h1>
                <p className="cv2-illu-head-desc">
                  左侧选图位，中间选图与对比，右侧自然语言调整。采用后直接回到文章。
                </p>
              </div>
              <div className="cv2-illu-head-actions">
                <Link className="cv2-btn" href={`/compose?project=${encodeURIComponent(projectId)}`}>
                  <Icon name="chevron" size={14} /> 返回文章
                </Link>
                <button type="button" className="cv2-btn primary" onClick={() => setModal('preview')}>
                  <Icon name="eye" size={14} /> 查看最终效果
                </button>
              </div>
            </header>

            {/* 规划带（真实三模式；仅当无计划或计划过期时出现） */}
            {(!state.plan || stale || planOpen) && (
              <section className="cv2-illu-plan" aria-label="配图规划">
                <div className="cv2-illu-plan-intro">
                  <Tag tone={stale ? 'warning' : 'info'}>
                    {stale ? '计划过期 · 主稿已有新版本' : '配图规划'}
                  </Tag>
                  <p>
                    {stale
                      ? '文章正文已有变化。必须重新生成配图计划，旧图片会保留，但不会自动关联到新文章。'
                      : '系统从正文识别需要解释的段落，建议配图位置。规划只在本地分析标题与段落，不会上传内容、不调用模型。'}
                  </p>
                </div>
                <div className="cv2-illu-plan-modes" role="group" aria-label="配图范围">
                  {modes.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={'cv2-illu-mode' + (planMode === m.id ? ' on' : '')}
                      aria-pressed={planMode === m.id}
                      onClick={() => setPlanMode(m.id)}
                    >
                      <b>{m.label}</b>
                      <small>
                        {m.id === 'paragraph'
                          ? '1 处 · 自选段落'
                          : `${m.count} 处 · ${m.id === 'cover' ? '仅封面' : '封面+章节'}`}
                      </small>
                    </button>
                  ))}
                </div>
                {planMode === 'paragraph' ? (
                  <label className="cv2-illu-paragraphpick">
                    选择段落
                    <select
                      aria-label="选择配图段落"
                      value={planParagraphId}
                      onChange={(e) => setPlanParagraphId(e.target.value)}
                    >
                      <option value="">选择正文段落…</option>
                      {(modes.find((m) => m.id === 'paragraph')?.paragraphs || []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.text}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="cv2-illu-plan-summary">
                    {modes.find((m) => m.id === planMode)?.summary}
                  </p>
                )}
                <button
                  type="button"
                  className="cv2-btn primary"
                  disabled={busy || !state.sourceRevision}
                  onClick={createPlan}
                >
                  {stale ? '根据最新主稿重新规划' : '创建配图计划'}
                </button>
              </section>
            )}

            {/* 三栏 studio（design :7 studio-layout） */}
            <div className={'cv2-illu-grid' + (!state.plan ? ' is-empty' : '')}>
              {/* 左：配图清单 */}
              <aside className="cv2-illu-shots" aria-label="配图清单">
                <div className="cv2-illu-shots-top">
                  <h3>配图清单</h3>
                  <span className="cv2-pill blue">{shots.length} 处</span>
                  {state.plan && !stale ? (
                    <button
                      type="button"
                      className="cv2-textlink"
                      onClick={() => {
                        setPlanOpen(true);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      重新规划
                    </button>
                  ) : null}
                </div>
                <p className="cv2-illu-shots-sub">生成失败不会影响其他图片，可随时返回正文继续写作。</p>
                {!state.plan ? (
                  <p className="cv2-illu-shots-empty">还没有配图计划；在上方选择范围创建计划。</p>
                ) : (
                  <div className="cv2-illu-shotitems">
                    {shots.map((s) => {
                      const view = shotStatusView(s, { inserted: inserted.has(s.assetId) });
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className={'cv2-illu-shotitem' + (s.id === shot?.id ? ' selected' : '')}
                          aria-pressed={s.id === shot?.id}
                          onClick={() => selectShot(s.id)}
                        >
                          <span className={'cv2-illu-thumb tone-' + view.tone}>
                            {s.asset ? (
                              <img src={s.asset.previewUrl} alt="" loading="lazy" />
                            ) : view.label === '生成中' ? (
                              <Icon name="clock" size={16} />
                            ) : view.label === '生成失败' ? (
                              <Icon name="alert" size={16} />
                            ) : (
                              <Icon name="plus" size={16} />
                            )}
                          </span>
                          <span className="cv2-illu-shotmeta">
                            <b>{shotTitle(s)}</b>
                            <small>{shotAnchor(s, doc?.paragraphs || [])}</small>
                            <span className={'cv2-pill ' + view.tone}>{view.label}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="cv2-illu-shotnotice">
                  <Icon name="check" size={13} /> 文章正文和生成历史独立保存。重做一张图不会重做整篇文章。
                </p>
              </aside>

              {/* 中：主视觉 + 候选 */}
              <section className="cv2-illu-main" aria-label="主视觉与候选">
                {!shot ? (
                  <div className="cv2-illu-showcase">
                    <p className="cv2-illu-bigempty">创建配图计划后，这里会展示每个图位的主视觉。</p>
                  </div>
                ) : (
                  <>
                    <div className="cv2-illu-showcase">
                      <div className="cv2-illu-showcasebar">
                        <div>
                          <p className="cv2-microcap">Selected Artwork</p>
                          <h2>
                            {shotTitle(shot)} <span className={'cv2-pill ' + statusView.tone}>{statusView.label}</span>
                          </h2>
                        </div>
                        <span className="cv2-illu-subtle">
                          {shot.asset
                            ? `${shot.asset.mime} · ${Math.max(1, Math.round((shot.asset.size || 0) / 1024))} KB`
                            : '尚无素材'}
                          {' · '}
                          {STYLE_LABELS[shot.style] || shot.style}
                        </span>
                      </div>
                      <div className="cv2-illu-bigart">
                        {shot.status === 'generating' ? (
                          <div className="cv2-illu-artstate">
                            <b>正在生成…</b>
                            <p>请求已交给配置的图片模型；本图位独立执行，不影响其他图位。</p>
                          </div>
                        ) : shot.status === 'failed' ? (
                          <div className="cv2-illu-artstate is-error" role="alert">
                            <b>生成失败</b>
                            <p>{shot.error || '图片服务未返回可用图片。'}</p>
                            <button
                              type="button"
                              className="cv2-btn"
                              disabled={busy || stale || !consent || !providerReady}
                              title={!consent ? '先勾选外部模型授权' : !providerReady ? '图片服务未配置' : undefined}
                              onClick={() => generateShot(shot)}
                            >
                              <Icon name="refresh" size={14} /> 单图重试
                            </button>
                          </div>
                        ) : shot.asset ? (
                          <img src={shot.asset.previewUrl} alt={shot.alt} />
                        ) : (
                          <div className="cv2-illu-artstate">
                            <b>这一处还没有图片</b>
                            <p>生成前请先确认构图与内容用途。</p>
                          </div>
                        )}
                      </div>
                      <div className="cv2-illu-arttools">
                        <div className="cv2-illu-chipstrip">
                          <button
                            type="button"
                            className="cv2-btn tiny"
                            onClick={openCompare}
                            disabled={variants.cards.length < 2}
                          >
                            <Icon name="compare" size={13} /> 对比版本
                          </button>
                          <button type="button" className="cv2-btn tiny" onClick={() => setModal('preview')}>
                            <Icon name="eye" size={13} /> 正文预览
                          </button>
                          {shot.asset ? (
                            <a
                              className="cv2-btn tiny"
                              href={shot.asset.previewUrl}
                              download={`${shotTitle(shot)}.${shot.asset.mime === 'image/jpeg' ? 'jpg' : shot.asset.mime === 'image/webp' ? 'webp' : 'png'}`}
                            >
                              下载示意图
                            </a>
                          ) : (
                            <button type="button" className="cv2-btn tiny" disabled>
                              下载示意图
                            </button>
                          )}
                        </div>
                        <div className="cv2-illu-adopt">
                          <button
                            type="button"
                            className="cv2-btn primary"
                            disabled={
                              busy ||
                              stale ||
                              !shot.asset ||
                              !['generated', 'rejected'].includes(shot.status)
                            }
                            title={
                              shot.status === 'approved'
                                ? '已批准；替换版本请先在候选中选择（会回到待审阅）'
                                : !shot.asset
                                  ? '先生成图片'
                                  : undefined
                            }
                            onClick={() => decide(shot, 'approve')}
                          >
                            <Icon name="check" size={14} />
                            {shot.status === 'approved' ? '已批准' : '采用这张图'}
                          </button>
                          {['generated', 'approved'].includes(shot.status) ? (
                            <button
                              type="button"
                              className="cv2-textlink"
                              disabled={busy || stale}
                              onClick={() => decide(shot, 'reject')}
                            >
                              不采用
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {shot.status === 'approved' ? (
                        <p className="cv2-illu-adoptnote">
                          已批准的图片不会自动插入正文；替换版本请在下方候选中选择（会回到待审阅），或使用带图 Markdown 交接。
                        </p>
                      ) : null}
                    </div>

                    <div className="cv2-illu-variants">
                      <div className="cv2-illu-variantbar">
                        <div>
                          <h3>候选版本</h3>
                          <p className="cv2-illu-subtle">
                            选择版本不会自动改变文章；点击「采用这张图」批准后才进入渠道交付。
                          </p>
                        </div>
                        <button
                          type="button"
                          className="cv2-btn tiny"
                          disabled={busy || stale || !consent || !providerReady || shot.status === 'generating'}
                          title={!consent ? '先在右侧勾选外部模型授权' : !providerReady ? '图片服务未配置' : undefined}
                          onClick={() => {
                            if (['planned', 'failed'].includes(shot.status)) {
                              generateShot(shot);
                              return;
                            }
                            if (instruction.trim().length < 12) {
                              setMessage('再生成一版需要先在右侧描述修改方向（至少 12 字）。');
                              return;
                            }
                            editImage(shot);
                          }}
                        >
                          <Icon name="refresh" size={13} />
                          {['planned', 'failed'].includes(shot.status)
                            ? shot.status === 'failed'
                              ? '重新生成'
                              : '生成第一版'
                            : '再生成一版'}
                        </button>
                      </div>
                      {variants.cards.length ? (
                        <div className="cv2-illu-variantgrid">
                          {variants.cards.map((c, i) => (
                            <button
                              key={c.key}
                              type="button"
                              className={'cv2-illu-variant' + (c.selected ? ' selected' : '')}
                              aria-pressed={c.selected}
                              disabled={busy || c.selected}
                              onClick={() => selectCandidate(shot, c)}
                            >
                              <span className="cv2-illu-variantart">
                                <img src={c.previewUrl} alt={`${shotTitle(shot)} 候选 ${i + 1}`} loading="lazy" />
                                {c.selected ? (
                                  <span className="cv2-illu-tick" aria-hidden="true">
                                    ✓
                                  </span>
                                ) : null}
                              </span>
                              <b>
                                {c.selected ? `方案 ${i + 1} · 当前预览` : c.label}
                              </b>
                              <small>{c.note}</small>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="cv2-illu-variantempty">暂无候选图；可在右侧生成第一版。</p>
                      )}
                      {variants.rejected ? (
                        <p className="cv2-illu-subtle">
                          已有 {variants.rejected} 个被拒绝的历史版本，原图与记录保留在素材库。
                        </p>
                      ) : null}
                    </div>

                    <p className="cv2-illu-orange">
                      生成结果需检查是否与文章相符、是否产生虚构的 UI 截图、文字是否可读、平台裁切是否正确。图片本身不是事实证据。
                    </p>
                  </>
                )}
              </section>

              {/* 右：Prompt / 自然语言改图 / 高级设置 / Alt */}
              <aside className="cv2-illu-ins" aria-label="图片修改控件">
                {shot ? (
                  <>
                    <div className="cv2-illu-sidegroup">
                      <h3>这张图片要表达什么</h3>
                      <p className="cv2-illu-why">{shot.alt || '（尚无图片说明）'}</p>
                      <p className="cv2-illu-rightstat">
                        对应位置：{shotAnchor(shot, doc?.paragraphs || [])}
                        <br />
                        画面方案：{STYLE_LABELS[shot.style] || shot.style} · 源于正文 v
                        {state.plan?.masterRevision ?? state.sourceRevision}
                      </p>
                      <Link className="cv2-textlink" href={`/compose?project=${encodeURIComponent(projectId)}`}>
                        返回正文定位 →
                      </Link>
                    </div>

                    <div className="cv2-illu-sidegroup">
                      <h3>视觉方向</h3>
                      <div className="cv2-illu-stylechips">
                        {STYLE_OPTIONS.map(([id, label, colors]) => (
                          <button
                            key={id}
                            type="button"
                            className={
                              'cv2-illu-stylebtn' + ((styleDraft ?? shot.style) === id ? ' chosen' : '')
                            }
                            aria-pressed={(styleDraft ?? shot.style) === id}
                            onClick={() => setStyleDraft(id)}
                          >
                            <span className="cv2-illu-swatch">
                              {colors.map((c) => (
                                <i key={c} style={{ background: c }} />
                              ))}
                            </span>
                            <b>{label}</b>
                          </button>
                        ))}
                      </div>
                      {styleDraft && styleDraft !== shot.style ? (
                        <div className="cv2-illu-styleaction">
                          <p className="cv2-illu-rightstat">
                            保存后该图位退回「待生成」，已批准状态需重新批准；历史候选保留。
                          </p>
                          <div className="cv2-illu-stylebtns">
                            <button
                              type="button"
                              className="cv2-btn tiny primary"
                              disabled={busy || stale || shot.status === 'generating'}
                              onClick={async () => {
                                if (await savePromptFields(shot, { style: styleDraft })) setStyleDraft(null);
                              }}
                            >
                              保存视觉方案
                            </button>
                            <button type="button" className="cv2-btn tiny" onClick={() => setStyleDraft(null)}>
                              放弃
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="cv2-illu-rightstat">切换风格后需保存；仅影响这张图的后续生成。</p>
                      )}
                    </div>

                    <div className="cv2-illu-sidegroup">
                      <h3>直接用自然语言修改</h3>
                      <textarea
                        className="cv2-illu-textarea"
                        aria-label="图片修改指令"
                        placeholder={
                          shot.asset
                            ? '例如：弱化背景几何，让视觉重点落在三段流程…'
                            : '描述这一图位的画面内容（保存后用于生成）…'
                        }
                        value={instruction}
                        onChange={(e) => setInstruction(e.target.value)}
                      />
                      <div className="cv2-illu-chipstrip">
                        <button
                          type="button"
                          className="cv2-btn tiny"
                          onClick={() => setInstruction('去掉图中所有文字，用纯图形表达结构。')}
                        >
                          去除文字
                        </button>
                        <button
                          type="button"
                          className="cv2-btn tiny"
                          onClick={() => setInstruction('保持主体构图，把背景换成暖白色。')}
                        >
                          换成暖白
                        </button>
                        <button
                          type="button"
                          className="cv2-btn tiny"
                          onClick={() => setInstruction('保持主体构图，重新适配公众号 2.35:1 封面裁切。')}
                        >
                          适配封面
                        </button>
                      </div>
                      <label className="cv2-illu-consent">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                        />
                        <span>我允许将该图位的标题、段落摘要与提示词发送到所选的外部图片模型，并确认没有需要保密的内容。</span>
                      </label>
                      {shot.asset ? (
                        <button
                          type="button"
                          className="cv2-btn primary wide"
                          disabled={busy || stale || !consent || !providerReady || instruction.trim().length < 12}
                          onClick={() => editImage(shot)}
                        >
                          基于当前图生成修改版
                        </button>
                      ) : (
                        <div className="cv2-illu-genrow">
                          <button
                            type="button"
                            className="cv2-btn primary wide"
                            disabled={busy || stale || !consent || !providerReady}
                            title={!consent ? '先勾选外部模型授权' : !providerReady ? '图片服务未配置' : undefined}
                            onClick={() => generateShot(shot)}
                          >
                            生成这张图
                          </button>
                          <button
                            type="button"
                            className="cv2-btn"
                            disabled={busy || stale || instruction.trim().length < 12}
                            onClick={async () => {
                              if (await savePromptFields(shot, { scene: instruction.trim() })) setInstruction('');
                            }}
                          >
                            保存为画面描述
                          </button>
                        </div>
                      )}
                      <p className="cv2-illu-rightstat">每次生成都是新版本；不会覆盖原图和已批准的版本。</p>
                    </div>

                    <div className="cv2-illu-sidegroup">
                      <h3>模型与成本 · 高级设置</h3>
                      <label className="cv2-illu-field">
                        图片供应商
                        <select
                          aria-label="图片供应商"
                          value={provider}
                          onChange={(e) => setProvider(e.target.value)}
                        >
                          {(state.providers || [{ id: provider, label: provider, configured: false }]).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label || p.id}
                              {p.configured ? '（可用）' : '（未配置）'}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="cv2-illu-field">
                        单图最多调用次数（1–3，有界重试）
                        <input
                          aria-label="单图最多调用次数"
                          type="number"
                          min="1"
                          max="3"
                          value={attemptLimit}
                          onChange={(e) =>
                            setAttemptLimit(Math.min(3, Math.max(1, Number(e.target.value) || 1)))
                          }
                        />
                      </label>
                      <p className="cv2-illu-rightstat">{budgetLine(state.requestBudget)}</p>
                      <div className="cv2-illu-genrow">
                        <label className="cv2-illu-field grow">
                          每日请求上限
                          <input
                            aria-label="每日外部模型请求上限"
                            type="number"
                            min="1"
                            max="100"
                            value={budgetLimit ?? state.requestBudget?.dailyLimit ?? 12}
                            onChange={(e) => setBudgetLimit(Number(e.target.value))}
                          />
                        </label>
                        <button
                          type="button"
                          className="cv2-btn"
                          disabled={
                            seriesRunBusy ||
                            !Number.isInteger(budgetLimit) ||
                            budgetLimit < 1 ||
                            budgetLimit > 100 ||
                            budgetLimit === state.requestBudget?.dailyLimit
                          }
                          onClick={saveBudget}
                        >
                          保存上限
                        </button>
                      </div>
                      <button
                        type="button"
                        className="cv2-btn"
                        disabled={seriesRunBusy}
                        onClick={checkProviders}
                      >
                        检查三家供应商配置
                      </button>
                      {providerChecks?.map((item) => (
                        <p key={item.id} className="cv2-illu-rightstat">
                          {item.id} · {item.model} ·{' '}
                          {item.configured ? '配置和地址格式检查通过' : `尚不可用：${item.problems.join('、')}`}
                        </p>
                      ))}
                      <p className="cv2-illu-rightstat">
                        只检查服务端配置和 URL 格式，不验证密钥、不发送正文、不产生费用。
                        {pendingShots.length > 1 ? ` 当前有 ${pendingShots.length} 个图位待生成，可用「生成全部待处理」按队列批处理。` : ''}
                      </p>
                      {pendingShots.length > 1 ? (
                        <button
                          type="button"
                          className="cv2-btn wide"
                          disabled={seriesRunBusy || stale}
                          onClick={() => setModal('confirm')}
                        >
                          生成全部待处理（{pendingShots.length}）
                        </button>
                      ) : null}
                    </div>

                    <div className="cv2-illu-sidegroup">
                      <h3>图像说明与可访问性</h3>
                      <textarea
                        className="cv2-illu-textarea short"
                        aria-label="图片描述 Alt Text"
                        value={altDraft ?? shot.alt ?? ''}
                        onChange={(e) => setAltDraft(e.target.value)}
                      />
                      <button
                        type="button"
                        className="cv2-btn tiny"
                        disabled={
                          busy ||
                          stale ||
                          shot.status === 'generating' ||
                          (altDraft ?? shot.alt ?? '').trim().length < 2 ||
                          (altDraft ?? '') === (shot.alt ?? '')
                        }
                        onClick={async () => {
                          if (await savePromptFields(shot, { alt: (altDraft ?? '').trim() })) {
                            setAltDraft(null);
                            showToast('图片描述已保存，将用于后续生成与交接。');
                          }
                        }}
                      >
                        保存描述
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="cv2-illu-rightstat">创建配图计划后，这里提供用途、风格与自然语言修改。</p>
                )}
              </aside>
            </div>

            {/* 运维带：映射 / 交接 / 体检 / 质量（设计未画，登记偏差；保留既有真实能力） */}
            <section className="cv2-illu-ops" aria-label="渠道交付与质量检查">
              <div className="cv2-illu-opscard">
                <h3>渠道图片地址与交接 · {CHANNEL_NAMES[channel]}</h3>
                <label className="cv2-illu-field">
                  目标渠道
                  <select
                    aria-label="配图目标渠道"
                    value={channel}
                    onChange={(e) => {
                      setChannel(e.target.value);
                      setHandoffPreview(null);
                      setHandoffCheck(null);
                      setTechnicalAudit(null);
                      setQaChecks(EMPTY_QA);
                      setQaNote('');
                    }}
                  >
                    <option value="wechat">微信公众号</option>
                    <option value="zhihu">知乎</option>
                  </select>
                </label>
                {shots.filter((s) => s.status === 'approved' && s.assetId).length ? (
                  shots
                    .filter((s) => s.status === 'approved' && s.assetId)
                    .map((s) => {
                      const match = s.asset?.mappings?.find((m) => m.channel === channel);
                      return (
                        <div key={s.id} className="cv2-illu-maprow">
                          <b>{shotTitle(s)}</b>
                          <input
                            aria-label={`${shotTitle(s)} 图片 URL`}
                            placeholder="https://…（目标平台或授权图床地址）"
                            value={mappingDrafts[s.id]?.url ?? match?.url ?? ''}
                            onChange={(e) => setMap(s.id, 'url', e.target.value)}
                          />
                          <input
                            aria-label={`${shotTitle(s)} 上传记录`}
                            placeholder="登记人工上传记录、日期或素材编号"
                            value={mappingDrafts[s.id]?.note ?? match?.note ?? ''}
                            onChange={(e) => setMap(s.id, 'note', e.target.value)}
                          />
                          <div className="cv2-illu-genrow">
                            <button type="button" className="cv2-btn tiny" disabled={busy} onClick={() => saveMapping(s)}>
                              保存该渠道映射
                            </button>
                            <span className="cv2-illu-rightstat">
                              {match?.url ? '已登记地址；尚未验证平台显示效果' : '尚未登记地址'}
                            </span>
                          </div>
                        </div>
                      );
                    })
                ) : (
                  <p className="cv2-illu-rightstat">
                    只有「已批准」的图位才需要登记渠道地址；先在上方采用图片。
                  </p>
                )}
                <div className="cv2-illu-genrow">
                  <button type="button" className="cv2-btn" disabled={busy || !state.plan || stale} onClick={buildHandoff}>
                    检查并生成带图 Markdown
                  </button>
                  <button type="button" className="cv2-btn" disabled={busy || !state.plan || stale} onClick={checkHandoff}>
                    检查当前渠道的交接条件
                  </button>
                </div>
                {handoffPreview ? (
                  <div className="cv2-illu-handoff">
                    <p className="cv2-illu-rightstat">
                      已定位插图 {handoffPreview.inserted.length} · 缺少渠道地址 {handoffPreview.unmapped.length} · 段落无法定位{' '}
                      {handoffPreview.unplaced.length}
                    </p>
                    {handoffPreview.ready ? (
                      <p className="cv2-illu-ok">已生成只读 Markdown 提案，可复制交给 doocs/md。</p>
                    ) : (
                      <p className="cv2-illu-warn">仍有未映射或无法定位的图片；不会自动修改正式渠道稿。</p>
                    )}
                    <textarea readOnly rows={6} aria-label="带图 Markdown 预览" value={handoffPreview.markdown} />
                    <button type="button" className="cv2-btn tiny" disabled={!handoffPreview.ready} onClick={copyProposal}>
                      复制带图 Markdown
                    </button>
                  </div>
                ) : null}
                {handoffCheck ? (
                  <div className="cv2-illu-handoff">
                    <p className={handoffCheck.readyForManualQA ? 'cv2-illu-ok' : 'cv2-illu-warn'}>
                      {handoffCheck.readyForManualQA ? '具备人工平台检查条件' : '尚不具备全部交接条件'} · 待批准{' '}
                      {handoffCheck.pendingApproval.length} · 缺少映射 {handoffCheck.unmapped.length} · 无法定位{' '}
                      {handoffCheck.unplaced.length}
                    </p>
                    {handoffCheck.latest ? (
                      <p className="cv2-illu-rightstat">
                        最近一次作者记录：{handoffCheck.latest.result === 'passed' ? '作者报告通过' : '作者报告未通过'} ·{' '}
                        {handoffCheck.latestCurrent ? '匹配当前提案' : '已过期或交接不完整'}（非自动平台核验）
                      </p>
                    ) : null}
                    {handoffCheck.proposalSha256 ? (
                      <div>
                        <b className="cv2-illu-maprow-title">手工记录平台实际检查结果</b>
                        {QA_ITEMS.map(([key, label]) => (
                          <label key={key} className="cv2-illu-consent">
                            <input
                              type="checkbox"
                              checked={qaChecks[key]}
                              onChange={(e) => setQaChecks((old) => ({ ...old, [key]: e.target.checked }))}
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                        <textarea
                          rows={3}
                          aria-label="手工验收备注"
                          placeholder="实际检查时间、图片效果、失败位置和处理结论（至少 12 字）"
                          value={qaNote}
                          onChange={(e) => setQaNote(e.target.value)}
                        />
                        <button
                          type="button"
                          className="cv2-btn tiny"
                          disabled={busy || qaNote.trim().length < 12}
                          onClick={saveManualQa}
                        >
                          保存人工验收记录（含失败）
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="cv2-illu-opscard">
                <h3>离线图片技术体检 · 与 URL 校验分开</h3>
                <p className="cv2-illu-rightstat">
                  只核对本地素材的像素尺寸、比例、大小与替代文字等技术属性；不评价美感、不验证平台显示。渠道 URL 是否登记见左侧映射列表——两者是分开的两件事。
                </p>
                <button type="button" className="cv2-btn" disabled={busy || !state.plan} onClick={checkTechnical}>
                  离线检查配图与候选素材
                </button>
                {technicalAudit ? (
                  <div>
                    <p className="cv2-illu-rightstat">
                      额外模型请求：{technicalAudit.extraModelRequests} 次；未执行付费对比或平台验证。
                    </p>
                    {technicalAudit.shots.map((item) => (
                      <div key={item.shotId} className="cv2-illu-auditrow">
                        <b>
                          {item.role === 'cover' ? '封面' : '章节'} {item.ordinal} · {item.status}
                        </b>
                        {item.issues.length ? <p>交接待处理：{item.issues.join('、')}</p> : null}
                        {!item.variants.length ? (
                          <p>还没有可检查的生成素材</p>
                        ) : (
                          item.variants.map((v) => (
                            <p key={v.assetId}>
                              <a href={v.previewUrl} target="_blank" rel="noopener noreferrer">
                                {v.provider || '未知供应商'} · {v.kind === 'selected' ? '当前选用' : '备选'}
                              </a>{' '}
                              {v.checks.width ? `${v.checks.width} × ${v.checks.height}` : '尺寸无法读取'} · {v.checks.mime} ·{' '}
                              {Math.round(v.checks.bytes / 1024)} KB · 技术检查：
                              {v.checks.issues.length ? v.checks.issues.join('、') : '基本尺寸要求符合'}（不代表视觉质量合格）
                            </p>
                          ))
                        )}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="cv2-illu-opscard cv2-illu-opscard-wide">
                <QualityEvidencePanel projectId={projectId} channel={channel} state={state} />
              </div>

              <div className="cv2-illu-opscard cv2-illu-opscard-wide">
                <VisualSeriesPanel
                  projectId={projectId}
                  seriesData={seriesData}
                  visualProfile={state.visualProfile}
                  shots={shots}
                  visualMemory={state.visualMemory}
                  busy={seriesRunBusy}
                  run={runSeries}
                  onApply={() => setSeriesData(null)}
                />
              </div>
            </section>

            {/* 移动工作流底栏（design :53；位于全局底栏上方，不合并） */}
            <nav className="cv2-illu-bottomnav" aria-label="移动端视觉工作流">
              <Link href={`/compose?project=${encodeURIComponent(projectId)}`}>
                <Icon name="file" size={17} />
                正文
              </Link>
              <button
                type="button"
                onClick={() => {
                  document.querySelector('.cv2-illu-plan')?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                <Icon name="spark" size={17} />
                配图规划
              </button>
              <button type="button" className="active" aria-current="true">
                <Icon name="image" size={17} />
                选图编辑
              </button>
              <button type="button" onClick={() => setModal('preview')}>
                <Icon name="eye" size={17} />
                预览
              </button>
            </nav>
          </>
        )}

        {/* ---- modals ---- */}
        {modal === 'compare' && shot ? (
          <div className="cv2-illu-backdrop" onClick={(e) => e.target === e.currentTarget && setModal('')}>
            <section className="cv2-illu-modal" role="dialog" aria-modal="true" aria-label="对比图片版本">
              <div className="cv2-illu-modalhead">
                <h2>图片版本对比 · {shotTitle(shot)}</h2>
                <button type="button" className="cv2-btn tiny" onClick={() => setModal('')} aria-label="关闭对比">
                  <Icon name="close" size={14} />
                </button>
              </div>
              <div className="cv2-illu-modalbody">
                <p className="cv2-illu-rightstat">
                  左侧是当前预览，右侧是另一个可选版本。切换右侧版本不会影响当前稿件；选择候选后仍需「采用」批准。
                </p>
                <div className="cv2-illu-comparegrid">
                  <div>
                    <b>当前选择</b>
                    <div className="cv2-illu-compareart">
                      {shot.asset ? <img src={shot.asset.previewUrl} alt={shot.alt} /> : <span>尚无素材</span>}
                    </div>
                  </div>
                  <div>
                    <b>对比版本</b>
                    <div className="cv2-illu-compareart">
                      {compareCard ? <img src={compareCard.previewUrl} alt="对比候选" /> : <span>暂无可对比的候选</span>}
                    </div>
                    <select
                      className="cv2-illu-select"
                      aria-label="选择对比版本"
                      value={compareSelect}
                      onChange={(e) => setCompareSelect(e.target.value)}
                    >
                      {variants.cards
                        .filter((c) => !c.selected)
                        .map((c, i) => (
                          <option key={c.key} value={c.key}>
                            {c.label} {i + 1} · {c.note}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="cv2-illu-modalfoot">
                <button type="button" className="cv2-btn" onClick={() => setModal('')}>
                  关闭
                </button>
                <button
                  type="button"
                  className="cv2-btn primary"
                  disabled={!compareCard || busy}
                  onClick={async () => {
                    await selectCandidate(shot, compareCard);
                    setModal('');
                  }}
                >
                  使用右侧版本预览
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {modal === 'preview' ? (
          <div className="cv2-illu-backdrop" onClick={(e) => e.target === e.currentTarget && setModal('')}>
            <section className="cv2-illu-modal" role="dialog" aria-modal="true" aria-label="文章平台预览">
              <div className="cv2-illu-modalhead">
                <div>
                  <h2>文章实际阅读预览</h2>
                  <p className="cv2-illu-rightstat">仅显示已采用图片；各平台仍须独立核对裁切</p>
                </div>
                <button type="button" className="cv2-btn tiny" onClick={() => setModal('')} aria-label="关闭预览">
                  <Icon name="close" size={14} />
                </button>
              </div>
              <div className="cv2-illu-modalbody tinted">
                <div className="cv2-illu-platformseg" role="group" aria-label="预览平台">
                  {CHANNELS.map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={platform === id ? 'active' : ''}
                      aria-pressed={platform === id}
                      onClick={() => setPlatform(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="cv2-illu-phonepreview">
                  {preview.blocks.map((b, i) =>
                    b.type === 'title' ? (
                      <h3 key={i}>{b.text}</h3>
                    ) : b.type === 'heading' ? (
                      <h4 key={i}>{b.text}</h4>
                    ) : b.type === 'text' ? (
                      <p key={i}>{b.text}</p>
                    ) : (
                      <figure key={i}>
                        <img src={b.previewUrl} alt={b.alt} />
                        <figcaption>
                          {b.alt}
                          <span className={b.mapped ? 'ok' : 'warn'}>
                            {b.mapped
                              ? `已登记${CHANNEL_NAMES[platform]}地址（未验证显示效果）`
                              : `${CHANNEL_NAMES[platform]}尚未登记地址 · 导出稿不会包含这张图`}
                          </span>
                        </figcaption>
                      </figure>
                    )
                  )}
                </div>
              </div>
              <div className="cv2-illu-modalfoot">
                <span className="cv2-illu-rightstat">
                  已采用 {preview.adopted} / {preview.total} 张{stale ? ' · 计划已过期' : ''}
                </span>
                <button type="button" className="cv2-btn primary" onClick={() => setModal('')}>
                  继续配图
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {modal === 'confirm' ? (
          <div className="cv2-illu-backdrop" onClick={(e) => e.target === e.currentTarget && setModal('')}>
            <section className="cv2-illu-modal slim" role="dialog" aria-modal="true" aria-label="确认图片生成">
              <div className="cv2-illu-modalhead">
                <h2>确认本次生成范围</h2>
                <button type="button" className="cv2-btn tiny" onClick={() => setModal('')} aria-label="关闭确认">
                  <Icon name="close" size={14} />
                </button>
              </div>
              <div className="cv2-illu-modalbody">
                <p>
                  将为 <b>{pendingShots.length}</b> 个配图位置加入本地队列并开始生成。已批准的图片不会被修改。
                </p>
                <div className="cv2-illu-gensummary">
                  {pendingShots.map((s) => (
                    <div key={s.id}>
                      <b>{shotTitle(s)}</b>
                      <span>{shotAnchor(s, doc?.paragraphs || [])}</span>
                    </div>
                  ))}
                </div>
                <p className="cv2-illu-rightstat">
                  供应商：{providerInfo?.label || provider}
                  {providerReady ? '（已配置）' : '（未配置，先在高级设置选择可用服务）'} · 每图最多 {attemptLimit} 次调用 ·{' '}
                  {budgetLine(state.requestBudget)}
                </p>
                <label className="cv2-illu-consent">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>我允许将这些图位的标题、段落摘要与提示词发送到所选的外部图片模型，并确认没有需要保密的内容。</span>
                </label>
                <p className="cv2-illu-rightstat">
                  批处理按既有预算与队列机制执行；一张失败不会阻塞其他图片，失败图位可单图重试。
                </p>
              </div>
              <div className="cv2-illu-modalfoot">
                <button type="button" className="cv2-btn" onClick={() => setModal('')}>
                  返回调整
                </button>
                <button
                  type="button"
                  className="cv2-btn primary"
                  disabled={busy || !consent || !providerReady}
                  onClick={startBatch}
                >
                  确认并加入队列
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {queueStatus?.active ? (
          <InlineStatus busy tone="info">
            队列执行中 · 排队 {queueStatus.counts?.queued || 0} · 进行中 {queueStatus.counts?.running || 0} · 已完成{' '}
            {queueStatus.counts?.completed || 0} · 失败 {queueStatus.counts?.failed || 0}
          </InlineStatus>
        ) : null}

        {toast ? (
          <div className="cv2-illu-toast" role="status" aria-live="polite">
            {toast}
          </div>
        ) : null}
      </div>
    </CreatorShell>
  );
}

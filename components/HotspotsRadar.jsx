'use client';
// Creator V2 hotspot radar (/hotspots) — the real 热点雷达, an independent
// first-class page (设计对应表：V2.2 热点雷达 → /hotspots). Visual form
// follows the approved design source public/design/creator-v2.2.html
// hotspotsView (:142-153), the V2.2 refinement (:174 monitor band +
// completion band), the sources drawer (:166) and the mobile bottom-sheet
// detail (:22,:25-44).
// Data comes only from the real staging pipeline: GET /api/creator/sources
// and GET /api/creator/source-items (src/creator.mjs:1980-2018) —
// title / source / sync time / original link / sync status. Filtering by
// source uses the endpoint's server-side ?source= parameter; text search
// and the followed tab filter in memory over that payload via
// src/hotspots-radar.mjs (unit-tested). 收为选题候选 goes through
// POST /api/creator/source-items/topic (small backend adapter over
// convertSourceItems + createTopic, no parallel storage) and lands on
// /topics?topic=… with the persistent candidate open. Because the backend
// has no trusted trend/heat/relevance computation, the design-demo
// 升温中 tags, hot scores and the 与我相关 tab are NOT rendered
// (任务书 P0-B: 无可信计算依据时隐藏，绝不展示演示分数).
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import CreatorShell from './CreatorShell';
import Icon from './creator/Icon';
import { EmptyState, ErrorState, InlineStatus, PageHeader } from './creator/primitives';
import { api, send, when } from '../lib/creator-client';
import { HOTSPOT_TABS, buildHotspotsRadar, dayClock, latestSyncAt } from '../src/hotspots-radar.mjs';

const two = (n) => String(n).padStart(2, '0');

function TrendFreeTagRow({ item }) {
  // 设计中的趋势 tag（升温中/新出现/持续讨论）无后端计算依据，正式页不渲染；
  // 行首只保留真实字段：来源品牌 + 同步时间。
  return (
    <div className="cv2-hot-row-top">
      <span className="cv2-hot-brand">{item.sourceName}</span>
      <time>{item.syncedAt ? `同步 ${dayClock(item.syncedAt)}` : '同步时间未知'}</time>
    </div>
  );
}

function DetailPanel({ item, followed, busy, onClose, onFollow, onConvert, compact }) {
  if (!item) return null;
  return (
    <aside className={'cv2-surface cv2-surface-pad cv2-hot-right' + (compact?.open ? ' is-open' : '')} aria-label="热点详情">
      <div className="cv2-hot-headrow">
        <span className="cv2-eyebrow" style={{ margin: 0 }}>
          热点观察 / SIGNAL DETAIL
        </span>
        <span className="cv2-hot-tagrow">
          <span className="cv2-tag info">选题线索</span>
          <button type="button" className="cv2-hot-close" aria-label="关闭热点详情" onClick={onClose} ref={compact?.closeRef}>
            <Icon name="close" size={16} />
          </button>
        </span>
      </div>
      <h3 className="cv2-hot-detail-title">{item.title}</h3>
      <div className="row">
        <span className="cv2-hot-brand">{item.sourceName}</span>
        <span className="cv2-micro">{item.syncedAt ? `${dayClock(item.syncedAt)} 同步` : '同步时间未知'} · 公开信源</span>
      </div>
      <div className="cv2-hot-detail-note">
        <span>内容概要</span>
        <strong>{item.summary || '信源未提供摘要；打开原文查看内容。'}</strong>
      </div>
      {/* 设计原稿的「为什么需要关注/写作角度/不确定性」三段是编辑判断示例数据，
          真实信源条目没有这些字段，正式页以真实的来源/同步/原文信息替代（偏差登记 #2）。 */}
      <div className="cv2-hot-detail-section">
        <h4>原文链接</h4>
        <p>
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="cv2-hot-origin">
            打开原文 <Icon name="arrow" size={12} />
          </a>
        </p>
      </div>
      <div className="cv2-hot-detail-section">
        <h4>采集与同步</h4>
        <p>
          同步于 {item.syncedAt ? dayClock(item.syncedAt) : '未知'}
          {item.publishedAt ? ` · 信源发布时间 ${dayClock(item.publishedAt)}` : ' · 信源未提供发布时间'}
        </p>
      </div>
      <div className="cv2-hot-evidence">
        <div>
          <strong>来源待核实</strong>
          <span>
            {item.sourceName} · {item.syncedAt ? `同步于 ${dayClock(item.syncedAt)}` : '尚未记录同步时间'}
          </span>
        </div>
        <span className="cv2-tag warning">未验证</span>
      </div>
      <div className="cv2-hot-detail-actions">
        <button type="button" className="cv2-btn primary" disabled={!!busy} onClick={onConvert}>
          {busy ? (
            '正在转为选题候选…'
          ) : (
            <>
              <Icon name="plus" size={16} /> 收为选题候选
            </>
          )}
        </button>
        <button type="button" className="cv2-btn" onClick={onFollow}>
          <Icon name="bookmark" size={15} /> {followed ? '已关注 · 点击取消' : '关注这个话题'}
        </button>
        <Link className="cv2-btn ghost" href="/topics">
          查看我的选题库 <Icon name="arrow" size={15} />
        </Link>
      </div>
      <p className="cv2-hot-demo-warning">
        线索来自公开信源的标题与摘要，未经核实；收为选题候选后仍需人工核对原文。热点雷达不自动写作、不自动进入创作上下文。
      </p>
    </aside>
  );
}

function SourcesDrawer({ open, sources, busy, onClose, onToggle }) {
  const closeRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="cv2-drawer-overlay" onClick={onClose}>
      <div
        className="cv2-slide-panel"
        role="dialog"
        aria-modal="true"
        aria-label="信源与参考素材"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cv2-hot-headrow">
          <div>
            <div className="cv2-eyebrow">RESEARCH INPUT</div>
            <h3>信源与参考素材</h3>
          </div>
          <button type="button" className="cv2-btn tiny" onClick={onClose} ref={closeRef}>
            <Icon name="close" size={15} />
            <span className="cv2-visually-hidden">关闭信源面板</span>
          </button>
        </div>
        <p className="cv2-slide-intro">
          默认收集到“待浏览线索”，你确认后才能成为文章参考资料。不会自动把每一条新闻塞进创作上下文。
        </p>
        {sources.length ? (
          sources.map((s) => (
            <div className="cv2-source-item" key={s.id}>
              <div>
                <b>{s.name}</b>
                <small>
                  {s.status === "waiting" ? "等待首次同步" : s.status || "状态未知"} · {when(s.last_run)}
                </small>
              </div>
              <button
                type="button"
                className={'cv2-switch' + (s.enabled ? ' on' : '')}
                role="switch"
                aria-checked={!!s.enabled}
                aria-label={`${s.enabled ? '暂停' : '启用'}信源 ${s.name}`}
                disabled={!!busy}
                onClick={() => onToggle(s)}
              />
            </div>
          ))
        ) : (
          <p className="cv2-hot-empty" style={{ textAlign: 'left', padding: '18px 0' }}>
            还没有信源；在偏好与连接中添加公开 RSS/Atom 信源后，这里会显示每个信源的同步状态。
          </p>
        )}
        <div className="cv2-setting-note">
          这里显示每个信源的真实同步状态与最近读取时间；失败原因来自服务端返回。新增或移除信源在
          <Link href="/settings"> 偏好与连接</Link> 中操作。
        </div>        <button type="button" className="cv2-btn primary" style={{ width: '100%' }} onClick={onClose}>
          完成
        </button>
      </div>
    </div>
  );
}

export default function HotspotsRadar() {
  const [sources, setSources] = useState([]);
  const [items, setItems] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [notice, setNotice] = useState(null); // { tone: 'success'|'warning'|'error'|'info', text }
  const [tab, setTab] = useState('all');
  const [sourceId, setSourceId] = useState('');
  const [query, setQuery] = useState('');
  const [followed, setFollowed] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false); // mobile bottom sheet
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [busy, setBusy] = useState(null); // 'refresh' | 'switch' | `convert:${id}`
  const closeRef = useRef(null);

  async function loadItems(nextSourceId = sourceId) {
    const r = await api(
      '/api/creator/source-items?limit=200' + (nextSourceId ? '&source=' + encodeURIComponent(nextSourceId) : '')
    );
    setItems(r.items || []);
    setSelectedId((cur) => (cur && (r.items || []).some((i) => i.id === cur) ? cur : (r.items || [])[0]?.id ?? null));
  }
  function load(withItems = true) {
    setLoadError(null);
    Promise.all([api('/api/creator/sources'), withItems ? loadItems() : Promise.resolve()])
      .then(([s]) => setSources(s.sources || []))
      .catch((e) => setLoadError(e));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!detailOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setDetailOpen(false);
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [detailOpen]);

  function toggleFollow(id) {
    setFollowed((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
  }

  function select(id) {
    setSelectedId(id);
    // ≤760px：详情面板默认隐藏，点条目后以底部抽屉打开（设计 :22）。
    if (window.matchMedia('(max-width: 760px)').matches) setDetailOpen(true);
  }

  async function refresh() {
    if (busy) return;
    const enabled = sources.filter((s) => s.enabled);
    if (!enabled.length) {
      setNotice({ tone: 'info', text: '没有已启用的信源；在「管理信源」中开启后即可刷新。' });
      return;
    }
    setBusy('refresh');
    setNotice({ tone: 'info', busy: true, text: `正在同步 ${enabled.length} 个已启用信源…` });
    const results = await Promise.allSettled(enabled.map((s) => send(`/api/creator/sources/${s.id}/sync`, 'POST')));
    try {
      await loadItems();
      const [s] = await Promise.all([api('/api/creator/sources')]);
      setSources(s.sources || []);
    } catch (e) {
      setNotice({ tone: 'error', text: e.message || '刷新未完成' });
      setBusy(null);
      return;
    }
    setBusy(null);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = enabled.filter((_, i) => results[i].status === 'rejected');
    if (!ok) {
      setNotice({
        tone: 'error',
        text: `同步失败：${failed.map((s) => s.name).join('、')} 都没有读取成功（${String(results.find((r) => r.status === 'rejected')?.reason?.message || results[0].reason?.message || '网络不可用')}）。已保留现有条目。`,
      });
    } else if (failed.length) {
      setNotice({
        tone: 'warning',
        text: `同步完成：${ok} 个信源成功；失败 ${failed.length} 个（${failed.map((s) => s.name).join('、')}），失败原因见「管理信源」。`,
      });
    } else {
      setNotice({ tone: 'success', text: `已刷新 ${ok} 个信源，列表已按最近同步更新。` });
    }
  }

  async function toggleSource(s) {
    if (busy) return;
    setBusy('switch');
    setNotice(null);
    try {
      const r = await send('/api/creator/sources/' + s.id, 'PUT', { ...s, enabled: !s.enabled, allowExternalRequest: true });
      setSources(r.sources || []);
    } catch (e) {
      setNotice({ tone: 'error', text: e.message || '信源状态未保存' });
    } finally {
      setBusy(null);
    }
  }

  async function pickSource(id) {
    setSourceId(id);
    setBusy('items');
    setNotice(null);
    try {
      await loadItems(id);
    } catch (e) {
      setNotice({ tone: 'error', text: e.message || '条目加载失败' });
    } finally {
      setBusy(null);
    }
  }

  async function convertToTopic(item) {
    if (busy) return;
    setBusy('convert:' + item.id);
    setNotice(null);
    try {
      const r = await send('/api/creator/source-items/topic', 'POST', { id: item.id });
      // 真实持久化完成后进入选题页并直接打开该候选（重复收起时服务端
      // 返回既有候选，同样直接打开——不伪造“已创建”）。
      window.location.assign('/topics?topic=' + encodeURIComponent(r.topic.id));
    } catch (e) {
      setNotice({ tone: 'error', text: e.message || '收为选题候选未完成' });
      setBusy(null);
    }
  }

  const radar = items ? buildHotspotsRadar({ items, tab, query, followed }) : null;
  const selected = items?.find((i) => i.id === selectedId) || null;
  const latest = latestSyncAt(sources);
  const noSourcesAtAll = !!items && sources.length === 0;

  return (
    <CreatorShell>
      <PageHeader
        eyebrow="HOTSPOT RADAR / SIGNAL MONITORING"
        title="热点雷达"
        description="独立的热点监控页面。先发现变化，再筛选与自己有关的方向；选题判断在下一页完成。"
        actions={
          <>
            <button type="button" className="cv2-btn cv2-hot-manage" onClick={() => setSourcesOpen(true)}>
              <Icon name="filter" size={15} />
              <span>管理信源</span>
            </button>
            <button type="button" className="cv2-btn primary cv2-hot-refresh" onClick={refresh} disabled={busy === 'refresh'}>
              <Icon name="clock" size={15} />
              <span>{busy === 'refresh' ? '正在同步…' : '刷新热点'}</span>
            </button>
          </>
        }
      />

      {loadError ? (
        <ErrorState title="热点雷达加载失败" error={loadError} hint="检查本地服务是否在运行，然后重试。" onRetry={() => load()} />
      ) : null}
      {!items && !loadError ? <InlineStatus busy tone="info">正在打开热点雷达…</InlineStatus> : null}
      {notice ? (
        <p className={'cv2-status is-' + (notice.tone || 'info')} role="status" aria-busy={notice.busy || undefined}>
          <span className="cv2-status-dot" aria-hidden="true" />
          <span>{notice.text}</span>
        </p>
      ) : null}

      {radar ? (
        <>
          {/* masthead — .hot-masthead (creator-v2.2.html:148)；两个数字都是真实计数 */}
          <div className="cv2-hot-masthead">
            <div>
              <div className="cv2-hot-eyebrow">
                <i className="cv2-hot-pulse" aria-hidden="true" /> 公开信息 · 采集与趋势监测
              </div>
              <h3>
                别错过正在发生的事。
                <br />
                但也不必追逐每一个热点。
              </h3>
              <p>
                这里汇总已启用信源同步到的公开条目，按最近同步排列。热点不会自动进入作品，也不会直接当作事实；是否值得写，在选题页判断。
              </p>
            </div>
            <div className="cv2-hot-summary">
              <div>
                <b>{two(radar.counts.all)}</b>
                <span>
                  本页线索
                  <br />
                  来自信源最近同步
                </span>
              </div>
              <div>
                <b>{two(radar.counts.followed)}</b>
                <span>
                  本会话关注的话题
                  <br />
                  不自动进入作品
                </span>
              </div>
            </div>
          </div>

          {/* 说明带 — .v2-monitor (creator-v2.2.html:174)；首卡时间为真实最近同步 */}
          <div className="cv2-hot-monitor">
            <article>
              <i>
                <Icon name="clock" size={15} />
              </i>
              <div>
                <b>来源更新时间</b>
                <p>
                  {latest
                    ? `最近一次同步 ${dayClock(latest)}；每个信源的同步、失败与重试状态在「管理信源」中。`
                    : '信源还没有同步记录；打开「管理信源」查看状态或点「刷新热点」手动同步。'}
                </p>
              </div>
            </article>
            <article>
              <i>
                <Icon name="filter" size={15} />
              </i>
              <div>
                <b>跨来源去重</b>
                <p>同一信源内按链接去重暂存；转成素材与选题候选后仍保留原文链接，不以重复转载次数冒充热度。</p>
              </div>
            </article>
            <article>
              <i>
                <Icon name="shield" size={15} />
              </i>
              <div>
                <b>风险提示</b>
                <p>“上升趋势”与“事实可信”分开判断；后端没有可信的热度/趋势计算，本页不展示热度分。</p>
              </div>
            </article>
          </div>

          {/* 流程线 — .hot-flow (creator-v2.2.html:149) */}
          <div className="cv2-hot-flow">
            <b>01 热点监控</b>
            <span aria-hidden="true">→</span> 02 选题判断 <span aria-hidden="true">→</span> 03 开始创作
          </div>

          {/* 控件行 — .hot-controls (creator-v2.2.html:150)。「与我相关」需要
              相关度计算依据，后端没有，正式页不提供该筛选（偏差登记 #1）。 */}
          <div className="cv2-hot-controls">
            <div className="cv2-hot-tabs" role="group" aria-label="热点筛选">
              {HOTSPOT_TABS.map((t) => (
                <button key={t.key} type="button" className={tab === t.key ? 'active' : ''} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
            <label className="cv2-hot-find">
              <Icon name="search" size={15} />
              <input
                aria-label="搜索热点"
                autoComplete="off"
                placeholder="搜索标题或摘要"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>

          {/* 来源行 — .hot-source-row (creator-v2.2.html:151)；chip=真实信源 */}
          <div className="cv2-hot-source-row">
            <button type="button" className={sourceId === '' ? 'active' : ''} aria-pressed={sourceId === ''} onClick={() => pickSource('')}>
              全部来源
            </button>
            {sources.map((s) => (
              <button key={s.id} type="button" className={sourceId === s.id ? 'active' : ''} aria-pressed={sourceId === s.id} onClick={() => pickSource(s.id)}>
                {s.name}
              </button>
            ))}
            <span className="cv2-hot-note">条目来自公开 RSS/Atom · 不代表平台热度</span>
          </div>

          {noSourcesAtAll ? (
            <EmptyState
              icon="flame"
              title="还没有信源"
              hint="热点雷达读取你在偏好与连接里订阅的公开 RSS/Atom 信源。添加并同步后，这里会出现真实条目。"
              action={
                <Link className="cv2-btn primary" href="/settings">
                  去偏好与连接添加信源
                </Link>
              }
            />
          ) : (
            <div className="cv2-hot-layout">
              {/* 列表 — .hot-list (creator-v2.2.html:152) */}
              <section className="cv2-surface cv2-hot-list">
                <div className="cv2-hot-list-head">
                  <strong>
                    最新话题 <span className="cv2-tag">{busy === 'items' ? '…' : radar.counts.shown} 条</span>
                  </strong>
                  <span>按同步时间排序 · 未核验</span>
                </div>
                {radar.rows.length ? (
                  radar.rows.map((x, i) => (
                    <article key={x.id} className={'cv2-hot-row' + (selectedId === x.id ? ' selected' : '')}>
                      <span className="cv2-hot-rank" aria-hidden="true">
                        {two(i + 1)}
                      </span>
                      <div>
                        <TrendFreeTagRow item={x} />
                        <button type="button" className="cv2-hot-row-title" onClick={() => select(x.id)}>
                          {x.title}
                        </button>
                        {x.summary ? <p>{x.summary}</p> : null}
                        <div className="cv2-hot-row-tail">
                          <span>来源：{x.sourceName}</span>
                          <span aria-hidden="true">·</span>
                          <a href={x.url} target="_blank" rel="noopener noreferrer">
                            原文链接
                          </a>
                        </div>
                        <button type="button" className="cv2-hot-next-link" onClick={() => select(x.id)}>
                          查看详情与原文 <Icon name="arrow" size={13} />
                        </button>
                      </div>
                      <div className="cv2-hot-row-buttons">
                        <button
                          type="button"
                          className={'cv2-hot-iconbtn' + (followed.includes(x.id) ? ' active' : '')}
                          title={followed.includes(x.id) ? '取消关注' : '关注话题'}
                          aria-label={`${followed.includes(x.id) ? '取消关注' : '关注话题'}：${x.title}`}
                          aria-pressed={followed.includes(x.id)}
                          onClick={() => toggleFollow(x.id)}
                        >
                          <Icon name="bookmark" size={15} />
                        </button>
                        <button
                          type="button"
                          className="cv2-hot-iconbtn"
                          title="收为选题候选"
                          aria-label={`收为选题候选：${x.title}`}
                          disabled={busy === 'convert:' + x.id}
                          onClick={() => convertToTopic(x)}
                        >
                          <Icon name="arrow" size={16} />
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="cv2-hot-empty">
                    {items.length === 0 ? (
                      <>
                        信源还没有同步到条目。
                        <br />
                        点「刷新热点」手动同步，或在「管理信源」查看每个信源的最近状态与失败原因。
                      </>
                    ) : (
                      <>没有匹配的话题。试试其他来源或清空搜索。</>
                    )}
                  </div>
                )}
              </section>

              {/* 详情 — 桌面 sticky 右栏 / 移动底部抽屉（设计 :152-153, :22） */}
              {detailOpen ? (
                <button type="button" className="cv2-hot-backdrop" aria-label="关闭热点详情" onClick={() => setDetailOpen(false)} />
              ) : null}
              <DetailPanel
                item={selected}
                followed={selected ? followed.includes(selected.id) : false}
                busy={selected ? busy === 'convert:' + selected.id : false}
                compact={{ open: detailOpen, closeRef }}
                onClose={() => setDetailOpen(false)}
                onFollow={() => selected && toggleFollow(selected.id)}
                onConvert={() => selected && convertToTopic(selected)}
              />
            </div>
          )}

          {/* 完成条 — .v2-completion (creator-v2.2.html:174) */}
          <div className="cv2-completion">
            <div>
              <strong>热点页负责发现，选题页负责判断</strong>
              <p>关注话题不会自动发布，也不会把整个信源直接注入 AI 上下文；收为候选的线索可追溯到原文。</p>
            </div>
            <Link className="cv2-btn" href="/topics">
              进入选题研究 <Icon name="arrow" size={14} />
            </Link>
          </div>
        </>
      ) : null}

      <SourcesDrawer open={sourcesOpen} sources={sources} busy={busy === 'switch'} onClose={() => setSourcesOpen(false)} onToggle={toggleSource} />
    </CreatorShell>
  );
}

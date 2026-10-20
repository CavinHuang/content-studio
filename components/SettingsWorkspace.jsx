'use client';
// Creator V2 settings (/settings) — the real 偏好与连接 that takes over the
// V2 route placeholder (设计对应表：V2.2 偏好与连接 → /settings).
// Visual form follows the approved design source
// public/design/creator-v2.2.html settingsView (:164) + the V2.2
// refinement (:183): the PERSONALIZE page head, the 基础编辑不依赖 AI
// declaration band, the settings-grid `180px / 1fr` with a four-group
// menu (创作画像 / 模型与费用 / 发布账号 / 信源与研究 — grouped, not a
// wall of toggles), the white form card, and the closing 配置项只在真正
// 需要时出现 band.
//
// Honesty / boundary contract for this page (implementation prompt §3 P1
// + AGENTS.md):
//   - 创作者画像 first; every group is wired to the SAME real APIs the
//     previous settings screen used (profile PUT with expectedRevision +
//     restoreRevision, services connections with the V76 enabled-model
//     catalog flow, platforms accounts/probe with explicit consent,
//     sources with allowExternalRequest consent, usage limits/settle).
//     No new storage, no localStorage, no fabricated states.
//   - Secrets never round-trip: connections show 密钥已配置 only (the
//     services API already omits the key), platform credentials stay
//     server-side, and the page states that in the closing band.
//   - External actions keep their explicit per-action consent checkboxes
//     (model catalog GET, WeChat capability probe, RSS subscription).
//   - The prototype's 「独立 UI/UX 演示」 note and demo values are NOT
//     copied; every field binds real persisted data (registered as a
//     design deviation). Legacy deep links #services/#usage/#sources
//     keep working by selecting the matching group.
// Reused legacy widgets (CreatorStyleSuggestion / CreatorAccountProfile)
// keep the exact interaction flows e2e/creator-v1.spec.mjs exercises;
// this file only re-skins their containers (see app/creator-v2-settings.css).
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import CreatorShell from './CreatorShell';
import CreatorAccountProfile from './CreatorAccountProfile';
import CreatorStyleSuggestion from './CreatorStyleSuggestion';
import Icon from './creator/Icon';
import {
  EmptyState,
  ErrorState,
  InlineStatus,
  PageHeader,
  SectionCard,
  Tag,
} from './creator/primitives';
import { api, send, when } from '../lib/creator-client';

const GROUPS = [
  ['profile', '创作画像'],
  ['services', '模型与费用'],
  ['platforms', '发布账号'],
  ['sources', '信源与研究'],
];
// Legacy hash deep links (old CreatorSettings tabs) map onto the four
// design groups; #usage scrolls to the 费用与额度 card.
const HASH_GROUP = {
  profile: 'profile',
  services: 'services',
  usage: 'services',
  platforms: 'platforms',
  sources: 'sources',
};

const PROFILE_PRIMARY = [
  ['domain', '创作领域', '例如：AI 工具与独立创作者'],
  ['audience', '希望写给谁', '例如：希望提升效率的内容创作者'],
  ['tone', '表达语气', '例如：自然直接，像和朋友分享'],
];
const PROFILE_ADVANCED = [
  ['goals', '创作目标', '例如：分享实践经验，形成长期内容系列'],
  ['structure', '结构偏好', '例如：先说结论，再用具体例子展开'],
  ['avoid', '避免的表达', '例如：空泛口号、夸张承诺'],
  ['length', '篇幅偏好', '例如：公众号 1500 字左右'],
  ['visual', '视觉偏好', '例如：克制、自然、留白'],
];

const emptyConnection = {
  kind: 'text',
  name: '',
  baseUrl: 'https://api.openai.com/v1/',
  model: '',
  apiKey: '',
  models: [],
  selected: true,
};
const PLATFORM_LABELS = { wechat: '微信公众号', zhihu: '知乎', xiaohongshu: '小红书' };
const USAGE_STATE = { completed: '已完成', failed: '失败', unknown: '待核实', reserved: '已预留' };

export default function SettingsWorkspace() {
  const [group, setGroup] = useState('profile');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [notice, setNoticeState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileSaved, setProfileSaved] = useState(null);
  const [history, setHistory] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [projects, setProjects] = useState([]);
  const [learningIds, setLearningIds] = useState([]);
  const [connections, setConnections] = useState([]);
  const [availability, setAvailability] = useState({ text: false, image: false });
  const [connection, setConnection] = useState(emptyConnection);
  const [catalog, setCatalog] = useState(null);
  const [catalogConsent, setCatalogConsent] = useState(false);
  const [platforms, setPlatforms] = useState([]);
  const [platform, setPlatform] = useState({ platform: 'wechat', name: '', appId: '', appSecret: '' });
  const [sources, setSources] = useState([]);
  const [source, setSource] = useState({ name: '', url: '', enabled: true });
  const [usage, setUsage] = useState(null);
  const [limits, setLimits] = useState({ textLimit: 100, imageLimit: 30 });
  const didScroll = useRef(false);

  const setNotice = useCallback((text, tone = 'info') => {
    setNoticeState(text ? { text, tone } : null);
  }, []);

  const load = useCallback(async () => {
    const [p, h, sg, s, pl, so, u, pr] = await Promise.all([
      api('/api/creator/profile'),
      api('/api/creator/profile/history'),
      api('/api/creator/style-suggestions'),
      api('/api/creator/services'),
      api('/api/creator/platforms'),
      api('/api/creator/sources'),
      api('/api/creator/usage'),
      api('/api/editor/projects'),
    ]);
    setProfile(p);
    setProfileSaved(p);
    setHistory(h.history);
    setSuggestions(sg.suggestions);
    setConnections(s.connections);
    setAvailability(s.availability || { text: false, image: false });
    setPlatforms(pl.accounts);
    setSources(so.sources);
    setUsage(u);
    setLimits(u.limits);
    setProjects(pr.projects);
  }, []);

  // Legacy deep links stay meaningful: #services/#usage/#platforms/#sources
  // select the corresponding design group (mobile-audit.spec.mjs visits
  // /settings#services); #usage additionally scrolls to the 费用与额度 card.
  useEffect(() => {
    const apply = () => {
      const key = HASH_GROUP[window.location.hash.replace('#', '')];
      if (key) setGroup(key);
      if (window.location.hash === '#usage') didScroll.current = false;
    };
    apply();
    window.addEventListener('hashchange', apply);
    load()
      .then(() => setLoadError(null))
      .catch((e) => setLoadError(e))
      .finally(() => setLoading(false));
    return () => window.removeEventListener('hashchange', apply);
  }, [load]);
  useEffect(() => {
    if (loading || didScroll.current) return;
    if (window.location.hash !== '#usage') return;
    didScroll.current = true;
    document.getElementById('cv2-set-usage')?.scrollIntoView({ block: 'start' });
  }, [loading, group]);

  async function act(fn) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice(e.message || '操作未完成', 'error');
    } finally {
      setBusy(false);
      setConsent(false);
    }
  }

  function editConnection(c) {
    setConnection({ ...c, apiKey: '', models: c.models || [] });
    setCatalog(null);
    setCatalogConsent(false);
  }
  function toggleModel(model, checked) {
    setConnection((c) => ({
      ...c,
      models: checked
        ? [...(c.models || []), model]
        : (c.models || []).filter((m) => m !== model),
      model: checked && !c.model ? model : c.model,
    }));
  }
  const catalogRows = [
    ...new Set(
      [
        connection.model,
        ...(catalog || []),
        ...(catalog ? [] : connection.models || []),
      ].filter(Boolean)
    ),
  ];
  const profileDirty = profile && profileSaved && JSON.stringify(profile) !== JSON.stringify(profileSaved);

  if (loading && !profile) {
    return (
      <CreatorShell>
        <PageHeader
          eyebrow="PERSONALIZE"
          title="让工作台逐渐了解你的风格"
          description="基础设置一次完成，高级选项需要时再打开。"
        />
        <InlineStatus busy>正在打开偏好与连接…</InlineStatus>
      </CreatorShell>
    );
  }

  return (
    <CreatorShell>
      <PageHeader
        eyebrow="PERSONALIZE"
        title="让工作台逐渐了解你的风格"
        description="基础设置一次完成，高级选项需要时再打开。"
      />

      {notice ? (
        <InlineStatus tone={notice.tone}>{notice.text}</InlineStatus>
      ) : null}
      {loadError ? (
        <ErrorState
          title="偏好与连接加载失败"
          error={loadError}
          hint="检查本地服务是否在运行，然后重试。"
          onRetry={() => {
            setLoading(true);
            load()
              .then(() => setLoadError(null))
              .catch((e) => setLoadError(e))
              .finally(() => setLoading(false));
          }}
        />
      ) : null}

      {/* 顶部声明条 — creator-v2.2.html:183 .v2-settings-head（真实产品原则） */}
      <div className="cv2-set-head">
        <span className="cv2-tag success">基础编辑不依赖 AI</span>
        <span>即使没有配置模型和发布账号，也可以新建、编辑、保存及导出文章。</span>
      </div>

      {profile ? (
        <>
          <div className="cv2-set-grid">
            <nav className="cv2-set-menu" aria-label="设置分组">
              {GROUPS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={group === key ? 'active' : ''}
                  aria-pressed={group === key}
                  onClick={() => {
                    setGroup(key);
                    setConsent(false);
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div className="cv2-set-body">
              {group === 'profile' ? (
                <>
                  {/* 创作画像 — 设计 :164 第一组（创作方向/目标读者/写作偏好三行），
                      真实字段沿用既有 creator profile 契约 */}
                  <SectionCard
                    title="创作画像"
                    description="帮助 AI 理解你的读者和表达方式"
                    aside={<Tag tone="info">画像 v{profile.revision}</Tag>}
                  >
                    <p className="cv2-set-note">
                      画像保存在本地服务端，每次保存生成新版本；风格建议只有你确认后才会写进画像，所有版本都可以从历史恢复。
                    </p>
                    <form
                      className="cv2-set-stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        act(async () => {
                          const { revision, createdAt, ...data } = profile;
                          try {
                            const saved = await send('/api/creator/profile', 'PUT', {
                              expectedRevision: revision,
                              data,
                            });
                            setNotice(`作者画像已保存为 v${saved.revision}。`, 'success');
                          } catch (err) {
                            if (err.status === 409) await load().catch(() => {});
                            throw err;
                          }
                          await load();
                        });
                      }}
                    >
                      {PROFILE_PRIMARY.map(([key, label, placeholder]) => (
                        <label className="cv2-set-field" key={key}>
                          {label}
                          <textarea
                            aria-label={label}
                            rows={2}
                            maxLength={2000}
                            placeholder={placeholder}
                            value={profile[key]}
                            onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
                          />
                        </label>
                      ))}
                      <details className="cv2-set-more">
                        <summary>更多画像字段与时区</summary>
                        {PROFILE_ADVANCED.map(([key, label, placeholder]) => (
                          <label className="cv2-set-field" key={key}>
                            {label}
                            <textarea
                              aria-label={label}
                              rows={2}
                              maxLength={2000}
                              placeholder={placeholder}
                              value={profile[key]}
                              onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
                            />
                          </label>
                        ))}
                        <label className="cv2-set-field">
                          创作计划时区
                          <input
                            aria-label="创作计划时区"
                            value={profile.timezone}
                            onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
                          />
                        </label>
                        <label className="cv2-set-check">
                          <input
                            type="checkbox"
                            checked={profile.learningEnabled}
                            onChange={(e) =>
                              setProfile({ ...profile, learningEnabled: e.target.checked })
                            }
                          />
                          允许从自己的文章提炼写作画像建议
                        </label>
                        <label className="cv2-set-check">
                          <input
                            type="checkbox"
                            checked={profile.backgroundAI}
                            onChange={(e) =>
                              setProfile({ ...profile, backgroundAI: e.target.checked })
                            }
                          />
                          授权发布后在后台调用写作模型提炼建议（计入每日额度；建议仍需我确认）
                        </label>
                      </details>
                      <button className="cv2-btn primary" disabled={busy}>
                        保存作者画像
                      </button>
                    </form>
                    <details className="cv2-set-history">
                      <summary>画像版本与撤销</summary>
                      {history.length ? (
                        history.map((h) => (
                          <div className="cv2-set-version" key={h.revision}>
                            <b>
                              v{h.revision} · {when(h.createdAt)}
                              {h.revoked ? ' · 含已撤销字段' : ''}
                            </b>
                            <small>
                              {h.sources.length
                                ? '来源：' +
                                  h.sources.map((s) => s.title + ' v' + s.revision).join('、')
                                : '作者主动设置'}
                            </small>
                            <pre>
                              {Object.entries(h.data)
                                .filter(([key]) =>
                                  [...PROFILE_PRIMARY, ...PROFILE_ADVANCED].some(([k]) => k === key)
                                )
                                .map(
                                  ([key, value]) =>
                                    [...PROFILE_PRIMARY, ...PROFILE_ADVANCED].find(([k]) => k === key)[1] +
                                    '：' +
                                    value
                                )
                                .join('\n')}
                            </pre>
                            <button
                              className="cv2-btn tiny"
                              disabled={busy || h.revoked || h.revision === profile.revision}
                              onClick={() =>
                                act(async () => {
                                  await send('/api/creator/profile', 'PUT', {
                                    expectedRevision: profile.revision,
                                    restoreRevision: h.revision,
                                  });
                                  setNotice('已恢复为新画像版本，历史记录仍保留。', 'success');
                                  await load();
                                })
                              }
                            >
                              恢复这个画像版本
                            </button>
                          </div>
                        ))
                      ) : (
                        <p className="cv2-micro">还没有历史版本；第一次保存后这里会出现可恢复的记录。</p>
                      )}
                    </details>
                  </SectionCard>

                  {/* 风格学习 — 提炼入口按 /insights 偏差 #4 保留在本页（发送前需同意） */}
                  <SectionCard
                    title="从作品中沉淀写作风格"
                    description="选择自己的文章。模型只提炼表达习惯，并附上文章版本与证据；确认后才会影响后续写作。"
                  >
                    {!profile.learningEnabled ? (
                      <InlineStatus tone="warning">
                        画像学习已暂停：在上方「更多画像字段与时区」中重新开启后才能提炼建议。
                      </InlineStatus>
                    ) : null}
                    {projects.length ? (
                      <div className="cv2-set-scroll">
                        {projects.map((p) => (
                          <label className="cv2-set-check" key={p.id}>
                            <input
                              type="checkbox"
                              checked={learningIds.includes(p.id)}
                              onChange={(e) =>
                                setLearningIds(
                                  e.target.checked
                                    ? [...learningIds, p.id]
                                    : learningIds.filter((id) => id !== p.id)
                                )
                              }
                            />
                            {p.title}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        icon="file"
                        title="还没有可学习的作品"
                        hint="在创作空间保存文章后，可以在这里把它们提炼为风格建议。"
                        action={
                          <Link className="cv2-btn tiny" href="/compose">
                            去创作空间 <Icon name="arrow" size={12} />
                          </Link>
                        }
                      />
                    )}
                    <label className="cv2-set-check">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      允许本次向模型发送所选文章及已接受 / 拒绝的写作建议
                    </label>
                    <div>
                      <button
                        className="cv2-btn"
                        disabled={busy || !consent || !learningIds.length || !profile.learningEnabled}
                        onClick={() =>
                          act(async () => {
                            await send('/api/creator/style-suggestions', 'POST', {
                              projectIds: learningIds,
                              allowExternalAI: true,
                            });
                            setNotice('画像建议已生成，请审阅后决定。', 'success');
                            await load();
                          })
                        }
                      >
                        提炼风格建议
                      </button>
                    </div>
                    <div className="cv2-set-suggest">
                      {suggestions.map((s) => (
                        <CreatorStyleSuggestion
                          key={s.id}
                          suggestion={s}
                          profileRevision={profile.revision}
                          disabled={busy || profileDirty}
                          onUpdated={load}
                          onNotice={setNotice}
                        />
                      ))}
                    </div>
                  </SectionCard>
                </>
              ) : group === 'services' ? (
                <>
                  {/* 模型与费用 — 设计 :164 第二组（当前/备用写作模型、费用提醒）；
                      真实契约 = 服务连接（V76 开放模型目录）+ 每日额度 */}
                  <SectionCard
                    title="服务连接"
                    description="提供商与模型在这里维护，不干扰日常写作"
                    aside={
                      <Tag>
                        环境预设：写作{availability.text ? '已配置' : '未配置'} · 配图
                        {availability.image ? '已配置' : '未配置'}
                      </Tag>
                    }
                  >
                    {connections.map((c) => (
                      <div className="cv2-set-row" key={c.id}>
                        <div className="cv2-set-row-head">
                          <b>{c.name}</b>
                          <span className="cv2-set-tags">
                            <Tag tone="info">{c.kind === 'text' ? '写作' : '配图'}</Tag>
                            <Tag tone={c.selected ? 'success' : 'default'}>
                              {c.selected ? '当前使用' : '备用'}
                            </Tag>
                          </span>
                        </div>
                        <p className="cv2-micro">
                          {c.baseUrl}
                          <br />
                          {c.model} · 密钥已配置（仅保存在服务端，页面不回显）
                          {(c.models || []).length > 1
                            ? ` · 已开放 ${c.models.length} 个模型供创作对比`
                            : ''}
                        </p>
                        <div className="cv2-set-actions">
                          <button className="cv2-btn tiny" disabled={busy} onClick={() => editConnection(c)}>
                            编辑连接
                          </button>
                          {!c.selected && (
                            <button
                              className="cv2-btn tiny"
                              disabled={busy}
                              onClick={() =>
                                act(async () => {
                                  await send('/api/creator/services/' + c.id, 'PUT', {
                                    ...c,
                                    selected: true,
                                  });
                                  await load();
                                })
                              }
                            >
                              设为当前服务
                            </button>
                          )}
                          <button
                            className="cv2-btn tiny"
                            disabled={busy}
                            onClick={() =>
                              act(async () => {
                                await send('/api/creator/services/' + c.id, 'DELETE');
                                setNotice('服务连接已移除。', 'success');
                                await load();
                              })
                            }
                          >
                            移除连接
                          </button>
                        </div>
                      </div>
                    ))}
                    {!connections.length && (
                      <EmptyState
                        icon="spark"
                        title="未连接模型服务"
                        hint="没有模型也能新建、编辑、保存及导出文章。添加 OpenAI 兼容连接后，助手才可参与写作、配图与风格提炼；管理员预设服务如已配置也可直接使用。"
                      />
                    )}
                    <form
                      className="cv2-set-stack cv2-set-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        act(async () => {
                          const payload = { ...connection };
                          if (!payload.apiKey) delete payload.apiKey;
                          payload.models = connection.models || [];
                          await send(
                            '/api/creator/services' + (connection.id ? '/' + connection.id : ''),
                            connection.id ? 'PUT' : 'POST',
                            payload
                          );
                          setConnection(emptyConnection);
                          setCatalog(null);
                          setCatalogConsent(false);
                          setNotice('服务连接已加密保存。', 'success');
                          await load();
                        });
                      }}
                    >
                      <h3 className="cv2-set-sub">{connection.id ? '编辑服务连接' : '添加服务连接'}</h3>
                      <label className="cv2-set-field">
                        用途
                        <select
                          value={connection.kind}
                          onChange={(e) => setConnection({ ...connection, kind: e.target.value })}
                        >
                          <option value="text">LLM 写作与讨论</option>
                          <option value="image">图片生成</option>
                        </select>
                      </label>
                      <label className="cv2-set-field">
                        连接名称
                        <input
                          value={connection.name}
                          required
                          minLength={2}
                          maxLength={80}
                          placeholder="例如：我的写作模型"
                          onChange={(e) => setConnection({ ...connection, name: e.target.value })}
                        />
                      </label>
                      <label className="cv2-set-field">
                        API Base URL
                        <input
                          value={connection.baseUrl}
                          required
                          placeholder="https://…/v1/"
                          onChange={(e) => {
                            setConnection({ ...connection, baseUrl: e.target.value });
                            setCatalog(null);
                          }}
                        />
                      </label>
                      <label className="cv2-set-field">
                        API Key {connection.id ? '（留空保留现有密钥）' : ''}
                        <input
                          type="password"
                          autoComplete="new-password"
                          required={!connection.id}
                          value={connection.apiKey}
                          onChange={(e) => setConnection({ ...connection, apiKey: e.target.value })}
                        />
                      </label>
                      <label className="cv2-set-check">
                        <input
                          type="checkbox"
                          checked={catalogConsent}
                          onChange={(e) => setCatalogConsent(e.target.checked)}
                        />
                        允许向该服务商请求一次模型列表（GET models，不计入每日额度）
                      </label>
                      <div>
                        <button
                          type="button"
                          className="cv2-btn tiny"
                          disabled={
                            busy || !catalogConsent || !connection.baseUrl || !connection.apiKey
                          }
                          onClick={() =>
                            act(async () => {
                              const r = await send('/api/creator/services/models', 'POST', {
                                baseUrl: connection.baseUrl,
                                apiKey: connection.apiKey,
                                allowExternalCheck: true,
                              });
                              setCatalog(r.models);
                              setConnection((c) => ({
                                ...c,
                                models: (c.models || []).filter((m) => r.models.includes(m)),
                              }));
                              setNotice(
                                '已获取模型列表，请勾选开放使用的模型；第一个勾选的模型会成为默认模型。',
                                'success'
                              );
                            })
                          }
                        >
                          {catalog ? '重新获取模型列表' : '获取模型列表'}
                        </button>
                      </div>
                      {!!catalogRows.length && (
                        <div className="cv2-set-scroll">
                          {catalogRows.map((m) => {
                            const isDefault = connection.model === m;
                            return (
                              <label className="cv2-set-check" key={m}>
                                <input
                                  type="checkbox"
                                  disabled={isDefault || (!catalog && !connection.id)}
                                  checked={isDefault || connection.models.includes(m)}
                                  onChange={(e) => toggleModel(m, e.target.checked)}
                                />
                                {m}
                                {isDefault && <span className="cv2-tag info">默认</span>}
                              </label>
                            );
                          })}
                          <p className="cv2-micro">
                            {catalog
                              ? '勾选的模型在创作页可选可对比；默认模型是创作页的初始选择，不可取消勾选。'
                              : '这是该连接已开放的模型；重新获取列表后可调整开放范围。'}
                          </p>
                        </div>
                      )}
                      <label className="cv2-set-field">
                        默认模型
                        <input
                          value={connection.model}
                          required
                          maxLength={160}
                          placeholder="填写服务商提供的模型 ID"
                          onChange={(e) => setConnection({ ...connection, model: e.target.value })}
                        />
                      </label>
                      <label className="cv2-set-check">
                        <input
                          type="checkbox"
                          checked={connection.selected}
                          onChange={(e) =>
                            setConnection({ ...connection, selected: e.target.checked })
                          }
                        />
                        设为此用途的当前服务
                      </label>
                      <div className="cv2-set-actions">
                        <button className="cv2-btn primary" disabled={busy}>
                          保存服务连接
                        </button>
                        {connection.id && (
                          <button
                            type="button"
                            className="cv2-btn"
                            onClick={() => {
                              setConnection(emptyConnection);
                              setCatalog(null);
                              setCatalogConsent(false);
                            }}
                          >
                            取消编辑
                          </button>
                        )}
                      </div>
                    </form>
                  </SectionCard>

                  <SectionCard
                    className="cv2-set-usage"
                    title="费用与额度"
                    description="以服务请求数预留额度。中断或服务端错误的请求保留占用，核实后再结算。金额与账单以服务商为准。"
                  >
                    <div id="cv2-set-usage" />
                    <p className="cv2-set-note">
                      单次费用提醒：每次调用前，创作与配图页都会先展示发送范围、使用模型与成本并等你确认；这里设置的是每日请求上限，本页不产生任何调用。
                    </p>
                    <form
                      className="cv2-set-limits"
                      onSubmit={(e) => {
                        e.preventDefault();
                        act(async () => {
                          await send('/api/creator/usage', 'PUT', {
                            textLimit: Number(limits.textLimit),
                            imageLimit: Number(limits.imageLimit),
                          });
                          setNotice('每日请求上限已更新。', 'success');
                          await load();
                        });
                      }}
                    >
                      <label className="cv2-set-field">
                        写作请求上限
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          value={limits.textLimit}
                          onChange={(e) => setLimits({ ...limits, textLimit: e.target.value })}
                        />
                      </label>
                      <label className="cv2-set-field">
                        图片请求上限
                        <input
                          type="number"
                          min={0}
                          max={10000}
                          value={limits.imageLimit}
                          onChange={(e) => setLimits({ ...limits, imageLimit: e.target.value })}
                        />
                      </label>
                      <button className="cv2-btn" disabled={busy}>
                        保存额度
                      </button>
                    </form>
                    <h3 className="cv2-set-sub">今日请求</h3>
                    {usage?.today?.length ? (
                      usage.today.map((u, i) => (
                        <p className="cv2-micro cv2-set-usage-line" key={i}>
                          {u.kind === 'text' ? '写作' : '配图'} · {USAGE_STATE[u.state]} · {u.requests} 次
                        </p>
                      ))
                    ) : (
                      <p className="cv2-micro cv2-set-usage-line">今天还没有模型调用记录。</p>
                    )}
                    <h3 className="cv2-set-sub">最近调用记录</h3>
                    {usage?.recent?.length ? (
                      usage.recent.map((u) => (
                        <div className="cv2-set-row" key={u.id}>
                          <div className="cv2-set-row-head">
                            <b>
                              {u.kind === 'text' ? '写作' : '配图'} · {USAGE_STATE[u.state]}
                            </b>
                            <span className="cv2-micro">{when(u.at)}</span>
                          </div>
                          <p className="cv2-micro">
                            预留 {u.reserved} 次 / 结算 {u.actual ?? '待核实'}
                          </p>
                          {u.state === 'unknown' && (
                            <div className="cv2-set-actions">
                              <button
                                className="cv2-btn tiny"
                                disabled={busy}
                                onClick={() =>
                                  act(async () => {
                                    await send('/api/creator/usage/' + u.id, 'POST', {
                                      state: 'completed',
                                    });
                                    await load();
                                  })
                                }
                              >
                                已核对，计入额度
                              </button>
                              <button
                                className="cv2-btn tiny"
                                disabled={busy}
                                onClick={() =>
                                  act(async () => {
                                    await send('/api/creator/usage/' + u.id, 'POST', {
                                      state: 'failed',
                                    });
                                    await load();
                                  })
                                }
                              >
                                已核对，未产生请求
                              </button>
                            </div>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="cv2-micro cv2-set-usage-line">还没有调用记录。</p>
                    )}
                  </SectionCard>
                </>
              ) : group === 'platforms' ? (
                <>
                  {/* 发布账号 — 设计 :164 第三组（公众号待连接/知乎待连接/人工确认策略） */}
                  <SectionCard
                    title="发布账号"
                    description="公众号、知乎等发布渠道集中管理"
                    aside={<Tag tone="success">人工确认，不自动发布</Tag>}
                  >
                    <p className="cv2-set-note">
                      默认发布策略是人工确认：本产品没有任何自动发布路径，导出与草稿箱推送也不是发布成功。官方接口是否可用取决于账号权限，需要用你自己的账号验证。
                    </p>
                    {platforms.map((a) => (
                      <div className="cv2-set-row cv2-set-acct" key={a.id}>
                        <div className="cv2-set-row-head">
                          <b>{a.name}</b>
                          <span className="cv2-set-tags">
                            <Tag tone="info">{PLATFORM_LABELS[a.platform] || a.platform}</Tag>
                          </span>
                        </div>
                        <p className="cv2-micro">
                          {a.platform === 'wechat'
                            ? a.capabilities?.draftRead
                              ? '草稿读取能力检查通过；实际发送请审阅'
                              : '草稿接口待检查'
                            : '支持成品导出与发布回填'}
                        </p>
                        <CreatorAccountProfile account={a} onUpdated={load} onNotice={setNotice} />
                        {a.platform === 'wechat' && (
                          <>
                            <label className="cv2-set-check">
                              <input
                                type="checkbox"
                                checked={consent}
                                onChange={(e) => setConsent(e.target.checked)}
                              />
                              允许本次请求微信官方接口检查账号能力
                            </label>
                            <div className="cv2-set-actions">
                              <button
                                className="cv2-btn tiny"
                                disabled={busy || !consent}
                                onClick={() =>
                                  act(async () => {
                                    await send(
                                      '/api/creator/platforms/accounts/' + a.id + '/probe',
                                      'POST',
                                      { allowExternalCall: true }
                                    );
                                    setNotice(
                                      '草稿读取能力检查通过。首次写入仍需在微信后台核对草稿结果。',
                                      'success'
                                    );
                                    await load();
                                  })
                                }
                              >
                                检查公众号接口
                              </button>
                            </div>
                          </>
                        )}
                        <div className="cv2-set-actions">
                          <button
                            className="cv2-btn tiny"
                            disabled={busy}
                            onClick={() =>
                              act(async () => {
                                await send('/api/creator/platforms/accounts/' + a.id, 'DELETE');
                                setNotice('平台账号已移除。', 'success');
                                await load();
                              })
                            }
                          >
                            移除账号
                          </button>
                        </div>
                      </div>
                    ))}
                    {!platforms.length && (
                      <EmptyState
                        icon="send"
                        title="公众号、知乎均待连接"
                        hint="添加发布账号后才能在发布中心使用对应渠道的交付能力；没有账号也完全可以写作与导出。"
                      />
                    )}
                    <form
                      className="cv2-set-stack cv2-set-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        act(async () => {
                          await send('/api/creator/platforms/accounts', 'POST', platform);
                          setPlatform({ ...platform, name: '', appId: '', appSecret: '' });
                          setNotice('平台账号已保存。', 'success');
                          await load();
                        });
                      }}
                    >
                      <h3 className="cv2-set-sub">添加发布账号</h3>
                      <label className="cv2-set-field">
                        发布平台
                        <select
                          aria-label="发布平台"
                          value={platform.platform}
                          onChange={(e) => setPlatform({ ...platform, platform: e.target.value })}
                        >
                          <option value="wechat">微信公众号</option>
                          <option value="zhihu">知乎</option>
                          <option value="xiaohongshu">小红书</option>
                        </select>
                      </label>
                      <label className="cv2-set-field">
                        账号名称
                        <input
                          required
                          minLength={2}
                          value={platform.name}
                          onChange={(e) => setPlatform({ ...platform, name: e.target.value })}
                        />
                      </label>
                      {platform.platform === 'wechat' && (
                        <>
                          <label className="cv2-set-field">
                            公众号 AppID
                            <input
                              autoComplete="off"
                              required
                              value={platform.appId}
                              onChange={(e) => setPlatform({ ...platform, appId: e.target.value })}
                            />
                          </label>
                          <label className="cv2-set-field">
                            公众号 AppSecret
                            <input
                              type="password"
                              autoComplete="new-password"
                              required
                              value={platform.appSecret}
                              onChange={(e) => setPlatform({ ...platform, appSecret: e.target.value })}
                            />
                          </label>
                          <p className="cv2-micro">
                            凭据在服务端加密，页面不回显。请在微信后台核对接口权限与服务 IP 白名单。
                          </p>
                        </>
                      )}
                      <div className="cv2-set-actions">
                        <button className="cv2-btn primary" disabled={busy}>
                          保存发布账号
                        </button>
                      </div>
                    </form>
                  </SectionCard>
                </>
              ) : (
                <>
                  {/* 信源与研究 — 设计 :164 第四组（默认信源/来源边界）；
                      真实契约 = RSS/Atom 信源 CRUD + 显式订阅授权 */}
                  <SectionCard
                    title="公开信源"
                    description="管理可信信息源与定时抓取"
                    aside={<Tag>{sources.filter((s) => s.enabled).length} 个订阅中</Tag>}
                  >
                    <p className="cv2-set-note">
                      来源边界：公开内容只作为线索与参考素材，重要事实必须核查后才能进入文章。启用订阅即授权服务端按计划读取该公开信源；管理信源也可以在热点雷达的抽屉中完成。
                    </p>
                    {sources.map((s) => (
                      <div className="cv2-set-row" key={s.id}>
                        <div className="cv2-set-row-head">
                          <b>{s.name}</b>
                          <span className="cv2-set-tags">
                            <Tag tone={s.enabled ? 'success' : 'default'}>
                              {s.enabled ? '订阅中' : '已暂停'}
                            </Tag>
                          </span>
                        </div>
                        <p className="cv2-micro cv2-set-url">
                          {s.url}
                          <br />
                          {s.enabled
                            ? s.last_run
                              ? '上次读取 ' + when(s.last_run) + (s.status ? ' · ' + s.status : '')
                              : '还没有读取过' + (s.status ? ' · ' + s.status : '')
                            : '订阅已暂停，不会抓取新内容'}
                        </p>
                        <div className="cv2-set-actions">
                          <button
                            className="cv2-btn tiny"
                            disabled={busy}
                            onClick={() =>
                              act(async () => {
                                await send('/api/creator/sources/' + s.id, 'PUT', {
                                  ...s,
                                  enabled: !s.enabled,
                                  allowExternalRequest: true,
                                });
                                await load();
                              })
                            }
                          >
                            {s.enabled ? '暂停订阅' : '恢复订阅'}
                          </button>
                          <button
                            className="cv2-btn tiny"
                            disabled={busy}
                            onClick={() =>
                              act(async () => {
                                await send('/api/creator/sources/' + s.id + '/sync', 'POST');
                                setNotice('已读取「' + s.name + '」，最新条目见热点雷达。', 'success');
                                await load();
                              })
                            }
                          >
                            立即读取
                          </button>
                          <button
                            className="cv2-btn tiny"
                            disabled={busy}
                            onClick={() =>
                              act(async () => {
                                await send('/api/creator/sources/' + s.id, 'DELETE');
                                setNotice('信源已移除；已抓取的线索保留在热点雷达。', 'success');
                                await load();
                              })
                            }
                          >
                            移除信源
                          </button>
                        </div>
                      </div>
                    ))}
                    {!sources.length && (
                      <EmptyState
                        icon="link"
                        title="还没有订阅任何公开信源"
                        hint="热点雷达与选题发现的线索都来自这里。添加 RSS / Atom 地址并确认订阅后开始抓取。"
                      />
                    )}
                    <form
                      className="cv2-set-stack cv2-set-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        act(async () => {
                          await send('/api/creator/sources', 'POST', {
                            ...source,
                            allowExternalRequest: consent,
                          });
                          setSource({ name: '', url: '', enabled: true });
                          setNotice('公开信源已保存。', 'success');
                          await load();
                        });
                      }}
                    >
                      <h3 className="cv2-set-sub">添加公开信源</h3>
                      <label className="cv2-set-field">
                        名称
                        <input
                          required
                          minLength={2}
                          value={source.name}
                          onChange={(e) => setSource({ ...source, name: e.target.value })}
                        />
                      </label>
                      <label className="cv2-set-field">
                        RSS / Atom 地址
                        <input
                          type="url"
                          required
                          value={source.url}
                          onChange={(e) => setSource({ ...source, url: e.target.value })}
                        />
                      </label>
                      <label className="cv2-set-check">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                        />
                        允许服务端按计划读取该公开信源
                      </label>
                      <div className="cv2-set-actions">
                        <button className="cv2-btn primary" disabled={busy || !consent}>
                          保存并启用订阅
                        </button>
                      </div>
                    </form>
                  </SectionCard>
                </>
              )}
            </div>
          </div>

          {/* 底部完成条 — creator-v2.2.html:183（密钥仅存服务端；回写作页） */}
          <div className="cv2-set-done">
            <div>
              <strong>配置项只在真正需要时出现</strong>
              <p>
                模型连接、私有材料发送和付费调用在执行前展示范围与成本；真实密钥仅保存在服务端，不出现在页面、日志或导出中。
              </p>
            </div>
            <Link className="cv2-btn" href="/compose">
              回到写作 <Icon name="arrow" size={14} />
            </Link>
          </div>
        </>
      ) : null}
    </CreatorShell>
  );
}

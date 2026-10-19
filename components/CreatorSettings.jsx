"use client";
import { useEffect, useState } from "react";
import CreatorAccountProfile from "./CreatorAccountProfile";
import CreatorShell from "./CreatorShell";
import CreatorStyleSuggestion from "./CreatorStyleSuggestion";
import { api, send, when } from "../lib/creator-client";
const profileFields = [
  ["domain", "创作领域", "例如：AI 工具与独立创作者"],
  ["audience", "希望写给谁", "例如：希望提升效率的内容创作者"],
  ["goals", "创作目标", "例如：分享实践经验，形成长期内容系列"],
  ["tone", "表达语气", "例如：自然直接，像和朋友分享"],
  ["structure", "结构偏好", "例如：先说结论，再用具体例子展开"],
  ["avoid", "避免的表达", "例如：空泛口号、夸张承诺"],
  ["length", "篇幅偏好", "例如：公众号 1500 字左右"],
  ["visual", "视觉偏好", "例如：克制、自然、森林绿与暖白"],
];
const emptyConnection = {
  kind: "text",
  name: "",
  baseUrl: "https://api.openai.com/v1/",
  model: "",
  apiKey: "",
  models: [],
  selected: true,
};
export default function CreatorSettings() {
  const [profileSaved, setProfileSaved] = useState(null);
  const [tab, setTab] = useState("profile"),
    [profile, setProfile] = useState(null),
    [history, setHistory] = useState([]),
    [suggestions, setSuggestions] = useState([]),
    [projects, setProjects] = useState([]),
    [learningIds, setLearningIds] = useState([]),
    [connections, setConnections] = useState([]),
    [connection, setConnection] = useState(emptyConnection),
    [platforms, setPlatforms] = useState([]),
    [platform, setPlatform] = useState({
      platform: "wechat",
      name: "",
      appId: "",
      appSecret: "",
    }),
    [sources, setSources] = useState([]),
    [source, setSource] = useState({ name: "", url: "", enabled: true }),
    [usage, setUsage] = useState(null),
    [limits, setLimits] = useState({ textLimit: 100, imageLimit: 30 }),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [catalog, setCatalog] = useState(null),
    [catalogConsent, setCatalogConsent] = useState(false);
  async function load() {
    const [p, h, sg, s, pl, so, u, pr] = await Promise.all([
      api("/api/creator/profile"),
      api("/api/creator/profile/history"),
      api("/api/creator/style-suggestions"),
      api("/api/creator/services"),
      api("/api/creator/platforms"),
      api("/api/creator/sources"),
      api("/api/creator/usage"),
      api("/api/editor/projects"),
    ]);
    setProfile(p);
    setProfileSaved(p);
    setHistory(h.history);
    setSuggestions(sg.suggestions);
    setConnections(s.connections);
    setPlatforms(pl.accounts);
    setSources(so.sources);
    setUsage(u);
    setLimits(u.limits);
    setProjects(pr.projects);
  }
  useEffect(() => {
    if (window.location.hash === "#sources") setTab("sources");
    if (window.location.hash === "#usage") setTab("usage");
    if (window.location.hash === "#services") setTab("services");
    load().catch((e) => setNotice(e.message));
  }, []);
  async function act(fn) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
      setConsent(false);
    }
  }
  function editConnection(c) {
    setConnection({ ...c, apiKey: "", models: c.models || [] });
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
  return (
    <CreatorShell>
      <header className="creator-head">
        <div>
          <span className="creator-kicker">MADE FOR YOUR VOICE</span>
          <h1>让助手逐渐理解你的表达</h1>
          <p>
            你决定创作方向、模型服务和平台账号，也决定哪些学习建议进入画像。
          </p>
        </div>
      </header>
      <div className="creator-tabs">
        {[
          ["profile", "作者画像"],
          ["services", "写作与配图服务"],
          ["platforms", "发布账号"],
          ["sources", "公开信源"],
          ["usage", "用量与额度"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={() => {
              setTab(key);
              setConsent(false);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {notice && (
        <p className="creator-note" role="status">
          {notice}
        </p>
      )}
      {!profile ? (
        <p className="creator-loading">正在载入创作者设置…</p>
      ) : tab === "profile" ? (
        <div className="creator-grid">
          <section>
            <form
              className="creator-panel creator-stack"
              onSubmit={(e) => {
                e.preventDefault();
                act(async () => {
                  const { revision, createdAt, ...data } = profile;
                  setProfile(
                    await send("/api/creator/profile", "PUT", {
                      expectedRevision: revision,
                      data,
                    })
                  );
                  await load();
                  setNotice("作者画像已保存为新版本。");
                });
              }}
            >
              <h2>我的创作偏好 · v{profile.revision}</h2>
              {profileFields.map(([key, label, placeholder]) => (
                <label key={key}>
                  {label}
                  <textarea
                    aria-label={label}
                    rows={2}
                    placeholder={placeholder}
                    value={profile[key]}
                    onChange={(e) =>
                      setProfile({ ...profile, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <label>
                创作计划时区
                <input
                  value={profile.timezone}
                  onChange={(e) =>
                    setProfile({ ...profile, timezone: e.target.value })
                  }
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={profile.learningEnabled}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      learningEnabled: e.target.checked,
                    })
                  }
                />
                允许从自己的文章提炼写作画像建议
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={profile.backgroundAI}
                  onChange={(e) =>
                    setProfile({ ...profile, backgroundAI: e.target.checked })
                  }
                />
                授权发布后在后台调用写作模型提炼建议（计入每日额度；建议仍需我确认）
              </label>
              <button className="primary" disabled={busy}>
                保存作者画像
              </button>
            </form>
            <details className="creator-panel">
              <summary>画像版本与撤销</summary>
              {history.map((h) => (
                <div className="creator-card" key={h.revision}>
                  <h3>
                    v{h.revision} · {when(h.createdAt)}
                  </h3>
                  <small className="creator-muted">
                    {h.sources.length
                      ? "来源：" +
                        h.sources
                          .map((s) => s.title + " v" + s.revision)
                          .join("、")
                      : "作者主动设置"}
                  </small>
                  <pre className="creator-pre">
                    {Object.entries(h.data)
                      .filter(([key]) => profileFields.some(([k]) => k === key))
                      .map(
                        ([key, value]) =>
                          profileFields.find(([k]) => k === key)[1] +
                          "：" +
                          value
                      )
                      .join("\n")}
                  </pre>
                  <button
                    disabled={
                      busy || h.revoked || h.revision === profile.revision
                    }
                    onClick={() =>
                      act(async () => {
                        await send("/api/creator/profile", "PUT", {
                          expectedRevision: profile.revision,
                          restoreRevision: h.revision,
                        });
                        await load();
                        setNotice("已恢复为新画像版本，历史记录仍保留。");
                      })
                    }
                  >
                    恢复这个画像版本
                  </button>
                </div>
              ))}
            </details>
          </section>
          <section className="creator-panel">
            <h2>从作品中沉淀写作风格</h2>
            <p className="creator-muted">
              选择自己的文章。模型只提炼表达习惯，并附上文章版本与证据；确认后才会影响后续写作。
            </p>
            <div
              className="creator-stack"
              style={{ maxHeight: 260, overflow: "auto", marginBottom: 18 }}
            >
              {projects.map((p) => (
                <label className="check" key={p.id}>
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
            <label className="check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              允许本次向模型发送所选文章及已接受 / 拒绝的写作建议
            </label>
            <button
              style={{ marginTop: 15 }}
              disabled={
                busy ||
                !consent ||
                !learningIds.length ||
                !profile.learningEnabled
              }
              onClick={() =>
                act(async () => {
                  await send("/api/creator/style-suggestions", "POST", {
                    projectIds: learningIds,
                    allowExternalAI: true,
                  });
                  await load();
                  setNotice("画像建议已生成，请审阅后决定。");
                })
              }
            >
              提炼风格建议
            </button>
            {suggestions.map((s) => (
              <CreatorStyleSuggestion
                key={s.id}
                suggestion={s}
                profileRevision={profile.revision}
                disabled={
                  busy ||
                  JSON.stringify(profile) !== JSON.stringify(profileSaved)
                }
                onUpdated={load}
                onNotice={setNotice}
              />
            ))}
          </section>
        </div>
      ) : tab === "services" ? (
        <div className="creator-grid">
          <section className="creator-panel">
            <h2>服务连接</h2>
            <p className="creator-muted">
              每类选择一个当前连接。支持 OpenAI
              兼容的写作和图片接口；凭据仅在服务端加密保存。
            </p>
            {connections.map((c) => (
              <div className="creator-card" key={c.id}>
                <div className="creator-row spread">
                  <h3>{c.name}</h3>
                  <span className="creator-badge">
                    {c.kind === "text" ? "写作" : "配图"} ·{" "}
                    {c.selected ? "当前使用" : "备用"}
                  </span>
                </div>
                <p>
                  {c.baseUrl}
                  <br />
                  {c.model} · 密钥已配置
                  {(c.models || []).length > 1 && (
                    <>
                      <br />
                      已开放 {c.models.length} 个模型供创作对比
                    </>
                  )}
                </p>
                <div className="creator-row">
                  <button
                    disabled={busy}
                    onClick={() => editConnection(c)}
                  >
                    编辑连接
                  </button>
                  {!c.selected && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          await send("/api/creator/services/" + c.id, "PUT", {
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
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await send("/api/creator/services/" + c.id, "DELETE");
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
              <p className="creator-empty">
                添加写作模型和配图服务后，助手即可参与创作。管理员预设服务如已配置也可使用。
              </p>
            )}
          </section>
          <form
            className="creator-panel creator-stack"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                const payload = { ...connection };
                if (!payload.apiKey) delete payload.apiKey;
                payload.models = connection.models || [];
                await send(
                  "/api/creator/services" +
                    (connection.id ? "/" + connection.id : ""),
                  connection.id ? "PUT" : "POST",
                  payload
                );
                setConnection(emptyConnection);
                setCatalog(null);
                setCatalogConsent(false);
                await load();
                setNotice("服务连接已加密保存。");
              });
            }}
          >
            <h2>{connection.id ? "编辑服务连接" : "添加服务连接"}</h2>
            <label>
              用途
              <select
                value={connection.kind}
                onChange={(e) =>
                  setConnection({ ...connection, kind: e.target.value })
                }
              >
                <option value="text">LLM 写作与讨论</option>
                <option value="image">图片生成</option>
              </select>
            </label>
            <label>
              连接名称
              <input
                value={connection.name}
                required
                minLength={2}
                maxLength={80}
                placeholder="例如：我的写作模型"
                onChange={(e) =>
                  setConnection({ ...connection, name: e.target.value })
                }
              />
            </label>
            <label>
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
            <label>
              API Key {connection.id ? "（留空保留现有密钥）" : ""}
              <input
                type="password"
                autoComplete="new-password"
                required={!connection.id}
                value={connection.apiKey}
                onChange={(e) =>
                  setConnection({ ...connection, apiKey: e.target.value })
                }
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={catalogConsent}
                onChange={(e) => setCatalogConsent(e.target.checked)}
              />
              允许向该服务商请求一次模型列表（GET models，不计入每日额度）
            </label>
            <button
              type="button"
              disabled={
                busy ||
                !catalogConsent ||
                !connection.baseUrl ||
                !connection.apiKey
              }
              onClick={() =>
                act(async () => {
                  const r = await send("/api/creator/services/models", "POST", {
                    baseUrl: connection.baseUrl,
                    apiKey: connection.apiKey,
                    allowExternalCheck: true,
                  });
                  setCatalog(r.models);
                  setConnection((c) => ({
                    ...c,
                    models: (c.models || []).filter((m) =>
                      r.models.includes(m)
                    ),
                  }));
                  setNotice(
                    "已获取模型列表，请勾选开放使用的模型；第一个勾选的模型会成为默认模型。"
                  );
                })
              }
            >
              {catalog ? "重新获取模型列表" : "获取模型列表"}
            </button>
            {!!catalogRows.length && (
              <div
                className="creator-stack"
                style={{ maxHeight: 220, overflow: "auto" }}
              >
                {catalogRows.map((m) => {
                  const isDefault = connection.model === m;
                  return (
                    <label className="check" key={m}>
                      <input
                        type="checkbox"
                        disabled={isDefault || (!catalog && !connection.id)}
                        checked={isDefault || connection.models.includes(m)}
                        onChange={(e) => toggleModel(m, e.target.checked)}
                      />
                      {m}
                      {isDefault && (
                        <span className="creator-badge">默认</span>
                      )}
                    </label>
                  );
                })}
                <p className="creator-muted">
                  {catalog
                    ? "勾选的模型在创作页可选可对比；默认模型是创作页的初始选择，不可取消勾选。"
                    : "这是该连接已开放的模型；重新获取列表后可调整开放范围。"}
                </p>
              </div>
            )}
            <label>
              默认模型
              <input
                value={connection.model}
                required
                maxLength={160}
                placeholder="填写服务商提供的模型 ID"
                onChange={(e) =>
                  setConnection({ ...connection, model: e.target.value })
                }
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={connection.selected}
                onChange={(e) =>
                  setConnection({ ...connection, selected: e.target.checked })
                }
              />
              设为此用途的当前服务
            </label>
            <button className="primary" disabled={busy}>
              保存服务连接
            </button>
            {connection.id && (
              <button
                type="button"
                onClick={() => {
                  setConnection(emptyConnection);
                  setCatalog(null);
                  setCatalogConsent(false);
                }}
              >
                取消编辑
              </button>
            )}
          </form>
        </div>
      ) : tab === "platforms" ? (
        <div className="creator-grid">
          <section className="creator-panel">
            <h2>我的发布账号</h2>
            <p className="creator-muted">
              微信公众号支持草稿接口适配；知乎、小红书通过成品包交付并记录发布链接。官方接口是否可用取决于账号权限，需使用你的账号验证。
            </p>
            {platforms.map((a) => (
              <div className="creator-card" key={a.id}>
                <h3>{a.name}</h3>
                <CreatorAccountProfile
                  account={a}
                  onUpdated={load}
                  onNotice={setNotice}
                />
                <p>
                  {
                    {
                      wechat: "微信公众号",
                      zhihu: "知乎",
                      xiaohongshu: "小红书",
                    }[a.platform]
                  }{" "}
                  ·{" "}
                  {a.platform === "wechat"
                    ? a.capabilities.draftRead
                      ? "草稿读取能力检查通过；实际发送请审阅"
                      : "草稿接口待检查"
                    : "支持成品导出与发布回填"}
                </p>
                {a.platform === "wechat" && (
                  <>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />
                      允许本次请求微信官方接口检查账号能力
                    </label>
                    <button
                      style={{ marginTop: 12 }}
                      disabled={busy || !consent}
                      onClick={() =>
                        act(async () => {
                          await send(
                            "/api/creator/platforms/accounts/" +
                              a.id +
                              "/probe",
                            "POST",
                            { allowExternalCall: true }
                          );
                          await load();
                          setNotice(
                            "草稿读取能力检查通过。首次写入仍需在微信后台核对草稿结果。"
                          );
                        })
                      }
                    >
                      检查公众号接口
                    </button>
                  </>
                )}
                <button
                  style={{ marginLeft: 8 }}
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await send(
                        "/api/creator/platforms/accounts/" + a.id,
                        "DELETE"
                      );
                      await load();
                    })
                  }
                >
                  移除账号
                </button>
              </div>
            ))}
          </section>
          <form
            className="creator-panel creator-stack"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await send("/api/creator/platforms/accounts", "POST", platform);
                setPlatform({
                  ...platform,
                  name: "",
                  appId: "",
                  appSecret: "",
                });
                await load();
                setNotice("平台账号已保存。");
              });
            }}
          >
            <h2>添加发布账号</h2>
            <label>
              平台
              <select
                aria-label="发布平台"
                value={platform.platform}
                onChange={(e) =>
                  setPlatform({ ...platform, platform: e.target.value })
                }
              >
                <option value="wechat">微信公众号</option>
                <option value="zhihu">知乎</option>
                <option value="xiaohongshu">小红书</option>
              </select>
            </label>
            <label>
              账号名称
              <input
                required
                minLength={2}
                value={platform.name}
                onChange={(e) =>
                  setPlatform({ ...platform, name: e.target.value })
                }
              />
            </label>
            {platform.platform === "wechat" && (
              <>
                <label>
                  公众号 AppID
                  <input
                    autoComplete="off"
                    required
                    value={platform.appId}
                    onChange={(e) =>
                      setPlatform({ ...platform, appId: e.target.value })
                    }
                  />
                </label>
                <label>
                  公众号 AppSecret
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    value={platform.appSecret}
                    onChange={(e) =>
                      setPlatform({ ...platform, appSecret: e.target.value })
                    }
                  />
                </label>
                <p className="creator-muted">
                  凭据在服务端加密。请在微信后台核对接口权限与服务 IP 白名单。
                </p>
              </>
            )}
            <button className="primary" disabled={busy}>
              保存发布账号
            </button>
          </form>
        </div>
      ) : tab === "sources" ? (
        <div className="creator-grid">
          <section className="creator-panel">
            <h2>公开 RSS / Atom 信源</h2>
            <p className="creator-muted">
              启用订阅即授权服务端每小时读取该公开信源，内容作为参考素材，仍需核实。
            </p>
            {sources.map((s) => (
              <div className="creator-card" key={s.id}>
                <h3>{s.name}</h3>
                <p>
                  {s.url}
                  <br />
                  {s.status} · {when(s.last_run)}
                </p>
                <div className="creator-row">
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await send("/api/creator/sources/" + s.id, "PUT", {
                          ...s,
                          enabled: !s.enabled,
                          allowExternalRequest: true,
                        });
                        await load();
                      })
                    }
                  >
                    {s.enabled ? "暂停订阅" : "恢复订阅"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await send(
                          "/api/creator/sources/" + s.id + "/sync",
                          "POST"
                        );
                        await load();
                      })
                    }
                  >
                    立即读取
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await send("/api/creator/sources/" + s.id, "DELETE");
                        await load();
                      })
                    }
                  >
                    移除信源
                  </button>
                </div>
              </div>
            ))}
          </section>
          <form
            className="creator-panel creator-stack"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await send("/api/creator/sources", "POST", {
                  ...source,
                  allowExternalRequest: consent,
                });
                setSource({ name: "", url: "", enabled: true });
                await load();
                setNotice("公开信源已保存。");
              });
            }}
          >
            <h2>添加公开信源</h2>
            <label>
              名称
              <input
                required
                minLength={2}
                value={source.name}
                onChange={(e) => setSource({ ...source, name: e.target.value })}
              />
            </label>
            <label>
              RSS / Atom 地址
              <input
                type="url"
                required
                value={source.url}
                onChange={(e) => setSource({ ...source, url: e.target.value })}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              允许服务端按计划读取该公开信源
            </label>
            <button className="primary" disabled={busy || !consent}>
              保存并启用订阅
            </button>
          </form>
        </div>
      ) : (
        <div className="creator-grid">
          <section className="creator-panel">
            <h2>每日调用额度</h2>
            <p className="creator-muted">
              以服务请求数预留额度。中断或服务端错误的请求保留占用，核实后再结算。金额与账单以服务商为准。
            </p>
            <form
              className="creator-stack"
              onSubmit={(e) => {
                e.preventDefault();
                act(async () => {
                  await send("/api/creator/usage", "PUT", {
                    textLimit: Number(limits.textLimit),
                    imageLimit: Number(limits.imageLimit),
                  });
                  await load();
                  setNotice("每日请求上限已更新。");
                });
              }}
            >
              <label>
                写作请求上限
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={limits.textLimit}
                  onChange={(e) =>
                    setLimits({ ...limits, textLimit: e.target.value })
                  }
                />
              </label>
              <label>
                图片请求上限
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={limits.imageLimit}
                  onChange={(e) =>
                    setLimits({ ...limits, imageLimit: e.target.value })
                  }
                />
              </label>
              <button disabled={busy}>保存额度</button>
            </form>
            <h3 style={{ marginTop: 25 }}>今日请求</h3>
            {usage?.today.map((u, i) => (
              <p className="creator-muted" key={i}>
                {u.kind === "text" ? "写作" : "配图"} ·{" "}
                {
                  {
                    completed: "已完成",
                    failed: "失败",
                    unknown: "待核实",
                    reserved: "已预留",
                  }[u.state]
                }{" "}
                · {u.requests} 次
              </p>
            ))}
          </section>
          <section className="creator-panel">
            <h2>最近调用记录</h2>
            {usage?.recent.map((u) => (
              <div className="creator-card" key={u.id}>
                <span className="creator-badge">
                  {u.kind === "text" ? "写作" : "配图"} ·{" "}
                  {
                    {
                      completed: "已完成",
                      failed: "失败",
                      unknown: "待核实",
                      reserved: "已预留",
                    }[u.state]
                  }
                </span>
                <p>
                  {when(u.at)} · 预留 {u.reserved} 次 / 结算{" "}
                  {u.actual ?? "待核实"}
                </p>
                {u.state === "unknown" && (
                  <div className="creator-row">
                    <button
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          await send("/api/creator/usage/" + u.id, "POST", {
                            state: "completed",
                          });
                          await load();
                        })
                      }
                    >
                      已核对，计入额度
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        act(async () => {
                          await send("/api/creator/usage/" + u.id, "POST", {
                            state: "failed",
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
            ))}
          </section>
        </div>
      )}
    </CreatorShell>
  );
}

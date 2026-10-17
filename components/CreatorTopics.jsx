"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import CreatorShell from "./CreatorShell";
import CreatorJobReview from "./CreatorJobReview";
import { api, send, when } from "../lib/creator-client";
const topicState = {
  draft: "待讨论",
  prepared: "大纲已准备",
  confirmed: "已确认",
  dismissed: "暂不创作",
  writing: "写作中",
};
export default function CreatorTopics() {
  const query = useSearchParams(),
    [view, setView] = useState(query.get("view") || "topics"),
    [topics, setTopics] = useState([]),
    [series, setSeries] = useState([]),
    [jobs, setJobs] = useState([]),
    [library, setLibrary] = useState([]),
    [selected, setSelected] = useState(null),
    [selectedOrigin, setSelectedOrigin] = useState(null),
    [history, setHistory] = useState(null),
    [feedbackReason, setFeedbackReason] = useState(""),
    [recommendIds, setRecommendIds] = useState([]),
    [messages, setMessages] = useState([]),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [consent, setConsent] = useState(false),
    [message, setMessage] = useState(""),
    [newTitle, setNewTitle] = useState(""),
    [seriesForm, setSeriesForm] = useState({
      name: "",
      goal: "",
      cadenceDays: 7,
      timezone: "Asia/Shanghai",
      entries: "",
      backgroundAI: false,
    });
  const briefDirty =
    !!selected && JSON.stringify(selected) !== JSON.stringify(selectedOrigin);
  async function load(initial = false) {
    const [t, s, l, j] = await Promise.all([
      api("/api/creator/topics"),
      api("/api/creator/series"),
      api("/api/creator/library"),
      api("/api/creator/jobs"),
    ]);
    setTopics(t.topics);
    setSeries(s.series);
    setLibrary(l.assets);
    setJobs(j.jobs);
    if (initial && query.get("series")) setView("series");
    if (initial && query.get("topic")) {
      const found = t.topics.find((t) => t.id === query.get("topic"));
      if (found) {
        setSelected(found);
        setSelectedOrigin(found);
        setMessages(
          (await api("/api/creator/topics/" + found.id + "/messages")).messages
        );
      }
    }
  }
  useEffect(() => {
    load(true).catch((e) => setNotice(e.message));
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
    }
  }
  async function open(t) {
    setSelected(t);
    setSelectedOrigin(t);
    setHistory(null);
    setFeedbackReason("");
    setMessages(
      (await api("/api/creator/topics/" + t.id + "/messages")).messages
    );
  }
  async function save(patch = {}) {
    const t = await send("/api/creator/topics/" + selected.id, "PUT", {
      ...selected,
      ...patch,
      feedbackReason,
      expectedRevision: selected.revision,
    });
    setSelected(t);
    setSelectedOrigin(t);
    setHistory(null);
    setFeedbackReason("");
    await load();
    return t;
  }
  async function start() {
    await save({ status: "confirmed" });
    const d = await send(
      "/api/creator/topics/" + selected.id + "/start",
      "POST"
    );
    window.location.assign("/compose?project=" + d.projectId);
  }
  return (
    <CreatorShell>
      <header className="creator-head">
        <div>
          <span className="creator-kicker">FIND YOUR NEXT STORY</span>
          <h1>先找到值得表达的事</h1>
          <p>把公开信源、自己的素材和创作方向，变成一份清晰的选题简报。</p>
        </div>
        <Link href="/library" className="creator-action">
          补充创作素材 ↗
        </Link>
      </header>
      <div className="creator-tabs">
        <button
          className={view === "topics" ? "active" : ""}
          onClick={() => setView("topics")}
        >
          单篇选题
        </button>
        <button
          className={view === "series" ? "active" : ""}
          onClick={() => setView("series")}
        >
          内容系列
        </button>
      </div>
      {notice && (
        <p role="status" className="creator-note">
          {notice}
        </p>
      )}
      {view === "topics" ? (
        <div className="creator-split">
          <section>
            <div className="creator-panel">
              <h2>下一个想法</h2>
              <form
                className="creator-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(async () => {
                    const t = await send("/api/creator/topics", "POST", {
                      title: newTitle,
                    });
                    setNewTitle("");
                    await load();
                    await open(t);
                  });
                }}
              >
                <input
                  aria-label="新选题标题"
                  placeholder="我想写……"
                  required
                  minLength={3}
                  maxLength={240}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                />
                <button className="primary" disabled={busy}>
                  记录选题
                </button>
              </form>
              <hr
                style={{
                  border: 0,
                  borderTop: "1px solid #edf0e9",
                  margin: "20px 0",
                }}
              />
              <details style={{ margin: "16px 0" }}>
                <summary>
                  选择推荐可使用的私有素材（{recommendIds.length}）
                </summary>
                <p className="creator-muted">
                  未选择的素材正文不会进入推荐模型。公开信源候选、文章标题和系列用于判断方向与重复。
                </p>
                <div
                  className="creator-stack"
                  style={{ maxHeight: 240, overflow: "auto" }}
                >
                  {library
                    .filter((a) => a.kind === "material")
                    .map((a) => (
                      <label className="check" key={a.id}>
                        <input
                          type="checkbox"
                          checked={recommendIds.includes(a.id)}
                          onChange={(e) =>
                            setRecommendIds(
                              e.target.checked
                                ? [...recommendIds, a.id]
                                : recommendIds.filter((id) => id !== a.id)
                            )
                          }
                        />
                        {a.title}
                        <small>{when(a.createdAt)}</small>
                      </label>
                    ))}
                </div>
              </details>
              <label className="check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                允许本次发送画像、历史标题、系列、选题反馈和选定素材（计入请求额度）
              </label>
              <div className="creator-row" style={{ marginTop: 12 }}>
                <button
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const r = await send(
                        "/api/creator/topics/recommend",
                        "POST",
                        {
                          useAI: false,
                          materialIds: recommendIds.length
                            ? recommendIds
                            : undefined,
                        }
                      );
                      setNotice(
                        r.topics.length
                          ? "已根据现有信源整理候选，请继续核实和讨论。"
                          : "暂无新候选，请先向资产库添加素材。"
                      );
                      await load();
                    })
                  }
                >
                  从现有素材发现
                </button>
                <button
                  disabled={busy || !consent}
                  onClick={() =>
                    act(async () => {
                      await send("/api/creator/topics/recommend", "POST", {
                        useAI: true,
                        allowExternalAI: true,
                        materialIds: recommendIds,
                      });
                      setConsent(false);
                      await load();
                    })
                  }
                >
                  AI 推荐选题
                </button>
              </div>
            </div>
            <div className="creator-panel">
              <h2>
                选题池 <span className="creator-badge">{topics.length}</span>
              </h2>
              {!topics.length && (
                <p className="creator-empty">
                  记录一个问题，开始讨论你的下一篇。
                </p>
              )}
              {topics.map((t) => (
                <article
                  key={t.id}
                  className={
                    "creator-card " + (selected?.id === t.id ? "selected" : "")
                  }
                >
                  <button
                    className="subtle"
                    onClick={() => act(() => open(t))}
                    style={{
                      textAlign: "left",
                      justifyContent: "flex-start",
                      padding: 0,
                    }}
                  >
                    <h3>
                      {t.favorite ? "☆ " : ""}
                      {t.title}
                    </h3>
                  </button>
                  <p>{t.angle}</p>
                  <p className="creator-muted">{t.reason}</p>
                  <small className="creator-muted">{when(t.createdAt)}</small>
                  <span className="creator-badge">{topicState[t.status]}</span>
                  {t.projectId && (
                    <Link
                      href={"/compose?project=" + t.projectId}
                      style={{ float: "right" }}
                    >
                      继续创作 →
                    </Link>
                  )}
                </article>
              ))}
            </div>
          </section>
          <section className="creator-panel">
            {!selected ? (
              <div className="creator-empty">
                选一个想法，和助手一起确定角度、大纲与素材。
              </div>
            ) : (
              <>
                <div className="creator-row spread">
                  <h2>选题简报 · v{selected.revision}</h2>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(() => save({ favorite: !selected.favorite }))
                    }
                  >
                    {selected.favorite ? "取消收藏" : "收藏选题"}
                  </button>
                </div>
                <div className="creator-stack">
                  {[
                    ["title", "选题标题"],
                    ["problem", "核心问题"],
                    ["angle", "核心角度"],
                    ["keyPoints", "核心观点与写作主张"],
                    ["evidenceGaps", "证据缺口与待核实事项"],
                    ["audience", "目标读者"],
                    ["outline", "文章大纲"],
                  ].map(([key, label]) => (
                    <label key={key}>
                      {label}
                      {key === "title" ? (
                        <input
                          value={selected[key] || ""}
                          onChange={(e) =>
                            setSelected({ ...selected, [key]: e.target.value })
                          }
                        />
                      ) : (
                        <textarea
                          aria-label={label}
                          rows={key === "outline" ? 6 : 2}
                          value={selected[key] || ""}
                          onChange={(e) =>
                            setSelected({ ...selected, [key]: e.target.value })
                          }
                        />
                      )}
                    </label>
                  ))}
                  <fieldset
                    style={{
                      border: "1px solid #e3e9db",
                      borderRadius: 8,
                      padding: 12,
                    }}
                  >
                    <legend>目标平台</legend>
                    <div className="creator-row">
                      {[
                        ["wechat", "微信公众号"],
                        ["zhihu", "知乎"],
                        ["xiaohongshu", "小红书"],
                      ].map(([id, label]) => (
                        <label className="check" key={id}>
                          <input
                            type="checkbox"
                            checked={selected.platforms?.includes(id) || false}
                            onChange={(e) =>
                              setSelected({
                                ...selected,
                                platforms: e.target.checked
                                  ? [...(selected.platforms || []), id]
                                  : (selected.platforms || []).filter(
                                      (p) => p !== id
                                    ),
                              })
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <details>
                    <summary>选择参考素材（{selected.refs.length}）</summary>
                    <div
                      className="creator-stack"
                      style={{
                        maxHeight: 220,
                        overflow: "auto",
                        paddingTop: 15,
                      }}
                    >
                      {library.map((a) => (
                        <label className="check" key={a.id}>
                          <input
                            type="checkbox"
                            checked={selected.refs.some((r) => r.id === a.id)}
                            onChange={(e) =>
                              setSelected({
                                ...selected,
                                refs: e.target.checked
                                  ? [
                                      ...selected.refs,
                                      { kind: a.kind, id: a.id },
                                    ]
                                  : selected.refs.filter((r) => r.id !== a.id),
                              })
                            }
                          />
                          {a.title} ·{" "}
                          {a.kind === "article"
                            ? "历史文章"
                            : a.kind === "image"
                            ? "图片"
                            : "素材"}
                        </label>
                      ))}
                    </div>
                  </details>
                  <label>
                    收藏或暂不创作的原因（可选）
                    <textarea
                      aria-label="选题反馈原因"
                      rows={2}
                      maxLength={2000}
                      value={feedbackReason}
                      onChange={(e) => setFeedbackReason(e.target.value)}
                    />
                  </label>
                  <div className="creator-row">
                    <button disabled={busy} onClick={() => act(() => save())}>
                      保存简报
                    </button>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => act(start)}
                    >
                      确认选题，开始写作 →
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => act(() => save({ status: "dismissed" }))}
                    >
                      暂不创作
                    </button>
                  </div>
                </div>
                <hr
                  style={{
                    border: 0,
                    borderTop: "1px solid #edf0e9",
                    margin: "25px 0",
                  }}
                />
                <button
                  disabled={busy}
                  onClick={() =>
                    act(async () =>
                      setHistory(
                        (
                          await api(
                            "/api/creator/topics/" + selected.id + "/history"
                          )
                        ).history
                      )
                    )
                  }
                >
                  查看简报版本
                </button>
                {history && (
                  <details open>
                    <summary>简报历史（恢复会创建新版本）</summary>
                    {history.map((h) => (
                      <article className="creator-card" key={h.revision}>
                        <strong>
                          v{h.revision} · {h.data.title}
                        </strong>
                        <pre className="creator-pre">
                          {[
                            h.data.problem,
                            h.data.keyPoints,
                            h.data.evidenceGaps,
                            h.data.outline,
                          ]
                            .filter(Boolean)
                            .join("\n\n")}
                        </pre>
                        <button
                          disabled={
                            busy ||
                            h.revision === selected.revision ||
                            briefDirty
                          }
                          onClick={() =>
                            act(() =>
                              save(
                                Object.fromEntries(
                                  [
                                    "title",
                                    "angle",
                                    "audience",
                                    "outline",
                                    "problem",
                                    "keyPoints",
                                    "evidenceGaps",
                                    "platforms",
                                    "refs",
                                  ]
                                    .filter((k) => h.data[k] !== undefined)
                                    .map((k) => [k, h.data[k]])
                                )
                              )
                            )
                          }
                        >
                          恢复简报为新版本
                        </button>
                      </article>
                    ))}
                  </details>
                )}
                <h2>一起把选题想清楚</h2>
                {messages.map((m) => (
                  <div className="creator-conversation" key={m.id}>
                    <small className="creator-muted">
                      {m.role === "user" ? "我" : "选题助手"}
                    </small>
                    <p>{m.content}</p>
                    {m.candidate && (
                      <>
                        <details>
                          <summary>查看建议简报</summary>
                          <pre className="creator-pre">
                            {m.candidate.title +
                              "\n\n" +
                              m.candidate.angle +
                              "\n\n" +
                              m.candidate.outline}
                          </pre>
                        </details>
                        <button
                          disabled={
                            busy ||
                            briefDirty ||
                            m.candidate.baseRevision !== selected.revision
                          }
                          onClick={() =>
                            act(async () => {
                              const t = await send(
                                "/api/creator/topics/" +
                                  selected.id +
                                  "/messages/" +
                                  m.id +
                                  "/accept",
                                "POST",
                                { expectedRevision: selected.revision }
                              );
                              setSelected(t);
                              setSelectedOrigin(t);
                              await load();
                            })
                          }
                        >
                          采纳这份简报
                        </button>
                      </>
                    )}
                  </div>
                ))}
                <form
                  className="creator-stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(async () => {
                      await save();
                      const result = await send(
                        "/api/creator/topics/" + selected.id + "/messages",
                        "POST",
                        { message, allowExternalAI: consent }
                      );
                      setMessages(result.messages);
                      setMessage("");
                      setConsent(false);
                    });
                  }}
                >
                  <textarea
                    aria-label="选题讨论"
                    value={message}
                    rows={3}
                    maxLength={4000}
                    minLength={2}
                    required
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="这个选题适合谁？能否从我的实践经历切入？"
                  />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                    />
                    允许本次向模型发送选题、所选素材与讨论内容
                  </label>
                  <button disabled={busy || !consent}>
                    {busy ? "正在处理…" : "发送讨论"}
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      ) : (
        <div className="creator-grid">
          <section>
            <div className="creator-panel">
              <h2>规划内容系列</h2>
              <form
                className="creator-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(async () => {
                    await send("/api/creator/series", "POST", {
                      ...seriesForm,
                      cadenceDays: Number(seriesForm.cadenceDays),
                      entries: seriesForm.entries
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    });
                    setNotice(
                      "系列已创建。服务端会在计划时间准备下一篇的选题、大纲与素材。"
                    );
                    await load();
                  });
                }}
              >
                {[
                  ["name", "系列名称"],
                  ["goal", "这个系列想帮助读者完成什么"],
                ].map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      required
                      minLength={2}
                      value={seriesForm[key]}
                      onChange={(e) =>
                        setSeriesForm({ ...seriesForm, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
                <div className="creator-two-col">
                  <label>
                    准备间隔（天）
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={seriesForm.cadenceDays}
                      onChange={(e) =>
                        setSeriesForm({
                          ...seriesForm,
                          cadenceDays: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    计划时区
                    <input
                      value={seriesForm.timezone}
                      onChange={(e) =>
                        setSeriesForm({
                          ...seriesForm,
                          timezone: e.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <label>
                  篇目标题（每行一篇，留空生成四个候选角度）
                  <textarea
                    rows={4}
                    value={seriesForm.entries}
                    onChange={(e) =>
                      setSeriesForm({ ...seriesForm, entries: e.target.value })
                    }
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={seriesForm.backgroundAI}
                    onChange={(e) =>
                      setSeriesForm({
                        ...seriesForm,
                        backgroundAI: e.target.checked,
                      })
                    }
                  />
                  授权这个系列按计划调用写作模型准备大纲，计入每日额度。可随时暂停。
                </label>
                <button className="primary" disabled={busy}>
                  创建系列计划
                </button>
              </form>
            </div>
            <div className="creator-panel">
              <h2>准备任务</h2>
              {jobs.length ? (
                jobs.slice(0, 12).map((j) => (
                  <div className="creator-card" key={j.id}>
                    <span className="creator-badge">
                      {{
                        queued: "等待准备",
                        running: "准备中",
                        completed: "已完成",
                        blocked: "需要处理",
                        cancelled: "已取消",
                        unknown: "中断，结果待核对",
                        reconciled: "已核对",
                      }[j.status] || j.status}
                    </span>
                    <p>
                      {j.detail || "等待服务端调度"} · {when(j.created_at)}
                    </p>
                    {j.summary?.service && (
                      <p className="creator-muted">
                        准备模型：{j.summary.service.name} ·{" "}
                        {j.summary.service.model}，本次最多{" "}
                        {j.summary.maxRequests} 次请求
                      </p>
                    )}
                    <CreatorJobReview
                      job={j}
                      disabled={busy}
                      onUpdated={load}
                      onNotice={setNotice}
                    />
                    {j.review && (
                      <p className="creator-muted">核对依据：{j.review.note}</p>
                    )}
                  </div>
                ))
              ) : (
                <p className="creator-muted">计划准备任务会保留执行记录。</p>
              )}
              <button onClick={() => act(load)} disabled={busy}>
                刷新任务状态
              </button>
            </div>
          </section>
          <section>
            {series.map((s) => (
              <div className="creator-panel" key={s.id}>
                <div className="creator-row spread">
                  <h2>{s.name}</h2>
                  <span className="creator-badge">
                    {
                      {
                        active: "进行中",
                        paused: "已暂停",
                        completed: "已结束",
                      }[s.status]
                    }
                  </span>
                </div>
                <p className="creator-muted">{s.goal}</p>
                <p className="creator-muted">
                  每 {s.cadenceDays} 天 · {s.timezone}
                  <br />
                  下次准备：{when(s.nextRunAt)}（北京时间）
                </p>
                <div className="creator-row">
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await send("/api/creator/series/" + s.id, "PUT", {
                          expectedRevision: s.revision,
                          status: s.status === "active" ? "paused" : "active",
                        });
                        await load();
                      })
                    }
                  >
                    {s.status === "active" ? "暂停计划" : "恢复计划"}
                  </button>
                  <button
                    disabled={busy || s.status !== "active"}
                    onClick={() =>
                      act(async () => {
                        await send(
                          "/api/creator/series/" + s.id + "/prepare",
                          "POST"
                        );
                        setNotice("已排入服务端准备队列，关闭页面后仍会执行。");
                        await load();
                      })
                    }
                  >
                    现在准备下一篇
                  </button>
                </div>
                <details style={{ marginTop: 20 }}>
                  <summary>调整系列计划</summary>
                  <form
                    className="creator-stack"
                    style={{ marginTop: 15 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const values = new FormData(e.currentTarget);
                      act(async () => {
                        const change = {
                          expectedRevision: s.revision,
                          name: String(values.get("name")),
                          goal: String(values.get("goal")),
                          cadenceDays: Number(values.get("cadenceDays")),
                          timezone: String(values.get("timezone")),
                          backgroundAI: values.get("backgroundAI") === "on",
                        };
                        if (values.get("nextRunAt"))
                          change.nextRunAt = new Date(
                            values.get("nextRunAt") + ":00+08:00"
                          ).toISOString();
                        await send(
                          "/api/creator/series/" + s.id,
                          "PUT",
                          change
                        );
                        await load();
                        setNotice("系列计划已更新。");
                      });
                    }}
                  >
                    <label>
                      名称
                      <input name="name" required defaultValue={s.name} />
                    </label>
                    <label>
                      目标
                      <textarea name="goal" required defaultValue={s.goal} />
                    </label>
                    <label>
                      准备间隔（天）
                      <input
                        name="cadenceDays"
                        type="number"
                        min={1}
                        max={365}
                        defaultValue={s.cadenceDays}
                      />
                    </label>
                    <label>
                      计划时区
                      <input name="timezone" defaultValue={s.timezone} />
                    </label>
                    <label>
                      下次准备时间（北京时间，可留空）
                      <input type="datetime-local" name="nextRunAt" />
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        name="backgroundAI"
                        defaultChecked={s.backgroundAI}
                      />
                      授权按计划调用模型准备大纲
                    </label>
                    <button disabled={busy}>保存系列调整</button>
                  </form>
                  <form
                    className="creator-row"
                    style={{ marginTop: 16 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const topicId = new FormData(e.currentTarget).get(
                        "topicId"
                      );
                      act(async () => {
                        await send(
                          "/api/creator/series/" + s.id + "/entries",
                          "PUT",
                          {
                            expectedRevision: s.revision,
                            topicIds: [
                              ...s.entries.map((e) => e.topic_id),
                              topicId,
                            ],
                          }
                        );
                        await load();
                      });
                    }}
                  >
                    <select name="topicId" required>
                      <option value="">从选题池添加一篇</option>
                      {topics
                        .filter(
                          (t) => !s.entries.some((e) => e.topic_id === t.id)
                        )
                        .map((t) => (
                          <option value={t.id} key={t.id}>
                            {t.title}
                          </option>
                        ))}
                    </select>
                    <button disabled={busy}>加入系列</button>
                  </form>
                  <button
                    style={{ marginTop: 14 }}
                    disabled={busy || s.status === "completed"}
                    onClick={() =>
                      act(async () => {
                        await send("/api/creator/series/" + s.id, "PUT", {
                          expectedRevision: s.revision,
                          status: "completed",
                        });
                        await load();
                      })
                    }
                  >
                    结束系列计划
                  </button>
                </details>
                {s.entries.map((entry, i) => (
                  <div className="creator-card" key={entry.id}>
                    <div className="creator-row spread">
                      <button
                        className="subtle"
                        onClick={() => {
                          setView("topics");
                          act(() => open(entry.topic));
                        }}
                      >
                        {i + 1}. {entry.topic.title}
                      </button>
                      <span className="creator-badge">
                        {{
                          pending: "待准备",
                          ready: "已准备",
                          writing: "写作中",
                          published: "作者报告已发表",
                        }[entry.status] || entry.status}
                      </span>
                    </div>
                    <div className="creator-row">
                      {entry.project_id && (
                        <Link href={"/compose?project=" + entry.project_id}>
                          继续写作 →
                        </Link>
                      )}
                      {i > 0 && (
                        <button
                          className="subtle"
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              const ids = s.entries.map((e) => e.topic_id);
                              [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                              await send(
                                "/api/creator/series/" + s.id + "/entries",
                                "PUT",
                                { expectedRevision: s.revision, topicIds: ids }
                              );
                              await load();
                            })
                          }
                        >
                          上移
                        </button>
                      )}
                      {!entry.project_id && (
                        <button
                          className="subtle"
                          disabled={busy || s.entries.length === 1}
                          onClick={() =>
                            act(async () => {
                              await send(
                                "/api/creator/series/" + s.id + "/entries",
                                "PUT",
                                {
                                  expectedRevision: s.revision,
                                  topicIds: s.entries
                                    .filter((e) => e.id !== entry.id)
                                    .map((e) => e.topic_id),
                                }
                              );
                              await load();
                            })
                          }
                        >
                          移出系列
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <p className="creator-muted">
                  后台准备选题、大纲与素材。完整正文、费用确认和发布由你决定。
                </p>
              </div>
            ))}
            {!series.length && (
              <p className="creator-empty">
                建立一个系列，让每一篇都有明确的创作脉络。
              </p>
            )}
          </section>
        </div>
      )}
    </CreatorShell>
  );
}

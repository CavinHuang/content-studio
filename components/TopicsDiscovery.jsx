'use client';
// Creator V2 topic discovery (/topics) — the real 选题发现 page.
// Visual form follows the approved design source
// public/design/creator-v2.2.html discoverView (:155) + the V2.2
// refinements (:172 step line, :175 banner + evidence grid), via
// app/creator-v2-topics.css. Data comes only from the real domain
// services: GET/POST /api/creator/topics, PUT /api/creator/topics/:id
// (expectedRevision conflict protection), POST /api/creator/topics/:id/
// start (idempotent project creation → /compose?project=…),
// POST /api/creator/topics/recommend, topic messages + accept, and
// GET /api/creator/{series,jobs,library,overview}.
//
// Page scope (implementation prompt P0-B): the editorial judgment card
// shows exactly 读者问题 / 写作角度 / 来源依据 / 证据缺口; 开始创作
// really creates (or reopens) the project and navigates to /compose;
// the complex full brief (audience/keyPoints/outline/platforms/refs/
// history) and batch recommendation live in collapsed areas; AI
// recommendation keeps explicit consent AND is disabled until a model
// service is configured (services.availability from /api/creator/
// overview). The pre-V2 page's series planner stays reachable from the
// page header (design has no series screen — registered deviation).
// List filtering (tabs/status/search-free) is derived in
// src/topics-discovery.mjs (unit-tested); no demo data, no mock
// success, honest empty/error states everywhere.
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import CreatorShell from "./CreatorShell";
import CreatorJobReview from "./CreatorJobReview";
import Icon from "./creator/Icon";
import {
  EmptyState,
  ErrorState,
  InlineStatus,
  PageHeader,
  Tag,
} from "./creator/primitives";
import { api, send, when } from "../lib/creator-client";
import {
  TOPIC_TABS,
  buildTopicsDiscovery,
  dayLabel,
  describeRefs,
  judgmentGaps,
  sourceLine,
  statusInfo,
} from "../src/topics-discovery.mjs";

const KIND_LABEL = { article: "历史文章", image: "图片" };
const kindLabel = (kind) => KIND_LABEL[kind] || "素材";
const PLATFORMS = [
  ["wechat", "微信公众号"],
  ["zhihu", "知乎"],
  ["xiaohongshu", "小红书"],
];
const ENTRY_STATUS = {
  pending: "待准备",
  ready: "已准备",
  writing: "写作中",
  published: "作者报告已发表",
};
const JOB_STATUS = {
  queued: "等待准备",
  running: "准备中",
  completed: "已完成",
  blocked: "需要处理",
  cancelled: "已取消",
  unknown: "中断，结果待核对",
  reconciled: "已核对",
};
const SERIES_STATUS = { active: "进行中", paused: "已暂停", completed: "已结束" };
// Fields restored from a history entry (same set the pre-V2 page used).
const HISTORY_FIELDS = [
  "title",
  "angle",
  "audience",
  "outline",
  "problem",
  "keyPoints",
  "evidenceGaps",
  "platforms",
  "refs",
];

function StepLine() {
  const steps = [
    ["/hotspots", "01 热点"],
    ["", "02 选题"],
    ["/compose", "03 创作"],
    ["/publish", "04 交付"],
    ["/insights", "05 复盘"],
  ];
  return (
    <div className="cv2-step-line">
      <span className="cv2-hint">内容生产主线</span>
      {steps.map(([href, label], i) => (
        <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
          {i ? (
            <span className="arrow" aria-hidden="true">
              →
            </span>
          ) : null}
          {href ? (
            <Link href={href} className={i === 1 ? "on" : ""}>
              {label}
            </Link>
          ) : (
            <b className={i === 1 ? "on" : ""}>{label}</b>
          )}
        </span>
      ))}
    </div>
  );
}

function JudgmentPanel({
  selected,
  origin,
  library,
  busy,
  feedbackReason,
  messageValue,
  discussConsent,
  messages,
  history,
  onPatch,
  onSave,
  onStart,
  onFavorite,
  onDismiss,
  onFeedbackReason,
  onMessageChange,
  onDiscussConsent,
  onLoadHistory,
  onRestore,
  onAccept,
  onSendMessage,
}) {
  if (!selected) {
    return (
      <aside className="cv2-surface cv2-surface-pad cv2-detail-panel" aria-label="选题判断">
        <div className="cv2-empty" style={{ border: 0, padding: "26px 8px" }}>
          <Icon name="compass" size={26} />
          <strong>选一个线索，打开编辑判断卡</strong>
          <p>
            判断卡回答四个问题：读者问题是什么、写作角度是否成立、来源依据在哪、
            还缺哪些证据。判断清楚了，「开始创作」才会把选题变成一篇真实作品。
          </p>
        </div>
      </aside>
    );
  }
  const refs = describeRefs(selected.refs, library);
  const gaps = judgmentGaps(selected);
  const dirty = JSON.stringify(selected) !== JSON.stringify(origin);
  return (
    <aside className="cv2-surface cv2-surface-pad cv2-detail-panel" aria-label="选题判断">
      <div className="cv2-hot-headrow" style={{ marginBottom: 4 }}>
        <span className="cv2-eyebrow" style={{ margin: 0 }}>
          EDITORIAL BRIEF · 选题判断
        </span>
        <span className="cv2-hot-tagrow">
          <Tag tone={statusInfo(selected).tone || "default"}>{statusInfo(selected).label}</Tag>
          <span className="cv2-micro">{dayLabel(selected.createdAt)}</span>
        </span>
      </div>
      <input
        className="cv2-detail-title-input"
        aria-label="选题标题"
        value={selected.title || ""}
        maxLength={240}
        minLength={3}
        onChange={(e) => onPatch({ title: e.target.value })}
      />
      {selected.reason ? (
        <p className="cv2-detail-note" style={{ margin: "0 0 4px", fontSize: 11, color: "#9699a4" }}>
          来源记录：{selected.reason}
        </p>
      ) : null}
      <h4 style={{ margin: "14px 0 0" }}>
        <span className="cv2-tag info">写作角度</span>
      </h4>
      <div className="cv2-detail-quote" data-empty={!String(selected.angle || "").trim()}>
        <textarea
          aria-label="写作角度"
          rows={2}
          value={selected.angle || ""}
          placeholder="这个选题区别于热点通稿的独特视角……"
          onChange={(e) => onPatch({ angle: e.target.value })}
        />
      </div>
      <h4>读者问题</h4>
      <div className="cv2-brief-field">
        <textarea
          aria-label="读者问题"
          rows={3}
          value={selected.problem || ""}
          placeholder="这篇文章帮谁理解、判断或解决什么？不要为了追热点硬写。"
          onChange={(e) => onPatch({ problem: e.target.value })}
        />
      </div>
      <h4>来源依据</h4>
      {refs.length ? (
        <ul className="cv2-refs-list" style={{ paddingLeft: 0 }}>
          {refs.map((r) => (
            <li key={r.key}>
              <span className="cv2-ref-kind">{r.kindLabel}</span>
              {r.unavailable ? (
                <span className="cv2-ref-unavailable">来源已不可用（可能在素材库中被移除）</span>
              ) : (
                <span>{r.title || "未命名素材"}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="cv2-detail-note" style={{ margin: "4px 0 0" }}>
          尚未关联素材；在下方「完整简报与版本历史」中选择参考素材，来源会随简报一起保存。
        </p>
      )}
      <h4>证据缺口</h4>
      <div className="cv2-brief-field">
        <textarea
          aria-label="证据缺口"
          rows={3}
          value={selected.evidenceGaps || ""}
          placeholder="哪些判断还缺可核对的来源？写下来，动笔前逐项补齐。"
          onChange={(e) => onPatch({ evidenceGaps: e.target.value })}
        />
      </div>
      {gaps.length ? (
        <p className="cv2-judgment-hint" role="note">
          判断还不完整：缺{gaps.join("、")}。动笔前先补齐，或先收藏观察，不自动制造结论。
        </p>
      ) : null}
      <div className="cv2-detail-actions">
        <div className="cv2-detail-actions-row">
          <button type="button" className="cv2-btn" disabled={busy} onClick={onSave}>
            保存简报
          </button>
          <button type="button" className="cv2-btn" disabled={busy} onClick={onFavorite}>
            {selected.favorite ? "取消收藏" : "收藏选题"}
          </button>
        </div>
        <button type="button" className="cv2-btn primary" disabled={busy} onClick={onStart}>
          围绕这个选题开始写作 <Icon name="arrow" size={16} />
        </button>
        {selected.projectId ? (
          <Link className="cv2-btn ghost" href={"/compose?project=" + encodeURIComponent(selected.projectId)}>
            继续创作（已有作品） <Icon name="arrow" size={14} />
          </Link>
        ) : null}
      </div>
      <label style={{ display: "grid", gap: 6, marginTop: 13 }}>
        <span style={{ fontWeight: 650, fontSize: 12, color: "#4a5568" }}>收藏或暂不创作的原因（可选）</span>
        <textarea
          aria-label="选题反馈原因"
          rows={2}
          maxLength={2000}
          style={{
            display: "block",
            width: "100%",
            fontSize: 12,
            lineHeight: 1.7,
            color: "#373c4b",
            background: "var(--cv2-surface)",
            border: "1px solid #e0e3e9",
            borderRadius: 9,
            padding: "9px 11px",
            resize: "vertical",
          }}
          value={feedbackReason}
          onChange={(e) => onFeedbackReason(e.target.value)}
        />
      </label>

      {/* 复杂简报折叠区：目标读者/观点/大纲/平台/参考素材/版本历史 */}
      <details className="cv2-detail-details">
        <summary>
          完整简报与版本历史
          <Icon name="chevron" size={14} />
        </summary>
        <div className="cv2-detail-details-body">
          <label>
            目标读者
            <textarea
              aria-label="目标读者"
              rows={2}
              value={selected.audience || ""}
              onChange={(e) => onPatch({ audience: e.target.value })}
            />
          </label>
          <label>
            核心观点与写作主张
            <textarea
              aria-label="核心观点与写作主张"
              rows={3}
              value={selected.keyPoints || ""}
              onChange={(e) => onPatch({ keyPoints: e.target.value })}
            />
          </label>
          <label>
            文章大纲
            <textarea
              aria-label="文章大纲"
              rows={5}
              value={selected.outline || ""}
              onChange={(e) => onPatch({ outline: e.target.value })}
            />
          </label>
          <fieldset style={{ border: "1px solid var(--cv2-border)", borderRadius: 9, padding: 12, margin: 0 }}>
            <legend style={{ fontSize: 12, fontWeight: 650, color: "#4a5568", padding: "0 6px" }}>目标平台</legend>
            <div className="cv2-chips">
              {PLATFORMS.map(([id, label]) => (
                <label className="cv2-checkline" key={id}>
                  <input
                    type="checkbox"
                    aria-label={label}
                    checked={selected.platforms?.includes(id) || false}
                    onChange={(e) =>
                      onPatch({
                        platforms: e.target.checked
                          ? [...(selected.platforms || []), id]
                          : (selected.platforms || []).filter((p) => p !== id),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 650, color: "#4a5568" }}>
              选择参考素材（{selected.refs?.length || 0}）
            </summary>
            <div className="cv2-refpicker">
              {library.length ? (
                library.map((a) => (
                  <label className="cv2-checkline" key={a.id}>
                    <input
                      type="checkbox"
                      aria-label={`${a.title} · ${kindLabel(a.kind)}`}
                      checked={(selected.refs || []).some((r) => r.id === a.id)}
                      onChange={(e) =>
                        onPatch({
                          refs: e.target.checked
                            ? [...(selected.refs || []), { kind: a.kind, id: a.id }]
                            : (selected.refs || []).filter((r) => r.id !== a.id),
                        })
                      }
                    />
                    {a.title} · {kindLabel(a.kind)}
                  </label>
                ))
              ) : (
                <p className="cv2-micro" style={{ margin: 0 }}>
                  素材库还是空的；先在素材库保存笔记或从热点雷达转入线索。
                </p>
              )}
            </div>
          </details>
          <div className="cv2-recommend-actions">
            <button type="button" className="cv2-btn tiny" disabled={busy} onClick={onDismiss}>
              暂不创作
            </button>
            <button type="button" className="cv2-btn tiny" disabled={busy} onClick={onLoadHistory}>
              查看简报版本
            </button>
          </div>
          {selected.projectId ? (
            <p className="cv2-micro" style={{ margin: 0 }}>
              这个选题已关联作品，写作中；「开始创作」会打开同一篇，不会重复建档。
            </p>
          ) : null}
          {history ? (
            <details open>
              <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 650, color: "#4a5568" }}>
                简报历史（恢复会创建新版本）
              </summary>
              <div style={{ display: "grid", gap: 10, paddingTop: 10 }}>
                {history.map((h) => (
                  <article className="cv2-history-item" key={h.revision}>
                    <strong>
                      v{h.revision} · {h.data.title}
                    </strong>
                    <pre>
                      {[h.data.problem, h.data.keyPoints, h.data.evidenceGaps, h.data.outline]
                        .filter(Boolean)
                        .join("\n\n")}
                    </pre>
                    <button
                      type="button"
                      className="cv2-btn tiny"
                      disabled={busy || h.revision === selected.revision || dirty}
                      onClick={() => onRestore(h)}
                    >
                      恢复简报为新版本
                    </button>
                  </article>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </details>

      {/* 讨论折叠区：消息与建议简报采纳 */}
      <details className="cv2-detail-details">
        <summary>
          与选题助手讨论
          <Icon name="chevron" size={14} />
        </summary>
        <div className="cv2-detail-details-body">
          {messages.length ? (
            <div className="cv2-conversation">
              {messages.map((m) => (
                <div key={m.id}>
                  <small>{m.role === "user" ? "我" : "选题助手"}</small>
                  <p>{m.content}</p>
                  {m.candidate ? (
                    <>
                      <details>
                        <summary style={{ cursor: "pointer", fontSize: 11, color: "#5066d6" }}>
                          查看建议简报
                        </summary>
                        <pre>{m.candidate.title + "\n\n" + m.candidate.angle + "\n\n" + m.candidate.outline}</pre>
                      </details>
                      <button
                        type="button"
                        className="cv2-btn tiny"
                        style={{ marginTop: 8 }}
                        disabled={busy || dirty || m.candidate.baseRevision !== selected.revision}
                        onClick={() => onAccept(m)}
                      >
                        采纳这份简报
                      </button>
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="cv2-recommend-hint">
              还没有讨论记录。提出「这个选题适合谁」「能否从我的实践切入」这类问题，助手会给出可采纳的建议简报；
              发送前需要确认下方授权。
            </p>
          )}
          <form
            style={{ display: "grid", gap: 11 }}
            onSubmit={(e) => {
              e.preventDefault();
              onSendMessage();
            }}
          >
            <textarea
              aria-label="选题讨论"
              value={messageValue}
              rows={3}
              maxLength={4000}
              minLength={2}
              required
              placeholder="这个选题适合谁？能否从我的实践经历切入？"
              onChange={(e) => onMessageChange(e.target.value)}
            />
            <label className="cv2-checkline">
              <input type="checkbox" checked={!!discussConsent} onChange={(e) => onDiscussConsent(e.target.checked)} />
              允许本次向模型发送选题、所选素材与讨论内容
            </label>
            <button type="submit" className="cv2-btn" disabled={busy || !discussConsent}>
              {busy ? "正在处理…" : "发送讨论"}
            </button>
          </form>
        </div>
      </details>
      <p className="cv2-detail-footnote">
        判断与简报的每次保存都是不可变版本；「开始创作」会创建或打开同一篇作品，不会自动写作、不会发布。
      </p>
    </aside>
  );
}

export default function TopicsDiscovery() {
  const query = useSearchParams();
  const [view, setView] = useState(query.get("view") === "series" ? "series" : "topics");
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [topics, setTopics] = useState(null);
  const [series, setSeries] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [library, setLibrary] = useState([]);
  const [aiReady, setAiReady] = useState(null); // null = unknown until overview returns
  const [selected, setSelected] = useState(null);
  const [selectedOrigin, setSelectedOrigin] = useState(null);
  const [history, setHistory] = useState(null);
  const [messages, setMessages] = useState([]);
  const [feedbackReason, setFeedbackReason] = useState("");
  const [message, setMessage] = useState("");
  const [discussConsent, setDiscussConsent] = useState(false);
  const [consent, setConsent] = useState(false); // batch-recommend consent
  const [recommendIds, setRecommendIds] = useState([]);
  const [tab, setTab] = useState("recommended");
  const [status, setStatus] = useState("all");
  const [newTitle, setNewTitle] = useState("");
  const [seriesForm, setSeriesForm] = useState({
    name: "",
    goal: "",
    cadenceDays: 7,
    timezone: "Asia/Shanghai",
    entries: "",
    backgroundAI: false,
  });
  const [notice, setNotice] = useState(null); // {tone,text,busy}
  const [busy, setBusy] = useState(false);

  async function load(initial = false) {
    const [t, s, l, j, ov] = await Promise.all([
      api("/api/creator/topics"),
      api("/api/creator/series"),
      api("/api/creator/library"),
      api("/api/creator/jobs"),
      api("/api/creator/overview"),
    ]);
    setTopics(t.topics);
    setSeries(s.series);
    setLibrary(l.assets);
    setJobs(j.jobs);
    // 服务配置前置：overview.services.text 来自真实的模型连接配置
    setAiReady(!!ov.services?.text);
    const seriesDeepLink = query.get("series") || query.get("view") === "series";
    if (initial && seriesDeepLink) setView("series");
    if (initial && query.get("topic")) {
      const found = t.topics.find((x) => x.id === query.get("topic"));
      if (found) await open(found);
    } else if (
      initial &&
      !seriesDeepLink &&
      t.topics.length
    ) {
      // 设计构图（design/topics-desktop.png）：进入页面即预选第一条线索、
      // 判断面板已填充。选中是纯视图状态——面板内容仍全部来自真实 API。
      const first =
        buildTopicsDiscovery({ topics: t.topics, tab: "recommended", library: l.assets }).rows[0] ||
        t.topics[0];
      await open(first);
    }
    setReady(true);
  }

  async function open(t) {
    setSelected(t);
    setSelectedOrigin(t);
    setHistory(null);
    setFeedbackReason("");
    setMessages((await api("/api/creator/topics/" + t.id + "/messages")).messages);
  }

  useEffect(() => {
    load(true).catch((e) => {
      setLoadError(e);
      setReady(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(fn) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice({
        tone: "error",
        text:
          e?.status === 409
            ? (e.message || "内容已变化") + "：点击列表中的这条线索重新载入最新版本，再重做一次保存。"
            : e.message || "操作未完成",
      });
    } finally {
      setBusy(false);
    }
  }

  async function save(patch = {}) {
    // 只清空"随本次请求提交的原因"；保存期间用户新输入的文本不能被回写吞掉。
    const sentReason = feedbackReason;
    const t = await send("/api/creator/topics/" + selected.id, "PUT", {
      ...selected,
      ...patch,
      feedbackReason: sentReason,
      expectedRevision: selected.revision,
    });
    setSelected(t);
    setSelectedOrigin(t);
    setHistory(null);
    setFeedbackReason((current) => (current === sentReason ? "" : current));
    await load();
    return t;
  }

  function patch(next) {
    setSelected((cur) => (cur ? { ...cur, ...next } : cur));
  }

  function recordTopic(e) {
    e.preventDefault();
    act(async () => {
      const t = await send("/api/creator/topics", "POST", { title: newTitle });
      setNewTitle("");
      setTab("all"); // 手动记录的线索 provenance 是「作者提出」，在全部线索中可见
      await load();
      await open(t);
    });
  }

  function start() {
    act(async () => {
      await save({ status: "confirmed" });
      const d = await send("/api/creator/topics/" + selected.id + "/start", "POST");
      window.location.assign("/compose?project=" + d.projectId);
    });
  }

  function toggleCardFavorite(t) {
    act(async () => {
      if (selected?.id === t.id && JSON.stringify(selected) !== JSON.stringify(selectedOrigin)) {
        setNotice({ tone: "warning", text: "这条线索有未保存的修改，请先「保存简报」再收藏。" });
        return;
      }
      await send("/api/creator/topics/" + t.id, "PUT", {
        favorite: !t.favorite,
        expectedRevision: t.revision,
      });
      await load();
    });
  }

  function recommend(useAI) {
    act(async () => {
      if (useAI) {
        await send("/api/creator/topics/recommend", "POST", {
          useAI: true,
          allowExternalAI: true,
          materialIds: recommendIds,
        });
        setConsent(false);
        await load();
        setNotice({ tone: "info", text: "模型候选已进入列表（为我推荐）；判断与核实仍由你完成。" });
      } else {
        const r = await send("/api/creator/topics/recommend", "POST", {
          useAI: false,
          materialIds: recommendIds.length ? recommendIds : undefined,
        });
        setNotice(
          r.topics.length
            ? { tone: "success", text: "已根据现有素材与信源整理候选，请继续核实和讨论。" }
            : { tone: "info", text: "暂无新候选，请先向素材库添加素材。" }
        );
        await load();
      }
    });
  }

  function sendMessage() {
    act(async () => {
      await save();
      const result = await send("/api/creator/topics/" + selected.id + "/messages", "POST", {
        message,
        allowExternalAI: discussConsent,
      });
      setMessages(result.messages);
      setMessage("");
      setDiscussConsent(false);
    });
  }

  async function acceptMessage(m) {
    act(async () => {
      const t = await send(
        "/api/creator/topics/" + selected.id + "/messages/" + m.id + "/accept",
        "POST",
        { expectedRevision: selected.revision }
      );
      setSelected(t);
      setSelectedOrigin(t);
      await load();
    });
  }

  function restoreHistory(h) {
    act(() =>
      save(
        Object.fromEntries(
          HISTORY_FIELDS.filter((k) => h.data[k] !== undefined).map((k) => [k, h.data[k]])
        )
      )
    );
  }

  // ---------- series view handlers（保留既有真实能力，标签不变） ----------
  function createSeries(e) {
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
      setNotice({ tone: "success", text: "系列已创建。服务端会在计划时间准备下一篇的选题、大纲与素材。" });
      await load();
    });
  }
  function seriesAction(fn, done) {
    act(async () => {
      await fn();
      if (done) setNotice({ tone: "info", text: done });
      await load();
    });
  }

  const discovery = topics
    ? buildTopicsDiscovery({ topics, tab, status, library })
    : null;
  const dirty = !!selected && JSON.stringify(selected) !== JSON.stringify(selectedOrigin);

  return (
    <CreatorShell>
      <StepLine />
      {/* banner — .v2-banner (creator-v2.2.html:175) */}
      <div className="cv2-banner">
        <div>
          <span className="cv2-pill">从线索到选题</span>
          <h3>现在最需要决定：值不值得写？</h3>
          <p>把内容热度、读者问题和可核实的证据分开看。右侧简报不是表格任务，而是准备写作时的决策依据。</p>
        </div>
        <Link className="cv2-btn" href="/hotspots">
          查看全部热点 <Icon name="arrow" size={14} />
        </Link>
      </div>
      <PageHeader
        eyebrow="DISCOVER / RESEARCH"
        title="选题发现"
        description="把已收集的热点和素材变成值得写的文章：看价值、核对来源、选择角度。"
        actions={
          view === "topics" ? (
            <>
              <button type="button" className="cv2-btn" onClick={() => setView("series")}>
                <Icon name="calendar" size={16} /> <span>内容系列</span>
              </button>
              <Link className="cv2-btn" href="/hotspots">
                <Icon name="flame" size={16} /> <span>查看热点雷达</span>
              </Link>
            </>
          ) : (
            <button type="button" className="cv2-btn" onClick={() => setView("topics")}>
              <Icon name="compass" size={16} /> <span>返回选题线索</span>
            </button>
          )
        }
      />

      {loadError ? (
        <ErrorState title="选题发现加载失败" error={loadError} hint="检查本地服务是否在运行，然后重试。" onRetry={() => {
          setLoadError(null);
          load().catch((e) => setLoadError(e));
        }} />
      ) : null}
      {!ready && !loadError ? <InlineStatus busy tone="info">正在打开选题发现…</InlineStatus> : null}
      {notice ? (
        <p className={"cv2-status is-" + (notice.tone || "info")} role="status" aria-busy={notice.busy || undefined}>
          <span className="cv2-status-dot" aria-hidden="true" />
          <span>{notice.text}</span>
        </p>
      ) : null}

      {ready && !loadError && view === "topics" ? (
        <>
          {/* tabbar — 设计 tabbar（为我推荐/全部线索/已收藏） */}
          <div className="cv2-tabbar" role="group" aria-label="选题列表筛选">
            {TOPIC_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={"cv2-tab" + (tab === t.key ? " active" : "")}
                aria-pressed={tab === t.key}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* 状态筛选 chips：设计原稿的主题分类无后端字段，改为真实选题状态（偏差 #2） */}
          <div className="cv2-filter-row">
            <div className="cv2-chips" role="group" aria-label="按状态筛选">
              {[["all", "全部状态"], ["draft", "待讨论"], ["prepared", "大纲已准备"], ["confirmed", "已确认"], ["writing", "写作中"], ["dismissed", "暂不创作"]].map(
                ([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className="cv2-chip"
                    aria-pressed={status === key}
                    onClick={() => setStatus(key)}
                  >
                    {label}
                  </button>
                )
              )}
            </div>
            <span className="cv2-filter-note">线索来自信源转换、素材推荐与手动记录 · 点击卡片查看判断</span>
          </div>

          {/* 批量推荐折叠区（ask：批量推荐放折叠区；AI 推荐保留用户确认与服务配置前置） */}
          <details className="cv2-surface cv2-recommend-box">
            <summary>
              <Icon name="spark" size={15} />
              批量推荐：从素材与模型获取候选
              <Icon name="chevron" size={14} />
            </summary>
            <div className="cv2-recommend-body">
              <p className="cv2-recommend-intro">
                「从现有素材发现」只使用本地已有的素材与公开信源记录，不调用模型；
                「AI 推荐选题」会把画像、历史标题、系列与选题反馈发送给已配置的写作模型，计入请求额度。
              </p>
              <details>
                <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 650, color: "#4a5568" }}>
                  选择推荐可使用的私有素材（{recommendIds.length}）
                </summary>
                <div className="cv2-recommend-pick" style={{ paddingTop: 10 }}>
                  {library.filter((a) => a.kind === "material").length ? (
                    library
                      .filter((a) => a.kind === "material")
                      .map((a) => (
                        <label className="cv2-checkline" key={a.id}>
                          <input
                            type="checkbox"
                            aria-label={`${a.title}（素材）`}
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
                          <small className="cv2-micro">{when(a.createdAt)}</small>
                        </label>
                      ))
                  ) : (
                    <p className="cv2-micro" style={{ margin: 0 }}>
                      素材库还没有素材；未选择的素材正文不会进入推荐模型。
                    </p>
                  )}
                </div>
              </details>
              <p className="cv2-recommend-hint">
                未选择的素材正文不会进入推荐模型。公开信源候选、文章标题和系列用于判断方向与重复。
              </p>
              {aiReady === false ? (
                <p className="cv2-recommend-hint" style={{ color: "#a86a2f" }}>
                  未检测到已配置的写作模型：AI 推荐暂不可用。可先在
                  <Link href="/settings" style={{ color: "#5066d6" }}>
                    偏好与连接
                  </Link>
                  配置模型连接，或使用「从现有素材发现」（不发送外部请求）。
                </p>
              ) : null}
              <div className="cv2-recommend-actions">
                <button type="button" className="cv2-btn" disabled={busy} onClick={() => recommend(false)}>
                  从现有素材发现
                </button>
                <button type="button" className="cv2-btn" disabled={busy || !consent || !aiReady} onClick={() => recommend(true)}>
                  AI 推荐选题
                </button>
                <label className="cv2-checkline">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  允许本次发送画像、历史标题、系列、选题反馈和选定素材（计入请求额度）
                </label>
              </div>
            </div>
          </details>

          {/* 记录选题 — 保留既有真实能力（POST /api/creator/topics），设计原稿无此入口
              （偏差 #3）；放在列表分支之外，空状态时也能记录第一个选题 */}
          <form className="cv2-record-strip" onSubmit={recordTopic}>
            <label className="cv2-record-input">
              <Icon name="edit" size={15} />
              <input
                aria-label="新选题标题"
                placeholder="我想写……"
                required
                minLength={3}
                maxLength={240}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </label>
            <button type="submit" className="cv2-btn tiny primary" disabled={busy}>
              记录选题
            </button>
          </form>

          {!discovery || discovery.counts.all === 0 ? (
            <EmptyState
              icon="compass"
              title="还没有选题线索"
              hint="在上方记录一个问题，或展开「批量推荐」从素材与信源获取候选；热点雷达转入的线索也会出现在这里。"
              action={
                <Link className="cv2-btn primary" href="/hotspots">
                  去热点雷达找线索
                </Link>
              }
            />
          ) : (
            <div className="cv2-discovery-grid">
              <section>
                {discovery.rows.length ? (
                  discovery.rows.map((t) => {
                    const info = statusInfo(t);
                    const summary = t.problem || t.angle || t.reason || "";
                    return (
                      <article
                        key={t.id}
                        className={"cv2-story-card" + (selected?.id === t.id ? " selected" : "")}
                      >
                        <div className="cv2-story-top">
                          <Tag tone={info.tone || "default"}>{info.label}</Tag>
                          <span className="cv2-micro">{dayLabel(t.createdAt)}</span>
                        </div>
                        <button type="button" className="cv2-story-title" disabled={busy} onClick={() => act(() => open(t))}>
                          {t.favorite ? "☆ " : ""}
                          {t.title}
                        </button>
                        {summary ? <p className="cv2-story-desc">{summary}</p> : null}
                        <div className="cv2-story-bottom">
                          <span className="cv2-source-line">{sourceLine(t, library)}</span>
                          <span className="cv2-chips">
                            {t.projectId ? (
                              <Link className="cv2-btn tiny" href={"/compose?project=" + encodeURIComponent(t.projectId)}>
                                继续创作
                              </Link>
                            ) : null}
                            <button type="button" className="cv2-btn tiny" disabled={busy} onClick={() => toggleCardFavorite(t)}>
                              <Icon name="bookmark" size={13} /> {t.favorite ? "已收藏" : "收藏"}
                            </button>
                            <button type="button" className="cv2-btn tiny primary" disabled={busy} onClick={() => act(() => open(t))}>
                              查看判断 <Icon name="arrow" size={13} />
                            </button>
                          </span>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <div className="cv2-tplist-empty">
                    这里暂时没有线索。试试其他标签或状态筛选，也可以返回「为我推荐」。
                  </div>
                )}
              </section>

              <JudgmentPanel
                selected={selected}
                origin={selectedOrigin}
                library={library}
                busy={busy}
                feedbackReason={feedbackReason}
                messages={messages}
                history={history}
                onPatch={patch}
                onSave={() => act(() => save())}
                onStart={start}
                onFavorite={() => act(() => save({ favorite: !selected.favorite }))}
                onDismiss={() => act(() => save({ status: "dismissed" }))}
                onFeedbackReason={setFeedbackReason}
                messageValue={message}
                onMessageChange={setMessage}
                onLoadHistory={() =>
                  act(async () =>
                    setHistory((await api("/api/creator/topics/" + selected.id + "/history")).history)
                  )
                }
                onRestore={restoreHistory}
                onAccept={acceptMessage}
                discussConsent={discussConsent}
                onDiscussConsent={setDiscussConsent}
                onSendMessage={sendMessage}
              />
            </div>
          )}

          {/* 证据卡 — .v2-evidence-grid（creator-v2.2.html:175，原样保留的编辑原则） */}
          <div className="cv2-evidence-grid">
            <article>
              <span className="cv2-n">01 / NEED</span>
              <h4>真实读者问题</h4>
              <p>写之前问：这篇文章具体帮谁理解、判断或解决什么？不要为了追热点硬写。</p>
            </article>
            <article>
              <span className="cv2-n">02 / EVIDENCE</span>
              <h4>证据与来源账本</h4>
              <p>数据、引述、产品能力必须能追溯原始来源；推断和个人观点明确分层。</p>
            </article>
            <article>
              <span className="cv2-n">03 / GO / NO GO</span>
              <h4>动笔门槛</h4>
              <p>角度成立且证据可补，进入创作。信息不充分时收藏观察，不自动制造结论。</p>
            </article>
          </div>
        </>
      ) : null}

      {ready && !loadError && view === "series" ? (
        <div className="cv2-series-grid">
          <section className="cv2-series-col">
            <section className="cv2-surface cv2-surface-pad">
              <div className="cv2-section-top">
                <div>
                  <h3>规划内容系列</h3>
                  <p>服务端按计划准备下一篇的选题、大纲与素材；正文、费用与发布仍由你决定</p>
                </div>
              </div>
              <form className="cv2-series-form" onSubmit={createSeries}>
                <label>
                  系列名称
                  <input
                    required
                    minLength={2}
                    value={seriesForm.name}
                    onChange={(e) => setSeriesForm({ ...seriesForm, name: e.target.value })}
                  />
                </label>
                <label>
                  这个系列想帮助读者完成什么
                  <textarea
                    rows={2}
                    required
                    minLength={2}
                    value={seriesForm.goal}
                    onChange={(e) => setSeriesForm({ ...seriesForm, goal: e.target.value })}
                  />
                </label>
                <div className="cv2-series-two">
                  <label>
                    准备间隔（天）
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={seriesForm.cadenceDays}
                      onChange={(e) => setSeriesForm({ ...seriesForm, cadenceDays: e.target.value })}
                    />
                  </label>
                  <label>
                    计划时区
                    <input
                      value={seriesForm.timezone}
                      onChange={(e) => setSeriesForm({ ...seriesForm, timezone: e.target.value })}
                    />
                  </label>
                </div>
                <label>
                  篇目标题（每行一篇，留空生成四个候选角度）
                  <textarea
                    rows={4}
                    value={seriesForm.entries}
                    onChange={(e) => setSeriesForm({ ...seriesForm, entries: e.target.value })}
                  />
                </label>
                <label className="cv2-checkline">
                  <input
                    type="checkbox"
                    checked={seriesForm.backgroundAI}
                    onChange={(e) => setSeriesForm({ ...seriesForm, backgroundAI: e.target.checked })}
                  />
                  授权这个系列按计划调用写作模型准备大纲，计入每日额度。可随时暂停。
                </label>
                <button type="submit" className="cv2-btn primary" disabled={busy} style={{ justifySelf: "start" }}>
                  创建系列计划
                </button>
              </form>
            </section>
            <section className="cv2-surface cv2-surface-pad">
              <div className="cv2-section-top">
                <div>
                  <h3>准备任务</h3>
                  <p>计划准备任务会保留执行记录；被阻塞的任务需要你核对后才能重试</p>
                </div>
                <button type="button" className="cv2-btn tiny" disabled={busy} onClick={() => seriesAction(load)}>
                  刷新任务状态
                </button>
              </div>
              {jobs.length ? (
                jobs.slice(0, 12).map((j) => (
                  <div className="cv2-series-jobrow" key={j.id}>
                    <div>
                      <Tag tone={j.status === "blocked" ? "warning" : j.status === "completed" ? "success" : "info"}>
                        {JOB_STATUS[j.status] || j.status}
                      </Tag>
                    </div>
                    <p className="cv2-micro" style={{ margin: 0 }}>
                      {j.detail || "等待服务端调度"} · {when(j.created_at)}
                    </p>
                    {j.summary?.service ? (
                      <p className="cv2-micro" style={{ margin: 0 }}>
                        准备模型：{j.summary.service.name} · {j.summary.service.model}，本次最多 {j.summary.maxRequests}{" "}
                        次请求
                      </p>
                    ) : null}
                    <CreatorJobReview job={j} disabled={busy} onUpdated={load} onNotice={(text) => setNotice({ tone: "info", text })} />
                    {j.review ? <p className="cv2-micro">核对依据：{j.review.note}</p> : null}
                  </div>
                ))
              ) : (
                <p className="cv2-micro">计划准备任务会保留执行记录。</p>
              )}
            </section>
          </section>
          <section className="cv2-series-col">
            {series.map((s) => (
              <section className="cv2-surface cv2-surface-pad" key={s.id}>
                <div className="cv2-series-headrow">
                  <h3 style={{ margin: 0, fontSize: 15, color: "var(--cv2-text)" }}>{s.name}</h3>
                  <Tag tone={s.status === "active" ? "info" : "default"}>{SERIES_STATUS[s.status] || s.status}</Tag>
                </div>
                <p className="cv2-micro" style={{ margin: 0 }}>
                  {s.goal}
                </p>
                <p className="cv2-micro" style={{ margin: 0 }}>
                  每 {s.cadenceDays} 天 · {s.timezone}
                  <br />
                  下次准备：{when(s.nextRunAt)}（北京时间）
                </p>
                <div className="cv2-chips">
                  <button
                    type="button"
                    className="cv2-btn tiny"
                    disabled={busy}
                    onClick={() =>
                      seriesAction(() =>
                        send("/api/creator/series/" + s.id, "PUT", {
                          expectedRevision: s.revision,
                          status: s.status === "active" ? "paused" : "active",
                        })
                      )
                    }
                  >
                    {s.status === "active" ? "暂停计划" : "恢复计划"}
                  </button>
                  <button
                    type="button"
                    className="cv2-btn tiny"
                    disabled={busy || s.status !== "active"}
                    onClick={() =>
                      seriesAction(() => send("/api/creator/series/" + s.id + "/prepare", "POST"), "已排入服务端准备队列，关闭页面后仍会执行。")
                    }
                  >
                    现在准备下一篇
                  </button>
                </div>
                <details>
                  <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 650, color: "#4a5568" }}>
                    调整系列计划
                  </summary>
                  <form
                    className="cv2-series-form"
                    style={{ marginTop: 13 }}
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
                          change.nextRunAt = new Date(values.get("nextRunAt") + ":00+08:00").toISOString();
                        await send("/api/creator/series/" + s.id, "PUT", change);
                        await load();
                        setNotice({ tone: "success", text: "系列计划已更新。" });
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
                      <input name="cadenceDays" type="number" min={1} max={365} defaultValue={s.cadenceDays} />
                    </label>
                    <label>
                      计划时区
                      <input name="timezone" defaultValue={s.timezone} />
                    </label>
                    <label>
                      下次准备时间（北京时间，可留空）
                      <input type="datetime-local" name="nextRunAt" />
                    </label>
                    <label className="cv2-checkline">
                      <input type="checkbox" name="backgroundAI" defaultChecked={s.backgroundAI} />
                      授权按计划调用模型准备大纲
                    </label>
                    <button type="submit" className="cv2-btn" disabled={busy} style={{ justifySelf: "start" }}>
                      保存系列调整
                    </button>
                  </form>
                  <form
                    className="cv2-recommend-actions"
                    style={{ marginTop: 14 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const topicId = new FormData(e.currentTarget).get("topicId");
                      act(async () => {
                        await send("/api/creator/series/" + s.id + "/entries", "PUT", {
                          expectedRevision: s.revision,
                          topicIds: [...s.entries.map((e) => e.topic_id), topicId],
                        });
                        await load();
                      });
                    }}
                  >
                    <select name="topicId" required aria-label="从选题池添加一篇" style={{ flex: 1, minWidth: 180, border: "1px solid #e0e3e9", borderRadius: 9, padding: "9px 11px", fontSize: 12, background: "var(--cv2-surface)", color: "#373c4b" }}>
                      <option value="">从选题池添加一篇</option>
                      {topics
                        .filter((t) => !s.entries.some((e) => e.topic_id === t.id))
                        .map((t) => (
                          <option value={t.id} key={t.id}>
                            {t.title}
                          </option>
                        ))}
                    </select>
                    <button type="submit" className="cv2-btn tiny" disabled={busy}>
                      加入系列
                    </button>
                  </form>
                  <button
                    type="button"
                    className="cv2-btn tiny"
                    style={{ marginTop: 12 }}
                    disabled={busy || s.status === "completed"}
                    onClick={() =>
                      seriesAction(() =>
                        send("/api/creator/series/" + s.id, "PUT", {
                          expectedRevision: s.revision,
                          status: "completed",
                        })
                      )
                    }
                  >
                    结束系列计划
                  </button>
                </details>
                {s.entries.map((entry, i) => (
                  <div className="cv2-series-card" key={entry.id}>
                    <div className="cv2-series-headrow">
                      <button
                        type="button"
                        className="cv2-btn tiny ghost"
                        onClick={() => {
                          setView("topics");
                          act(() => open(entry.topic));
                        }}
                      >
                        {i + 1}. {entry.topic.title}
                      </button>
                      <Tag>{ENTRY_STATUS[entry.status] || entry.status}</Tag>
                    </div>
                    <div className="cv2-chips">
                      {entry.project_id ? (
                        <Link className="cv2-btn tiny" href={"/compose?project=" + entry.project_id}>
                          继续写作 →
                        </Link>
                      ) : null}
                      {i > 0 ? (
                        <button
                          type="button"
                          className="cv2-btn tiny"
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              const ids = s.entries.map((e) => e.topic_id);
                              [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                              await send("/api/creator/series/" + s.id + "/entries", "PUT", {
                                expectedRevision: s.revision,
                                topicIds: ids,
                              });
                              await load();
                            })
                          }
                        >
                          上移
                        </button>
                      ) : null}
                      {!entry.project_id ? (
                        <button
                          type="button"
                          className="cv2-btn tiny"
                          disabled={busy || s.entries.length === 1}
                          onClick={() =>
                            act(async () => {
                              await send("/api/creator/series/" + s.id + "/entries", "PUT", {
                                expectedRevision: s.revision,
                                topicIds: s.entries.filter((e) => e.id !== entry.id).map((e) => e.topic_id),
                              });
                              await load();
                            })
                          }
                        >
                          移出系列
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
                <p className="cv2-micro" style={{ margin: 0 }}>
                  后台准备选题、大纲与素材。完整正文、费用确认和发布由你决定。
                </p>
              </section>
            ))}
            {!series.length ? (
              <div className="cv2-empty">
                <Icon name="calendar" size={26} />
                <strong>还没有内容系列</strong>
                <p>建立一个系列，让每一篇都有明确的创作脉络；准备任务在服务端执行，关闭页面也会继续。</p>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </CreatorShell>
  );
}

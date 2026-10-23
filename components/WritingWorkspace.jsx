"use client";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Message, MessageContent, MessageResponse } from "./ai-elements/message";
import { PromptInputTextarea } from "./ai-elements/prompt-input";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "./ai-elements/conversation";
import { useSearchParams } from "next/navigation";
import WritingImages from "./WritingImages";
import XiaohongshuWorkspace from "./XiaohongshuWorkspace";
import PublishingControls from "./PublishingControls";
import WritingGenerations from "./WritingGenerations";
import { consumeGeneration } from "../lib/writing-stream-client";
import { diffLines, diffSummary } from "../src/version-diff.mjs";
import WritingContext from "./WritingContext";
import WritingMasterReview from "./WritingMasterReview";
import WritingModelContext from "./WritingModelContext";
import AgentRuns from "./AgentRuns";
import CreatorShell from "./CreatorShell";
import Icon from "./creator/Icon";
import ComposeVisualBoard from "./ComposeVisualBoard";
import {
  activeOutlineIndex,
  composeSteps,
  markdownLineOffsets,
  outlineItems,
  parseStage,
  readinessFacts,
  shotTitle,
  slotView,
  suggestionCompareView,
} from "../src/compose-view.mjs";

// 今天 14:32 / 昨天 20:16 / 10 月 16 日 — client-side only (the document
// arrives after mount), so locale/timezone can never cause a hydration
// mismatch. Same rules as components/WorksLibrary.jsx:28.
function dayLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const midnight = (x) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((midnight(now) - midnight(d)) / 86400000);
  if (diff <= 0)
    return d.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  if (diff === 1) return "昨天";
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

const Editor = dynamic(() => import("./DoocsEditor"), {
  ssr: false,
  loading: () => <p className="writing-empty">正在载入 doocs/md 编辑器…</p>,
});
const Preview = dynamic(() => import("./WritingPreview"), { ssr: false });
const labels = {
  master: "主稿",
  wechat: "微信公众号",
  zhihu: "知乎",
  xiaohongshu: "小红书",
};
const checkLabels = {
  factual: "事实与引用已核对",
  privacy: "隐私信息已核对",
  rights: "文字与图片使用权已核对",
  layout: "已在目标平台核对排版",
};
async function api(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined")
      window.location.assign("/signin");
    throw Object.assign(new Error(data.error || "请求未完成"), {
      status: response.status,
    });
  }
  return data;
}
const send = (url, method, data) =>
  api(url, { method, body: JSON.stringify(data) });
function download(text, name, type = "text/markdown;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// RD-03（Run D，Phase 4 首切片；自有设计，非 vendor 适配）：版本历史
// 「与上一版对比」。两版 markdown 全在既有 GET /history 载荷
// （src/writing.mjs:625-657），展开时客户端按需计算（src/version-diff.mjs
// diffLines），零新增请求；只读渲染，不影响不可变修订与「恢复此版」路径。
function VersionDiffDetails({ row, prev }) {
  const [result, setResult] = useState(null);
  const summary =
    result && !result.tooLarge ? diffSummary(result.ops) : null;
  return (
    <details
      className="writing-version-diff"
      onToggle={(e) => {
        if (e.target.open && result === null)
          setResult(diffLines(prev.markdown, row.markdown));
      }}
    >
      <summary>与上一版对比</summary>
      {result === null ? null : result.tooLarge ? (
        <p>版本内容超过 2000 行，页内对比暂不可用；可用「查看内容」核对原文。</p>
      ) : (
        <>
          <p>
            {summary.added} 行新增 / {summary.removed} 行删除
          </p>
          <div className="writing-version-diff-lines">
            {result.ops.map((op, i) => (
              <div key={i} className={`writing-version-line is-${op.type}`}>
                <span className="writing-version-line-mark" aria-hidden="true">
                  {op.type === "add" ? "＋" : op.type === "del" ? "−" : ""}
                </span>
                <span className="writing-version-line-text">{op.text}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </details>
  );
}

export default function WritingWorkspace() {
  const [streamEnabled, setStreamEnabled] = useState(true);
  const generationAbort = useRef(null),
    generationId = useRef(null);
  const [generationRecords, setGenerationRecords] = useState([]),
    [streamPreview, setStreamPreview] = useState(""),
    [resumeInput, setResumeInput] = useState(null);
  const [masterReviewError, setMasterReviewError] = useState("");
  const [masterReview, setMasterReview] = useState(null),
    [requestContext, setRequestContext] = useState(null);
  const query = useSearchParams(),
    editor = useRef(null),
    epoch = useRef(0),
    savePromise = useRef(null),
    current = useRef({});
  const [projects, setProjects] = useState([]),
    [projectId, setProjectId] = useState(""),
    [channel, setChannel] = useState("master");
  const [doc, setDoc] = useState(null),
    [markdown, setMarkdown] = useState(""),
    [theme, setTheme] = useState("forest"),
    [legacyChoice, setLegacyChoice] = useState("");
  // P2-03 通知分级：单条槽位语义保持（不做队列），内部携带 tone。notify 是
  // 唯一入口；setNotice 保留为 notify(text) 别名——既有约 40 处调用点零改动，
  // 仅关键路径显式升级 tone（保存冲突/blocked → error，导出/恢复/发布回填/
  // 图片插入成功 → success）。error 用 role="alert" + 语义色，其余 role="status"。
  const [notice, setNoticeSlot] = useState(null),
    [blocked, setBlocked] = useState(false),
    [saving, setSaving] = useState(false),
    [busy, setBusy] = useState(false),
    [resolving, setResolving] = useState(false);
  const [title, setTitle] = useState(""),
    [creating, setCreating] = useState(false),
    [showNew, setShowNew] = useState(false),
    [leftOpen, setLeftOpen] = useState(true),
    [rightOpen, setRightOpen] = useState(true);
  const [view, setView] = useState("split"),
    [showTheme, setShowTheme] = useState(false),
    [instruction, setInstruction] = useState(""),
    [consent, setConsent] = useState(false),
    [selection, setSelection] = useState(null),
    [assistantMode, setAssistantMode] = useState("edit"),
    [assistantTab, setAssistantTab] = useState("writing");
  const [suggestions, setSuggestions] = useState([]),
    [focusedSuggestion, setFocusedSuggestion] = useState(""),
    [history, setHistory] = useState(null),
    [assets, setAssets] = useState([]),
    [assetsOpen, setAssetsOpen] = useState(false);
  const [checks, setChecks] = useState({}),
    [publishedUrl, setPublishedUrl] = useState(""),
    [publishAccountId, setPublishAccountId] = useState("");
  const [recovery, setRecovery] = useState(null),
    [xhsPlan, setXhsPlan] = useState(null);
  const [modelOptions, setModelOptions] = useState([]),
    [chosenModels, setChosenModels] = useState([]),
    [compareProgress, setCompareProgress] = useState(null);
  // V2 compose view state: in-canvas 配图视图 (V2.3), the mobile
  // 正文/AI 配图助手 pane split and the real illustration plan summary
  // that feeds the left rail's 配图定位 and the mobile assistant count.
  const [composeMode, setComposeMode] = useState("write"),
    [mobilePane, setMobilePane] = useState("article"),
    [illustrationPlan, setIllustrationPlan] = useState(null);
  // Easel 式阶段焦点视图（研究/写作/审稿/配图/发布）：一次只呈现一个阶段
  // 的工作面。阶段只是呈现层状态——修订树、expectedRevision、保存与建议
  // 流程完全不变；done 标记仍只来自 src/compose-view.mjs 的真实事实。
  // P1-01：初值取深链 ?stage=（白名单解析，非法/缺失落回写作）；浏览器
  // 前进后退由下方以 urlStage 为唯一依赖的对齐 effect 承接。
  const [stage, setStage] = useState(parseStage(query.get("stage")));
  const urlStage = query.get("stage");
  const dirty = !!doc && (markdown !== doc.markdown || theme !== doc.theme),
    canMigrate = (!doc?.legacyLayout || !!legacyChoice) && !recovery;
  function notify(text, tone = "info") {
    setNoticeSlot(text ? { text: String(text), tone } : null);
  }
  const setNotice = notify; // 既有调用点零改动的别名（默认 info）
  current.current = {
    doc,
    markdown,
    theme,
    projectId,
    channel,
    blocked,
    legacyChoice,
    canMigrate,
    epoch: epoch.current,
  };
  const preview = useDeferredValue(markdown);
  // V2 view facts — derived only from real document state (see
  // src/compose-view.mjs for the honesty rules).
  const outline = outlineItems(markdown);
  const steps = composeSteps({
    hasBrief: !!doc?.brief,
    hasOutline: outline.length > 0,
    hasDecidedSuggestions: suggestions.some((s) =>
      ["accepted", "rejected"].includes(s.status)
    ),
    hasInsertedImages: markdown.includes("](asset://"),
  });
  // P2-01 全阶段就绪度条：与 composeSteps 同源的事实 chips（发布侧卡的
  // 「人工检查 n/4」行由此单一承载）。
  const readiness = readinessFacts({
    brief: doc?.brief,
    outlineCount: outline.length,
    pendingSuggestions: suggestions.filter((s) => s.status === "pending")
      .length,
    decidedSuggestions: suggestions.filter((s) =>
      ["accepted", "rejected"].includes(s.status)
    ).length,
    checks,
    staleImagePlan: !!illustrationPlan?.stale,
    insertedImages: markdown.includes("](asset://"),
  });
  // P2-02 行偏移表由 compose-view 纯函数生产，组件不做偏移累加；
  // active 大纲项随光标 selection.from 跟随。
  const outlineOffsets = useMemo(() => markdownLineOffsets(markdown), [markdown]);
  const activeOutline = useMemo(
    () => activeOutlineIndex(outline, selection?.from ?? 0, outlineOffsets),
    [outline, selection?.from, outlineOffsets]
  );
  const planShots = illustrationPlan?.shots || [];
  const editorStage = stage === "write" || stage === "images";
  const allChecksDone = Object.keys(checkLabels).every((key) => checks[key]);
  const paperLabels = {
    master: "Master Draft",
    wechat: "Wechat Draft",
    zhihu: "Zhihu Draft",
  };
  const active =
    suggestions.find((s) => s.id === focusedSuggestion) ||
    suggestions.find(
      (s) => s.status === "pending" && s.baseRevision === doc?.revision
    );
  const inlineSuggestion =
    !dirty &&
    active?.status === "pending" &&
    active.baseRevision === doc?.revision
      ? active
      : null;
  const base = `/api/writing/projects/${projectId}/${channel}`;
  useEffect(() => {
    let live = true;
    api("/api/creator/services")
      .then((r) => {
        if (!live) return;
        const rows = (r.connections || []).filter(
            (c) => c.kind === "text" && (c.models || []).length
          ),
          options = rows
            .flatMap((c) =>
              c.models.map((model) => ({
                connectionId: c.id,
                name: c.name,
                model,
                current: !!c.selected,
              }))
            )
            .slice(0, 24);
        setModelOptions(options);
        setChosenModels((old) => {
          const kept = old.filter((m) =>
            options.some(
              (o) =>
                o.connectionId === m.connectionId && o.model === m.model
            )
          );
          if (kept.length) return kept;
          const preferred =
            options.find((o) => o.current) || options[0];
          return preferred
            ? [
                {
                  connectionId: preferred.connectionId,
                  model: preferred.model,
                  name: preferred.name,
                },
              ]
            : [];
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  function stash(text, selectedTheme = current.current.theme) {
    const s = current.current;
    if (!s.doc) return;
    const key = `content-studio:writing-draft:${s.projectId}:${s.channel}`;
    try {
      if (text === s.doc.markdown && selectedTheme === s.doc.theme)
        sessionStorage.removeItem(key);
      else
        sessionStorage.setItem(
          key,
          JSON.stringify({
            markdown: text,
            theme: selectedTheme,
            baseRevision: s.doc.revision,
            baseMarkdown: s.doc.markdown,
            baseTheme: s.doc.theme,
          })
        );
    } catch {
      /* Server autosave and the local download action remain available. */
    }
  }
  function updateMarkdown(text) {
    current.current.markdown = text;
    stash(text);
    setMarkdown(text);
  }
  function updateTheme(value) {
    current.current.theme = value;
    stash(current.current.markdown, value);
    setTheme(value);
  }

  async function refreshProjects() {
    const data = await api("/api/editor/projects");
    setProjects(data.projects || []);
    return data.projects || [];
  }
  // P1-01：依赖收窄为 project/channel 两个字符串——切阶段只改 ?stage=，
  // 不得重跑 refreshProjects；文档重载防线不受影响（epoch effect 由
  // setProjectId 同值不触发）。
  const projectParam = query.get("project");
  const channelParam = query.get("channel");
  useEffect(() => {
    let live = true;
    refreshProjects()
      .then((rows) => {
        if (!live) return;
        setProjectId(
          rows.some((p) => p.id === projectParam)
            ? projectParam
            : rows[0]?.id || ""
        );
        if (labels[channelParam]) setChannel(channelParam);
      })
      .catch((e) => setNotice(e.message));
    return () => {
      live = false;
    };
  }, [projectParam, channelParam]);
  useEffect(() => {
    const serial = ++epoch.current,
      controller = new AbortController();
    generationAbort.current?.abort();
    setBusy(false);
    generationId.current = null;
    setGenerationRecords([]);
    setStreamPreview("");
    setResumeInput(null);
    setDoc(null);
    setMasterReview(null);
    setRequestContext(null);
    setSuggestions([]);
    setHistory(null);
    setLegacyChoice("");
    setBlocked(false);
    setConsent(false);
    setSelection(null);
    setFocusedSuggestion("");
    setPublishAccountId("");
    setRecovery(null);
    setXhsPlan(null);
    setNotice("");
    setComposeMode("write");
    setMobilePane("article");
    // P1-01 装载协同：阶段焦点取深链 ?stage=（白名单解析，非法/缺失落回
    // 写作），并用 replaceState 写回 URL——mount 与 project/channel 切换
    // 都不制造历史条目。这里只重置呈现层焦点视图：expectedRevision、
    // 保存与建议 decide 路径零改动；effect 依赖 [projectId, channel] 不变，
    // 用户切阶段（只变 stage）不触发本 effect 重跑。
    const queryStage = parseStage(query.get("stage"));
    setStage(queryStage);
    syncStageUrl(queryStage, "replace");
    if (!projectId) return () => controller.abort();
    const ready =
      channel === "xiaohongshu"
        ? send("/api/creator/projects/" + projectId + "/channels", "POST", {
            channel,
          })
        : Promise.resolve();
    ready
      .then(() =>
        Promise.all([
          api(base, { signal: controller.signal }),
          api(base + "/suggestions", { signal: controller.signal }),
          api(`/api/creator/projects/${projectId}/context?channel=${channel}`, {
            signal: controller.signal,
          }),
          api(base + "/generations", { signal: controller.signal }),
        ])
      )
      .then(([next, list, context, generations]) => {
        if (serial !== epoch.current) return;
        setDoc(next);
        setMarkdown(next.markdown);
        setTheme(next.theme);
        setChecks(next.checks);
        setSuggestions(list.suggestions);
        setRequestContext(context);
        setGenerationRecords(generations.generations);
        try {
          const key = `content-studio:writing-draft:${projectId}:${channel}`,
            backup = JSON.parse(sessionStorage.getItem(key) || "null");
          if (
            backup &&
            typeof backup.markdown === "string" &&
            backup.markdown.length <= 150000 &&
            Number.isInteger(backup.baseRevision) &&
            ["forest", "ink", "warm"].includes(backup.theme)
          ) {
            if (
              backup.markdown !== next.markdown ||
              backup.theme !== next.theme
            )
              setRecovery(backup);
            else sessionStorage.removeItem(key);
          }
        } catch {}
      })
      .catch((e) => {
        if (e.name !== "AbortError" && serial === epoch.current)
          setNotice(e.message);
      });
    return () => {
      controller.abort();
      generationAbort.current?.abort();
    };
  }, [projectId, channel]);
  // P1-01 popstate 对齐：浏览器后退/前进只改 URL（popstate → useSearchParams
  // 同步更新），本 effect 以 ?stage= 字符串为唯一依赖把焦点视图对齐回 URL。
  // 等值守卫防循环——goStage 先 setStage 再 pushState，query 异步到齐后
  // 命中守卫 no-op；点 4 依赖收窄后它是 popstate 对齐的唯一落点。
  useEffect(() => {
    const s = parseStage(urlStage);
    setStage((prev) => (prev === s ? prev : s));
  }, [urlStage]);
  useEffect(() => {
    const handler = (e) => {
      const s = current.current;
      if (s.doc && (s.markdown !== s.doc.markdown || s.theme !== s.doc.theme)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  // Real illustration plan summary (GET only) — feeds the left rail's
  // 配图定位 and the mobile assistant count. Refreshed when the project
  // changes, after each saved revision (so stale flags stay honest) and
  // when the 配图 assistant reopens. Failures are non-fatal: the page
  // simply shows no slot entries.
  useEffect(() => {
    if (!projectId || channel === "xiaohongshu") {
      setIllustrationPlan(null);
      return;
    }
    let live = true;
    api(`/api/illustrations/projects/${projectId}`)
      .then((d) => {
        if (live) setIllustrationPlan(d);
      })
      .catch(() => {
        if (live) setIllustrationPlan(null);
      });
    return () => {
      live = false;
    };
  }, [projectId, channel, doc?.revision, assistantTab, composeMode]);
  function openPlanner() {
    setStage("images");
    setComposeMode("write");
    setMobilePane("assistant");
    setRightOpen(true);
    setAssistantTab("images");
    // P1-01：openPlanner 的 mobilePane 语义与 goStage 不同（助手面板而非
    // 正文），保持不走 goStage；仅把阶段同步进 URL。
    syncStageUrl("images", "push");
  }
  // 六步阶段条 → 五个焦点视图：大纲与写作共用写作工作面（同一个编辑器
  // 实例，切换不重挂载、不丢光标与未保存内容）。
  const stepTargets = {
    研究: "research",
    大纲: "write",
    写作: "write",
    审稿: "review",
    配图: "images",
    发布: "publish",
  };
  // 写作视图里只高亮一个步骤（有真实标题→写作，否则→大纲），与 done 事实一致。
  const stageOnlyLabel = {
    research: "研究",
    review: "审稿",
    images: "配图",
    publish: "发布",
  };
  // P1-01 ?stage= 的唯一写入点：合并地址栏既有参数（project/channel 等）
  // 后写回。push 用于用户点击切换（可前进后退）；replace 用于装载协同
  // （不制造历史条目）。Next 16 对原生 history.* 打了补丁：useSearchParams
  // 随之更新且不触发服务端请求（node_modules/next/dist/client/components/
  // app-router.js 的 pushState/replaceState patch → ACTION_RESTORE）。
  function syncStageUrl(next, mode) {
    const params = new URLSearchParams(window.location.search);
    // 缺省即 write（parseStage 白名单缺省值），默认阶段不写冗余参数，
    // 保持 /compose?project=…&channel=… 的既有深链形态。
    if (next === "write") params.delete("stage");
    else params.set("stage", next);
    const qs = params.toString();
    const url = window.location.pathname + (qs ? "?" + qs : "");
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }
  function goStage(next) {
    setStage(next);
    setMobilePane("article");
    if (next === "images") setAssistantTab("images");
    if (next === "write") setAssistantTab("writing");
    syncStageUrl(next, "push");
  }
  // P2-02 大纲真跳转：revealLine 锚定标题行行首（折叠 selection，不产生
  // 选中文本）并滚动聚焦。源码视图下编辑器隐藏（display:none），先切回
  // 分栏，等一帧布局恢复后再跳转，否则 scrollIntoView 落在隐藏节点上无效。
  function revealOutline(item) {
    if (view === "source") {
      setView("split");
      requestAnimationFrame(() => editor.current?.revealLine(item.line));
    } else editor.current?.revealLine(item.line);
  }

  async function persist() {
    if (savePromise.current) {
      await savePromise.current;
      return persist();
    }
    const s = current.current;
    if (!s.doc) return null;
    if (
      s.markdown === s.doc.markdown &&
      s.theme === s.doc.theme &&
      s.doc.mode === "markdown"
    )
      return s.doc;
    if (!s.canMigrate) throw Error("请先选择沿用原正文或历史排版稿。");
    if (s.blocked)
      throw Error("自动保存已暂停。请先处理保存错误，或下载本地草稿。");
    setSaving(true);
    const promise = send(
      `/api/writing/projects/${s.projectId}/${s.channel}`,
      "PUT",
      {
        expectedRevision: s.doc.revision,
        markdown: s.markdown,
        theme: s.theme,
        resolveLegacy: s.legacyChoice || undefined,
      }
    )
      .then((next) => {
        if (s.epoch !== epoch.current) return next;
        // Keep edits typed while the save request was in flight.
        current.current.doc = next;
        stash(current.current.markdown, current.current.theme);
        setDoc(next);
        setChecks(next.checks);
        return next;
      })
      .catch((e) => {
        if (s.epoch === epoch.current) {
          current.current.blocked = true;
          setBlocked(true);
          notify(e.message, "error"); // P2-03：保存冲突是关键错误路径
        }
        throw e;
      })
      .finally(() => {
        savePromise.current = null;
        setSaving(false);
      });
    savePromise.current = promise;
    return promise;
  }
  async function flush() {
    for (let i = 0; i < 8; i++) {
      const saved = await persist();
      if (!saved) return null;
      if (
        current.current.markdown === saved.markdown &&
        current.current.theme === saved.theme
      )
        return saved;
    }
    throw Error("正文仍在编辑中，请稍后重试。你的修改仍保留在编辑器内。");
  }
  useEffect(() => {
    if (
      (!dirty && !(doc?.mode === "legacy" && legacyChoice)) ||
      blocked ||
      !canMigrate ||
      saving ||
      resolving ||
      recovery
    )
      return;
    const timer = setTimeout(() => persist().catch(() => {}), 900);
    return () => clearTimeout(timer);
  }, [
    markdown,
    theme,
    doc,
    blocked,
    canMigrate,
    saving,
    resolving,
    legacyChoice,
    recovery,
  ]);

  async function createProject(e) {
    e.preventDefault();
    setCreating(true);
    try {
      if (doc) await flush();
      const created = await send("/api/writing/projects", "POST", {
        title: title.trim(),
      });
      await refreshProjects();
      setChannel("master");
      setProjectId(created.projectId);
      setShowNew(false);
      setTitle("");
    } catch (e) {
      setNotice(e.message);
    } finally {
      setCreating(false);
    }
  }
  async function switchTo(nextId, nextChannel) {
    try {
      if (doc) await flush();
      setProjectId(nextId);
      setChannel(nextChannel);
    } catch (e) {
      setNotice(e.message);
    }
  }
  async function decide(s, action) {
    if (resolving) return;
    if (
      action === "accept" &&
      (current.current.markdown !== current.current.doc?.markdown ||
        current.current.theme !== current.current.doc?.theme)
    ) {
      setNotice("正文还有新修改。请先保存，再重新生成建议，避免覆盖你的编辑。");
      return;
    }
    const serial = epoch.current;
    setResolving(true);
    try {
      const next = await send(base + "/suggestions/" + s.id, "POST", {
        action,
        expectedRevision: current.current.doc.revision,
      });
      if (serial !== epoch.current) return;
      if (action === "accept") {
        current.current.doc = next;
        current.current.markdown = next.markdown;
        setDoc(next);
        setMarkdown(next.markdown);
        setChecks(next.checks);
      }
      const refreshed = await api(base + "/suggestions");
      if (serial !== epoch.current) return;
      setSuggestions(refreshed.suggestions);
      if (action === "accept")
        setFocusedSuggestion(
          refreshed.suggestions.find(
            (s) => s.status === "pending" && s.baseRevision === next.revision
          )?.id || ""
        );
      setNotice(
        action === "accept"
          ? "修改已保存为新版本。"
          : "已拒绝这条建议，正文保持原样。"
      );
    } catch (e) {
      setNotice(e.message);
    } finally {
      setResolving(false);
    }
  }
  async function refreshGenerations(serial = epoch.current) {
    try {
      const records = await api(base + "/generations");
      if (serial === epoch.current) setGenerationRecords(records.generations);
    } catch {}
  }
  async function stopGeneration() {
    const id = generationId.current;
    if (id)
      await send(base + "/generations/" + id + "/cancel", "POST", {}).catch(
        () => {}
      );
    generationAbort.current?.abort();
  }
  function resumeGeneration(g) {
    setStreamEnabled(g.input.stream !== false);
    setInstruction(g.input.instruction);
    setAssistantMode(g.input.mode);
    if (g.model?.id && g.model.id !== "platform" && g.model.model)
      setChosenModels([
        { connectionId: g.model.id, model: g.model.model, name: g.model.name },
      ]);
    setResumeInput({ ...g.input, resumeOf: g.id });
    setConsent(false);
    setNotice(
      "已恢复原请求和选区。重新确认授权后才会发起新请求，旧片段不会自动写入正文。"
    );
  }
  function toggleChosen(option) {
    setChosenModels((old) =>
      old.some(
        (m) =>
          m.connectionId === option.connectionId && m.model === option.model
      )
        ? old.filter(
            (m) =>
              !(
                m.connectionId === option.connectionId &&
                m.model === option.model
              )
          )
        : [
            ...old,
            {
              connectionId: option.connectionId,
              model: option.model,
              name: option.name,
            },
          ]
    );
  }
  async function generate() {
    if (!consent || !requestContext) {
      setNotice("请先核对上下文并确认本次模型请求。");
      return;
    }
    const serial = epoch.current,
      controller = new AbortController(),
      batch = chosenModels;
    generationAbort.current = controller;
    generationId.current = null;
    setBusy(true);
    setStreamPreview("");
    setNotice("");
    let currentModel = null;
    try {
      const saved = await flush();
      if (!saved) return;
      const selection = editor.current?.selection(),
        range = resumeInput
          ? {
              from: resumeInput.from,
              to: resumeInput.to,
              resumeOf: resumeInput.resumeOf,
            }
          : selection && selection.to > selection.from
          ? { from: selection.from, to: selection.to }
          : {};
      const results = [];
      for (let i = 0; i < Math.max(batch.length, 1); i++) {
        currentModel = batch[i] || null;
        if (batch.length > 1)
          setCompareProgress({
            index: i + 1,
            total: batch.length,
            label: currentModel.name + " · " + currentModel.model,
          });
        const response = await fetch(base + "/generations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedRevision: saved.revision,
            instruction,
            mode: assistantMode,
            stream: streamEnabled,
            allowExternalAI: true,
            expectedContext: {
              revision: requestContext.revision,
              profileRevision: requestContext.profileRevision,
              topicRevision: requestContext.topic?.revision ?? null,
              accountId: requestContext.account?.id ?? null,
              accountRevision: requestContext.account?.revision ?? null,
            },
            ...(currentModel
              ? {
                  model: {
                    connectionId: currentModel.connectionId,
                    model: currentModel.model,
                  },
                }
              : {}),
            ...range,
          }),
          signal: controller.signal,
        });
        const result = await consumeGeneration(response, (event) => {
          if (serial !== epoch.current) return;
          if (event.type === "started") generationId.current = event.id;
          if (event.type === "delta")
            setStreamPreview((text) => (text + event.text).slice(0, 150000));
        });
        if (serial !== epoch.current) return;
        const rows = result.suggestions || [result];
        results.push({ result, rows });
        setSuggestions((old) => [...rows, ...old]);
        if (batch.length <= 1) setFocusedSuggestion(result.id);
        setResumeInput(null);
        setStreamPreview("");
      }
      if (serial !== epoch.current) return;
      setNotice(
        results.length > 1
          ? `已用 ${results.length} 个模型各生成一份建议（同一文章版本），请对比后接受其一。`
          : results[0].result.status === "conversation"
          ? "助手已回复，正文没有修改。"
          : results[0].rows.length > 1
          ? "已生成 " +
            results[0].rows.length +
            " 处独立修改，可逐项接受或拒绝。"
          : "建议已生成。在正文中审阅并接受；生成期间的新修改会保留。"
      );
    } catch (e) {
      if (serial === epoch.current)
        setNotice(
          (currentModel ? currentModel.name + " · " + currentModel.model + "：" : "") +
            (e.name === "AbortError"
              ? "生成已停止，已收到的片段保存在生成记录中，正文未改变。"
              : e.message)
        );
    } finally {
      if (serial === epoch.current) {
        setBusy(false);
        setConsent(false);
        setCompareProgress(null);
        await refreshGenerations(serial);
      }
      generationAbort.current = null;
    }
  }
  function updateRequestContext(context) {
    setRequestContext(context);
    setConsent(false);
  }
  function modelLabel(suggestionId) {
    for (const g of generationRecords)
      if ((g.suggestionIds || []).includes(suggestionId) && g.model)
        return g.model.name + " · " + g.model.model;
    return "";
  }
  async function refreshRequestContext() {
    const serial = epoch.current;
    try {
      const context = await api(
        `/api/creator/projects/${projectId}/context?channel=${channel}`
      );
      if (serial === epoch.current) updateRequestContext(context);
    } catch (e) {
      if (serial === epoch.current) setNotice(e.message);
    }
  }
  async function reviewMaster() {
    setMasterReviewError("");
    const serial = epoch.current;
    setResolving(true);
    try {
      await flush();
      const comparison = await api(base + "/master-sync");
      if (serial === epoch.current) setMasterReview(comparison);
    } catch (e) {
      if (serial === epoch.current) setNotice(e.message);
    } finally {
      setResolving(false);
    }
  }
  async function applyMaster(decisions) {
    const serial = epoch.current;
    setResolving(true);
    try {
      const next = await send(base + "/master-sync", "POST", {
        expectedRevision: masterReview.revision,
        expectedMasterRevision: masterReview.masterRevision,
        expectedSourceRevision: masterReview.sourceRevision,
        reviewToken: masterReview.reviewToken,
        decisions,
      });
      if (serial !== epoch.current) return;
      current.current.doc = next;
      current.current.markdown = next.markdown;
      setDoc(next);
      setMarkdown(next.markdown);
      setChecks(next.checks);
      setMasterReview(null);
      stash(next.markdown, next.theme);
      setNotice(
        "已按审阅选择保存平台新版本；平台表达与历史版本均已保留，请重新完成发布检查。"
      );
    } catch (e) {
      if (serial === epoch.current) {
        setNotice(e.message);
        setMasterReviewError(e.message);
      }
    } finally {
      setResolving(false);
    }
  }
  async function imageContext(selected) {
    if (recovery) throw Error("请先处理上次未保存的本地草稿。");
    const saved = await flush();
    if (selected && channel !== "master")
      throw Error("请在主稿中选择需要配图的段落。");
    const master =
      channel === "master"
        ? saved
        : await api(`/api/writing/projects/${projectId}/master`);
    if (!master.markdown.trim()) throw Error("请先写一些正文，再规划配图。");
    if (!selected) return { revision: master.revision };
    const selection = editor.current?.selection();
    const block = master.blocks.find(
      (b) =>
        selection &&
        selection.to > selection.from &&
        selection.from >= b.from &&
        selection.to <= b.to
    );
    if (!block) throw Error("请在主稿中选中同一段落的文字后，再规划配图。");
    return { revision: master.revision, paragraphId: block.id };
  }
  async function insertShots(shots, sourceRevision) {
    const saved = await flush();
    if (channel !== "master") {
      editor.current?.insert(
        shots
          .map(
            (shot) =>
              `\n\n![${shot.alt.replace(/[\[\]\\]/g, "")}](asset://${
                shot.assetId
              })\n\n`
          )
          .join("")
      );
      return;
    }
    if (saved.revision !== sourceRevision)
      throw Error("正文已变化，请重新确认图片插入位置。");
    let next = saved.markdown;
    const changes = shots
      .map((shot) => {
        const block = saved.blocks.find((b) => b.id === shot.paragraphId);
        const heading = next.match(/^# [^\n]*(?:\n|$)/);
        const position =
          shot.role === "cover" ? heading?.[0].length || 0 : block?.to;
        if (position === undefined)
          throw Error("找不到原配图段落，请重新规划。");
        return {
          position,
          text: `\n\n![${shot.alt.replace(/[\[\]\\]/g, "")}](asset://${
            shot.assetId
          })\n\n`,
        };
      })
      .sort((a, b) => b.position - a.position);
    for (const change of changes)
      next =
        next.slice(0, change.position) +
        change.text +
        next.slice(change.position);
    updateMarkdown(next);
  }
  async function copyMaster() {
    if (!window.confirm("将主稿作为当前平台稿的新版本？现有版本会保留。"))
      return;
    setResolving(true);
    try {
      const saved = await flush(),
        master = await api(`/api/writing/projects/${projectId}/master`);
      const next = await send(base, "PUT", {
        expectedRevision: saved.revision,
        markdown: master.markdown,
        theme: saved.theme,
        sourceMasterRevision: master.revision,
        resolveLegacy: legacyChoice || undefined,
      });
      current.current.doc = next;
      current.current.markdown = next.markdown;
      setDoc(next);
      setMarkdown(next.markdown);
      setChecks(next.checks);
      setNotice("已创建独立平台稿。可以继续让 AI 调整表达和篇幅。");
    } catch (e) {
      setNotice(e.message);
    } finally {
      setResolving(false);
    }
  }
  async function restore(row) {
    if (
      !window.confirm(
        `将 v${row.revision} 恢复为一个新版本？当前历史仍会保留。`
      )
    )
      return;
    setResolving(true);
    try {
      const saved = await flush(),
        next = await send(base, "PUT", {
          expectedRevision: saved.revision,
          markdown: row.markdown,
          theme: row.theme,
          resolveLegacy: legacyChoice || undefined,
        });
      current.current.doc = next;
      current.current.markdown = next.markdown;
      setDoc(next);
      setMarkdown(next.markdown);
      setTheme(next.theme);
      setChecks(next.checks);
      setHistory(null);
      notify("历史内容已恢复为新版本。", "success");
    } catch (e) {
      setNotice(e.message);
    } finally {
      setResolving(false);
    }
  }
  async function loadAssets() {
    try {
      const result = await api("/api/assets");
      setAssets(result.assets || []);
      setAssetsOpen(true);
      setLeftOpen(true);
    } catch (e) {
      setNotice(e.message);
    }
  }
  async function uploadImage(e) {
    const serial = epoch.current;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      setNotice("请选择 6 MiB 以内的图片。");
      return;
    }
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const asset = await send("/api/assets", "POST", {
        name: file.name,
        alt: file.name,
        base64,
      });
      if (serial !== epoch.current) return;
      editor.current?.insert(
        `\n\n![${file.name.replace(/[\[\]\\]/g, "")}](asset://${asset.id})\n\n`
      );
      notify("图片已保存到素材库并插入正文。", "success");
    } catch (e) {
      setNotice(e.message);
    }
  }
  async function exportDocument(kind) {
    setResolving(true);
    try {
      const saved = await flush();
      await send(
        `/api/editor/projects/${projectId}/${channel}/checks`,
        "POST",
        { expectedRevision: saved.revision, checks }
      );
      const result = await send(base + "/export", "POST", {
        expectedRevision: saved.revision,
      });
      if (kind === "copy") {
        const { renderDoocs } = await import("../lib/doocs-preview");
        const html = renderDoocs(result.markdown, theme, {
          forClipboard: true,
        });
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([result.markdown], { type: "text/plain" }),
          }),
        ]);
        notify(
          "已复制排版内容，请到目标平台粘贴并检查。该操作不代表已发布。",
          "success"
        );
      } else {
        download(
          result.markdown,
          `content-studio-${channel}-v${result.revision}.md`
        );
        notify("已生成 Markdown 下载文件，尚未发布到平台。", "success");
      }
    } catch (e) {
      setNotice(e.message || "复制未完成，请使用 Markdown 下载。");
    } finally {
      setResolving(false);
    }
  }
  async function prepareChecks() {
    const saved = await flush();
    await send(`/api/editor/projects/${projectId}/${channel}/checks`, "POST", {
      expectedRevision: saved.revision,
      checks,
    });
    if (channel === "xiaohongshu") {
      if (!xhsPlan) throw Error("请先生成并审阅小红书图片组");
      await send(
        `/api/creator/projects/${projectId}/xiaohongshu/${xhsPlan.id}/review`,
        "POST",
        { expectedRevision: xhsPlan.revision, checks }
      );
    }
    return saved;
  }
  async function reportPublished() {
    try {
      const saved = await persist();
      await send(
        `/api/creator/projects/${projectId}/publishing/report`,
        "POST",
        {
          channel,
          accountId: publishAccountId,
          expectedRevision: saved.revision,
          url: publishedUrl,
        }
      );
      notify("已保存作者确认的发布链接，状态来源为人工记录。", "success");
    } catch (e) {
      setNotice(e.message);
    }
  }
  function chooseLegacy(choice) {
    setLegacyChoice(choice);
    updateMarkdown(
      choice === "layout" ? doc.legacyLayout.markdown : doc.markdown
    );
    current.current.legacyChoice = choice;
    current.current.canMigrate = true;
  }
  function retrySave() {
    current.current.blocked = false;
    setBlocked(false);
    persist().catch((e) => notify(e.message, "error"));
  }
  function recoverDraft() {
    if (!recovery) return;
    const changed = recovery.baseRevision !== doc.revision;
    if (changed) {
      const baseline = {
        ...doc,
        revision: recovery.baseRevision,
        markdown: recovery.baseMarkdown ?? doc.markdown,
        theme: recovery.baseTheme || doc.theme,
      };
      current.current.doc = baseline;
      setDoc(baseline);
      current.current.blocked = true;
      setBlocked(true);
      notify(
        "已恢复本地草稿。服务器已有新版本，自动保存暂停；请下载本地内容并与最新版本合并。",
        "error"
      );
    }
    current.current.markdown = recovery.markdown;
    current.current.theme = recovery.theme;
    setMarkdown(recovery.markdown);
    setTheme(recovery.theme);
    setRecovery(null);
  }
  function discardRecovery() {
    sessionStorage.removeItem(
      `content-studio:writing-draft:${projectId}:${channel}`
    );
    setRecovery(null);
  }
  async function reloadDocument() {
    if (!window.confirm("重新载入会放弃尚未保存的本地修改。可先下载本地草稿。"))
      return;
    try {
      const next = await api(base);
      setDoc(next);
      setMarkdown(next.markdown);
      setTheme(next.theme);
      setChecks(next.checks);
      setBlocked(false);
      setNotice("已载入最新版本。");
    } catch (e) {
      setNotice(e.message);
    }
  }

  // 待审阅建议清单：写作助手与审稿阶段共用同一渲染（接受/拒绝语义一致）。
  const suggestionsList = (
    <Conversation className="writing-suggestions" aria-live="polite">
      <ConversationContent>
      {suggestions.map((s) => (
        <article
          key={s.id}
          className={
            "writing-suggestion " +
            (active?.id === s.id ? "selected" : "")
          }
        >
          <p className="writing-user-request">
            {s.instruction}
          </p>
          {s.status === "conversation" ? (
            <Message from="assistant">
              <MessageContent className="rounded-lg border border-[var(--writing-line)] bg-[#fffefa]">
                <MessageResponse>
                  {s.reason}
                </MessageResponse>
              </MessageContent>
            </Message>
          ) : (
            <p>{s.reason}</p>
          )}
          <small>
            {s.status === "accepted"
              ? "已接受"
              : s.status === "rejected"
              ? "已拒绝"
              : s.status === "revoked"
              ? "来源已移除，建议已撤销"
              : s.status === "conversation"
              ? "讨论回复"
              : s.baseRevision !== doc.revision
              ? "旧版本建议 · 可重新提出请求"
              : "待审阅 · v" + s.baseRevision}
            {modelLabel(s.id)
              ? " · 由 " + modelLabel(s.id) + " 生成"
              : ""}
          </small>
          {s.contextSnapshot && (
            <WritingModelContext
              context={s.contextSnapshot}
              historical
            />
          )}
          {s.status === "pending" && (
            <>
              <button
                onClick={() => {
                  setFocusedSuggestion(s.id);
                  setView("split");
                  goStage("write");
                }}
              >
                在正文中查看
              </button>
              {/* AW-01：就地对比为主（src/compose-view.mjs suggestionCompareView
                  纯派生，original/replacement 是载荷既有字段，零新增请求）；
                  「在正文中查看」保留为上下文定位次级入口。revoked/退化数据
                  （original 为空或与 replacement 相同）诚实降级为单行替换内容。 */}
              {suggestionCompareView(s).mode === "both" ? (
                <div className="writing-suggestion-compare" aria-label="建议对比">
                  <small className="writing-suggestion-compare-hint">
                    原文片段 → 替换内容
                  </small>
                  <div className="writing-version-line is-del">
                    <span className="writing-version-line-mark" aria-hidden="true">
                      −
                    </span>
                    <span className="writing-version-line-text">
                      {s.original}
                    </span>
                  </div>
                  <div className="writing-version-line is-add">
                    <span className="writing-version-line-mark" aria-hidden="true">
                      ＋
                    </span>
                    <span className="writing-version-line-text">
                      {s.replacement}
                    </span>
                  </div>
                </div>
              ) : (
                <details>
                  <summary>查看替换内容</summary>
                  <pre>{s.replacement}</pre>
                </details>
              )}
              <div>
                <button
                  disabled={
                    dirty ||
                    resolving ||
                    s.baseRevision !== doc.revision
                  }
                  onClick={() => decide(s, "accept")}
                >
                  接受修改
                </button>
                <button
                  disabled={resolving}
                  onClick={() => decide(s, "reject")}
                >
                  拒绝
                </button>
              </div>
            </>
          )}
        </article>
      ))}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );

  return (
    <CreatorShell>
      <div
        className={
          "writing-workspace cv2-compose " +
          (mobilePane === "assistant" ? "is-assistant-pane" : "is-article-pane")
        }
      >
        <header className="cv2-compose-header">
          <div>
            <p className="cv2-eyebrow">
              作品 / {labels[channel]}
              {doc?.updatedAt ? ` · 最后编辑 ${dayLabel(doc.updatedAt)}` : ""}
            </p>
            {/* 文章标题是本页的主标题（h1），字号沿用设计的 20px 编辑器头部 */}
            <h1>
              {doc?.title ||
                projects.find((p) => p.id === projectId)?.title ||
                "创作空间"}
            </h1>
          </div>
          <div className="cv2-compose-actions">
            {/* P2-03 生成中全局指示：非阻塞 pill，点击回到既有助手与停止
                控件（不新增第二套停止入口）；生成结束/失败即消失。移动端
                一并切到助手面板，否则正文面板会挡住右栏。 */}
            {(busy || !!compareProgress) && (
              <button
                type="button"
                className="cv2-generating-pill"
                onClick={() => {
                  setRightOpen(true);
                  setAssistantTab("writing");
                  setMobilePane("assistant");
                }}
              >
                助手生成中…
              </button>
            )}
            <span
              className={"cv2-compose-save" + (blocked ? " has-error" : "")}
              role="status"
            >
              {blocked
                ? "保存暂停 · 本地修改仍在"
                : saving
                ? "正在保存…"
                : dirty
                ? "待保存"
                : doc
                ? "已保存 · v" + doc.revision
                : ""}
            </span>
            <select
              aria-label="当前文章"
              value={projectId}
              disabled={busy || resolving || saving}
              onChange={(e) => switchTo(e.target.value, channel)}
            >
              <option value="" disabled>
                选择文章
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
            <button className="cv2-btn" onClick={() => setShowNew((v) => !v)}>
              新建文章
            </button>
            <button
              className="cv2-btn"
              disabled={!doc || busy || resolving}
              onClick={async () => {
                try {
                  await persist();
                  setHistory((await api(base + "/history")).history);
                } catch (e) {
                  setNotice(e.message);
                }
              }}
            >
              版本
            </button>
            <Link
              className="cv2-btn cv2-compose-hide-m"
              href="/works"
              onClick={async (e) => {
                if (dirty || saving) {
                  e.preventDefault();
                  try {
                    await flush();
                    window.location.assign("/works");
                  } catch (error) {
                    setNotice(error.message);
                  }
                }
              }}
            >
              返回作品
            </Link>
            <button
              className="cv2-btn primary"
              disabled={!doc || channel === "master" || resolving}
              aria-pressed={stage === "publish"}
              onClick={() => goStage("publish")}
            >
              发布准备 <Icon name="arrow" size={14} />
            </button>
          </div>
        </header>
        {doc && channel !== "xiaohongshu" ? (
          <>
            {/* Easel 式阶段导航 — done 只来自真实事实（src/compose-view.mjs），
                点击切换焦点视图；非阻塞门，可随时回到任意阶段 */}
            <div className="cv2-compose-steps" aria-label="创作阶段">
              {steps.map((s, i) => {
                const target = stepTargets[s.label];
                const isActive =
                  target === stage &&
                  (stage === "write"
                    ? s.state === "now"
                    : s.label === stageOnlyLabel[stage]);
                return (
                  <button
                    key={s.label}
                    type="button"
                    className={
                      "cv2-compose-step " + s.state + (isActive ? " active" : "")
                    }
                    aria-current={isActive ? "step" : undefined}
                    aria-label={"切换到" + s.label + "阶段"}
                    onClick={() => goStage(target)}
                  >
                    <i>{s.state === "done" ? "✓" : i + 1}</i>
                    {s.label}
                  </button>
                );
              })}
            </div>
            <div className="cv2-compose-stagebar">
              <div
                className="cv2-channel-tabs"
                role="tablist"
                aria-label="稿件渠道"
              >
                {Object.entries(labels).map(([key, name]) => (
                  <button
                    role="tab"
                    aria-selected={channel === key}
                    className={channel === key ? "active" : ""}
                    disabled={busy || resolving || saving}
                    key={key}
                    onClick={() => switchTo(projectId, key)}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {editorStage ? (
                <div className="cv2-compose-toolrow">
                  {stage === "images" ? (
                    <button
                      className="cv2-btn tiny"
                      onClick={() =>
                        setComposeMode((m) => (m === "write" ? "visual" : "write"))
                      }
                    >
                      {composeMode === "write" ? (
                        <>
                          <Icon name="image" size={13} /> 切换到配图
                        </>
                      ) : (
                        <>
                          <Icon name="edit" size={13} /> 返回编辑
                        </>
                      )}
                    </button>
                  ) : (
                    <>
                      <div
                        className="cv2-view-seg"
                        role="group"
                        aria-label="编辑视图"
                      >
                        {[
                          ["split", "分栏"],
                          ["source", "源码"],
                          ["preview", "预览"],
                        ].map(([key, name]) => (
                          <button
                            className={view === key ? "active" : ""}
                            key={key}
                            onClick={() => setView(key)}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                      <button
                        className="cv2-btn tiny"
                        onClick={() => setShowTheme((v) => !v)}
                      >
                        排版与主题
                      </button>
                    </>
                  )}
                  <button
                    className="cv2-btn tiny"
                    onClick={() => setRightOpen((v) => !v)}
                  >
                    {rightOpen ? "收起助手" : "创作助手"}
                  </button>
                </div>
              ) : null}
            </div>
            {/* P2-01 就绪度条（升级自仅审稿/发布可见的 ribbon）：全阶段可见，
                chips 由 readinessFacts 从真实事实派生；诚实上限是「人工检查
                4/4 完成（该渠道独立记录）」，不含任何「已发布/可发布」字样。 */}
            <div className="cv2-compose-ribbon cv2-readiness" aria-label="发布就绪度">
              <div className="row">
                {readiness.map((f) => (
                  <span
                    key={f.key}
                    className={
                      "cv2-pill" +
                      (f.tone === "good" ? " good" : f.tone === "warn" ? " warn" : f.tone === "detail" ? " detail" : "")
                    }
                  >
                    {f.label}
                  </span>
                ))}
                <span className="cv2-pill">主稿 / 平台稿独立</span>
              </div>
              <span>AI 建议先进入待采纳区，不直接写入文章</span>
            </div>
            {/* V2.3 移动端双面板切换（creator-v2.3-visual.html :43）；
                仅在编辑阶段的窄屏渲染，桌面隐藏 */}
            {editorStage ? (
              <div className="cv2-compose-mobiletabs">
                <button
                  type="button"
                  className={mobilePane === "article" ? "active" : ""}
                  aria-pressed={mobilePane === "article"}
                  onClick={() => setMobilePane("article")}
                >
                  正文
                </button>
                <button
                  type="button"
                  className={mobilePane === "assistant" ? "active" : ""}
                  aria-pressed={mobilePane === "assistant"}
                  onClick={() => {
                    setMobilePane("assistant");
                    setAssistantTab(stage === "images" ? "images" : "writing");
                  }}
                >
                  {stage === "images"
                    ? `AI 配图助手${planShots.length ? ` · ${planShots.length}` : ""}`
                    : "AI 写作助手"}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
        {(showNew || (!projects.length && !projectId)) && (
          <form
            className="writing-new cv2-compose-new"
            onSubmit={createProject}
          >
            <label>
              新文章的标题或选题
              <input
                aria-label="新文章标题"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                minLength={3}
                maxLength={240}
                required
                placeholder="例如：普通人如何建立自己的 AI 工作流"
              />
            </label>
            <button className="cv2-btn primary" disabled={creating}>
              {creating ? "正在创建…" : "开始创作"}
            </button>
            <Link href="/topics">从选题开始 →</Link>
          </form>
        )}
        {notice && (
          <div
            className={
              "writing-notice" + (notice.tone === "error" ? " has-error" : "")
            }
            role={notice.tone === "error" ? "alert" : "status"}
          >
            {notice.text}
            <button aria-label="关闭消息" onClick={() => notify("")}>
              ×
            </button>
          </div>
        )}
        {recovery && (
          <div className="writing-migration">
            <strong>发现此标签页上次未保存的本地草稿。</strong>
            <button onClick={recoverDraft}>恢复本地未保存草稿</button>
            <button onClick={discardRecovery}>继续使用服务器版本</button>
          </div>
        )}
        {blocked && (
          <div className="writing-conflict">
            <strong>你的本地修改仍在编辑器中</strong>
            <button onClick={() => download(markdown, "local-writing-draft.md")}>
              下载本地草稿
            </button>
            <button onClick={retrySave}>重试保存</button>
            <button onClick={reloadDocument}>载入服务器版本</button>
          </div>
        )}
        {doc?.legacyLayout && !legacyChoice && (
          <div className="writing-migration">
            <strong>
              这篇文章同时保留了正文和独立排版稿。请选择此次编辑的起点，两个历史版本都会保留。
            </strong>
            <button onClick={() => chooseLegacy("document")}>沿用原正文</button>
            <button onClick={() => chooseLegacy("layout")}>沿用历史排版稿</button>
          </div>
        )}
        {!doc && projectId && !notice ? (
          <p className="cv2-compose-loading">正在载入稿件…</p>
        ) : null}
        {!projectId && projects.length ? (
          <p className="cv2-compose-loading">
            从上方选择一篇文章继续创作，或点「新建文章」。
          </p>
        ) : null}
        {doc && stage !== "publish" && channel === "xiaohongshu" ? (
          <main className="writing-body without-assistant cv2-xhs-body">
            {leftOpen && (
              <aside className="writing-context">
                <h2>小红书创作上下文</h2>
                <WritingContext
                  projectId={projectId}
                  channel={channel}
                  onNotice={setNotice}
                  onSaved={updateRequestContext}
                />
              </aside>
            )}
            <XiaohongshuWorkspace
              key={projectId}
              projectId={projectId}
              onNotice={setNotice}
              onPlan={(plan) => {
                setXhsPlan(plan);
                setChecks({
                  factual: false,
                  privacy: false,
                  rights: false,
                  layout: false,
                });
              }}
              onDocument={async () => {
                const next = await api(base);
                current.current.doc = next;
                current.current.markdown = next.markdown;
                setDoc(next);
                setMarkdown(next.markdown);
                setChecks(next.checks);
              }}
            />
          </main>
        ) : null}
        {doc && stage === "research" && channel !== "xiaohongshu" ? (
          <div className="cv2-stage-flow">
            <section className="cv2-stage-card" aria-label="选题研究">
              <h2>选题与素材</h2>
              {doc.brief ? (
                <>
                  <p className="cv2-stage-lede">{doc.brief.title}</p>
                  {doc.brief.audience ? (
                    <p className="cv2-stage-audience">{doc.brief.audience}</p>
                  ) : null}
                  <p className="cv2-micro">
                    已关联 {doc.brief.sources.length} 条选题素材，来源逐条可溯。
                  </p>
                  <div className="cv2-stage-sources">
                    {doc.brief.sources.map((source) => (
                      <p key={source.id}>
                        <a
                          href={
                            /^https?:\/\//i.test(source.url || "")
                              ? source.url
                              : undefined
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {source.title}
                        </a>
                        <small>{source.summary}</small>
                      </p>
                    ))}
                  </div>
                </>
              ) : (
                <p className="cv2-stage-lede">
                  还没有选题简报。可从 <Link href="/topics">选题发现</Link>{" "}
                  带着素材开始，或直接进入写作。
                </p>
              )}
              <div className="cv2-stage-actions">
                <button
                  className="cv2-btn primary"
                  onClick={() => goStage("write")}
                >
                  下一步：进入写作 <Icon name="arrow" size={14} />
                </button>
              </div>
            </section>
            <section className="cv2-stage-card" aria-label="作者设定与参考资料">
              <h2>作者设定与参考资料</h2>
              <p className="cv2-micro">
                语气、篇幅与参考材料按渠道独立保存；发送给模型前会再次向你确认。
              </p>
              <WritingContext
                projectId={projectId}
                channel={channel}
                onNotice={setNotice}
                onSaved={updateRequestContext}
              />
            </section>
          </div>
        ) : null}
        {doc && stage === "publish" ? (
          <div className="cv2-stage-publish">
            {channel === "master" ? (
              <section className="cv2-stage-card" aria-label="主稿发布说明">
                <h2>主稿不直接发布</h2>
                <p className="cv2-stage-lede">
                  主稿是独立草稿的来源。选择一个目标渠道创建平台稿，独立改写后再回到审稿与发布。
                </p>
                <div className="cv2-stage-actions">
                  {["wechat", "zhihu", "xiaohongshu"].map((key) => (
                    <button
                      key={key}
                      className="cv2-btn"
                      disabled={busy || resolving || saving}
                      onClick={() => switchTo(projectId, key)}
                    >
                      创建{labels[key]}平台稿
                    </button>
                  ))}
                  <button
                    className="cv2-btn"
                    onClick={() => goStage("write")}
                  >
                    返回写作
                  </button>
                </div>
              </section>
            ) : (
              <>
                <section
                  className="cv2-stage-card cv2-stage-publish-card"
                  aria-label="平台发布准备"
                >
                  <h2>{labels[channel]} · 发布准备</h2>
                  <p className="cv2-micro">
                    确认当前版本后，可复制排版、导出交付包，或按账号能力发送到草稿箱。
                    {channel === "xiaohongshu"
                      ? "小红书图片包在图文工作区下载。"
                      : ""}
                  </p>
                  {Object.entries(checkLabels).map(([key, label]) => (
                    <label className="writing-check" key={key}>
                      <input
                        type="checkbox"
                        checked={!!checks[key]}
                        onChange={(e) =>
                          setChecks((rows) => ({
                            ...rows,
                            [key]: e.target.checked,
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                  <div className="cv2-stage-actions">
                    <button
                      className="writing-button"
                      disabled={resolving || dirty || !allChecksDone}
                      onClick={async () => {
                        try {
                          await prepareChecks();
                          setNotice("当前版本的四项检查已保存。");
                        } catch (e) {
                          setNotice(e.message);
                        }
                      }}
                    >
                      保存当前版本检查
                    </button>
                  </div>
                  <p className="cv2-micro">
                    本地图片需先在配图工作台登记对应平台的图片地址。
                  </p>
                  <div className="writing-dialog-actions">
                    <button
                      className="writing-button primary"
                      disabled={resolving || dirty || !allChecksDone}
                      onClick={() => exportDocument("copy")}
                    >
                      复制排版
                    </button>
                    <button
                      className="writing-button"
                      disabled={resolving || dirty || !allChecksDone}
                      onClick={() => exportDocument("download")}
                    >
                      下载 Markdown
                    </button>
                  </div>
                  <hr />
                  <label>
                    已发布链接
                    <input
                      aria-label="实际发布链接"
                      type="url"
                      value={publishedUrl}
                      onChange={(e) => setPublishedUrl(e.target.value)}
                      placeholder="在平台实际发布后填写"
                    />
                  </label>
                  <div className="cv2-stage-actions">
                    <button
                      className="writing-button"
                      disabled={!publishedUrl || dirty || resolving}
                      onClick={reportPublished}
                    >
                      记录作者确认已发布
                    </button>
                  </div>
                  <p className="cv2-micro">
                    导出、草稿和实际发布分别记录；人工记录不等于平台核实。
                  </p>
                  <PublishingControls
                    onAccount={setPublishAccountId}
                    projectId={projectId}
                    channel={channel}
                    disabled={resolving || dirty || !allChecksDone}
                    onNotice={setNotice}
                    prepare={prepareChecks}
                  />
                </section>
                <aside className="cv2-stage-side">
                  <div className="cv2-stage-card" aria-label="发布边界">
                    <h2>发布边界</h2>
                    <p className="cv2-micro">
                      导出 ≠ 实际发布：复制排版与下载
                      Markdown 只生成本地交付物，发送到草稿箱也只是草稿。真正的发布状态以你在平台上核对后的记录为准。
                    </p>
                    {/* P2-01：侧卡的「人工检查 n/4」行已删除——检查进度由上方
                        就绪度条单一承载；侧卡只保留发布边界文案与返回入口。 */}
                    <div className="cv2-stage-actions">
                      {channel === "xiaohongshu" ? (
                        <button
                          className="cv2-btn"
                          onClick={() => goStage("write")}
                        >
                          返回图文创作
                        </button>
                      ) : (
                        <button
                          className="cv2-btn"
                          onClick={() => goStage("review")}
                        >
                          返回审稿
                        </button>
                      )}
                    </div>
                  </div>
                </aside>
              </>
            )}
          </div>
        ) : null}
        {doc && channel !== "xiaohongshu" && editorStage ? (
          <div className="cv2-compose-grid">
            <aside className="cv2-compose-rail writing-context">
              {stage === "write" ? (
                <>
                  <h4>文章结构</h4>
                  {outline.length ? (
                    outline.map((o, i) => (
                      <button
                        key={i + o.text}
                        type="button"
                        className={
                          "cv2-compose-outline-link" +
                          (i === activeOutline ? " active" : "")
                        }
                        style={{ paddingLeft: 10 + (o.level - 1) * 9 }}
                        title={o.text}
                        onClick={() => revealOutline(o)}
                      >
                        {o.text}
                      </button>
                    ))
                  ) : (
                    <p className="cv2-micro">
                      正文中的 # 标题会显示在这里。大纲建议可让 AI 助手生成。
                    </p>
                  )}
                  <div className="cv2-compose-reference">
                    <p className="cv2-micro">
                      {doc.brief
                        ? `已关联 ${doc.brief.sources.length} 条选题素材。`
                        : "还没有选题简报。"}
                    </p>
                    <p className="cv2-rail-actions">
                      <button
                        type="button"
                        className="cv2-btn tiny"
                        onClick={() => goStage("research")}
                      >
                        研究与设定
                      </button>
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <h4>配图定位</h4>
                  {planShots.length ? (
                    planShots.map((shot) => {
                      const v = slotView(shot.status);
                      return (
                        <button
                          key={shot.id}
                          type="button"
                          className="cv2-compose-outline-link"
                          onClick={openPlanner}
                        >
                          {shotTitle(shot)}
                          <span className="cv2-micro"> · {v.label}</span>
                        </button>
                      );
                    })
                  ) : (
                    <p className="cv2-micro">
                      还没有配图计划；在配图助手里依据主稿规划封面和插图。
                    </p>
                  )}
                  {illustrationPlan?.stale ? (
                    <p className="cv2-micro">
                      计划落后于主稿新版本，更新计划后才能继续生成。
                    </p>
                  ) : null}
                  <p className="cv2-rail-actions">
                    <button
                      type="button"
                      className="cv2-btn tiny"
                      onClick={() =>
                        setComposeMode((m) => (m === "write" ? "visual" : "write"))
                      }
                    >
                      {composeMode === "visual" ? "收起配图视图" : "打开配图视图"}
                    </button>
                    <Link
                      href={`/illustrations?project=${projectId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      完整视觉工作台 ↗
                    </Link>
                  </p>
                  <div className="cv2-compose-reference">
                    <h4>素材</h4>
                    <p className="cv2-rail-actions">
                      <button className="cv2-btn tiny" onClick={loadAssets}>
                        从素材库插图
                      </button>
                    </p>
                    <label className="writing-upload">
                      上传图片
                      <input
                        aria-label="上传文章图片"
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={uploadImage}
                      />
                    </label>
                    {assetsOpen && (
                      <div className="writing-assets">
                        {assets.length ? (
                          assets.map((asset) => (
                            <button
                              key={asset.id}
                              onClick={() =>
                                editor.current?.insert(
                                  `\n\n![${asset.alt.replace(
                                    /[\[\]\\]/g,
                                    ""
                                  )}](asset://${asset.id})\n\n`
                                )
                              }
                            >
                              <img
                                src={asset.previewUrl}
                                alt={asset.alt || asset.filename}
                              />
                              <span>{asset.filename}</span>
                            </button>
                          ))
                        ) : (
                          <p>还没有图片，可上传或生成。</p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </aside>
            <section className="cv2-compose-middle" aria-label="文章编辑工作区">
              {channel !== "master" &&
                doc.masterRevision > doc.sourceMasterRevision && (
                  <p className="cv2-source-note">
                    主稿已有更新；当前平台稿独立保存，可选择重新适配。
                  </p>
                )}
              {channel !== "master" && (
                <div className="cv2-channel-note">
                  <span>平台稿独立保存，主稿不会被自动改写。</span>
                  <button
                    className="cv2-btn tiny"
                    disabled={resolving || busy || !canMigrate}
                    onClick={copyMaster}
                  >
                    从主稿创建新版本
                  </button>
                  {["wechat", "zhihu"].includes(channel) && (
                    <button
                      className="cv2-btn tiny"
                      disabled={
                        resolving ||
                        busy ||
                        !canMigrate ||
                        blocked ||
                        !!recovery
                      }
                      onClick={reviewMaster}
                    >
                      查看并合并主稿差异
                    </button>
                  )}
                </div>
              )}
              {showTheme && (
                <div className="cv2-theme-row">
                  <label>
                    文章主题
                    <select
                      aria-label="文章主题"
                      value={theme}
                      disabled={resolving || !!recovery}
                      onChange={(e) => updateTheme(e.target.value)}
                    >
                      <option value="forest">森林绿</option>
                      <option value="ink">墨色</option>
                      <option value="warm">暖棕</option>
                    </select>
                  </label>
                  <span>
                    排版预览在本地完成，外部图片在预览中默认不加载。
                  </span>
                </div>
              )}
              {composeMode === "visual" ? (
                <ComposeVisualBoard
                  projectId={projectId}
                  onOpenPlanner={openPlanner}
                />
              ) : (
                <article className="cv2-paper">
                  <div className="cv2-paper-bar">
                    <span className="cv2-paper-label">
                      {paperLabels[channel] || channel} ·{" "}
                      {doc.mode === "markdown" ? "Markdown" : "原有文章"}
                    </span>
                    <span className="cv2-paper-meta">
                      v{doc.revision} ·{" "}
                      {saving ? "正在保存…" : dirty ? "待保存" : "编辑即存"}
                    </span>
                  </div>
                  <div className={"writing-canvases view-" + view}>
                    <div
                      className={
                        view === "preview" ? "writing-hidden" : "writing-code"
                      }
                    >
                      <Editor
                        ref={editor}
                        key={projectId + channel}
                        value={markdown}
                        onChange={updateMarkdown}
                        onSelection={setSelection}
                        suggestion={inlineSuggestion}
                        onDecision={decide}
                        readOnly={
                          resolving ||
                          !canMigrate ||
                          !!recovery ||
                          !!masterReview
                        }
                      />
                    </div>
                    {view !== "source" && (
                      <Preview markdown={preview} theme={theme} />
                    )}
                  </div>
                  <footer className="writing-document-footer">
                    <span>{markdown.length.toLocaleString()} 字符</span>
                    <span>
                      {selection?.text
                        ? `已选 ${selection.text.length} 字符`
                        : "选中文字，可局部改写或配图"}
                    </span>
                  </footer>
                </article>
              )}
            </section>
            {rightOpen && (
              <aside className="cv2-compose-assistant">
                <div className="cv2-agent-header">
                  <span className="cv2-agent-symbol">
                    <Icon name="spark" size={18} />
                  </span>
                  <div>
                    <b>创作助手</b>
                    <small>懂你的风格，也懂当前文章</small>
                  </div>
                </div>
                <div className="cv2-assistant-scope">
                  <strong>
                    <Icon name="shield" size={13} /> 本次 Agent 的工作范围
                  </strong>
                  围绕当前文章、选中的参考资料与写作风格工作。执行前应展示将发送的材料、使用模型及费用；失败不覆盖正文。
                </div>
                <p className="writing-model-link">
                  <Link href="/settings#services">模型服务设置</Link>
                  ：配置写作 / 配图模型（OpenAI 兼容接口，密钥服务端加密，不回传浏览器）。
                </p>
                {stage === "images" ? (
                  <WritingImages
                    key={projectId}
                    projectId={projectId}
                    channel={channel}
                    sourceRevision={doc.masterRevision}
                    getContext={imageContext}
                    onInsert={insertShots}
                    onNotice={setNotice}
                  />
                ) : (
                  <>
                    <div
                      className="cv2-view-seg"
                      role="group"
                      aria-label="助手模式"
                      style={{ marginBottom: 14 }}
                    >
                      <button
                        className={assistantMode === "discuss" ? "active" : ""}
                        onClick={() => setAssistantMode("discuss")}
                      >
                        讨论
                      </button>
                      <button
                        className={assistantMode === "edit" ? "active" : ""}
                        onClick={() => setAssistantMode("edit")}
                      >
                        修改正文
                      </button>
                    </div>
                    <div className="cv2-agent-suggest">
                      <span className="cv2-pill warn">下一步建议</span>
                      <p>
                        {selection?.text
                          ? "已选中文字，可直接生成局部修改建议。"
                          : dirty
                          ? "正文有未保存修改，会先自动保存再请求模型。"
                          : outline.length
                          ? "大纲已有结构；可继续写作，或让助手按简报生成初稿。"
                          : "先写下第一段，或让助手根据选题简报整理大纲。"}
                      </p>
                    </div>
                    <h3 className="cv2-assistant-section-title">让 AI 帮你做</h3>
                    <div className="writing-quick-actions">
                      {[
                        ["file", "先帮我整理文章大纲"],
                        ["edit", "根据这个选题撰写完整初稿"],
                        ["filter", "精简文章，保留关键信息"],
                        [
                          "spark",
                          "调整为" +
                            (channel === "master"
                              ? "清晰自然的表达"
                              : labels[channel] + "适合的表达"),
                        ],
                      ].map(([icon, text]) => (
                        <button
                          key={text}
                          type="button"
                          className="cv2-agent-action"
                          onClick={() => {
                            setResumeInput(null);
                            setInstruction(text);
                            setAssistantMode("edit");
                          }}
                        >
                          <Icon name={icon} size={16} />
                          <span>{text}</span>
                          <span className="cv2-agent-chevron">
                            <Icon name="chevron" size={14} />
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="writing-prompt">
                      {!!modelOptions.length && (
                        <div>
                          <p className="writing-consent">
                            对比模型（可多选；勾选多个时按顺序各生成一份建议）
                          </p>
                          {modelOptions.map((o) => (
                            <label
                              key={o.connectionId + "/" + o.model}
                              className="writing-consent"
                            >
                              <input
                                type="checkbox"
                                disabled={busy}
                                checked={chosenModels.some(
                                  (m) =>
                                    m.connectionId === o.connectionId &&
                                    m.model === o.model
                                )}
                                onChange={() => toggleChosen(o)}
                              />
                              {o.name} · {o.model}
                              {o.current ? "（当前服务）" : ""}
                            </label>
                          ))}
                        </div>
                      )}
                      <label className="writing-consent">
                        <input
                          type="checkbox"
                          checked={streamEnabled}
                          disabled={busy}
                          onChange={(e) => setStreamEnabled(e.target.checked)}
                        />
                        逐段预览；模型服务不支持时可关闭
                      </label>
                      {resumeInput && (
                        <p className="writing-context-summary">
                          已恢复原请求与选区；将发起新的模型请求。
                          <button
                            className="writing-button"
                            onClick={() => setResumeInput(null)}
                          >
                            取消恢复请求
                          </button>
                        </p>
                      )}
                      <label htmlFor="writing-instruction">
                        {assistantMode === "discuss"
                          ? "与助手讨论观点和写作方向"
                          : selection?.text
                          ? "对选中文字提出要求"
                          : "与助手讨论或提出写作要求"}
                      </label>
                      <PromptInputTextarea
                        id="writing-instruction"
                        value={instruction}
                        onChange={(e) => {
                          setResumeInput(null);
                          setInstruction(e.target.value);
                        }}
                        maxLength={4000}
                        placeholder="例如：少用术语，补一个独立创作者的日常例子（Enter 发送，Shift+Enter 换行）"
                        submitDisabled={
                          !requestContext ||
                          !doc.aiConfigured ||
                          !instruction.trim() ||
                          !consent ||
                          busy ||
                          resolving ||
                          !canMigrate ||
                          blocked
                        }
                        onEnterSubmit={generate}
                      />
                      <label className="writing-consent">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(e) => setConsent(e.target.checked)}
                        />
                        允许本次向已配置模型发送文章、参考素材与写作要求
                        {chosenModels.length > 1
                          ? `（将按顺序调用 ${chosenModels.length} 个模型，各计一次额度）`
                          : ""}
                      </label>
                      <button
                        className="writing-button primary"
                        disabled={
                          !requestContext ||
                          !doc.aiConfigured ||
                          !instruction.trim() ||
                          !consent ||
                          busy ||
                          resolving ||
                          !canMigrate ||
                          blocked
                        }
                        onClick={generate}
                      >
                        {busy
                          ? "正在生成…"
                          : assistantMode === "discuss"
                          ? "发送讨论"
                          : selection?.text
                          ? "生成局部修改建议"
                          : "生成写作建议"}
                      </button>
                    </div>
                    {busy && (
                      <div
                        className="writing-live-generation"
                        aria-live="polite"
                      >
                        <strong>正在生成，尚未写入正文</strong>
                        {compareProgress && (
                          <p className="text-[#7a8780]">
                            模型对比（{compareProgress.index}/
                            {compareProgress.total}）：
                            {compareProgress.label}
                          </p>
                        )}
                        {streamPreview ? (
                          <div className="text-sm">
                            <MessageResponse>{streamPreview}</MessageResponse>
                          </div>
                        ) : (
                          <p className="text-[#7a8780]">等待模型返回…</p>
                        )}
                        <button
                          className="writing-button"
                          onClick={stopGeneration}
                        >
                          停止生成
                        </button>
                      </div>
                    )}
                    <WritingGenerations
                      records={generationRecords}
                      onResume={resumeGeneration}
                      onDownload={download}
                      busy={busy}
                    />
                    {suggestionsList}
                    <div className="writing-context-summary">
                      本次上下文：当前{labels[channel]}
                      {selection?.text ? "与选中文字" : ""}
                      {doc.brief?.sources.length
                        ? `，以及 ${doc.brief.sources.length} 条选题素材`
                        : ""}
                      。<br />
                      文章只在你确认后发送至已配置的写作模型。
                    </div>
                    <WritingModelContext
                      context={
                        requestContext
                          ? {
                              ...requestContext,
                              briefSources: doc.brief?.sources || [],
                            }
                          : null
                      }
                      onRefresh={refreshRequestContext}
                      busy={busy || resolving}
                    />
                    {!doc.aiConfigured && (
                      <details className="writing-model-help" open>
                        <summary>写作模型尚未配置</summary>
                        <p>
                          前往「创作者设置」添加写作模型，再重新载入文章。配图使用独立的服务连接。
                        </p>
                      </details>
                    )}
                    <details className="cv2-assistant-advanced">
                      <summary>技能任务（多步 Agent）</summary>
                      <AgentRuns
                        projectId={projectId}
                        channel={channel}
                        revision={doc.revision}
                        onNotice={setNotice}
                      />
                    </details>
                  </>
                )}
              </aside>
            )}
          </div>
        ) : null}
        {doc && stage === "review" && channel !== "xiaohongshu" ? (
          <div className="cv2-stage-review">
            <div className="cv2-stage-main">
              <div className="cv2-stage-headline">
                <h2>审稿</h2>
                <p className="cv2-micro">
                  AI 建议先进入待采纳区，不直接写入文章；接受后才生成新版本。
                </p>
              </div>
              {suggestions.length ? (
                suggestionsList
              ) : (
                <div className="cv2-stage-card">
                  <p className="cv2-stage-lede">还没有待审阅的建议。</p>
                  <p className="cv2-micro">
                    回到写作阶段让助手生成修改建议，或直接进入发布准备。
                  </p>
                  <div className="cv2-stage-actions">
                    <button
                      className="cv2-btn"
                      onClick={() => goStage("write")}
                    >
                      返回写作
                    </button>
                    {channel !== "master" ? (
                      <button
                        className="cv2-btn primary"
                        onClick={() => goStage("publish")}
                      >
                        下一步：发布准备
                      </button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
            <aside className="cv2-stage-side">
              <div className="cv2-stage-card" aria-label="人工检查状态">
                <h2>四项人工检查</h2>
                <ul className="cv2-check-list">
                  {Object.entries(checkLabels).map(([key, label]) => (
                    <li key={key} className={checks[key] ? "done" : ""}>
                      <i>{checks[key] ? "✓" : "·"}</i>
                      {label}
                    </li>
                  ))}
                </ul>
                <p className="cv2-micro">
                  人工检查按渠道独立记录（{labels[channel]}）；逐项勾选在发布准备里完成。
                </p>
                {channel !== "master" ? (
                  <div className="cv2-stage-actions">
                    <button
                      className="cv2-btn primary"
                      onClick={() => goStage("publish")}
                    >
                      去发布准备
                    </button>
                  </div>
                ) : null}
                <p className="cv2-rail-actions">
                  <Link
                    className="cv2-btn tiny"
                    href={`/editor?project=${projectId}&channel=${channel}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    查看证据与核查 ↗
                  </Link>
                </p>
              </div>
              {channel !== "master" ? (
                <div className="cv2-stage-card" aria-label="主稿同步">
                  <h2>主稿同步</h2>
                  <p className="cv2-micro">
                    {doc.masterRevision > doc.sourceMasterRevision
                      ? "主稿已有更新；当前平台稿独立保存，可选择重新适配。"
                      : "平台稿独立保存，主稿不会被自动改写。"}
                  </p>
                  <div className="cv2-stage-actions">
                    <button
                      className="cv2-btn"
                      disabled={resolving || busy || !canMigrate}
                      onClick={copyMaster}
                    >
                      从主稿创建新版本
                    </button>
                    {["wechat", "zhihu"].includes(channel) ? (
                      <button
                        className="cv2-btn"
                        disabled={
                          resolving ||
                          busy ||
                          !canMigrate ||
                          blocked ||
                          !!recovery
                        }
                        onClick={reviewMaster}
                      >
                        查看并合并主稿差异
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="cv2-stage-card" aria-label="平台稿入口">
                  <h2>平台稿</h2>
                  <p className="cv2-micro">
                    主稿不直接发布。选择目标渠道创建独立的平台稿，再回到审稿与发布。
                  </p>
                  <div className="cv2-stage-actions">
                    {["wechat", "zhihu", "xiaohongshu"].map((key) => (
                      <button
                        key={key}
                        className="cv2-btn"
                        disabled={busy || resolving || saving}
                        onClick={() => switchTo(projectId, key)}
                      >
                        创建{labels[key]}平台稿
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        ) : null}
      {masterReview && (
        <WritingMasterReview
          comparison={masterReview}
          error={masterReviewError}
          busy={resolving}
          projectId={projectId}
          onClose={() => setMasterReview(null)}
          onApply={applyMaster}
        />
      )}
      {history && (
        <div className="writing-dialog-backdrop">
          <section
            className="writing-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="文章版本历史"
          >
            <h2>版本历史</h2>
            <button onClick={() => setHistory(null)}>关闭</button>
            {history.map((row, i) => (
              <article key={row.revision}>
                <strong>
                  v{row.revision} ·{" "}
                  {row.mode === "markdown" ? "Markdown" : "原有正文"}
                </strong>
                <small>{new Date(row.createdAt).toLocaleString()}</small>
                {/* RD-03：修订备注随行显示（payload 已有，writing.mjs:625-657） */}
                {row.note ? <p>备注：{row.note}</p> : null}
                {row.masterReview && (
                  <p>
                    已审阅主稿 v{row.masterReview.sourceRevision} → v
                    {row.masterReview.masterRevision}：合入{" "}
                    {
                      row.masterReview.decisions.filter(
                        (d) => d.action === "apply"
                      ).length
                    }{" "}
                    处，保留{" "}
                    {
                      row.masterReview.decisions.filter(
                        (d) => d.action === "keep"
                      ).length
                    }{" "}
                    处。
                  </p>
                )}
                {/* RD-03：除最早一版外每行可展开与上一版的行级对比（history 为
                    revision DESC，上一版即下一项）；展开时按需计算，零新请求 */}
                {i < history.length - 1 ? (
                  <VersionDiffDetails row={row} prev={history[i + 1]} />
                ) : null}
                <details>
                  <summary>查看内容</summary>
                  <pre>{row.markdown}</pre>
                </details>
                <button
                  disabled={resolving || row.revision === doc?.revision}
                  onClick={() => restore(row)}
                >
                  恢复为新版本
                </button>
              </article>
            ))}
          </section>
        </div>
      )}
      </div>
    </CreatorShell>
  );
}

"use client";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import WritingImages from "./WritingImages";
import XiaohongshuWorkspace from "./XiaohongshuWorkspace";
import PublishingControls from "./PublishingControls";
import WritingGenerations from "./WritingGenerations";
import { consumeGeneration } from "../lib/writing-stream-client";
import WritingContext from "./WritingContext";
import WritingMasterReview from "./WritingMasterReview";
import WritingModelContext from "./WritingModelContext";
import AgentRuns from "./AgentRuns";

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
  if (!response.ok)
    throw Object.assign(new Error(data.error || "请求未完成"), {
      status: response.status,
    });
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
  const [notice, setNotice] = useState(""),
    [blocked, setBlocked] = useState(false),
    [saving, setSaving] = useState(false),
    [busy, setBusy] = useState(false),
    [resolving, setResolving] = useState(false);
  const [title, setTitle] = useState(""),
    [creating, setCreating] = useState(false),
    [showNew, setShowNew] = useState(false),
    [leftOpen, setLeftOpen] = useState(false),
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
  const [publishOpen, setPublishOpen] = useState(false),
    [checks, setChecks] = useState({}),
    [publishedUrl, setPublishedUrl] = useState(""),
    [publishAccountId, setPublishAccountId] = useState("");
  const [recovery, setRecovery] = useState(null),
    [xhsPlan, setXhsPlan] = useState(null);
  const dirty = !!doc && (markdown !== doc.markdown || theme !== doc.theme),
    canMigrate = (!doc?.legacyLayout || !!legacyChoice) && !recovery;
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
  useEffect(() => {
    let live = true;
    refreshProjects()
      .then((rows) => {
        if (!live) return;
        const wanted = query.get("project");
        setProjectId(
          rows.some((p) => p.id === wanted) ? wanted : rows[0]?.id || ""
        );
        if (labels[query.get("channel")]) setChannel(query.get("channel"));
      })
      .catch((e) => setNotice(e.message));
    return () => {
      live = false;
    };
  }, [query]);
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
    setPublishOpen(false);
    setPublishAccountId("");
    setRecovery(null);
    setXhsPlan(null);
    setNotice("");
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
          setNotice(e.message);
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
    setResumeInput({ ...g.input, resumeOf: g.id });
    setConsent(false);
    setNotice(
      "已恢复原请求和选区。重新确认授权后才会发起新请求，旧片段不会自动写入正文。"
    );
  }
  async function generate() {
    if (!consent || !requestContext) {
      setNotice("请先核对上下文并确认本次模型请求。");
      return;
    }
    const serial = epoch.current,
      controller = new AbortController();
    generationAbort.current = controller;
    generationId.current = null;
    setBusy(true);
    setStreamPreview("");
    setNotice("");
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
      setSuggestions((old) => [...rows, ...old]);
      setFocusedSuggestion(result.id);
      setResumeInput(null);
      setNotice(
        result.status === "conversation"
          ? "助手已回复，正文没有修改。"
          : rows.length > 1
          ? "已生成 " + rows.length + " 处独立修改，可逐项接受或拒绝。"
          : "建议已生成。在正文中审阅并接受；生成期间的新修改会保留。"
      );
    } catch (e) {
      if (serial === epoch.current)
        setNotice(
          e.name === "AbortError"
            ? "生成已停止，已收到的片段保存在生成记录中，正文未改变。"
            : e.message
        );
    } finally {
      if (serial === epoch.current) {
        setBusy(false);
        setConsent(false);
        await refreshGenerations(serial);
      }
      generationAbort.current = null;
    }
  }
  function updateRequestContext(context) {
    setRequestContext(context);
    setConsent(false);
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
      setNotice("历史内容已恢复为新版本。");
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
      setNotice("图片已保存到素材库并插入正文。");
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
        setNotice(
          "已复制排版内容，请到目标平台粘贴并检查。该操作不代表已发布。"
        );
      } else {
        download(
          result.markdown,
          `content-studio-${channel}-v${result.revision}.md`
        );
        setNotice("已生成 Markdown 下载文件，尚未发布到平台。");
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
      setNotice("已保存作者确认的发布链接，状态来源为人工记录。");
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
    persist().catch((e) => setNotice(e.message));
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
      setNotice(
        "已恢复本地草稿。服务器已有新版本，自动保存暂停；请下载本地内容并与最新版本合并。"
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

  return (
    <div className="writing-workspace">
      <nav className="writing-product-nav" aria-label="创作导航">
        {[
          ["/", "首页"],
          ["/topics", "选题"],
          ["/create", "创作"],
          ["/library", "资产库"],
          ["/settings", "创作者设置"],
        ].map(([href, label]) => (
          <Link
            key={href}
            href={href}
            onClick={async (e) => {
              if (dirty || saving) {
                e.preventDefault();
                try {
                  await flush();
                  window.location.assign(href);
                } catch (error) {
                  setNotice(error.message);
                }
              }
            }}
          >
            {label}
          </Link>
        ))}
      </nav>
      <header className="writing-top">
        <Link
          href="/"
          className="writing-brand"
          onClick={async (e) => {
            if (dirty || saving) {
              e.preventDefault();
              try {
                await flush();
                window.location.assign("/");
              } catch (error) {
                setNotice(error.message);
              }
            }
          }}
        >
          ◈ Content Studio
        </Link>
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
        <button
          className="writing-button"
          onClick={() => setShowNew((v) => !v)}
        >
          新建文章
        </button>
        <span
          className={"writing-save " + (blocked ? "has-error" : "")}
          role="status"
        >
          {blocked
            ? "保存暂停"
            : saving
            ? "正在保存…"
            : dirty
            ? "待保存"
            : doc
            ? "已保存 · v" + doc.revision
            : ""}
        </span>
        <button
          className="writing-button"
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
        <button
          className="writing-button primary"
          disabled={!doc || channel === "master" || resolving}
          onClick={() => setPublishOpen((v) => !v)}
        >
          发布准备
        </button>
      </header>
      {(showNew || (!projects.length && !projectId)) && (
        <form className="writing-new" onSubmit={createProject}>
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
          <button className="writing-button primary" disabled={creating}>
            {creating ? "正在创建…" : "开始创作"}
          </button>
          <Link href="/topics">从选题开始 →</Link>
        </form>
      )}
      {notice && (
        <div className="writing-notice" role="status">
          {notice}
          <button aria-label="关闭消息" onClick={() => setNotice("")}>
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
      {doc && (
        <>
          <div className="writing-tabs">
            <button
              className="writing-button"
              onClick={() => setLeftOpen((v) => !v)}
            >
              大纲与素材
            </button>
            <div role="tablist" aria-label="稿件渠道">
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
            {channel !== "xiaohongshu" && (
              <button
                className="writing-button"
                onClick={() => setRightOpen((v) => !v)}
              >
                {rightOpen ? "收起助手" : "创作助手"}
              </button>
            )}
          </div>
          {channel === "xiaohongshu" ? (
            <main className="writing-body without-assistant">
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
          ) : (
            <main
              className={
                "writing-body " + (!rightOpen ? "without-assistant" : "")
              }
            >
              {leftOpen && (
                <aside className="writing-context">
                  <h2>文章大纲</h2>
                  <WritingContext
                    projectId={projectId}
                    channel={channel}
                    onNotice={setNotice}
                    onSaved={updateRequestContext}
                  />
                  {doc.brief && (
                    <details className="writing-brief" open>
                      <summary>选题简报与来源</summary>
                      <p>{doc.brief.title}</p>
                      <small>{doc.brief.audience}</small>
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
                    </details>
                  )}
                  {markdown
                    .split("\n")
                    .filter((line) => /^#{1,6}\s/.test(line))
                    .map((line, i) => (
                      <p key={i} className="writing-outline">
                        {line.replace(/^#+\s/, "")}
                      </p>
                    ))}
                  <button className="writing-button" onClick={loadAssets}>
                    从素材库插图
                  </button>
                  <label className="writing-upload">
                    上传图片
                    <input
                      aria-label="上传文章图片"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={uploadImage}
                    />
                  </label>
                  <Link
                    href={`/illustrations?project=${projectId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    打开配图服务 ↗
                  </Link>
                  <Link
                    href={`/editor?project=${projectId}&channel=${channel}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    查看证据与核查 ↗
                  </Link>
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
                </aside>
              )}
              <section className="writing-main" aria-label="文章编辑工作区">
                <div className="writing-document-head">
                  <div>
                    <span className="writing-eyebrow">
                      {labels[channel]} ·{" "}
                      {doc.mode === "markdown" ? "MARKDOWN" : "原有文章"}
                    </span>
                    <h1>{doc.title}</h1>
                  </div>
                  {channel !== "master" && (
                    <button
                      className="writing-button"
                      disabled={resolving || busy || !canMigrate}
                      onClick={copyMaster}
                    >
                      从主稿创建新版本
                    </button>
                  )}
                  {["wechat", "zhihu"].includes(channel) && (
                    <button
                      className="writing-button"
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
                {channel !== "master" &&
                  doc.masterRevision > doc.sourceMasterRevision && (
                    <p className="writing-source-note">
                      主稿已有更新；当前平台稿独立保存，可选择重新适配。
                    </p>
                  )}
                <div className="writing-controls">
                  <div>
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
                  <button onClick={() => setShowTheme((v) => !v)}>
                    排版与主题
                  </button>
                </div>
                {showTheme && (
                  <div className="writing-theme">
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
                        resolving || !canMigrate || !!recovery || !!masterReview
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
              </section>
              {rightOpen && (
                <aside className="writing-assistant">
                  <div className="writing-assistant-head">
                    <h2>创作助手</h2>
                    <span>与你一起完成这篇文章</span>
                  </div>
                  <div className="writing-assistant-modes">
                    <button
                      className={assistantTab === "writing" ? "active" : ""}
                      onClick={() => setAssistantTab("writing")}
                    >
                      写作
                    </button>
                    <button
                      className={assistantTab === "images" ? "active" : ""}
                      onClick={() => setAssistantTab("images")}
                    >
                      配图
                    </button>
                  </div>
                  {assistantTab === "images" ? (
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
                      <div className="writing-assistant-modes">
                        <button
                          className={
                            assistantMode === "discuss" ? "active" : ""
                          }
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
                      <AgentRuns
                        projectId={projectId}
                        channel={channel}
                        revision={doc.revision}
                        onNotice={setNotice}
                      />
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
                      <div className="writing-quick-actions">
                        {[
                          "先帮我整理文章大纲",
                          "根据这个选题撰写完整初稿",
                          "精简文章，保留关键信息",
                          "调整为" +
                            (channel === "master"
                              ? "清晰自然的表达"
                              : labels[channel] + "适合的表达"),
                        ].map((text) => (
                          <button
                            key={text}
                            onClick={() => {
                              setResumeInput(null);
                              setInstruction(text);
                              setAssistantMode("edit");
                            }}
                          >
                            {text}
                          </button>
                        ))}
                      </div>
                      {busy && (
                        <div
                          className="writing-live-generation"
                          aria-live="polite"
                        >
                          <strong>正在生成，尚未写入正文</strong>
                          <pre>{streamPreview || "等待模型返回…"}</pre>
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
                      <div className="writing-suggestions" aria-live="polite">
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
                            <p>{s.reason}</p>
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
                                  }}
                                >
                                  在正文中查看
                                </button>
                                <details>
                                  <summary>查看替换内容</summary>
                                  <pre>{s.replacement}</pre>
                                </details>
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
                      </div>
                      <div className="writing-prompt">
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
                        <textarea
                          id="writing-instruction"
                          value={instruction}
                          onChange={(e) => {
                            setResumeInput(null);
                            setInstruction(e.target.value);
                          }}
                          maxLength={4000}
                          rows={4}
                          placeholder="例如：少用术语，补一个独立创作者的日常例子"
                        />
                        <label className="writing-consent">
                          <input
                            type="checkbox"
                            checked={consent}
                            onChange={(e) => setConsent(e.target.checked)}
                          />
                          允许本次向已配置模型发送文章、参考素材与写作要求
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
                    </>
                  )}
                </aside>
              )}
            </main>
          )}
        </>
      )}
      {masterReview && (
        <WritingMasterReview
          comparison={masterReview}
          error={masterReviewError}
          busy={resolving}
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
            {history.map((row) => (
              <article key={row.revision}>
                <strong>
                  v{row.revision} ·{" "}
                  {row.mode === "markdown" ? "Markdown" : "原有正文"}
                </strong>
                <small>{new Date(row.createdAt).toLocaleString()}</small>
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
      {publishOpen && doc && (
        <div className="writing-dialog-backdrop">
          <section
            className="writing-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="平台发布准备"
          >
            <h2>{labels[channel]} · 发布准备</h2>
            <button onClick={() => setPublishOpen(false)}>关闭</button>
            <p>
              确认当前版本后，可复制排版、导出交付包，或按账号能力发送到草稿箱。小红书请在图文工作区下载图片包。
            </p>
            {Object.entries(checkLabels).map(([key, label]) => (
              <label className="writing-check" key={key}>
                <input
                  type="checkbox"
                  checked={!!checks[key]}
                  onChange={(e) =>
                    setChecks((rows) => ({ ...rows, [key]: e.target.checked }))
                  }
                />
                {label}
              </label>
            ))}
            <button
              className="writing-button"
              disabled={
                resolving ||
                dirty ||
                !Object.keys(checkLabels).every((key) => checks[key])
              }
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
            <p>本地图片需先在配图工作台登记对应平台的图片地址。</p>
            <div className="writing-dialog-actions">
              <button
                className="writing-button primary"
                disabled={
                  resolving ||
                  dirty ||
                  !Object.keys(checkLabels).every((key) => checks[key])
                }
                onClick={() => exportDocument("copy")}
              >
                复制排版
              </button>
              <button
                className="writing-button"
                disabled={
                  resolving ||
                  dirty ||
                  !Object.keys(checkLabels).every((key) => checks[key])
                }
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
            <button
              className="writing-button"
              disabled={!publishedUrl || dirty || resolving}
              onClick={reportPublished}
            >
              记录作者确认已发布
            </button>
            <p>导出、草稿和实际发布分别记录；人工记录不等于平台核实。</p>
            <PublishingControls
              onAccount={setPublishAccountId}
              projectId={projectId}
              channel={channel}
              disabled={
                resolving ||
                dirty ||
                !Object.keys(checkLabels).every((key) => checks[key])
              }
              onNotice={setNotice}
              prepare={prepareChecks}
            />
          </section>
        </div>
      )}
    </div>
  );
}

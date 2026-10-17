"use client";
import { useState } from "react";
import Link from "next/link";
import { send } from "../lib/creator-client";
export default function CreatorJobReview({
  job,
  onUpdated,
  onNotice,
  disabled = false,
}) {
  const [outcome, setOutcome] = useState("cancel"),
    [note, setNote] = useState(""),
    [consent, setConsent] = useState(false),
    [rebindService, setRebindService] = useState(false),
    [busy, setBusy] = useState(false);
  if (!["blocked", "unknown"].includes(job.status)) return null;
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await send("/api/creator/jobs/" + job.id + "/review", "POST", {
        expectedStatus: job.status,
        outcome,
        note,
        allowExternalAI: consent,
        rebindService,
      });
      await onUpdated();
      onNotice(
        outcome === "retry"
          ? "已核对原任务并建立新的执行尝试。"
          : "已保存核对记录；未知费用请在用量页单独核对。"
      );
    } catch (e) {
      onNotice(e.message);
    } finally {
      setBusy(false);
      setConsent(false);
    }
  }
  return (
    <details>
      <summary>核对结果并处理任务</summary>
      <p className="creator-muted">
        先检查已有大纲、画像建议和模型用量。取消任务不会自动退回费用；重试是一次新的执行。
      </p>
      {job.summary && (
        <p className="creator-muted">
          {job.summary.topic || "画像来源文章"}
          {job.summary.revision ? " · 文章 v" + job.summary.revision : ""}
          {job.summary.seriesRevision
            ? " · 系列 v" + job.summary.seriesRevision
            : ""}
          {job.summary.profileRevision
            ? " · 画像 v" + job.summary.profileRevision
            : ""}
        </p>
      )}
      {job.summary?.service && (
        <p className="creator-muted">
          绑定服务：{job.summary.service.name} · {job.summary.service.model} ·
          本次最多 {job.summary.maxRequests} 次请求
        </p>
      )}
      <form className="creator-stack" onSubmit={submit}>
        <label>
          处理方式
          <select
            aria-label="任务处理方式"
            value={outcome}
            onChange={(e) => {
              setOutcome(e.target.value);
              setConsent(false);
            }}
          >
            <option value="cancel">核对后取消，保留原结果记录</option>
            <option value="retry" disabled={!job.summary}>
              核对后重新执行
            </option>
          </select>
        </label>
        <label>
          核对依据
          <textarea
            aria-label="任务核对依据"
            rows={3}
            minLength={8}
            maxLength={2000}
            required
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="说明已经检查了哪些结果、为何取消或重试"
          />
        </label>
        {outcome === "retry" && job.summary?.backgroundAI && (
          <label className="check">
            <input
              type="checkbox"
              checked={rebindService}
              onChange={(e) => {
                setRebindService(e.target.checked);
                setConsent(false);
              }}
            />
            重新绑定当前选定的模型服务；否则继续使用原绑定
          </label>
        )}
        {outcome === "retry" && job.summary?.backgroundAI && (
          <label className="check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            已核对之前的结果，授权本次新的模型请求并计入额度
          </label>
        )}
        <button
          disabled={
            disabled ||
            busy ||
            (outcome === "retry" && job.summary?.backgroundAI && !consent)
          }
        >
          保存任务处理
        </button>
        <Link href="/settings#usage">查看服务用量与待核实费用 →</Link>
      </form>
    </details>
  );
}

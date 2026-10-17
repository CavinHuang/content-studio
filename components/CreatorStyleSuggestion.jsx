"use client";
import { useState } from "react";
import { send } from "../lib/creator-client";
const labels = {
  tone: "表达语气",
  structure: "结构偏好",
  avoid: "避免表达",
  length: "篇幅偏好",
};
export default function CreatorStyleSuggestion({
  suggestion,
  profileRevision,
  disabled,
  onUpdated,
  onNotice,
}) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(suggestion.data),
    [busy, setBusy] = useState(false);
  if (suggestion.status === "deleted") return null;
  if (suggestion.status === "revoked") return <article className="creator-card"><strong>来源已移除，推断已撤销</strong><p className="creator-muted">不能再次采纳这条建议；受影响的画像字段已重新处理。</p></article>;
  async function decide(action, data) {
    setBusy(true);
    try {
      await send("/api/creator/style-suggestions/" + suggestion.id, "POST", {
        action,
        expectedRevision: profileRevision,
        ...(data ? { data } : {}),
      });
      await onUpdated();
      setEditing(false);
      onNotice(
        action === "delete"
          ? "建议已移出列表；已应用的画像仍可从版本历史恢复。"
          : action === "accept"
          ? "已按作者确认的内容更新画像并保留原建议。"
          : "已拒绝这条建议。"
      );
    } catch (e) {
      onNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="creator-card">
      <span className="creator-badge">
        {
          { pending: "待确认", accepted: "已采纳", rejected: "已拒绝" }[
            suggestion.status
          ]
        }
      </span>
      {editing ? (
        <form
          className="creator-stack"
          style={{ marginTop: 15 }}
          onSubmit={(e) => {
            e.preventDefault();
            decide("accept", draft);
          }}
        >
          {Object.entries(labels).map(([key, label]) => (
            <label key={key}>
              {label}
              <textarea
                aria-label={"修订建议：" + label}
                rows={2}
                maxLength={2000}
                value={draft[key] || ""}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
            </label>
          ))}
          <div className="creator-row">
            <button className="primary" disabled={busy || disabled}>
              确认修订并采纳
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              取消修订
            </button>
          </div>
        </form>
      ) : (
        <pre className="creator-pre">
          {Object.entries(suggestion.data)
            .map(([k, v]) => (labels[k] || k) + "：" + v)
            .join("\n\n")}
        </pre>
      )}
      <p className="creator-muted">
        依据：
        {suggestion.evidence.map((e) => e.title + " v" + e.revision).join("、")}
      </p>
      {suggestion.decisions?.some((d) => d.data.authorEdited) && (
        <details>
          <summary>查看作者确认的修订记录</summary>
          {suggestion.decisions
            .filter((d) => d.data.authorEdited)
            .map((d, i) => (
              <pre className="creator-pre" key={i}>
                {Object.entries(d.data.accepted)
                  .map(([k, v]) => (labels[k] || k) + "：" + v)
                  .join("\n")}
              </pre>
            ))}
        </details>
      )}
      {!editing && suggestion.status === "pending" && (
        <div className="creator-row">
          <button
            className="primary"
            disabled={busy || disabled}
            onClick={() => decide("accept")}
          >
            采纳到画像
          </button>
          <button
            disabled={busy || disabled}
            onClick={() => {
              setDraft(suggestion.data);
              setEditing(true);
            }}
          >
            修订后采纳
          </button>
          <button disabled={busy || disabled} onClick={() => decide("reject")}>
            拒绝建议
          </button>
        </div>
      )}
      <button
        style={{ marginTop: 10 }}
        className="subtle"
        disabled={busy || disabled}
        onClick={() => decide("delete")}
      >
        移出建议列表
      </button>
    </article>
  );
}

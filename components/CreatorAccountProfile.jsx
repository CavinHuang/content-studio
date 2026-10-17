"use client";
import { useEffect, useState } from "react";
import { send } from "../lib/creator-client";
const fields = {
  positioning: "账号定位",
  audience: "目标读者",
  tone: "表达语气",
  structure: "结构偏好",
  avoid: "避免表达",
  length: "篇幅偏好",
  visual: "视觉偏好",
};
export default function CreatorAccountProfile({
  account,
  onUpdated,
  onNotice,
}) {
  const [draft, setDraft] = useState(account.profile?.data || {}),
    [busy, setBusy] = useState(false);
  useEffect(
    () => setDraft(account.profile?.data || {}),
    [account.profile?.revision]
  );
  return (
    <details style={{ marginTop: 15 }}>
      <summary>账号独立定位与风格 · v{account.profile?.revision || 0}</summary>
      <form
        className="creator-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await send(
              "/api/creator/platforms/accounts/" + account.id + "/profile",
              "PUT",
              { expectedRevision: account.profile?.revision || 0, data: draft }
            );
            await onUpdated();
            onNotice(
              "账号定位已保存。写作时选择该账号后生效，不改写已有正文。"
            );
          } catch (error) {
            onNotice(error.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="creator-muted">
          留空继承作者画像；本篇与平台手动偏好优先。选择账号不会改写已有文章。
        </p>
        {Object.entries(fields).map(([key, label]) => (
          <label key={key}>
            {label}
            <textarea
              aria-label={"账号 " + account.name + " 的" + label}
              rows={2}
              maxLength={key === "positioning" ? 4000 : 2000}
              value={draft[key] || ""}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </label>
        ))}
        <button disabled={busy}>保存账号定位与风格</button>
      </form>
    </details>
  );
}

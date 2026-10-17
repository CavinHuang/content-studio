"use client";
import { useState } from "react";
import { api, send } from "../lib/creator-client";
export default function CreatorSourceRemoval({ asset, onDone, onNotice }) {
  const [preview, setPreview] = useState(null),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false);
  if (!["article", "material"].includes(asset.kind)) return null;
  return (
    <section style={{ marginTop: 24 }}>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setPreview(
              await api(
                "/api/creator/library/removal-preview?" +
                  new URLSearchParams({ kind: asset.kind, id: asset.id })
              )
            );
            setConsent(false);
          } catch (e) {
            onNotice(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {asset.kind === "article"
          ? "停用学习来源并查看影响"
          : "移除素材并查看画像影响"}
      </button>
      {preview && (
        <div className="creator-card">
          <h3>移除前确认影响范围</h3>
          <p>
            涉及 {preview.projectIds.length} 篇文章，
            {preview.suggestionIds.length} 条风格建议，
            {preview.profileFields.length}{" "}
            个当前画像字段。作者手动改写过的独立偏好会保留。
          </p>
          <p>{preview.retention}</p>
          <p>
            相关生成与准备任务会停止，受影响文章停止参与画像学习。文章来源移除不会删除文章正文。
          </p>
          <label className="check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            我已核对影响范围，并理解历史与备份保留
          </label>
          <button
            disabled={busy || !consent}
            onClick={async () => {
              setBusy(true);
              try {
                await send("/api/creator/library/remove-source", "POST", {
                  kind: asset.kind,
                  id: asset.id,
                  expectedProfileRevision: preview.expectedProfileRevision,
                  reviewToken: preview.reviewToken,
                  confirmRemove: true,
                });
                await onDone();
                onNotice(
                  "来源已移除，关联推断和任务已处理；历史及备份按说明保留。"
                );
              } catch (e) {
                onNotice(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            确认移除来源并撤销相关推断
          </button>
        </div>
      )}
    </section>
  );
}

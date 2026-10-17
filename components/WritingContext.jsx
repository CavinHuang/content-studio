"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { api, send } from "../lib/creator-client";
export default function WritingContext({
  projectId,
  channel,
  onNotice,
  onSaved,
}) {
  const epoch = useRef(0);
  const [conflict, setConflict] = useState(false);
  const [context, setContext] = useState(null),
    [accounts, setAccounts] = useState([]),
    [library, setLibrary] = useState([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    epoch.current++;
    setContext(null);
    setConflict(false);
    Promise.all([
      api("/api/creator/projects/" + projectId + "/context?channel=" + channel),
      api("/api/creator/library"),
      api("/api/creator/platforms"),
    ])
      .then(([c, l, p]) => {
        if (live) {
          setContext(c);
          setLibrary(l.assets);
          setAccounts(p.accounts.filter((a) => a.platform === channel));
        }
      })
      .catch((e) => onNotice(e.message));
    return () => {
      live = false;
    };
  }, [projectId, channel]);
  async function save() {
    const version = epoch.current;
    setBusy(true);
    try {
      const result = await send(
        "/api/creator/projects/" + projectId + "/context?channel=" + channel,
        "PUT",
        {
          expectedRevision: context.revision,
          refs: context.refs,
          excluded: context.excluded,
          overrides: context.overrides,
          channelOverrides: context.channelOverrides || {},
          accountId: context.account?.id || "",
        }
      );
      if (version !== epoch.current) return;
      setContext(result);
      onSaved?.(result);
      setConflict(false);
      onNotice("参考素材与写作偏好已保存。排除的素材不会进入写作模型上下文。");
    } catch (e) {
      if (version === epoch.current) {
        setConflict(e.status === 409);
        onNotice(e.message);
      }
    } finally {
      setBusy(false);
    }
  }
  if (!context) return null;
  return (
    <details className="writing-brief" open>
      <summary>简报、画像与参考素材</summary>
      {conflict && (
        <div>
          <strong>另一个页面已更新上下文。本地选择仍在这里。</strong>
          <details>
            <summary>查看本地选择与偏好</summary>
            <pre className="creator-pre">
              {JSON.stringify(
                {
                  refs: context.refs,
                  excluded: context.excluded,
                  overrides: context.overrides,
                  channelOverrides: context.channelOverrides,
                },
                null,
                2
              )}
            </pre>
          </details>
          <button
            className="writing-button"
            onClick={async () => {
              try {
                const latest = await api(
                  "/api/creator/projects/" +
                    projectId +
                    "/context?channel=" +
                    channel
                );
                setContext(latest);
                onSaved?.(latest);
                setConflict(false);
              } catch (e) {
                onNotice(e.message);
              }
            }}
          >
            重新载入最新上下文
          </button>
        </div>
      )}
      {context.topic && (
        <>
          <strong>{context.topic.title}</strong>
          <p>{context.topic.problem}</p>
          <p>{context.topic.angle}</p>
          <p>{context.topic.keyPoints}</p>
          {context.topic.evidenceGaps && (
            <p>待核实：{context.topic.evidenceGaps}</p>
          )}
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontFamily: "inherit",
              fontSize: 12,
            }}
          >
            {context.topic.outline}
          </pre>
        </>
      )}
      <small>
        作者画像 v{context.profileRevision} ·{" "}
        {context.profile.audience || "读者待设置"}
      </small>
      <small>创作上下文 v{context.revision}</small>
      <p>当前语气：{context.profile.tone || "尚未指定"}</p>
      <details>
        <summary>本篇与平台偏好</summary>
        {channel !== "master" && (
          <label>
            本篇写作定位账号
            <select
              aria-label="本篇写作定位账号"
              className="creator-field"
              value={context.account?.id || ""}
              onChange={(e) => {
                const a = accounts.find((a) => a.id === e.target.value);
                setContext({
                  ...context,
                  account: a
                    ? { id: a.id, name: a.name, revision: a.profile.revision }
                    : null,
                });
              }}
            >
              <option value="">沿用作者与本篇偏好</option>
              {accounts.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {[
          ["tone", "表达语气"],
          ["audience", "目标读者"],
          ["length", "篇幅"],
          ["avoid", "避免表达"],
        ].map(([key, label]) => (
          <label
            key={key}
            style={{ display: "grid", gap: 5, margin: "12px 0", fontSize: 11 }}
          >
            {label}（本篇）
            <textarea
              aria-label={label + "（本篇）"}
              rows={2}
              className="creator-field"
              value={context.overrides[key] || ""}
              placeholder="留空沿用画像"
              onChange={(e) =>
                setContext({
                  ...context,
                  overrides: { ...context.overrides, [key]: e.target.value },
                })
              }
            />
            {channel !== "master" && (
              <>
                <span>{label}（本平台）</span>
                <textarea
                  aria-label={label + "（本平台）"}
                  rows={2}
                  className="creator-field"
                  value={context.channelOverrides?.[key] || ""}
                  placeholder="留空沿用本篇与画像"
                  onChange={(e) =>
                    setContext({
                      ...context,
                      channelOverrides: {
                        ...context.channelOverrides,
                        [key]: e.target.value,
                      },
                    })
                  }
                />
              </>
            )}
          </label>
        ))}
      </details>
      <details>
        <summary>选择素材（{context.refs.length}）</summary>
        <div style={{ maxHeight: 230, overflow: "auto" }}>
          {library
            .filter((a) => a.id !== projectId)
            .map((a) => (
              <label className="writing-consent" key={a.id}>
                <input
                  type="checkbox"
                  checked={context.refs.some((r) => r.id === a.id)}
                  onChange={(e) =>
                    setContext({
                      ...context,
                      refs: e.target.checked
                        ? [...context.refs, { kind: a.kind, id: a.id }]
                        : context.refs.filter((r) => r.id !== a.id),
                      excluded: context.excluded.filter((id) => id !== a.id),
                    })
                  }
                />
                {a.title}
              </label>
            ))}
        </div>
      </details>
      {context.refs.map((ref) => (
        <label className="writing-consent" key={ref.id}>
          <input
            type="checkbox"
            checked={!context.excluded.includes(ref.id)}
            onChange={(e) =>
              setContext({
                ...context,
                excluded: e.target.checked
                  ? context.excluded.filter((id) => id !== ref.id)
                  : [...context.excluded, ref.id],
              })
            }
          />
          {library.find((a) => a.id === ref.id)?.title || ref.id}
          {context.excluded.includes(ref.id) ? "（本次排除）" : ""}
          <button
            type="button"
            className="writing-button"
            onClick={() =>
              setContext({
                ...context,
                refs: context.refs.filter((r) => r.id !== ref.id),
                excluded: context.excluded.filter((id) => id !== ref.id),
              })
            }
          >
            移除此引用
          </button>
        </label>
      ))}
      <button className="writing-button" disabled={busy} onClick={save}>
        保存创作上下文
      </button>
      <p>
        <Link href="/settings">管理作者画像与服务 ↗</Link>
      </p>
    </details>
  );
}

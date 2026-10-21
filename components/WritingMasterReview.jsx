"use client";
import { useState } from "react";

export default function WritingMasterReview({
  comparison,
  busy,
  error,
  projectId,
  onApply,
  onClose,
}) {
  const [choices, setChoices] = useState(() =>
    Object.fromEntries(
      comparison.changes.map((c) => [
        c.id,
        c.state === "clean" ? "apply" : c.state === "applied" ? "keep" : "",
      ])
    )
  );
  const [flavor, setFlavor] = useState(null);
  // AI 腔提示是辅助参考：懒加载、只读、绝不据此改稿或拦截合并。
  const loadFlavor = (open) => {
    if (!open || flavor || !projectId) return;
    fetch(`/api/writing/projects/${projectId}/ai-flavor`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setFlavor)
      .catch(() => setFlavor({ level: "unavailable", hint: "提示加载失败；可直接人工判断语气。" }));
  };
  return (
    <div className="writing-dialog-backdrop">
      <section
        className="writing-dialog writing-master-review"
        role="dialog"
        aria-modal="true"
        aria-label="主稿更新审阅"
      >
        <h2>审阅主稿更新</h2>
        {error && (
          <p role="alert">
            {error}。请关闭后重新打开差异审阅；当前平台稿未被覆盖。
          </p>
        )}
        <button disabled={busy} onClick={onClose}>
          关闭差异审阅
        </button>
        <p>
          对比主稿 v{comparison.sourceRevision} → v{comparison.masterRevision}
          ，当前平台稿 v{comparison.revision}
          。保留的修改会记录为已审阅；合并后请重新完成发布检查。
        </p>
        {!comparison.changes.length && (
          <p>主稿文字没有新增差异。你可以记录本次版本核对。</p>
        )}
        {comparison.changes.map((c, i) => (
          <article key={c.id} aria-label={"主稿修改 " + (i + 1)}>
            <strong>
              修改 {i + 1} · 原主稿第 {c.line} 行 ·{" "}
              {c.state === "clean"
                ? "可以合入"
                : c.state === "applied"
                ? "平台稿已包含"
                : "与平台改写重叠"}
            </strong>
            {c.coarse && <p>这一段变化较大，按整段展示，请完整审阅。</p>}
            <div className="writing-diff-columns">
              <div>
                <h3>原主稿</h3>
                <pre>{c.before || "（新增位置）"}</pre>
              </div>
              <div>
                <h3>最新主稿</h3>
                <pre>{c.after || "（删除这段）"}</pre>
              </div>
            </div>
            {c.state === "conflict" && (
              <>
                <h3>当前平台片段</h3>
                <pre>{c.current || "（平台已删除）"}</pre>
                <p>
                  此处已由你改写，无法安全自动合入。保留平台表达后，可在编辑器中手动调整。
                </p>
              </>
            )}
            {c.state === "clean" ? (
              <label className="writing-check">
                <input
                  type="checkbox"
                  checked={choices[c.id] === "apply"}
                  onChange={(e) =>
                    setChoices({
                      ...choices,
                      [c.id]: e.target.checked ? "apply" : "keep",
                    })
                  }
                />
                合入修改 {i + 1}；取消勾选则保留平台表达
              </label>
            ) : c.state === "conflict" ? (
              <label className="writing-check">
                <input
                  type="checkbox"
                  checked={choices[c.id] === "keep"}
                  onChange={(e) =>
                    setChoices({
                      ...choices,
                      [c.id]: e.target.checked ? "keep" : "",
                    })
                  }
                />
                已审阅修改 {i + 1}，保留平台表达
              </label>
            ) : (
              <p>相同修改已存在，不重复插入。</p>
            )}
          </article>
        ))}
        <details onToggle={(e) => loadFlavor(e.target.open)}>
          <summary>AI 腔辅助提示（最新主稿，仅供参考）</summary>
          {!flavor && <p>加载中…</p>}
          {flavor && flavor.level !== "unavailable" && (
            <div data-testid="ai-flavor-hint">
              <p>
                提示等级：{flavor.level}（{flavor.score}/100，扫描 {flavor.scannedChars} 字）。
                {flavor.hint}
              </p>
              {flavor.hits.length > 0 && (
                <ul>
                  {flavor.hits.map((h) => (
                    <li key={h.id}>
                      {h.label} × {h.count}，例如「{h.excerpt}」
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {flavor && flavor.level === "unavailable" && <p role="status">{flavor.hint}</p>}
        </details>
        <details>
          <summary>查看完整平台稿与最新主稿</summary>
          <h3>当前平台稿</h3>
          <pre>{comparison.current}</pre>
          <h3>最新主稿</h3>
          <pre>{comparison.master}</pre>
        </details>
        <button
          className="writing-button primary"
          disabled={busy || comparison.changes.some((c) => !choices[c.id])}
          onClick={() =>
            onApply(
              comparison.changes.map((c) => ({
                id: c.id,
                action: choices[c.id],
              }))
            )
          }
        >
          确认选择并保存平台新版本
        </button>
      </section>
    </div>
  );
}

"use client";
export default function WritingGenerations({
  records,
  onResume,
  onDownload,
  busy,
}) {
  if (!records.length) return null;
  return (
    <details className="writing-generation-history">
      <summary>生成记录与恢复（{records.length}）</summary>
      {records.map((g) => (
        <article className="writing-suggestion" key={g.id}>
          <strong>
            {{
              running: "生成中",
              completed: "已生成建议",
              interrupted: "已中断",
              failed: "未完成",
              revoked: "来源已移除",
            }[g.status] || g.status}{" "}
            · 文章 v{g.baseRevision}
          </strong>
          <p>{g.input?.instruction}</p>
          {g.partial && (
            <details>
              <summary>查看已保存的生成片段（不属于正文）</summary>
              <pre>{g.partial}</pre>
              <button
                className="writing-button"
                onClick={() =>
                  onDownload(g.partial, "incomplete-generation-" + g.id + ".md")
                }
              >
                下载生成片段
              </button>
            </details>
          )}
          {["interrupted", "failed"].includes(g.status) && (
            <button disabled={busy} onClick={() => onResume(g)}>
              恢复请求到助手
            </button>
          )}
        </article>
      ))}
    </details>
  );
}

"use client";
export default function WritingModelContext({
  context,
  onRefresh,
  busy = false,
  historical = false,
}) {
  if (!context)
    return <p className="writing-context-summary">正在读取本次写作素材…</p>;
  return (
    <details
      className="writing-context-summary"
      aria-label={historical ? "生成时使用的上下文" : "本次写作上下文"}
    >
      <summary>
        {historical ? "生成时使用的上下文" : "本次将发送的画像与素材"}
      </summary>
      <p>
        画像 v{context.profileRevision} · 创作上下文 v{context.revision}
        {context.topic ? " · 简报 v" + context.topic.revision : ""}
      </p>
      {context.profile && (
        <p>
          {context.profile.domain && (
            <>
              领域：{context.profile.domain}
              <br />
            </>
          )}
          {context.profile.goals && (
            <>
              目标：{context.profile.goals}
              <br />
            </>
          )}
          读者：{context.profile.audience || "未指定"}
          <br />
          语气：{context.profile.tone || "未指定"}
          {context.profile.length && (
            <>
              <br />
              篇幅：{context.profile.length}
            </>
          )}
          {context.profile.structure && (
            <>
              <br />
              结构：{context.profile.structure}
            </>
          )}
          {context.profile.avoid && (
            <>
              <br />
              避免：{context.profile.avoid}
            </>
          )}
          {context.profile.visual && (
            <>
              <br />
              视觉偏好：{context.profile.visual}
            </>
          )}
        </p>
      )}
      {context.account && (
        <p>
          写作定位账号：{context.account.name} · v{context.account.revision}
          <br />
          {context.account.positioning}
        </p>
      )}
      {Array.isArray(context.sources) ? (
        context.sources.length ? (
          <ul>
            {context.sources.map((s) => (
              <li key={s.kind + "/" + s.id}>
                {s.title}
                {s.revision ? " · v" + s.revision : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p>未包含个人参考素材。</p>
        )
      ) : (
        <p>此历史建议未记录素材名称，可按来源 ID 核对。</p>
      )}
      {!!context.excluded?.length && (
        <p>已排除 {context.excluded.length} 项素材正文。</p>
      )}
      {!!context.briefSources?.length && (
        <>
          <p>原始选题信源：</p>
          <ul>
            {context.briefSources.map((s) => (
              <li key={s.id}>{s.title}</li>
            ))}
          </ul>
        </>
      )}
      {!historical && (
        <>
          <p>
            同时发送当前文章、写作要求和最近的写作讨论摘要。可在“大纲与素材”中调整并保存。
          </p>
          <button
            className="writing-button"
            disabled={busy}
            onClick={onRefresh}
          >
            刷新本次上下文
          </button>
        </>
      )}
    </details>
  );
}

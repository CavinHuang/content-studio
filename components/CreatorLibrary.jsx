"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import CreatorSourceRemoval from "./CreatorSourceRemoval";
import CreatorShell from "./CreatorShell";
import { api, send, when, downloadBlob } from "../lib/creator-client";
const kinds = { material: "参考素材", article: "文章", image: "图片" };
export default function CreatorLibrary() {
  const epoch = useRef(0);
  const [filters, setFilters] = useState({
      series: "",
      platform: "",
      from: "",
      to: "",
    }),
    [seriesOptions, setSeriesOptions] = useState([]);
  useEffect(() => {
    api("/api/creator/series")
      .then((r) => setSeriesOptions(r.series))
      .catch((e) => setNotice(e.message));
  }, []);
  const [assets, setAssets] = useState([]),
    [q, setQ] = useState(""),
    [kind, setKind] = useState(""),
    [archived, setArchived] = useState(false),
    [tag, setTag] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState(null),
    [tags, setTags] = useState(""),
    [publications, setPublications] = useState(null),
    [metrics, setMetrics] = useState([]),
    [material, setMaterial] = useState({ title: "", body: "", url: "" }),
    [importConsent, setImportConsent] = useState(false),
    [url, setUrl] = useState(""),
    [metric, setMetric] = useState({
      channel: "wechat",
      views: "",
      likes: "",
      comments: "",
      note: "",
    });
  async function load() {
    const version = ++epoch.current,
      r = await api(
        "/api/creator/library?" +
          new URLSearchParams({
            q,
            kind,
            tag,
            archived: archived ? "1" : "0",
            ...filters,
          })
      );
    if (epoch.current === version) setAssets(r.assets);
  }
  useEffect(() => {
    const timer = setTimeout(
      () => load().catch((e) => setNotice(e.message)),
      250
    );
    return () => clearTimeout(timer);
  }, [q, kind, tag, archived, filters]);
  async function act(fn) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function open(a) {
    setSelected(a);
    setTags(a.tags.join(", "));
    setPublications(null);
    setMetrics([]);
    if (a.kind === "article") {
      const [p, m] = await Promise.all([
        api("/api/creator/projects/" + a.id + "/publishing"),
        api("/api/creator/projects/" + a.id + "/metrics"),
      ]);
      setPublications(p);
      setMetrics(m.metrics);
    } else if (a.kind === "material") {
      const m = await api("/api/creator/materials/" + a.id);
      setSelected({ ...a, text: m.body });
    }
  }
  async function fileImport(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    await act(async () => {
      if (f.size > 6 * 1024 * 1024) throw Error("文件请控制在 6 MiB 内");
      if (f.type.startsWith("image/")) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        let binary = "";
        for (const b of bytes) binary += String.fromCharCode(b);
        await send("/api/assets", "POST", {
          name: f.name,
          alt: f.name,
          base64: btoa(binary),
        });
      } else {
        if (!/\.(md|txt|csv|json)$/i.test(f.name))
          throw Error(
            "参考文档支持 Markdown、TXT、CSV、JSON；图片支持 PNG、JPEG、GIF、WebP"
          );
        if (f.size > 150000) throw Error("文本素材请控制在 150 KB 内");
        await send("/api/creator/materials", "POST", {
          kind: "file",
          title: f.name,
          body: await f.text(),
        });
      }
      setNotice("文件已保存到资产库。");
      await load();
    });
  }
  return (
    <CreatorShell>
      <header className="creator-head">
        <div>
          <span className="creator-kicker">EVERY PIECE ADDS UP</span>
          <h1>让创作成为你的资产</h1>
          <p>文章、图片、参考素材与发布记录，可以在下一次创作中继续使用。</p>
        </div>
        <label className="creator-action">
          导入文档 / 图片
          <input
            type="file"
            hidden
            accept=".md,.txt,.csv,.json,image/png,image/jpeg,image/webp,image/gif"
            onChange={fileImport}
          />
        </label>
      </header>
      {notice && (
        <p className="creator-note" role="status">
          {notice}
        </p>
      )}
      <div className="creator-panel creator-row">
        <input
          aria-label="搜索资产"
          placeholder="搜索标题、正文或标签"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 2, width: "auto" }}
        />
        <select
          aria-label="资产类型"
          style={{ flex: 1, width: "auto" }}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">全部类型</option>
          {Object.entries(kinds).map(([key, label]) => (
            <option value={key} key={key}>
              {label}
            </option>
          ))}
        </select>
        <input
          aria-label="筛选标签"
          placeholder="筛选标签"
          value={tag}
          style={{ width: 140 }}
          onChange={(e) => setTag(e.target.value)}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          查看归档
        </label>
      </div>
      <details className="creator-panel">
        <summary>按系列、平台和时间筛选</summary>
        <div className="creator-grid" style={{ marginTop: 15 }}>
          <label>
            内容系列
            <select
              aria-label="筛选内容系列"
              value={filters.series}
              onChange={(e) =>
                setFilters({ ...filters, series: e.target.value })
              }
            >
              <option value="">全部系列</option>
              {seriesOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            关联平台
            <select
              aria-label="筛选关联平台"
              value={filters.platform}
              onChange={(e) =>
                setFilters({ ...filters, platform: e.target.value })
              }
            >
              <option value="">全部平台</option>
              {[
                ["wechat", "微信公众号"],
                ["zhihu", "知乎"],
                ["xiaohongshu", "小红书"],
              ].map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            创建日期起（北京时间）
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </label>
          <label>
            创建日期止（北京时间，含当天）
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
          </label>
        </div>
        <button
          style={{ marginTop: 15 }}
          onClick={() => {
            setFilters({ series: "", platform: "", from: "", to: "" });
            setQ("");
            setKind("");
            setTag("");
            setArchived(false);
          }}
        >
          清除筛选条件
        </button>
      </details>
      <details className="creator-panel">
        <summary>添加自己的笔记或公开链接</summary>
        <div className="creator-grid" style={{ marginTop: 20 }}>
          <form
            className="creator-stack"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await send("/api/creator/materials", "POST", material);
                setMaterial({ title: "", body: "", url: "" });
                await load();
                setNotice("参考笔记已保存。");
              });
            }}
          >
            <label>
              素材标题
              <input
                required
                minLength={2}
                value={material.title}
                onChange={(e) =>
                  setMaterial({ ...material, title: e.target.value })
                }
              />
            </label>
            <label>
              内容或摘录
              <textarea
                aria-label="内容或摘录"
                rows={5}
                value={material.body}
                onChange={(e) =>
                  setMaterial({ ...material, body: e.target.value })
                }
              />
            </label>
            <label>
              来源链接（可选）
              <input
                type="url"
                value={material.url}
                onChange={(e) =>
                  setMaterial({ ...material, url: e.target.value })
                }
              />
            </label>
            <button disabled={busy}>保存笔记</button>
          </form>
          <form
            className="creator-stack"
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await send("/api/creator/materials/import-url", "POST", {
                  url,
                  allowExternalRequest: importConsent,
                });
                setUrl("");
                setImportConsent(false);
                await load();
                setNotice("公开链接已导入，内容仍需核对。");
              });
            }}
          >
            <h3>读取公开文章</h3>
            <input
              aria-label="公开文章链接"
              type="url"
              required
              value={url}
              placeholder="https://…"
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="creator-muted">
              仅读取公开 HTTPS 页面；付费、登录和跳转页面请手动摘录。
            </p>
            <label className="check">
              <input
                type="checkbox"
                checked={importConsent}
                onChange={(e) => setImportConsent(e.target.checked)}
              />
              确认读取此链接并保存摘录
            </label>
            <button disabled={busy || !importConsent}>导入链接内容</button>
            <Link href="/settings#sources" className="creator-action">
              管理 RSS / Atom 信源 →
            </Link>
          </form>
        </div>
      </details>
      {selected && (
        <section className="creator-panel">
          <div className="creator-row spread">
            <h2>{selected.title}</h2>
            <button onClick={() => setSelected(null)}>关闭详情</button>
          </div>
          <CreatorSourceRemoval
            key={selected.id}
            asset={selected}
            onNotice={setNotice}
            onDone={async () => {
              setSelected(null);
              await load();
            }}
          />
          {selected.kind === "image" ? (
            <img
              className="creator-image"
              style={{ height: 300 }}
              src={selected.previewUrl}
              alt={selected.title}
            />
          ) : (
            <pre className="creator-pre">{selected.text}</pre>
          )}
          {selected.url && (
            <a
              className="creator-action"
              href={selected.url}
              target="_blank"
              rel="noreferrer"
            >
              查看原始来源 ↗
            </a>
          )}
          <div className="creator-row" style={{ marginTop: 18 }}>
            <input
              aria-label="资产标签"
              value={tags}
              placeholder="标签，以逗号分隔"
              onChange={(e) => setTags(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await send("/api/creator/library/meta", "PUT", {
                    kind: selected.kind,
                    id: selected.id,
                    tags: tags
                      .split(/[,，]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                    archived: selected.archived,
                  });
                  await load();
                  setNotice("标签已保存。");
                })
              }
            >
              保存标签
            </button>
            <button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await send("/api/creator/library/meta", "PUT", {
                    kind: selected.kind,
                    id: selected.id,
                    tags: selected.tags,
                    archived: !selected.archived,
                  });
                  setSelected(null);
                  await load();
                })
              }
            >
              {selected.archived ? "恢复资产" : "归档资产"}
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const t = await send("/api/creator/topics", "POST", {
                    title: "基于 " + selected.title.slice(0, 180) + " 继续创作",
                    refs: [{ kind: selected.kind, id: selected.id }],
                    reason: "复用自己的创作资产",
                  });
                  window.location.assign("/topics?topic=" + t.id);
                })
              }
            >
              以此为素材创建选题 →
            </button>
            {selected.kind === "article" && (
              <>
                <Link
                  className="creator-action"
                  href={"/compose?project=" + selected.id}
                >
                  打开文章
                </Link>
                <button
                  onClick={() =>
                    act(async () => {
                      const d = await api(
                        "/api/writing/projects/" + selected.id + "/master"
                      );
                      downloadBlob(
                        new Blob([d.markdown], {
                          type: "text/markdown;charset=utf-8",
                        }),
                        "article-v" + d.revision + ".md"
                      );
                    })
                  }
                >
                  下载主稿
                </button>
              </>
            )}
          </div>
          <p className="creator-muted">
            {selected.usage?.length
              ? "已被 " +
                selected.usage.length +
                " 篇文章引用；归档会保留这些引用。"
              : "当前还没有文章引用此资产。"}
          </p>
          {publications && (
            <>
              <hr />
              <h3>发布与交付记录</h3>
              {publications.facts.length ? (
                publications.facts.map((f) => (
                  <p className="creator-muted" key={f.id}>
                    {f.channel} · v{f.revision} ·{" "}
                    {
                      {
                        published: "作者报告已发表",
                        draft_saved: "已保存草稿",
                        exported: "已导出",
                      }[f.kind]
                    }{" "}
                    ·{" "}
                    {f.evidence === "provider_response"
                      ? "平台接口回执"
                      : f.evidence === "author_report"
                      ? "作者记录"
                      : "本地导出"}{" "}
                    · {when(f.createdAt)}{" "}
                    {f.value.url && (
                      <a href={f.value.url} target="_blank" rel="noreferrer">
                        查看链接 ↗
                      </a>
                    )}
                  </p>
                ))
              ) : (
                <p className="creator-muted">
                  尚无交付记录。文章从创建起就会保存，发布后继续积累交付记录与效果数据。
                </p>
              )}
              <h3>人工复盘</h3>
              <form
                className="creator-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  act(async () => {
                    const values = { ...metric };
                    for (const key of ["views", "likes", "comments"])
                      values[key] =
                        metric[key] === "" ? null : Number(metric[key]);
                    const r = await send(
                      "/api/creator/projects/" + selected.id + "/metrics",
                      "POST",
                      values
                    );
                    setMetrics(r.metrics);
                    setNotice("复盘数据已保存，来源标记为人工记录。");
                  });
                }}
              >
                <div className="creator-row">
                  <select
                    aria-label="复盘平台"
                    style={{ flex: 1 }}
                    value={metric.channel}
                    onChange={(e) =>
                      setMetric({ ...metric, channel: e.target.value })
                    }
                  >
                    {[
                      ["wechat", "微信公众号"],
                      ["zhihu", "知乎"],
                      ["xiaohongshu", "小红书"],
                    ].map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {[
                    ["views", "阅读"],
                    ["likes", "点赞"],
                    ["comments", "评论"],
                  ].map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        style={{ width: 110 }}
                        type="number"
                        min={0}
                        value={metric[key]}
                        onChange={(e) =>
                          setMetric({ ...metric, [key]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                </div>
                <textarea
                  aria-label="复盘备注"
                  rows={2}
                  placeholder="哪些表达有效？下一篇想怎样调整？"
                  value={metric.note}
                  onChange={(e) =>
                    setMetric({ ...metric, note: e.target.value })
                  }
                />
                <button disabled={busy}>保存人工复盘</button>
              </form>
              {metrics.map((m) => (
                <p className="creator-muted" key={m.id}>
                  {m.channel} · 阅读 {m.views ?? "—"} / 点赞 {m.likes ?? "—"} /
                  评论 {m.comments ?? "—"} · {m.note} · {when(m.created_at)}
                </p>
              ))}
            </>
          )}
        </section>
      )}
      <div className="creator-library-grid">
        {assets.map((a) => (
          <article className="creator-panel" key={a.id}>
            {a.kind === "image" && (
              <img
                className="creator-image"
                src={a.previewUrl}
                alt={a.title}
                loading="lazy"
              />
            )}
            <div className="creator-row spread" style={{ margin: "12px 0" }}>
              <span className="creator-badge">{kinds[a.kind]}</span>
              <small className="creator-muted">
                {a.usage.length ? "引用 " + a.usage.length + " 次" : ""}
              </small>
            </div>
            <h3>{a.title}</h3>
            {a.kind !== "image" && (
              <p
                className="creator-muted"
                style={{
                  whiteSpace: "pre-wrap",
                  maxHeight: 95,
                  overflow: "hidden",
                }}
              >
                {a.text.slice(0, 160) || "尚未写入内容"}
              </p>
            )}
            <div className="creator-tags">
              {a.tags.map((t) => (
                <span className="creator-badge" key={t}>
                  {t}
                </span>
              ))}
            </div>
            <button disabled={busy} onClick={() => act(() => open(a))}>
              查看与复用 →
            </button>
          </article>
        ))}
      </div>
      {!assets.length && (
        <p className="creator-empty">
          还没有符合条件的资产。写一篇文章，或添加第一份参考素材。
        </p>
      )}
    </CreatorShell>
  );
}

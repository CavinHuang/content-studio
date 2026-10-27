// 【历史资产参考件——P3 热点信息源】
// 来源提交：e7767d6（feat(creator): absorb wewrite/Easel design rules — ... hotlist source ...）
// 原路径：src/hotlist-sources.mjs
// 提取方式：git show e7767d6:src/hotlist-sources.mjs（2026-10-27 提取，内容未改动）
// 说明：属重置前旧历史的实现，仅供移植参考，不参与当前构建。
// 这是任务清单未点名、但与 P3（热点信息源）直接相关的同提交资产，一并收录。
// AGPL 边界：白名单纪律借鉴 Easel hotlist-apis（Apache-2.0，仅规则），实现为旧仓库原创。

// 分钟级热榜 API 适配器：白名单 + 精确端点 + 解析降级 + 失败不编造。
// 借鉴 ZJU-REAL/Easel hotlist-apis 的白名单纪律（Apache-2.0，仅借鉴规则，
// 未复制代码）：信源 URL 必须命中白名单端点才会走 JSON 适配，否则仍按
// RSS/Atom 解析；解析失败如实报错，绝不伪造条目。
export const HOTLIST_APIS = [
  {
    id: "hn-frontpage",
    name: "Hacker News · 首页热榜（Algolia API）",
    canonical: "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30",
    parse(payload) {
      if (!payload || !Array.isArray(payload.hits)) throw new Error("unexpected hotlist payload shape");
      const hits = payload.hits;
      return hits
        .map((h) => {
          const url = String(h.url || "").trim() ||
            (h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : "");
          return {
            title: String(h.title || h.story_title || "").replace(/<[^>]*>/g, "").slice(0, 240),
            url,
            summary: String(h.story_text || h.comment_text || "")
              .replace(/<[^>]*>/g, " ")
              .slice(0, 4000),
            publishedAt: String(h.created_at || "").slice(0, 40),
          };
        })
        .filter((x) => x.title && x.url);
    },
  },
];

// 同源同路径即视为白名单端点（查询参数只影响返回内容，不改变请求目标）。
export function matchHotlistApi(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  return (
    HOTLIST_APIS.find((a) => {
      const c = new URL(a.canonical);
      return u.origin === c.origin && u.pathname === c.pathname;
    }) || null
  );
}

// 解析失败抛错（由 syncSource 转成诚实的失败状态），绝不输出占位条目。
export function parseHotlistPayload(adapter, payload) {
  const entries = adapter.parse(payload);
  if (!Array.isArray(entries)) throw new Error("hotlist payload shape");
  return entries;
}

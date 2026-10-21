// 分钟级热榜 API 适配器：白名单 + 精确端点 + 解析降级 + 失败不编造。
// 白名单纪律借鉴 ZJU-REAL/Easel hotlist-apis（Apache-2.0，仅借鉴规则，未复制
// 代码）：信源 URL 必须命中白名单端点才走 JSON 适配，否则仍按 RSS/Atom 解析；
// 解析失败如实报错，绝不输出占位条目。热榜条目无发布时间时 publishedAt 留空
//（热点雷达按无时间戳诚实展示，不编造）。
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
  {
    id: "60s-ai-news",
    name: "AI 资讯热榜（60s API）",
    canonical: "https://60s.viki.moe/v2/ai-news",
    parse: from60s,
  },
  {
    id: "60s-it-news",
    name: "IT 资讯热榜（60s API）",
    canonical: "https://60s.viki.moe/v2/it-news",
    parse: from60s,
  },
  {
    id: "60s-weibo",
    name: "微博热搜（60s API）",
    canonical: "https://60s.viki.moe/v2/weibo",
    parse: from60s,
  },
  {
    id: "60s-zhihu",
    name: "知乎热榜（60s API）",
    canonical: "https://60s.viki.moe/v2/zhihu",
    parse: from60s,
  },
  {
    id: "60s-douyin",
    name: "抖音热搜（60s API）",
    canonical: "https://60s.viki.moe/v2/douyin",
    parse: from60s,
  },
  {
    id: "60s-toutiao",
    name: "今日头条热搜（60s API）",
    canonical: "https://60s.viki.moe/v2/toutiao",
    parse: from60s,
  },
  {
    id: "60s-rednote",
    name: "小红书热搜（60s API）",
    canonical: "https://60s.viki.moe/v2/rednote",
    parse: from60s,
  },
  {
    id: "60s-baidu-hot",
    name: "百度热搜（60s API）",
    canonical: "https://60s.viki.moe/v2/baidu/hot",
    parse: from60s,
  },
  {
    id: "xxapi-weibohot",
    name: "微博热搜（xxapi 备源）",
    canonical: "https://v2.xxapi.cn/api/weibohot",
    parse: fromXXAPI,
  },
  {
    id: "xxapi-douyinhot",
    name: "抖音热搜（xxapi 备源）",
    canonical: "https://v2.xxapi.cn/api/douyinhot",
    parse: fromXXAPI,
  },
  {
    id: "xxapi-bilibilihot",
    name: "B站热门（xxapi 备源）",
    canonical: "https://v2.xxapi.cn/api/bilibilihot",
    parse: fromXXAPI,
  },
  {
    id: "xxapi-baiduhot",
    name: "百度热搜（xxapi 备源）",
    canonical: "https://v2.xxapi.cn/api/baiduhot",
    parse: fromXXAPI,
  },
];

// 60s API v2：{code:200,data:[{title,link,hot_value|score,description?,created_at?}]}
// 部分端点 data 为嵌套对象（data.data）；字段名随平台不同，做逐项兜底。
function from60s(payload) {
  if (!payload || payload.code !== 200) throw new Error("unexpected 60s payload");
  const d = payload.data;
  const arr = Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : null;
  if (!arr) throw new Error("unexpected 60s payload shape");
  return arr
    .map((x) => {
      const url = String(x.url || x.link || "").trim();
      const title = String(x.title || "").replace(/<[^>]*>/g, "").trim();
      const heat = x.hot_value ?? x.hot ?? x.score;
      const summary = [
        x.description ? String(x.description).replace(/<[^>]*>/g, " ").trim().slice(0, 4000) : "",
        heat !== undefined && heat !== "" ? "热度 " + heat : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        title: title.slice(0, 240),
        url,
        summary,
        publishedAt: String(x.created_at || x.created || "").slice(0, 40),
      };
    })
    .filter((x) => x.title && x.url);
}

// xxapi 备源：{code:200,msg,data:[{title,url,hot:"120万",index}]}
function fromXXAPI(payload) {
  if (!payload || !Array.isArray(payload.data)) throw new Error("unexpected xxapi payload");
  return payload.data
    .map((x) => ({
      title: String(x.title || "").replace(/<[^>]*>/g, "").trim().slice(0, 240),
      url: String(x.url || "").trim(),
      summary: x.hot ? "热度 " + x.hot : "",
      publishedAt: "",
    }))
    .filter((x) => x.title && x.url);
}

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

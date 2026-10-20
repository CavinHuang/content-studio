// Creator V2 library (/library) derivation — small pure adapter over the
// payload of GET /api/creator/library (src/creator.mjs library(): entries
// of kind material|article|image with title/text/url/tags/usage/series/
// platforms/createdAt/archived). No new storage, no fabrication.
//
// Design source: public/design/creator-v2.2.html libraryView (:163) + the
// V2.2 refinement (:182): the 我的内容资料夹 head, the three collection
// cards (全部素材/参考线索/视觉素材), the filter row (search box + the
// 全部/文章/链接/图片 chips), the three-column asset grid with colored
// icon tiles, and the closing 每条素材保留上下文 band — via the design
// manifest §8.
//
// Honesty rules encoded here (root AGENTS.md / implementation prompt §2):
//   - card type tags map onto the REAL kinds: 公开线索 = a material that
//     actually carries a source URL, 研究资料 = a note/file material,
//     视觉资产 = a content asset, 作品参考 = an existing editorial work;
//     nothing invents a fourth data model;
//   - subtitles come only from real fields (usage rows, url, platforms);
//     an asset nobody referenced says 尚未被引用 instead of a fake number;
//   - search placeholder follows the design's collection linkage (:185).
export const LIBRARY_COLLECTIONS = [
  { key: "all", pill: "资料总览", name: "全部素材", sub: "文章、链接与图片", kind: "" },
  { key: "links", pill: "研究资料", name: "参考线索", sub: "公开来源 · 待核实", kind: "material" },
  { key: "visual", pill: "创作视觉", name: "视觉素材", sub: "封面、内文插图与品牌", kind: "image" },
];

// 设计 chip「文章/链接/图片」按真实 kind 落到既有 API 的 kind 参数
// （article/material/image）；「链接」即参考素材（公开线索 + 笔记）。
export const LIBRARY_KIND_CHIPS = [
  { key: "all", label: "全部", kind: "" },
  { key: "article", label: "文章", kind: "article" },
  { key: "material", label: "链接", kind: "material" },
  { key: "image", label: "图片", kind: "image" },
];

export const PLATFORM_NAMES = {
  wechat: "公众号",
  zhihu: "知乎",
  xiaohongshu: "小红书",
};

export function collectionByKey(key) {
  return LIBRARY_COLLECTIONS.find((c) => c.key === key) || LIBRARY_COLLECTIONS[0];
}

// 设计 :185 — 集合切换联动搜索占位文案。
export function collectionPlaceholder(collectionKey) {
  const c = collectionByKey(collectionKey);
  return c.key === "all" ? "搜索素材或作品…" : `在「${c.name}」中搜索…`;
}

function platformNames(entry) {
  const order = ["wechat", "zhihu", "xiaohongshu"];
  return order
    .filter((p) => (Array.isArray(entry?.platforms) ? entry.platforms.includes(p) : false))
    .map((p) => PLATFORM_NAMES[p]);
}

// One honest card view model per library entry. `variant` picks the
// design's colored icon tile (creator-v2.2.html:9 .asset-visual one/two/three).
export function describeEntry(entry) {
  if (!entry || !entry.id) return null;
  const usageCount = Array.isArray(entry.usage) ? entry.usage.length : 0;
  const platforms = platformNames(entry);
  let icon, variant, typeTag;
  if (entry.kind === "image") {
    icon = "image";
    variant = "three";
    typeTag = "视觉资产";
  } else if (entry.kind === "article") {
    icon = "file";
    variant = "one";
    typeTag = "作品参考";
  } else if (entry.url) {
    icon = "link";
    variant = "two";
    typeTag = "公开线索";
  } else {
    icon = "book";
    variant = "one";
    typeTag = "研究资料";
  }

  let subtitle;
  if (usageCount > 0) subtitle = `已关联 ${usageCount} 篇作品`;
  else if (entry.kind === "material") subtitle = entry.url ? "公开来源 · 等待核实" : "参考素材 · 尚未被作品引用";
  else if (entry.kind === "image") subtitle = "尚未被作品使用";
  else subtitle = platforms.length ? `已有渠道稿：${platforms.join("、")}` : "主稿可继续创作";

  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    icon,
    variant,
    typeTag,
    subtitle,
    usageCount,
    usage: Array.isArray(entry.usage) ? entry.usage : [],
    platforms,
    hasUrl: !!entry.url,
    archived: !!entry.archived,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    createdAt: entry.createdAt || "",
  };
}

// Honest empty-state copy: filtered vs archived vs first-use.
export function emptyCopy({ hasQuery, kind, archived } = {}) {
  if (archived) {
    return { title: "没有已归档的素材", hint: "归档保留引用与历史；在素材详情里选择「恢复资产」即可取回。" };
  }
  if (hasQuery || kind) {
    return { title: "没有匹配的素材", hint: "换个关键词，或清除筛选条件再试。" };
  }
  return {
    title: "素材库还是空的",
    hint: "导入一个公开链接、上传本地文件，或先写下第一份参考笔记；文章与配图会自动进入资料夹。",
  };
}

// Creator V2 publish center (/publish) derivation — small read-only
// adapter over payloads that already exist in the domain services:
//   - GET /api/editor/projects/:id (editorial.get: per-channel checks /
//     status / statusLabel / document.revision / masterOutdated /
//     openCorrections / publicationReports, src/editorial.mjs:47-50)
//   - GET /api/creator/projects/:id/publishing (publishing.history:
//     operations[state] + facts[kind/evidence], src/publishing.mjs:359-374)
//   - GET /api/writing/projects/:id/:channel (writing.document: real
//     channel markdown, src/writing.mjs:385-455)
// No new storage, no fabrication. Honesty rules encoded here (root
// AGENTS.md / implementation prompt §2):
//   - the four manual checks stay per-channel and independent
//     (src/editorial.mjs:11 keys factual/privacy/rights/layout); the
//     design's per-channel label phrasings (creator-v2.2.html:160) map
//     onto those same four keys by position;
//   - 检查完成 only reflects the checkboxes — never export, draft-box
//     push or publication (导出≠草稿箱≠真实发布);
//   - delivery timeline rows come only from real publishing facts and
//     operations; "真实发布状态尚未确认" stays pending until the author
//     records a publication, and even then the row keeps
//     "未经平台核验" (publishing.mjs report → platformVerified:false).
//
// Adapted from ZJU-REAL/Easel (Apache-2.0)：
// web/frontend/src/components/ManualPublishPage.tsx:63-67（snapshot/approved
// ——审核绑定内容版本、改字即作废的思想 → RD-01 服务端 checkedRevision 指针与
// checksStale 派生，不在前端存快照）、:211-235（审核后 gate 全部交付动作 →
// channelState.reviewReady 三分 statusTag）。modified：审核对象是本工作区的
// 四项按渠道人工检查（editorial checklist），不是 Easel 的标题/正文/素材
// 本地快照；blockers 仍只来自 _canExport 同源真实事实。
import { channelHasContent } from "./works-library.mjs";
import { SEED_PARAGRAPH_TEXT } from "./seed-paragraph.mjs";

// The four per-channel manual checks, in domain key order
// (src/editorial.mjs:11). Labels are the design's channel-specific
// phrasings (creator-v2.2.html:160 publishView checklist).
export const CHECK_ORDER = ["factual", "privacy", "rights", "layout"];

export const PUBLISH_CHANNELS = [
  {
    key: "wechat",
    name: "微信公众号",
    short: "公众号",
    logo: "微",
    editLabel: "编辑公众号稿",
    draftReady: "准备微信草稿交付",
    // RD-02（Run D，ManualPublishPage.tsx:230 语义）：官方发布页为作者手动跳转
    // 引导（纯客户端 <a target="_blank">，无自动打开、无服务端外呼）。
    officialUrl: "https://mp.weixin.qq.com/",
    officialHint: "在官方后台新建草稿，上传图片并检查手机版预览",
    checkLabels: {
      factual: "事实、数据与引用来源",
      privacy: "隐私信息与敏感内容",
      rights: "图片及文字使用权",
      layout: "移动端排版与裁切预览",
    },
  },
  {
    key: "zhihu",
    name: "知乎",
    short: "知乎",
    logo: "知",
    editLabel: "编辑知乎稿",
    draftReady: "准备知乎交付",
    officialUrl: "https://zhuanlan.zhihu.com/write",
    officialHint: "打开官方文章编辑器，粘贴正文后检查排版",
    checkLabels: {
      factual: "关键观点与资料出处",
      privacy: "平台版本独立审阅",
      rights: "图片使用权与外链",
      layout: "平台真实展示预览",
    },
  },
];

const CHECK_TOTAL = 4;

function boolChecks(channel) {
  const raw = channel?.checks && typeof channel.checks === "object" ? channel.checks : {};
  return CHECK_ORDER.map((k) => raw[k] === true);
}

// RD-01（Run D，Branch A）：checklist 版本指针与当前文档修订不一致 → 检查已过期。
// 防御性派生：当前已知路径 reset-on-save 已使「检查 valid 但内容已变」不可达，
// 恒 false；旧行无指针（null）恒 false——不批量翻旧账，旧行为兼容。
export function checksStale(entry) {
  const pointer = entry?.checkedRevision;
  if (pointer == null) return false;
  return pointer !== entry?.document?.revision;
}

// One channel's real check state + the export blockers the domain
// service would enforce (src/editorial.mjs:141-147 _canExport, surfaced
// here only as hints; the server stays the single source of truth).
// RD-02（Run D，ManualPublishPage.tsx:211-215 语义）：reviewReady = 全勾且无
// 「复核类」blockers；statusTag 三分——reviewReady「检查完成」success、全勾但有
// 复核类 blockers「需复核」warning、否则「待确认」（现状）。「复核类」按规格
// 所指为主稿更新/待处理更正（+RD-01 checksStale 防御项）；「渠道稿还没有正文」
// 是提示性 blocker：保持现行列表渲染，但不把种子渠道的全勾状态翻成需复核
// （既有 creator-v2-publish 用例编码了该对照态，见 QA Run D 偏差登记）。
export function channelState(channel) {
  const values = boolChecks(channel);
  const done = values.filter(Boolean).length;
  const allChecked = done === CHECK_TOTAL;
  const recheck = [];
  if (checksStale(channel))
    recheck.push("检查记录对应的稿件版本已变化，请重新逐项检查");
  if (channel?.masterOutdated) recheck.push("主稿更新后尚未复核渠道稿");
  const open = Number(channel?.openCorrections) || 0;
  if (open > 0) recheck.push(`存在 ${open} 项待处理的更正任务`);
  const blockers = [...recheck];
  if (!channelHasContent(channel))
    blockers.push("渠道稿还没有正文（仍是初始段落）");
  const reviewReady = allChecked && recheck.length === 0;
  return {
    values,
    done,
    total: CHECK_TOTAL,
    allChecked,
    reviewReady,
    statusTag: reviewReady
      ? { label: "检查完成", tone: "success" }
      : allChecked
        ? { label: "需复核", tone: "warning" }
        : { label: "待确认", tone: "warning" },
    blockers,
  };
}

// Top strip state — the design pill (creator-v2.2.html:179) driven by the
// real checkboxes of both channels, never by delivery success. RD-02：pill
// 同步 reviewReady 口径——有渠道全勾但存在 blockers → 「有渠道稿需复核」。
export function publishState(project) {
  const channels = project?.channels || {};
  const per = PUBLISH_CHANNELS.map((meta) => ({
    meta,
    state: channelState(channels[meta.key]),
  }));
  const pending = per.filter((x) => !x.state.allChecked);
  const recheck = per.filter((x) => x.state.allChecked && !x.state.reviewReady);
  return {
    per,
    pendingCount: pending.length,
    pill: recheck.length
      ? { label: "有渠道稿需复核", tone: "warning" }
      : pending.length
        ? { label: "有检查项未完成", tone: "warning" }
        : { label: "两渠道检查已完成", tone: "success" },
  };
}

// fact/operation label maps (kinds: src/publishing.mjs export/draft/report
// paths; states: sending/succeeded/failed/outcome_unknown).
export const FACT_KIND = {
  exported: "已导出本地交付包",
  draft_saved: "公众号草稿已保存",
  published: "作者报告已发表（未经平台核验）",
};
export const FACT_EVIDENCE = {
  provider_response: "平台接口回执",
  author_report: "作者记录",
  local_export: "本地导出",
};
export const OPERATION_STATE = {
  sending: "草稿发送中",
  succeeded: "草稿已保存",
  failed: "发送失败",
  outcome_unknown: "发送结果待核实",
};

function channelShort(key) {
  return PUBLISH_CHANNELS.find((c) => c.key === key)?.short || key;
}

function factRow(fact) {
  const kind = FACT_KIND[fact.kind] || fact.kind;
  const evidence = FACT_EVIDENCE[fact.evidence] || fact.evidence;
  let detail = `${channelShort(fact.channel)}稿 v${fact.revision} · ${evidence}`;
  if (fact.kind === "draft_saved") {
    const mediaId = fact.value?.mediaId ? `草稿标识 ${fact.value.mediaId}` : "草稿标识由作者核对记录";
    detail += ` · ${mediaId} · 草稿保存不是发布`;
  } else if (fact.kind === "exported") {
    detail += " · 导出不是发布";
  } else if (fact.kind === "published") {
    detail += ` · ${fact.value?.url || "未记录链接"} · 平台未独立核验`;
  }
  return { tone: "done", title: kind, detail, at: fact.createdAt };
}

function operationRow(op) {
  const label = OPERATION_STATE[op.state] || op.state;
  const tone = op.state === "succeeded" ? "done" : "pending";
  return {
    tone,
    title: `${channelShort(op.channel)}草稿发送 · ${label}`,
    detail: `${op.detail || ""}（v${op.revision}）`,
    at: op.updatedAt || op.createdAt,
    operationId: op.state === "outcome_unknown" ? op.id : undefined,
  };
}

// 本篇交付时间线 (design .v2-delivery-log, creator-v2.2.html:179) from
// real domain rows only. Chronological ascending; pending rows the
// design hard-codes are emitted ONLY while they are actually true.
export function buildDeliveryTimeline({ project, history } = {}) {
  const channels = project?.channels || {};
  const rows = [];
  const masterRev = channels.master?.document?.revision;
  const parts = PUBLISH_CHANNELS.map((meta) => {
    const rev = channels[meta.key]?.document?.revision;
    return `${meta.short}稿 ${rev === undefined ? "未创建" : `v${rev}`}`;
  });
  rows.push({
    tone: "done",
    title: "已准备主稿与平台版本",
    detail: `主稿 ${masterRev === undefined ? "未创建" : `v${masterRev}`} · ${parts.join(" · ")}；平台版本使用独立正文修订，原始主稿不会被自动改写。`,
  });

  const checks = PUBLISH_CHANNELS.map((meta) => ({
    meta,
    state: channelState(channels[meta.key]),
  }));
  const finished = checks.filter((x) => x.state.allChecked);
  if (finished.length) {
    // RD-01 Branch A：勾选时盖章 checkedRevision（setChecks），此处随行透出
    // 「核对于 vN」溯源；旧行无指针 → 「核对版本未记录」，不伪造版本号。
    const provenance = finished
      .map((x) => {
        const rev = channels[x.meta.key]?.checkedRevision;
        return rev != null
          ? `${x.meta.short}核对于 v${rev}`
          : `${x.meta.short}核对版本未记录`;
      })
      .join("，");
    rows.push({
      tone: "done",
      title: `人工核查完成：${finished.map((x) => x.meta.name).join("、")}`,
      detail: `四项检查按渠道独立记录（${provenance}）；勾选不代表已导出或已发布。`,
    });
  }
  if (checks.some((x) => !x.state.allChecked)) {
    rows.push({
      tone: "pending",
      title: "等待完成发布前核查",
      detail:
        "证据、隐私、权利与最终平台展示需要逐项确认。" +
        checks.map((x) => `${x.meta.short} ${x.state.done}/${x.state.total}`).join(" · "),
    });
  }

  const facts = (Array.isArray(history?.facts) ? history.facts : [])
    .slice()
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  for (const f of facts) rows.push(factRow(f));
  const ops = (Array.isArray(history?.operations) ? history.operations : [])
    .slice()
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  // succeeded 草稿发送已由 draft_saved 事实行表达，不重复成行。
  for (const o of ops) {
    if (o.state === "succeeded") continue;
    rows.push(operationRow(o));
  }

  const published = facts.some((f) => f.kind === "published");
  if (!published) {
    rows.push({
      tone: "pending",
      title: "真实发布状态尚未确认",
      detail: "导出与草稿箱推送都不是发布；真实发布由你在平台后台完成，并回到本页记录链接。",
    });
  }
  return rows;
}

// ---- 本地排版示意（发布效果预览） --------------------------------
// A deliberately small text-level view of the channel's REAL markdown
// (writing.document). It is labelled 本地排版示意 in the UI and never
// claims to be a platform render. External image URLs are NOT loaded —
// they render as a placeholder note; only local asset:// images get the
// same placeholder treatment with the asset alt text.
function stripInline(text) {
  return String(text)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .trim();
}

export function previewBlocks(markdown, { limit = 14 } = {}) {
  if (typeof markdown !== "string") return [];
  const blocks = [];
  for (const rawLine of markdown.split(/\r?\n/)) {
    if (blocks.length >= limit) break;
    const line = rawLine.trim();
    if (!line) continue;
    const image = line.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/);
    if (image) {
      blocks.push({
        type: "image",
        alt: image[1] || "文章图片",
        local: image[2].startsWith("asset://"),
      });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const text = stripInline(heading[2]);
      if (text) blocks.push({ type: "h", text });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const text = stripInline(line.replace(/^>\s?/, ""));
      if (text) blocks.push({ type: "quote", text });
      continue;
    }
    const list = line.match(/^[-*+]\s+(.*)$/) || line.match(/^\d+[.)]\s+(.*)$/);
    if (list) {
      const text = stripInline(list[1]);
      if (text) blocks.push({ type: "li", text });
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      blocks.push({ type: "hr" });
      continue;
    }
    const text = stripInline(line);
    if (text) blocks.push({ type: "p", text });
  }
  return blocks;
}

// A channel is preview-worthy when its document carries real content
// beyond editorial's untouched seed paragraph (same rule as
// src/creator-home.mjs / works-library.mjs).
export function previewReady(channel) {
  return channelHasContent(channel);
}

export function seedParagraphPreviewNote() {
  return `渠道稿还没有正文；完成写作后这里显示当前稿的本地排版示意。`;
}

export { SEED_PARAGRAPH_TEXT };

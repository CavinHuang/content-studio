import { ValidationError } from "./verification.mjs";
const fail = (message, status = 400) => {
  throw new ValidationError(message, status);
};
const trim = (value, n) => String(value ?? "").slice(0, n);
const noArgs = { type: "object", properties: {}, additionalProperties: false };
const editItem = {
  type: "object",
  properties: { from: { type: "integer" }, to: { type: "integer" },
    original: { type: "string" }, replacement: { type: "string" } },
  required: ["from", "to", "original", "replacement"],
  additionalProperties: false,
};

export const AGENT_TOOLS = {
  read_document: {
    name: "read_document", writes: false,
    description: "读取当前稿件：修订号、标题、简报与全文 Markdown。",
    parameters: noArgs,
    async execute(core, ctx) {
      const doc = core.writing.document(ctx.projectId, ctx.channel);
      return { revision: doc.revision, title: doc.title, brief: doc.brief || null, markdown: trim(doc.markdown, 60000) };
    },
  },
  read_brief: {
    name: "read_brief", writes: false,
    description: "只读取创作简报与目标平台。",
    parameters: noArgs,
    async execute(core, ctx) {
      const doc = core.writing.document(ctx.projectId, ctx.channel);
      return { brief: doc.brief || null, channel: ctx.channel };
    },
  },
  read_context: {
    name: "read_context", writes: false,
    description: "读取创作上下文：有效画像、版本、已选素材与排除数量。",
    parameters: noArgs,
    async execute(core, ctx) {
      const c = core.creator.context(ctx.projectId, ctx.channel);
      return { revision: c.revision, profileRevision: c.profileRevision, profile: c.profile,
        sources: (c.sources || []).map(s => ({ id: s.id, name: s.name, kind: s.kind, unavailable: !!s.unavailable })),
        excludedCount: (c.excluded || []).length };
    },
  },
  search_assets: {
    name: "search_assets", writes: false,
    description: "检索作者资产库（文章、图片、素材）。",
    parameters: { type: "object", properties: { q: { type: "string" }, kind: { type: "string" }, tag: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 30 } }, additionalProperties: false },
    async execute(core, ctx, args) {
      const results = core.creator.library({ q: args.q, kind: args.kind, tag: args.tag });
      return Array.isArray(results) ? results.slice(0, Math.min(Number(args.limit) || 10, 30)) : results;
    },
  },
  write_suggestions: {
    name: "write_suggestions", writes: true,
    description: "提交最多 12 处互不重叠的修改建议，由作者逐项审阅接受。",
    parameters: { type: "object", properties: { reason: { type: "string" }, edits: { type: "array", maxItems: 12, items: editItem } }, required: ["reason", "edits"], additionalProperties: false },
    async execute(core, ctx, args) {
      return core.writing.persistSuggestions(ctx.projectId, ctx.channel, {
        expectedRevision: ctx.expectedRevision(), edits: args.edits,
        instruction: "agent：" + ctx.skillTitle, reason: String(args.reason || ""), runId: ctx.runId });
    },
  },
  write_revision: {
    name: "write_revision", writes: true, mode: "revisions",
    description: "以完整 Markdown 创建正文新修订（仅直写模式可用）。",
    parameters: { type: "object", properties: { markdown: { type: "string" }, reason: { type: "string" } }, required: ["markdown", "reason"], additionalProperties: false },
    async execute(core, ctx, args) {
      const saved = core.writing.save(ctx.projectId, ctx.channel, { expectedRevision: ctx.expectedRevision(), markdown: trim(args.markdown, 150000), note: String(args.reason || "").slice(0, 500) });
      ctx.onWritten(saved.revision);
      return { revision: saved.revision };
    },
  },
  plan_illustrations: {
    name: "plan_illustrations", writes: false,
    description: "为当前主稿创建配图计划（未配置规划模型时为本地模板方案）。",
    parameters: noArgs,
    async execute(core, ctx) {
      const master = core.writing.document(ctx.projectId, "master");
      return core.illustrations.plan(ctx.projectId, { expectedMasterRevision: master.revision });
    },
  },
  generate_image: {
    name: "generate_image", writes: true,
    description: "对指定配图 shot 生成图片候选，消耗图片请求额度；失败如实返回。",
    parameters: { type: "object", properties: { shotId: { type: "string" }, provider: { type: "string" } }, required: ["shotId", "provider"], additionalProperties: false },
    async execute(core, ctx, args) {
      return core.illustrations.generate(ctx.projectId, String(args.shotId), { allowExternalAI: true, provider: String(args.provider), maxAttempts: 1, fallbackProviders: [] });
    },
  },
  render_xhs_group: {
    name: "render_xhs_group", writes: true,
    description: "渲染当前小红书图组全部未生成页面，产生图组新修订。",
    parameters: { type: "object", properties: { generateVisuals: { type: "boolean" } }, additionalProperties: false },
    async execute(core, ctx, args) {
      const plan = core.xhs.get(ctx.projectId);
      if (!plan) fail("小红书图组不存在，请先在平台稿中规划", 404);
      return core.xhs.render(ctx.projectId, plan.id, { expectedRevision: plan.revision, generateVisuals: !!args.generateVisuals, allowExternalAI: true });
    },
  },
  edit_xhs_page: {
    name: "edit_xhs_page", writes: true,
    description: "按自然语言修改小红书图组的指定页（可拆页），产生新修订。",
    parameters: { type: "object", properties: { pageId: { type: "string" }, instruction: { type: "string" }, generateVisuals: { type: "boolean" } }, required: ["pageId", "instruction"], additionalProperties: false },
    async execute(core, ctx, args) {
      const plan = core.xhs.get(ctx.projectId);
      if (!plan) fail("小红书图组不存在", 404);
      return core.xhs.edit(ctx.projectId, plan.id, { expectedRevision: plan.revision, pageId: String(args.pageId), instruction: trim(args.instruction, 2000), generateVisuals: !!args.generateVisuals, allowExternalAI: true });
    },
  },
};

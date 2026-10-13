# Content Studio · Next.js + doocs/md（V37）

聚合 AI 行业变化与创作者的一手实践，以证据为基础完成「发现 → Brief → 编辑 → 分渠道审核 → 本地交付 → 研究复盘」。

**当前状态：Next.js App Router 迁移工程 / 单用户本地开发版。不可直接公网部署。**


## V37：系列视觉资产与显式参考图复用

- `/illustrations` 新增系列面板：明确创建/加入一个视觉系列，维护独立版本的视觉规范，并**手动**应用到当前文章；更新不会静默覆盖其他文章。
- 作者可以把本篇已批准配图**逐张授权**给系列参考图库，另一个已加入的文章可选择共享图用作图片编辑输入。已有外部模型授权与人工候选选择仍然生效。
- V36 的文章内记忆默认**不出本篇**；只有再次显式分享的反馈，才可以作为该系列成员后续提示词的低信任创意偏好。共享可撤销，正文改动/审批撤销也会让相关参考图不可用。
- 业务权限基于系列成员身份和源文章记录；底层通用素材库仍是**可信本地单用户**资源，不具备多用户图片 ACL，不得直接公网部署。详情见 [`docs/V37-VISUAL-SERIES.md`](docs/V37-VISUAL-SERIES.md)。

## V36：候选双图对比、作者反馈与视觉记忆

- `/illustrations` 对每张候选并排展示**参考图 / 候选图**，并允许通过视觉模型对“是否按编辑要求修改、风格是否保持一致”进行**辅助对比**。调用前必须单独授权将两张图片发给模型。
- 作者可以保存一条不可变的候选反馈（更好 / 原图更好 / 仍需修改），勾选「记住偏好」后，最多六条来自**同一文章**的反馈将影响下一次生成与编辑提示词。没有勾选时仅保留历史记录。
- AI 评审不能自动批准、选中或发布图片；视觉记忆不会静默修改现有已批准的图片。旧的文章版本、渠道图片映射和 doocs/md 排版复核仍独立执行。
- 对比继续使用服务器端 `CONTENT_IMAGE_REVIEW_*` 环境变量，依赖同时支持两张图片输入的 OpenAI-compatible 视觉理解模型。详见 [`docs/V36-IMAGE-FEEDBACK-MEMORY.md`](docs/V36-IMAGE-FEEDBACK-MEMORY.md)。

## V35 · 参考图编辑与候选对比

`/illustrations` 增加独立的参考图编辑流程：选择当前配图或同配图位候选图、填写修改指令、通过 OpenAI / Nano Banana / Qwen 编辑接口生成**新候选**，保留原图并进行人工取舍。选择候选后不自动批准，新图不会继承旧素材的平台映射。每次编辑单独授权、单次 API 调用，无隐式回退。参见 `docs/V35-REFERENCE-EDITING.md`。

## 技术栈

- **Next.js 16.2 系列 / React 19 / App Router**。新页面使用原生 React 组件和响应式 CSS，不是旧 HTML iframe。
- **Node.js 22.13+ 自带 `node:sqlite`**，共享原 V27 SQLite 领域服务与全部既有业务规则。
- 同源 Route Handlers：`/api/[...parts]` → `lib/api.mjs` → `src/*.mjs`。
- 本地 SQLite 持久化，默认数据库 `data/content-studio.sqlite`；**不同版本操作同一数据库前务必备份**。

## 本机启动

```bash
# Node.js >=22.13
npm install
npm run dev
# 打开 http://127.0.0.1:4312
```

Windows PowerShell：

```powershell
npm install
npm run dev
```

正式构建与本地启动：

```bash
npm run build
npm start
```

默认只监听 `127.0.0.1`；不能当作已经具备用户认证的 SaaS 部署。不要直接改成公开监听地址。**禁止上传个人 SQLite、API Key、研究笔记和私密原文**到 GitHub。

### 首次使用

1. 「今日」可以直接新建原创草稿，不依赖任何新闻源。
2. 「信源管理」尝试同步 AIHOT、GitHub Release、Hacker News 和官方 RSS，**真实接口需要外网和对应授权**。
3. 「内容发现」查看聚合事件，逐条检查证据来源，选择事件创建 Brief 和独立文章。
4. 「创作」维护 `master`、`wechat` 和 `zhihu` 三份独立版本；渠道稿不会自动被主稿覆盖。
5. 「发布」分别确认事实、隐私、权利和排版后本地导出。导出 **不代表真实发布**。

只有明确启用环境变量 `ENABLE_SCENARIO=1` 才允许 `POST /api/fixture/seed` 载入演示数据。默认空数据库展示空状态。

### 迁移范围

| 功能 | Next.js React 工作台 | 复用 V27 领域 API | 边界 |
|---|---|---|---|
| 今日、全局导航 | 已迁移 | 状态 / 文章 / 研究 | 本地状态 |
| 信息源与事件发现 | 已迁移 | 实时同步 / 事件 / Brief | 外部连通性待验收 |
| 统一文章编辑 | 主创作入口为 /compose；/editor 负责证据和复核 | SQLite 版本和冲突检查 | 富文本块待迁移 |
| 双渠道审核 / 导出 | 已迁移 | 四项审核 / 快照 / URL 报告 | 平台不自动发布 |
| 复盘与知识总览 | 已迁移总览 | 验证 / 知识 / 反馈 | 深度操作可打开兼容页 |
| 精准证据锚点与更正 | 保留兼容页 | V26/V27 APIs 不变 | 原生 Next 交互尚待接入 |
| V21 旧原型 | 提供 `/app.html` 等兼容页面 | 旧 API 仍可用 | 旧 localStorage 不自动双向同步 |

遗留 HTML 在 `public/*.html` 和 `public/legacy/*.html`，便于迁移核对；Next.js 页面是 `/`, `/discover`, `/editor`, `/publish`, `/review`, `/sources`, `/validation`, `/knowledge`。

## 测试

```bash
npm test           # 业务 / HTTP / 新 Next 请求桥接契约测试
npm run check      # Node 语法检查
npm run build      # Next.js 构建（需要 npm 安装依赖）
```

注意：本次交付环境无法解析 `registry.npmjs.org`，所以无法安装 Next/React 包，**尚未执行真实 Next.js build 或浏览器渲染测试**。已经执行并通过的是 Node 领域服务、Route Handler 核心请求调度的自动化测试；首次联机后必须按 `docs/QA.md` 做 Next 浏览器验收。

## GitHub 推送

GitHub 连接的身份为 `CavinHuang`，目标仓库 `CavinHuang/content-studio`。远程仓库现已创建且 V29 全量源码已提交到 `main`：https://github.com/CavinHuang/content-studio 。后续功能开发使用独立分支 + Pull Request，避免未经评审直接覆盖主分支。当前仓库公开，不能把任何个人数据、SQLite 或密钥提交到 GitHub。

## 工程交接

- `docs/ARCHITECTURE.md`：API / Store / Next 与版本关系
- `docs/MIGRATION.md`：迁移决策、已完成与下一步
- `docs/QA.md`：已测范围和待联网验收
- `docs/GITHUB.md`：GitHub 新仓、推送和 CI 操作
- `AGENTS.md`：编码约束与安全红线


## 成熟公众号排版工作区（V29）

为避免重复实现排版编辑器，`/compose` 改用 [doocs/md](https://github.com/doocs/md)（WTFPL 许可证）作为独立微信 Markdown 排版器。**doocs/md 是独立 Vue 应用，不是我们直接调用的 React SDK。**

启动可选的本地独立排版服务：

```bash
docker compose -f docker-compose.doocs.yml up -d
# Next.js 服务另开一个终端运行：npm run dev
```

设置 `.env.local` 中的 `NEXT_PUBLIC_DOOCS_MD_URL=http://127.0.0.1:8800/` 后，可在 `/compose` 使用本地排版器。工作流为：选稿 → 复制/导出 Markdown → 在 doocs/md 排版 → 导出 .md → 回到 Content Studio 导入保存 Markdown 修订 → 人工核查和公众号后台粘贴验证。**没有自动双向同步、自动发布或平台核验。**

- 公众号与知乎的排版修订分别保存在 `editorial_layout_drafts` / `editorial_layout_history`。
- 导入必须匹配文章正文源版本、排版稿修订版本；冲突返回 409，防止旧内容覆盖。
- 导入撤销本渠道人工核查。旧的纯文本 HTML 导出会被阻止，避免交付与 doocs/md 排版内容不一致的旧文。
- 导入 Markdown **不会自动重新建立段落级事实引用**。原有知识引用和精准更正仍可在 `/editor` 查阅；内容变动必须人工审查。
- 建议用本机 Docker/CLI 实例；主动选择公网站点前需评估隐私。第三方软件的主题、图床与微信粘贴兼容仍要实际测试。

这一版是 **独立排版器交接集成**；不意味着 doocs/md 已作为 React 组件内嵌或支持全自动回存。


## V30 · 排版 Markdown 导回前差异审阅

- 进入 `/compose`，选择渠道稿，在 doocs/md 中排版，导回 `.md` 或手动粘贴。
- **先点击「检查导回内容与原文差异」**：服务端返回未匹配的原文段落、新增/改变的 Markdown 块、链接与图片地址、原句重排和现有证据的待核对状态。
- 文字变化时作者需逐项检查并勾选确认，然后保存新的渠道布局版本。没有服务端审阅令牌的变更提交会被拒绝（409）。
- 每次导回的审阅摘要保存到 `editorial_layout_review_history` 并关联不可变 `editorial_layout_history`，供日后追溯。
- 即使文字完全一致，证据和事实也**不会自动认证**。旧渠道的事实／隐私／引用权利／布局检查在任何导回后失效，且不会自动向平台发布。
- 这一分析是保守的文本比对，**不是完整 Markdown AST 或事实核查器**。复杂排版可能出现误报；图片、外链变化需要人工核对；复制到真实微信公众号/知乎的排版兼容尚未验收。

参阅 `docs/V30-ROUNDTRIP-REVIEW.md`。

## V31 · 排版渠道兼容性预检（继续基于 doocs/md）

- 在 `/compose` 导回 doocs Markdown 后，V30 内容差异与 V31 兼容检查一并展示。
- 本地图片、动态 HTML、危险 URL、未闭合代码围栏会阻断**存档该渠道新版本**，即使作者已勾选其他确认项。
- 表格、代码、引用、外部图片不被假定为“复制到微信/知乎一定可用”，而是需要人工到真实平台测试。
- 可下载每渠道独立的人工测试记录 JSON，注明内容哈希及证据。实际测试尚未执行。
- 测试：`node --test test/markdown-compat.test.mjs`，详见 `docs/V31-COMPATIBILITY.md`、`docs/fixtures/`。

## V32 · 写完文章后由 Agent 自动配图

进入 `/compose` 点击「Agent 自动配图」，或直接访问 `/illustrations?project=<project-id>`。

- **生成计划（离线）**：依据当前主稿生成封面和最多两张章节概念插画的提示词，不会发送数据到模型。
- **模型生成（可选，真实生成）**：配置 `.env.local` 中的 `CONTENT_IMAGE_API_BASE_URL`、`CONTENT_IMAGE_API_KEY`、`CONTENT_IMAGE_MODEL` 后，由作者明确勾选发送摘要的授权，逐张调用图像模型并保存在本地素材库。未配置时不能生成图片，不会出现伪造结果。
- **人工批准与跨渠道映射**：作者选定图片，为公众号、知乎分别登记在 doocs/md／目标平台手动上传后的 HTTPS 地址；平台是否转存成功必须实测。
- **生成带图 Markdown 提案**：只能安全插入确切定位的已批准配图，缺失 URL 或找不到段落时明确显示未完成；不会覆盖正式渠道稿，仍须 V30 差异审阅及 V31 平台检查。

详见 [`docs/V32-AUTO-ILLUSTRATION.md`](docs/V32-AUTO-ILLUSTRATION.md)。**AI 概念插画不能充当研究证据**，模型生成、素材复制和外部发布均不自动完成事实验证。

### V33 · 多供应商图片 Agent 与提示词设计

`/illustrations` 已支持按张选择 OpenAI GPT Image、Google Nano Banana 或 Qwen Image，逐张预览该供应商最终 Prompt、编辑视觉场景和风格，以及可选的文本规划模型来改写配图方案。外部调用需手动授权；图片返回本地私有素材库，不会被直接发布。详见 [V33 Agent 实现契约](docs/V33-ILLUSTRATION-AGENT.md) 与 `.env.example`。

## V34 · 视觉规范、图片质量辅助评审、显式多模型回退

`/illustrations` 新增每篇文章的视觉规范（支持从其他文章显式复制风格），封面与章节图共用画面配色和氛围。修改规范会使旧配图退回待生成，**不会继续沿用旧图批准**。

生成失败时可由作者自行勾选“有限多模型回退”：最多尝试 3 个已配置、互不重复的供应商；只对限流/临时服务故障尝试下一个，生成尝试记录可在配图卡片展开查看。每次 API 调用可能产生费用。

增加单独授权的图片评审：上传本地已生成图像到配置的视觉理解模型，获得 `looks_consistent`、`needs_revision` 或 `uncertain` **建议**；不会自动批准图片或确认事实、版权和真实平台效果。未配置模型时仍可人工审阅。

新增可选服务端环境变量 `CONTENT_IMAGE_REVIEW_BASE_URL`、`CONTENT_IMAGE_REVIEW_MODEL`、`CONTENT_IMAGE_REVIEW_API_KEY`；必须使用支持视觉消息的 OpenAI-compatible Chat Completions 服务，**不等同于 Nano Banana 的生成图接口**。详见 [V34 工程契约](docs/V34-VISUAL-CONSISTENCY-REVIEW.md)。

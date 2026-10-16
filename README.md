# Content Studio · Next.js + doocs/md（V51）

聚合 AI 行业变化与创作者的一手实践，以证据为基础完成「发现 → Brief → 编辑 → 分渠道审核 → 本地交付 → 研究复盘」。

**当前状态：Next.js App Router 迁移工程 / 单用户本地开发版。不可直接公网部署。**

## V51 · 真正 doocs/md 实例浏览器交接

- 在 CI 中运行固定版本的真实 `doocs/md:2.1.0` Docker 排版器，使用 Chromium 将本地 Content Studio 创建的**合成文章**从排版页复制到真正 doocs CodeMirror，并核实第三方编辑器的预览结果。不再局限于探测一个 HTTP HTML 首页。
- `npm run test:doocs:real` 是独立验收命令，需要本机 doocs 容器和 Chromium；普通 `npm run test:e2e` 仍能离线独立运行。第三方页面向外部域名的浏览器请求在验收时会被拦截，防止合成草稿内容外流。
- 此项通过代表**真实编辑器输入和 Markdown 预览可用**，不代表 doocs 导出文件无差异或真实公众号/知乎已接受内容；后两者仍须人工实测。
- 详见 [V51 实际 doocs 容器与浏览器交接验收](docs/V51-REAL-DOOCS-ACCEPTANCE.md)。

## V50 · 本机排版器连通性与安全构建

- `/compose` 新增本机 doocs/md 连接状态和手动重试；`npm run doocs:preflight` 可单独探测排版器的 HTTP HTML 首页（默认本机 `127.0.0.1:8800`），**不传输文章、不会跟随外部重定向**。服务可连接不代表已经验证 doocs 身份、排版格式或公众号粘贴。
- `npm run build` 新增构建前凭据检查：从 Next.js 环境文件加载配置，发现已赋值的 `NEXT_PUBLIC_*SECRET / TOKEN / API_KEY` 等字段时拒绝构建，防止密钥进入浏览器构建产物。可先执行 `npm run build:preflight`。
- CI 新增本机 HTTP、危险地址、重定向、公开密钥配置及浏览器状态刷新回归。真实 doocs/md 页面、微信/知乎发布和付费图片模型仍必须单独人工验收。
- 详见 [V50 排版器联通与安全构建](docs/V50-DOOCS-BUILD-SAFETY.md)。

## V49 · 真正 Next.js 生产启动与重启验收

- `npm start` 改为调用有安全检查的本地启动脚本：遵循 Next.js 的环境文件优先级进行检查，禁止匿名远程开放、演示数据注入、非持久 SQLite、危险的 `NEXT_PUBLIC_*` 密钥配置和 SQLite 符号链接，并强制只监听 `127.0.0.1`。
- `npm run runtime:preflight` 用于启动前本地配置检查，不向控制台输出密钥值。`npm run build && npm run test:production` 新增真正构建后的 **启动 → HTTP 写入文章/排版/审核 → 停进程 → 再启动 → 读取持久化数据** 的自动测试。测试使用一次性数据库，无付费 API。
- 主分支 CI 加入生产进程重启验收；仍需单独在真实供应商、doocs/md 和公众号/知乎做明确授权的实际联调。
- 详见 [V49 本地生产启动与运行验收](docs/V49-RUNTIME-ACCEPTANCE.md)。

## V48 · 主分支集成与双阶段 CI

- 将 V30–V47 这条经审查的线性历史整理为 **一个面向 main 的集成候选版本**，保留原始提交，而非把 18 个 Draft PR 反复 squash/rebase。V37 沿 PR #9 进入集成，PR #8 属于独立备选，不能混入。
- 解决集成后遗留的 Git 校验误报：新增 `npm run verify:integration`，在合并前检查完整堆叠分支，在合并后检查主线的不可变提交祖先；以后从 main 发起的 PR 也会使用正确模式。增加 `npm run verify:main` 对主线独立复核。
- 主分支实际 CI 仍执行 Node/API、恢复、发布安全、恢复副本业务集成、Next.js 构建及 Chromium E2E；**CI 通过并不意味着生产平台已部署或支付模型已验证**。
- 具体集成流程、可验证的提交锚点、失败回退与仍需人工完成的验收，见 [V48 主分支集成说明](docs/V48-MAINLINE-INTEGRATION.md)。

## V47 · 恢复副本上的完整业务验收

- 新增 `npm run release:rehearse -- --db=/绝对路径/content-studio.sqlite`：使用 SQLite 一致性备份创建一次性恢复副本，加载 V47 业务服务，遍历历史文章，再用合成项目模拟 **公众号与知乎两条完整交付流程**。
- 在运行新服务、模拟写入之前和之后核对**所有原有业务表的逐行内容指纹**（包含图片 BLOB），防止原数据库中的文章、素材、渠道映射或审核证据遭到悄然改写。模拟项目只出现在一次性副本中，结束自动删除。
- `npm run release:admission -- --db=/路径/内容库.sqlite --backup=/路径/备份.sqlite --rehearse --integration` 将额外执行本轮应用级验收并标注候选版状态，但 **`productionReady`、`platformVerified` 始终为 false**，不会调用真实付费图片模型或访问发布平台。
- 检查真实私人数据库时请使用受信任、临时存储加密的机器：演练期间临时副本包含明文草稿和图片，删除临时副本并不等同于对磁盘安全擦除。
- 详见 [V47 业务集成验收及操作手册](docs/V47-RESTORED-DATA-ACCEPTANCE.md)。此阶段只验证候选分支，历史 Draft PR 仍未合并主分支。

## V46 · 集成候选版验收

- 新增 `npm run verify:stack`，通过真实 Git 祖先关系检查 **main → V30 → … → V45 → V46**，防止把 V37 的备选 PR #8 混入沿 PR #9 延续的正确实现。
- 改进 `db:rehearse`：不再只对比 SQLite 行数，而是检查每个历史业务表的**完整内容指纹**，包括文章正文和图片二进制。仅允许启动时增量注册新信息源，已有来源数据必须保持不变。
- 新增 `npm run release:admission -- --db=/路径/内容库.sqlite --backup=/路径/备份.sqlite --rehearse`：只读汇总数据库、备份、升级演练、供应商配置与真实平台的待人工验收项。即便本地校验全绿，也始终标记 `productionReady: false`，不会请求付费模型、发布文章或合并代码。
- 新增篡改正文 / BLOB / 来源状态的负向测试和独立 CI 验收步骤；详见 [V46 集成候选版验收与发布手册](docs/V46-RELEASE-CANDIDATE.md)。

## V45 · 数据库升级与恢复可靠性

- 为 SQLite WAL 模式添加 **真实一致性备份**、SHA256 清单和数据库完整性验证，严禁直接复制正在写入的 `.sqlite` 文件冒充备份。
- 本地 CLI：`npm run db:preflight`（只读健康检查），`npm run db:backup`（自动写入忽略版本控制的 `data/backups/`），`npm run db:restore -- --from=... --to=...`（**仅恢复到新的、不存在的路径**），`npm run db:rehearse`（临时库模拟备份、恢复与当前版本初始化）。
- 如需要检查指定数据库路径，可以追加 `-- --db=/绝对路径/内容库.sqlite`。进行任何正式升级前，请保留离线、独立位置的备份，并先核验清单；不要提交数据库、备份、测试报告或私有文章到 GitHub。
- V45 要求 Node.js **22.16+** 才能使用内置 `node:sqlite.backup`。备份/恢复工具不会替换正在运行的原数据库，不是无人值守升级器，也不代表已完成真实生产数据库的演练。
- 详见 [V45 升级与灾备操作手册](docs/V45-DATABASE-RECOVERY.md) 和 [连续 PR 合并顺序与 V37 分叉说明](docs/V45-STACK-INTEGRATION-PLAN.md)。

## V44 · 统一交付验收

- 新增 [文章交付验收工作台](/delivery)：针对公众号和知乎分别汇总正文版本、证据更正、四项人工核查、配图批准与质量评价、doocs/md 导回、以及 V40 作者记录的平台图片测试；每个步骤可以直达对应的编辑与审核入口。
- 无配图文章必须**显式记录本渠道、当前版本的无配图理由**，不会无条件跳过图片审核；任何主稿、渠道稿或排版修订都会令既有选择过期。
- 只有六个阶段的本地条件满足后，才允许作者保存不可变的交付核查快照。版本或图片 URL 更改会让旧快照过期。**这不等于已发布，也不意味着 Content Studio 登录或核实了真实平台。**
- 详见 [V44 统一交付验收设计与 API](docs/V44-DELIVERY-READINESS.md)。

## V43 · 图片质量评价与排版导回一致性

- `/illustrations` 增加针对每张已生成配图与候选图的 **作者人工质量评分**：主题匹配、清晰度、手机可读性、视觉风格（各 1–5），风险项、事实与版权人工核查、建议及理由。每条记录不可变，绑定图片 SHA256、图片位与文章/风格版本；不会自动批准图片。
- 导回 doocs/md 后，可对已保存渠道稿运行 **图片一致性检查**，检测漏图、重复、意外 URL、错序及段落锚点异常；也支持直接粘贴 Markdown 做只读预检，不会绕过 V30/V31 审阅或改写稿件。
- 修复导回后再次生成带图 Markdown 时可能重复插入已有图片的问题。质检不额外调用付费模型，不检测真实平台链接可访问性，不代表完成公众号/知乎验收。
- 详见 [V43 质量与图片导回说明](docs/V43-IMAGE-QUALITY-ROUNDTRIP.md)。



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
- **Node.js 22.16+ 自带 `node:sqlite`**，共享原 V27 SQLite 领域服务与全部既有业务规则。
- 同源 Route Handlers：`/api/[...parts]` → `lib/api.mjs` → `src/*.mjs`。
- 本地 SQLite 持久化，默认数据库 `data/content-studio.sqlite`；**不同版本操作同一数据库前务必备份**。

## 本机启动

```bash
# Node.js >=22.16
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

V41 起在 GitHub Actions 中持续执行真实 Next.js 生产构建和 Playwright Chromium E2E；CI 仅验证使用合成数据的本地流程，不代表真实服务商或平台的验收。已经执行并通过的是 Node 领域服务、Route Handler 核心请求调度的自动化测试；首次联机后必须按 `docs/QA.md` 做 Next 浏览器验收。

## GitHub 推送

GitHub 连接的身份为 `CavinHuang`，目标仓库 `CavinHuang/content-studio`。远程仓库现已创建，V30–V48 已通过 PR #20 正式集成至 `main`，V49 后续改动继续走独立 PR：https://github.com/CavinHuang/content-studio 。后续功能开发使用独立分支 + Pull Request，避免未经评审直接覆盖主分支。当前仓库公开，不能把任何个人数据、SQLite 或密钥提交到 GitHub。

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

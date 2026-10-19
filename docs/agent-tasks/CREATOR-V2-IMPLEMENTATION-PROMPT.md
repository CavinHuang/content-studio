# Content Studio Creator V2 — 专业 Coding Agent 主任务书

> 版本 2026-10-19 · 状态：可直接执行的开发委托 / 不是功能已完成声明  
> 仓库：https://github.com/CavinHuang/content-studio  
> 设计 PR：https://github.com/CavinHuang/content-studio/pull/41  
> 设计基线分支：design/creator-v2-2-v2-3-pages-20261019  
> 前端：Next.js 16 App Router / React 19；运行时 Node.js >= 22.16；数据源：已有 SQLite 领域服务。

## 0. 你的身份与目标（直接开始执行，不需要再问是否继续）

你是对此项目负责的资深全栈工程师、UX 工程师与测试负责人。用户已经批准 Creator V2.2 全站 UI/UX 和 V2.3 配图交互设计。你的任务是将**新版 Creator** 从目前难用且分裂的功能集合，重构为**真实可用、数据持久、跨平台响应式**的个人内容创作运营工作台。

这不是纯设计任务，也不是再造一套 AI 平台。交付必须是可以启动、登录/访问、真正创建作品、写作、保存、按段落规划图片、审阅候选、导出/准备渠道稿的应用。不能以“页面长得像了”“假数据演示可点”代替真实功能。

**持续执行原则**：已确定的范围直接推进、边做边测；不要每个页面、每个阶段反复请求用户确认。必须授权才允许执行的外部付费图像生成、真实平台发布、真实部署、合并分支仍须独立权限。不要绕过安全保护、也不要因未获外部授权停止所有可并行的编码与验证。不能合并主分支、不能自行部署生产。

## 1. 分支与完整设计事实源

1. 读取并遵守根目录 AGENTS.md 的安全、数据、Git、Node、Dokploy、发布约束。其关于“森林绿、五项 Creator 导航”的旧视觉基线与此新设计冲突；**新批准的 V2.2/V2.3 设计优先于这两条旧视觉建议**。在实施 PR 中仅修订这两条过时的展示指导，不能删改安全/版本/审计护栏。
2. **远程实施分支已存在：`feat/creator-v2-real-workspace`。** 直接 fetch 并检出该分支，确认它来自 `design/creator-v2-2-v2-3-pages-20261019`；不要重复创建或在设计 PR #41 分支上写生产代码。新实现 PR 的 base 优先设为设计基线分支（stacked PR），待设计 PR 合并后再按实际 Git 历史调整；**不要自行合并**。
3. 先阅读以下**真实已提交的文件**：
   - `public/design/creator-v2.2.html` — 全站高保真视觉 / 页面结构
   - `public/design/creator-v2.3-visual.html` — 配图专项交互
   - `public/design/assets/README.md`、`creator-v2-tokens.json`、三套 SVG 视觉稿和空状态图 — 已入库的设计资产。原阶段 PNG 截图未提交至远程，源 HTML 才是视觉事实源
   - `app/design/creator-v2/page.jsx`、`components/design/CreatorV2Preview.jsx`、`app/design/creator-v2/preview.css` — 可运行的页面交互参考（**使用了模拟数据**）
   - `docs/design/CREATOR-V2-2-FULL-UX-SPEC.md`
   - `docs/design/CREATOR-V2-3-VISUAL-SPEC.md`
   - `docs/design/CREATOR-V2-2-V2-3-UIUX.md`
   - `docs/agent-tasks/CREATOR-V2-ACCEPTANCE.md`
4. 两份 HTML 为视觉/交互优先参考；V2.3 负责图片相关的细节。不要把原型文件里的示例文章、热点排名、图片候选、统计数值或 setState Mock 迁入真实业务。
5. 对照 Easel (ZJU-REAL/Easel) 的内容生命周期和图片产物管理，WeWrite (imraywang/wewrite) 的文章配图策划、风格统一与保留原稿原则；学习设计与工程规则，不依赖远程仓库运行时，不复制违反许可的代码。

## 2. 核心架构：保留存量，重做交互

### 不得破坏

- 单一 Next.js App Router 前端，复用现有后端领域服务，不创建第三套作品/稿件/图片持久化模型。
- 文章 master / wechat / zhihu 独立修订、不可变历史、`expectedRevision` 冲突保护；切换稿件前妥善保存或提示未保存冲突。
- 四项每渠道人工审核；`导出≠草稿箱≠真实发布`；任何外部发布必须单独显式授权。
- 图片生成≠已审核；候选选中≠图片批准；图片批准≠已经插入正文/映射到有效平台 URL；不要用 UI 直接改变审核记录。
- 对外发送私有画像、参考素材、片段与图片或发生付费调用时，必须清楚展示范围、供应商与费用/次数预估并取得对应授权。保留预算、队列、错因、幂等、审计和资源生命周期控制。
- Node 22、node:sqlite、现有安全认证/CSRF/remote origin、Docker/Dokploy 持久卷、V63-V76 构建/审计/回滚护栏；不能为了让界面“跑起来”删掉这些验证。
- 不把密钥、实际私人稿件、原始数据库、外部账号凭据提交到 Git。测试只能用合成数据和假模型。

### 主要文件对应

| 业务能力 | 优先检查、复用/重构 |
|---|---|
| 主导航/首页 | components/CreatorShell.jsx、CreatorHome.jsx、app/page.jsx、app/creator.css |
| 真实热点信源/选题 | components/CreatorTopics.jsx、src/creator.mjs、lib/creator-api.mjs |
| 作品与修订 | components/WritingWorkspace.jsx、src/writing.mjs、src/editorial.mjs、lib/creator-api.mjs |
| 文章编辑器 | components/DoocsEditor.jsx、WritingPreview.jsx、app/compose/page.jsx |
| 配图简化入口 | components/WritingImages.jsx |
| 配图深度交互 | components/IllustrationStudio.jsx、IllustrationQueueWorkspace.jsx、VisualSeriesPanel.jsx |
| 图片业务 | src/illustrations.mjs、illustration-agent.mjs、illustration-queue.mjs、image-providers.mjs |
| 渠道准备与发布 | components/PublishingControls.jsx、src/publishing.mjs |
| 资产/配置 | components/CreatorLibrary.jsx、CreatorSettings.jsx |

### 已有 API 线索（使用前必须校验契约）

- `GET /api/creator/overview`
- `GET /api/creator/sources`、`GET /api/creator/source-items`、`POST /api/creator/source-items/convert`
- `GET/POST /api/creator/topics`、`POST /api/creator/topics/recommend`、`POST /api/creator/topics/:id/start`
- `GET/POST /api/creator/series`
- `POST /api/writing/projects`、已有按 project 和 channel 的写作/保存/审稿 API
- `GET /api/illustrations/projects/:projectId`、`POST .../plan`、已有图片生成/审批/编辑/映射与队列 API
- `GET /api/creator/platforms`、已有 `/api/creator/projects/:id/publishing` 相关操作
- `GET /api/creator/library`、已有模型、渠道、信源配置与授权 API

如果界面需要的字段/操作当前 API 不支持，优先通过**小而可测试的后端适配**补齐，而不是在组件里虚构成功、将数据偷偷保存在 localStorage 或新增平行后端。可复用的现有状态与字段应直接映射。

## 3. 要完成的页面（不允许只完成前几个就宣告全部完成）

### P0-A — 统一 Creator 框架与真实作品主线

- 正式 `/`：真实“继续创作”、最近作品、待处理事项、关键状态。首次使用应有引导与快捷建文；无数据时显示真实空状态，不展示假的 KPI/成就。
- 正式 `/works`：作品搜索、状态筛选、创建、继续、区分主稿与公众号/知乎稿，真实持久化且不丢历史。
- 正式 `/compose?project=...`：以正文为中心，左侧大纲/素材、右侧可切换写作 Agent/事实审查/AI 配图；保存状态可靠，原有 Doocs/editor、预览、修订/回退不丢。避免为不同页面创建不同 shell。
- PC 按 V2.2 11 个工作区统一侧栏；移动端 5 个快捷入口 +“更多”，窄屏单栏，选择、编辑、工具操作的状态在返回时可恢复。导航可用键盘、ARIA 标签、错误提示、真实加载与网络失败状态。

### P0-B — 热点雷达独立页面 + 选题发现

- 新建正式 `/hotspots`，明确与 `/topics` 分离；基于现有信源 `sources/source-items` 展示真实标题、来源、时间、原文链接、同步状态/失败提示。
- 可搜索/过滤来源、查看详情，并将线索**转换为可持久化的选题候选**后跳到 `/topics`。利用既有来源转素材和选题创建接口，确保原文来源可追溯、重复转换有合理提示。
- “上升”“热度评分”“多源证据”**只有后端存在可信计算依据时才能展示**；否则隐藏或标注未计算，绝不将演示分数写成真实指标。
- `/topics` 以读者问题、写作角度、证据缺口、简洁大纲为主，复杂完整简报/版本/批量推荐置于折叠区；能真的从选题创建文章，已有任务消息和数据要保留。
- AI 推荐和私有素材传输保留用户确认及服务配置前置。

### P0-C — V2.3 AI 配图闭环（本次最重要的深度功能）

- 编辑器内以“封面 / 完整配图 / 指定段落”三个模式开始。首先展示建议的**位置、用途、视觉风格、预计张数**；无须先填模型或 Prompt。绑定真实主稿修订及稳定段落 ID。
- `/illustrations?project=...` 为正式视觉工作台：左侧图位列表、中间大图 + 候选版本、右侧 Prompt/自然语言改图/风格配置；手机单栏分段访问。图片状态从真实 API 获取。
- 不允许用原型的 3 张静态 Art 替换生成图片。每一处图位能展示真实空态/计划/生成中/生成失败/生成完成待审/已批准/已插入/失效等状态；保存候选变化和历史。
- **选中候选绝不自动批准或改写文章。** 明确采用操作才调用已有审批 + 插入/渠道映射服务，失败必须保留正文和原历史，不能显示成功消息。任何对当前草稿有冲突的插入需要回到 revision 校验而非强行覆盖。
- 提供单张重新生成、修改 Prompt、参考图（若已有真实 API 可用）、版本对比、拒绝/批准，保留旧图；不能因改图损害其他图位/平台稿。
- 封面与内文图分开，公众号/知乎尺寸与 URL/权利校验分别显示。没有公网有效图片 URL 时，不能声称目标平台编辑器已经验证成功。
- 按既有预算/队列机制发起批处理，尽可能复用 `IllustrationQueueWorkspace`；一张失败不阻塞其他图，允许单图有界重试。不能直接将顺序循环改成无额度、无限并发的对外调用；禁止自动绕过许可/自动付费 fallback。
- 切回 `/compose` 后，以真实已采用图片展示正文预览；切换平台稿不应破坏主稿；计划因源文章变化过期时显示准确消息，不能把旧批准状态悄悄继承。

### P1 — 发布中心、素材、日历、复盘与设置

- `/publish`：正式接管旧 StudioApp 的发布入口，公众号/知乎各自显示检查结果、导出/草稿/平台状态；保留已有发布审计与授权，禁止直接把“发送草稿”说成“正式发布”。
- `/library`：真实素材库、来源、关联作品、图片/参考文档、可复用视觉系列；若某项不可用，呈现可操作的错误而非静态模拟。
- `/calendar`：周/月视图基于已有内容系列/真实作品数据；无排期时为空，不捏造发布日期或默认自动发布。
- `/insights`：有真实数据时基于真实事实展示，未连接统计则清晰显示“暂无已验证平台数据”；风格学习来自经作者确认的修改与反馈，不能伪造点击率/阅读量。
- `/settings`：创作者画像、模型连接、平台账号、热点信源、额度/授权按需展现，日常操作不强制进入高级配置；不要暴露敏感令牌。

现有旧路由 `/create`、`/discover`、`/review` 等应审计深链/兼容性，必要时做有意义的保留或重定向，避免用户书签与现有调用突然失效。不要随意删除旧文件直到新入口通过回归。

## 4. 执行顺序：自主连续推进

1. **代码审计与基线**：列出各页面真实路由、API/数据字段、状态管理、当前测试及设计差异，建立一份短矩阵。先跑基线测试，区分本分支引入的问题和已有问题。注意设计 PR #41 曾有 Playwright 严格选择器匹配两个候选图的问题，基线已提交选择器修正；不要误判为模型/业务问题。
2. **设计组件化**：把原型拆成真实复用的 CreatorShell / page header / work cards / filter / inline status / mobile nav / error-state，不得原样复制演示 JS 的假 API 行为。
3. **打通 P0-A/B**：在正式路由上用真实数据走完首页→热点→选题→新建/继续作品→保存/恢复；立即添加 E2E 和空/失败态测试。
4. **打通 P0-C**：以真实项目 id 和修订驱动配图计划、生成、审阅/采用、正文同步、平台稿预览；使用合成图像提供商进行无费用回归。
5. **完成 P1**：发布/素材/日历/复盘/设置统一视觉并接入存量 API。缺少功能契约的小范围后端补丁可直接实现并补测试；没有可靠外部数据的地方保留诚实的空状态，不伪造指标。
6. **QA 闭环**：修复所有因重构引起的 E2E、可访问性和移动布局问题，截图并比对原始设计；汇总功能差异和风险。只保留可复现、确属外部认证/真实账号/部署权限的问题作为明确的人工事项。

可以按内聚模块拆成多个小 commit，但是必须在同一实现 PR 中汇总真实可运行的功能。不以 PR 草稿或设计文档代替代码落地，不因局部完成反复要求用户“继续下一阶段”。

## 5. 测试与硬性验收

验收文件：`docs/agent-tasks/CREATOR-V2-ACCEPTANCE.md`。你至少必须执行并记录：

`npm ci --no-audit --no-fund`  
`npm run check`  
`npm test`  
`npm run build`  
`npm run test:e2e` 或可复现的 Playwright 选定测试 + CI 全量回归。

需在 Node 22.16+、一次性 SQLite、无真实外部 API key 的环境跑测试；所有发布、外部图片调用采用合成桩/模拟服务。不得用“未运行但应该通过”代替报告。当前构建门禁依赖真实 Git checkout 和 HEAD；若遇到门禁失败，诊断准确原因并按照仓库的受信流程修复，不能删脚本或短路 guard。

测试至少覆盖：
- 1440px 桌面、390px 手机（侧栏/底栏，所有正式路由无横向溢出）。
- 首次启动空状态、新建、写作与刷新后的持久化、冲突处理。
- 真实信源→选题→作品的来源追溯与跳转。
- 正文切换平台前的保存/冲突保护。
- AI 配图“未选中/已选中/已批准/已插入”状态分离、单图失败与预算、source revision 失效。
- 无图像服务/无文章/无登录/服务中断/部分队列失败等异常。
- 公众号与知乎独立的四项检查、导出≠真实发布、未授权绝不调用平台接口。
- 真实用户内容不出现在测试 fixtures、截图或 Git 记录中。
- 截图/视频/测试报告在 PR 可查看；功能→API→测试→证据可追溯。

## 6. 必须提交的交付

1. **一个实现 Draft PR**：从设计分支派生、target 设计分支，真实接入所有确定范围页面；不合并生产。
2. 修改文件/新增组件与可追踪 commit，不仅是 README 或截图。
3. `docs/implementation/CREATOR-V2-FEATURE-MATRIX.md`：每个页面、真实 API、数据持久状态、测试、未完成项、风险、复现步骤。
4. `docs/implementation/CREATOR-V2-QA.md`：Node 版本、命令、PASS/FAIL、CI URL、1440/390px 截图、重要交互录像或 trace、异常降级记录。
5. PR 描述要区分：实际已完成、模拟的测试、未验证的外部真实账号/付费模型/真实渠道发布。禁止写“全部可发布”却没有平台真实证据。

## 7. 完成定义

当且仅当主工作流从真实数据跑通、P0 + P1 页面按已确认设计正确呈现、持久化/修订/审批/权限边界不退化、测试基线通过、PR 可以审阅，并且每个外部限制均明示时，才可以报告“功能开发完成并进入合并评审”。**不能将“设计预览完成”报告成“应用重构完成”。**

遇到硬阻塞时，一次性说明阻塞原因、精确相关命令/日志、能并行的任务已推进到哪里、需要谁做什么，不要无意义等待、不重复向用户索要已授权的决定。

## 8. 回复格式（Agent 交付时使用）

- 已变更的正式路由及对应能力（不是 mock 清单）
- 关键代码文件 / commit / Draft PR
- 验收矩阵通过条目与 CI 链接
- 实际可复现操作路径（从首屏到生成/发布准备）
- 尚未满足的**真实**阻塞项，以及最低成本解除方式
- 明确声明：未自动合并、未生产部署、未擅自真实发布或付费调用

**现在就从设计基线建立实现分支、运行基线测试和源代码审计开始；不要先产出另一份空泛设计报告。**

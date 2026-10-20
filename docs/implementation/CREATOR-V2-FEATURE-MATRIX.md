# Creator V2 功能矩阵（CREATOR-V2-FEATURE-MATRIX）

> 逐页登记：真实 API、持久状态、测试、未完成项、风险、复现步骤。
> 原则：全部页面走既有 API 与既有 SQLite 存储（小适配除外，逐条注明）；无新增平行存储模型；导出≠发布、作者报告≠平台核验、选中≠批准≠插入、无证据指标不展示。
> 证据索引：功能探针 JSON / e2e 日志在 `.superpowers/`（gitignore，不入库，路径为留档索引）；截图在 `docs/implementation/screenshots/<page>/`；单元测试在 `test/*.test.mjs`。环境与命令见 `CREATOR-V2-QA.md`。

## 0. 全局

- **API 边界**：全部请求经 `app/api/[...parts]/route.js` → `lib/api.mjs dispatchApi`；打开 SQLite 前 `validateLocalApiRequest`（V58 环回/Origin/JSON 写体门禁）不变。`/api/creator/*` 分发于 `lib/creator-api.mjs`。
- **壳层**：`components/CreatorShell.jsx` —— 11 工作区侧栏、移动 5 快捷 tab +「更多」面板；`app/creator-v2.css` tokens（`--cv2-*`）。
- **复现步骤（全页通用）**：见 QA 文档「命令清单」；单页复现 = 容器内封存构建 → `npx playwright test e2e/creator-v2-<page>.spec.mjs`。

---

## 1. `/` 工作台（commit 7f2fd22 + 2eca608；组件 `CreatorHome`）

- **真实 API**：`GET /api/creator/overview`（画像/作品/选题/系列/通知/任务/服务可用性/用量聚合，`lib/creator-api.mjs:206` 起）；`POST /api/writing/projects {title}`（快捷建文）；`POST /api/creator/notifications/:id`（标为已读）。
- **持久状态**：`editorial_projects`、`creator_topics`(+收藏)、`creator_notifications.read`、`creator_jobs`（series_prepare 等）、`creator_series`。派生逻辑在 `src/creator-home.mjs`（纯派生，可单测）。
- **测试**：`e2e/creator-v2-home.spec.mjs` 4 passed（42.1s）；独立探针 39 项断言 38 过 1 败（`.superpowers/home-accept-state.json`）；`test/creator-home.test.mjs`。真实链路验证：快捷建文 UI 点击 → 真实 POST → 跳 `/compose?project=ep_*` → 概览带 03 篇；标为已读 → 真实 POST 200 → 任务消失且刷新不回；容器本地 SQLite 只读直验 UI 数字与库一致。
- **未完成项**：Esc 关「更多」面板后焦点未返回触发按钮（`components/CreatorShell.jsx:124-136`，共享壳层问题；修复建议 `moreButtonRef.current?.focus()`）。
- **风险**：overview 聚合端点随数据量增长需关注响应体积（bounded-response 既有约束在）。
- **复现**：`npx playwright test e2e/creator-v2-home.spec.mjs`；截图 `screenshots/home/`（8 张）。

## 2. `/works` 作品库（commit cd9e176；组件 `WorksLibrary`）

- **真实 API**：`GET /api/editor/projects`（`lib/api.mjs:207`，含 channels[status/checks/masterOutdated/openCorrections/revision]）；`GET /api/creator/overview`；`POST /api/writing/projects`。搜索/筛选为客户端实现（`src/works-library.mjs` 纯派生）。
- **持久状态**：`editorial_projects` + 渠道状态（`editorial_channel_refs`：wechat/zhihu 独立 status/checks/exported/reported）。
- **测试**：`e2e/creator-v2-works.spec.mjs` 4 passed（43.9s，worker 级真实生产服务）；独立探针 51/51、0 pageerror（`.superpowers/works-accept-state.json`）——四阶段状态全部经真实域 API 造出（POST projects、editor checks/export/reported），SQLite 直验 5 行中文标题无损、zhihu:exported / wechat:reported_published / 半完成 checklist 落库；`test/works-library.test.mjs`。
- **未完成项**：稀疏态（空库/失败/无匹配）主列窄列——验收轮（cd9e176 时点）实测 718px；该根因（`.cv2-main` `width:auto` + flex 容器内 `margin:0 auto` 使 stretch 失效）已由 commit 18a6c7f 修复（改为 `width:100%`，现 `app/creator-v2.css:110`，注释即说明为消除 shrink-to-fit），**稀疏态视觉复测未执行**（本文档修正轮未重摄）。
- **风险**：`editorial.list()` 无服务端分页/筛选参数，作品量大后客户端筛选可能变慢（当前规模无问题）。
- **复现**：`npx playwright test e2e/creator-v2-works.spec.mjs`；截图 `screenshots/works/`。

## 3. `/compose` 创作空间（commit cecd1ec + 8 项 fix；组件 `WritingWorkspace`）

- **真实 API**：`GET/PUT /api/writing/projects/:id/:channel`（expectedRevision 冲突保护）、`/history`、`/master-sync`(GET/POST)、`/suggestions*`、`/export`；`POST .../generations`；`GET/PUT /api/creator/projects/:id/context?channel=`；`POST .../checks`；`GET/POST /api/assets`；配图 plan/generate/decision；`POST .../publishing/report`。
- **持久状态**：`article_markdown_revisions`（不可变修订，经 `editorial_channel_refs` 关联）、渠道文档独立、`content_assets`（封面生成 status=generated）、agent 建议与运行记录。
- **测试**：`e2e/creator-v2-compose.spec.mjs` 4 passed（55.8s）；`e2e/writing-workspace.spec.mjs` 13 例（全量套件内）；独立探针 46/46（`.superpowers/compose-accept-state.json`，542 次 API 调用、9 次 POST/PUT、0 pageerror/5xx）——SQLite 修订内容逐字一致且追加、公众号「从主稿创建新版本」不回写主稿、双窗口 expectedRevision 冲突 → 本地草稿横幅 + 服务端未被覆盖、配图计划 3 图位 + 封面经环回合成服务商真实 generate、390px scrollWidth=390。
- **未完成项**（偏差登记 #10-#14）：主稿默认视图「发布准备」禁用淡化（领域正确，视觉待打磨）；1440 头部按钮换行；中栏/右栏密度高于设计；Esc 不关「平台发布准备」对话框；冲突/网络错误文案透出英文原文。
- **风险**：错误文案 i18n 不完整可能让非英文作者困惑；冲突横幅机制完整（可下载本地草稿/重试/载入服务器版本），风险受控。
- **复现**：`npx playwright test e2e/creator-v2-compose.spec.mjs && npx playwright test e2e/writing-workspace.spec.mjs`；截图 `screenshots/compose/`（16 张）。

## 4. `/hotspots` 热点雷达（commit c3a294b + 6f92c26；组件 `HotspotsRadar`）

- **真实 API**：`GET /api/creator/sources`、`GET /api/creator/source-items?source=&limit=`（上限 200/源留存 60）、`POST /api/creator/sources/:id/sync`（RSS-only 公开 HTTPS 边界）、`POST /api/creator/source-items/convert`、小适配 `POST /api/creator/source-items/topic`（`src/creator.mjs saveSourceItemTopic`：复用 convert 落素材（URL 去重）→ 以 `{kind:'material',id}` 引用建 draft 选题，重复返回既有选题 + duplicate 标记）。
- **持久状态**：`creator_sources`（enabled/status/last_run）、`creator_source_items`、转换产生的 `creator_materials` + `creator_topics`（refs 含原文 URL）。搜索/信源筛选为客户端 + 服务端 `?source=`。关注为会话态（不落库，设计自身即会话语义）。
- **测试**：`e2e/creator-v2-hotspots.spec.mjs` 5 passed（45.4s，含「无升温中/新出现/持续讨论」文本断言、原文 href、「未验证」标签、刷新诚实失败、抽屉 aria-checked、转换落地 /topics + API 验证 refs + 重复不新建）；独立探针 53/53（`.superpowers/hotspots-accept-report.json`）；`test/creator-v2-hotspots.test.mjs`；遮罩修复后探针复测 `getComputedStyle` = `rgba(27,33,56,0.66)`。
- **未完成项**：无已知未修复缺陷（上轮遮罩回归已修复并复测）。
- **风险**：`source-items/topic` 为本轮新增小适配端点（复用既有表，单测覆盖 404/去重/自定义标题）；真实外网 RSS 同步在生产环境才可发生，e2e 沙箱断言的是诚实失败路径。
- **复现**：`npx playwright test e2e/creator-v2-hotspots.spec.mjs`；截图 `screenshots/hotspots/`（16 张）。

## 5. `/topics` 选题发现（commit b3a9b5e + 3 项 fix；组件 `TopicsDiscovery`）

- **真实 API**：`GET/POST /api/creator/topics`、`PUT/GET /api/creator/topics/:id`（expectedRevision）、`/history`、`/messages`(GET/POST)、`/messages/:tm/accept`、`POST /:id/start`（幂等创建 project）；`POST /api/creator/topics/recommend`（AI 推荐需授权 + 服务已配置前置）；系列 `GET/POST /api/creator/series*`；任务 `GET /api/creator/jobs`、`POST /:id/review`。
- **持久状态**：`creator_topics` + `creator_topic_details`（problem/angle/refs/evidenceGaps/status/favorite/reason/targetDate）、`creator_topic_history`、`creator_series*`、`creator_jobs`。
- **测试**：`e2e/creator-v2-topics.spec.mjs` 7 passed（52.5s：四字段取值/PUT 持久化/409 不覆盖/记录选题/收藏/状态筛选/开始创作 URL+projectId+状态=写作中/无模型禁用+本地发现成功）；独立探针 22 项 0 失败 + 5 项增量复核（`.superpowers/topics-accept-func.json`、`topics-accept-delta.json`）；`test/topics-discovery.test.mjs`；旧链路 `e2e/creator-v1.spec.mjs`（含系列两用例、AI 推荐完整链）通过。
- **未完成项**：无已知未修复缺陷（验收修复 631babb 补 cv2-btn 主色、4346025 移动页头单行均已闭环）。
- **风险**：「为我推荐」按 provenance 划分而非相关性计算（有意，红线）；批量推荐折叠条 + 记录行使首屏低约 150px（已登记）。
- **复现**：`npx playwright test e2e/creator-v2-topics.spec.mjs`；截图 `screenshots/topics/`（5 张）。

## 6. `/illustrations` 视觉工作台（commit 1e8446b；组件 `IllustrationStudio`）

- **真实 API**：`GET /api/illustrations/projects/:id`、`POST .../plan`（小适配 `scope:'cover'`）、`/agent-plan`、`POST shots/:id/generate|decision|review|recover`、`PUT shots/:id/prompt`（新增可选 `alt` 2–160 字，携带 expectedUpdatedAt）、候选 `GET/POST shots/:id/candidates`、`POST candidates/:cid/decision|comparison|feedback`、预算 `GET/PUT .../budget`、队列 `GET /api/illustrations/queue|batches|start|pause`、`jobs/:id/cancel|retry|events`、映射 `PUT /api/assets/:id/mappings/:channel`（保留历史，V52）、交接 `handoff/:channel` + `handoff-qa/:channel`、体检 `technical-audit`、供应商预检 `providers/preflight`。
- **持久状态**：`article_illustration_shots`（status: planned→generating→failed→generated→approved→rejected、style、alt）、`content_assets`（真实生成位图）、映射历史、预算与队列记录、质量账本。
- **测试**：`e2e/creator-v2-illustrations.spec.mjs` 5 passed（47.9s：三模式规划真实 API、选中≠批准（主稿 markdown 全程零 `asset://`）、editImage 候选链路（环回合成供应商零费用）、预算压到 1 → 批量 → 逐图重试 `budget.used===3`、预览仅已批准图 + 未映射渠道诚实提示）；既有 `illustration-workbench`(3)、`visual-handoff-v42`、`image-quality-roundtrip-v43`、`channel-image-audit-v52` 全量套件内通过；`test/illustrations-studio.test.mjs` 5/5。
- **未完成项（3 项探针缺陷，截至当前 HEAD 未修复）**：
  1. 页面加载失败后「重试」数据恢复但错误态不清除（`IllustrationStudio.jsx:630-632` + `loadState:124` 不清 `loadError`）；
  2. alt/视觉方案保存已落库但无成功反馈（`savePromptFields:355-364` 缺 `return`，调用方 `:1042/:1126/:1243`）；
  3. 390×844 平台预览弹窗「继续配图」按钮滚动后仍不可点。
  前两项已经本轮在 HEAD 代码复核确认（证据见偏差登记 /illustrations 验收轮缺陷登记）。
- **风险**：真实付费生图未验证（全部验证基于环回合成供应商）；缺陷 ① 可能误导作者以为加载仍失败；缺陷 ③ 影响移动端预览闭环。
- **复现**：`npx playwright test e2e/creator-v2-illustrations.spec.mjs`；缺陷复现：`.superpowers/illu-verify.mjs`（探针脚本）。截图 `screenshots/illustrations/`（6 张）。

## 7. `/publish` 发布中心（commit 13bf07a；组件 `PublishCenter`）

- **真实 API**：`GET /api/creator/platforms`；`GET /api/creator/projects/:id/publishing`（facts/operations 时间线）、`POST .../publishing/bundle|draft|report|reconcile`（draft 需 idempotencyKey+allowExternalCall）；`GET/POST /api/delivery/projects/:id/:channel*`；`POST /api/editor/projects/:id/:channel/checks`（四项映射 factual/privacy/rights/layout，expectedRevision 冲突乐观回滚）。
- **持久状态**：渠道 checks、`publishing` 历史（exported/draft_saved/published facts + sending/failed/outcome_unknown operations）、作者报告链接、交付就绪记录。
- **测试**：`e2e/creator-v2-publish.spec.mjs` 5 passed（45.2s：勾选/持久/渠道独立/交付包下载/草稿四重门槛/作者报告/多作品切换器）；独立探针 105 项断言中 104 项通过、1 项 pass:false（`.superpowers/publish-accept-result.json`）——失败项为「控制台无 error」，detail 含 2×net::ERR_FAILED 与 1×409 Conflict，与探针内故意的断网/冲突回滚演练（`screenshots/publish/desktop-network-fail.png`、`desktop-conflict-rollback.png`）并存，归因未单独复核，如实登记；`test/publish-center.test.mjs` 9 例（时间线派生、previewBlocks 外链不加载、标签映射）。
- **未完成项**：「控制台无 error」1 项探针失败待归因复核（见测试行）；其余无已知未修复缺陷。
- **风险**：真实草稿箱推送/平台发布未验证（无真实账号凭据）；UI 文案已按「导出≠草稿箱≠真实发布」「作者报告未经平台核验」隔离。
- **复现**：`npx playwright test e2e/creator-v2-publish.spec.mjs`；截图 `screenshots/publish/`（13 张）。

## 8. `/calendar` 内容日历（commit 5b9230f；组件 `CalendarWorkspace`）

- **真实 API**：选题 `targetDate` 小适配（`creator_topic_details` JSON 增加字段，`createTopic`/`updateTopic` 经 `_briefDetails` 校验 YYYY-MM-DD，随 `creator_topic_history` 留痕、expectedRevision 409 保护、坏日期 400 fail-closed）；`GET /api/creator/series`（next_run_at/cadence_days）、`PUT /api/creator/series/:id`；「安排下一篇」= `POST /api/creator/topics`（标题+日期双必填，无默认发布日）。
- **持久状态**：`creator_topic_details.targetDate`、`creator_series.next_run_at/cadence_days`；作品无排期字段（只进「未排期的进行中作品」清单，绝不伪装成日历事件）。
- **测试**：`e2e/creator-v2-calendar.spec.mjs` 6 passed（43.1s：排期→周/月视图→刷新持久化、未排期作品不在网格且 pill「暂无排期」、系列建卡+日历事件+调整安排 409、月视图工具栏常驻、空值门槛）；独立探针 36 项中断言 34 项通过、2 项 ok:false（`.superpowers/cal-func-result.json`）——「周视图:10 月 23 日出现新事件胶囊」与「工具栏计数更新为 4 项计划」（实测「3 项计划」）；同探针内「API 复核:targetDate=2026-10-23 已落库」与「月视图:事件胶囊渲染(共4条计划)」为通过，失败归因未复核（对应 e2e 用例通过），如实登记待复核；`test/calendar-view.test.mjs` 9 例（buildEvents 只认真实计划、monthCells 35/42、409、坏日期）。
- **未完成项**：上述 2 项探针失败待归因复核（探针时序 vs 周视图过滤/计数口径均有可能）；本轮未复现定位。
- **风险**：targetDate 是「计划日期不是发布日期」，弹窗与事件行已明示；无自动发布路径。
- **复现**：`npx playwright test e2e/creator-v2-calendar.spec.mjs`；截图 `screenshots/calendar/`（5 张）。

## 9. `/insights` 效果复盘（commit de59e7c；组件 `CreatorInsights`）

- **真实 API**：`GET/POST /api/creator/projects/:id/metrics`（作者手工录入：channel/url/views/likes/comments/note）；新只读聚合端点 `GET /api/creator/insights`（`src/insights-view.mjs` 纯派生 + V58 边界断言）；风格 `GET/POST /api/creator/style-suggestions`、`POST /:id`（采纳写画像、409 保护、拒绝留记录）；发布事实 `GET .../publishing`。
- **持久状态**：`creator_metrics`（按渠道快照，同渠道重复录入不累加）、`creator_style_suggestions` 决策记录、`creator_profile_versions`（仅采纳路径写入）。
- **测试**：`e2e/creator-v2-insights.spec.mjs` 5 passed（43.3s：空态「暂无已验证平台数据」、记录弹窗空值门槛→保存→SQLite `creator_metrics` 行→刷新仍在、90 天范围计入、柱数断言、风格拒绝不动画像→采纳后 GET profile 真实更新→旧 revision 409）；`test/insights-view.test.mjs` 9 例（最新快照聚合/缺失不补零/hasVerifiedPlatformData 恒 false/trendBuckets 分桶）。
- **未完成项**：无已知未修复缺陷。
- **风险**：平台统计接入能力结构性不存在，「未连接平台统计」pill 常驻（有意）；绝不伪造阅读量/互动量。
- **复现**：`npx playwright test e2e/creator-v2-insights.spec.mjs`；截图 `screenshots/insights/`（10 张）。

## 10. `/library` 素材库（commit f964a8b；组件 `LibraryWorkspace`）

- **真实 API**：`GET /api/creator/library?q&kind&tag&archived&series&platform&from&to`、`PUT /api/creator/library/meta`；`POST /api/creator/materials`、`GET /:id`、`POST /materials/import-url`（公开链接需显式同意）；`GET /library/removal-preview`、`POST /library/remove-source`；`GET/POST /api/assets`、`GET /api/assets/:id`；新只读端点 `GET /api/creator/library/visual-series`（`src/creator.mjs visualSeriesOverview`，读同一 SQLite，无新存储，不带图片资产）；从素材建选题 `POST /api/creator/topics`。
- **持久状态**：`creator_materials`（来源/标签/归档）、`content_assets`、`creator_asset_usage`（关联作品）、visual_series（V37）。
- **测试**：`e2e/creator-v2-library.spec.mjs` 8 passed（51.9s：四类卡与筛选/详情/关联作品/移除影响/归档→找回→恢复/导入三路径/系列带）；`test/library-view.test.mjs` 7 例（kind 映射与诚实副标题、visual-series 总览 404/405 边界）；旧链路 `e2e/creator-v1.spec.mjs` 选择器适配后全链通过。
- **未完成项**：无独立全量功能探针 JSON（验证以 e2e 8 例 + 单测为主）；`.superpowers/verify-library*.mjs` 脚本无留档结果。
- **风险**：import-url 的公开抓取走既有同意门与 pinned HTTPS 边界；「链接」chip 与「参考线索」集合同为 kind=material（卡片类型标签区分），语义已在单测固化。
- **复现**：`npx playwright test e2e/creator-v2-library.spec.mjs`；截图 `screenshots/library/`（12 张）。

## 11. `/settings` 偏好与连接（commit 738325f + 0da5b60；组件 `SettingsWorkspace`）

- **真实 API**：画像 `GET/PUT /api/creator/profile`（expectedRevision、restoreRevision 409 重载）+ `GET /profile/history`；服务连接 `GET/POST /api/creator/services`、`PUT/DELETE /:id`、`POST /api/creator/services/models`（V76 开放模型目录，per-action consent，密钥零回显）；平台 `GET /api/creator/platforms`、账号 CRUD + probe；信源 CRUD + `/:id/sync`（订阅显式同意门）；额度 `GET/PUT /api/creator/usage`、`POST /usage/:su`（settle）。全部走既有 API，无新增存储。
- **持久状态**：`creator_profile_versions`、`creator_services`（加密保存，脱敏下发）、`creator_platform_accounts`、`creator_sources`、`creator_usage`。
- **测试**：`e2e/creator-v2-settings.spec.mjs` 6 passed（44.6s：画像 v2 落库、折叠区、#services/#usage 深链、密钥不出现在页面与 GET 响应、额度落库、信源默认 6 项可见/暂停落库 enabled=0/同意门/移除后服务端消失、移除连接后空态；全程不触发外部抓取）；独立探针 35/35（`.superpowers/acc-settings-func.json`）；旧链路 `e2e/creator-v1.spec.mjs` 设置/加密连接全链通过。
- **未完成项**：旧 `CreatorSettings.jsx` 保留在仓库但不再挂载（后续可清理）；`/sources` `/validation` `/knowledge` 仍由旧 StudioApp 提供（审计 §2 遗留，属后续迁移范围）。
- **风险**：域校验（微信 AppID 域名）属服务端安全边界，e2e 不绕过（0da5b60）；模型目录为供应商自报，不代表已验证模型质量（V76 红线）。
- **复现**：`npx playwright test e2e/creator-v2-settings.spec.mjs`；截图 `screenshots/settings/`（6 张）。

---

## 横切未完成项与风险汇总

| # | 项 | 页面 | 状态 |
|---|---|---|---|
| 1 | Esc 关「更多」面板焦点不返回 | 全局壳（首发于 /home 验收） | 未修复（轻微 a11y） |
| 2 | 稀疏态主列窄列（验收时实测 718px） | /works | 机制已修（18a6c7f 改 `width:100%`，现 creator-v2.css:110）；视觉复测未执行 |
| 3 | 加载失败重试不清错误态 | /illustrations | 未修复（HEAD 代码复核确认） |
| 4 | prompt/alt 保存无成功反馈 | /illustrations | 未修复（HEAD 代码复核确认） |
| 5 | 390px 预览弹窗「继续配图」不可点 | /illustrations | 未修复（探针记录） |
| 6 | Esc 不关发布准备对话框 | /compose | 未修复（轻微） |
| 7 | 冲突/网络错误文案英文原文 | /compose | 未修复（i18n 打磨项） |
| 8 | `/sources` `/validation` `/knowledge` 旧 StudioApp 承接 | 全局 | 有意保留（后续迁移） |
| 9 | 真实付费生图 / 真实平台发布 / 生产部署 / 真实账号 | 横切 | 未验证（无凭据/权限，见 QA） |
| 10 | 周视图新事件胶囊未现 + 工具栏计数 3≠4（探针 2 项 ok:false） | /calendar | 待归因复核（对应 e2e 用例通过；本修正轮补登记） |
| 11 | 「控制台无 error」探针 pass:false（断网/409 演练并存） | /publish | 待归因复核（疑为演练伴随现象；本修正轮补登记） |

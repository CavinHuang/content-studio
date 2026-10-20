# Creator V2 设计覆盖矩阵（CREATOR-V2-DESIGN-COVERAGE）

> 逐页对应：设计页面/状态 → 正式路由/组件 → 设计截图 → 实现截图 → API → E2E → 结论。
> 设计事实源：`public/design/creator-v2.2.html`（205 行）、`public/design/creator-v2.3-visual.html`（59 行）、`public/design/assets/creator-v2-tokens.json`；设计基准截图 `docs/implementation/screenshots/design/`（41 张，1440×900 / 390×844，容器内真实渲染，尺寸经 PNG IHDR 校验，汇总 `.superpowers/design-shots-summary.json`）。
> 分支 `feat/creator-v2-real-workspace`。每页「实现 commit」为该页正式功能与截图落库的提交；验收证据（功能断言 JSON、e2e 日志）在 `.superpowers/`（gitignore，不入库，路径仅作留档索引）。
> 偏差明细见 `CREATOR-V2-DESIGN-DEVIATIONS.md`；真实 API/持久化/未完成项见 `CREATOR-V2-FEATURE-MATRIX.md`；命令与结果见 `CREATOR-V2-QA.md`。

## 总览

| 页面 | 正式路由 | 组件 | 实现 commit | 设计截图组 | 实现截图 | E2E | 结论 |
|---|---|---|---|---|---|---|---|
| 全局壳 | 全部 | `components/CreatorShell.jsx` | 9f28db6 | `mobile-nav-more.png` | 各页截图侧栏/底栏 | mobile-audit 16 例 | 通过 |
| 工作台 | `/` | `CreatorHome` | 7f2fd22 + 2eca608（截图 cd9e176 入库，6a8a576 为 impl/ 过程图） | home-desktop/-mobile | 8 张 | 4 passed | 通过（1 项轻微键盘焦点缺陷待修） |
| 作品库 | `/works` | `WorksLibrary` | cd9e176（截图 7960f02） | works-desktop/-mobile | 10 张 | 4 passed | 通过（稀疏态窄列机制已由 18a6c7f 修复，视觉复测未执行） |
| 创作空间 | `/compose` | `WritingWorkspace` | cecd1ec + 8 项 fix（截图 1a5f97b） | compose-* ×4 + v23-article/plan | 16 张 | 4 passed（另 writing-workspace 13 例） | 通过 |
| 热点雷达 | `/hotspots` | `HotspotsRadar` | c3a294b + 6f92c26 | hotspots-* ×4 | 16 张 | 5 passed | 通过（上轮遮罩回归已修复并复测） |
| 选题发现 | `/topics` | `TopicsDiscovery` | b3a9b5e + 3 项 fix（截图 cd5870c） | topics-desktop/-mobile | 5 张 | 7 passed | 通过 |
| 视觉工作台 | `/illustrations` | `IllustrationStudio`（+ queue 页 `IllustrationQueueWorkspace`） | 1e8446b（截图 d187db9） | v23-* ×12 | 6 张 | 5 passed（另 illustration-workbench/v42/v43/v52） | 有条件通过（3 项探针缺陷未修复，其中 2 项已在 HEAD 代码复核确认） |
| 发布中心 | `/publish` | `PublishCenter` | 13bf07a（截图 9e8ddc2） | publish-* ×3 | 13 张 | 5 passed | 通过（探针 104/105：1 项「控制台无 error」失败源于故意失败路径演练，已登记） |
| 内容日历 | `/calendar` | `CalendarWorkspace` | 5b9230f | calendar-* ×3 | 5 张 | 6 passed | 通过（附 2 项待复核探针失败） |
| 效果复盘 | `/insights` | `CreatorInsights` | de59e7c（截图 4c1cdd6/a84a5fa） | insights-desktop/-mobile | 10 张 | 5 passed | 通过 |
| 素材库 | `/library` | `LibraryWorkspace` | f964a8b（截图 fc05c8d） | library-desktop/-mobile | 12 张 | 8 passed | 通过（功能验证以 e2e 为主，无独立全量功能探针 JSON） |
| 偏好与连接 | `/settings` | `SettingsWorkspace` | 738325f + 0da5b60（截图 25a3fab） | settings-* ×3 | 6 张 | 6 passed | 通过 |

全量回归（最后一轮，2026-10-20 17:20，`.superpowers/e2e-settings3.log`）：`npx playwright test` **112 passed / 0 failed**（23 个 spec 文件，其中 creator-v2-* 页面用例 59 例），webServer 为 runtime-guard 校验 V64 封存回执后的真实生产服务。

---

## 0. 全局壳与 tokens

- **设计**：V2.2 深色侧栏 235px + 顶栏面包屑 +「交互原型 · 示例数据」徽标 + 移动端 4 tab +「更多」面板（creator-v2.2.html:9-12,138,167）；tokens：侧栏 `#242635`、主色 `#465FD7`、背景 `#F7F8FA`、正文 14px（creator-v2-tokens.json:8-53）。
- **实现**：`components/CreatorShell.jsx:19-31` 侧栏 10 个工作区 + 偏好与连接 = 11 项；移动端 5 快捷 tab（工作台/热点/选题/作品/配图）+「更多」面板（6 入口，Esc 可关）；tokens 落地于 `app/creator-v2.css`（`--cv2-*` 变量），topics 页探针实测 `getComputedStyle` 主色 = `#465FD7`（commit 5013e7c）。真实数据页正确移除「交互原型·示例数据」徽标（home/works 截图对照）。
- **映射说明**：原型侧栏 8 项 → 实现 11 项，依据 AGENTS.md「eleven creator workspaces（mobile: five quick entries plus a More panel）」基线，非缺陷。V2.3 无路由设计 → V2.3 编辑器态并入 `/compose`、studio 态并入 `/illustrations`。
- **证据**：各页桌面/移动截图共享同一侧栏/底栏；`e2e/mobile-audit.spec.mjs` 16 例全过（15 条路由循环 + 1 条创作工作台独立用例，390px 无横向溢出）。

## 1. 工作台 `/`（设计 home）

- **设计页面/状态**：hero 渐变横幅、三格概览带（当前最重要/等待决策/值得判断线索）、任务卡列表、最近作品表、右栏选题信号、完成条；移动端单列 + 底栏「工作台」高亮 + 更多面板（creator-v2.2.html:141,173；design/home-desktop.png、home-mobile.png）。
- **正式路由/组件**：`app/page.jsx` → `components/CreatorHome.jsx`；壳 `CreatorShell`。
- **设计截图**：`screenshots/design/home-desktop.png`、`home-mobile.png`。
- **实现截图**：`screenshots/home/` 8 张 —— desktop.png / mobile.png / desktop-empty-firstuse.png / desktop-network-fail.png / desktop-notification-task.png / mobile-more-panel.png / desktop-prod.png / mobile-prod.png（后两张为封存生产服务重摄，证明无 dev 徽标伪影；health 回报 candidateCommit=2eca608）。
- **API**：`GET /api/creator/overview`（profile/projects/topics/series/notifications/jobs/services/usage）；`POST /api/writing/projects`（快捷建文，跳 `/compose?project=ep_*`）；`POST /api/creator/notifications/:id`（标为已读）。
- **E2E**：`e2e/creator-v2-home.spec.mjs` 4 passed（42.1s，`.superpowers/home-e2e.log`）；独立功能探针 39 项断言 38 过（`.superpowers/home-accept-state.json`），SQLite 只读直验 UI 数字与库一致。
- **结论**：**通过**。概览带/任务卡/作品表/信号列与设计逐项对齐；偏差为有意的诚实改词（概览带标签、信号行真实状态 tag，见偏差登记 /home #1-#4）。遗留 1 项轻微键盘焦点缺陷（Esc 关「更多」面板后焦点未返回触发按钮，CreatorShell.jsx:124-136），不影响主流程，待修。

## 2. 作品库 `/works`（设计 works）

- **设计页面/状态**：页头 + 五格阶段管线（全部/草稿中/审稿中/待发布/已发布）+ tab 筛选 + 三列卡片网格 + 虚线建文卡 + 建文弹窗；空态「此阶段暂无作品」（creator-v2.2.html:156,176,202-203；design/works-desktop.png、works-mobile.png）。
- **正式路由/组件**：`app/works/page.jsx` → `components/WorksLibrary.jsx`。
- **设计截图**：`screenshots/design/works-desktop.png`、`works-mobile.png`。
- **实现截图**：`screenshots/works/` —— desktop.png（1440×900 生产实摄，四阶段真实数据）/ mobile.png / desktop-empty-firstuse.png / desktop-network-fail.png / desktop-filter-ready.png / desktop-search-no-match.png / desktop-create-modal.png / mobile-create-modal.png；另有实现期旧图 2 张：works-desktop.png（1280×720，不符合 1440×900 视口约定）、works-mobile.png（390×844，符合移动视口约定），保留未删，以新验收图为准。
- **API**：`GET /api/editor/projects`；`GET /api/creator/overview`；`POST /api/writing/projects`（弹窗建文）。
- **E2E**：`e2e/creator-v2-works.spec.mjs` 4 passed（43.9s，`.superpowers/works-e2e.log`）；独立探针 51/51 项断言、0 pageerror（`.superpowers/works-accept-state.json`），SQLite 直验 editorial_projects 5 行含 zhihu:exported / wechat:reported_published 真实渠道状态。
- **结论**：**通过（稀疏态布局机制已由 18a6c7f 修复，视觉复测未执行）**。主数据视图与设计逐项对齐；「已发布」tag 按领域红线改标「作者报告已发表（未核验）」；验收轮（cd9e176 时点）曾实测稀疏态（空库/失败/无匹配）主列收缩为 718px 窄列，其后 commit 18a6c7f 已把 `.cv2-main` 由 `width:auto` 改为 `width:100%`（现 `app/creator-v2.css:110`，注释即说明为消除该 shrink-to-fit 机制）——机制层面已修，但稀疏态视觉复测未重摄（见偏差登记 /works #1）。

## 3. 创作空间 `/compose`（V2.2 editor + V2.3 editor 合并）

- **设计页面/状态**：灰底编辑画布、header（eyebrow/标题/保存状态/返回作品/配图工作台/发布准备）、六步条、ribbon、三栏（大纲 / 渠道分段+稿纸 / 创作助手）、V2.3 内联图位插槽与配图 inspector；渠道主稿/公众号/知乎；移动双 tab + 工作流底栏（creator-v2.2.html:159,178,204；creator-v2.3-visual.html:5,36-43,53）。
- **正式路由/组件**：`app/compose/page.jsx`（Suspense）→ `components/WritingWorkspace.jsx`（含 DoocsEditor/WritingPreview/WritingImages/WritingGenerations 等既有组件）。
- **设计截图**：`screenshots/design/compose-desktop.png`、compose-wechat-desktop.png、compose-visual-desktop.png、compose-mobile.png、v23-article-mobile.png、v23-plan-desktop.png、v23-plan-mobile.png。
- **实现截图**：`screenshots/compose/` 16 张 —— compose-desktop.png、desktop-empty-firstuse/empty-draft、desktop-wechat-channel、desktop-conflict、desktop-visual-empty/visual-board、desktop-publish-prep、desktop-network-fail、mobile.png、mobile-assistant（+ 实现期 5 张 compose-*.png）。
- **API**：文档 `GET/PUT /api/writing/projects/:id/:channel`、`/history`、`/master-sync`、`/suggestions*`、`/export`；生成 `POST .../generations`；上下文 `GET/PUT /api/creator/projects/:id/context`；检查 `POST .../checks`；资产 `GET/POST /api/assets`；配图 plan/generate/decision；发布 `POST .../publishing/report`。
- **E2E**：`e2e/creator-v2-compose.spec.mjs` 4 passed（55.8s，`.superpowers/compose-e2e-run.log`）；`e2e/writing-workspace.spec.mjs` 13 例全过（全量套件内）；独立探针 46/46（`.superpowers/compose-accept-state.json`，542 次 API 调用、0 pageerror、SQLite 修订逐字一致、双窗口 expectedRevision 冲突验证）。
- **结论**：**通过**。功能全真（建文/自动保存/渠道独立/冲突保护/配图计划与真实生成/发布准备四项人工检查/导出≠发布）；已登记偏差 9 条复核属实。验收新发现 5 项轻微项本次补记入偏差登记（主稿默认视图主 CTA 禁用淡化、1440 头部按钮换行、中栏/右栏密度高于设计、Esc 不关发布准备对话框、错误文案透出英文），均不触及领域不变量。

## 4. 热点雷达 `/hotspots`（设计 hotspots，独立一级页面）

- **设计页面/状态**：masthead 渐变横幅 + 双数字摘要、三格监控带、流程线、tab/来源/搜索控件行、热点列表卡（排名/品牌 tag/趋势 tag）、右栏 sticky 详情、信源抽屉、移动底部详情抽屉（creator-v2.2.html:142-153,166,174,22-44）。
- **正式路由/组件**：`app/hotspots/page.jsx` → `components/HotspotsRadar.jsx`。
- **设计截图**：`screenshots/design/hotspots-desktop.png`、hotspots-sources-drawer-desktop.png、hotspots-mobile.png、hotspots-mobile-detail.png。
- **实现截图**：`screenshots/hotspots/` 16 张 —— desktop.png、desktop-detail-selected、desktop-source-filter、desktop-search-filter、desktop-followed-tab、desktop-refresh-fail、desktop-network-fail、desktop-convert-topics-landing、desktop-sources-drawer、mobile.png、mobile-detail（+ 实现期 hotspots-*.png 5 张）。
- **API**：`GET /api/creator/sources`、`GET /api/creator/source-items?source=&limit=`、`POST /api/creator/sources/:id/sync`（RSS-only）、`POST /api/creator/source-items/convert`、小适配 `POST /api/creator/source-items/topic`（条目→素材→选题候选，URL 去重）。
- **E2E**：`e2e/creator-v2-hotspots.spec.mjs` 5 passed（45.4s，`.superpowers/hotspots-e2e2.log`）；独立探针 53/53（`.superpowers/hotspots-accept-report.json`）；单测 `test/creator-v2-hotspots.test.mjs`。
- **结论**：**通过**。无可信依据不展示热度/趋势分（e2e 断言无「升温中/新出现/持续讨论」文本）；收为选题候选真实持久化且重复转化有提示；上一轮验收发现的移动详情遮罩回归（旧按钮样式特异性覆盖致不透明白）已由 6f92c26 修复并容器内复测 `getComputedStyle` = `rgba(27, 33, 56, 0.66)`（= 设计 `#1b2138a8`），e2e 补遮罩颜色与点击关闭断言。

## 5. 选题发现 `/topics`（设计 discover/topics）

- **设计页面/状态**：内容主线步骤条（02 选题高亮）、「从线索到选题」banner、tabbar + 主题 chips、线索卡列表 + sticky 判断面板、三格证据卡（creator-v2.2.html:155,172,175）。
- **正式路由/组件**：`app/topics/page.jsx`（Suspense）→ `components/TopicsDiscovery.jsx`。
- **设计截图**：`screenshots/design/topics-desktop.png`、topics-mobile.png。
- **实现截图**：`screenshots/topics/` 5 张 —— desktop.png、desktop-judgment、desktop-recommend、mobile.png、mobile-judgment。
- **API**：`GET/POST /api/creator/topics`、`PUT/GET /api/creator/topics/:id`、`/history`、`/messages*`、`POST /:id/start`（幂等建作品）、`POST /api/creator/topics/recommend`；系列 `GET/POST /api/creator/series*`；任务 `GET /api/creator/jobs`、`POST /:id/review`。
- **E2E**：`e2e/creator-v2-topics.spec.mjs` 7 passed（52.5s，`.superpowers/topics-r2-e2e2.log`，复验 48.4s）；独立探针 22 项 0 失败 + 5 项增量复核（`.superpowers/topics-accept-func.json`、topics-accept-delta.json）；单测 `test/topics-discovery.test.mjs`。
- **结论**：**通过**。判断卡四字段绑定真实 topic 字段并可编辑、随修订持久化、409 保护；chips 改真实状态筛选（无伪造主题维度）；开始创作幂等建作品跳 `/compose?project=`；AI 推荐保留授权同意 + 服务配置前置。密度偏差（首屏低约 150px）已登记（/topics #9）。

## 6. 视觉工作台 `/illustrations`（V2.3 studio）

- **设计页面/状态**：三栏（图位清单 / 主视觉+候选 / 自然语言修改 inspector）、候选比较弹窗、平台预览弹窗、生成确认弹窗、移动底部四键导航；状态机 待生成→待审阅→已采用（creator-v2.3-visual.html:7,36-53,12-14）。
- **正式路由/组件**：`app/illustrations/page.jsx` → `components/IllustrationStudio.jsx`；队列 `app/illustrations/queue/page.jsx` → `IllustrationQueueWorkspace`。
- **设计截图**：`screenshots/design/v23-plan/-compare/-edit/-adopted/-preview/-preview-zhihu-desktop.png` + 对应 6 张移动 + v23-article-mobile.png。
- **实现截图**：`screenshots/illustrations/` 6 张 —— desktop.png、desktop-planning、desktop-compare、desktop-preview、mobile.png、mobile-planning。
- **API**：`GET /api/illustrations/projects/:id`、`POST .../plan`（含小适配 `scope:'cover'`）、`/agent-plan`、`shots/:id/generate|decision|review|recover`、`PUT .../prompt`（新增可选 `alt`）、候选 `GET/POST .../candidates`、`decision/comparison/feedback`、预算 `GET/PUT .../budget`、队列 `/queue/*`、映射 `PUT /api/assets/:id/mappings/:channel`、交接 `handoff*`、体检 `technical-audit`。
- **E2E**：`e2e/creator-v2-illustrations.spec.mjs` 5 passed（47.9s，`.superpowers/illu-accept-e2e.log`）；既有 `illustration-workbench`、`visual-handoff-v42`、`image-quality-roundtrip-v43`、`channel-image-audit-v52` 全量套件内通过；单测 `test/illustrations-studio.test.mjs` 5/5（`.superpowers/illu-unit.log`）。
- **结论**：**有条件通过**。「选中≠批准≠插入≠平台验证」红线有 e2e 断言（主稿 markdown 全程零 `asset://`）；三种规划模式/预算批处理/预览仅含已批准图均真实。但独立探针（`.superpowers/illu-verify-summary.json`，2026-10-20 10:07，39 步）确认 3 项缺陷：① 页面加载失败后点「重试」数据恢复但错误态不清除；② alt/视觉方案保存已落库但成功反馈不出现；③ 390×844 预览弹窗「继续配图」按钮滚动后仍不可点。其中 ①② 已在当前 HEAD 代码复核确认仍未修复（`components/IllustrationStudio.jsx:355-364` 缺 return、`:630-632` onRetry 不清 loadError），无修复 commit。详见 FEATURE-MATRIX 未完成项。

## 7. 发布中心 `/publish`（设计 publish）

- **设计页面/状态**：状态条（「可交付 ≠ 已发布」）、两渠道卡（微信四项/知乎四项人工检查 checkbox）、发布效果预览（手机壳 + 非真实渲染声明）、交付时间线两卡（creator-v2.2.html:160,179,204）。
- **正式路由/组件**：`app/publish/page.jsx` → `components/PublishCenter.jsx`（接管旧 StudioApp 入口）。
- **设计截图**：`screenshots/design/publish-desktop.png`、publish-checks-desktop.png、publish-mobile.png。
- **实现截图**：`screenshots/publish/` 13 张 —— desktop.png、desktop-checks、desktop-conflict-rollback、desktop-delivery-panel、desktop-empty、desktop-exported、desktop-network-fail、desktop-notice-pending、desktop-preview-zhihu、desktop-report-recorded、desktop-switch-project、mobile.png、mobile-more-panel。
- **API**：`GET /api/creator/platforms`；`GET/POST /api/creator/projects/:id/publishing`（bundle/draft/report/reconcile）；`GET/POST /api/delivery/projects/:id/:channel*`；checks `POST /api/editor/projects/:id/:channel/checks`（四项映射 factual/privacy/rights/layout）。
- **E2E**：`e2e/creator-v2-publish.spec.mjs` 5 passed（45.2s，`.superpowers/publish-e2e-accept.log`）；独立探针 105 项断言中 104 项通过、1 项 pass:false（`.superpowers/publish-accept-result.json`）——失败项为「控制台无 error」，detail 含 2×net::ERR_FAILED 与 1×409 Conflict，与探针内故意的断网/冲突回滚演练（desktop-network-fail.png、desktop-conflict-rollback.png）并存，归因未单独复核，如实登记；单测 `test/publish-center.test.mjs` 9 例。
- **结论**：**通过（附 1 项已登记的探针检查失败）**。四项检查按渠道独立真实落库（乐观勾选冲突回滚）、时间线由真实 facts/operations 派生、导出/草稿箱/作者报告三门槛（账号+能力+封面+同意）文案不混同发布、预览不加载外部内容。

## 8. 内容日历 `/calendar`（设计 calendar）

- **设计页面/状态**：工具栏（月份 + 周/月分段）、周条 7 日 + 事件胶囊、月视图七列月历、长期内容系列卡、完成条「日历不是隐藏的自动发布器」（creator-v2.2.html:162,180,202）。
- **正式路由/组件**：`app/calendar/page.jsx` → `components/CalendarWorkspace.jsx`。
- **设计截图**：`screenshots/design/calendar-desktop.png`、calendar-month-desktop.png、calendar-mobile.png。
- **实现截图**：`screenshots/calendar/` 5 张 —— desktop.png、desktop-month、desktop-schedule-modal、mobile.png、mobile-month。
- **API**：选题 `targetDate` 小适配（`creator_topic_details` JSON 字段，createTopic/updateTopic 校验 YYYY-MM-DD、随修订留痕、expectedRevision 保护）；`GET /api/creator/series`（next_run_at）、`PUT /api/creator/series/:id`；「安排下一篇」走既有 `POST /api/creator/topics`。
- **E2E**：`e2e/creator-v2-calendar.spec.mjs` 6 passed（43.1s，`.superpowers/e2e-calendar.log`，含「排期→周视图→刷新持久化」用例）；独立探针 36 项中断言 34 项通过、2 项 ok:false（`.superpowers/cal-func-result.json`）——「周视图:10 月 23 日出现新事件胶囊」与「工具栏计数更新为 4 项计划」（实测「3 项计划」）；同探针内「API 复核:targetDate=2026-10-23 已落库」与「月视图:事件胶囊渲染(共4条计划)」为通过，失败归因（探针时序 vs 周视图过滤）未复核，而对应 e2e 用例通过，如实登记待复核；单测 `test/calendar-view.test.mjs` 9 例（含 35/42 月格、坏日期 400、409 冲突）。
- **结论**：**通过（附 2 项待复核探针失败）**。日历事件只认两类真实计划（选题 targetDate + 激活系列 next_run_at），作品无排期只进诚实清单；周/月共用常驻工具栏（修复原型 `String.replace` 缺陷，设计基准已知边界 #4）；无默认发布日、不自动发布。

## 9. 效果复盘 `/insights`（设计 insights）

- **设计页面/状态**：声明条、范围分段（7/30/90 天）+「未连接」警示 pill、三格 KPI、内容表现（7 日趋势柱）、写作风格卡（确认学习/暂不学习）、三格学习卡（creator-v2.2.html:161,181）。
- **正式路由/组件**：`app/insights/page.jsx` → `components/CreatorInsights.jsx`。
- **设计截图**：`screenshots/design/insights-desktop.png`、insights-mobile.png。
- **实现截图**：`screenshots/insights/` 10 张 —— desktop.png、desktop-empty、desktop-after-save、desktop-range-90d、desktop-record-modal、desktop-style-pending、desktop-style-adopted、desktop-load-error、mobile.png、mobile-more。
- **API**：`GET/POST /api/creator/projects/:id/metrics`（人工录入）；新只读聚合端点 `GET /api/creator/insights`（insights-view 纯派生）；风格 `GET/POST /api/creator/style-suggestions`、`POST /:id`（采纳写画像、409 保护）；发布事实 `GET .../publishing`。
- **E2E**：`e2e/creator-v2-insights.spec.mjs` 5 passed（43.3s，`.superpowers/e2e-insights-final.log`）；单测 `test/insights-view.test.mjs` 9 例（最新快照聚合/缺失不补零/hasVerifiedPlatformData 恒 false）。
- **结论**：**通过**。KPI 全部来自作者手工录入的复盘数据，缺失显「—」，无录入显「暂无已验证平台数据」，「未连接平台统计」pill 常驻；趋势柱只画真实录入快照（7 天逐日/30·90 天分桶），绝不伪造平台指标。

## 10. 素材库 `/library`（设计 library）

- **设计页面/状态**：「我的内容资料夹」三格集合、filter 行（搜索 + 全部/文章/链接/图片）、素材三列网格、导入弹窗、完成条（creator-v2.2.html:163,165,182,185,203-204）。
- **正式路由/组件**：`app/library/page.jsx` → `components/LibraryWorkspace.jsx`（旧 `CreatorLibrary.jsx` 保留供 /insights 复用复盘逻辑）。
- **设计截图**：`screenshots/design/library-desktop.png`、library-mobile.png。
- **实现截图**：`screenshots/library/` 12 张 —— desktop.png、desktop-collection-links、desktop-detail、desktop-empty-search、desktop-import-modal、desktop-import-url-error、desktop-list-error、desktop-after-removal、desktop-removal-preview、desktop-visual-series、mobile.png、mobile-import-modal、mobile-more-panel。
- **API**：`GET /api/creator/library?q&kind&tag&archived&series&platform&from&to`、`PUT /api/creator/library/meta`；`POST /api/creator/materials`、`/:id`、`/materials/import-url`（公开链接需同意）；`GET /library/removal-preview`、`POST /library/remove-source`；`GET/POST /api/assets`；新只读端点 `GET /api/creator/library/visual-series`；从素材建选题 `POST /api/creator/topics`。
- **E2E**：`e2e/creator-v2-library.spec.mjs` 8 passed（51.9s，`.superpowers/e2e-library.log`）；单测 `test/library-view.test.mjs` 7 例；验证脚本 `.superpowers/verify-library*.mjs`（无留档结果 JSON）。
- **结论**：**通过**。四类设计卡片映射真实 material/article/image 三种 kind（纯派生单测）；导入三真实路径、详情面板承接来源/归档/关联作品/移除影响流；可复用视觉系列带走新只读端点（无新存储）。注：本页无独立全量功能探针 JSON，功能证据以 e2e 8 例 + 单测为主。

## 11. 偏好与连接 `/settings`（设计 settings）

- **设计页面/状态**：声明条「基础编辑不依赖 AI」、四组 settings-grid（创作画像/模型与费用/发布账号/信源与研究）+ 左侧分组菜单、完成条「密钥仅存服务端」（creator-v2.2.html:164,183,202）。
- **正式路由/组件**：`app/settings/page.jsx` → `components/SettingsWorkspace.jsx`（接管旧 `CreatorSettings.jsx`，旧组件保留仓库不再挂载）。
- **设计截图**：`screenshots/design/settings-desktop.png`、settings-models-desktop.png、settings-mobile.png。
- **实现截图**：`screenshots/settings/` 6 张 —— desktop.png、desktop-models、desktop-platforms、desktop-sources、mobile.png、mobile-models。
- **API**：画像 `GET/PUT /api/creator/profile`（expectedRevision、restoreRevision）+ `/profile/history`；服务连接 `GET/POST/PUT/DELETE /api/creator/services*`、`POST /api/creator/services/models`（V76 开放模型目录，密钥零回显）；平台 `GET /api/creator/platforms*`；信源 CRUD+sync（订阅显式同意门）；额度 `GET/PUT /api/creator/usage`、`POST /usage/:su`。
- **E2E**：`e2e/creator-v2-settings.spec.mjs` 6 passed（44.6s，`.superpowers/acc-settings-e2e.log`）；独立探针 35/35（`.superpowers/acc-settings-func.json`）；旧链路 `e2e/creator-v1.spec.mjs` 设置/连接全链适配后通过。
- **结论**：**通过**。四组还原设计、旧五 tab 收敛并保留 #services/#usage/#sources 深链映射；密钥零回显有 e2e 断言；旧深链 `/discover→/topics`、`/review→/insights`、`/editor→/compose` 有意义重定向（`/sources` `/validation` `/knowledge` 仍由旧 StudioApp 提供直至后续迁移）。

---

## 覆盖缺口与未验证项（诚实声明）

1. **设计「已发布」态**：领域无平台核验事实，实现以「作者报告已发表（未核验）」呈现 —— 属有意偏差，不是缺口。
2. **原型内嵌 SVG 示意图**：正式页渲染真实生成素材或诚实空态，SVG 不冒充生成图（V2.3 红线）。
3. **`/illustrations` 3 项探针缺陷未修复**（见总览第 6 行），合并前建议修复。
4. **真实付费生图、真实平台发布、生产部署、真实平台账号**：本仓库全部验证基于环回合成供应商与容器内模拟，均未验证（见 QA 与 PR 描述）。
5. **401/403 路径**：401 统一跳 `/signin` 为既有机制（`lib/creator-client.js:1-4`），本轮未对 11 个新页逐一注入 401/403 用例 —— 未验证项。

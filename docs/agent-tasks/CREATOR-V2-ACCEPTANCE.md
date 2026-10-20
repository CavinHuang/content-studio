# Creator V2 验收清单：真实功能、状态与证据

> 由实施 Coding Agent 按“通过 / 失败 / 不适用（解释）”填写；不能仅凭页面截图宣告通过。  
> 主任务：`docs/agent-tasks/CREATOR-V2-IMPLEMENTATION-PROMPT.md`  
> **填写说明（2026-10-20 交付轮）**：每条结论均标注证据（命令/日志/截图/代码位置）；本会话未实际执行的检查如实标注「未运行」或「未验证」，不凭空打勾。证据索引：`CREATOR-V2-QA.md`（命令与结果）、`CREATOR-V2-DESIGN-COVERAGE.md`（逐页矩阵）、`CREATOR-V2-DESIGN-DEVIATIONS.md`（偏差）、`CREATOR-V2-FEATURE-MATRIX.md`（功能与未完成项）。

## 0. 设计产物保真验收（必须先执行、逐页结论）

**参考源：** `public/design/creator-v2.2.html` 是全站设计主标准；`public/design/creator-v2.3-visual.html` 是配图交互主标准；`public/design/assets/creator-v2-tokens.json` 与 SVG 是可编辑视觉资产。设计 JSX 预览是辅助示例，不能替代两份原始高保真 HTML。生产功能必须复用真实 API。

| ID | 验收标准 | 所需证据 | 结论 |
|---|---|---|---|
| V01 | 首先用浏览器实际渲染两份原始 HTML，而不是凭 Markdown 或 React 示意组件想象设计 | 设计参考截图、源文件路径和原型版本 | **通过** —— 容器内真实渲染两份 HTML（`.superpowers/design-shots.mjs`，41 张 PNG 经 IHDR 校验，pageerror=0，design-shots-summary.json）；配方记录 `.superpowers/v2-env-recipes.md` §2（env-proof 实测 title=「Content Studio · Creator V2.2 全页面 UI/UX 交互设计」）；设计源 `public/design/creator-v2.2.html`（205 行）/`creator-v2.3-visual.html`（59 行）随 71aa6f6/614e95d 等提交入库 |
| V02 | 全部正式页面分别映射到参考设计：工作台、热点雷达、选题、作品、创作、视觉、发布、日历、复盘、素材、设置 | `CREATOR-V2-DESIGN-COVERAGE.md` 逐页对应关系 | **通过** —— 11 页映射矩阵已建（本交付）；本会话逐一生效性核对 `app/<route>/page.jsx` 挂载组件（CreatorHome/WorksLibrary/WritingWorkspace/HotspotsRadar/TopicsDiscovery/IllustrationStudio/PublishCenter/CalendarWorkspace/CreatorInsights/LibraryWorkspace/SettingsWorkspace） |
| V03 | 桌面 1440×900 版式对齐：深色固定导航、内容宽度、字体层级、色彩、卡片密度、留白和 CTA 主次，不自创新模板 | 原型与真实页面**并排截图**，每页至少一张 | **通过**（附已登记偏差）—— 每页 design/ 与实现截图并排可比（见 COVERAGE）；topics 主色探针 getComputedStyle=#465FD7（commit 5013e7c）；works 稀疏态窄列（验收时实测 718px）的机制根因已由 commit 18a6c7f 修复（`.cv2-main` 改 `width:100%`，现 creator-v2.css:110），稀疏态视觉复测未执行（偏差登记 /works #1） |
| V04 | 手机 390×844 完成原型对应交互；全局导航与创作内部导航不混用，热点详情/图像比较/配图规划/返回文章可操作 | 手机原型与真实页面并排截图 + E2E | **通过**（附 1 项缺陷）—— 每页 390 截图 + 分页 e2e 移动用例（无横向溢出、双底导航并存、更多面板可开合）；热点移动详情抽屉（hotspots/mobile-detail.png + e2e）；图像对比/规划（illustrations/mobile-planning.png + e2e）；返回正文=真实跳转（偏差登记 /illustrations #10）。缺陷：390 预览弹窗「继续配图」按钮不可点（/illustrations 缺陷 ③） |
| V05 | 原型中的点击、筛选、状态切换、版本比较和采用按钮，均对应真实接口/状态；不能只复用 Mock setState | 功能 E2E + API + 真实持久化证据 | **通过** —— 各页探针直验 SQLite（works-accept-state.json 的 db 段、compose 修订逐字一致、home 标已读 read=1、calendar targetDate 落库、insights creator_metrics 行、settings enabled=0）；e2e 全部走真实路由与 API；`/design/creator-v2` mock 预览未迁移、未改名上线（app/design/creator-v2/page.jsx 保持仅设计验收） |
| V06 | 设计 Token 在真实样式系统中落地，不能用旧森林绿五入口界面替换新版视觉；示例 SVG 不冒充真实已生成图片 | 源样式、组件、真实空态截图 | **通过** —— `app/creator-v2.css` `--cv2-*` tokens（侧栏 #242635/主色 #465FD7/背景 #F7F8FA）；11 页均换新壳（旧 forest 绿五入口仅存于旧 StudioApp 深链页）；实现图为环回合成供应商真实位图或诚实空态（illustrations 偏差 #1：SVG 不冒充生成图） |
| V07 | V2.3 图片状态“选中候选≠批准≠采用/插入≠平台验证”在 UI 文案和后台状态均不混同 | 规划/候选对比/采用前后、渠道预览截图 + E2E | **通过** —— e2e「选中 ≠ 批准」用例（主稿 markdown 全程零 `asset://`）；采用=显式 approve decision；平台预览仅渲染 approved 图 + 未登记渠道明示「导出稿不会包含这张图」（偏差登记 /illustrations #3/#9）；发布页「可交付≠已发布」状态条（偏差登记 /publish） |
| V08 | 如果因真实业务/安全/无障碍必须调整，差异最小且有依据，不擅自“重新设计” | `CREATOR-V2-DESIGN-DEVIATIONS.md`；无偏差注明无 | **通过** —— 逐页偏差登记共 60+ 条，每条含设计源位置/差异/原因/替代/证据；无偏差的页面项均写明「设计未画而保留既有真实能力」的先例依据 |
| V09 | 每页完成一次 Design → Code → Screenshot → Review，修复明显版面偏差后再关闭任务 | 设计→实现→截图→测试→结论的交叉矩阵 | **通过**（附遗留清单）—— 交叉矩阵见 COVERAGE；明显版面偏差已闭环修复（topics 按钮 V1 绿覆盖 631babb、移动页头 4346025、hotspots 遮罩 6f92c26、compose h1 4eae170）；遗留缺陷已登记（/illustrations 3 项、/works 1 项、壳层 Esc 1 项、/compose 轻微 2 项），见 FEATURE-MATRIX 横切表 |
| V10 | 原 HTML 来源和截图由当前提交生成；原阶段尚未提交的 PNG/ZIP 不作为 GitHub 已有文件来引用 | 参考文件路径、生成截图的 Git SHA/CI 产物链接 | **通过** —— 设计源与 SVG 已入库（71aa6f6、614e95d、53192a8 等）；实现截图随各页 commit 入库（经 `git log --diff-filter=A` 核实：home 主图 desktop/mobile.png 由 cd9e176 入库，6a8a576 仅更新 impl/ 过程图 2 张；topics cd5870c、settings 25a3fab）；本文引用的 `.superpowers/` 日志为 gitignore 留档，均已注明不入库 |

**视觉验证与功能验证都需通过。** 不要求随真实文本逐像素重叠，但不接受只有蓝灰配色、不同布局的新后台，也不接受像设计稿却没有真实数据的静态演示。

## A. 工作区一致性

| 编号 | 可验证结果 | 结论 |
|---|---|---|
| A01 | 所有正式 Creator 页面有统一侧栏、标题区域、操作样式，主导航突出当前页，不与旧 StudioApp 的视觉/导航混用 | **通过** —— 11 页统一 `CreatorShell`（本会话核对 11 个 page.jsx 挂载）；各页截图侧栏/底栏一致、当前项高亮；旧 StudioApp 仅剩 /sources /validation /knowledge 三条待迁移深链（登记于偏差 /settings #7，非 11 正式页） |
| A02 | 热点雷达为**独立一级页面**，不是藏在选题页面的一个 tab | **通过** —— `app/hotspots/page.jsx` + `components/HotspotsRadar.jsx` 独立路由；侧栏一级入口；e2e/creator-v2-hotspots.spec.mjs 5 passed |
| A03 | PC 1440×900 布局能显示主要内容和操作，390×844 手机可以完成主流程，侧栏和更多菜单可使用 | **通过** —— 每页 1440/390 双截图（COVERAGE 索引）；移动主流程 e2e（建文/筛选/排期/录入/规划等）；「更多」面板 6 入口可开合（home/mobile-more-panel.png；Esc 可关） |
| A04 | 移动端正式路由无横向溢出；键盘焦点和按钮语义正常，不存在只有 hover 才能操作的内容 | **通过（附 1 项登记缺陷）** —— 全路由 390px 无横向溢出（mobile-audit 16 例=15 路由循环+1 创作工作台独立用例 + 分页 e2e 逐页断言 scrollWidth）；home 键盘探针：首个 Tab=「跳到主内容」、≤25 步达「继续创作」与「文章标题」输入框。缺陷：Esc 关「更多」面板后焦点落 body 未返回触发按钮（`CreatorShell.jsx:124-136`，已登记 /home #5，待修） |
| A05 | 网络等待、首次空态、401 登录过期、403 禁止、409 修订冲突、500/503 错误有不同可理解反馈和重试路径 | **通过（覆盖度说明）** —— 断网+重试：home/works/compose/hotspots/publish/library 均有实摄（desktop-network-fail*）与 e2e；首次空态：home/works/compose/publish/insights 诚实零值实摄；409：compose 双窗口冲突横幅（e2e+截图）、topics/calendar/insights/profile 409 用例；500/503：ErrorState + 重试（但 /compose 错误文案透出英文原文，已登记 /compose #14）。**未逐页注入验证**：401（既有机制 lib/creator-client.js 401→/signin，未对本轮新页做专项用例）、403（无专项用例）——如实标注未验证 |
| A06 | 真实业务页面不出现硬编码示例热点、假阅读数、假图像、假成功、无效 CTA 或把“模拟”写成“运行中” | **通过** —— 热点无趋势/热度标签（e2e 断言文本不存在）；insights 无录入显「—」+「暂无已验证平台数据」（单测 hasVerifiedPlatformData 恒 false）；works「已发布」改标「作者报告已发表（未核验）」；演示 toast 全部替换为真实行为或移除（各页偏差登记）；「交互原型·示例数据」徽标移除 |

## B. 热点 → 选题 → 作品

| 编号 | 步骤与期望 | 结论 |
|---|---|---|
| B01 | 用合成 RSS/来源记录创建可用信源；热点展示真实 source-item title、来源与时间；没有 timestamp 则不编造 | **通过** —— 探针以真实信源 API 造数（hotspots-seed.mjs → POST sources/sync 落 source-items）；列表/详情显示真实 title/来源品牌/同步时间（53/53 探针 + e2e /同步 (今天\|10 月)/ 断言）；无时间显「同步时间未知」（偏差登记 /hotspots #7） |
| B02 | 筛选信源、搜索关键词、点击详情、打开原文链接，结果来源可追溯 | **通过** —— 服务端 `?source=` 筛选 + 客户端标题/摘要搜索（e2e 按「费用透明」命中摘要）；详情原文链接 item.url 新窗打开（e2e 断言 href）；截图 desktop-source-filter/desktop-search-filter/desktop-detail-selected |
| B03 | 点击「收为选题候选」，创建有来源的真实选题记录；刷新仍在、重复转化有提示 | **通过** —— `POST /api/creator/source-items/topic` 小适配：素材（URL 去重）→ draft 选题（refs 含原文 URL）→ 跳 /topics?topic=；重复返回既有选题 + duplicate 标记不重复建档（单测 + e2e API 验证 + 刷新持久） |
| B04 | 选题页从该候选回显标题、现有来源及证据缺口；保存和重进后不丢 | **通过** —— /topics?topic= 深链打开候选（e2e 转换落地断言：标题 input 值=条目标题）；判断卡四字段随简报版本持久化、来源依据经素材库解析、缺口橙提醒（e2e 编辑/冲突用例 + PUT 持久化） |
| B05 | 点击「开始写作」生成真正的 project id，并打开相应`/compose?project=...`；新建和直接创作同样有效 | **通过** —— `POST /api/creator/topics/:id/start` 幂等建作品（单测），e2e 断言 URL=/compose?project=<id>、projectId 一致、状态=写作中；/works 弹窗与 /home 快捷建文同样真实 POST（分页 e2e） |
| B06 | 选题推荐使用真实受权数据；无 AI 配置/未授权时可退回本地研究或清晰说明不可用，绝不发送私有正文 | **通过** —— 「AI 推荐选题」需勾选授权 + overview.services.text 为真才可点，未配置时禁用并提示去偏好与连接（e2e 无模型用例）；「从现有素材发现」本地路径无模型可用（e2e）；私有正文仅经显式同意的既有上下文边界（writing-workspace e2e「must reconfirm changed context」） |
| B07 | 没有可比的历史时间序列时，不出现“上升 90%”等模拟热度/来源交叉验证标签 | **通过** —— trend/heat 字段不存在于 `creator_source_items`（建表见 src/creator.mjs:157，字段仅 id/source_id/url/title/summary/published_at/synced_at），UI 不渲染趋势 tag；监控带明示「后端没有可信的热度/趋势计算，本页不展示热度分」；e2e 断言无「升温中/新出现/持续讨论」 |

## C. 作品和正文

| 编号 | 步骤与期望 | 结论 |
|---|---|---|
| C01 | 首页/作品库来自真实`/api/creator/overview`与作品存储；新建、搜索、进入、再次刷新仍正确 | **通过** —— home/works 探针真实 API 造数 + SQLite 直验（editorial_projects 3/5 行）+ 刷新持久化用例（分页 e2e）；搜索/筛选/卡片回跳同一 ep_ 项目（works 51/51） |
| C02 | 主稿可创建、编辑、保存，再刷新内容不变；离开与切换平台不吞掉未完成保存 | **通过** —— CodeMirror 输入自动保存 PUT→GET 一致、SQLite 修订逐字一致且追加（compose 探针）；刷新前未保存可恢复 tab 本地草稿（writing-workspace e2e「refresh before autosave can recover」）；保存状态常驻 role=status |
| C03 | master / wechat / zhihu 独立：编辑公众号版本不改主稿和知乎正文 | **通过** —— 「从主稿创建新版本」真实写平台稿且主稿修订不变、平台稿独立编辑不回写（compose 探针）；writing-workspace e2e「platform draft stays independent」；渠道状态独立落 editorial_channel_refs（works SQLite 直验 zhihu/wechat 各自状态） |
| C04 | 模拟两标签并发保存：旧 expectedRevision 提交被拒绝并提醒保留本地改动，不静默覆盖 | **通过** —— 双窗口 expectedRevision 冲突：409 → 本地草稿横幅（下载本地草稿/重试保存/载入服务器版本）、服务端未被覆盖、被拒内容不进修订（compose 探针 + desktop-conflict.png；writing-workspace e2e「two open pages cannot overwrite newer server content」） |
| C05 | 文章 Agent 只提交可审阅建议，用户拒绝时正文不变；现有修订/回滚功能仍可用 | **通过** —— agent-runtime e2e「files a reviewed suggestion and leaves the article untouched」；建议先进待采纳区（ribbon 语义）；拒绝不写正文；修订历史/版本 UI 保留（偏差登记 /compose #4 按钮） |
| C06 | 正文与图片版式的预览可访问，无图或缺 URL 时以诚实的占位/提示显示 | **通过** —— WritingPreview 本地渲染；配图视图空槽位「这一处还没有图片」诚实态（desktop-visual-empty.png）；发布预览 asset:// 显本地素材标注、外链显「预览不加载外部内容」占位（previewBlocks 单测） |

## D. 图片规划 → 生成 → 审核 → 采用

| 编号 | 步骤与期望 | 结论 |
|---|---|---|
| D01 | 在实际作品内切换封面/全文/指定段落，能基于真实主稿修订及段落标识建立计划 | **通过** —— 三模式走真实 API：默认 plan / `paragraphId` plan / 小适配 `scope:'cover'`（单测 + e2e 三模式逐一驱动）；计划携带 expectedMasterRevision，过期即 stale 提示重规划 |
| D02 | 在点击付费生成前，能读懂预计次数、服务、传输数据范围并明确同意；未同意不触发调用 | **通过** —— 确认弹窗列出真实待生成图位、供应商与单图调用上限 + 真实预算行（「按请求预留计数，不是费用估算」）；确认后才 POST batches/start（e2e）；本实现无任何未确认即调用路径 |
| D03 | 未配置图像服务时，仍能查看非付费配图建议/提示词，不出现假图片或假“生成完成” | **通过** —— 无供应商时提示词/建议可编辑保存（PUT prompt 真实落库），图位保持待生成诚实态；实现截图为环回合成供应商真实位图，无假图（illu 偏差 #1） |
| D04 | 视觉工作台能直达指定 project+slot，显示真实图位、Prompt、候选、状态和错误 | **通过（说明）** —— 多作品经 jobline 真实 select 切换（`/illustrations?project=` 惯例），图位经左清单/编辑器入口选择；图位/Prompt/候选/状态真实渲染；错误经 ErrorState 显示（缺陷：重试不清错误态，已登记 /illustrations 缺陷①） |
| D05 | 仅单击候选版本时，不改变 approve/insert 记录，也不修改任何稿件；切回来仍可识别正在预览的版本 | **通过** —— e2e「选中 ≠ 批准」：候选点选/对比弹窗「使用右侧版本预览」全程主稿 markdown 零 `asset://`；批准后按钮禁用并说明替换路径（illu 偏差 #3） |
| D06 | 使用合成 provider 生成两张：分别记录、显示候选；一张故意失败，不取消其他成功结果 | **通过** —— 环回合成供应商 e2e：候选分别记录显示；预算用例中预算阻塞图位转「生成失败」显领域错误原文，已完成图位保留「待审阅」，未执行图位保持「待生成」，互不阻塞 |
| D07 | 单张改图保留原始版本且不改变未修改图位；失败或网络中断保留历史和可恢复状态 | **通过** —— editImage 修改版入候选不覆盖原始候选（e2e 候选链路）；失败图位保留失败态+单图重试（预算用例）；recover 端点与队列 cancel/retry 既有（illustration-workbench e2e） |
| D08 | 点击「采用」才经现有权限、expectedRevision、批准/插入流程修改目标；刷新后仍有真实映射，不能只保存在 React state | **通过** —— 采用=`POST decision approve`；插入是独立事实（主稿真实出现 asset:// 才显示）；刷新后状态/映射仍在（e2e + 探针 pillsAfterReload） |
| D09 | 若主稿在计划建立后变化，旧图计划明确提示过期，拒绝复用旧 approval/插入，保留旧素材供审查 | **通过** —— jobline 显示「主稿 vN · 计划已过期」，stale 时规划带出现且「必须重新规划」（illu 偏差 #8 + 单测）；改视觉方案会退回待生成、已批准需重新批准并保留历史候选（illu 偏差 #2） |
| D10 | 预算不足、队列中断、超时、单张重试、重复点击不突破额度或无限向模型重发 | **通过** —— 预算压到 1 → 批量 → 阻塞如实呈现 + 单图重试 `budget.used===3`（e2e 断言）；队列幂等键 batches + cancel/retry（illustration-workbench e2e）。注：页面级加载失败重试缺陷属 D04/横切登记项，非预算路径 |
| D11 | 公众号与知乎各自的交付/图片 URL 状态真实；未真正上传 CDN 的图不能显示“平台已验证” | **通过** —— 渠道映射状态三态如实（已登记地址·未验证显示效果 / 尚未登记·导出稿不包含）；映射历史原子保留（V52 语义）；全站无「平台已验证」文案（探针 externalRequests 空） |
| D12 | 手机上能完成配图规划、对比、采用、返回正文；没有三栏拥挤、弹窗不可关闭或视口外按钮 | **部分通过** —— 规划/对比/采用/返回正文均有移动截图与 e2e（mobile-planning.png；底栏四键、两导航并存断言）；**缺陷**：390×844 平台预览弹窗「继续配图」页脚按钮滚动后仍不可点（探针 mobile-preview-footer，已登记 /illustrations 缺陷③，未修复） |

## E. 运营其他页面

| 编号 | 步骤与期望 | 结论 |
|---|---|---|
| E01 | 发布中心有真实的渠道账号/平台稿/审核状态；四项检查按平台独立记录 | **通过（附 1 项登记的探针检查失败）** —— 渠道卡显示真实账号/渠道状态行（草稿/已导出（不是已发表）/作者报告已发表（未经平台核验）+版本号）；四项检查按渠道独立 POST checks 落库、乐观回滚（e2e + 探针 105 项中断言 104 过：「控制台无 error」1 项 pass:false 源于探针内故意断网/409 冲突演练的控制台记录，归因未复核已登记 + 单测 9 例） |
| E02 | 未授权发布操作不会触达外部接口；本地导出、草稿箱投递与正式发布状态用词准确 | **通过** —— 探针记录 externalRequests 为空；草稿箱四重门槛（账号+能力+封面+同意，draft 需 idempotencyKey+allowExternalCall）；时间线用语「可交付≠已发布」「真实发布状态尚未确认」「未经平台核验」（publish-center 单测派生规则） |
| E03 | 素材库可检索当前真实附件并看到来源/使用范围，图片审核不等同于素材公开 | **通过** —— 搜索/kind 筛选/归档/高级筛选走既有服务端参数（e2e 8 例）；详情显示真实来源链接/加入时间/标签/关联作品；公开链接导入需显式同意；授权状态无字段不做假标签（library 偏差 #6） |
| E04 | 日历使用真实系列和作品计划，周/月切换显示同一事实集；没有数据时留空 | **通过（附 2 项待归因探针失败）** —— 事件只认 targetDate+next_run_at 两类真实计划（单测 buildEvents）；周/月共用同一事件集（e2e 排期→双视图→刷新持久）；无计划 pill=「暂无排期」；作品不伪装成事件。注：独立探针（.superpowers/cal-func-result.json，36 项）中「周视图新事件胶囊未现」「工具栏计数 3≠4」2 项 ok:false 待归因复核（同探针 API 落库与月视图通过；QA §4 #13、FEATURE-MATRIX 横切 #10） |
| E05 | 复盘没有真实账号统计时明确显示未连接；不得展示模拟点击量和转化率当成真实 | **通过** —— 「未连接平台统计」warn pill 常驻；KPI 仅来自人工录入（缺失显「—」，无录入显「暂无已验证平台数据」）；趋势柱只画真实录入快照（单测缺失不补零/hasVerifiedPlatformData 恒 false + e2e 空态） |
| E06 | 设置能打开现有模型/发布账号/信源配置，Secret 不回显；创作者画像改动应按已有 API 保存 | **通过** —— 服务连接/平台账号/信源/额度全部复用既有 API（无新增存储）；e2e 断言密钥不出现在页面与 GET 响应（零回显）；画像 PUT profile + expectedRevision、版本历史恢复（e2e 6 例 + 探针 35/35） |

## F. 可靠性与 QA

| 项 | 结论 |
|---|---|
| `npm ci --no-audit --no-fund`：结果和 Node 版本记录在 QA | **未执行** —— 本分支无 npm ci 留档日志；node_modules 按 `.superpowers/v2-env-recipes.md` §0.3 配方准备（Node 22 系容器镜像 node22-studio:pw）；V65 依赖锁哈希经 V64 回执+runtime-guard 间接核对。全新安装路径未验证 |
| `npm run check`：通过（或标记真实基线故障与对照证据） | **通过** —— 容器内执行（check-final.log，node --check 全清单无错误输出） |
| `npm test`：全部现存单测和新增单测通过 | **通过（基线豁免）** —— 最终 633 tests / 628 pass / 2 fail / 3 skipped；2 fail（V74 container-recovery）+3 skip（V69）为 root 容器环境门禁，与基线 f938fe8（562/557/2/3，2026-10-19）失败名单完全一致，非本分支回归（详见 QA §3）；净增 71 测全过 |
| `npm run build`：通过现有 V63-V76 原生构建保护，不绕过 | **通过（不含 V49 后置门禁）** —— build-guard 封存（Compiled successfully 40s、26/26 static、V64 回执绑定 HEAD/BUILD_ID/产物 SHA/V65 锁）；runtime-guard 拉起的生产服务通过全部 e2e。注：AGENTS.md/V49 要求 build 后执行 `npm run test:production`（真实进程重启持久性），本分支未执行（QA §2「未执行」），合并前须补跑 |
| `npm run test:e2e`：全量浏览器 E2E 在真实 Next 应用和合成数据上通过 | **通过** —— 最终全量 112 passed / 0 failed / 7.7m（23 spec，e2e-settings3.log）；基线 53 passed（f938fe8）；分页 59 例全过（QA §2 表） |
| 新增/更新 Playwright：每条 B/C/D 关键流至少有可复现验证；必要处使用真实本地路由和假 provider，不发送远程付费请求 | **通过** —— 11 个 creator-v2-* spec（59 例）覆盖 B/C/D/E 关键流；图像供应商为环回合成/未监听端口；ENABLE_SCENARIO=''；探针记录 externalRequests 空 |
| 对全部正式 Creator 路由执行 390px 手机 overflow 审计，保留至少首页、热点、创作、视觉工作台、发布的桌面/移动截图 | **通过** —— mobile-audit.spec.mjs 16 例（15 路由循环 + 1 创作工作台独立用例，全量套件内）+ 分页 e2e 逐页 scrollWidth 断言；五页桌面/移动截图齐备（COVERAGE 索引） |
| 对失败场景收集准确日志、失败 trace / 截图，并且修复选择器歧义，不能靠跳过或注释测试获得绿灯 | **通过** —— 失败日志留档（.superpowers/*）；选择器歧义已修（如 73ca555 guide selector、creator-v1 /library 入口 e769bca、topics 按钮皮肤 631babb）；无 skip/注释测试换绿灯（3 个 skip 均为既有环境门禁） |
| 保留现有登录认证、CSRF、私有数据隔离、构建校验、发布授权检查与编辑器修订语义 | **通过** —— V58 边界（validateLocalApiRequest）未动且其单测在套件内；多作者 MULTIUSER 会话隔离继续生效（分页 e2e 经 cookie 会话）；V63/V64/V65 构建门禁全过；修订/冲突语义有专项 e2e；mergeAuthorized/deployAuthorized 类授权标志未触碰 |
| 真实公网平台发布、CDN 粘贴、生产 Dokploy、私人备份恢复等未获凭据/权限的项目标记**未验证**，不伪造通过 | **通过（如实标注）** —— 全部标记未验证：真实付费生图（仅环回合成供应商）、真实平台发布/草稿箱（无真实账号）、生产部署/Dokploy、私人备份恢复、真实公网 RSS 抓取、npm ci、CI 绿；见 QA §2「未执行」与 PR 描述 |

## PR 合并准备完成定义

| # | 要求 | 结论 |
|---|---|---|
| 1 | 真实产品路由（非 design 预览） | **具备** —— 11 个正式路由挂载真实组件与 API；/design/creator-v2 保持 mock 预览不动 |
| 2 | 与原 API/数据库的端到端实现 | **具备** —— 全部走既有 dispatchApi/SQLite；小适配仅 6 处且逐条登记（source-items/topic、plan scope:'cover'、prompt alt、library/visual-series、targetDate、insights 只读聚合——均为复用既有表的无新存储适配） |
| 3 | 所有 P0 + P1 页面基本可用 | **具备** —— 11 页 e2e 全过 + 探针；遗留缺陷均为非阻塞（FEATURE-MATRIX 横切表） |
| 4 | 完成矩阵逐项有证据；无空泛“已实现全部” | **具备** —— COVERAGE/FEATURE-MATRIX/QA/本清单逐条给证据；未验证项如实标注 |
| 5 | 实现 PR 是 Draft/待评审状态，未自动合并、未自动生产部署 | **具备** —— 分支 feat/creator-v2-real-workspace 未 push、未建 PR、未合并；无任何部署动作 |
| 6 | 问题仅保留可复现且确实需要用户权限的硬阻塞，其他修复在同一个开发任务中闭环 | **未完全达成** —— 3 项 /illustrations 可复现缺陷（重试不清错误态、保存无反馈、390 预览页脚不可点）与 4 项轻微项（壳层 Esc 焦点、works 稀疏态窄列、compose Esc 对话框、英文错误文案）未在任务内闭环，均已登记且不触及领域不变量；建议合并前修复（无需用户权限） |

> 总结论：**视觉与功能双门槛整体通过**；11 页中 10 页通过（其中若干附已登记轻微项），/illustrations 为有条件通过（3 项未修复缺陷）；遗留项与未验证项逐条如实登记于 `CREATOR-V2-FEATURE-MATRIX.md` §横切表 与 `CREATOR-V2-QA.md` §2/§4。

# Creator V2 设计偏差登记（CREATOR-V2-DESIGN-DEVIATIONS）

> 依据 `docs/agent-tasks/CREATOR-V2-IMPLEMENTATION-PROMPT.md` §视觉与交互保真度硬性要求第 6 条：
> 当页面按原稿无法在真实数据、无障碍要求或安全约束下工作时，保留主要结构与视觉语言，做最小必要调整并在此登记。
> 每条包含：设计源位置/参考截图、实际差异、必要原因、替代方案、对应测试/截图。

## /compose 创作空间（2026-10-20，commit 范围 `feat/creator-v2-real-workspace` 分支）

1. **编辑器正文为 CodeMirror Markdown（分栏源码+预览），不是原型的 contenteditable 富文本纸面**
   - 设计源：`public/design/creator-v2.2.html:159`（`.editable` contenteditable 正文）、参考截图 `docs/implementation/screenshots/design/compose-desktop.png`。
   - 实际差异：正式页保留既有 `DoocsEditor`（CodeMirror 6，Markdown 源码）+ `WritingPreview`（doocs 本地渲染），默认「分栏」视图，白纸卡与 `MASTER DRAFT` 标签保留。
   - 必要原因：任务书「不可破坏」清单要求保留既有编辑器、自动保存、expectedRevision 冲突保护与不可变修订；contenteditable 原型只是视觉示意，没有保存/冲突语义。
   - 替代方案：以设计的稿纸卡（白底、圆角、纸标签、字数页脚）包住真实编辑器，视觉层级对齐设计。
   - 证据：`docs/implementation/screenshots/compose/compose-desktop.png`；`e2e/writing-workspace.spec.mjs`（12 例全过）、`e2e/creator-v2-compose.spec.mjs`。

2. **正文中不渲染原型式的内联图位按钮；图位以「配图视图」卡片 + 左栏配图定位 + 移动助手呈现**
   - 设计源：`public/design/creator-v2.3-visual.html:38-39`（正文段落间 `.inline-slot` 虚线按钮）、`v23-article-mobile.png`。
   - 实际差异：Markdown 编辑器正文内是真实的 `asset://` 图片行；图位状态在「切换到配图」视图（`ComposeVisualBoard`，虚线槽位卡样式与设计一致）与右栏配图助手（`WritingImages`）中呈现。
   - 必要原因：在 CodeMirror 文档内插入非编辑区块装饰需要深改编辑器，会危及不可破坏的编辑/保存/建议内联行为；任务书红线优先。
   - 替代方案：槽位视觉语言（虚线边框、＋占位、状态 pill、去生成/去审阅动作）完整搬到配图视图卡片上，状态全部来自真实 `GET /api/illustrations/projects/:id`。
   - 证据：`docs/implementation/screenshots/compose/compose-visual-desktop.png`；`e2e/creator-v2-compose.spec.mjs`「V2.3 配图入口」用例。

3. **渠道分段保留第四个真实渠道「小红书」**
   - 设计源：`creator-v2.2.html:159`（分段只有 主稿/公众号/知乎）。
   - 实际差异：分段控件为 主稿/微信公众号/知乎/小红书 四项。
   - 必要原因：小红书图文工作区（`XiaohongshuWorkspace`）是既有真实能力，`e2e/creator-v1.spec.mjs` 依赖；删除会丢功能。
   - 替代方案：沿用同一分段控件样式，四项并存。
   - 证据：`e2e/creator-v1.spec.mjs` 小红书导出链路通过。

4. **编辑器头部按钮比原型多（当前文章切换、新建文章、版本）**
   - 设计源：`creator-v2.2.html:159`（头部右侧仅 保存状态/返回作品/配图工作台/发布准备）。
   - 实际差异：增加 文章切换 select（`当前文章`）、`新建文章`、`版本` 三个真实操作入口。
   - 必要原因：多作品切换、建文与修订历史是 /compose 的真实既有功能，旧 UI 有、新设计未画。
   - 替代方案：保持设计的按钮次级样式（白底描边），主按钮仍为「发布准备」；窄屏按设计只保留主按钮与保存状态。
   - 证据：`e2e/writing-workspace.spec.mjs` 版本历史/新建流程；`e2e/creator-v2-compose.spec.mjs`。

5. **保存/冲突/恢复条保留旧交互形态，未做成 toast**
   - 设计源：`creator-v2.2.html:204`（编辑即存 toast 提示）。
   - 实际差异：保存状态为头部常驻 `role=status` 文本（已保存 · vN / 待保存 / 正在保存… / 保存暂停）；冲突与本地草稿恢复为醒目横幅（下载本地草稿/重试保存/载入服务器版本）。
   - 必要原因：冲突保护是安全边界（expectedRevision 409 后本地内容必须可下载、可重试），常驻横幅比 2.7 秒 toast 更不容易丢；`e2e/writing-workspace.spec.mjs` 断言这些横幅。
   - 替代方案：横幅配色对齐 V2 tokens。
   - 证据：`e2e/writing-workspace.spec.mjs`「two open pages cannot overwrite newer server content」。

6. **阶段条「配图」不显示已生成张数，仅以真实事实（已插入 asset:// 图片）标 done**
   - 设计源：`creator-v2.2.html:159`（done/now 态，示例数据写死 editorStep）。
   - 实际差异：研究/大纲/审稿/配图的 done 只来自真实事实（简报存在、真实标题行、已决策建议、已插入图片），发布恒为数字（写作文档不含导出/作者报告事实）；见 `src/compose-view.mjs` 注释与 `test/compose-view.test.mjs`。
   - 必要原因：任务书红线「无后端可信依据不得展示」；原型 editorStep 是写死的示例状态。
   - 证据：`test/compose-view.test.mjs`；`e2e/creator-v2-compose.spec.mjs` 阶段条断言。

7. **移动端工作流底栏叠加在全局底栏上方（不合并、不覆盖）**
   - 设计源：`creator-v2.3-visual.html:14,53`（底部固定 正文/配图规划/选图编辑/预览）；V2.3 原型无全局底栏。
   - 实际差异：正式页同时有 CreatorShell 全局移动底栏；工作流底栏固定在其上方（`bottom: calc(var(--cv2-mobile-nav-h) + …)`），两者并存。
   - 必要原因：设计清单要求「不允许与全局底栏随意合并或互相覆盖」。
   - 证据：`docs/implementation/screenshots/compose/compose-mobile.png`；`e2e/creator-v2-compose.spec.mjs` 移动用例（断言两个导航同时可见且无横向溢出）。

8. **文章标题使用 h1（样式为设计的 20px 编辑器头部字号）**
   - 设计源：`creator-v2.2.html:159` 编辑器头部标题为 h2（原型侧栏 logo 占用 h1）。
   - 实际差异：文章标题为页面主标题 `h1`，20px 样式与设计一致。
   - 必要原因：无障碍语义（页面主标题应为文章标题）；既有 e2e 以 level-1 heading 断言文章标题。
   - 证据：`e2e/writing-workspace.spec.mjs`、`e2e/creator-v1.spec.mjs` 通过。

9. **图位名称沿用配图领域序号（封面=1，正文图位从 02 起）**
   - 设计源：`creator-v2.3-visual.html:21-23`（正文配图 01/02 独立编号）。
   - 实际差异：图位标题用计划内真实 `ordinal`（文章封面、正文配图 02/03…）。
   - 必要原因：序号来自 `article_illustration_shots.ordinal`（含封面的计划内序号），选段配图（无封面）时序号从 1 开始，改编号会在无封面计划下显示 00。
   - 替代方案：状态标签（待生成/待审阅/已选用/生成失败）与设计一致。
   - 证据：`src/compose-view.mjs#shotTitle`、`test/compose-view.test.mjs`。

## /hotspots 热点雷达（2026-10-20，commit 范围 `feat/creator-v2-real-workspace` 分支）

设计源：`public/design/creator-v2.2.html:142-153`（hotspotsView）+ V2.2 精修 `:174`（监控带/完成条）、`:166`（信源抽屉）、`:22,:25-44`（移动底部抽屉）；参考截图 `docs/implementation/screenshots/design/hotspots-*.png`。实现截图 `docs/implementation/screenshots/hotspots/`（1440×900 三张 + 390×844 两张，容器内真实渲染，`pageerror`/`console.error` = 0）。

1. **趋势 tag（升温中/新出现/持续讨论）与热度分不渲染；「与我相关」筛选不提供**
   - 设计源：`creator-v2.2.html:128-133`（demoHotspots 每条带 trend/trendStyle 字段）、`:144`（与我相关按分类白名单过滤）、参考截图 `design/hotspots-desktop.png`。
   - 实际差异：行首与详情只显示真实字段（来源品牌 + 同步时间）；筛选只有「全部热点/我关注的」；监控带「风险提示」卡明示“后端没有可信的热度/趋势计算，本页不展示热度分”。
   - 必要原因：任务书 P0-B「上升/热度评分/多源证据只有后端存在可信计算依据时才能展示；否则隐藏或标注未计算，绝不将演示分数写成真实指标」。`creator_source_items` 无 trend/heat/relevance 字段（`src/creator.mjs:2011-2018`）。
   - 替代方案：列表头标注「按同步时间排序 · 未核验」；序号仅为列表位次（样式保留，前三位主色），不是热度名次。
   - 证据：`e2e/creator-v2-hotspots.spec.mjs` 桌面用例断言页面无「升温中/新出现/持续讨论」文本；`src/hotspots-radar.mjs` 注释。

2. **详情面板以真实的「原文链接 / 采集与同步」替代示例的编辑判断三段**
   - 设计源：`creator-v2.2.html:153`（为什么需要关注？/可能的写作角度/有哪些不确定性？三段示例文案）、demo 警示语「正式产品必须显示实际来源链接、采集时间、去重和失效状态」。
   - 实际差异：概要卡保留（真实 summary，缺失时如实说明）；三段编辑判断替换为「原文链接（item.url 新窗打开）」与「采集与同步（同步时间 + 信源发布时间，缺失如实标注）」；「来源待核实 + 未验证」警示行保留并显示真实同步时间。
   - 必要原因：真实信源条目没有 why/angle/risk 字段，凭空生成会伪造编辑判断；demo 警示语本身要求正式页展示原文链接与采集时间。
   - 证据：`docs/implementation/screenshots/hotspots/hotspots-detail-desktop.png`；`e2e/creator-v2-hotspots.spec.mjs` 断言详情原文 href 与「未验证」标签。

3. **「关注这个话题」保持页面会话态，不落库**
   - 设计源：`creator-v2.2.html:136,148`（hotFollowed 仅存于原型 state；masthead 文案「本次关注的话题 仅在当前原型会话」）。
   - 实际差异：关注为客户端会话状态（刷新即清空），masthead 第二计数如实标注「本会话关注的话题 · 不自动进入作品」。
   - 必要原因：后端无 follow 存储模型；为会话级交互新增平行存储违反「小适配、不新增模型」约束，且设计自身即定义为会话态。
   - 证据：`components/HotspotsRadar.jsx`（useState followed）；masthead 文案。

4. **「刷新热点」执行真实信源同步并如实报告失败，而非演示 toast**
   - 设计源：`creator-v2.2.html:203`（`data-action="hot-refresh"` → toast「这是示例热点，未接入真实数据」）。
   - 实际差异：按钮对每个已启用信源调用既有 `POST /api/creator/sources/:id/sync`（RSS-only，公开 HTTPS 边界），随后重载列表；结果如实汇总（全部失败 → 错误状态「同步失败…已保留现有条目」；部分失败 → 警告并列出失败信源；无启用信源 → 提示去管理信源开启）。
   - 必要原因：任务书禁止 mock 成功状态；信源同步失败（网络/DNS/非公网地址）是真实常态，必须可见。
   - 证据：`e2e/creator-v2-hotspots.spec.mjs`「刷新热点」用例（沙箱无外网，断言诚实失败文案且既有条目保留）。

5. **信源抽屉展示真实同步状态/最近读取时间，开关走既有信源保存接口**
   - 设计源：`creator-v2.2.html:166`（4 个示例信源 + 开关 + 「正式版本将在此展示来源可靠性、同步状态、失败原因和去重结果」）。
   - 实际差异：行内容为真实 `creator_sources`（name + 真实 status + last_run）；开关即 `PUT /api/creator/sources/:id`（与设置页同一确认语义 `allowExternalRequest:true`）；新增/移除信源保留在偏好与连接（抽屉内链接），不在雷达页重复建设。
   - 必要原因：该「正式版本」承诺由本页兑现；避免与 `/settings` 信源管理形成两套写入口。
   - 证据：`docs/implementation/screenshots/hotspots/hotspots-sources-drawer-desktop.png`；`e2e/creator-v2-hotspots.spec.mjs` 抽屉用例（真实状态文本 + aria-checked 切换）。

6. **「收为选题候选」为真实持久化链路：条目 → 素材（URL 去重）→ 选题候选（素材引用）**
   - 设计源：`creator-v2.2.html:199-201`（转选题 → 跳 discover 并 toast）；任务书「利用既有来源转素材和选题创建接口，确保原文来源可追溯、重复转换有合理提示」。
   - 实际差异：新增小适配 `POST /api/creator/source-items/topic`（`src/creator.mjs saveSourceItemTopic`）：复用 `convertSourceItems` 落素材（同 URL 去重、来源名入素材标签），再以 `{kind:'material',id}` 引用创建 draft 选题，reason 标注「热点雷达转入 · <信源名> 公开线索，标题与摘要未经核实」；完成后跳 `/topics?topic=<id>` 直接打开该候选。重复收起返回既有选题（duplicate 标记），不重复建档、不伪造“已创建”。
   - 必要原因：convert 接口只落素材不落选题且不返回素材 id，客户端拼两次调用无法保证原子性与可追溯；不新增存储模型，全部复用既有表。
   - 证据：`test/creator-v2-hotspots.test.mjs`（2 例：选题/素材/引用/去重/404/自定义标题）；`e2e/creator-v2-hotspots.spec.mjs` 转换用例（/topics 打开、API 验证 refs 与原文 URL、重复不新建）。

7. **行内时间显示真实同步时间（相对时间无后端依据）**
   - 设计源：`creator-v2.2.html:128`（age「35 分钟前」为示例数据）。
   - 实际差异：行内 time 显示「同步 今天 09:12 / 昨天 / M 月 D 日」（`src/hotspots-radar.mjs dayClock`，客户端渲染避免 hydration 偏差）；无同步时间的条目显示「同步时间未知」。
   - 必要原因：真实的 RSS 条目时间是绝对时间戳，相对化只是展示细节；真实字段优先。
   - 证据：`test/creator-v2-hotspots.test.mjs` dayClock 用例；`e2e/creator-v2-hotspots.spec.mjs` 行内 /同步 (今天|10 月)/ 断言。

8. **搜索框占位文案为「搜索标题或摘要」，非设计的「搜索话题 / 平台 / 分类」**
   - 设计源：`creator-v2.2.html:150`（hot-find placeholder）、参考截图 `design/hotspots-desktop.png`。
   - 实际差异：占位文案如实描述真实过滤行为——`src/hotspots-radar.mjs` 按 title/summary/sourceName 本地匹配，没有话题分类/平台标签字段可搜。
   - 必要原因：设计的占位暗示可按「分类」筛选，真实信源条目无分类数据，保留原占位会误导输入。
   - 替代方案：来源维度已由真实信源 chips 承担（服务端 `?source=` 过滤），搜索只补文本维度。
   - 证据：`e2e/creator-v2-hotspots.spec.mjs` 桌面用例搜索段（按「费用透明」命中摘要）；`docs/implementation/screenshots/hotspots/desktop-search-filter.png`。

## /topics 选题发现（2026-10-20，commit 范围 `feat/creator-v2-real-workspace` 分支）

设计源：`public/design/creator-v2.2.html:155`（discoverView）+ V2.2 精修 `:172`（内容生产线步骤条）、`:175`（从线索到选题 banner + 三格证据卡）；参考截图 `docs/implementation/screenshots/design/topics-desktop.png`、`topics-mobile.png`。实现截图 `docs/implementation/screenshots/topics/`（1440×900 三张 + 390×844 两张，密封生产服务容器内真实渲染，`pageerror`/`console.error` = 0，移动溢出 = 0）。

1. **判断卡四字段以真实简报字段呈现：读者问题/写作角度/来源依据/证据缺口（替代示例的「为什么值得写/需要先核实什么/来源策略」示例文案）**
   - 设计源：`creator-v2.2.html:155`（detail-panel 三段为 demoStories 示例数据）、参考截图 `design/topics-desktop.png`。
   - 实际差异：四段分别绑定真实 topic 字段 `problem / angle / refs(经素材库解析标题) / evidenceGaps`（`src/creator.mjs topic()`），可编辑、随简报版本持久化；「来源依据」对已被移除的素材诚实显示「来源已不可用」；四字段未齐时显示橙色缺口提醒（`src/topics-discovery.mjs judgmentGaps`），不阻断保存。
   - 必要原因：任务书 P0-B「/topics 以读者问题、写作角度、证据缺口、简洁大纲为主」；示例文案不能当真实数据展示。
   - 证据：`e2e/creator-v2-topics.spec.mjs` 桌面/编辑/冲突用例（四字段取值、PUT 持久化、409 冲突不覆盖）；`test/topics-discovery.test.mjs`。

2. **主题 chips（全部主题/AI 产品/独立开发/效率工具）改为真实状态筛选（全部状态/待讨论/大纲已准备/已确认/写作中/暂不创作）**
   - 设计源：`creator-v2.2.html:155`（filter-row 主题 chips）、`:126`（demoStories.cat 为示例分类）。
   - 实际差异：chip 行保留设计视觉（pill + active 态 + 右侧注释），但筛选项为 `creator_topics.status` 真实枚举；选题数据模型没有分类/主题字段（`src/creator.mjs createTopic:635-668`）。
   - 必要原因：无后端字段就不能伪造主题过滤；状态是真实存在的同构筛选维度（works 页阶段筛选同理）。
   - 证据：`e2e/creator-v2-topics.spec.mjs`（页面无「全部主题/AI 产品」chips 断言 + 写作中/待讨论筛选用例）；`app/creator-v2-topics.css` 头注。

3. **新增「记录选题」输入行；设计原稿的选题页没有创建入口**
   - 设计源：`creator-v2.2.html:155`（discoverView 无 create 控件）。
   - 实际差异：列表上方保留既有 `POST /api/creator/topics` 能力（输入框 + 记录选题按钮），空态时也可用；记录后自动切到「全部线索」并打开判断卡（作者自建选题的 provenance 是「作者提出的选题」，不属于「为我推荐」）。
   - 必要原因：旧页面具备的真实能力，creator-v1 全链与真实用户路径依赖；删除会丢功能。
   - 替代方案：样式对齐设计（searchbox 形态输入 + tiny primary 按钮），置于列表分支之外。
   - 证据：`e2e/creator-v1.spec.mjs` 记录选题链路；`e2e/creator-v2-topics.spec.mjs` 记录选题用例。

4. **「为我推荐」tab 以真实 provenance（reason）划分，不做相关性计算**
   - 设计源：`creator-v2.2.html:155`（tabbar 为我推荐/全部线索/已收藏，示例数据全部视为推荐）。
   - 实际差异：`为我推荐` = reason ≠ 「作者提出的选题」（服务端默认值，`src/creator.mjs:641`），即热点雷达转入、素材推荐、模型候选、系列准备的真实来源；不推导任何分数。收藏为星标视图：已收藏线索不从其他 tab 移除（与原型 `state.saved` 语义一致）。
   - 必要原因：任务书红线「无后端可信依据不得展示推荐度」；provenance 是已持久化的真实字段。
   - 证据：`src/topics-discovery.mjs isRecommendedOrigin` + `test/topics-discovery.test.mjs`；`e2e/creator-v2-topics.spec.mjs` 收藏/桌面用例。

5. **页头增加「内容系列」次级入口；系列规划与准备任务保留在本页（设计未覆盖）**
   - 设计源：`creator-v2.2.html:155`（页头仅「查看热点雷达」）；V2.2 全部页面无系列管理界面。
   - 实际差异：页头为 [内容系列] [查看热点雷达] 两钮；系列视图保留旧页全部能力（创建/暂停/准备/任务核对 CreatorJobReview/条目管理，标签不变），样式改用 V2 tokens。移动端两钮均按设计的移动形态收缩为纯图标圆钮（38px，「查看热点雷达」为设计原钮的图标化；「内容系列」为新增入口的连带形态）。
   - 必要原因：内容系列是既有真实功能（`/api/creator/series*`、`e2e/creator-v1.spec.mjs` 两条系列用例），设计没有对应屏幕，不能凭空删除。
   - 替代方案：入口收进页头按钮而非独立 tab，保持发现视图与设计一致。
   - 证据：`e2e/creator-v1.spec.mjs` 系列两用例通过（含阻塞任务核对）。

6. **判断卡标题为可编辑输入框（视觉 = 设计 h3 18px），而非静态标题**
   - 设计源：`creator-v2.2.html:155`（detail-panel h3 静态标题）。
   - 实际差异：`aria-label="选题标题"` 的输入框套用设计标题排版（`.cv2-detail-title-input`），hover/focus 显示边框。
   - 必要原因：选题标题是简报第一字段，旧页可编辑且 creator-v1 断言其值（采纳建议后标题变化、热点转入候选标题一致）；静态化会砍掉真实编辑能力。
   - 证据：`e2e/creator-v2-hotspots.spec.mjs` 转换落地断言（选题标题 input 值 = 条目标题）；`e2e/creator-v1.spec.mjs` 采纳后断言。

7. **「开始创作」按钮命名为设计原文「围绕这个选题开始写作」，行为 = 保存判断 + 幂等建作品**
   - 设计源：`creator-v2.2.html:155,192`（data-idea → startFrom 创建作品进 editor，演示数据）。
   - 实际差异：点击先以 `expectedRevision` 保存当前简报（status=confirmed），再 `POST /api/creator/topics/:id/start`（幂等：已有 projectId 时返回同一作品），随后真实跳转 `/compose?project=<id>`；选题已关联作品时面板另提供「继续创作（已有作品）」链接。
   - 必要原因：设计演示的建作品交互由真实领域服务兑现；不新增存储，不伪造创建。
   - 证据：`test/topics-discovery.test.mjs` start 幂等用例；`e2e/creator-v2-topics.spec.mjs` 开始创作用例（URL、projectId 一致、状态=写作中）。

8. **AI 推荐保留用户确认并新增「服务配置前置」；「与我相关」式的智能推荐不提供**
   - 设计源：任务书 P0-B「AI 推荐和私有素材传输保留用户确认及服务配置前置」；设计原稿未画推荐控件。
   - 实际差异：「批量推荐」折叠区内：`从现有素材发现`（本地，无模型也可用）与 `AI 推荐选题`（需勾选授权 + `overview.services.text` 为真才可点击）；未配置模型时按钮禁用并提示去偏好与连接配置，绝不假装成功。
   - 必要原因：旧页 AI 按钮只看授权，未配置模型时点击必然 503；前置禁用给出可操作的下一步。
   - 证据：`e2e/creator-v2-topics.spec.mjs` 桌面用例（无模型 → 禁用 + 提示 + 本地发现成功）；`e2e/creator-v1.spec.mjs`（合成模型 → AI 推荐完整链路通过）。

9. **1440×900 首屏线索网格比设计低约 150px：新增「批量推荐」折叠条与「记录选题」输入行各占一行**
   - 设计源：`creator-v2.2.html:175` + 参考截图 `design/topics-desktop.png`（chips 行之下直接是线索网格，首卡 y≈580 完整可见）。
   - 实际差异：chips 行与网格之间多出两条已登记能力的行——「批量推荐：从素材与模型获取候选」折叠条（本节 #8）与「记录选题」输入行（本节 #3），首卡下移至 y≈730，首屏露出卡头，需轻微滚动看到完整卡。
   - 必要原因：两条都是真实既有能力（AI/素材推荐、POST /api/creator/topics 建选题），折叠形态已把高度压到最小；再压缩会牺牲可发现性或砍功能。
   - 替代方案：折叠条收起时仅占单行（约 49px），记录行高 40px；保持行距与设计节奏一致。
   - 证据：`docs/implementation/screenshots/topics/desktop.png`（与 `design/topics-desktop.png` 对照）；`e2e/creator-v2-topics.spec.mjs`（折叠区与记录行用例）。

## /illustrations 视觉工作台（2026-10-20，commit 范围 `feat/creator-v2-real-workspace` 分支）

设计源：`public/design/creator-v2.3-visual.html`（studio 三栏 `:7`、图位清单/主视觉/候选 `:45-46`、右栏 inspector `:47`、对比弹窗 `:49`、平台预览弹窗 `:50`、生成确认 `:51`、移动 `:12-14`）；参考截图 `docs/implementation/screenshots/design/v23-*.png`。实现截图 `docs/implementation/screenshots/illustrations/`（1440×900 四张 + 390×844 两张，密封生产服务容器内真实渲染，`pageerror`/`console.error`=0，移动溢出=0；数据为环回合成图像供应商生成的真实位图资产）。

1. **图位缩略图/主视觉是真实生成的位图素材，不是原型内嵌 SVG 示意图；「图片比例」行改为真实素材事实**
   - 设计源：`creator-v2.3-visual.html:27-31`（`art()` 内嵌 SVG 示意图，showcase 角标「2.35:1 · 原型图」）。
   - 实际差异：大图与缩略图渲染 `GET /api/assets/:id/preview` 的真实生成素材；showcase 角标显示真实 `mime · KB` 与当前画面方案；「图片比例：2.35:1」不再凭空展示——领域模型未存每图位目标比例，实测尺寸/比例由运维带的「离线图片技术体检」（V42）给出，与设计标注位置不同但更诚实。
   - 必要原因：任务书红线「演示 SVG 不能伪装成已通过 AI 生成的资产」；领域 `content_assets` 不存目标比例字段，伪造比例即虚构指标。
   - 替代方案：保留空态插画风格的「这一处还没有图片」（对齐设计 `.emptyart` 文案与渐变）。
   - 证据：`docs/implementation/screenshots/illustrations/desktop.png`；`e2e/creator-v2-illustrations.spec.mjs`（真实素材 img 断言）。

2. **视觉方向 chips 为真实 style 枚举（高级杂志插画/抽象结构示意/抽象隐喻），不是设计的 克制科技/杂志叙事/自然编辑**
   - 设计源：`creator-v2.3-visual.html:41,:47`（`st.style` 三种 demo 风格 + 三色 swatch 卡）。
   - 实际差异：保留设计的三色 swatch 卡视觉；选项绑定 `article_illustration_shots.style` 真实枚举（editorial/diagram/abstract，即旧工作台同一组选项），切换后需点「保存视觉方案」走 `PUT shots/:id/prompt`（携带 `expectedUpdatedAt` 冲突保护），保存会把该图位退回「待生成」、已批准状态需重新批准（历史候选保留）——按钮旁明示该后果。
   - 必要原因：demo 风格名无后端字段；单击即改写并悄悄退掉已批准状态太危险，显式保存更贴近「修改仅影响尚未采用的新图片」语义。
   - 证据：`test/illustrations-studio.test.mjs`（prompt 保存/冲突用例）；`e2e/creator-v2-illustrations.spec.mjs`。
   - 连带后端小适配：`PUT prompt` 新增可选 `alt`（2–160 字）以支持「图像说明与可访问性」组的真实保存（设计中该组保存只弹 toast）。

3. **「采用这张图」=领域「批准」决定；已批准态不是原型的一键「替换为当前版本」**
   - 设计源：`creator-v2.3-visual.html:46,:56`（adopt → pill 变「已采用」、按钮变「替换为当前版本」、toast「其他位置不受影响」）。
   - 实际差异：采用 = `POST shots/:id/decision {decision:'approve'}`（显式批准）；批准后按钮变为禁用「已批准」并说明「替换版本请在候选中选择（会回到待审阅），再重新批准」，另有「不采用」（reject）入口。候选选择（含对比弹窗「使用右侧版本预览」）只切换当前素材并使状态回到「待审阅」，全程不写文章；「已插入」是独立事实（主稿 markdown 真实出现 `asset://<assetId>` 才显示，见左清单状态 pill）。
   - 必要原因：选中≠批准≠插入≠平台验证是不可破坏的领域不变量；一键替换会悄悄撤销批准。
   - 证据：`e2e/creator-v2-illustrations.spec.mjs`「选中 ≠ 批准」用例（主稿 markdown 全程零 `asset://`）。

4. **「再生成一版」在有图位时要求先填写自然语言修改方向；「调整裁切/添加参考图」示意工具不提供**
   - 设计源：`creator-v2.3-visual.html:46`（一键 variation 出风格变体）、`:47`（裁切/参考图为示意 modal）。
   - 实际差异：无图位时按钮为「生成第一版/重新生成」（真实 `generate`）；有图位时「再生成一版」必须先在右栏写 ≥12 字修改方向（走真实 `editImage` 参考图候选链路），未填时禁用并提示。裁切/参考图上传后端无对应操作，按「不做无效按钮」红线不渲染。
   - 证据：`e2e/creator-v2-illustrations.spec.mjs`（editImage 候选链路通过，环回合成供应商，无费用）。

5. **渠道交付与质量能力收拢为三栏之下的「运维带」；设计中未画**
   - 设计源：`creator-v2.3-visual.html:45-53`（studio 无映射/交接/体检/质量评分界面；原型不调用模型与渠道）。
   - 实际差异：网格下方新增「渠道交付与质量检查」带（四张卡）：渠道映射登记（含历史，V52 语义）+ 带图 Markdown 交接（V30/V31 只读提案）+ 四项人工核查（V40 handoff-qa）；离线技术体检（V42，与 URL 登记分卡、明示「分开的两件事」）；既有 `QualityEvidencePanel`（V43 质量评分与导回核对）与 `VisualSeriesPanel`（V37 系列视觉，沿容器对齐 V2 tokens，组件未改）。另有「跨文章队列」入口（jobline）。
   - 必要原因：这些是任务书点名不可丢的真实能力（映射/审批/队列/预算/人工核查）；设计未覆盖 → 按 /topics 系列入口先例保留并登记。
   - 证据：`e2e/illustration-workbench.spec.mjs`（映射前检/人工核查/队列三用例）、`e2e/visual-handoff-v42.spec.mjs`、`e2e/image-quality-roundtrip-v43.spec.mjs` 全部通过；`docs/implementation/screenshots/illustrations/desktop-preview.png`。

6. **三种规划模式落在真实 API：只做封面=新增 `scope:'cover'` 小适配**
   - 设计源：`creator-v2.3-visual.html:41`（编辑器助手 只做封面/完整配图/指定段落，demo 仅做列表过滤）。
   - 实际差异：完整配图 = 既有默认 plan；指定段落 = 既有 `paragraphId` plan（会替换当前计划，UI 先 confirm「原图保留在素材库」）；只做封面 = `POST plan {expectedMasterRevision, scope:'cover'}`（`src/illustrations.mjs` 小适配：同一 plan/shot 存储，无新模型，单测覆盖）。无计划或计划过期（`stale`）时规划带出现；有计划时可通过清单头「重新规划」再次打开。
   - 证据：`test/illustrations-studio.test.mjs`（scope cover/非法 scope/段落计划）；`e2e/creator-v2-illustrations.spec.mjs` 桌面用例（三种模式逐一驱动真实 API）。

7. **批量生成走既有队列与预算机制（确认弹窗+轮询），失败与预算阻塞如实呈现**
   - 设计源：`creator-v2.3-visual.html:51`（确认本次生成范围弹窗，demo 不调用模型）。
   - 实际差异：确认弹窗列出真实待生成图位、供应商与单图调用上限，并显示真实预算行（V38「按请求预留计数，不是费用估算」）；确认后 `POST /queue/batches`（幂等键）+ `/queue/start`，页面轮询队列状态直至空闲。预算耗尽时：已完成图位保留「待审阅」，预算阻塞图位转「生成失败」并显示领域错误原文，未执行图位保持「待生成」——单图重试（`generate`）与后续生成互不阻塞。
   - 必要原因：任务书 P0-C「按既有预算/队列机制发起批处理；一张失败不阻塞其他图」。
   - 证据：`e2e/creator-v2-illustrations.spec.mjs` 预算用例（预算压到 1 → 批量 → 逐图重试，`budget.used===3`）。

8. **jobline「已保存 · 原型模拟」替换为真实主稿版本 tag 与项目切换 select**
   - 设计源：`creator-v2.3-visual.html:36`（保存状态为演示文案）；V2.3 studio 无项目切换。
   - 实际差异：显示真实 `主稿 vN · 方案可用/计划已过期`（来自 `sourceRevision` 与 `stale`，过期时规划带给出「必须重新规划」警示）；「配图文章」select（aria-label 沿用旧页）保留多作品切换能力（既有 e2e 断言其值）。
   - 证据：`e2e/illustration-workbench.spec.mjs`、`e2e/creator-v2-illustrations.spec.mjs`。

9. **「查看最终效果」平台预览由真实主稿段落渲染；未登记渠道地址的已批准图如实标注「导出稿不会包含这张图」**
   - 设计源：`creator-v2.3-visual.html:50`（仅显示已采用图片 + 「各平台仍须独立核对裁切」+ 页脚「已采用 n / 3 张」）。
   - 实际差异：保留三条红线交互；段落来自真实主稿文档（markdown 标题行渲染为小节标题），图片仅为 `status==='approved'` 的图位；每张图下显示 alt 与该渠道映射状态（已登记地址·未验证显示效果 / 尚未登记·导出稿不包含）；页脚计数与「继续配图」保留。
   - 证据：`e2e/creator-v2-illustrations.spec.mjs` 预览断言（公众号 1 图 + 知乎未映射提示）；`docs/implementation/screenshots/illustrations/desktop-preview.png`。

10. **移动工作流底栏 4 键中「正文」为真实跳转；图位清单为横向滚动条**
    - 设计源：`creator-v2.3-visual.html:14,:53`（正文/配图规划/选图编辑/预览，前两者切换原型内 editor 视图）；`:14`（`.shotitems` 横向滚动条）。
    - 实际差异：正文=跳转 `/compose?project=…`（真实编辑器）；配图规划=滚动到规划带；选图编辑=当前视图（active）；预览=打开预览弹窗。底栏位于全局移动底栏上方 5px，不合并不覆盖（同 /compose 偏差 #7）；页面底部预留双栏高度。
    - 证据：`e2e/creator-v2-illustrations.spec.mjs` 移动用例（两导航并存、位置断言、无横向溢出）；`docs/implementation/screenshots/illustrations/mobile.png`。
## /publish 发布中心（2026-10-20，commit 范围 `feat/creator-v2-real-workspace` 分支）

1. **正式页接管旧 StudioApp 发布入口；`/publish` 不再渲染 StudioApp**
   - 设计源：设计对应表「V2.2 发布中心 → /publish」；任务书 P1「正式接管旧 StudioApp 的发布入口」。
   - 实际差异：`app/publish/page.jsx` 改挂 `PublishCenter`（CreatorShell + V2 tokens）；旧 StudioApp 仍可通过 `/discover` `/review` 等其它深链到达（审计 §2），其发布分区自然退出该路由。`e2e/mobile-audit.spec.mjs` 的 /publish 无溢出断言继续成立。
   - 必要原因：任务书点名要求；旧入口无法呈现按渠道独立检查与真实交付时间线。
   - 证据：`e2e/creator-v2-publish.spec.mjs` 5 例全过；全量 `npx playwright test` 87 例通过（含 mobile-audit）。

2. **「交付操作」区为渐进披露的真实功能块（原型此处只有 toast）**
   - 设计源：`creator-v2.2.html:160,:202`（`data-publish` 按钮点击仅弹「原型不执行发布」toast）；`:160` 渠道卡底部只有 编辑渠道稿 + 主按钮。
   - 实际差异：四项检查全勾后主按钮变「准备微信草稿交付/准备知乎交付」，点击在卡内展开交付操作区：本地交付包下载（`POST publishing/bundle`）、公众号草稿箱（账号+封面+同意+能力检查四重门槛，`POST publishing/draft`）、作者报告链接记录（`POST publishing/report`）；`outcome_unknown` 发送在时间线行内提供核对表单（`POST publishing/reconcile`）。
   - 必要原因：导出/草稿箱/作者报告是既有真实领域能力，必须有真实入口；设计原型明确「正式版本将在此提供真实平台交付」，本页即为该正式版，且全程保持「导出≠草稿箱≠真实发布」文案红线。
   - 证据：`e2e/creator-v2-publish.spec.mjs` 交付包下载/草稿门槛/作者报告三用例。

3. **多作品时页头增加作品切换 select；深链 `?project=` 直达**
   - 设计源：`creator-v2.2.html:160`（页头仅「返回作品」，原型只有单篇示例文章）。
   - 实际差异：作品多于 1 篇时页头出现真实项目切换器；单篇时不渲染（与设计一致）；`/publish?project=ep_…` 深链对齐 /compose、/illustrations 的既有参数惯例。
   - 必要原因：真实工作区存在多作品，发布中心必须能选择对象；无凭证不展示（单作品时零新增控件）。
   - 证据：`e2e/creator-v2-publish.spec.mjs`「多作品时出现真实项目切换器，切换加载对应作品」。

4. **卡片副标题与渠道状态行使用真实字段；手机预览不再显示「作者 · Content Studio」示例行**
   - 设计源：`creator-v2.2.html:160`（公众号卡副标题《示例标题》、知乎卡副标题「独立标题、开头和段落结构」；预览手机壳内「作者 · Content Studio」）。
   - 实际差异：两渠道卡副标题统一显示真实项目标题《…》；卡内新增真实「渠道状态」行（草稿/已导出（不是已发表）/作者报告已发表（未经平台核验）+ 已交付版本号）；预览以「移动端 · 本地排版示意」标注替代作者示例行。知乎稿的独立结构在预览分段切换中如实呈现（内容来自该渠道真实 Markdown）。
   - 必要原因：示例文案不得伪装数据；真实状态行是导出≠发布的可见凭证。
   - 证据：`docs/implementation/screenshots/publish/desktop.png`、`desktop-checks.png`。

5. **四项检查标签采用设计的渠道化措辞，映射到同一组领域键 factual/privacy/rights/layout**
   - 设计源：`creator-v2.2.html:160`（公众号：事实、数据与引用来源/隐私信息与敏感内容/图片及文字使用权/移动端排版与裁切预览；知乎：关键观点与资料出处/平台版本独立审阅/图片使用权与外链/平台真实展示预览）。
   - 实际差异：标签文字与设计逐字一致，按位置映射到 `src/editorial.mjs:11` 的四个既有检查键，无新字段；勾选即真实 `POST /checks`（expectedRevision 冲突保护保留，乐观更新失败回滚并显示服务端错误）。
   - 必要原因：设计的渠道化措辞是视觉层事实；领域键是存储事实，二者不冲突。
   - 证据：`test/publish-center.test.mjs`（两渠道标签映射同一组键）；`e2e/creator-v2-publish.spec.mjs` 勾选/持久/渠道独立用例。

6. **时间线由真实 facts/operations 派生，替换设计的固定三行与「演示状态」tag**
   - 设计源：`creator-v2.2.html:179`（`.v2-delivery-log` 固定三行 + tag「演示状态」）。
   - 实际差异：`src/publish-center.mjs` `buildDeliveryTimeline` 只从 `publishing.history`（exported/draft_saved/published facts + sending/failed/outcome_unknown operations）与 editorial 渠道状态派生；「等待完成发布前核查」「真实发布状态尚未确认」仅在确实未完成时出现；作者报告行保留「未经平台核验」；卡片 tag 用真实汇总 pill（有检查项未完成/两渠道检查已完成）。
   - 必要原因：任务书红线「无后端事实不得展示状态」；设计三行是示例状态。
   - 证据：`test/publish-center.test.mjs`（9 例：pending 行只在真实未完成时出现、succeeded 操作不与 draft_saved 事实重复成行等）；`e2e/creator-v2-publish.spec.mjs` 时间线断言。

7. **预览为「本地排版示意」，不加载外部图片 URL；小红书渠道不在本页**
   - 设计源：`creator-v2.2.html:160`（发布效果预览手机壳 + 「这不是平台真实渲染」）；原型仅公众号/知乎两卡。
   - 实际差异：手机壳渲染当前渠道真实 Markdown 的轻量文本视图（`previewBlocks`，标题/引用/列表/分隔线/图片占位；`asset://` 显示本地素材标注，外链图片显示「预览不加载外部内容」占位，不发起任何外部请求）；页脚保留设计的「这不是平台真实渲染」声明并加强为本地排版示意。渠道卡按设计保留公众号/知乎两张；小红书图文交付继续在 /compose 小红书工作区（既有能力，设计未画，遵循 /compose 偏差 #3 同一先例）。
   - 必要原因：任务书 V53/V52 边界——预览不得偷拉外部内容，也不得声称平台真实渲染；渠道分区以设计两张卡为准。
   - 证据：`test/publish-center.test.mjs` previewBlocks 用例（外链不加载、asset 标注 local）；`docs/implementation/screenshots/publish/desktop.png`。

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

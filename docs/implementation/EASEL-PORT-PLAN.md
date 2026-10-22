# Easel 体验移植落地方案（EASEL-PORT-PLAN）

> 状态：设计定稿 r4（2026-10-22：vendor 导入后追加 §11「完整还原：vendor 适配期」——
> Run A/Run B 已落地，AG-01/AG-02 转正为首期优先项，全部 spec 改以 vendor/easel
> 真实源码为 adaptedFrom 依据；r3 2026-10-22：Run B 开工前基线核对——记录 Run A 后行号漂移
> 与 e2e 计数 29、追加 §10 服务端 Agent 化章节；r2 2026-10-21 修订：P1-01 与
> epoch effect 协同、setStage 多路径 URL 单点化、Phase 1 拆分为两个 run、
> e2e 计数更正、§0 范围限定、P1-03 验收措辞、P1-02 去重决策）。
> 本文档是「把 Easel 的流程与设计改造到本仓库」的总方案：差距矩阵 + 分期路线 +
> Phase 1 施工详单。Phase 1 为一个 run 内可施工完的切片。
>
> 证据基础：
> - 三份只读勘察（Easel 前端 / Easel 链路 / 自家现状），其中自家现状的每个行号锚点
>   已在本仓库 HEAD 0096429 上逐一复核（详见 §2 表内 `path:line` 引用）；
> - 本次补充核对：`src/compose-view.mjs` 全文、`components/CreatorShell.jsx` 全文、
>   `components/CreatorHome.jsx` 全文、`components/DoocsEditor.jsx` 全文、
>   `src/creator-home.mjs` 全文、`app/compose/page.jsx`、
>   `components/WritingWorkspace.jsx` 关键段（:140-320 / :300-425 / :420-545 /
>   :880-1030 / :1090-1219 / :1280-1782 / :2000-2030 / :2410-2499）、
>   `src/editorial.mjs` setChecks（:83-87）、`lib/api.mjs` 路由正则、
>   `package.json` scripts、e2e 用例数实测
>   `grep -cE "^test\(" e2e/creator-v2-compose.spec.mjs` → **26**。
> - Easel 侧结论引用勘察原文的 `Easel 文件:行号`，未在本仓库重读 Easel 源码（不在本仓库内）。

---

## 0. 一句话定位

把 Easel 的「阶段流水线可视化、任务进度诚实呈现、产物回流、人工审核交接」这四套
体验骨架，映射到我们既有的 Next.js 16 App Router 路由与修订制（revision）文章模型上。

**范围表述（r2 修订）**：**Phase 1 事实为零新增请求、零 schema 变更**——P1-01 的
四个改动点全部复用既有路由（`lib/api.mjs:197-199,241,247`；`lib/creator-api.mjs:209`），
无任何新 fetch。全案任何一期都**不改 SQLite schema**；「写作 API 零新增」只对
Phase 1 成立：后期若需扩展既有 API 的**行为**（如 Phase 6 检查快照绑定——
`editorial.setChecks` 现在显式拒绝四个布尔以外的键并在
`src/editorial.mjs:84` fail、把四布尔写进 `editorial_channel_refs.checklist_json`
JSON 列 `:85`），必须在对应期开工前单列评估（存储是 JSON 列，预期无需改表，
但行为变更必须独立评审）。

---

## 1. 总原则与硬约束（违反即方案无效）

1. **单前端、单数据模型**：Next.js 16 App Router 是唯一主前端；不引入 Python 后端；
   不新建第二个编辑器数据模型（AGENTS.md:3）。新界面优先消费既有 API。
2. **AGPL 边界**：`skills/builtin/gzh-design` 是 AGPL-3.0，本方案**不含任何搬运其代码的
   步骤**。公众号富文本排版继续走自家 `doocs` vendor 路径
   （`WritingWorkspace.jsx:991-1029` exportDocument + `renderDoocs`；
   legacy `/compose/handoff` 保留）。Easel 技能层/主题组件库只作思路参照。
3. **V27 领域不变量全保**（自家现状勘察 invariants 逐条复核过锚点）：
   - 不可变修订：任何恢复/合并都是新修订（`src/writing.mjs:573` INSERT 追加；
     UI 文案 `WritingWorkspace.jsx:921-936`）——改造不得引入覆盖历史的交互；
   - `expectedRevision` 冲突检测：save / decide / master-sync / export / context PUT /
     generation 全部携带（`WritingWorkspace.jsx:464-473,575-578,805-810,1000-1002`；
     后端 409 `src/writing.mjs:515-520`）——阶段化改造不得吞 409、不得在阶段切换时
     丢弃未保存修改（编辑器跨阶段常挂载是前提，拆组件必须不重挂载或补 flush）；
   - 主稿/平台稿独立（不自动改写、不「一键同步全渠道」，`WritingWorkspace.jsx:1919-1950`）；
   - 四项人工检查按渠道独立（`src/compose-view.mjs:56-60`；保存走
     `/api/editor/projects/:id/:channel/checks`，`lib/api.mjs:247`）；
   - 导出 ≠ 实际发布（文案 `WritingWorkspace.jsx:1014-1023,1736-1738`）；
     不新增自动发布，不把导出渲染成「已发布」；
   - 证据明示（`PublishingControls.jsx` provider_response / author_report / local_export
     分类；人工记录 ≠ 平台核实，`WritingWorkspace.jsx:1059`）；
   - AI 输出是假设、先入待采纳区、显式 consent（`:766-769,2149-2207`）；
     不得批量自动接受建议；
   - 诚实呈现、禁止伪造进度（`src/compose-view.mjs:1-8` 注释即法规；
     新增任何进度/统计必须可溯源到真实领域事实）；
   - V58 本地 API 边界（`lib/api.mjs:31` validateStudioApiRequest；JSON-only 写请求）；
   - V76 多模型顺序对比语义（不并行化计费请求、保留 modelLabel 出处）；
   - V52/V53 图片边界（不自动抓图、不自动替换已审 Markdown）。
4. **壳层结构冻结**：十一个工作区（侧栏 10 + 偏好与连接 1）+ 移动 5 快捷 + 「更多」
   不得增删（AGENTS.md:10；`CreatorShell.jsx:19-48` 已复核）。Easel 的 11 页 IA
   只能映射进这 11 个工作区的**内部**，不能新开第 12 个顶层路由。
5. **设计基线**：Creator V2.2/V2.3 tokens（`public/design/assets/creator-v2-tokens.json`，
   本次复核 keys = $schema/meta/color/shape/typography/layout/principles）。
   Easel 的视觉主题（青靛渐变、暗色、Bodoni）**不移植**；只借鉴其信息架构、
   分层状态色语义、微文案与密度。
6. **工艺门禁**：每次改动跑 `npm run check`、`npm test`、`npm run build`
   （AGENTS.md:9），QA 报告诚实更新。

---

## 2. 差距矩阵

严重度口径：**高** = 直接压制每日创作主路径的体验/可信度；**中** = 明显缺失但有
替代路径；**低** = 锦上添花；**不做** = 与领域不变量冲突，策略性放弃。

| # | Area | Easel 怎么做（证据） | 我们现状（复核锚点） | 差距 | 严重度 |
|---|------|----------------------|----------------------|------|--------|
| G1 | 工作台首屏总览 | 问候 + 六大快捷入口 + 四格统计 + 热点/选题/排期/产物四卡 + 跨平台归因看板（DashboardPage.tsx:131-370） | hero + 三格真实统计 + 待办清单 + 最近作品表 + 线索列（`CreatorHome.jsx:170-407`；数据全部来自 `GET /api/creator/overview`，聚合在 `src/creator-home.mjs`，诚实规则注释 :20-26） | 首屏已相当完整，但**作品行只有单标签阶段**（`projectStage` 三态，`src/creator-home.mjs:61-70`），缺 Easel 式「每篇作品六阶段进度点」的一眼可读性；归因看板不做（无登录态数据源，见 §7） | 中 |
| G2 | 阶段流水线与进度可视化 | `.easel.json` steps[] 五层 done\|failed + 断点续跑 + 下游 latest 直取（manifest.py:9-46）；技能卡/看板/日历贯穿五层专属色（styles_index.css:29-34） | 六步阶段条已上线（PR #49），但 done 只由 4 个布尔推导（`src/compose-view.mjs:12-35`：hasBrief/hasOutline/hasDecidedSuggestions/hasInsertedImages），**不反映**四项检查、配图计划 stale、主稿差异、待采纳建议数；检查 ribbon 只在审稿/发布阶段出现（`WritingWorkspace.jsx:1413`） | **进度事实面窄 + 就绪度无单一汇总**：用户在研究/写作阶段看不到「离可发布还差什么」；这是 Easel「层间契约可视化」思想最该落地的位置 | 高 |
| G3 | 阶段可导航性（深链/前进后退） | 单页 state 切页（App.tsx:701-766），页面本身即锚 | **阶段状态不进 URL**：`stage` 是纯组件 state（`WritingWorkspace.jsx:156`），`goStage` 不写 URL（:440-445）；`useSearchParams` 只读 project/channel（:105, :286-301）；且 epoch effect 在 mount 与每次 project/channel 装载时无条件 `setStage("write")`（:327，依赖 `[projectId, channel]` :382）——阶段重建点有两处而非一处 | 无法深链「审稿视图」「发布准备」；前进后退在阶段间失效 | 高 |
| G4 | 写作导航（大纲） | ——（Easel 无对应，属我们自查缺口） | 左栏大纲点击只 `editor.current?.focus()`（`WritingWorkspace.jsx:1798`），不定位标题行；第一项固定 active（:1794）与真实光标无关；DoocsEditor 是 CodeMirror 6 封装，ref 只有 selection/insert/focus（`DoocsEditor.jsx:28-32`），但 `onSelection` 已回传光标 `{from,to}`（:42）——跳转与跟随的技术前提都已具备 | 长文导航是摆设；e2e :910 还把这个缺陷固化为断言（「大纲链接点击聚焦编辑器」） | 高 |
| G5 | 任务进行中反馈与通知 | SSE 四层状态（正文/思考/步骤/心跳）+ 全局可见；ask_user 卡片（App.tsx:206-375） | 生成忙碌指示只在右栏助手内（`WritingWorkspace.jsx:2231-2258`）；收起助手或切到其他阶段后，头部只有保存徽标（:1234-1248），用户不知模型仍在生成；**全局单条 notice 字符串**（:117, :1486-1493），40 处 `setNotice(` 调用后发覆盖前发、错误/成功同样式无分级 | 生成中离开右栏即失联；多条异步动作的错误互相吞 | 中 |
| G6 | 审稿与版本体验 | （Easel 无版本树；其建议卡+产物回流体验完整） | 版本历史每版只是 `<pre>{row.markdown}</pre>` 折叠（:2482-2485），无两版对比；建议卡「查看替换内容」是 `<pre>`（:1182-1185），「在正文中查看」要跳回 write 阶段（:1173-1181）；原生 `window.confirm` 三处（copyMaster :896、restore :923-927、reloadDocument :1108） | 「这版改了什么」答不了；审稿↔写作来回跳步数多；confirm 与卡片语言割裂 | 高 |
| G7 | 审核快照绑定与发布交接 | 人工模式逐平台勾选**绑定内容快照**：改任一字即作废需重审（ManualPublishPage.tsx:66-67,222-225）；复制/富文本/ZIP 全部 gate 在已审核后（:113-147）；官方发布页跳转审核前禁用（:230）；发布后回填 HTTPS 链接到日历并标注「未自动验证」（:149-169） | 四项检查按渠道独立已有，但**不绑定内容快照**——勾完检查再改正文，检查仍显示已完成（checks 是独立布尔态，`src/compose-view.mjs:56-60`）；服务端 `editorial.setChecks` 只收四个布尔、显式拒绝多余键（`src/editorial.mjs:84`），四布尔存 `checklist_json` JSON 列（:85）；导出 gate 在 allChecksDone 已有（`WritingWorkspace.jsx:1684,1703,1710`）；交付包 zip/草稿箱/reconcile 已有（PublishingControls）；publishing/report 人工回填已有（:1046-1063） | 「检查通过的那一版」和「现在这一版」可能不是同一版而不被察觉——这是 Easel 快照绑定思想唯一值得且能安全落地的位置（存储是 JSON 列，预期无需改 schema，但 `setChecks` 行为必须扩展，见 Phase 6 前置评估） | 中高 |
| G8 | 产物/成品展示 | outputs/ 项目画廊 + 对话内 ArtifactGallery 回流 + sandbox iframe（OutputsPage.tsx:176-337；MessageBubble.tsx:44-53） | 产物模型不同：我们是修订制文章 + `asset://` 插图 + 交付包；作品库 `/works`、素材库 `/library`、视觉工作台已覆盖「成品/素材分区」职责；对话内无产物轮播概念 | 形态差异而非缺陷；插图已回流正文（`WritingWorkspace.jsx:880-893` 插入 asset://）。缺的只是把「生成记录/插图产出」在对话流里更可预览——低优先 | 低-中 |
| G9 | 技能/能力可视化 | SkillPage 五层分区浏览 + 诚实状态角标（需 API/已配置）+ 抽屉就地执行/配 key（SkillPage.tsx:19-146; SkillDrawer.tsx） | 无独立技能库界面；AgentRuns 技能任务折叠在助手栏（`WritingWorkspace.jsx:2295-2303`，AgentRuns.jsx）；V76 模型出处已显示（modelLabel :1161-1163） | 壳层不能加工作区（§1.4），只能把「能力状态」做进助手栏与设置页的**内部分区** | 中 |
| G10 | 发现链路（热点/选题/日历/拆解） | TrendsPage 六平台雷达 + IdeasPage 三栏看板 + CalendarPage 双轨月历 + BreakdownPage 拆解模板 | `/hotspots`（HotspotsRadar）、`/topics`（TopicsDiscovery，支持深链）、`/calendar`（CalendarWorkspace）、`/insights` 均已有且走同一壳层；缺「爆款拆解」模板器 | 链路已对齐；拆解器可作 topics 内的功能扩展 | 低 |
| G11 | 账号与真实发布链路 | 七平台扫码/短信登录 + 自动发布状态机 + 风控验证码（AccountsPage; PublishPage:190-292） | **刻意缺失**：export ≠ actual publish 是领域不变量（AGENTS.md; V52/V75） | 不做（见 §7）。Easel 自己也并列了 ManualPublishPage——我们要学的是它的**人工交接**那半（G7），不是自动发布那半 | 不做 |
| G12 | 画像/上下文体系 | 画像=六个 markdown 维度文件 + onboarding 向导 + 公众号数据幂等合并（ProfilePage; OnboardingWizard） | WritingContext 按渠道作者设定（引用素材/排除/渠道覆盖/账号绑定，带 expectedRevision 保存）+ 设置页画像（CreatorHome `data.profile.domain`） | 已有等价物；不引入第二套画像体系 | 低 |
| G13 | 设置与模型矩阵 | 六通道矩阵 + 从端点拉模型列表 + 环境体检（SettingsPanel.tsx:25-544） | V76 连接目录/模型多选/绑定指纹已落（SettingsWorkspace + `/api/creator/services+models`） | 呈现可矩阵化，但能力面已对齐 | 低 |
| G14 | 视觉与设计语言 | 白纸底 + 青→靛渐变 + 暗色主题 + Bodoni + 五层专属色 | off-white #F7F8FA + indigo #465FD7 tokens（AGENTS.md:10 指定基线） | **不移植视觉**；只借鉴：分层状态色语义（一行一个事实一个色）、微文案密度、非阻塞门语气 | 不做（策略） |
| G15 | 流式任务工程 | per-turn 事件日志 + after 游标重放 + 会话快照兜底 + 断线不杀（web/app.py:2840-3205） | 逐段流式预览 + 停止 + 失败恢复 `resumeGeneration`（`WritingWorkspace.jsx:621-634,2231-2258`）；V76 顺序生成 + usage reservation | 「后台跑完、随时回来按事件游标取回」需要服务端事件日志与存储改造，超出本期边界 | 不做（本期） |

---

## 3. 分期路线（r2：Phase 1 拆分为两个 run）

评审意见：原 Phase 1 四个 workItem 体量在上限、风险集中（P1-01 含 Next 16 原生
history 集成验证 + epoch effect 矛盾修复 + 新 e2e；其余三项各自要动 2500 行的
`WritingWorkspace.jsx` 并更新多条既有 e2e），若 P1-01 触发降级或返工，四个 item
一次 run 大概率做不完。采纳拆分：**Run A（Phase 1）只做 P1-01；Run B（Phase 2）
做 P2-01/02/03**（原 P1-02/03/04，规格已定稿见 §5）。

| Phase | 一句话方向 |
|-------|-----------|
| **Phase 1（Run A，本次施工）** | 阶段可导航：`?stage=` 深链 + 前进后退 + 三条 setStage 路径 URL 单点化 + epoch effect stage 协同（P1-01，唯一 workItem） |
| **Phase 2（Run B）** | 就绪可读与写作导航：P2-01 发布就绪度全阶段可见（Easel 式就绪度条）、P2-02 大纲点击真跳转+active 跟随光标、P2-03 通知分级+生成中全局指示——三项规格已定稿（§5，行号按 §10.1 现位执行）；服务端 Agent 切片为 SA-01/02/03，规格唯一来源 `EASEL-AGENT-SERVER-PLAN.md`（2026-10-22 定稿：**AG-01/AG-02 移出本期**，见该方案 §3/§7 与本节 §10.2/§10.3 状态注）。Run B 名册 = P2-01/02/03 + SA-01/02/03 共 6 项 |
| **Phase 3** | 工作台总览 Easel 化：`CreatorHome` 最近作品行升级为六阶段进度点（复用 compose-view 派生，吃 overview 既有 per-channel facts），作品库行内同样指示 |
| **Phase 4** | 审稿体验升级：版本历史两版对比 diff（前端纯计算，数据来自既有 `GET /history`）、建议卡就地并排对比（审稿阶段内不再跳阶段）、三处原生 confirm 换应用内对话框 |
| **Phase 5** | 小红书渠道 IA 并轨：xhs 纳入五阶段呈现（等效 research/review 工作面 + 阶段条），数据面仍走既有 `src/xiaohongshu.mjs` 与图文工作区，不改 API |
| **Phase 6** | 审核快照绑定与交接强化：前置评估 `editorial.setChecks` 行为扩展（携带内容 revision 指针；`src/editorial.mjs:84` 现拒绝多余键、`:85` 存 `checklist_json` JSON 列——预期无需改表但必须独立评审 API 行为变更），改字后检查显示「需重审」；发布阶段官方页跳转引导卡；report/reconcile 与日历状态色打通呈现 |
| **Phase 7** | 能力与任务可视化：AgentRuns 卡片化（分层、状态、模型出处、诚实标注）、写作助手快捷指令菜单化（分组 + 搜索，Brush 式）、设置页模型连接矩阵化呈现 |

每期都重复同一套验收：`npm run check` + `npm test` + `npm run build` +
`npm run test:e2e`（相关 spec 更新），QA 记录进 `docs/implementation/CREATOR-V2-QA.md`。

---

## 4. Phase 1 施工详单（Run A：唯一 workItem P1-01）

**范围**：只动 `/compose` 的阶段状态与 URL 同步，呈现层零新增请求
（复用 `lib/api.mjs:197-199,241,247` 既有路由，无新 fetch）、`src/writing.mjs` 与
`lib/api.mjs` 零 diff。统一约束：编辑器与阶段组件不重挂载（`goStage` 语义保持，
`WritingWorkspace.jsx:440-445`）；所有新增事实来自组件已持有的真实数据
（`src/compose-view.mjs:1-8` 规则）。

### P1-01 阶段状态进 URL（深链 + 前进后退，含 epoch effect 协同）

- **files**: `components/WritingWorkspace.jsx`、`src/compose-view.mjs`、
  `test/compose-view.test.mjs`、`e2e/creator-v2-compose.spec.mjs`、
  `docs/implementation/CREATOR-V2-QA.md`
- **背景（评审 high 项）**：`stage` 共有**三条**赋值路径——①`goStage`（:440-445，
  阶段条/CTA 点击）；②`openPlanner`（:416-422，直接 `setStage("images")`，且
  `mobilePane` 语义与 goStage 不同）；③**epoch effect**（:302-382）在 mount 时
  （projectId 为空即 :328 early return 之前）与每次 project/channel 装载完成时
  无条件 `setStage("write")`（:327，依赖 `[projectId, channel]` :382）。这意味着
  仅改 :156 初值为 `parseStage(query.get("stage"))` 会被清掉**两次**，深链验收
  无法通过；只把 URL 同步写进 goStage 会让 openPlanner 与 epoch 重置造成
  UI/URL 错位。spec 必须同时覆盖三条路径。
- **spec**:
  1. `src/compose-view.mjs` 新增纯函数 `parseStage(value)`：白名单
     `research|write|review|images|publish`，非法/缺失返回 `"write"`；单测覆盖。
  2. **初值**：`stage` 初值改为 `parseStage(query.get("stage"))`（:156 处）。
  3. **URL 写入单点化**：新增 `syncStageUrl(next, mode)` helper（`mode: "push"`
     或 `"replace"`），把 `?stage=` 与既有 `project`/`channel` 参数合并后写 URL：
     - `goStage(next)`（:440-445）：`setStage(next)` 后 `syncStageUrl(next, "push")`；
     - `openPlanner`（:416-422）：**保留其自身 `setMobilePane("assistant")` 等语义
       不改走 goStage**（goStage 会把 mobilePane 设为 "article"，行为不同），
       仅补 `syncStageUrl("images", "push")`；
     - **epoch effect（:327 最小改动）**：`setStage("write")` 改为
       `setStage(parseStage(query.get("stage")))`，并紧随其后
       `syncStageUrl(该值, "replace")`——mount 与 project/channel 切换都用
       **replaceState**（装载不制造历史条目）。这一行改动只涉及呈现层 stage 重置，
       **不触碰 expectedRevision / 保存 / 建议 decide 路径**（护栏 §6 相应放行
       这一处）。effect 依赖 `[projectId, channel]`（:382）不变；其闭包捕获的
       `query` 是该次渲染的值，用户切阶段（只变 stage）不会触发本 effect 重跑。
  4. **projects 加载 effect 依赖收窄**：:286-301 的 effect 依赖从整个 `query` 对象
     收窄为 `query.get("project")` 与 `query.get("channel")` 两个字符串——否则每次
     切阶段都会重跑 refreshProjects（文档重载防线 :302 epoch effect 由
     `setProjectId` 同值不触发，不受影响）。
  5. **popstate 对齐 effect（新增）**：以 `query.get("stage")` 字符串为唯一依赖的
     独立 effect：`const s = parseStage(query.get("stage")); if (s !== stageRef.current) setStage(s)`。
     等值守卫防循环（goStage 先 setStage 再 pushState，query 异步到齐后该 effect
     命中守卫为 no-op）；浏览器后退/前进由它承接。**注意**：点 4 收窄后 popstate
     只改 stage 时不再有任何既有 effect 被触发，本 effect 是对齐的唯一落点。
  6. 若 pushState 与 Next 16 `useSearchParams` 同步在施工首日的最小验证中表现
     异常（验证方法：切阶段 → `query` 对象更新、:286 effect 不重跑、文档不重取），
     **降级为全 replaceState**（放弃前进后退，保住深链与刷新），在 QA 记录降级
     决定。降级只影响前进后退，不影响首载深链（首载深链由点 2+3 的初值与
     epoch 协同保证，与 push/replace 无关）。
  7. 无障碍：阶段按钮既有 `aria-current="step"`（:1327）保持；URL 同步不改变
     焦点管理。渠道边界：`stage=publish` 深链 + `channel=master` 落主稿引导卡
     （:1628-1652）、+ `channel=xiaohongshu` 落 xhs 发布卡（:1626,:1662-1664）——
     均为既有可达状态（头部发布按钮 :1298-1305 对 xhs 可用），无需特判。
- **acceptance**:
  - 单测：`parseStage` 白名单/非法值/缺省全过（`test/compose-view.test.mjs`）；
  - e2e 新增（`e2e/creator-v2-compose.spec.mjs`，现 26 条全数保留）：
    1. 带 `?project=<id>&stage=publish` 打开 → **文档装载完成后**仍停在发布准备
       阶段且发布对话框元素可见（防 epoch :327 二次重置）；
    2. 点击阶段条切到审稿 → URL 含 `stage=review` 且正文与未保存修改保持
       （切前输入一段文字断言仍在），且**没有新的文档 GET**（网络断言）；
    3. 浏览器后退 → 回到上一阶段；前进 → 再回到审稿；
    4. 视觉工作台入口（openPlanner 路径）后 URL 为 `stage=images`；
    5. 降级路径（若触发）：深链与刷新仍落对应阶段，QA 记录降级；
  - 既有 26 条 e2e 全绿（尤其 ：223 阶段条与 ：695 通知条不受影响）；
  - `npm run check`、`npm test`、`npm run build` 通过；QA 文档补记本条、
    降级决定（如有）与「epoch :327 一行改动」的护栏说明。
- **risk**: medium（URL 同步与 epoch/query effect 的相互作用；已给降级路径；
  修复评审 high 项后 spec 自洽，可直接施工）

### Phase 1 明确不包含（防 scope 爬升）

- P2-01/02/03（就绪度条、大纲跳转、通知分级）全部留给 Phase 2（Run B）；
- 不动 `expectedRevision`/保存/建议 decide 流程任何一行逻辑（epoch :327 的
  stage 重置一行除外，见点 3）；
- 不改 `src/writing.mjs`、`lib/api.mjs`（后端与 API 面零 diff，零新增请求）；
- 不动小红书渠道布局（Phase 5）；
- 不做版本 diff、confirm 替换、建议并排对比（Phase 4）；
- 不做 CreatorHome 改版（Phase 3）。

---

## 5. Phase 2 施工详单（Run B：P2-01/02/03，规格已定稿）

> 原评审前编号 P1-02/03/04；spec 已具体到锚点、签名、tone 枚举与 CSS 落点，
> Run A 验收通过后即可施工。统一约束同 §4。

### P2-01 发布就绪度全阶段可见（Easel 式就绪度条）

- **files**: `src/compose-view.mjs`、`components/WritingWorkspace.jsx`、
  `app/compose/compose-v2.css`、`test/compose-view.test.mjs`、
  `docs/implementation/CREATOR-V2-QA.md`
- **spec**:
  1. `src/compose-view.mjs` 新增纯函数
     `readinessFacts({ brief, outlineCount, pendingSuggestions, decidedSuggestions,
     checks, checkTotal, staleImagePlan, insertedImages })`，返回一组有序事实 chips，
     每条 `{ key, label, tone: "good"|"warn"|"info", detail }`：
     - 研究简报：有/无（tone good/info）；
     - 大纲：outlineCount 个标题 / 尚无标题；
     - 待采纳建议：pendingSuggestions 条待审（>0 时 warn）；
     - 人工检查：复用 `checkSummary`（:56-60），n/4，未完 warn；
     - 配图：insertedImages ? 已插图 :（staleImagePlan ? 配图计划已过期 : 未插图）；
     - 事实来源逐条对齐 `composeSteps` 现用布尔（:12-35）与 ribbon 现有事实
       （`WritingWorkspace.jsx:1413-1432`）——**不发明新事实**。
     单测：全 done / 空 / 混合三态。
  2. `WritingWorkspace.jsx`：把现在仅 review/publish 渲染的 ribbon（:1413-1433）
     升级为**全阶段可见的就绪度条**（非 xhs 渠道；xhs 维持现状由 Phase 5 处理）：
     渲染 `readinessFacts` 输出，保留「AI 建议先进入待采纳区，不直接写入文章」
     与「主稿 / 平台稿独立」两行既有语义；`staleImagePlan` 取左栏配图定位已在用的
     stale 判定（:1826-1852 同源事实）。
  3. **去重决策（r2）**：publish 阶段侧卡的「人工检查 n/4 完成（{渠道}独立记录）」
     一行（:1756-1758）**删除**——检查进度由就绪度条单一承载；侧卡保留
     「导出 ≠ 实际发布」等边界文案（:1751-1754）与返回按钮。
  4. 导出按钮 disabled 条件（:1684,:1703,:1710 的 allChecksDone）零改动。
  5. 样式进 `compose-v2.css`，沿用 tokens（info/warn/good 语义色与既有
     `cv2-pill good/warn` 一致）；移动端单行横向滚动。
- **acceptance**:
  - 单测：`readinessFacts` 三态断言；`checkSummary` 复用不受影响；
  - e2e 更新：research/write 阶段即可见检查进度 chip（原 ribbon 断言迁到新位置）；
    publish 侧卡不再出现检查进度行、导出按钮 disabled 条件回归通过；
  - 诚实性检查：就绪度条不含任何「已发布/可发布」字样——最高只到「人工检查 4/4 完成
    （该渠道独立记录）」；
  - `npm run check`、`npm test`、`npm run build` 通过；QA 文档补记本条与边界。
- **risk**: low（纯派生 + 渲染位置调整；导出 gate 不动）

### P2-02 大纲点击真跳转 + active 跟随光标

- **files**: `components/DoocsEditor.jsx`、`components/WritingWorkspace.jsx`、
  `src/compose-view.mjs`、`test/compose-view.test.mjs`、
  `e2e/creator-v2-compose.spec.mjs`
- **spec**:
  1. `src/compose-view.mjs`：`outlineItems`（现位 :48-61）每行增加 `line`（1-based
     行号，正则已在逐行扫描，零成本）；新增纯函数
     `markdownLineOffsets(markdown)`（逐行累计每个 1-based 行在全文的起始 UTF-16
     偏移，产出「行偏移表」）与 `activeOutlineIndex(items, cursorFrom, lineOffsets)`——
     给定光标 `from` 与行偏移表，返回光标所在/之前的最后一个标题下标。
     **行偏移表的生产者归属 compose-view 纯函数**（不在组件里手写偏移累加），
     `markdownLineOffsets` 单测须含多字节（中文）字符行与末行无换行两例，
     `activeOutlineIndex` 单测覆盖标题前/标题行上/两标题之间/空文档。
  2. `DoocsEditor.jsx`：ref 新增 `revealLine(line)`：
     `const target = view.state.doc.line(line).from; view.dispatch({selection:
     {anchor: target}, scrollIntoView: true}); view.focus()`——CodeMirror 6 原生
     事务，光标定位 + 滚动到可见；**selection 为 collapsed（from===to），不产生
     选中文本**；不影响 onChange/onSelection 既有回调。
  3. `WritingWorkspace.jsx`：
     - 大纲按钮 onClick 从 `editor.current?.focus()`（:1798）改为
       `editor.current?.revealLine(o.line)`；
     - active class 从固定 `i === 0`（:1794）改为
       `i === activeIdx`，`activeIdx` 由既有 `onSelection={setSelection}`（:2000）
       回传的 `selection.from` 派生（`useMemo` 内调用上述 compose-view 纯函数：
       `markdownLineOffsets(markdown)` 产出偏移表 + `activeOutlineIndex(outline,
       selection.from, offsets)`，组件不自带偏移计算逻辑）；
  4. 源码视图（view === "source"，编辑器隐藏）下大纲点击先切回分栏再跳转
     （施工时定交互细节，记入 QA）。
  5. e2e :910（「左栏大纲链接点击聚焦编辑器」）更新为：点击第三个大纲项 →
     编辑器获得焦点且该项获得 active class；**DOM 断言 CodeMirror 光标所在行
     （`.cm-activeLine`）文本以该标题开头**（仓库无「selection 调试通道」：
     页脚 :2015-2022 只显示选中字符数、无选中文本 DOM；revealLine 也不产生
     选中文本，故只能断言光标行）。
- **acceptance**:
  - 单测：`outlineItems` 含行号；`activeOutlineIndex` 四种位置断言；
  - e2e：上述新断言通过；长文（≥3 标题）下滚动位置变化可感知（断言编辑器
    scrollTop 变化或目标行进入视口）；
  - 手工冒烟：接受一条建议产生的新标题也出现在大纲（派生自当前 markdown，
    `:173 outline = outlineItems(markdown)` 已保证）；
  - `npm run check`、`npm test`、`npm run build` 通过。
- **risk**: medium（编辑器 ref 扩展；`scrollIntoView` 在分栏视图下的滚动容器行为
  需实测，CodeMirror scroller 即滚动容器，预期无碍）

### P2-03 通知分级 + 生成中全局指示

- **files**: `components/WritingWorkspace.jsx`、`app/compose/writing.css`、
  `e2e/creator-v2-compose.spec.mjs`
- **spec**:
  1. 通知分级（不搞大迁移）：内部 state 改为
     `{ text, tone: "info"|"error"|"success" }`；新增 `notify(text, tone="info")`；
     **现有 `setNotice` 别名保留为 `notify(text)`**——40 处调用点零改动即不回归；
     仅对关键路径显式升级 tone：保存冲突/blocked（error，:483-492 等）、
     导出成功（success）、恢复为新版本成功（success，:944）、发布回填
     （success，:1046-1063 路径）、图片插入成功（success，:986）。
     渲染（:1486-1493）：error 用 `role="alert"` + 语义色，其余 `role="status"`；
     单条槽位语义保持（不做队列，避免与既有 e2e 冲突），但错误消息不再与
     成功消息同样式。
  2. 生成中全局指示：头部 actions（:1234-1306）在 `busy || compareProgress`
     非空时渲染一枚非阻塞 pill「助手生成中…」，点击 = `setRightOpen(true)` +
     `setAssistantTab("writing")`（回到既有助手与停止控件，:2231-2258 的停止按钮
     是唯一停止入口，不新增第二套停止逻辑）；生成结束/失败即消失。
     保存徽标（:1235-1248）原样保留，两者并列。
  3. `writing.css` 增加 pill 与 tone 样式，遵循 tokens 语义色。
- **acceptance**:
  - e2e 更新：:695 通知条用例保持通过（关闭按钮不变）；冲突场景 notice 带
    error 样式类；生成期间（mock 流式）头部 pill 出现、点击后右栏可见且停止
    控件在；生成完成后 pill 消失；
  - 移动 390 用例（:402, :1230；现位 :404, :1232，见 §10.1）不出现横向溢出
    （pill 在窄屏折行或缩为图标+文字）；
  - `npm run check`、`npm test`、`npm run build` 通过。
- **risk**: low（别名迁移零破坏；pill 只做导航不做状态源）

---

## 6. 不变量护栏对照（Phase 1，r2 修订）

| 不变量 | Phase 1 如何保住 |
|--------|------------------|
| V27 不可变修订 | P1-01 不触保存路径；`goStage` 仍不 flush（编辑器常挂载语义不变） |
| V27 expectedRevision | 保存/导出/master-sync/generation 零改动；:286-301 effect 只收窄依赖不改变重载语义；**epoch effect 仅改 :327 的 stage 重置一行**（`setStage("write")` → `setStage(parseStage(query.get("stage")))`）——这是呈现层状态重置，不是文档重载/保存路径（文档重载仍由 epoch effect 既有 GET 与 :302 防线承担，行为不变） |
| 主稿/平台稿独立 | 深链 stage=publish + master 落既有主稿引导卡、+ xhs 落既有 xhs 发布卡（:1626-1664），不新增跨渠道动作 |
| 四项检查按渠道独立 | Phase 1 不动 checks；Phase 2 就绪度条继续按当前渠道计算（checkInfo 已按渠道） |
| 导出 ≠ 发布 | Phase 1 不动发布阶段文案与 gate |
| 诚实呈现 | URL stage 不产生任何新「进度」事实；epoch 重置语义只是回到用户指定/默认焦点视图 |
| V58 API 边界 | Phase 1 零新增请求（改动点仅组件内 state/URL/history） |
| V76 多模型 | 不触碰助手与生成路径（Phase 2 P2-03 pill 只导航到既有助手，modelLabel 出处、顺序对比、停止控件原样） |

---

## 7. 验证与验收命令（每个 workItem 完成时）

```bash
npm run check          # 语法门禁（含 src/compose-view.mjs）
npm test               # node --test test/*.test.mjs（含 compose-view 单测）
npm run build          # build-guard 包裹的生产构建
npm run test:e2e       # playwright（/compose 相关 spec 必须全绿，Run A 后现 29 条；另 e2e/agent-runtime.spec.mjs 全绿）
```

定向调试：`npx playwright test e2e/creator-v2-compose.spec.mjs`。
QA 记录：`docs/implementation/CREATOR-V2-QA.md` 追加「Easel 移植 Run A /
Run B」小节，如实记录降级决定（如 P1-01 pushState→replaceState）、
epoch :327 一行改动的护栏说明、源码视图跳转交互细节（P2-02 点 4）。

---

## 8. Out of Scope（明确不做与理由）

1. **七平台账号登录中心 / 自动发布执行器 / 短信风控交互**
   （Easel AccountsPage + PublishPage:190-292）：与 V27「导出 ≠ 实际发布」、
   「无自动发布」直接冲突；平台提交权必须留在人手里。只借鉴其**人工交接**半边
   （= Phase 6 的快照绑定与回填呈现）。
2. **跨平台创作数据归因看板**（DashboardPage:246-370）：无登录态数据链路；
   且 AGENTS.md 边界是「社区信号是假设」——我们不做采集-归因闭环。
3. **per-turn 事件日志 + 断线重放续传**（G15）：需要服务端事件存储与新一轮
   streaming 基建；既有 `resumeGeneration` 失败恢复已覆盖最高频场景。
4. **gzh-design 代码搬运**：AGPL-3.0。公众号富文本继续走自家 doocs vendor
   渲染；主题组件库只作装配思路参考，一行代码不搬。
5. **SQLite schema 变更**：任何一期不改表。Phase 6 的检查快照绑定预期落在
   `checklist_json` JSON 列（`src/editorial.mjs:85`），但 `setChecks` 行为扩展
   （现拒绝多余键 :84）必须先通过独立评审；若评估结论是需要改 schema，
   该子项就地终止并记录，不绕道。
6. **Easel 视觉主题移植**（青靛渐变/暗色/Bodoni/emoji 图标）：AGENTS.md:10
   规定 Creator V2.2/V2.3 tokens 是设计基线；只借鉴 IA、状态色语义与微文案。
7. **壳层增删工作区**：十一个工作区结构冻结；Easel 的技能库、画像、产物库等
   页面只能映射为既有工作区的内部分区。
8. **画像六维 markdown 体系 / Onboarding 向导**：WritingContext + 设置页画像
   已是等价物，引入第二套体系违反「单一数据模型」。
9. **前端路由库 / SPA 状态机重写**：保持 App Router + 客户端组件状态；
   Easel 的无路由单页架构不复制。
10. **建议批量自动接受 / 跳过 consent / 自动抓图换图**：V27 建议语义与
    V52/V53 图片边界，任何阶段不得自动化。

---

## 9. 假设与未决

- Easel 侧结论全部来自对 Easel 仓库 main（3f1d4fb）的静态勘察，本 run 未运行
  Easel；映射以交互语义为准，不做像素级复刻。
- P1-01 依赖 Next 16 对原生 `history.pushState`/`replaceState` 与
  `useSearchParams` 的集成行为；施工首日先做最小验证（切阶段 → `query` 对象
  更新、:286 effect 不重跑、文档不重取），异常即走全 replaceState 降级并记 QA
  （降级不影响首载深链，见 §4 点 6）。
- P2-02 的 `scrollIntoView` 在「分栏/预览」视图切换下的表现需实测；源码视图下
  大纲点击应自动切回分栏再跳转（施工时定，记 QA）。
- Phase 6 的「检查绑定 revision 指针」依赖 `editorial.setChecks` 行为扩展——
  已核实现状：四布尔以外的键被显式拒绝（`src/editorial.mjs:84`），值存
  `checklist_json` JSON 列（:85），预期无需改表；开工前完成独立评审并把结论
  写入该期 QA。
- Run A/B 的体量按评审意见拆分；若 Run A 一次通过且余量充足，Run B 可提前，
  但两 run 不合并（P1-01 的降级/返工概率是拆分动因）。

---

## 10. Run B 定稿基线与服务端 Agent 化（2026-10-22 追加）

> 基线核对结论（本节锚点均在现 HEAD 逐一复核）：工作树 HEAD =
> `3d48afe83a03a42262d1564f5e3dc4d925bf4e09`（分支 `feat/easel-port-phase1`，
> `git status --porcelain` 为空），即 Run A 的 docs(qa) 提交；PR #51 状态 OPEN
> （`gh pr view 51 --json state,headRefName` → `{"headRefName":"feat/easel-port-phase1",
> "state":"OPEN"}`），**Run A 已验收提交但未进 main（main = `0096429`）**。
> Run B 基于该分支施工（叠加同分支或待合入后开工属工作流决策，不改变本节规格）。
> `grep -cE "^test\(" e2e/creator-v2-compose.spec.mjs` = **29**（Run A 新增深链
> 用例所致），§4/§7 中「26 条」为 Run A 前的历史口径；既有用例迁移位置见 §10.1。

### 10.1 §5 锚点漂移表（施工以现位为准，不按 §5 旧行号改）

| 锚点 | §5 写定（0096429） | 现 HEAD（3d48afe，本次复核） |
|---|---|---|
| `src/compose-view.mjs` | parseStage :12-…、composeSteps :12-35、outlineItems :39-52、checkSummary :56-60 | parseStage :17-19、composeSteps :21-44、outlineItems :48-61、checkSummary :65-69 |
| `WritingWorkspace.jsx` 阶段/URL（Run A 产物） | —— | stage 初值 :158、epoch 协同 :341-343、popstate effect :399-404、openPlanner :448、syncStageUrl :472 |
| P2-01 ribbon | :1413-1433 | 检查行现 :1460-1466 |
| P2-01 publish 侧卡检查行 | :1756-1758 | :1798-1804 |
| P2-01 导出 disabled | :1684,:1703,:1710 共 3 处 | **共 4 处**：:1728/:1747/:1754/:1787（`allChecksDone` 定义 :188）——「零改动」约束须四处逐一核对 |
| P2-01 stale 判定 | :1826-1852 | :1889-1895 |
| P2-02 大纲 onClick `focus()` | :1798 | :1842（active `i===0` :1838；`onSelection={setSelection}` :2044） |
| P2-03 notice | state :117、渲染 :1486-1493 | state :117、渲染 :1529-1535 |
| P2-03 头部 actions / 助手 busy 区 | :1234-1306 / :2231-2258 | ~:1296-1335 / ~:2259-2307 |
| e2e/creator-v2-compose.spec.mjs | 26 条；:223/:402/:695/:910/:1230 | **29 条**；:225/:404/:697/:912/:1232（与旧锚逐一对应，:404=移动 390×844 用例；用例内注释 :920 还引旧行号） |

### 10.2 Run B 施工项定稿

Run B 共 **6 个 workItem**：**P2-01/02/03 规格以 §5 为准**（行号按 §10.1 现位执行），
其中 §5 P2-01 第 3 点的「侧卡去重决策（r2）」仍由 P2-01 一并承载（不拆独立条目），
P2-02 的验收以 CodeMirror 光标行 DOM 断言（`.cm-activeLine`）为最终形态；
服务端 Agent 切片为 **SA-01/02/03**（2026-10-22 评审后定稿，规格唯一来源
`EASEL-AGENT-SERVER-PLAN.md`）。**原起草的 AG-01/AG-02（§10.3 `article-pipeline`
技能）移出本期**——本期总项数上限（≤6）让位远程可靠性修复，其设计保留为下期首位
候选，施工名册不得再引用本节 §10.3。§6 不变量护栏对照对六项全部适用，
另加：Agent 化不得触碰发布阶段（见 §10.4；`EASEL-AGENT-SERVER-PLAN.md` §5 同守）。

### 10.3 服务端 Agent 化：内置技能 `article-pipeline`（全流程初稿流水线）

> **状态（2026-10-22 修订）**：AG-01/AG-02 **已移出本期 Run B**（名册见 §10.2 与
> `EASEL-AGENT-SERVER-PLAN.md` §3/§7——本期预算让位流式可靠性/重驱动/拓扑冒烟三项）。
> 本节设计原样保留，作为该技能下期施工的首选方案；其「零新增端点、零 schema 变更、
> 不新增事件 kind」约束继续有效，届时以 `EASEL-AGENT-SERVER-PLAN.md` SA-01/02 落地后的
> 可靠流与重驱动为运行前提。

**目标**：把 Easel 式「阶段流水线」做成**服务端可用**的 Agent——不依赖 UI，
纯 HTTP（创建运行 + 读 NDJSON 流）即完成「读简报/上下文 → 确保大纲 → 生成初稿 →
自审一轮 → 收尾汇总」一次全流程。全部复用既有 AgentRuntime（`src/agent-runtime.mjs`）
与 agent-runs 路由（`lib/creator-api.mjs:20-75`），**零新增端点、零 schema 变更**
（`agent_runs`/`agent_run_steps` 表已存在，`src/agent-runtime.mjs:33-48`）。

**编排即技能（不写编排引擎）**：五步编排编码进技能 `systemPrompt`，由既有 24 步
工具循环执行（`AGENT_MAX_STEPS=24` :18；连续 3 次模型失败即 failed :210-217；
每步以既有 `model`/`tool` step 落 `agent_run_steps` 并经 NDJSON 流出
:213/:220/:230、`lib/creator-api.mjs:36-75`；**不新增事件 kind**）：

1. **读**：`read_brief`/`read_context`（需要素材再 `search_assets`）；
2. **确保大纲**：当前 markdown 无标题时先产出标题骨架；
3. **生成初稿**：`writeMode==="revisions"` 时 `write_revision` 写入含大纲的完整
   初稿（新修订；走 `ctx.expectedRevision()`→`onWritten` 修订推进链，
   `src/agent-tools.mjs:64-73`）。默认 ag_default 为建议制（`src/agent-runtime.mjs:52-57`），
   运行时本就不把 `write_revision` 发给模型（:205）——技能按 draft-writer 先例
   （`src/agent-skills.mjs:12`）降级为 `write_suggestions` 结构化建议批；
   空稿+建议制时不硬凑建议，如实说明需切换直写模式；
4. **自审一轮**：**一律** `write_suggestions`（≤12 处互不重叠、original 精确匹配；
   直写模式下对刚写入的新修订提建议，经 :165-167 的 revision 跟踪不产生 409），
   建议仍逐条由作者接受——即使直写模式也不直接改稿；
5. **收尾汇总**：不再调用工具，以最终 content 列出产出与**人工**下一步
   （审阅建议 → 四项人工检查 → 配图 → 导出准备），措辞止于「导出准备」。

**铁律（写进 systemPrompt，GUARD 结尾，`src/agent-skills.mjs:1-2`）**：
发布阶段绝不自动化——技能工具面 `["read_document","read_brief","read_context",
"search_assets","write_revision","write_suggestions"]` 全部 ⊆ `DEFAULT_AGENT_TOOLS`
（:19-24），**不含任何导出/发布/跨渠道/xhs 渲染工具**（`AGENT_TOOLS` 本身即无
publish/export 工具，结构性排除，`src/agent-tools.mjs:15-111`）；每个写操作走既有
`expectedRevision` 路径（409 即 `interrupted` 待核对，:257-260）；AI 输出是假设、
先入待采纳区（startRun 门禁复用：技能 404 :147、渠道 403 :148、工具交集为空 403
:149-150、显式 consent 403 :151、非 markdown 409 :153、`expectedRevision` 409 :154、
同稿件 running 409 :155——全部零改动）。

**服务端可用（curl 全流程示例，进 QA/README；默认本地模式 127.0.0.1:4312，
`package.json:11`、`scripts/runtime-guard.mjs:17,35`；V58 边界内：
`src/local-api-boundary.mjs:39-79` 要求回环 URL、有 body 的写请求必须 JSON
content-type，curl 不带 Origin/sec-fetch-\* 头则相应检查跳过）**：

```bash
# 0)（可选）切直写模式：默认 ag_default 为建议制，流水线直写初稿需 revisions
curl -s -X PUT http://127.0.0.1:4312/api/creator/agent \
  -H 'content-type: application/json' -d '{"writeMode":"revisions"}'
# 1) 列技能（GET，只读；应含 article-pipeline）
curl -s http://127.0.0.1:4312/api/creator/agent-skills
# 2) 创建一次全流程运行（channel 缺省 master；consent 与 expectedRevision 必填，
#    expectedRevision 取自 GET /api/writing/projects/<id>/master 的 revision 字段）
curl -s -X POST http://127.0.0.1:4312/api/creator/projects/ep_<id>/agent-runs \
  -H 'content-type: application/json' \
  -d '{"skillId":"article-pipeline","instruction":"按简报产出完整初稿","expectedRevision":<当前revision>,"allowExternalAI":true}'
# 3) 读 NDJSON 进度流（每行一个 step {seq,kind,payload,createdAt}；终态附
#    {"kind":"run_done",status,stopReason} 后关流；600s deadline）
curl -sN http://127.0.0.1:4312/api/creator/projects/ep_<id>/agent-runs/ar_<id>/events
# 4) 取完整轨迹 / 取消
curl -s http://127.0.0.1:4312/api/creator/projects/ep_<id>/agent-runs/ar_<id>
curl -s -X POST http://127.0.0.1:4312/api/creator/projects/ep_<id>/agent-runs/ar_<id>/cancel
```

边界注：本地默认模式（非 dokploy、非 MULTIUSER）无会话要求；
`CONTENT_STUDIO_MULTIUSER=1` 下需持登录会话 cookie（同 `e2e/agent-runtime.spec.mjs:174-179`
的 page.request 形态）。以上 curl 形态从路由与边界代码推导，**本设计阶段未实跑**；
Run B 施工时在 QA 记录实际验证结果。

**测试面**：
- 三处技能数断言 7→8：`test/agent-skills.test.mjs:8`（精确 id 列表 deepEqual）、
  `test/agent-runtime.test.mjs:150`（`assert.equal(skills.skills.length,7)`）、
  `e2e/agent-runtime.spec.mjs:203`（`toHaveCount(7)`）。UI 技能面板无第四处硬编码
  （`components/AgentRuns.jsx:15` 动态拉取 `/api/creator/agent-skills`，:66 工具
  预览按技能动态拼接）。
- 单测：`test/agent-skills.test.mjs` 新增 article-pipeline 声明断言（含 GUARD、
  tools 子集、双模式契约）；`test/agent-runtime.test.mjs` 新增 fetchImpl 脚本化
  全流程运行（profile 切 revisions 后跑通「读→write_revision→write_suggestions→
  收尾」，断言步骤序、修订推进、无越权工具）。
- e2e：在现有合成回环模型夹具（`e2e/agent-runtime.spec.mjs:15-158`：回环
  OpenAI 兼容模型服务器 + runtime-guard 生产服务器 + MULTIUSER 会话）上新增一条
  article-pipeline 运行用例（AG-02）。

### 10.4 Run B 追加不做（§8 全部继续有效）

- 不新增任何 HTTP 端点/路由/NDJSON 事件 kind/SQLite schema；
- 不写第二套编排引擎/状态机/任务队列——编排=技能提示词+既有工具循环；
- 不自动化发布、导出、跨渠道同步与建议批量接受；article-pipeline 收尾只列
  人工下一步，绝不出现「已发布/自动发布/可发布」措辞；
- 不动 `expectedRevision`/保存/decide/master-sync 语义与导出 gate（4 处）；
- 不做 AgentRuns 卡片化等 UI 配套（Phase 7）；技能面板仅 option 数自然 +1；
- Phase 2 三项维持既有不包含项：xhs 渠道布局（Phase 5）、版本 diff 与 confirm
  替换（Phase 4）、CreatorHome 改版（Phase 3）、检查快照绑定（Phase 6）。

---

## 11. 完整还原：vendor 适配期（2026-10-22 追加，Run C 定稿）

> **状态（2026-10-22 施工完成）**：本节 AG-01/AG-02/VA-03/VA-04 四项已按 spec 落地；
> 门禁数字、curl 全流程实跑记录、交互冒烟与缺陷登记见
> `docs/implementation/CREATOR-V2-QA.md` §10。

> 基线核对（本节锚点均在现 HEAD 逐一实测）：工作树 HEAD = `ec73910`（vendor 导入
> 提交，`git status --porcelain` 为空）。Run A（P1-01 深链，8b32a42 + 3d48afe，
> PR #51）与 Run B（P2-01/02/03 + SA-01/02/03，1c5004f，PR #52）已落地：SA-01
> 重连（`components/AgentRuns.jsx:46-73`）、SA-02 重驱动（:77-82）、resumeOf
> 服务端（`src/agent-runtime.mjs:146-189`）、`readinessFacts`（`src/compose-view.mjs:110-163`）
> 均在 HEAD 复核存在。`vendor/easel/` 已按 `vendor/easel/PROVENANCE.md` 落盘
> （来源 ZJU-REAL/Easel main `3f1d4fb8b99694f7231ee97163b637df89b50d3b`，842 文件
> 约 13.75MB；AGPL `gzh-design` 81 文件零搬运，PROVENANCE.md:28）。本节所有
> `adaptedFrom` 均指该目录内真实文件，行号于 2026-10-22 逐读复核；此前 §1-§10 的
> Easel 侧结论来自外部勘察，自本节起以 vendor 内源码为准。

### 11.1 vendor 阅读结论（Run C spec 的事实基础）

| vendor 文件（已读） | 关键结论 | 供哪项用 |
|---|---|---|
| `skills/builtin/skill-article-outline/SKILL.md`（142 行，layer: plan） | 执行步骤五段：主题/意图确认（:27-33）→ 搜索分析（:35-48，WebSearch/WebFetch）→ 结构化大纲模板（H2/H3+段落字数+图表位+FAQ，:50-100）→ 差异化分析 → 保存 `outputs/<主题>/outline.md` | AG-01 步骤 2（确保大纲） |
| `skills/builtin/social-content/SKILL.md`（125 行，layer: produce） | 产出主写作流程：收集需求 → 按平台规范撰写 → **强制质量门「不过先改再交付」**（步骤 7，:81-84：AI 味自检 + 综合质量两道门）→ 变体 → 输出 | AG-01 步骤 3（生成初稿）与「生成后必须自审」的编排次序 |
| `skills/builtin/text-polisher/SKILL.md`（116 行，layer: produce） | 七轮聚焦扫描（清晰度/语气/价值感/证据/具体性/情感/风险，:54-64）+ 去 AI 感改写 + 两道门（AI 味 ≥45/50、综合 ≥35/50，:34-52） | AG-01 步骤 4（自审一轮）的审读维度（压缩为与既有 edit-review 同四维） |
| `docs/SKILL-SPEC.md` | 技能接口契约：frontmatter 三字段 name/description/layer（:40-48，layer 枚举 discover/plan/produce/publish/attribute/general）；`tests/<n>.prompt` + `<n>.expected` **关键字匹配**测试契约；三层加载（Metadata/Instructions/Resources） | AG-01（契约映射）、AG-02（测试契约映射） |
| `docs/prompt-stack.md` | Prompt 四层：SOUL/AGENTS/运行时/SKILL 按需；画像经 `persona.py:persona_prefix` 消息内联，无全局文件 | AG-01 弃用说明（我们单 systemPrompt 承载、无 references 层；画像走 read_context） |
| `skills/shared/scripts/manifest.py`（396 行） | 层间产物契约：`outputs/<主题>/.easel.json` 的 `steps[]`（layer/skill/at/status done\|failed/outputs/upstream/summary，:26-33）+ `latest --layer` 下游直取（:218-229）；failed 步供「从哪层接着跑」（:32-33） | VA-03（每项目一行步骤态的展示契约思想） |
| `web/frontend/src/components/DashboardPage.tsx`（374 行） | 首页六大快捷 + 四格统计 + 热点/选题/排期/产物四卡；「最近产物」行 = 名称 + 单 badge（:238-243） | VA-03（作品行从单标签升级为进度点串的改造原型） |
| `web/frontend/src/components/MessageBubble.tsx`（132 行） | live panel 四层状态：活动脉冲行 + 「未卡住」提示**附着显示不顶掉真实状态**（:74-86，对应我们 SA-01 心跳语义）+ 执行过程 N 步折叠 `details`（:87-92）+ 思考折叠 | VA-04（时间线折叠 + 运行中展开语义） |
| `web/frontend/src/lib/capabilityMenu.ts`（784 行） | 能力菜单：分组 tabs + 诚实状态图例 legend `done/ready/need/incoming`（:9-19）——「已验/可用/需配置」三分角标体系 | VA-04（技能诚实角标） |
| `web/frontend/src/components/SkillPage.tsx`（164 行） | 技能库：按 layer 分区（:74-83）、搜索、`needsApi && !apiConfigured` 角标「需 API/已配置」+ 副标题待配置计数（:84-93,:136-145） | VA-04（optgroup 分组 + 工具禁用角标） |
| `web/frontend/src/components/ManualPublishPage.tsx`（244 行） | 人工审核快照绑定：`snapshot(key)=JSON.stringify([title,body,tags,media])`、`approved = reviewed[key]===snapshot(key)`（:63-65）——**改任一字即作废需重审**；复制/导出/官方页跳转全部 gate 在 approved 后（:225-235）；「导出不代表已发布」边界文案 | §11.8 下期首位候选（Phase 6 检查快照绑定）——本期不做 |
| `docs/artifact-checkpoints.md` | 本地产物检查点：文件锁 + 输入指纹 + 可重做步骤；**明确不适用于付费 API/发布等外部动作** | §11.8（不引入第二套检查点机制的理由） |

### 11.2 Run C 名册与共通约束

**名册（4 项）**：AG-01、AG-02（§10.3 设计转正——上期让位的三项远程可靠性
SA-01/02/03 已全部落地，其「可靠流与重驱动」前提成立）、VA-03（Phase 3 vendor
适配：首页作品行进度点）、VA-04（Phase 7 切片：AgentRuns 卡片化 + 技能分组/角标）。
Phase 6（检查快照绑定）因需先独立评审 `editorial.setChecks` 行为扩展，继续下期
（§11.8 第 1 条）。

**共通约束（§1 六条全部继续有效，另加适配期三条）**：

1. **来源注释强制**：每份改编文件头部新增
   `// Adapted from ZJU-REAL/Easel <vendor 路径> (Apache-2.0)，modified: <改动概述>`
   （多来源逐行列出）；QA 报告同步登记改编清单。
2. **Python 零执行**：`easel/`（Python CLI 90 文件）、`web/app.py`（FastAPI）、
   `skills/**/scripts/*.py`（manifest.py/wordcount.py 等）一律只读；需要的语义用
   本仓库 TS/MJS 纯函数或既有 API 等价替代，替代不了的就弃用并记 QA。
3. **vendor 只出不进**：本仓库代码不 import/require vendor 下任何文件；vendor
   树保持原样（PROVENANCE.md:47-50），不修改、不参与构建/测试/运行时。

### 11.3 AG-01 `article-pipeline` 全流程技能（技能本体 + 域级单测）

- **files**: `src/agent-skills.mjs`、`test/agent-skills.test.mjs`、
  `test/agent-runtime.test.mjs`
- **adaptedFrom**: `vendor/easel/skills/builtin/skill-article-outline/SKILL.md`、
  `vendor/easel/skills/builtin/social-content/SKILL.md`、
  `vendor/easel/skills/builtin/text-polisher/SKILL.md`、
  `vendor/easel/docs/SKILL-SPEC.md`、`vendor/easel/docs/prompt-stack.md`
- **spec**（设计基线 = §10.3，现按 vendor 阅读+现 HEAD 锚点定稿）：
  1. `src/agent-skills.mjs` 追加第 8 个技能：`id: "article-pipeline"`、
     `version: 1`、`title: "全流程初稿流水线"`；
     `tools: ["read_document","read_brief","read_context","search_assets",
     "write_revision","write_suggestions"]`——全部 ⊆ `DEFAULT_AGENT_TOOLS`
     （`src/agent-runtime.mjs:19-25`），结构性排除发布/导出/跨渠道工具
     （`AGENT_TOOLS` 本身无此类工具，`src/agent-tools.mjs:15`）。
  2. `description` 按 SKILL-SPEC.md:46 的触发边界写法：写清能力（读简报/上下文 →
     确保大纲 → 生成完整初稿 → 自审一轮 → 汇总）、触发说法（「全流程」「从简报到
     初稿一次跑完」「先大纲再正文」）与相邻边界（单改润色用 edit-review /
     selection-rewriter、配图用 illustration-orchestrator；**不含任何发布动作**）。
  3. `systemPrompt` 五步编排（对照上游次序：article-outline「意图确认→结构」+
     social-content「撰写→强制质量门」+ text-polisher「聚焦扫描」）：
     ① **读**：`read_brief`/`read_context`，需素材再 `search_assets`；
     ② **确保大纲**：当前 markdown 无 `#` 标题时先在初稿开头产出标题骨架
     （吸收 article-outline 的 H2 层级 + 段落字数目标思想，压缩为标题行，不单独
     落盘）；③ **生成初稿**：`writeMode==="revisions"` 时 `write_revision` 写入
     含大纲的完整初稿（走 `ctx.expectedRevision()`/`onWritten` 修订推进链，
     `src/agent-tools.mjs:64-73`）；默认 `ag_default` 为建议制
     （`src/agent-runtime.mjs:52-58` 种子 `"suggestions"`；`_loop` 在建议制下
     结构性过滤 `write_revision`，:228-230），此时按 draft-writer 先例
     （`src/agent-skills.mjs:12`）降级为 `write_suggestions` 结构化建议批；
     空稿+建议制时不硬凑建议，如实说明需切换直写模式；④ **自审一轮**（上游
     「质量门强制」语义）：一律 `write_suggestions` ≤12 处互不重叠、original
     精确匹配，审读维度四条（论证链闭合/结构节奏/冗余/AI 腔，与 edit-review
     同维，text-polisher 七轮压缩而来）；直写模式下对刚写入的新修订提建议，
     经 revision 跟踪不产生 409；建议仍逐条由作者接受——直写也不直接改稿；
     ⑤ **收尾汇总**：不再调用工具，以最终 content 列出产出与**人工**下一步
     （审阅建议 → 四项人工检查 → 配图 → 导出准备），措辞止于「导出准备」。
     GUARD 结尾（`src/agent-skills.mjs:1-2`）。
  4. 24 步预算核算：五步编排 ≤8 次模型调用，远小于 `AGENT_MAX_STEPS=24`
     （`src/agent-runtime.mjs:18`）；连续 3 次模型失败熔断（既有）兜底。
  5. **弃用与替代（写进文件头来源注释的 modified 说明与 QA）**：
     Easel 技能是 OpenClaw/Python harness 执行的 markdown（SKILL-SPEC 三层加载、
     references/ 按需）→ 我们是 JS 声明对象 + 既有 24 步工具循环，**不引入
     references/scripts 文件层**；article-outline 步骤 2 的 WebSearch/WebFetch
     搜索分析 → `search_assets` 素材库检索（社区信号是假设、不引入外网采集）；
     `outputs/<主题>/outline.md` 落盘与 manifest.py 登记 → `write_revision`/
     `write_suggestions` 修订制，零文件系统写入；social-content 步骤 6 的
     wordcount.py 字数门 + platform-specs → 不做（平台字数预算属渠道稿人工核对，
     不进流水线）；prompt-stack 画像内联前缀 → `read_context`（WritingContext
     按渠道作者设定既有链路）。
  6. 单测：`test/agent-skills.test.mjs:8` 的 ids deepEqual 追加
     `'article-pipeline'`（7→8）；新增声明断言——GUARD 在 prompt 内、tools 子集、
     双模式契约（revisions 直写/suggestions 降级都有明确指令）、五步编排关键字、
     **prompt 不含「自动发布/已发布」承诺**；`test/agent-runtime.test.mjs:150`
     `skills.length` 7→8；新增 fetchImpl 脚本化全流程运行：profile 切 revisions
     后按「读 → write_revision → write_suggestions → 收尾」编排合成模型回复，
     断言步骤序、修订推进（tracked.revision 前进）、无越权工具名出现在任何
     tool_call、终态 completed 且收尾 content 含「人工」下一步措辞。
- **acceptance**: `npm run check`、`npm test` 通过；两处技能数断言更新后单测
  全绿；来源注释落盘。
- **risk**: low（纯声明 + 单测；编排完成率风险由脚本化全流程单测兜底）

### 11.4 AG-02 article-pipeline e2e 全流程用例 + HTTP 冒烟记录

- **files**: `e2e/agent-runtime.spec.mjs`、`docs/implementation/CREATOR-V2-QA.md`
- **adaptedFrom**: `vendor/easel/docs/SKILL-SPEC.md`（tests 契约：`<n>.prompt`
  输入 + `<n>.expected` 关键字匹配——映射为合成模型脚本化指令 + 页面关键字断言）、
  `vendor/easel/skills/builtin/social-content/SKILL.md` 步骤 7（「不过先改再交付」
  ——脚本里编排一次自审建议轮验证）
- **spec**:
  1. `e2e/agent-runtime.spec.mjs:210` `toHaveCount(7)` → 8（三处技能数断言的
     最后一处，另两处在 AG-01）。
  2. 新增一条 e2e：在既有合成回环模型夹具（`e2e/agent-runtime.spec.mjs:15-158`
     形态：回环 OpenAI 兼容模型 + runtime-guard 生产服务器 + MULTIUSER 会话）上，
     脚本化 provider 依次回 `read_brief` → `write_revision`（含标题骨架 + 正文）
     → `write_suggestions`（1 条）→ final content；断言：运行 completed、
     `.agent-run-steps` 出现 模型/工具 步骤序列、修订历史 +1、建议列表出现 1 条
     待审、收尾文案止于「导出准备」且**无「已发布/自动发布」字样**。
  3. QA：`CREATOR-V2-QA.md` 新增「完整还原 · vendor 适配期（Run C）」小节——
     记录 §10.3 的 curl 全流程（列技能 → 创建运行 → NDJSON 流 → 轨迹 → 取消）
     **实跑结果**（该 curl 形态在 §10.3 设计阶段未实跑，本期必须真跑并如实记录，
     含 V58 边界说明与 MULTIUSER 差异）、AG-01 弃用清单、e2e 覆盖边界。
- **acceptance**: `npm run check`、`npm test`、`npm run build`、
  `npm run test:e2e` 通过；既有 agent-runtime 用例零回归。
- **risk**: medium（e2e 合成模型脚本与既有门禁时序——consent/expectedRevision/
  单飞全部沿用既有夹具形态）

### 11.5 VA-03 首页作品行六槽进度点（Phase 3 vendor 适配）

- **files**: `src/creator-home.mjs`、`components/CreatorHome.jsx`、
  `app/creator-v2-home.css`、`test/creator-home.test.mjs`、
  `docs/implementation/CREATOR-V2-QA.md`
- **adaptedFrom**: `vendor/easel/skills/shared/scripts/manifest.py`
  （`steps[]` 每层 status 行的「一眼看到每个项目走到哪层、哪层 failed」契约，
  :26-33）、`vendor/easel/web/frontend/src/components/DashboardPage.tsx:238-243`
  （最近产物行 = 名称 + 单 badge 的原型，我们升级为进度点串）、
  `vendor/easel/docs/SKILL-SPEC.md:48,151`（layer/status 枚举驱动前端分色）
- **spec**:
  1. `src/creator-home.mjs` 新增纯函数 `projectProgress(project)`：固定六槽、
     每槽 `{ key, tone: "good"|"warn"|"info"|"todo" }`，**只吃 overview 既有行**
     （`editorial.get()` 载荷，`src/editorial.mjs:47-49`；诚实规则注释同
     `src/creator-home.mjs:20-26`）：
     - 研究：`briefId` 非空 → good，否则 todo；
     - 正文：master 通道 document 有非种子内容（复用 `channelHasContent`
       :50-55 同源判定逻辑扩展到 master）→ good，否则 todo；
     - 核对：无内容 → todo；`openCorrections === 0` → good；>0 → warn；
     - 检查：wechat+zhihu 两渠道四检查完成数合计 n/8（`checkSummary` 语义，
       `src/compose-view.mjs:99-103`；渠道独立不变）——8/8 → good，0 → todo，
       其余 warn；标签含「两渠道独立记录」；
     - 交付：任一渠道 `status === "exported"` → info「已导出（未发布）」，否则
       todo；
     - 发表：任一渠道 `reported_published` → warning「作者报告已发表（未核验）」
       （沿用 `projectStage` :65-66 原文案）。
     **不发明事实**：大纲标题数、待采纳建议数、配图状态不在 overview 载荷内，
     不设槽、不伪装。诚实上限 = 「作者报告已发表（未核验）」，无「已发布」。
  2. `CreatorHome.jsx:323-338` 最近作品行：单 `projectStage` Tag 升级为
     Tag + 六槽点串（`<span className="cv2-progress-dot …">` 串；Tag 保留——
     交付/发表的终态语义仍需文字承载）。**只改首页**：`CalendarWorkspace.jsx:372`
     的 projectStage 用法不动（日历行密度低，防回归面扩大，记 QA）。
  3. `creator-v2-home.css`：点串样式沿用 tokens 语义色（对齐就绪度条
     good/warn/info/detail 语义，P2-01 先例），窄屏折行（:127-128 既有
     `white-space:normal` 先例）。
  4. **弃用与替代**：manifest.py 是 Python CLI 落盘脚本（`.easel.json` 文件、
     `atomic_write`、`EASEL_ROOT` env，:61-64,:107-117）——不执行 Python、
     **零新存储**：六槽全部为请求时派生，不建表、不加列、不新增端点/响应字段；
     Easel 的「failed 步断点续跑」语义由我们已有的 SA-02 resumeOf 与
     `resumeGeneration` 承担，不在首页呈现 failed 态。
  5. 单测 `test/creator-home.test.mjs`：`projectProgress` 空稿/部分完成/
     全完成/报告已发表/待核对>0 五态断言 + 无「已发布」字样断言。
- **acceptance**: 单测五态全绿；`npm run check`、`npm test`、`npm run build`
  通过；现有首页 e2e 不回归（视觉上仅行内多一串点，选择器不冲突）。
- **risk**: low（纯派生 + 渲染；唯一外部依赖是 overview 载荷字段名，已在
  `src/editorial.mjs:47-49` 复核）

### 11.6 VA-04 AgentRuns 轨迹卡片化 + 技能分组与诚实角标（Phase 7 切片）

- **files**: `src/agent-skills.mjs`、`components/AgentRuns.jsx`、
  `test/agent-skills.test.mjs`、`docs/implementation/CREATOR-V2-QA.md`
- **adaptedFrom**: `vendor/easel/web/frontend/src/components/MessageBubble.tsx:74-100`
  （live panel：执行过程 N 步 `details` 折叠、「未卡住」提示附着不顶掉真实状态
  ——后者我们 SA-01 已实现，前者本期补）、
  `vendor/easel/web/frontend/src/lib/capabilityMenu.ts:9-19`（诚实状态图例
  done/ready/need/incoming 的角标体系）、
  `vendor/easel/web/frontend/src/components/SkillPage.tsx:84-93,136-145`
  （layer 分区 + 「需 API/已配置」角标与计数）
- **spec**:
  1. `src/agent-skills.mjs`：技能对象新增纯展示字段
     `stage: "research"|"write"|"review"|"images"|"publish"`（复用
     `parseStage` 白名单，`src/compose-view.mjs:15`；静态映射 task-brief→research、
     article-pipeline/draft-writer→write、claim-evidence/edit-review/
     selection-rewriter→review、illustration-orchestrator→images、
     xhs-group→publish）。只进 UI，不进 systemPrompt/门禁/存储。
  2. `AgentRuns.jsx` 三处呈现改造（**follow/redrive/取消逻辑零改动**——Run B
     刚落地的重连/重驱动载体，只动渲染层）：
     - 技能 `select`（:118）平铺 options → 按 `stage` 分组 `<optgroup>`（组名
       用 compose 阶段文案 研究/写作/审稿/配图/发布；option 数不变，e2e :210
       的 `toHaveCount` 语义不受 optgroup 影响，需实测确认后记 QA）；
     - 诚实角标（capabilityMenu legend 语义，按我们事实裁剪）：技能说明行
       （:120）当 `skill.tools ∩ profile.tools` 为空 → warn「工具全部被禁用，
       启动将被拒绝」（对应服务端工具交集空 403 门禁）；当 tools 含
       `generate_image` 且交集缺它 → warn「需先在偏好中启用图片工具」——
       事后 403 变事前预告；模型出处仍由既有 modelLabel/工具预览承载，不新增；
     - 时间线折叠（MessageBubble doneSteps 语义）：`.agent-run-steps`（:129）
       外包一层 `details`——运行中 `open` 自动展开，终态默认收起为
       「执行过程 N 步」摘要（N = steps 数，真实计数）；重连提示（:128）保持在
       折叠层外，附着可见。
  3. **弃用与替代**：capabilityMenu 的 113 技能手工菜单/SkillDrawer 就地配 key
     → 不搬（我们仅 8 技能且连接配置在设置页既有工作区；壳层工作区冻结 §1.4）；
     Easel layer 五色体系 → 不移植视觉，只用其「分组 + 诚实角标」信息架构。
  4. 单测：`test/agent-skills.test.mjs` 断言每技能 `stage` ∈ 白名单且映射齐
     8 个技能；e2e 既有 agent-runtime 用例全绿为回归底线。
- **acceptance**: `npm run check`、`npm test`、`npm run build`、
  `npm run test:e2e` 通过；AgentRuns 交互（启动/取消/重连提示/重驱动按钮）
  手工冒烟记 QA。
- **risk**: medium（AgentRuns 是 Run B 高频改动文件——施工时若 §10.1 式锚点
  漂移，以现 HEAD 为准；渲染改造不得触碰 follow 闭包与 scope 守卫）

### 11.7 Run C 护栏对照（增量）

| 不变量 | Run C 如何保住 |
|---|---|
| 导出 ≠ 发布 / 不自动发布 | article-pipeline 收尾止于「导出准备」；单测+e2e 双断言无发布措辞；技能工具面结构性排除发布类 |
| AI 输出是假设 / 逐条 consent | 自审建议仍走待采纳区；启动 consent/expectedRevision/单飞门禁零改动（`startRun` 不动，`src/agent-runtime.mjs:144-189`） |
| 不可变修订 / expectedRevision | `write_revision` 走既有修订推进链；VA-03/04 纯呈现零写路径 |
| 四项检查按渠道独立 | VA-03 检查槽标签明示「两渠道独立记录」，n/8 是两渠道合计呈现而非合并状态 |
| 诚实呈现 | VA-03 六槽只陈述 overview 既有事实，缺事实的维度不设槽；点串最高态是「作者报告已发表（未核验）」 |
| V58/V75 边界 | 零新端点；AG-02 curl 冒烟在本地回环、V58 边界说明照 §10.3 |
| 不改 schema | 四项均零 DDL；技能 stage 是代码常量，`agent_runs` 行不动 |
| vendor 隔离 | 不 import vendor；Python 零执行；改编文件头来源注释（§11.2） |

### 11.8 Run C 不做（本适配期剩余未还原清单，按优先序）

1. **Phase 6 检查快照绑定（下期首位）**：vendor 源已读定——
   `vendor/easel/web/frontend/src/components/ManualPublishPage.tsx:63-65`
   `snapshot()/approved()` 绑定 + :225-235 审核 gate（复制/富文本/ZIP/官方页
   跳转全在 approved 后）。落点：`editorial.setChecks` 行为扩展（现 :84 拒
   四布尔以外键、:85 存 `checklist_json` JSON 列）+ 勾选时记录当前 master
   revision 指针，改字后显示「需重审」。**开工前必须完成独立评审**（§1.3/
   §8.5 既有决定）；若评审结论需改 schema，就地终止并记录。
2. Phase 4 版本 diff / 建议并排对比 / confirm 替换——Easel 无版本树
   （§2 G6），非 vendor 适配项，维持自有设计。
3. Phase 5 xhs 渠道 IA 并轨——自家图文工作区布局问题，非 vendor 适配。
4. 技能全量菜单化 / 设置模型矩阵化（Phase 7 余下）——capabilityMenu 113 技能
   形态对我们 8 技能过度设计；本期已做 optgroup+角标切片，剩余待技能数增长后
   再评估。
5. ArtifactGallery 对话内产物轮播 / sandbox iframe（§2 G8 低）——修订制文章
   模型不同，形态差异非缺陷。
6. 七平台账号中心 / 自动发布 / 归因看板（§8 第 1-2 条继续有效，不做）。
7. `artifact_checkpoints.py` 文件锁检查点（docs/artifact-checkpoints.md）——
   不引入第二套检查点机制：其文档自认不适用于付费 API/发布类外部动作；我们的
   中断恢复由 SA-02 resumeOf（agent）与 resumeGeneration（写作生成）承担。
8. Easel 视觉主题 / layer 五色 / Bodoni（§8 第 6 条继续有效，不移植）。
9. gzh-design（AGPL）零搬运（PROVENANCE.md:28，永久有效）。
10. Python CLI 与 FastAPI 后端的任何执行路径（永久只读适配源）。

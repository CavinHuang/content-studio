# Content Studio 设计系统 v2.3

日期：2026-10-26。配色遵循已确认设计稿的米白、浅沙、墨绿与陶土色；字体、间距、圆角和控件尺寸遵循 Tailwind CSS 4 + shadcn/ui。原始效果图继续作为颜色与功能分区参考。

v2.3 增补演示态词表、弹窗 footer、选中态与文案规则四节规范（对应 [UX 修复方案](UX-FIX-PLAN.md) 第 1 节 N1–N4），并新增语义选中态 token `--selected-platform` / `--selected-row`。同时清理业务 CSS 对通用控件的覆盖：表单使用官方 Field，标签和输入区分离，输入文字恢复正常字重；Field 内部间距遵循官方 gap-3。普通文字操作使用 Button 的 sm 变体，编辑视图和素材范围使用 Tabs。三栏只由 ResizableHandle 提供分隔线。问题、修复及保留的业务差异见 [UI / UX 审查](UI-UX-AUDIT.md)。

## 唯一的基础规范

使用 shadcn/ui new-york-v4 的语义主题机制，将设计稿配色映射到主题变量，基础圆角保持 0.625rem 与官方派生圆角。字体使用 `font-sans` 的默认系统字体栈，不再加载 Noto 字体包，也不维护一套自己的字号变量。中文由系统字体回退提供。

| 颜色角色 | 色值 | 使用范围 |
| --- | --- | --- |
| 米白 background | #fffcf7 | 编辑区和页面底色 |
| 暖白 card / popover | #fffefa | 卡片、输入区和浮层 |
| 浅沙 sidebar / secondary | #f2eee5 | 内容库与次级操作 |
| 浅米灰 agent | #f6f5ed | Agent 面板底色 |
| 墨绿 primary / ring | #34583b | 主操作、选中控件和焦点 |
| 陶土 brand-accent | #99502f | 当前产物标识与少量强调 |
| 浅陶土 accent | #f3e4d7 | 平台选中态、用户气泡与少量强调 |
| 浅绿 sidebar-accent | #e5e9db | 官方侧栏菜单选中与悬停 |
| 正文 foreground | #303729 | 正文与标题 |
| 次要文字 muted-foreground | #606b57 | 说明、时间和计数 |
| 边框 border | #dddccf | 卡片和区域分隔 |

次要文字在原有灰绿方向上略微加深，以满足浅沙、浅陶土和选中底色上的 4.5:1 对比度。成功、警告和错误分别采用柔和绿、赭黄和砖红，具体值统一保存于 design-tokens.json。

| 用途 | Tailwind / shadcn 规则 |
| --- | --- |
| 界面正文、表单、Agent | text-sm；组件本身的字体与行高优先 |
| 次要说明 | text-sm text-muted-foreground；元信息用 text-xs |
| 表单标签 | text-sm font-medium |
| 页面标题 | text-2xl font-semibold tracking-tight |
| 文稿标题 | text-3xl font-semibold tracking-tight |
| UI 区块标题 | text-base font-medium；内容标题另行排版 |
| 常规 Button | 官方 default：h-9；sm：h-8；lg：h-10 |
| Input、NativeSelect | 官方 h-9；保留原生组件的响应式字号与焦点环 |
| 卡片 | 保留官方 Card 的边框、rounded-xl 与 shadow-sm；业务组合用 p-3 gap-3 |
| 页面与表单 | 页面 p-4；字段组 gap-3；官方 Field 内部 gap-3；全部使用 Tailwind 间距刻度 |

shadcn 没有为所有业务页面规定固定间距；页面组合选择它所使用的 Tailwind 刻度，不另创第二套密度、字号或字体 Token。状态提示使用 success / warning / destructive 主题语义；平台标识、插画及视频画布属于内容资源。

## 业务间距的使用规则

间距使用 Tailwind 原有刻度，由关联程度决定：文字元信息与标题说明 4px，相关操作与标签控件 8px，卡片内边距 / 列表行距 / 字段组 12px，工作台页面边距与主要分组 16px。Dialog 外框保留官方 24px，正文与视频画布保留各自的排版和尺寸。

同一段间隔只有一个负责位置：网格的 gap 负责字段间距，网格内 Field 不再自带底边距；带标题栏和内容区的分镜 Card 使用 gap-0 / p-0，由内部区域分别负责 padding；标题式按钮使用 p-0，避免普通 Button 内边距扩大正文布局。117 处业务 CSS 在原位调整，不新增覆盖文件。

Agent 使用显式 gap-4 设置消息之间的业务间隔；MessageContent 内部恢复官方默认 gap-2.5，元信息复制操作选用官方 xs。工作台标题与说明置于同一标题区域，不因右侧操作换行而被撑开。Field 内的 NativeSelect 填满字段宽度，工具栏下拉框仍按内容宽度显示。

完整范围、实测与例外见 [间距校准记录](SPACING-AUDIT.md)。

## 接入与样式边界

`foundation.css` 导入 tailwindcss、tw-animate-css、shadcn/tailwind.css，并按官方方式用 @theme inline 映射语义变量。`tokens.css` 由 design-tokens.json 生成，仅维护主题和三栏尺寸，不生成自定义字体、字号与密度表。

`components/ui/` 保存官方 Radix 组件源码。Button、Input、Textarea、Tabs、Badge、Card、Dialog、Sheet、Popover、NativeSelect、Checkbox、Switch、Slider 和 Input Group 的外观、尺寸、焦点、阴影及状态由组件源码决定。恢复 Button h-9 和 Card 默认结构；移除 unstyled / unset 变体。特殊业务组合在 JSX 上明确使用 h-auto、grid、p-4 等 Tailwind 类。

`workspace.css` 仅在 @layer components 中维护工作台、来源表格、分镜、字幕、预览与响应式结构。字体、圆角与常规间距用 @apply 复用 Tailwind；组件 utilities 层具有更高优先级。此前 styles.css、design-system.css、page-details.css 三层覆盖文件已移除，不再通过 data-slot 全局重写默认 Button / Input 等组件。

新增操作先选择组件 variant / size，再使用局部 Tailwind 类组合。禁止通过全局 !important、另建 font-size / density Token 或加入第四层覆盖文件去更改组件默认表现。

## 工作台与内容

保留左侧内容库、中间编辑器、右侧 Agent，默认宽度 256 / 自动 / 384px；三栏顶栏 56px。左右可调整和收起，用户已调整的宽度保留。窄窗口使用 Sheet，表格按内容重排。

内容库采用官方 Sidebar / Group / Menu / MenuSub / Footer 组合。菜单使用默认 h-8，子菜单 h-7，图标为 16px；新建按钮与搜索仍为 h-9。菜单选中统一使用 sidebar-accent，计数与管理操作由 SidebarMenuBadge / SidebarMenuAction 定位。移除旧侧栏布局、字体和状态覆盖规则，保留外层栏宽约束。SidebarProvider 管理桌面与手机的独立展开状态，官方 SidebarTrigger 支持 Ctrl / Cmd+B；搜索保留 Ctrl / Cmd+K。

文件树的横向缩进采用显式紧凑组合：SidebarMenuSub 使用 mx-2 / px-1.5，子级图标比父级右移约 15px；子按钮通过 asChild 直接使用原生 button，避免额外 Button 内边距。此处为局部业务调整，其余组件默认字体、行高与间距保持不变。

文稿维持产物导航与平台工具两行布局；小窗口允许自动换行。保存状态只有一处，底栏显示字数与版本。段落建议默认收起，可从 Agent 结果卡展开定位；原文变化时禁止采用，采用后支持撤销。

Agent 使用官方 Message Scroller / Message / Bubble / Input Group 组合：用户沿用 muted 气泡结构，并在业务组合中使用浅陶土背景；助手为 ghost 正文，结果单独使用 outline 卡片。复制与时间同排，任务状态反映实际 Mock 任务。

文稿默认也使用 sans 与 Tailwind 的 16px / leading-7 / 24px 页边距。用户主动调整文章字体、字号、行高、段距仅作用于对应平台文稿；这些内容排版参数不得覆盖工作台 UI。

## 演示态词表

Mock、示例、演示三个词各司其职，跨屏不得混用（UX 修复方案 N1）：

| 词 | 语义 | 允许出现的位置 | 示例 |
| --- | --- | --- | --- |
| Mock | 模式标识 | 仅全局状态位：侧栏底栏与右上角统一徽标 | 「本机工作区 · Mock 演示」「Mock · 视频工作台」（间隔号两侧留空） |
| 示例 | 数据内容 | 数据条目与占位内容 | 示例话题、示例日期、示例缓存 |
| 演示 | 行为说明 | 说明区与状态行 | 演示模式、演示存储、本机演示 |

- 失败提示前缀统一为「模拟失败：」，同一原因全站逐字同一字符串（如统一为「模拟失败：配乐资源不可用」，不出现「示例失败：」「演示失败：」变体）。
- 服务名等实体名称全局逐字一致：「自然叙述（Mock）」在设置页与视频工作台必须完全一致。
- 按钮文案禁带 `(Mock)` 后缀（「更新所选镜头配音（Mock）」→「更新所选镜头配音」），演示属性由说明区或徽标承担。
- 非实时示例数据禁止相对时间呈现：「2 小时内」应改为给出示例日期。

## 弹窗 footer 规范

弹窗 footer 按用途归入四类模板（UX 修复方案 N2）；`DialogFooter` / `DialogClose` 原语已在 `components/ui/dialog.tsx`，此处收敛用法而非新增组件：

| 类型 | footer 结构 | 适用 |
| --- | --- | --- |
| 只读 | 「复制」（若有可复制物）+「关闭」 | 动画代码等查看类弹窗 |
| 表单 | 左侧 muted 说明 +「取消」+ 主按钮 | 记录发布、添加来源、危险确认等录入类弹窗 |
| 轻量即时 | 单主按钮 + 右上 X，文案注明即时生效 | 轻量偏好等即时生效弹窗 |
| 详情（自动保存） | muted「更改自动保存」+ 动作组；破坏性动作分离到左下 | 素材详情等自动保存详情弹窗 |

主按钮图标规则：**＋ = 创建、→ = 继续/前进、保存/记录类一律无图标、✓ 仅完成态标识**。「✓ 保存素材」回归「保存素材」，↻ 与 ✦ 退役。

## 选中态规范

选中态分三类语言，不混用（UX 修复方案 N3）：

| 场景 | 选中语言 | 语义 token |
| --- | --- | --- |
| 视图切换：平台页签、内容 tab、单选 chip | 浅陶土底 | `--selected-platform: #f3e4d7` |
| 勾选 / 多选行 | 浅绿底 + 墨绿描边 | `--selected-row: #eaf1e2` |
| 横排单选 | 分段白块式：沙色轨道 + 白色凸起片（TabsList） | 复用 sidebar / card 表面色 |

- 横排单选的唯一语言是分段白块式，实底药丸样式退役。
- 对勾仅表示完成/已选状态，不作为唯一选中指示；呈现选中需配底色或描边。
- 两个语义 token 定义于 `scripts/design-tokens.mjs`，生成到 `src/renderer/src/tokens.css`。选中底上的文字对比度（按 check-design 同款 WCAG 公式计算）均 ≥ 4.5:1：#303729/#eaf1e2 = 10.67、#606b57/#eaf1e2 = 4.86、#303729/#f3e4d7 = 9.91、#606b57/#f3e4d7 = 4.52、#99502f/#f3e4d7 = 4.77。

## 文案规则

中文界面文案遵循以下规则（UX 修复方案 N4）：

- 中文问句一律全角「？」，中文后不得接半角 `? ! . , ; :`。
- 标题不加终止标点；口语句号句仅保留给各模块主页面大标题。
- 量词表：视频作品 = 「个」；计数徽标 = 裸数字，不带量词；版本数必须带口径前缀，写作「N 个平台版本」「N 个修订版本」，禁止裸「N 个版本」。
- 日期格式：元信息 `MM/DD HH:mm`；快照与审计记录 `YYYY/MM/DD HH:mm:ss`。
- 成对操作使用同一量词：「全部/全量」统一为「全部」。

## 验证与维护

pnpm design:check 校验设计稿配色、Tailwind 默认尺度、标准组件变体及 CSS 分层，正文、说明、强调与状态文字对比度至少 4.5:1。设计系统回归检查米白画布、浅沙侧栏、浅米灰 Agent 与墨绿主按钮的实际颜色，以及 Button / 搜索输入框的默认 36px、统一字体、选项卡键盘操作、排版实际生效、模态焦点和栏宽持久化。

pnpm build、Electron 功能回归及 pnpm ux:capture 用于验证真实窗口。最新截图、布局检查和字体实测在 implementation/aligned/，通过 alignment.html 对照；设置与任务没有独立效果图，不将生成参考图描述为像素基准。

依据：[Vite 官方接入](https://ui.shadcn.com/docs/installation/vite)、[官方主题机制](https://ui.shadcn.com/docs/theming)、[Button 官方源码](https://ui.shadcn.com/r/styles/new-york-v4/button.json)、[AI Elements](https://ui.shadcn.com/docs/ai-elements)。

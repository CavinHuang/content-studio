# 组件接入与维护

日期：2026-10-25；当前依据设计系统 v2.3。组件来源与 MIT 许可见 component-sources.json 及 src/renderer/src/components/ui/LICENSE.md。

## 基础层

React / Vite / Electron 共用 Tailwind CSS 4、shadcn/ui new-york-v4 和 Radix 源码。foundation.css 使用官方 Tailwind / shadcn CSS 入口，已确认设计稿的温暖配色写入语义变量，字体、间距与控件尺寸使用默认规范。组件配置见 components.json；不依赖 Next.js 或服务端渲染。

Button 恢复 h-9 默认高度，Card 恢复 flex / gap-6 / py-6 / shadow-sm 基础结构；移除 unstyled / unset。业务场景直接用 ghost / outline / default 等标准变体，以及 JSX Tailwind 类控制布局。Input、Textarea、Tabs、Dialog、Sheet、Popover、Checkbox、Slider、Badge 等不由全局业务 CSS 重设尺寸或排版。

components/ui.tsx 仅组合业务语义：Modal 使用 DialogContent 的 p-6 / gap-4，内部滚动与宽弹窗通过明确的 Tailwind 类表达。Field 接入官方 Field / FieldLabel / FieldDescription，保留默认 gap-3；标签独立关联输入，说明关联 aria-describedby，输入内容不再继承标签的 medium 字重。SearchBox 使用 Input Group / InputGroupButton，搜索外层不再添加边框或焦点描边。

Tabs 的 line 变体使用底部细线表达选中，鼠标点击不显示焦点框；键盘 Tab、方向键及 Home / End 操作保留单层内侧焦点描边。Radix 的鼠标事件会主动调用 focus，因此 TabsList 记录鼠标与键盘输入方式，避免 Chromium 将程序聚焦误判为键盘聚焦。全局 tabindex 焦点兜底仅作用于没有 data-slot 的自定义元素，防止与官方组件的 border / ring / outline 叠加。默认分段式 Tabs 继续使用官方样式。

焦点实拍：[鼠标选中](implementation/tabs-mouse.png)、[键盘切换](implementation/tabs-keyboard.png)、[输入后再次点击](implementation/tabs-after-typing.png)。交互回归覆盖点击后保留焦点、方向键自动选中、Tab 离开及返回、Home 定位，以及鼠标与键盘之间切换；截图保留实际焦点，不在拍摄前 blur。

## 官方 Sidebar

`components/ui/sidebar.tsx`、`skeleton.tsx` 与 `hooks/use-mobile.ts` 直接来自 shadcn/ui new-york-v4 registry，仅适配本地 import。`StudioSidebar.tsx` 按官方组合 SidebarHeader / Content / Footer / Group / Menu / MenuSub，菜单、计数和悬停操作分别使用 MenuButton、MenuBadge 与 MenuAction，不再保留自绘导航按钮。

SidebarMenuButton 默认 h-8，子菜单 h-7；新建按钮和搜索框保持 h-9。菜单统一使用 sidebar-accent 与 sidebar-accent-foreground，保留设计稿的浅沙、浅绿和墨绿配色。项目长标题截断显示完整 title，计数靠右，管理按钮在悬停或键盘聚焦时出现。

SidebarProvider 统一管理桌面 open 与手机 openMobile，SidebarTrigger 和官方 Ctrl / Cmd+B 切换可见性；Ctrl / Cmd+K 打开并聚焦搜索。因为工作台需要保留可拖动的三栏，Sidebar 使用官方 collapsible="none" 嵌入 ResizablePanel，由外层根据 Provider 状态显示和隐藏；手机沿用带中文名称与焦点恢复的 Sheet。SidebarSeparator 的宽度在业务组合处表达。

子菜单使用 SidebarMenuSubButton asChild 直接承载原生 button，样式全部由 SidebarMenuSubButton 提供，不再叠加通用 Button 的尺寸与内边距。当前文件树采用局部紧凑缩进：SidebarMenuSub 使用 mx-2 / px-1.5，替代官方默认的 mx-3.5 / px-2.5；子级图标相对父级右移约 15px。子菜单仍保持默认 h-7 / gap-1，文字左对齐、按钮满宽。此处是业务组合层的明确调整，组件源码保持原样。

移除 66 处旧侧栏 CSS 规则，workspace.css 仅保留侧栏在桌面、窄屏和抽屉中的外层尺寸。来源见 [官方 Sidebar 文档](https://ui.shadcn.com/docs/components/radix/sidebar) 与 component-sources.json。

## Agent 与文章

会话选择使用官方 DropdownMenuRadioGroup / RadioItem，保留自然高度和键盘导航；Escape 回到触发按钮，选中或新建后进入 Agent 输入框。会话与素材浮层通过 collisionBoundary 约束在当前 Agent 面板，长标题在文本列中省略。素材浮层初始聚焦第一项素材，避免关闭按钮 Tooltip 自动弹出；无素材时聚焦收集入口。

SearchBox 清除后保持输入焦点；IconButton 透传标准按钮属性，用于展开按钮的 aria-expanded / aria-controls。普通保存状态使用 status 文本，失败时才显示标准 sm 重试按钮。详情与验证见 [UI-UX-REFINEMENT.md](UI-UX-REFINEMENT.md)。

Agent 采用 Message Scroller、Message、Bubble 与 Input Group 官方组合。用户使用 muted 气泡结构并组合浅陶土背景，助手使用 ghost，MessageContent 保留默认 gap-2.5；发送按钮使用 InputGroupButton 的 icon-sm。气泡、输入框附件区不再由外层 CSS 重设尺寸或圆角。时间和复制进入元信息行；进行中状态使用真实本地 Mock 任务。保留 IME、滚动锚点、对话隔离、上下文与复制。

Markdown 支持局部 className 与 beforeBlock 插槽。文章字体、字号、行高是用户可调整的内容参数，默认使用 sans、16px / leading-7；不会修改应用字体栈。建议的展开按钮有 aria-expanded / aria-controls，收起内容使用 hidden；跨页面请求在目标文稿挂载后消费，展开并定位。

## CSS 与验证

main.tsx 只导入 foundation.css、workspace.css。workspace.css 使用 @reference 与 @layer components；字体与间距复用 Tailwind，组件自己的 utilities 优先。旧的三层覆盖文件、自定义字体包、字号和密度 Token 已移除。

组件升级时保留 Slider 可访问名称、Progress 值传递、Dialog 焦点恢复与输入法处理等交互适配；完整记录在 component-sources.json。不要将官方组件替换为同名手写控件。

执行 pnpm design:check、pnpm build 与 Playwright Electron 回归；pnpm ux:capture 重新拍摄桌面、窄屏和手机状态并生成离线对照页。UI 改动需查看实拍，而非只核对数值。

## 全页间距校准

业务页面使用 p-4，业务卡片用 p-3 / gap-3，字段组用 gap-3，网格内 Field 的 margin-bottom 为 0。PageTitle 将说明放在标题下方，避免操作区高度制造空白；Field 内下拉框填满列宽。Agent 的消息间隔显式为 gap-4，消息内部使用官方默认 gap-2.5，相关结果卡移除重复外边距。

上述紧凑值描述外层业务布局；v2.3 起，通用控件内部以组件源码为准，MessageContent 恢复默认 gap-2.5，Field 使用默认 gap-3。40 处文字操作改用官方 sm Button；缩略图使用官方 icon Button。编辑／预览、素材范围和来源类型使用 Tabs，不再以自绘按钮边框模拟标签页。三栏只由 ResizableHandle 绘制分隔线；发布选中卡片不再叠加 inset 阴影。完整审查见 [UI-UX-AUDIT.md](UI-UX-AUDIT.md)。

分镜 Card 采用 gap-0 / p-0，内部分区负责间距；分镜标题按钮 p-0，时长输入框使用 w-16 且标签不换行。视频根 Tabs 的 gap-0 避免与工具栏外边距叠加。任务卡片通过显式 flex-row 将图标和正文并排。全部局部选择均在业务组合处表达，官方组件源码保持不变。

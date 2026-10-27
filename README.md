# Content Studio

pnpm monorepo：`@content-studio/desktop`（Electron 主进程/preload 壳）与 `@content-studio/ui`（React + Tailwind + shadcn 渲染端）两个工作区包。UI/UX 设计与效果图保存在 [docs/ux](docs/ux/README.md)。

界面采用 **shadcn/ui + 官方 AI Elements 组合模式**，由 Tailwind CSS 4 与 Radix 驱动。配色遵循已确认设计稿，字体、间距和控件尺寸沿用 Tailwind / shadcn 默认规范，见 [设计系统](docs/ux/DESIGN-SYSTEM.md)；[可视化 Token 手册](docs/ux/design-system.html) 可离线查看。

内容库采用官方 Sidebar / Group / Menu / Footer 组合，集中定位项目；文稿和视频在工作区切换，创作方案、参考素材与助手按需展开。支持搜索、项目管理、桌面栏宽拖动与手机抽屉；Ctrl / Cmd+B 折叠，Ctrl / Cmd+K 搜索。布局审查与逐项修复见 [布局修复记录](docs/ux/LAYOUT-FIXES-2026-10-26.md)。

## 环境

- Node.js 22.13+（建议使用 24 LTS）
- pnpm 11.25.0

```sh
pnpm install
pnpm dev
```

首次启动会下载对应平台的 Electron 运行时。如果 GitHub 下载失败，可在当前 PowerShell 终端临时配置镜像后重试：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
pnpm exec install-electron
pnpm dev
```

## 命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | 启动 Electron 开发窗口，支持 React 热更新 |
| `pnpm dev:web` | 仅启动浏览器界面预览，不注入桌面桥接 |
| `pnpm typecheck` | TypeScript 检查 |
| `pnpm design:check` | 检查 token 一致性、核心文本对比度与组件使用边界 |
| `pnpm tokens:generate` | 从设计清单生成运行时 CSS token |
| `pnpm build` | 检查并构建主进程、preload 和 React 渲染端 |
| `pnpm start` | 运行构建后的 Electron 应用 |
| `pnpm test` | 运行 vitest 单元与渲染端测试（存储迁移、任务状态机、AI 编排、热点抓取与聚合、发布编排与适配层、视频导出） |
| `pnpm test:smoke` | 构建并验证实际 Electron 窗口、核心工作流、键盘与响应式交互 |
| `pnpm ux:capture` | 构建后拍摄 56 个页面、弹窗与空态，并更新离线设计对照页 |
| `pnpm package:dir` | 生成未打包的桌面分发目录 |
| `pnpm package:win` | 构建 Windows 便携版 |

## 目录

```text
packages/
  desktop/       @content-studio/desktop：Electron 主进程、preload 与打包配置
  ui/            @content-studio/ui：React 入口、页面、组件与样式
docs/ux/         当前设计总览、效果图与交互规范
tests/unit/      主进程模块单测（node 环境）
tests/renderer/  渲染端测试（jsdom 环境）
tests/smoke/     Playwright 真窗口（Electron）启动与核心流程验证
scripts/         设计 token 与门禁脚本
resources/       应用图标的 SVG 源文件、PNG 与 Windows ICO
```

当前为基于 `docs/ux/UX-SPEC.md` 实现的创作工作区：文稿、任务与数据链路真实落地，AI、热点、发布与视频域按「配置即真实、未配置保演示」运行。首次进入会载入三个示例内容项目，刷新后保留用户修改；初始化阶段已写下的非空文稿也会导入，原存储键保留。

体验路径、真实与演示边界见 [界面实现](docs/ux/IMPLEMENTATION.md)，精细校准结果见 [设计与实现对照](docs/ux/alignment.html)。

- 三栏宽度可调整、收起；内容项目与对话独立切换，手机采用单列与底部导航。
- 新建内容可直接在母稿输入主题与零散记录，自动带入本篇已引用素材，整理为可编辑底稿并直接导出 Markdown。已有正文的重写先形成候选，比较采用后保留原稿版本；支持撤销、停止与重启恢复。任务审计、前后对照与验证边界见 [核心创作流程重构](docs/ux/CREATION-FLOW.md)。
- 创作方案可编辑、调整大纲顺序，确认后生成母稿：配置模型后由真实模型按方案生成候选（现有母稿保留），未配置时为示例母稿。
- 母稿与五个平台版本独立保存、排版；Agent 建议先对照再采用，可撤销；源文稿变化会标记建议过期。版本恢复创建新快照。
- 热点支持搜索、领域、具体来源、时间与排序筛选，收藏、多源去重原文、来源启停和设置；可添加 RSS/Atom 订阅与热榜 JSON 来源真实抓取，来源支持手动刷新与定时刷新，抓取失败如实标注并保留缓存；选择角度与来源后创建独立项目。
- 全局素材支持文字、链接、图片和文件，区分项目引用、对话引用与插入文稿；原素材删除进入回收站。
- 视频分别提供素材分镜和代码动画工作台：镜头排序、配图、口播与字幕修改、SRT 导出、本地动画播放、参数候选与采用；「导出视频」经本机 Remotion 渲染真实 MP4，任务中心可见帧级进度、可停止、失败可重试，完成后可打开导出文件夹。
- 发布先明确选择平台，再固定本批次内容快照；公众号可经官方接口存入草稿箱（富文本复制仍可用），小红书可将标题、正文与话题注入平台编辑器并停在草稿，知乎/抖音/X 走复制与 Markdown/JSON 下载；应用只到草稿，绝不自动发布，发布由用户在平台手动完成后回来标记。
- 设置支持创作偏好、模型与语音服务配置及连接测试、全部备份导入/导出、项目导出与回收站恢复。

图片使用仓库内原创 SVG 场景插画，图标使用本地打包的 Lucide SVG；字体使用 Tailwind / shadcn 默认 font-sans 系统字体栈。界面不依赖外链图片、图标或字体。设计总览作为打包资源保留。

## 真实能力与演示边界

| 域 | 配置后的真实能力 | 未配置时的路径 |
| --- | --- | --- |
| AI 文稿 | 「设置 → AI 服务」配置 OpenAI 兼容服务后，对话、修改建议、母稿与平台稿生成由真实模型驱动（内嵌 pi agent 运行时，经 mock OpenAI 端点的 e2e 全链路验证） | 本地确定性演示回复与建议，不阻断非 AI 功能 |
| 热点信息源 | 用户添加的 RSS/Atom 订阅与热榜 JSON 来源由主进程真实抓取（15 秒超时），正文提取可读正文优先、页面摘要次之、失败如实标注「仅链接」；抓取进任务系统，支持进度、停止、失败提示与定时刷新 | 内置示例来源提供确定性演示话题（「示例来源 · 演示数据」徽标，可停用不可删除） |
| 发布 | 公众号经官方接口存入草稿箱（stable_token 缓存、封面走素材接口、正文图上传替换、草稿新增）；小红书把标题、正文与话题注入平台编辑器并停在草稿；平台间串行执行、相邻限速、失败按瞬态/凭证/永久三分类处理 | 未配置凭证按凭证类失败如实提示；复制富文本与下载文稿的人工交付不受影响 |
| 视频导出 | 「导出视频」经本机 Remotion 渲染真实 MP4（帧级进度、可停止、失败可重试，产物在本机导出目录） | 制作清单 JSON 与字幕 SRT 下载不依赖任何配置 |
| 配音 | 配置 OpenAI 兼容语音服务后真实合成，音频保存在本机，镜头时长按音频时长回填 | 本地交互演示，不播放真实音频 |
| 代码动画 | —— | 本地组件预览，不执行生成代码 |

仍然没有的能力：云同步、自动发布（应用只到草稿，正式发布永远由用户在平台手动完成）、doocs/md 深度集成（公众号链路使用自有的轻量 Markdown 转公众号 HTML 转换器，界面排版为 React 预览组件）。公众号富文本复制仍需在平台编辑器检查兼容性。

## 凭证与密钥

- 模型服务与语音服务：「设置 → AI 服务」分别配置 OpenAI 兼容的服务地址、模型 ID 与 API Key，语音服务可独立配置并指定音色；模型服务支持保存后测试连接，语音服务以分镜「更新所选镜头配音」的实际任务验证配置。
- 公众号：发布准备页填写 AppID 与 AppSecret；调用前需先把本机出口 IP 加入公众号后台的 IP 白名单（页内有提示），凭证只保存在本机。
- 小红书：发布准备页「打开登录」拉起平台页扫码，登录态保存在本机独立会话分区。
- 密钥经系统安全存储（safeStorage）加密保存在本机，界面只回显尾号，不参与备份导出；渲染进程不接触密钥。浏览器预览（`pnpm dev:web`）没有桌面桥，不支持连接测试、草稿箱与平台注入，仍可复制与下载。

工作区数据保存在应用数据目录内的本机 SQLite 数据库（studio.db）：项目、文稿版本、素材、任务与设置在重启后完整恢复，任务状态由主进程统一管理并支持停止、重试与重启降级。浏览器预览（`pnpm dev:web`）降级使用 localStorage。图片/文件单个不超过 1 MB。全量备份可通过「设置 → 数据与导出」恢复，重新载入示例前也会提醒备份。

Electron 使用上下文隔离、沙盒与受限 preload API；React 渲染进程不直接访问 Node.js。运行时输出在 `out/`，打包输出在 `release/`，均不纳入版本控制。

Windows 打包默认生成未签名的便携版。也可以先执行 `pnpm package:dir`，再在 PowerShell 中验证分发目录：

```powershell
$env:STUDIO_TEST_EXECUTABLE = "$PWD/release/win-unpacked/Content Studio.exe"
pnpm exec playwright test
Remove-Item Env:STUDIO_TEST_EXECUTABLE
```

界面规范以 [docs/ux/DESIGN-SYSTEM.md](docs/ux/DESIGN-SYSTEM.md) v2.2 为准：设计稿配色 + Tailwind CSS 4 / shadcn/ui 默认字体和控件尺寸；业务间距使用 Tailwind 刻度做紧凑组合，见 [间距校准](docs/ux/SPACING-AUDIT.md)。旧自定义字体和覆盖样式已移除。

# Content Studio

从零初始化的 Electron + React + TypeScript 桌面应用。UI/UX 设计与效果图保存在 [docs/ux](docs/ux/README.md)。

界面采用 **shadcn/ui + 官方 AI Elements 组合模式**，由 Tailwind CSS 4 与 Radix 驱动。配色遵循已确认设计稿，字体、间距和控件尺寸沿用 Tailwind / shadcn 默认规范，见 [设计系统](docs/ux/DESIGN-SYSTEM.md)；[可视化 Token 手册](docs/ux/design-system.html) 可离线查看。

内容库采用官方 Sidebar / Group / Menu / MenuSub / Footer 组合，支持搜索、嵌套导航、项目管理、栏宽拖动与手机抽屉；Ctrl / Cmd+B 折叠，Ctrl / Cmd+K 搜索。

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
| `pnpm test:smoke` | 构建并验证实际 Electron 窗口、核心工作流、键盘与响应式交互 |
| `pnpm ux:capture` | 构建后拍摄 55 个页面、弹窗与空态，并更新离线设计对照页 |
| `pnpm package:dir` | 生成未打包的桌面分发目录 |
| `pnpm package:win` | 构建 Windows 便携版 |

## 目录

```text
src/
  main/          Electron 主进程与受限 IPC
  preload/       隔离上下文中的桌面 API
  renderer/      React 入口、组件与样式
  shared/        桌面 API 类型及 IPC 通道定义
docs/ux/         当前设计总览、效果图与交互规范
tests/smoke/     Electron 启动与核心编辑验证
resources/       应用图标的 SVG 源文件、PNG 与 Windows ICO
```

当前为基于 `docs/ux/UX-SPEC.md` 实现的 **Mock 界面工作区**。首次进入会载入三个示例内容项目，刷新后保留用户修改；初始化阶段已写下的非空文稿也会导入，原存储键保留。

体验路径和界面截图见 [Mock 界面实现](docs/ux/IMPLEMENTATION.md)，精细校准结果见 [设计与实现对照](docs/ux/alignment.html)。

- 三栏宽度可调整、收起；内容项目与对话独立切换，手机采用单列与底部导航。
- 创作方案可编辑、调整大纲顺序，确认后生成示例母稿。
- 母稿与五个平台版本独立保存、排版；Agent 建议先对照再采用，可撤销；源文稿变化会标记建议过期。版本恢复创建新快照。
- 热点支持搜索、领域、具体来源、时间与排序筛选，收藏、多源去重原文、来源启停和设置；选择角度与来源后创建独立项目。
- 全局素材支持文字、链接、图片和文件，区分项目引用、对话引用与插入文稿；原素材删除进入回收站。
- 视频分别提供素材分镜和代码动画工作台：镜头排序、配图、口播与字幕修改、SRT 导出、本地动画播放、参数候选与采用、演示导出任务和失败恢复。
- 发布先明确选择平台，再固定本批次内容快照；支持复制、Markdown/JSON 下载及用户手动标记发布，复制与下载不会自动发布。
- 设置支持创作偏好、Mock 服务测试、全部备份导入/导出、项目导出与回收站恢复。

图片使用仓库内原创 SVG 场景插画，图标使用本地打包的 Lucide SVG；字体使用 Tailwind / shadcn 默认 font-sans 系统字体栈。界面不依赖外链图片、图标或字体。设计总览作为打包资源保留。

所有 AI 回复、热点、来源状态、语音和导出任务都是明确标识的本地演示。**没有实时采集、真实模型请求、音频合成、MP4 渲染、云端同步或自动发布**。动画是本地组件预览，视频导出只演示任务状态，实际可下载制作清单 JSON 与字幕 SRT。Markdown 排版为 React 预览组件，尚未实际集成 doocs/md。公众号富文本复制仍需在平台编辑器检查兼容性。

工作区暂存于当前设备的 localStorage；图片/文件单个不超过 1 MB，空间不足会保留内存中的编辑并提示备份。密钥示意输入不会保存或发送。全量备份可通过「设置 → 数据与导出」恢复，重新载入示例前也会提醒备份。

Electron 使用上下文隔离、沙盒与受限 preload API；React 渲染进程不直接访问 Node.js。运行时输出在 `out/`，打包输出在 `release/`，均不纳入版本控制。

Windows 打包默认生成未签名的便携版。也可以先执行 `pnpm package:dir`，再在 PowerShell 中验证分发目录：

```powershell
$env:STUDIO_TEST_EXECUTABLE = "$PWD/release/win-unpacked/Content Studio.exe"
pnpm exec playwright test
Remove-Item Env:STUDIO_TEST_EXECUTABLE
```

界面规范以 [docs/ux/DESIGN-SYSTEM.md](docs/ux/DESIGN-SYSTEM.md) v2.2 为准：设计稿配色 + Tailwind CSS 4 / shadcn/ui 默认字体和控件尺寸；业务间距使用 Tailwind 刻度做紧凑组合，见 [间距校准](docs/ux/SPACING-AUDIT.md)。旧自定义字体和覆盖样式已移除。

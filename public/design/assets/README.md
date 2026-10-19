# Creator V2.2 / V2.3 设计资产

本目录包含**实际提交到远程仓库**、可被代码和设计工具直接引用的原生资产。

## 可用原始设计源（位于上层目录）

- [Creator V2.2 全站原始高保真交互 HTML](../creator-v2.2.html) — 11 个工作区的桌面/移动布局与示意交互
- [Creator V2.3 文章智能配图高保真交互 HTML](../creator-v2.3-visual.html) — 配图规划、版本比较、修改、采用、预览
- [Next.js 交互设计验收页](../../../app/design/creator-v2/page.jsx) — 路由 `/design/creator-v2`（演示数据，不是生产）
- [完整开发任务和验收说明](../../../docs/agent-tasks/CREATOR-V2-IMPLEMENTATION-PROMPT.md)

## 已纳入版本管理的视觉资源

- `cover-editorial-blue.svg` — 靛蓝编辑视觉参考（2.35:1）
- `cover-editorial-sand.svg` — 暖纸编辑视觉参考（2.35:1）
- `cover-editorial-forest.svg` — 自然科技视觉参考（2.35:1）
- `visual-slot-empty.svg` — 尚未生成或采用图片的空状态
- `creator-v2-tokens.json` — 配色、间距基线与移动/桌面布局参数

这些 SVG 是**可编辑的设计示例资产**，不是用户文章的真实 AI 配图，也没有取得新闻来源图片的授权。正式产品不能把它们当成已经生成成功或已审核图片。

## 截图资产说明

设计阶段曾生成过桌面/移动 PNG 页面预览和完整 ZIP 打包，但**PNG/ZIP 二进制截图尚未提交到 GitHub**，不要错误标注为已同步。真实页面的可复现视觉事实源是以上两份 HTML。若需将 PNG 截图也纳入仓库，在本地或 CI 中使用 Playwright 从两份 HTML 捕获 1440px 桌面和 390px 移动截图，再将生成文件提交到 `docs/design/screenshots/`；需记录截图版本和生成 commit。

## Coding Agent 注意

1. 优先复用设计 tokens 和现有产品组件，不把示例 SVG 当作真实业务状态。
2. 页面布局以两份原始高保真 HTML 为准，Next.js 预览页仅作导航/状态示例。
3. 图片服务、生成队列、作者审批、版本/映射必须接现有领域 API。
4. 不允许新建与 master/wechat/zhihu 竞争的内容数据模型。
5. 不得为了截图和静态演示绕过现有 API 授权、CSRF、版本冲突或发布保护。

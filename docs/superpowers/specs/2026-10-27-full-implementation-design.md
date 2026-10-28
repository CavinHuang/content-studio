# Content Studio 完整功能实现 · 功能域设计（五期路线）

日期：2026-10-27。状态：已获批准（plan 审批通过）。本文是"从 56 屏 Mock 工作区走向完整功能实现"的总设计，后续各期实施计划以其为基线。

## 0. 背景与现状证据

- 当前是 Mock 界面工作区：界面完整（56 屏 capture 门禁），流程全假。
  - 假 Agent：`packages/ui/src/studio/store.tsx` `sendMessage()` 正则路由 + 拼接文案（:544-714）。
  - 假任务：`store.tsx` `task()` setTimeout(1000) 置 complete（:282-314）。
  - 假数据：`packages/ui/src/studio/mock.ts`（618 行）被 7 处直接 import（store/App/Agent/Settings/Hotspots/Article/Videos）。
  - 持久化仅 localStorage 单键 `content-studio.mock-workspace.v2`（`store.tsx:38`），真实数据量必然撑爆配额。
  - 主进程仅 84 行、2 个 IPC handler（appInfo/openDesigns）；CSP `connect-src 'self'` 封死外联；无任何 fetch/HTTP client/AI SDK/数据库。
- 产品事实标准：`docs/ux/UX-SPEC.md` v1.2（目标用户=独立创作者；平台=公众号/小红书/知乎/抖音/X；人工发布原则；验收依据 §18 十二条 + §20.5 热点六条）。
- Mock 边界清单（即"完整实现"目标清单）：README.md:72 —— 无真实模型请求、实时采集、音频合成、MP4 渲染、云同步、自动发布；doocs/md 未集成。
- **历史资产**：2026-10-24 项目重置（8c90905）前的完整真实实现保留在 git 历史：
  - 设计规格：`docs/superpowers/specs/2026-10-24-content-ops-workbench-design.md`（commit 63d3433）。
  - 实施计划：M1 壳/内容库/编辑器（1515362）、M2 pi agent（33a3db5，2133 行）、M3 变体/发布（0929d66，3090 行）。
  - 已实施代码：pi 1.4.0 集成（3e7414e…7e805a9）、公众号 API 客户端 + md→HTML（19f5778）、小红书注入 + WebContentsView（cc0f351）、发布编排 PublishService（edf225b）、变体工作台/发布中心（b70922a）。
  - 探针实证（避免重踩）：pi 只能动态 import + vite externalize（TUI 路径在 asar 内必炸）；models.json 必须显式传 modelsPath；noTools:'all' 后挂领域工具；并发上限 1、可取消；公众号 API 2026-10 实测形状（stable_token/add_material/uploadimg/draft/add、40001 单次强刷、IP 白名单前提）；小红书注入绝不点发布（fixture 断言发布按钮点击数=0）；WeSight/gzh-design 为 AGPL，只借鉴思路不复制代码。

## 1. 总策略

以当前 56 屏 UX-SPEC v1.2 为目标形态，分层引入真实能力；从 git 历史选择性移植已验证资产（探针事实 + 架构无关的适配器代码），不整仓回滚。

## 2. 四项关键取舍（2026-10-27 提问未获回复，按推荐项执行；可推翻，推翻则修订本文）

1. **AI 运行时 = pi agent 进程内嵌入**（历史 M2 配方），模型走 OpenAI 兼容接口自配 key；外层保留 Provider 接口防锁死。
2. **存储 = 主进程 better-sqlite3 权威库** + 设置页全量备份/Markdown 归档导出；不采用旧项目"文件优先"模型。
3. **分期 = P1 地基 → P2 AI 创作链 → P3 热点信息源 → P4 发布适配 → P5 视频渲染**。
4. **视频一期只做数据真实化**；TTS/MP4（Remotion 候选，技术路线未冻结）放 P5 专项验证。

排除项：手机辅助/云同步（UX-SPEC §15 自标注需后续技术验证）不在本路线内。

## 3. 目标架构

```
packages/ui（renderer，沙盒不变，CSP connect-src 'self' 不放开）
  pages/components → useStudio() 的 28 个 action 收敛为 StudioService 接口
  双实现：local（dev:web / 桌面桥缺失时降级）+ bridge（IPC 白名单通道）
        │ IPC（扩展 DESKTOP_CHANNELS 模式；命名空间 db/task/ai/discovery/publish）
packages/desktop main 进程新增模块：
  storage   better-sqlite3 + DAO + schema 版本化迁移器
  tasks     TaskRunner：六态状态机（排队/运行/部分完成/失败/已停止/完成，UX-SPEC §12），
            持久化任务表、停止/重试、重启恢复、步骤式真实进度（不虚报百分比）、IPC 事件推送
  ai        pi runtime + Provider 配置（baseURL/key/model，safeStorage 存密钥）
  discovery 信息源抓取（RSS/热榜 API/正文提取），抓取进任务系统
  publish   公众号 API、小红书 WebContentsView 注入、md→HTML、串行限速编排
  所有外网请求一律在 main 进程发出；renderer 不直连。
```

设计约束：
- renderer 保持 contextIsolation + sandbox；一切 I/O 走 preload 白名单桥。
- 领域协议沿用 `packages/ui/src/studio/types.ts` 现有模型（Suggestion 状态机、CreationFlow candidate/applied、Version 快照），真实服务层直接实现该协议，不另起炉灶。
- 页面组件只依赖 action 签名的现状优势保持：组件不直接 import 数据实现。

## 4. 分期设计

### P0 前置（一次性，本文档即其产物）
- main 分支建立于 fix/style-redundancy 顶端（721665c）；工作分支 feat/real-foundation。
- `docs/ux/research` 下并发会话未提交改动保持不动，不纳入本计划提交。
- 本 spec 落档提交；P1 开工前用 writing-plans 出 TDD 实施计划。

### P1 数据与任务地基（功能域 A）
目标：真实数据有处落地、真实任务有处运行；其余各期的承载层。
1. shared 通道契约扩展：`studio:db:*` / `studio:task:*` 命名空间；preload 白名单同步。
2. SQLite schema：projects / drafts / versions / materials / sources / topics / tasks / publish_records / preferences / conversations（沿用 types.ts 模型，schema 版本化 + 迁移器）。
3. StudioService 接口收敛：mock.ts 7 处直接 import 收敛为 seed/fixture 注入。
4. TaskRunner：Tasks 页从 setTimeout 假任务切真实事件（进度/停止/重试/重启恢复；重启时 running→stopped 降级语义保留）。
5. localStorage v2 → SQLite 首启迁移（含旧键迁移链）；配额告警逻辑退役。
6. 门禁同步：capture/e2e 绑定 Mock 文案与流程的用例适配。
验收：typecheck / design:check / test:smoke / ux:capture 四门禁全绿；重启后任务与数据完整恢复；renderer 零外联；dev:web 降级可用。
探针：better-sqlite3 原生模块（pnpm allowBuilds 放行 + electron ABI 重编译 + electron-builder 打包链）——本期第一个验证项。

### P2 AI 创作链（功能域 B）
目标：文稿域核心价值真实化（UX-SPEC §4/§5/§6，验收 §18 条 2/3/4）。
1. pi 1.4.0 集成：从历史 M2 恢复精确版本锁（pi 1.4.0 + typebox 1.3.27）与配方；挂 4 个领域工具（读写内容/写草稿/ask_user）。
2. 设置页 AI 服务真实化：baseURL/key/model、safeStorage 存储、真实连接测试；未配置时按 §16 降级（仍可写作/管理版本，动作处就地配置入口）。
3. sendMessage 正则路由替换为 pi 会话：流式输出（IPC 增量事件）、上下文快照沿用 creationSnapshot、素材引用进上下文。
4. 母稿生成、母稿→平台版本改写走真实生成；生成范围显式（当前平台/所选/全部）；建议对照/逐条采用/撤销/过期标记接真实生命周期。
5. 热点角度建议预留接口（P3 接入）。
验收：空白项目直接写作或对话开始全链路真实；AI 修改有范围/对照/采用/撤销；未配置 key 不阻断非 AI 功能。

### P3 热点与信息源（功能域 C）
目标：发现 → 来源与角度 → 新内容创作方案整条路径连通（UX-SPEC §20，验收 §20.5 六条）。
1. 信息源框架：四类型（平台热榜/新闻资讯/RSS/自定义）+ 来源状态机（可用/未配置/已停用/更新中/获取失败/缓存过期）；来源管理页真实 CRUD/启停/刷新。
2. RSS 真实抓取（main 进程 fetch + feed 解析）；热榜接候选 API 源；正文提取（readability 类）；"仅链接"状态真实化，读取失败不伪装成功。
3. 抓取进 P1 任务系统（手动刷新 + 可配置定时）；话题聚合按原始 URL 去重，多源收录分别计数，排名/热度不跨源加总。
4. 角度建议/热点概览接 P2 AI；已创建内容保留选题与来源快照（§20.4 不静默重写）。

### P4 发布适配（功能域 D）
目标：发布从"纯人工复制"升级为"草稿注入 + 人工点击发布"；人工发布原则不变（§14）。
1. md→公众号 HTML：移植历史 markdown-to-wechat-html（含正文图 uploadimg 替换）；doocs/md 深度集成评估后定（一期自有轻链路即可满足富文本复制）。
2. 公众号官方 API 草稿箱适配器：移植历史实测形状（stable_token 缓存、素材接口、draft/add、40001 单次强刷、IP 白名单前提 UI 明示）。
3. 小红书：WebContentsView + persist partition 会话 + 自包含注入脚本（防覆盖、绝不点发布——fixture 断言发布按钮点击数=0）。
4. 发布编排：移植 PublishService（平台间串行限速默认 15s、三分类重试）；发布记录绑定批次+平台+文稿/视频快照。
5. 知乎/抖音/X 一期维持复制/导出人工交付（spec 定义的合法终态）。
铁律：AI 产出只落草稿区；只注入草稿、绝不点发布。

### P5 视频二期（功能域 E）
- 分镜/版本/导出任务数据真实化随 P1 完成（SRT/制作清单导出本就真实）。
- 本期专项：TTS 服务商选型接入（配音时长↔字幕对齐）；Remotion 渲染链验证（Windows 本机渲染/取消/真实进度/耗时）；验证通过再冻结路线实现成片导出。验证前不承诺渲染能力（§19 原则）。

### 横切（每期同步）
- vitest 单测恢复（历史有配置）覆盖 main 进程模块（storage/tasks/适配器）；e2e 扩真实流程用例。
- `(Mock)` 标识与文案门禁 N1 规则随真实能力落地逐域摘除更新。
- CI 恢复（历史 GitHub Actions 模板：typecheck + design:check + vitest + smoke）。

## 5. 风险与铁律

- AGPL 边界：WeSight、gzh-design 只借鉴思路，绝不复制代码。
- 平台凭证成本：公众号 API 需 IP 白名单 + 用户 token；小红书需扫码登录会话——UI 按 §16 给就地配置入口与状态说明。
- 门禁连带成本：capture/e2e 与 Mock 文案深度绑定，每期预留门禁维护工作量。
- better-sqlite3 原生模块：P1 第一个探针项；失败备选 = 纯 JS SQL 层（sql.js + 定期落盘）或 JSON 分片存储，决策记录进 P1 计划。
- 密钥安全：一律 safeStorage，不落明文；渲染进程不接触密钥。

## 6. 执行方式

每期流程：实施计划落 `docs/superpowers/plans/` → TDD 实施 → 四门禁全绿 → conventional commit。分支命名 `feat/real-*`（P1: feat/real-foundation）。

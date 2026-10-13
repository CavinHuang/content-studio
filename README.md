# Content Studio · Next.js + doocs/md（V29）

聚合 AI 行业变化与创作者的一手实践，以证据为基础完成「发现 → Brief → 编辑 → 分渠道审核 → 本地交付 → 研究复盘」。

**当前状态：Next.js App Router 迁移工程 / 单用户本地开发版。不可直接公网部署。**

## 技术栈

- **Next.js 16.2 系列 / React 19 / App Router**。新页面使用原生 React 组件和响应式 CSS，不是旧 HTML iframe。
- **Node.js 22.13+ 自带 `node:sqlite`**，共享原 V27 SQLite 领域服务与全部既有业务规则。
- 同源 Route Handlers：`/api/[...parts]` → `lib/api.mjs` → `src/*.mjs`。
- 本地 SQLite 持久化，默认数据库 `data/content-studio.sqlite`；**不同版本操作同一数据库前务必备份**。

## 本机启动

```bash
# Node.js >=22.13
npm install
npm run dev
# 打开 http://127.0.0.1:4312
```

Windows PowerShell：

```powershell
npm install
npm run dev
```

正式构建与本地启动：

```bash
npm run build
npm start
```

默认只监听 `127.0.0.1`；不能当作已经具备用户认证的 SaaS 部署。不要直接改成公开监听地址。**禁止上传个人 SQLite、API Key、研究笔记和私密原文**到 GitHub。

### 首次使用

1. 「今日」可以直接新建原创草稿，不依赖任何新闻源。
2. 「信源管理」尝试同步 AIHOT、GitHub Release、Hacker News 和官方 RSS，**真实接口需要外网和对应授权**。
3. 「内容发现」查看聚合事件，逐条检查证据来源，选择事件创建 Brief 和独立文章。
4. 「创作」维护 `master`、`wechat` 和 `zhihu` 三份独立版本；渠道稿不会自动被主稿覆盖。
5. 「发布」分别确认事实、隐私、权利和排版后本地导出。导出 **不代表真实发布**。

只有明确启用环境变量 `ENABLE_SCENARIO=1` 才允许 `POST /api/fixture/seed` 载入演示数据。默认空数据库展示空状态。

### 迁移范围

| 功能 | Next.js React 工作台 | 复用 V27 领域 API | 边界 |
|---|---|---|---|
| 今日、全局导航 | 已迁移 | 状态 / 文章 / 研究 | 本地状态 |
| 信息源与事件发现 | 已迁移 | 实时同步 / 事件 / Brief | 外部连通性待验收 |
| 统一文章编辑 | 已迁移：段落编辑、保存、版本切换 | SQLite 版本和冲突检查 | 富文本块待迁移 |
| 双渠道审核 / 导出 | 已迁移 | 四项审核 / 快照 / URL 报告 | 平台不自动发布 |
| 复盘与知识总览 | 已迁移总览 | 验证 / 知识 / 反馈 | 深度操作可打开兼容页 |
| 精准证据锚点与更正 | 保留兼容页 | V26/V27 APIs 不变 | 原生 Next 交互尚待接入 |
| V21 旧原型 | 提供 `/app.html` 等兼容页面 | 旧 API 仍可用 | 旧 localStorage 不自动双向同步 |

遗留 HTML 在 `public/*.html` 和 `public/legacy/*.html`，便于迁移核对；Next.js 页面是 `/`, `/discover`, `/editor`, `/publish`, `/review`, `/sources`, `/validation`, `/knowledge`。

## 测试

```bash
npm test           # 业务 / HTTP / 新 Next 请求桥接契约测试
npm run check      # Node 语法检查
npm run build      # Next.js 构建（需要 npm 安装依赖）
```

注意：本次交付环境无法解析 `registry.npmjs.org`，所以无法安装 Next/React 包，**尚未执行真实 Next.js build 或浏览器渲染测试**。已经执行并通过的是 Node 领域服务、Route Handler 核心请求调度的自动化测试；首次联机后必须按 `docs/QA.md` 做 Next 浏览器验收。

## GitHub 推送

GitHub 连接的身份为 `CavinHuang`，目标仓库 `CavinHuang/content-studio`。当前对话中的 GitHub 连接器未提供“新建仓库”工具，因此远程仓库尚未创建，不能宣称已经 push。

1. 在 GitHub 建一个**空的私有仓库** `content-studio`（不要勾选创建 README、License、gitignore）。
2. 使用下面命令把此仓库推到 main：

```bash
git remote add origin https://github.com/CavinHuang/content-studio.git
git push -u origin main
```

源码 ZIP 是不包含 `.git` 的纯净代码快照；若要保留已经创建的本地 `main` 提交历史，请使用附带的 **Git bundle** 克隆。参阅 `docs/GITHUB.md`。

## 工程交接

- `docs/ARCHITECTURE.md`：API / Store / Next 与版本关系
- `docs/MIGRATION.md`：迁移决策、已完成与下一步
- `docs/QA.md`：已测范围和待联网验收
- `docs/GITHUB.md`：GitHub 新仓、推送和 CI 操作
- `AGENTS.md`：编码约束与安全红线


## 成熟公众号排版工作区（V29）

为避免重复实现排版编辑器，`/compose` 改用 [doocs/md](https://github.com/doocs/md)（WTFPL 许可证）作为独立微信 Markdown 排版器。**doocs/md 是独立 Vue 应用，不是我们直接调用的 React SDK。**

启动可选的本地独立排版服务：

```bash
docker compose -f docker-compose.doocs.yml up -d
# Next.js 服务另开一个终端运行：npm run dev
```

设置 `.env.local` 中的 `NEXT_PUBLIC_DOOCS_MD_URL=http://127.0.0.1:8800/` 后，可在 `/compose` 使用本地排版器。工作流为：选稿 → 复制/导出 Markdown → 在 doocs/md 排版 → 导出 .md → 回到 Content Studio 导入保存 Markdown 修订 → 人工核查和公众号后台粘贴验证。**没有自动双向同步、自动发布或平台核验。**

- 公众号与知乎的排版修订分别保存在 `editorial_layout_drafts` / `editorial_layout_history`。
- 导入必须匹配文章正文源版本、排版稿修订版本；冲突返回 409，防止旧内容覆盖。
- 导入撤销本渠道人工核查。旧的纯文本 HTML 导出会被阻止，避免交付与 doocs/md 排版内容不一致的旧文。
- 导入 Markdown **不会自动重新建立段落级事实引用**。原有知识引用和精准更正仍可在 `/editor` 查阅；内容变动必须人工审查。
- 建议用本机 Docker/CLI 实例；主动选择公网站点前需评估隐私。第三方软件的主题、图床与微信粘贴兼容仍要实际测试。

这一版是 **独立排版器交接集成**；不意味着 doocs/md 已作为 React 组件内嵌或支持全自动回存。
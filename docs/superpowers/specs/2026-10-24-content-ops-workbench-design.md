# 内容运营工作台（工作代号 ContentDeck）设计规格

- 日期：2026-10-24
- 状态：已与用户逐节确认，待最终审阅
- 仓库：本仓库（全新历史的起点）

## 1. 背景与定位

从零设计一个**本地优先的独立桌面应用**，服务内容创作者的完整运营循环。三个参考项目各贡献一块设计财富：

| 参考 | 继承的财富 |
|---|---|
| 旧 content-studio（本项目前身，已重置） | 领域纪律：修订不可变思想、AI 产出=假设、发布前人工检查、导出≠发布、运行中问询(ask_user)、任务取消与并发上限 |
| DSH-Creator（Jacky Creator） | 运营方法论：灵感→选题→制作→发布→复盘的管线视角、能力可选化、验收记录文化 |
| WeSight（Obsidian 插件+Chrome 扩展） | 架构路线：内容=纯 Markdown 文件、一稿多态的转化参数（小红书 600–900 字、X 280 加权计数）、浏览器会话桥接真实发布、只注入草稿不代点发布的风控边界 |

**定位声明**：一个本地优先的桌面内容运营工作台，覆盖完整创作循环——
**灵感库**（随手记、标签分级，确认为选题）→ **创作**（Markdown 长文为核心载体，内置 pi agent 协作）→ **一稿多态**（长文一键转小红书/X/即刻等平台动态与短文）→ **发布**（多平台文章+动态的草稿准备，人工确认最终发布）→ **运营**（档期、目标、数据回流、复盘，知识沉淀回流创作）。

已确认的基石决策：

1. 形态 = 独立桌面应用（Electron），本地优先，数据在用户手里。
2. 内容域 = 图文一稿多态；**视频制作链（脚本/字幕/封面）为二期**，数据模型预留形态字段。
3. AI 运行时 = **内置 pi agent**（`@earendil-works/pi-coding-agent` TypeScript SDK，进程内嵌入）。
4. 发布链 = **应用内嵌浏览器会话**（每平台独立 partition 登录态）+ 公众号官方 API；人工确认最终发布。
5. v1 平台集 = 公众号**文章**（传统长文，官方 API）+ 公众号**图文**（小绿书式图为主形态，DOM 适配器）+ 知乎 + 小红书 + X + 即刻，共六个子适配器（分批交付，见 §10）。公众号两种形态：**文章**=封面+摘要+富文本正文的传统长文（草稿箱 API 可建）；**图文**=以图为主、无需传统封面/摘要的轻量形态（官方 API 不支持，走 mp.weixin.qq.com 后台 DOM 注入）。

## 2. 非目标（v1 明确不做）

- 视频制作链（二期）。
- 自动发布：任何平台的最终发布动作永远由人点击。
- 平台数据自动抓取：阅读/点赞等运营数据 v1 手动录入。
- 多用户/云账号体系/会员制：单机单用户，无登录。
- 移动端。
- 自建模型传输层：模型接入完全委托 pi 的 provider 体系。

## 3. 总体架构

```
┌────────────────────────────────────────────────────────┐
│ Electron 桌面应用                                       │
│                                                         │
│  主进程 (Node 22)                 渲染进程 (React+TS)   │
│  ├─ pi agent（SDK 进程内嵌入）     ├─ 灵感库 / 选题看板  │
│  ├─ 领域服务                      ├─ 创作编辑器(MD)     │
│  │   ├─ 内容库（文件系统）          ├─ 一稿多态工作台    │
│  │   └─ 运营/发布（SQLite）        ├─ 运营台(档期/复盘)  │
│  ├─ pi 领域工具注册               └─ 发布中心           │
│  └─ 平台会话管理                  ┌──────────────────┐ │
│      （每平台 WebContentsView     │ 平台浏览器视图     │ │
│       + 独立 partition 登录态）    │ 知乎/小红书/X/即刻│ │
│                                  └──────────────────┘ │
└────────────────────────────────────────────────────────┘
      │                                    │
 内容库文件夹（用户自选，纯文件）        各平台登录态
 └─ .studio/（SQLite + pi 会话）          （Electron partition，不落明文）
```

职责边界：**主进程 = pi agent + 领域真相源 + 平台会话；渲染进程 = 纯 UI（无直接文件/DB 访问，一切经 IPC）；文件 = 内容的真相源；SQLite = 过程的真相源**。

安全基线：渲染进程 `contextIsolation` 开启、禁用 `nodeIntegration`；平台 WebContentsView 只加载平台白名单域名；IPC 通道按域最小化暴露。

## 4. 数据模型

### 4.1 文件侧（内容的真相源，创作者拥有）

```
内容库/（用户自选文件夹，可整库进 git）
├── 2026-10-24-文章标题/            # 一条内容 = 一个文件夹
│   ├── content.md                 # 正文 + frontmatter
│   ├── assets/                    # 图片等资产
│   └── platforms/                 # 一稿多态产物（是内容，所以是文件）
│       ├── xiaohongshu.md         #   标题+正文+话题+配图引用
│       ├── x.md
│       └── jike.md
├── …
└── .studio/                       # 应用状态随库走（迁移=拷文件夹）
    ├── studio.db                  # SQLite（WAL）
    ├── pi-sessions/               # pi 会话 JSONL
    └── drafts/                    # 草稿区：agent 产出的隔离落点
        └── <内容id>/…             #   确认后由应用原子写入正文/变体
```

`content.md` frontmatter 只存轻量元数据：`id / title / stage / tags / created / media`（`media: article | video`，为二期视频预留）。**平台发布明细一律不进 frontmatter**——文件描述"内容是什么"，数据库记录"内容经历了什么"，杜绝双写漂移。

设计原则与理由：

- 内容=文件：透明、可迁移、可 git、可被任何编辑器打开（WeSight/DSH-Creator 共同验证）。
- `.studio/` 随内容库走而非 OS 应用目录：整库拷贝即完成迁移。已知边界：若用户把内容库放进网盘同步目录，SQLite WAL 可能损坏——首次配置与文档中明确提示，检测到同步盘路径时警告。
- 平台变体是内容（文件），发布记录是过程（SQLite）。

### 4.2 SQLite 侧（过程的真相源）

| 表 | 关键字段 | 说明 |
|---|---|---|
| `sparks` | id, text, tags, grade, status(raw/confirmed/dropped), content_id | 灵感；confirmed 时生成内容文件夹并回填 content_id |
| `schedules` | id, content_id, platform, planned_date, status | 档期；发布中心"今日待发"来源 |
| `goals` | id, period, metric, target, actual | 阶段目标 |
| `publishes` | id, content_id, platform, variant_path, status(prepared/confirmed/published/failed), url, account, attempted_at, detail_json | 发布记录，每次尝试一行 |
| `retros` | id, content_id?, period?, notes, knowledge_md_path | 复盘；知识可导出为内容库 MD 回流 |
| `accounts` | platform, account_name, last_checked | 登录态探测结果快照；**凭证/cookie 不入库**，只活在 Electron partition |

迁移策略：`studio.db` 带 schema_version，启动时加性迁移（只增列不删改），损坏时引导重建（内容在文件里，可恢复性强）。

## 5. pi agent 集成

- **运行位置**：主进程进程内 `createAgentSession()`（Node 22 环境原生）。pi 及其依赖由应用打包携带，版本锁定（pi 迭代快，升级是显式决策而非随手 latest）。
- **会话模型**：每条内容一个绑定会话（上下文=该内容文件夹），运营台一个全局会话；JSONL 持久化于 `.studio/pi-sessions/`，可回放。内存会话用于一次性小任务。
- **领域工具**（注册给 pi，agent 借此真正操作工作台）：
  - `list_contents(stage?)` / `read_content(id)` / `write_content(id, patch)` — 写入只进草稿区
  - `save_variant(id, platform, markdown)` — 保存平台变体
  - `create_publish_task(id, platform)` — 建发布任务（只建任务，不触发注入）
  - `query_schedule(date?)` / `query_metrics(period?)` / `search_sparks(tags?)`
  - `ask_user(question, options?)` — 运行中问询，v1 必备（前身项目教训）
- **技能**（pi 技能=提示词模板包，随应用分发）：选题扩展、长文初稿、审稿改稿、一稿多态转化（内置各平台硬规则：小红书正文 600–900 字上限 1000、X 280 加权计数中文计 2/链接按缩短长度、即刻话题格式）、复盘分析。
- **人机边界（铁律）**：AI 产出=假设——agent 写入只落草稿区，人确认后才进 `content.md`/变体文件；**AI 永远不触发发布注入，更不点发布**。保留任务取消（注意 TDZ 类低级错误）与全局并发上限（前身项目实证教训）。
- **模型配置**：用户在设置里走 pi 的 provider 配置（API key 或 `/login` 等价流程）；应用不重复造模型管理层。

## 6. 发布链

流程：`选内容+平台 → 变体确认（本地规则校验先行）→ 草稿注入 → 人工在平台编辑器点发布 → 状态回读`。

- **公众号**拆两个子适配器：
  - `wechat:article`（文章形态）：官方 API 草稿箱——用户配置 appid/secret（存系统凭证库，不进文件/DB），上传图片素材、创建草稿，停在草稿态；正式群发由用户在公众号后台操作。
  - `wechat:imagetext`（图文形态，小绿书式）：与知乎/小红书同一套内嵌浏览器机制，在 mp.weixin.qq.com 后台图文编辑页注入（图片+短文案），停在草稿态。其变体文案与小红书变体同基因，一稿多态可相互复用初稿。
- **知乎 / 小红书 / X / 即刻**：每平台独立 `WebContentsView` + `persist:<platform>` partition 打开该平台真实编辑器页；注入脚本按适配器填写标题/正文/配图/话题；**停在可编辑草稿状态**。v1 的 X 指动态（Post，280 计数）；X Articles 长文模式不在 v1。
- **适配器接口**：`PlatformAdapter { loginCheck(); injectDraft(payload); readBackStatus(); platformRules }`。每平台一实现；UA/窗口特征与常规浏览器一致；平台间限速串行注入。
- **状态回读**：适配器检测发布成功信号（如发布后 URL/跳转），写入 `publishes`；失败分类三类——未登录（引导去登录页）、页面结构变更（明确报"适配器需更新"，绝不静默失败）、网络（可重试）。单平台失败不影响其他平台，可单独重试。
- **风控边界**（WeSight 实践验证）：只注入草稿、不点平台发布按钮、不调平台内部接口、不批量并发、注入前检查已有未发布内容避免覆盖。
- **v1 分批**：P1 公众号文章（API）+ 小红书（价值最高/难度可控）→ P2 知乎 + 公众号图文（同为后台 DOM 注入，工程同族）→ P3 X + 即刻。全部属 v1 范围，按里程碑交付。

## 7. 运营域

- **灵感库**：全局快捷键速记浮窗；标签、分级；确认 → 自动创建内容文件夹（标题进 frontmatter）。
- **管线看板**：内容按 `idea → draft → review → variants → publishing → published → retro` 流转的看板视图（DSH-Creator 管线思想）；stage 变更是显式动作并记录。
- **档期**：内容×平台计划日期；发布中心显示今日待发。
- **目标与数据回流**：阶段目标（goals）；核心数据（阅读/点赞/涨粉）**手动录入**，录入界面按平台×日期表格化。
- **复盘**：单内容复盘 + 阶段复盘；agent 辅助分析（retros+数据 → 洞察建议，输出标注"假设"）；知识沉淀导出为内容库 MD，下次创作可被 agent 引用。

## 8. 错误处理

- 文件系统：库路径不存在/被占用/无权限 → 明确提示与修复引导；写文件采用"写临时文件+原子改名"。
- SQLite：单进程访问 + WAL；损坏时内容无损（内容在文件），引导重建过程库。
- 适配器：三分类失败（§6）；DOM 结构指纹校验，不匹配即报"适配器需更新"。
- agent：产出只进草稿区，异常不污染正文；会话崩溃可从 JSONL 恢复；长任务可取消。
- 应用级：主进程异常监控与渲染进程崩溃自动恢复；未捕获错误进本地日志（`.studio/logs/`）。

## 9. 测试策略

- **单元（vitest）**：领域服务（内容库解析、frontmatter、档期逻辑）、平台规则（X 计数、小红书字数）。
- **集成**：内容库文件操作、SQLite 迁移、pi 工具注册与调用（合成会话）。
- **适配器**：DOM fixture 回放测试（保存真实页面结构快照）；**真实平台行为=人工验收清单**，文档化记录，不伪造自动化通过。
- **e2e**：Playwright for Electron 走主流程（建内容→编辑→变体→发布任务）。
- **CI**：GitHub Actions——typecheck + vitest + build + 打包冒烟；发布产物附验收记录文档（继承 DSH-Creator 验收文化）。

## 10. 技术栈与里程碑

**栈**：Electron + Node 22 + React + TypeScript + Electron Forge（打包）+ better-sqlite3 + `@earendil-works/pi-coding-agent`（版本锁定）+ vitest + Playwright。UI 编辑器组件选型在 M1 实施时定（CodeMirror 系为默认候选）。

| 里程碑 | 交付 | 验收标志 |
|---|---|---|
| M1 | 应用壳、内容库（文件夹+frontmatter+看板）、MD 编辑器 | 能建/写/管内容，库可迁移 |
| M2 | pi 集成、领域工具、创作流（草稿区/确认落盘/ask_user） | agent 按技能产出并被人工确认入正文 |
| M3 | 一稿多态变体工作台 + 公众号文章（API）+ 小红书适配器 | 一条长文 → 小红书动态进真实编辑器草稿；公众号文章进草稿箱 |
| M4 | 知乎 + 公众号图文 + X/即刻适配器 + 运营台完整（灵感/档期/目标/复盘） | 六个子适配器全通 + 复盘知识回流 |
| 二期 | 视频制作链（media 字段已预留） | 另立 spec |

## 11. 开放决策与风险登记

| # | 风险/决策 | 处置 |
|---|---|---|
| R1 | 平台改版导致 DOM 适配器失效（WeSight 同样问题） | 结构指纹+明确报错+适配器可热修；验收记录文化 |
| R2 | pi 迭代快，SDK 面可能变化 | 版本锁定；升级走显式回归 |
| R3 | 内容库放网盘同步目录致 SQLite 损坏 | 配置时检测+警告；文档明示 |
| R4 | Electron 安装包体积/内存 | 接受（方案比选已决策）；后续可评估裁剪 |
| R5 | 平台风控（登录态异常/注入检测） | 只注入草稿+限速+人工发布；不做任何接口调用 |
| D1 | 产品名（当前用工作代号 ContentDeck） | 发布前定名，改动成本一行 |
| D2 | 公众号 API 需要用户自备 appid/secret 且有白名单域名要求 | M3 实施时验证实际约束，文档明示配置前提 |

## 12. 参考项目致谢

- [earendil-works/pi](https://github.com/earendil-works/pi)（MIT）：agent 运行时。
- WeSight（wesight-obsidian / wesight-chrome）：纯文件内容模型、一稿多态参数、浏览器会话发布模式与风控边界的实践参照（本地源码研读，未复制代码）。
- DSH-Creator（Jacky Creator，MIT）：管线运营方法论与验收记录文化参照（本地源码研读，未复制代码）。
- 旧 content-studio（本项目前身，2026-10-24 重置）：领域纪律与工程教训（存于本地备份分支）。

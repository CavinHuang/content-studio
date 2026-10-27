# P3/P4/P5 历史资产参考包

从重置前的旧 git 历史提取的可移植资产，服务 P3（热点信息源）、P4（发布适配）、P5（视频渲染）阶段的移植参考。**全部为只读参考件，不参与当前构建**；提取的代码每件顶部有来源注释（提交哈希＋原路径＋提取方式）。

## 当前工作树事实（2026-10-27 核对）

- **当前分支**：`feat/real-foundation`（`git branch --show-current` 实测）。本包只新增 `docs/superpowers/ref/`，不动任何产品代码。
- **并发不可触碰**：`docs/ux/research/` 下有**并发会话的 23 个未提交改动**（`git status --porcelain` 实测，全为该目录内 M 状态文件）。任何提交**严禁 `git add -A/-u`**，只允许加本次具体路径；该目录本身绝不能修改。
- **pnpm-workspace allowBuilds 裁决机制**：当前仓库为 pnpm workspace（`packages: [packages/*]`，nodeLinker hoisted）。新增依赖若 pnpm 提示 ignored build scripts，必须在 `pnpm-workspace.yaml` 的 `allowBuilds:` 块里**显式裁决 true/false 后重装**，不许绕过。现行裁决（`pnpm-workspace.yaml` 实测）：`electron: true`、`esbuild: true`、`'@swc/core': true`、`electron-winstaller: false`、`'@google/genai': false`、`protobufjs: false`。

## 纪要（从 0929d66 M3 计划 3090 行与 63d3433 旧总规格提炼）

| 文件 | 内容 |
|---|---|
| [memo-wechat-api-and-typeset.md](./memo-wechat-api-and-typeset.md) | 公众号 API 2026-10 实测形状（stable_token／素材接口字段／draft/add 限制／40001 单次强刷／IP 白名单前提／零依赖 multipart）＋ 微信排版转换链设计要点（内联主题／外链脚注／CJK 间距／校验器／管道顺序／AGPL 借鉴边界） |
| [memo-xiaohongshu-and-publish.md](./memo-xiaohongshu-and-publish.md) | 小红书注入铁律（自包含／防覆盖／绝不点发布／fixture 断言发布按钮点击数=0／jsdom 探针）＋ WebContentsView 会话要点（partition／白名单／UA／Playwright 盲区）＋ 发布重试三分类与限速参数（15s 串行链／相位机／人机边界／凭证最小信任） |

## 资产清单（code/）

| # | 现路径 | 来源提交 | 原路径 | 说明与移植注意点 |
|---|---|---|---|---|
| 1 | [code/19f5778-wechat-mp.ts](./code/19f5778-wechat-mp.ts) | `19f5778` | `src/main/publish/wechat-mp.ts` | 公众号 API 客户端：stable_token 缓存（到期前 5 分钟提前刷新）、`add_material`/`uploadimg`/`draft/add` 三接口、token 错误码 40001/40014/41001/42001 **单次**强刷重试、fetch/now 全注入式（单测不联网）。移植注意：错误码集合与「单次」语义勿放宽成循环重试；`withToken` 的 `?`/`&` 拼接是官方形状。 |
| 2 | [code/19f5778-markdown-to-wechat-html.ts](./code/19f5778-markdown-to-wechat-html.ts) | `19f5778` | `src/main/publish/markdown-to-wechat-html.ts` | 极小 md→公众号正文 HTML 转换器（服务 draft/add API 链）：转义在前、不产 JS；`replaceLocalImages` 把正文本地图片逐个经 uploadimg 换微信 URL；`safeJoin` 路径越界防护。移植注意：与 #8 主题化排版引擎是两条互补路径——API 链求「干净无 JS」，预览链求「主题好看」，勿混用。 |
| 3 | [code/19f5778-wechat-credentials.ts](./code/19f5778-wechat-credentials.ts) | `19f5778` | `src/main/publish/wechat-credentials.ts` | safeStorage 凭证模块：加密优先＋`plain:` 前缀明文回退（视图标记 encrypted:false）、`KEEP_WECHAT_SECRET` 占位沿用旧值、脱敏视图只出尾四位、解密失败视同未配置。移植注意：依赖当时的 `../settings` 与 `shared/types`，需替换为当前等价物；`plain:` 分流必须放在 safeStorage 解密**之前**（其对垃圾输入行为不定）。 |
| 4 | [code/cc0f351-inject-script-xiaohongshu.ts](./code/cc0f351-inject-script-xiaohongshu.ts) | `cc0f351` | `src/main/publish/inject-script-xiaohongshu.ts` | 小红书自包含注入脚本：loginCheck/inject/readBack 三种负载；多级选择器降级、防覆盖拒绝、粘贴守卫＋textContent 回退、标题 20 字截断。移植注意：**自包含铁律**——不得引入任何模块级引用（要 toString 序列化执行）；绝不点发布按钮是代码路径级约束；选择器需按真实平台现状重新人工验收。 |
| 5 | [code/cc0f351-platform-session.ts](./code/cc0f351-platform-session.ts) | `cc0f351` | `src/main/publish/platform-session.ts` | WebContentsView 平台会话：`persist:<platform>` partition 登录态、URL 白名单校验、UA 常规化（剥离 Electron/应用名 token）、attach 右半屏/零尺寸隐藏、evaluate 90s 超时。移植注意：Electron 45 实证有 WebContentsView；Playwright 无法窥视其内容（纪要二探针 #1），e2e 断言要走 UI 状态＋fixture 请求日志。 |
| 6 | [code/cc0f351-adapter.ts](./code/cc0f351-adapter.ts) | `cc0f351` | `src/main/publish/adapter.ts` | 双适配器（任务清单未点名、同提交补充收录）：`PlatformAdapter` 接口（loginCheck/injectDraft/readBackStatus/rules/usesSession）、`classifyFailure` 失败映射、小红书 DOM 适配器与公众号 API 适配器实现。移植注意：dom/api 双模式经 `usesSession` 分流，api 平台误用 driver 即报错；封面必须走 `add_material`（永久素材）而非 uploadimg。 |
| 7 | [code/edf225b-publish-service.ts](./code/edf225b-publish-service.ts) | `edf225b` | `src/main/publish/publish-service.ts` | PublishService 发布编排：全局串行互斥链（链不断）＋相邻最小间隔 15s（env `CONTENTDECK_PUBLISH_MIN_INTERVAL_MS`）、相位机 queued→…→prepared 停在草稿态、失败分类映射、事件外发、retry 仅 failed。移植注意：任务态在内存（当时明确不做 SQLite 持久化，见纪要二「M3 明确不做」）；`createTask` 只建任务不注入是人机边界。 |
| 8 | [code/edf225b-domain-tools.ts](./code/edf225b-domain-tools.ts) | `edf225b` | `src/main/agent/domain-tools.ts` | pi agent 领域工具全集，重点是 `create_publish_task`（只建任务、失败如实 isError 绝不谎报「已创建」）。移植注意：pi 的 `defineTool`/TypeBox 形状属当时 SDK，当前 Agent 体系若已更换，只借鉴**工具语义与人机边界**，勿照搬 API；ask_user 的 abort 处理模式可参考。 |
| 9 | [code/e7767d6-wechat-typeset.mjs](./code/e7767d6-wechat-typeset.mjs) | `e7767d6` | `src/wechat-typeset.mjs` | 微信排版引擎：3 套内联主题（语义 token 集）、外链转脚注、CJK 间距（code/pre 豁免）、句读移出加粗、发布前校验器（script/style/iframe/外链图片）。移植注意：AGPL 边界——架构借鉴 wewrite（MIT）与 Easel gzh-design（仅思路），实现须保持原创；管道顺序固定（纪要一）。 |
| 10 | [code/e7767d6-hotlist-sources.mjs](./code/e7767d6-hotlist-sources.mjs) | `e7767d6` | `src/hotlist-sources.mjs` | 分钟级热榜信源适配（任务清单未点名、与 P3 直接相关的同提交补充收录）：白名单＋同源同路径精确端点匹配＋形状校验失败即抛错，**绝不伪造条目**。移植注意：白名单纪律借鉴 Easel hotlist-apis（Apache-2.0，仅规则）；「解析失败如实报错」是 P3 信源接入的底线行为。 |
| 11 | [code/ci-old.yml](./code/ci-old.yml) | `8c90905^`（保全重置基线的父提交） | `.github/workflows/ci.yml` | 旧 CI 配置：xvfb 跑 Electron e2e 的模式（`xvfb-run -a npm run e2e`＋Chromium 沙箱预案注释）。移植注意：它用 **npm**（npm ci/cache: npm），当前仓库已切 **pnpm workspace**——恢复 CI 时需换 pnpm 动作与缓存键并遵守 allowBuilds 裁决；「仅 CI 容器可关沙箱、本地与发布产物绝不关」的边界要保留。 |

## 提取与校验方式

- 提取：`git show <commit>:<path>` 读出后写入本目录，仅在顶部加来源注释块，**正文逐字节未改动**。
- 校验（2026-10-27 实测跑过）：对全部 11 件做了脚本化 diff——头注释行全为注释行、去掉头注释后与 `git show` 原件 diff 为空，11/11 OK。
- 历史 absence 说明：P5（视频渲染）在旧历史中**没有可提取的代码资产**——旧总规格 §2 明确「视频制作链为二期」，数据模型仅预留 `media: article | video` 字段；本包对 P5 只提供 CI-e2e 模式（#11）与发布编排边界（#7）等周边参考。

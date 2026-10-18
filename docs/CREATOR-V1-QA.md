# V1 业务开发验收表

日期：2026-10-17（北京时间，含本轮续作复核）。本报告覆盖新产品业务重构；此前设计讨论记录和首个编辑器切片报告保留为阶段历史。

## 开发项

| 开发项 | 交付 | 主要验证 |
| --- | --- | --- |
| 五项产品导航 | 首页、选题、创作、资产库、设置 | 真实 Chromium 页面流程 |
| 作者基础与隔离 | 注册、登录、退出、会话、独立作者 SQLite、所有新旧 API 归属 | 两作者列表 / ID / 图片预览 / 素材 / 任务 / 搜索 / 服务隔离负例 |
| 旧库迁移 | 指定作者空空间导入、WAL 备份与 manifest、逐行与 BLOB 比对、凭据重新加密 | 真正临时 SQLite、旧库保持原样、拒绝覆盖已有作者库 |
| 服务与额度 | 加密 BYOK 连接、每作者 / 用途选择、请求预留、未知费用保留与人工结算 | 重开数据库、并发 AsyncLocalStorage 隔离、额度 / 响应边界负例 |
| 作者画像 | 显式偏好、文章 / 平台覆盖、版本、暂停学习、证据、建议修订采纳 / 拒绝 / 移出列表 / 恢复 | 未确认不应用、保留原模型建议与作者修订、并发版本冲突、后台学习固定文章修订与哈希 |
| 选题 | 完整简报与历史、明确选择推荐素材、AI 推荐 / 讨论、版本绑定采纳、收藏 / 暂不创作及原因、开始写作 | 讨论不覆盖简报、旧建议不能覆盖新简报、未选素材不入推荐、开始幂等、引用来源跟随文章 |
| 公开与私有素材 | 笔记、公开链接、RSS / Atom、文本文件、图片 | 公网 DNS 全地址校验、TLS 固定解析、限时 / 限量与禁止跳转 |
| doocs/md 协同写作 | 真实编辑 / 预览模块、主题、AI 全篇 / 选区建议、讨论、自动保存 / 冲突恢复、发送上下文审阅 | 原编辑器 8 项浏览器场景、复杂 Markdown、不可变修订 |
| 逐项建议与生成恢复 | 同批多处接受 / 重映射，流式独立预览、停止、未完成历史与重新授权 | 手动编辑失效、断流 / 截断、取消迟到结果、切换文章及重启保持 |
| 任务模型与限额 | 入队绑定连接及配置、单次尝试 1 次请求、明确重绑定 | 默认切换不漂移、旧 / 变更连接拒绝、结算不恢复任务额度 |
| 来源撤销 | 影响预览及范围令牌、字段来源追溯、安全回退、历史脱敏 | 关联变化须重新预览、事务回滚、并发移除、保留独立显式偏好 |
| 发布账号偏好 | 账号定位及七项版本偏好、创作时明确选择、四层覆盖 | 设置与写作上下文浏览器流程、账号版本与归属负例 |
| 文章配图 | 全文 / 指定段落规划、费用确认、候选、插入、资产复用 | 既有配图 / 图片审计 / 预算 / 队列测试持续通过 |
| 独立平台稿 | 公众号、知乎、小红书与主稿互不覆盖 | source / expectedRevision / 四项核查 / 三方差异选择合并 / 旧写入接口保护 |
| 小红书 Agent 成品 | 改编文案、实际 PNG、选配视觉服务、自然语言单页 / 拆页 / 整组风格、排序、历史恢复、下载 | PNG 解码及尺寸、文字边界、未选页哈希保持、当前图组修订核查 |
| 发布与交付 | 账号、HTML / Markdown / 图片包、发布链接与事实记录 | 导出不产生已发表事实，作者报告有独立证据类型 |
| 公众号草稿适配器 | 固定官方 host、token / 媒体加密与隔离、草稿请求、幂等、未知结果核对 | 合成协议测试覆盖重复点击、媒体准备中稿件变更、发送超时；真实账号待验 |
| 内容系列 | 目标、时区 / 节奏、篇目、暂停 / 恢复 / 结束、服务端下一篇准备、快照、通知、中断核对 / 显式重试 | 关闭页面仍执行、重启去重、过期租约、取消后迟到结果不可写入、重试须重新授权 |
| 资产与复盘 | 文章 / 图片 / 素材统一检索、系列 / 平台 / 日期筛选、标签、归档、复用、发布事实、人工指标 | 中文 FTS / 短词检索、历史引用版本固定、归档保留已有引用 |
| 原运行与恢复门禁 | Node / SQLite 单进程、localhost、构建封存、锁文件、备份恢复 / 运维门禁 | 原 V45–V75 测试保留；FTS WITHOUT ROWID 表按主键完整核验 |

## 自动验证

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 通过 |
| `npm test`（umask 022） | 522 项：521 通过、1 环境跳过、0 失败 |
| `npm run build` | Next.js 16.4.0 Webpack 生产构建与 V64 / V65 封存通过 |
| `npm run test:production` | 1 项通过，真实生产进程重启与历史数据保存 |
| `npm run test:creator:production` | 1 项通过，实际作者会话、图片 BLOB、加密连接、任务、差异审阅、账号偏好、来源撤销和未完成生成重启保持 |
| `npm run test:staging:v57` | 2 项通过，真实旧版备份恢复 / 迁移 / 重启与篡改拒绝 |
| `npm run test:doocs:real` | 上一轮 2026-10-17 的 2 项通过；本轮没有修改独立 doocs 交接，未重复运行此项 |
| `npm run test:e2e` | 34 项全部通过，含八个作者流程、13 项写作场景和原 13 项业务场景 |
| `git diff --check` / 锁文件 / vendored 文件哈希 | 通过：32 个 vendored 文件哈希匹配，无 diff 空白错误、无新增文档断链 |

当前唯一单元测试跳过项为原 V69 `sudo -u nobody` 在本机器不可用；没有删除此检查。Docker / Dokploy 的真实镜像构建与真实主机上线验收不是本轮本地开发测试：Dockerfile 仍要求完整清洁 Git 提交，本轮工作树未提交，未绕过这个门禁。

生产构建改用 Webpack，因为 Turbopack 给 sharp / sanitize-html 生成 `.next/node_modules` 软链接，会被现有 V64 拒绝。保留拒绝规则。FTS5 暴露原备份代码的 WITHOUT ROWID 检测转义问题，现已修正并新增含 BLOB 主键的篡改负例，没有排除表来使测试变绿。

## 场景与实际边界

新增浏览器使用真正的 Next 生产服务、作者登录、SQLite、doocs 编辑器、sharp PNG 及实际 ZIP 下载；只替换外部 LLM 回包。覆盖画像设置 → 素材笔记 → 选题讨论 / 采纳 → 初稿 / 审阅 → 小红书 PNG / 单页重做 / 检查 / 下载 → 资产记录；另有离开页面后准备系列、第二作者越权负例、画像确认 / 撤销和 BYOK 配置场景。

公众号单元测试使用合成官方协议回包。没有配置真实付费模型、图片服务或公众号凭据，没有发送真实平台文章。当前缺少实际账号，且官方文档入口此前被环境代理返回 403；实际接口权限、现行参数限制、IP 白名单、模型效果和真实草稿回执仍需后续外部验收。知乎 / 小红书当前实现复制、文件 / 图文交付和发布回填，没有伪造官方自动发布成功。

真实 doocs 容器使用摘要 `sha256:b63c1e83fa8eec776d6b90a8862bca135eeb5588579079c405deb7c97202bfdd`。所有测试使用临时合成数据；未自动认领或导入旧库到作者账号；本地原工作空间继续使用增量建表。未提交、合并、远程部署或真实发布。

最新日志在当前环境 `/tmp/content-studio-remaining-*-sealed.log`，历史轮次日志见下文。操作说明见 [CREATOR-V1.md](CREATOR-V1.md)。

## 2026-10-16 阶段收尾记录

最终日志：`/tmp/content-studio-v1-check.log`、`all-tests-accepted-final.log`、`build-accepted-final.log`、`e2e-accepted.log`、`production-accepted.log`、`author-restart-accepted.log`、`staging-accepted.log`、`doocs-accepted.log`（后七项均加 `/tmp/content-studio-v1-` 前缀）。2026-10-16 阶段浏览器 24/24，通过的生产 / 作者重启和旧库恢复使用同一最终封存构建。

本地实际服务 `http://127.0.0.1:4312` 已更新为新界面，保持默认本地工作空间。五个主页面 HTTP 200、导航 5 项、390px 无横向溢出，未观察到页面异常。独立作者账号通过专用实际生产服务与合成账号验证；启用方式见运行文档。


## 2026-10-17 续作与最终复核

本轮对照产品设计补齐了以下实际缺口：

- 简报补全核心问题、核心观点、证据缺口和目标平台；修改、恢复与讨论采纳均保留版本，收藏 / 暂不创作可记录原因。
- 推荐入口明确勾选可发送的私有素材，默认不发送其正文；画像、历史标题、系列、反馈和公开信源元信息也在授权文案中说明。模型返回批次先完整校验再保存，防止半批写入。
- 创作上下文使用独立共享版本检测，旧页面保存返回 409 并保留本地选择。写作建议额外绑定简报、画像及上下文版本，旧建议不能覆盖新偏好。
- 系列任务固定入队时的来源快照，后台画像学习固定文章修订；过期 / 取消任务不能写入迟到结果。失败或结果未知的任务提供核对依据、取消和显式重试入口，保留原记录，并重新确认模型请求费用。
- 作者可修订风格建议后再采纳，原建议和来源证据不变；移出建议不删除已应用画像。一个作者空间打开失败不会阻止其他作者的后台任务。
- 资产库新增系列、关联平台、北京时间创建日期筛选，文章初始参考素材及小红书图片使用关系也纳入筛选。关联平台不代表已发表。

新增 `test/creator-followup.test.mjs` 14 项全部通过，并加入三个真实浏览器场景：完整简报 / 仅选定素材推荐 / 上下文冲突恢复、风格修订采纳与证据保留、系列失败后的核对 / 费用授权 / 新尝试。首次浏览器运行有一项测试未展开折叠侧栏，已修正测试操作；最终完整 27 项全部通过，未放宽断言或删除失败检查。

本轮最终日志（均在当前环境）：

| 检查 | 日志 |
| --- | --- |
| 语法检查 | `/tmp/content-studio-followup-check.log` |
| 全量单元 / 集成 489 项 | `/tmp/content-studio-followup-all-tests.log` |
| 生产构建与封存 | `/tmp/content-studio-followup-build-final.log` |
| 完整 Chromium 27 项 | `/tmp/content-studio-followup-e2e-final.log` |
| 生产进程重启 1 项 | `/tmp/content-studio-followup-production.log` |
| 作者进程重启 1 项 | `/tmp/content-studio-followup-author-restart.log` |
| 旧库恢复 / 篡改拒绝 2 项 | `/tmp/content-studio-followup-staging.log` |
| 真实 doocs Docker 2 项 | `/tmp/content-studio-followup-doocs.log` |
| 保持运行的本地服务 | `/tmp/content-studio-followup-live.log` |

以上运行回归均使用本轮同一封存构建。本地服务的健康接口与最终构建摘要一致，五个主页面 HTTP 200，390px 导航保持 5 项且无横向溢出、无页面异常。doocs 测试容器已清理。32 个 vendored 文件哈希、依赖锁文件及 `git diff --check` 通过。

可复用的环境 `start_skill` 已保存到配置草稿，补充现有 Chromium、Noto CJK、隔离测试端口、作者重启检查和受保护的旧库处理说明；未改网络或凭据要求。保存草稿不代表环境配置已经发布，也未验证新任务还原。

真实模型 / 图片 / 公众号账号验收仍未完成，外部边界同上。本轮未提交、推送、合并或部署，未执行付费请求或真实平台发布。


## 2026-10-17 计划表续作：主稿差异与请求上下文

在既有完整简报、任务核对和画像修订之后，继续完成计划表中“主稿更新提示差异，由作者决定同步”及“展示本次使用的画像、素材和个人资产”两项。

| 开发项 | 最终行为 |
| --- | --- |
| 主稿与平台稿三方比较 | 读取上次已审阅主稿、当前平台稿和最新主稿；保留原始 Markdown、换行与 Unicode 定位 |
| 逐项合入 / 保留 | 无重叠修改可选；重叠修改须明确保留平台表达，再手工调整；已经包含的修改不重复插入 |
| 来源及版本绑定 | 审阅绑定项目渠道、平台修订、主稿修订和来源修订；任一变化返回 409，不能伪造或跨渠道复用审阅 |
| 一致持久化 | 新 Markdown、来源主稿版本、检查失效和逐项选择记录同事务；版本历史展示来源与数量 |
| 请求上下文展示 | 展示画像 / 简报 / 上下文版本、有效领域 / 目标 / 写作与视觉偏好、所选素材、排除数量和原始信源 |
| 发送前核对 | 页面审阅过的上下文变化时，在模型请求及额度预留之前拒绝；刷新后重新授权 |
| 固定生成证据 | 来源名称 / 历史文章修订及有效偏好随建议保存，后续修改不回写历史证据；建议和证据同事务 |
| 助手栏滚动 | 保持上下文详情展开，也能滚动到费用授权和生成控件；桌面与手机布局继续验证 |

新增 `test/writing-master-sync.test.mjs` 12 项，包含 180 组合成文本往返、CRLF / emoji / 重复行、大段保守对比、插入删除、平台定制保留、旧版本与跨作者负例、事务故障回滚和被排除素材不发送。新增两个真实浏览器场景：合并 / 冲突保留 / 并发写入保护；上下文展示 / 发送前拒绝 / 刷新后重新确认 / 生成证据复核。首次浏览器暴露上下文展开后授权控件被挤出可操作区域，已修正助手栏滚动；最终没有强制点击、隐藏详情或放宽断言。

该阶段同一封存构建的结果：`check` 与生产构建通过；全量 501 项中 500 通过、原 V69 1 项环境跳过、0 失败；Chromium 29/29；生产重启 1/1、作者服务重启 1/1、旧库恢复 2/2。作者重启检查已实际写入并恢复合并后的平台稿、来源版本和逐项审阅记录。32 个 vendored 哈希、依赖锁和 `git diff --check` 通过。本轮未改独立 doocs/md 交接或图片映射，其 Docker 实测保留上一轮结果，不混称本次封存构建的实测。

最终日志：

- `/tmp/content-studio-sync-check-accepted.log`
- `/tmp/content-studio-sync-all-tests-accepted.log`
- `/tmp/content-studio-sync-build-accepted.log`
- `/tmp/content-studio-sync-e2e-accepted.log`
- `/tmp/content-studio-sync-production-accepted.log`
- `/tmp/content-studio-sync-author-restart-accepted.log`
- `/tmp/content-studio-sync-staging-accepted.log`
- `/tmp/content-studio-sync-local-verification.log`
- `/tmp/content-studio-sync-live-accepted.log`

本地服务已切换到该构建；健康接口摘要与构建封存一致，五个主页面 HTTP 200，390px 导航 5 项、无横向溢出及页面异常。未改变旧库归属或导入作者账号。

当前工作空间只读检查结果：文字 / 图片服务可用性均为 false，已保存服务连接与平台账号均为 0；当前云环境没有已配置的凭据绑定。因此真实模型输出质量、配图效果、公众号权限及实际回执仍为外部阻塞。未发起真实付费请求、文章发布、代码提交、推送、合并或远程部署。

## 2026-10-17 剩余五项：最终验收

完成任务模型绑定与单次请求限额、多处写作建议逐项接受、流式生成与未完成恢复、来源移除后的画像撤销 / 历史脱敏、账号定位与风格覆盖。开发表见 [PRODUCT-IMPLEMENTATION-PLAN.md](PRODUCT-IMPLEMENTATION-PLAN.md)，操作及保留范围见 [CREATOR-V1.md](CREATOR-V1.md)。

新增 `test/creator-remaining.test.mjs` 21 项通过，覆盖连接轮换、显式重绑定、费用结算不恢复任务请求额度、同批范围重映射 / Unicode 边界、NDJSON 流式分片 / 截断（浏览器侧传输为 NDJSON，SSE 仅用于服务端消费上游模型）、取消 / 进程恢复、移除来源期间的迟到结果、字段来源迁移及事务回滚、预览后依赖变化和账号版本隔离。新增五个浏览器场景覆盖账号偏好、来源影响预览与撤销、多处逐项接受、断流恢复重新授权、停止及生成期间切稿。

复核发现并修复移除来源的 HTTP 410 被通用 API 转为 500、历史字段来源迁移不完整、预览后依赖增加仍可使用旧确认、生成期间切稿后的忙碌状态，以及移出列表的旧建议重新出现问题。保留相应断言；没有通过放宽检查获得通过。

最终同一封存构建结果：静态检查、生产构建通过；522 项全量测试中 521 通过、原 V69 1 项环境跳过、0 失败；Chromium 34/34；生产重启 1/1、作者服务重启 1/1、旧库恢复 2/2。作者重启验收扩展至未完成生成部分文字、账号偏好和来源撤销，使用本地合成 HTTP 模型及临时作者数据库。未运行真实付费调用。

| 检查 | 最终日志 |
| --- | --- |
| 语法检查 | `/tmp/content-studio-remaining-check-sealed.log` |
| 全量 522 项 | `/tmp/content-studio-remaining-all-tests-sealed.log` |
| 生产构建及封存 | `/tmp/content-studio-remaining-build-sealed.log` |
| Chromium 34 项 | `/tmp/content-studio-remaining-e2e-sealed.log` |
| 生产重启 | `/tmp/content-studio-remaining-production-sealed.log` |
| 作者服务重启 | `/tmp/content-studio-remaining-author-restart-sealed.log` |
| 旧库恢复及篡改拒绝 | `/tmp/content-studio-remaining-staging-sealed.log` |
| 本地健康 / 手机页面 / 哈希 / 文档链接 | `/tmp/content-studio-remaining-local-sealed.log` |
| 持续运行的本地服务 | `/tmp/content-studio-remaining-live-sealed.log` |

本地 `127.0.0.1:4312` 已更新为这份构建，健康摘要与 V64 / V65 封存一致。五个主页面均 HTTP 200，390px 下导航 5 项、无横向溢出或页面异常。32 个 vendored 文件哈希、依赖锁、文档本地链接与 `git diff --check` 通过。未改独立 doocs 交接或渠道图片映射，其真实 Docker 验收保留先前结果，本轮未重跑。

来源移除是当前来源清理及推断撤销，保留不可变文章历史、数据库空闲页和既有备份，不是安全擦除。后台任务及写作生成每次尝试上限为 1 次模型请求，失败或结算不恢复额度；新尝试必须重新授权，金额仍以提供商账单为准。

当前文字 / 图片可用性仍为 false，保存的服务连接与平台账号为 0。真实模型与图片质量、公众号现行权限及草稿回执仍待外部联调；知乎 / 小红书按交付包与人工回填实现。独立 Docker / Dokploy 部署及实际主机运维验收未执行。本轮未提交、推送、合并、部署或真实发布。

### 本地 Git 提交复核

上述“未提交”为开发验收时的状态；后续收到作者明确的提交指令。提交前对全部 133 个变更文件（包含此前未跟踪文件）检查敏感路径及密钥格式，未发现真实凭据、数据库或二进制资产。暂存空白检查发现 vendored `footnotes.ts` 两处尾随空格，已清理并同步该文件的 `vendoredSha256`，保留上游来源哈希；32 个文件校验通过。提交不包含外部平台草稿自动化的新实现，知乎 / 小红书接入仍为待验证项。

提交复核的检查日志使用 `/tmp/content-studio-commit-` 前缀，覆盖语法、全量测试、提交绑定构建及运行恢复。代码仅提交至本地 Git，未推送或部署。

## 2026-10-17 文档对齐与平台文档调查（Windows 本机复核轮）

本轮无任何业务代码改动，仅文档与 Git 工作区卫生：

- **大小写重复条目修复**：发现仓库树同时含 `docs/QA-REPORT.md`（V22 内容）与 `docs/qa-report.md`（V23 内容）两个条目（main 与 work 均有）。在大小写不敏感文件系统（Windows）上两者只能对应同一物理文件，导致 `git status` 永远显示其一为已修改的伪状态，并会干扰 V63 干净检出检查。已 `git rm --cached docs/qa-report.md` 移除小写重复（保留与 QA-REPORT-V24…V27 命名一致的大写规范文件）；V23 报告内容仍在历史 blob `348cb81` 中可查。全仓库无任何对两个文件名的引用，删除无副作用。
- **流式传输措辞修正**：浏览器侧实际为 NDJSON 分片（`application/x-ndjson`，`src/writing.mjs`）；SSE 仅用于服务端消费上游模型（`src/writing-stream.mjs`）。已修正 `PRODUCT-IMPLEMENTATION-PLAN.md` 与本文档中的"SSE 分片"表述，不改变任何实现。
- **平台官方文档调查**：新增 [PLATFORM-API-SURVEY.md](PLATFORM-API-SURVEY.md)。公众号官方文档在本环境可直读（此前云环境为代理 403）：已记录 access_token 2 小时生命周期、草稿箱 `draft/add` 字段与正文/封面媒体限制、`media/uploadimg` 分工、freepublish 发布接口自 2025-07 起对个人主体/未认证企业账号回收权限等文档事实；`open.xiaohongshu.com` 可达但为电商开放平台入口；`open.zhihu.com` 仍不可读。**仅为公开文档阅读，未注册账号、未获取凭据、未调用平台接口，不构成真实平台验收。**
- **遗留服务器确认**：`src/server.mjs`（`legacy:dev`、5 个旧 API 测试使用）默认显式绑定 `127.0.0.1` 且拒绝非同源写请求，符合"默认 localhost"设计；未改动，仅记录。它不含作者隔离，不得用于多用户或生产启动。

本机（Windows / Node 24.1.0 / npm 11.3.0）复核结果：`npm run check` 通过；`npm test` 522 项 = 434 通过 / 85 失败 / 3 跳过——85 个失败逐项归类后 100% 为 POSIX/Linux 环境门槛（0600/0700 权限检查约 60 项、Noto CJK 字体路径 6 项、Docker 独立挂载与非 root 身份、临时目录 EPERM/EBUSY），零业务逻辑失败；全量绿灯仍以此前 Linux QA 环境为准（521/522、1 环境跳过）。`npm run build` 通过（Webpack + V64/V65 封存）。小红书出图与浏览器 e2e 依赖 Linux 字体路径，本机未重跑。本轮未提交、推送、合并或部署。

## 2026-10-17 Agent 运行时实施验收（AGENT-V1）

本轮按 [AGENT-V1.md](AGENT-V1.md) 与实施计划 [AGENT-V1-PLAN.md](AGENT-V1-PLAN.md) 完成 A1–A5：agent 运行时、内置技能、工具注册表、路由与事件流、UI 运行视图和文档同步。"agent run 多步循环、v1 不设请求数上限"的规则变更已同步 [PRODUCT-V1.md](PRODUCT-V1.md)、[CREATOR-V1.md](CREATOR-V1.md) 与 [WRITING-WORKSPACE.md](WRITING-WORKSPACE.md)，未静默修改。

| 开发项 | 交付 | 主要验证 |
| --- | --- | --- |
| 运行时 | `src/agent-runtime.mjs`：agent_profiles / agent_runs / agent_run_steps 三表、默认代理增量补建、多步循环与终止常量、不可变轨迹、取消 / 进程重启转待核对 / 基准修订漂移中断 | `test/agent-runtime.test.mjs` 10 项 |
| 工具 | `src/agent-tools.mjs` 注册表；`src/creator-services.mjs` chatWithTools（fetchImpl 注入、每次调用逐笔用量记账） | `test/agent-tools.test.mjs` 2 项、`test/agent-chat-tools.test.mjs` 4 项 |
| 技能 | `src/agent-skills.mjs` 内置技能常量，加载时与代理工具白名单求交集 | `test/agent-skills.test.mjs` 1 项 |
| 配图与小红书工具 | generate_image 经生产请求上下文逐笔记账；render_xhs_group / edit_xhs_page 复用图组规则；插图插入 = write_revision 拼入 `asset://` 引用（不单设 insert_blocks 工具） | `test/agent-illustration-tools.test.mjs` 3 项、`test/agent-xhs-tools.test.mjs` 2 项（fonts-noto-cjk 容器） |
| 路由与事件流 | `lib/creator-api.mjs` agent 路由与 NDJSON 事件；run 绑定项目 + 渠道，`body.channel` 透传，startRun 渠道门越权返回 403；`lib/api.mjs` 未改动 | 路由 / 渠道用例见 `test/agent-runtime.test.mjs` |
| UI 运行视图 | `components/AgentRuns.jsx` 挂入 WritingWorkspace 助手栏；`lib/core.mjs` 运行时接线 | `e2e/agent-runtime.spec.mjs` |

自动验证（本轮均在 node:22-slim Linux 容器实测；构建与 e2e 另需容器内 git / Chromium）：

| 检查 | 结果 |
| --- | --- |
| `npm run check`（新增 `src/agent-runtime.mjs`、`src/agent-skills.mjs`、`src/agent-tools.mjs` 入链） | 通过（Windows 本机与 Linux 容器均通过） |
| 新增 6 个 agent 测试文件（fonts-noto-cjk 容器） | 22 项全部通过（runtime 10 / chat-tools 4 / illustration 3 / xhs 2 / tools 2 / skills 1） |
| `npm test` 全量（无字体、root 容器） | 544 项 = 532 通过 / 8 失败 / 4 跳过 |
| 8 项失败逐项归类 | 全部为容器环境限制，零真实回归：V74 两项（"no retention deletion without confirmed apply yes"、"confirmed pruning actually deletes oldest valid archive…"）按自身守卫报 "requires an unprivileged Linux container"（root 容器）；6 项小红书 PNG（`test/publishing-xiaohongshu-v1.test.mjs`）因缺 Noto CJK 字体失败，安装 fonts-noto-cjk 后该套件 12/12 通过 |
| `npm run build` | 通过；V64 构建封存回执与 BUILD_ID 生成 |
| `npx playwright test e2e/agent-runtime.spec.mjs`（安装 Chromium 的容器） | 1 项通过：真实 Next 生产服务（V64/V65 封存与 Git 校验启动）+ 合成 loopback 模型，运行时间线流出工具步骤、建议进入审阅、正文保持原修订 |

发布类工具不存在的结构负例为 `tool registry matches runtime allowlist and declares safe schemas`（断言注册表不含 publish / send_draft / export / upload_platform）；渠道绑定为 `run start binds the requested channel and startRun refuses unlisted channels`。4 项环境跳过均为守卫：agent 小红书字体守卫 1 项、V69 非 root / sudo 守卫 3 项，全部保留未删除。V72 / V73 在该容器按静态文件检查通过，真实 Docker 镜像烟测仍属 CI 职责，本轮未声称。

### 计费、额度与渠道语义（本轮确认的行为）

- 非 agent 的单次生成路径维持每尝试 1 次模型请求；agent run 为多步循环，v1 不设请求数上限，但每次模型 / 图片调用照常逐笔记账并消耗每日额度；额度耗尽（429）等连续 3 次模型调用失败把 run 置为 `failed`，不自动重试。
- run 绑定项目 + 渠道；路由经 `body.channel` 透传；同一项目同一渠道至多一个活动 run；`lib/creator-api.mjs` 的既有非 agent 路由行为未改动。

### 场景与实际边界

agent 全部验证使用合成供应商或注入 fetchImpl 驱动；本轮未做真实模型、真实图片服务或公众号验收，外部验收边界延续上文，不因 agent 形态放宽。知乎 / 小红书交付仍为复制与文件 / 图文交付包加人工回填，方式不变；agent 不提供发布类工具，"导出 ≠ 发布"与四项人工检查不变。

Windows 本机（Node 24.1.0）本轮仅复核 `npm run check` 通过；未在本机重跑全量 `npm test`（前轮记录为 85 项 POSIX 环境失败，本轮新增文件后未采集新的本机全量数字）与浏览器场景（依赖 Linux Noto CJK 字体路径）。本轮全量结论以 Linux 容器实测为准。

本轮未提交、推送、合并或部署。

## 2026-10-17 Agent 运行时加固批次（A/B，延续上一节）

在 AGENT-V1 实施验收之后，按最终整分支审查的跟踪清单完成两批加固，仍无任何业务需求变更：

**批 A（运行时加固，6 项）**：①运行轨迹记录副本截断（`toolCalls[].arguments` ≤2000 字符、outcome 字符串统一 ≤2000；回传模型的副本保持原样，测试证明 50KB 级模型输出下每步落库 <6000 字符且正文/建议数据完整）；②模型失败重试加有界退避（250ms×失败次数，取消仍即时生效）；③事件流补 `X-Content-Type-Options: nosniff` 并接入 `request.signal`（客户端断连停止轮询）；④`article_markdown_revisions` 加性迁移新增 `note` 列（V57 模式：CREATE 后 ALTER + duplicate-column 容错），`writing.save` 接受 `note`（≤500 字符）并在 `document()`/`history()` 暴露；`write_revision` 工具把模型改稿理由落盘为不可变修订的 note（V27 出处保真度）；⑤`decide()` 快照守卫改显式 `agentRunId` 键控（行为保持：模型建议仍走 creator 上下文校验）；⑥新增 dispatchApi 层计费回归测试（经生产路由启动的 run，其后台循环产生 `kind:'text'` 用量记录——关闭"ALS→后台循环计费无回归覆盖"缺口）。

**批 B（测试与 UI 收尾，4 项）**：e2e 建议断言升级为数量断言（`article.writing-suggestion` toHaveCount(1)，选择器对照真实组件核实）；`AgentRuns.follow()` 卸载防护（mountedRef 覆盖全部状态写入路径）；配图测试 `usage.today` 空值守卫；小红书测试新增条件声明子测试——无字体主机上断言"文案确认后渲染拒绝 503/缺少中文字体"（字体门本身在任何主机都被测试到）。

**过程中发现并修复一个批 A 引入的真实回归**：`note` 列使 `article_markdown_revisions` 变为 6 列后，`src/editorial.mjs` `ensureChannel` 的 5 值位置 INSERT 失效（SQLite 位置 VALUES 不适用列默认值）——批 B 实现者在自己的验证中如实上报而非越权修复；批 A 实现者随后将两处 INSERT（`editorial.mjs`/`writing.mjs`）全部改为显式列清单并全仓扫描确认无第三处。**教训已记录：加性列变更必须全仓扫描位置 INSERT，且"审查者核实过"不等于可免回归套件。**

验证（node:22-slim 容器；字体套件加 fonts-noto-cjk）：批 A 后 runtime 17/17、回归 30/30、build EXIT=0；批 B 修复后 9 套件合并 64/64、`npm run build` EXIT=0、e2e `agent-runtime.spec.mjs` 1 passed。新增测试后全量规模 544→549（+5：批 A 3 项、批 B 条件子测试按主机声明计）。Windows 本机限制同上节（0600 凭据门、字体路径），未重跑全量。两批均未 commit/push/合并/部署；真实模型/图片/公众号外部验收边界不变。

本轮遗留跟踪项（最终审查分诊为不阻塞合并，维持跟踪）：轨迹 payload 有界但模型回传副本仍受 4000/60000 截断上限约束（设计如此）；write_revision 的 note 在"同 markdown 重复保存"时不落盘（不可变修订 no-op 语义）；模型失败重试消耗步数预算（有界）；上游 5xx 文本记 failed 与图片记 unknown 的口径差异；事件流轮询效率（O(n²) 步骤重解析）；V74 两项与真实 Docker 烟测仍属 CI 职责。

**提交后认证（2026-10-17，提交 640aa46 / 6b54fa7 / a6b7c70）**：完整套件在 fonts-noto-cjk + git 的 node:22-slim 容器实测 **551 项 = 546 通过 / 2 失败 / 3 跳过**——2 个失败为既有 V74 用例（要求无特权 Linux 容器，root 容器下按自身守卫拒绝，与上文分类一致），3 个跳过为 V69 非 root 守卫；含全部 v45–v75 备份/恢复/发布门禁套件，`note` 加性列在这些套件下行为一致。提交内容与本节及上节验证的工作区内容一致；`npm run build`（EXIT=0，含 V64/V65 封存）与 e2e（1 passed）为同一内容的此前实测。

**V74 无特权容器闭环与收尾批（2026-10-17）**：V74 两项在非 root 用户（uid 1000）容器实测 **11/11 通过**——证实此前 root 容器下的 2 个失败纯属用户环境守卫，与上文分类一致，无需等待 CI 闭环。收尾批实现：①`AgentRuns` 面板接写模式切换（PUT `/api/creator/agent` 仅传 writeMode、失败回滚、运行中禁用；执行器每次工具调用重读 profile，运行中翻转仍 fail-closed）；②事件流轮询改 `runSince(projectId,runId,afterSeq)` 增量游标（`run()` 不变，既有事件路由语义逐项等价）。验证：runtime 18/18（新增 runSince 分区测试）、build EXIT=0、e2e 1 passed。均未推送/合并/部署。

**远程 CI 闭环（2026-10-17，推送 9af51f81b → 修复 cbf08b6）**：work 分支推送到 origin 后创建草稿 PR [#27](https://github.com/CavinHuang/content-studio/pull/27)（Draft，base=main，合并仍待操作者批准）。首跑 CI 失败，诊断证实：**不是**本地的 V74/V69 环境用例（npm test 内 V69/V74 合成用例在无特权 GitHub runner 上全部通过——含本地 root 容器失败的 2 个 V74 守卫用例，最终证实其环境分类），而是 9e1b912 新增的 6 个小红书渲染用例命中 `src/xiaohongshu.mjs` 的 fail-closed 字体守卫（GitHub ubuntu-latest runner 无 fonts-noto-cjk），且该步失败使其后所有 CI 步骤（V45–V75 专项、构建、Docker 冒烟）被跳过。修复：`.github/workflows/ci.yml` 在 npm test 前安装 fonts-noto-cjk（`sudo apt-get install`，Docker 冒烟层本就自带字体）；提交 cbf08b6 推送后 **CI 完整流水线全绿**（run 39039043166，success）——npm test 553 项、各恢复/门禁套件、生产构建与 Docker 冒烟在真实 GitHub runner 上全部通过。本地开发环境（root 容器/Windows）与 CI 的差异至此全部归因并闭环。

**用户系统引导补全（2026-10-17，提交 e223a66）**：核查确认多作者用户系统此前已完整实现——`/signin` 注册+登录（scrypt、12–256 位密码、8 小时会话）、每作者独立 SQLite 工作空间、全部 API 的作者归属校验、侧栏作者名与退出登录、401 自动跳登录页、旧库迁移工具；启用方式为启动环境 `CONTENT_STUDIO_MULTIUSER=1`（默认单人本地模式为既定安全设计，README 已有说明）。本轮仅在 `/signin` 单人模式提示中补启用指引（该分支此前未说明如何开启）。同批流程教训：一次构建在未提交的脏工作区上运行，V64 seal 抛错被吞为误导性的"Client build denied:"空原因消息；干净树重建 EXIT=0，确认提交内容正常——构建必须在干净树上执行，且 guard 的 catch 不应吞掉 seal 的真实错误（跟踪项）。

**数据用户隔离活体复验（2026-10-18，HEAD 65a0749）**：在 node:22-slim 容器以 `CONTENT_STUDIO_MULTIUSER=1` 启动真实生产服务（新构建封存，health 返回 `mode:author-workspaces`），注册两位作者并实测：甲创建文章与模型连接后，乙的列表为空（0 项目）、按甲的项目 ID 直读正文 HTTP 404（ID 不构成权限）、未登录 HTTP 401、乙可见模型连接数为 0（加密连接不可见他作者）、按甲的文章标题搜索为空、乙写入甲的正文 HTTP 404；进程重启后甲重新登录仍见自己的数据、乙仍不可见；磁盘上呈现两个独立 `workspaces/ws_<uuid>/` 数据库目录。边界照旧：默认单人本地模式（无登录）为既定设计、localhost 绑定由 V49 runtime-guard 强制；遗留 `legacy:dev` 演示服务器不含作者隔离，不得用于多用户。

**移动端与登录页验收（2026-10-18，PR #29）**：新增 `e2e/mobile-audit.spec.mjs` 长期门禁——390px 视口逐页断言无横向溢出（覆盖五个产品页、signin/login、遗留工具页、创作工作台含新建项目），**实测 16/16 通过**；关键页截图人工复核（首页/工作台/设置·服务连接深链/登录页）堆叠、可读性与可点性正常。登录流程活体验证：`CONTENT_STUDIO_MULTIUSER=1` 下未登录访问首页自动落至 `/signin`（390px 表单与注册入口渲染正常），登录页单/多用户两种形态截图核验通过。

**内置浏览器移动端截图验收（2026-10-18，main 65a0749）**：以容器内真实生产服务（多用户模式、经宿主回环反向代理接入 ZCode 内置浏览器，390×844 视口）完成交互级验收：未登录访问首页自动落至 `/signin`（表单/注册入口齐全）；经页面注册新作者"移动端验收作者"并登录，落回首页且侧栏呈现作者名与退出登录；`/settings#services` 深链直落"写作与配图服务"标签，连接表单 390px 完整可用。此前容器 Chromium 截图已复核 16 路由无横向溢出及首页/工作台/设置/登录页布局。过程结论：ZCode 内置浏览器（IAB）不执行本应用的客户端 JS（同页同流程容器 Chromium 全部通过，判定为 IAB 环境限制而非应用缺陷），交互级验收以 Playwright 完成并留存截图；IAB 渲染层截图验收正常。

**AI SDK 生态接入（2026-10-18，PR #30）**：`chatWithTools` 传输层替换为 **ai@7.0.143 + @ai-sdk/openai-compatible@3.0.71**（`generateText` + `createOpenAICompatible` + `jsonSchema`/`dynamicTool`），调用契约不变：BYOK 绑定指纹、逐调用 reserve/settle、注入式 fetch（合成供应商 fixture 原样兼容——provider 发出的线格式经探针验证为 OpenAI 兼容）、120s 超时、abort 传播、运行循环的 OpenAI 风格返回；新增线程转换器 `toAiModelMessages`（assistant tool_calls→tool-call parts、tool→tool-result parts、system 提取为 instructions）。错误分类精细化：非 2xx APICallError→failed；2xx 响应体/处理/中止失败→unknown。completed 用例行新增规范化 provider token 用量。**工具执行器仍为唯一写入口**（dynamicTool 无 execute，模型只产出调用意图）。验证：agent 电池 65/65；完整套件 552 项 = 547 通过 / 2 失败（已知 V74 root 容器守卫）/ 3 跳过；干净树构建 EXIT=0；V65 锁校验 133 包全钉官方 registry（12 条 npmmirror resolved 已重写）。

**跟踪项（P1）**：creator-v1 e2e「complete briefs」场景偶发失败（选题反馈原因为空）——65a0749 CI 失败一次、随后 3 次全绿；PR #30 CI 连续两次失败后重跑通过；本地容器复现 2 失败 1 通过（且在 AI SDK 改动前的提交同样复现，与该改动无关）。疑似填写→提交竞态导致反馈原因为空，属潜在用户可见数据丢失，需专项排查（网络抓包定位提交体与域层落库）。

**AI Elements 组件接入（2026-10-18，PR #31）**：agent 运行面板时间线改用 Vercel AI Elements 的 Task/Tool 组件（vercel/ai-elements，MIT，源码已适配仓内相对路径并 JSX 化），中文状态徽章与森林绿/米白令牌（Tailwind v4 theme+utilities 分层，**不引入 preflight**——存量手写样式保持未分层级联优先，存量页面零回归）。新增依赖：tailwindcss/@tailwindcss/postcss/clsx/tailwind-merge/class-variance-authority/@radix-ui/react-collapsible/lucide-react（全部官方 registry 官方源，V65 门禁通过）。验证：干净树构建 EXIT=0（V64/V65 封存）、agent-runtime e2e 1/1（DOM 契约原样保留）、移动端审计 16/16、390px 面板截图人工复核（工具步骤卡片/状态徽章/森林绿渲染正常）。后续可扩展面：讨论区迁移 Conversation/Message、PromptInput 替换指令框（本次未动，保持既有交互）。

**界面令牌审查与对齐（2026-10-18，PR #32）**：对照既有设计系统（globals.css 的 --canvas/--ink/--muted/--brand-soft/--line，writing.css 的 --writing-green/--writing-line，白卡 #fffefa 与错误色 #9c442d）审查 AI Elements 层，发现其令牌与组件内联色构成了一组近似不相等的并行色值（#f7f6f1/#22302a/#5a6b57/#dbe2d6/#b3423a 及十余处内联 hex）。修正：ai-elements.css 令牌全部经 @theme inline 间接引用既有设计变量（shadcn --muted 与 globals --muted 命名冲突以 --muted-bg/--muted-ink 别名规避）；组件内联 hex 替换为语义工具类或 var-based 任意值；状态色保持低饱和语义（成功=写作绿、拒绝/等待=弱化墨、错误=#9c442d）。Tailwind 层维持 theme+utilities、无 preflight。验证：干净树构建 EXIT=0（V64/V65 封存）、agent-runtime e2e 1/1、移动端审计 16/16、390px 截图复核。

**AI 输出面全面接入 AI Elements（2026-10-18，PR #33）**：继运行面板 Task/Tool 之后，写作工作台的 AI 输出全部切换 AI Elements 组件：①讨论回复（conversation 状态卡片）以 assistant Message + MessageContent + MessageResponse 渲染（Streamdown 流式 Markdown，cjk/code/math 插件）；②流式生成实况（`writing-live-generation` 的部分文本）改用 MessageResponse（Streamdown 专为流式 Markdown 设计）；③生成历史片段同样接入，下载按钮保留。Conversation（use-stick-to-bottom 自动吸底）已引入备用。依赖新增 streamdown/@streamdown/{cjk,code,math}/use-stick-to-bottom（官方 registry）。PromptInput 完整组件因 command/dropdown/hover-card 依赖级联暂缓（现有输入框风格一致，后续单独评估）。验证：干净树构建 EXIT=0（V64/V65 封存）、agent-runtime 1/1、creator-v1 8/8（含 complete-briefs 场景本轮通过）、移动端审计 16/16。

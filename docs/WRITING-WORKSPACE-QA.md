# 集成写作工作台验证

日期：2026-10-16。仅使用合成文章、临时 SQLite、测试凭据和本地模型响应，未调用付费模型或真实发布。

## 当前执行结果

| 命令/检查 | 本轮结果 |
| --- | --- |
| `npm run check` | 通过 |
| `(umask 022; npm test)` | 448 项：447 通过、0 失败、1 跳过；包括 11 项新写作契约测试 |
| `NEXT_TELEMETRY_DISABLED=1 CIRCLE_NODE_TOTAL=4 npm run build` | 通过，保留 V64/V65 构建封存与 lock 校验 |
| `PLAYWRIGHT_PORT=4316 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test` | 21 项全部通过，其中 8 项新工作台验收 |
| `PLAYWRIGHT_PORT=4317 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:doocs:real` | 2 项全部通过，真实固定 doocs/md:2.1.0 Docker 编辑器及合成图片交接 |
| `npm run test:production` | 1 项通过，实际生产进程重启持久化 |
| `npm run test:staging:v57` | 2 项通过，实际恢复数据库、迁移与重启 |
| vendored source manifest | 32 个源文件哈希匹配 |
| `git diff --check`、新增文档相对链接 | 通过 |

日志位于当前机器 `/tmp/content-studio-writing-{check,all-tests,build,browser-all,doocs-real,production,staging}.log`。上述测试使用当前构建，不是沿用历史 QA 数字。构建使用 Node 24.19.0 / npm 10.9.2；umask 022 是为了保留 V74 权限负例所要求的目录模式。

日常本地服务已从原 onboarding 进程切换到新构建；用 Chromium 打开 `/compose` 验证了新建文章入口、local-only 健康状态和无页面异常。写作页依赖客户端渲染，未把仅检查原始 HTML 当作页面功能验收。

首次旧容器测试因原测试将剪贴板权限限定在固定 4312 端口而失败；改为当前 baseURL 的 origin 后重跑，两项通过，断言未删减。镜像摘要：`sha256:b63c1e83fa8eec776d6b90a8862bca135eeb5588579079c405deb7c97202bfdd`。

## 验收内容

- 复杂 Markdown（代码、表格、图片）完整保存，重开数据库不丢失；历史不可变、渠道互不覆盖。
- 旧段落/排版入口拒绝覆盖 Markdown；已有排版稿迁移需明确选择，并保留两种历史。
- AI 提案不直接写正文；原文和版本失效后不能接受；拒绝/讨论不修改正文；服务异常不覆盖文章。
- Brief 来源可追溯地进入写作上下文；选段配图使用当前稳定块锚点，拒绝过期或跨文章 ID。
- 浏览器实际运行生产 Next、SQLite、doocs 编辑/渲染模块及本地 HTTP 模型协议：创建、编辑、自动保存、主题、AI 内联审阅与撤销、冲突下载、刷新草稿恢复、讨论、失败、上传、平台稿、导出、选段生成与插图。
- 预览不执行不可信 HTML 或自动请求外部图片；390px 视口无页面横向溢出。
- 原 doocs Docker 手动交接保留全部原断言，仅变更兼容页面路径及剪贴板权限的测试 origin。

系统 Chromium 为 `/usr/bin/chromium`；通过可选 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 使用，无需下载浏览器。新增 `PLAYWRIGHT_PORT` 支持测试在独立 loopback 端口运行，不复用日常数据库/进程。

## 未验证与未实施

真实 LLM/图片供应商、公众号/知乎/小红书账号权限、真实草稿箱与真实平台发布未验收。这是首个编辑器切片当时的范围；后续作者隔离、小红书成品等业务已实现并独立验收，见 [CREATOR-V1-QA.md](CREATOR-V1-QA.md)。真实外部账号验收仍单独保留。

原 V69 跨 UID SQLite 读取隔离测试在当前机器因 `sudo -u nobody unavailable` 跳过，保持独立记录。

# V67 — 主机、候选运行进程、WAL 备份与回滚的一站式技术验收

**状态：仅在统一 Draft PR #26 中，不能自动合并、部署或发布。**

## 目标

V66、V64、V62/V61 各自可以独立调用，但缺少一个绑定相同 Git SHA、操作员托管声明、真实主机目录和具体候选进程的顺序化检查。V67 使用单一入口串联，保证初始安全检查不通过时绝不进入任何私有数据库备份步骤。

## 操作前的前置条件

1. 从当前 Draft PR 完整 SHA 检出**无任何已跟踪或未跟踪变更**的受信工作区。执行 `npm ci --no-audit --no-fund`、`npm run release:lock:v65` 和 `npm run build`。V63、V65、V64 的门禁会重新检查来源。
2. 在操作者自己的安全加密位置准备真实生产 SQLite 路径、**另一组独立的** backup/scratch 文件夹（Unix 0700）、同一 SHA 的 V55 人工审查 JSON，以及 V66 的**已真实核对**托管触发器 JSON。外部托管控制台需要有权限的人亲自检查；仅凭填表无法证明 webhook 已禁用。
3. 需要有一个**预先启动**、隔离数据库上的候选 Next.js 服务。不要将生产数据库交给候选进程试运行，也不要占用实际生产服务端口。可在受信主机另一个 shell 按以下方式运行；其中 `/encrypted/isolated-candidate.sqlite` 必须和真实源库路径不同：

```sh
PORT=4312 CONTENT_STUDIO_DB_PATH=/encrypted/isolated-candidate.sqlite CONTENT_STUDIO_CANDIDATE_SOURCE_DB_PATH=/private/content-studio.sqlite npm run candidate:start:v69
```

运行进程必须来自当前候选 commit 经 `npm run build` 生成的 `.next` 收据，且由 V64 守护入口启动。V67 本身**不会**启动、停止或重启服务器，不会切换用户流量，也不会修改现有生产运行进程。

## 操作者单入口命令

```sh
npm run release:review:v67 -- \
  --sha=$(git rev-parse HEAD) \
  --db=/private/content-studio.sqlite \
  --backup-dir=/encrypted/release-backups \
  --scratch-dir=/encrypted/release-scratch \
  --review=/encrypted/v55.operator-review.json \
  --inventory=/encrypted/hosting-v66.private.json \
  --url=http://127.0.0.1:4312/
```

命令参数均为真实主机本地路径，切勿在 CI、PR、论坛、调试日志中公开个人资料或令牌；URL 限制为纯数字回环地址，不允许 `localhost` 的不确定代理解析，也不允许跳转/重定向。

## 严格的执行顺序

1. **初始 V66 预检**：核对当前 Git HEAD 和清洁索引、npm 依赖锁、V55 人工声明、V66 托管触发器清单、原库文件元数据、独立 backup/scratch 权限与空间。未知或开启的自动部署钩子、共享目录或不足容量均阻断。
2. **初始 V64 候选服务探测**：核对 localhost 健康接口的 SHA、Next BUILD_ID、实际磁盘构建与依赖锁指纹、运行 PID 及启动随机标记；不得指向老版本的生产服务。
3. **V62/V61 完整备份与故障回滚**：再次核对实时 GitHub CI，创建不覆盖的 WAL 新备份，严格比对原库前后及每行历史内容和图片 BLOB；对独立恢复副本运行故障注入、回滚和真实应用启动测试，不替换原数据库。
4. **再次 V64 校验**：候选进程必须仍在同一 SHA/BUILD_ID、相同构建与依赖锁指纹、PID 和随机启动标记下运行，拒绝过程中服务重启或热替换。
5. **最终 V66 预检**：再次确认主机磁盘、工作区、人工托管清单和部署相关工作流的静态统计没有漂移；磁盘因新增备份空间不足会阻断。

只有以上全部成功，才输出 `technicalReviewReady=true`，并且仅表示受信操作者主机技术证据可送人工复核。它不是生产部署许可、可信二进制签名、外部托管平台 API 证明或独立的运维审批。

## 输出与失败语义

报告只输出完成的阶段、已知安全的 Git SHA、BUILD_ID、构建和锁文件 SHA-256、备份文件**基名**，不包含私有目录、文章正文、BLOB、原始运营资料、数据库行、认证信息和令牌。出现异常时命令退出非零并只打印通用错误。经过验证的备份继续保存在操作者指定的受保护位置供其管理。

所有情况下，`releaseAuthorized=false`、`mergeAuthorized=false`、`deployAuthorized=false`、`productionReady=false`、`externalHostingIndependentlyVerified=false`、`operatorApprovalGranted=false`，且不会自动审批/合并 PR 或访问付费模型。

## 自动回归测试

`npm run test:review:v67` 包含 12 项顺序与负面测试，包括错误 SHA、危险外部部署声明、拒绝私有数据读取、缺失进程摘要、缺失备份/恢复证明、启动过程中进程替换、磁盘状态回退、重复运行主机检查等。还使用真实临时文件夹运行 V66 的权限和路径验证。CI 不会访问真实生产数据库或外部部署面板。

当操作者之后真正准备上线时，仍需独立核查托管商 webhook/自动部署后台的当前设置、真正的加密备份恢复能力，以及人工明确的合并/发布许可。V67 仅服务于最终发布评审之前的证据准备阶段。


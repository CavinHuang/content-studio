# V61 — 单命令串联发布前技术验收

本轮继续使用统一 Draft PR #26；本工具不更改 main，不操作云端部署，也不触发微信/知乎发布。

## 目的

将 V59 最终提交的 GitHub CI 核验、V55 本地数据库和 WAL 备份证据、V60 SQLite 故障回滚串联起来。避免操作者遗漏某一步，或者把旧提交的报告误用于新的 PR HEAD。

## 操作者准备

真实运行主机必须能够通过 GitHub API 读取本仓库。先由有权限者审核托管平台主分支自动部署钩子、备份管理和事故回滚策略；人工审查 JSON 必须绑定当前完整 SHA。确保在受信且加密的磁盘上创建仅操作者可进入的现有暂存目录（Unix 0700；Windows ACL 需要单独确认）。

    git fetch origin --prune
    git checkout feat/v54-consolidated-integration-gate
    git pull --ff-only
    git rev-parse HEAD
    mkdir -p /encrypted/release-scratch
    chmod 700 /encrypted/release-scratch

准备最新、经过校验的 V45 WAL 备份及旁边的 manifest。注意备份必须与现有源库历史内容一致；任何编辑都会导致旧备份失效。

## 命令

    npm run release:acceptance:v61 -- \
      --sha=$(git rev-parse HEAD) \
      --db=/private/content-studio.sqlite \
      --backup=/encrypted/releases/backup.sqlite \
      --review=/encrypted/releases/v55.operator-review.json \
      --scratch-dir=/encrypted/release-scratch

以上均为示例路径，请使用实际绝对路径。操作前确保资料没有向外公开。需要 GitHub 身份验证时，使用仅供本机的 GITHUB_TOKEN。

## 严格执行顺序

1. 检查当前工作副本 SHA、私有文件是否普通文件、暂存目录权限。拒绝软链接和路径冲突。
2. **尚未读取私人 DB 前**，执行 V59 真实 GitHub API 核验：PR #26 仍为 Draft、SHA/分支/main 基线一致，且 Push CI 和 PR CI 均在此 SHA 上成功。
3. 调用 V55 工具，核对真实数据库和最新备份的结构、历史行指纹、WAL manifest、隔离迁移、渠道合成演练，并校验操作者人工审查声明。
4. 在临时目录中写入一份仅本机可访问的脱敏 V55 JSON；调用 V60 在**隔离恢复副本**上故意制造故障，再创建新文件验证历史内容与应用重新打开的能力。不替换真实源库。
5. 再次比对本地 Git HEAD 和 GitHub 的当前 CI，并检查同一提交的 V55 报告；无论成功还是失败都清理临时 JSON 与目录。

CI 的 10 项回归测试使用合成文章、实际 WAL SQLite 文件、真实 PNG BLOB 和模拟网络应答；在 CI 中**不会访问真实 GitHub API、真实运行主机或用户数据库**。

## 结果和限制

通过时报告包含固定阶段状态、candidateCommit、CI run ID、reviewReady=true 与 technicalEvidenceComplete=true；不会输出数据库路径、文章正文、备份内容或访问密钥。

即使通过，mergeAuthorized=false、deployAuthorized=false、productionReady=false、releaseAuthorized=false 始终不变。外部 hosting/webhook 配置并未通过本工具独立验证，人工签批和主机级停服、网络切换仍为独立的必要步骤。

SQLite 副本会短暂以明文存在于受保护的临时目录。自动清理不是安全擦除，必须在加密盘执行，且 Windows ACL 需独立确认。

## CI 命令

    npm run test:acceptance:v61
    npm run check
    npm test
    npm run build

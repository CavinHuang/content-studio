# V60 — SQLite 备份回滚演练（不覆盖正式数据库）

本轮沿用统一 Draft PR #26，在 V45 WAL 安全备份、V55 操作者证据以及 V59 真实 CI 核验之上，提供一个实际操作 SQLite 文件的本地回滚演练命令。它不触碰部署 API，不做 merge，也不发布微信或知乎文章。

## 操作者执行步骤

首先锁定当前 PR HEAD 的完整 SHA，生成严格对应该 SHA 的 V55 包；注意每次新增代码提交后都需要重新生成匹配的新证据。

在真实运行主机的受保护、**加密磁盘**上，创建一个仅本人可访问的**现有空目录**，例如：

    mkdir -p /encrypted/content-studio-scratch
    chmod 700 /encrypted/content-studio-scratch

完整命令：

    npm run release:rollback:v60 -- \
      --sha=$(git rev-parse HEAD) \
      --db=/private/content-studio.sqlite \
      --backup=/encrypted/releases/current-verified.sqlite \
      --operator-evidence=/encrypted/releases/v55.release-evidence.json \
      --scratch-dir=/encrypted/content-studio-scratch

此处所有路径均为示意；必须用真实、独立且受保护的绝对路径。不能把用户文章原文、BLOB、备份、部署凭据或受保护的证据 JSON 上传到 GitHub。

## 实际执行内容

1. 在读取数据库前拒绝 SHA 不符合、V55 包不完整、路径混用、符号链接、权限宽松的 scratch 目录。
2. 只读检查原库完整性、schema、表行数指纹以及包含图片 BLOB 的历史内容指纹，要求它们与 V45 校验过的 WAL 备份（含 manifest）完全一致。
3. 用现有 restoreBackup 在私有暂存路径建立一份**不会覆盖原有文件**的测试副本，在该副本上执行最新 createCore() 初始化及模拟故障注入，确认副本确实与原状态不同。
4. 再从同一可信备份恢复到 **第二个新文件**，对恢复结果检查 schema、行数和全行内容/BLOB 指纹是否与原始源文件完全一致，确认当前 createCore() 能打开该回滚副本。
5. 结束前再次检查原数据库和原备份内容未变化，清除受保护暂存目录并输出**脱敏结果**。暂存删除不等于安全擦除。

若任何一步失败：退出码非零，CLI 仅输出通用异常，不显示正文、真实路径、私有记录或 API 密钥。它不会自动尝试修复或替换真实数据库。

## 结果如何解释

仅当 V60 报告 status=passed 时，才能说明在**被测试主机与指定的原库/备份**上成功完成可回滚副本演练。CI 仅通过合成 fixture，不代表真实私人数据已验收。

本命令验证的是 SQLite 快照与**在隔离副本上重新打开核心服务**的能力；不等价于真实生产 Next.js HTTP 重启（该部分由 V57 的合成验收覆盖），也不等价于主机级停服/流量切换/多进程锁协调或真实生产事故回滚。Windows 目录 ACL 是否足够严格也必须由操作者独立确认。

即使本地演练通过，仍保留 releaseAuthorized=false、mergeAuthorized=false、deployAuthorized=false 和 productionReady=false。外部托管/Webhook 审查、最终 HEAD 的 V59 CI 验证和操作者批准仍需要分别完成。

## CI

    npm run test:rollback:v60
    npm run check
    npm test
    npm run build

V60 回归基于真实磁盘 SQLite + WAL + PNG BLOB，对篡改 manifest、旧备份、SHA 不一致、路径冲突、软链接、scratch 权限和故障期间清理做负向覆盖。CI 绝不访问真实运行主机的源库与备份。

# V62 — 原始 SQLite 一次性安全备份与发布前技术验收

本阶段仍位于统一 Draft PR #26，**不会修改或合并 main、部署主机、执行公众号/知乎发布**。

## 解决什么问题

V61 已能核对当前 SHA、GitHub CI、本地 WAL 备份与 V60 故障回滚，但需要操作者事先提供一份完整且**与当前数据库内容一致**的备份。最常见的错误是选择了旧备份、在备份文件上覆盖已有存档、只比较表行数或在备份期间有文章发生修改。

V62 提供单一操作员命令，自动在保护好的备份目录新建 WAL 安全快照（不覆盖已有文件），验证 manifest、schema/行数和完整 BLOB 历史内容一致，并调用现有 V61 技术验收。

## 使用之前

1. 在实际运行主机上的受信 Git 工作副本检出本 Draft PR 最新提交，确认 `git rev-parse HEAD` 对应当前候选 SHA。
2. 由有权限的操作者检查实际托管平台的 main 自动部署触发器、数据所有权与恢复流程；参照 V55 创建当前 SHA 的人工审查 JSON。该 JSON 是人工声明，**不能证明外部托管平台真的已经被自动检查**。
3. 备份目录与临时目录应是**分离的、已存在的、受保护且使用加密磁盘**的目录。Unix 应使用 mode 0700；Windows ACL 应由管理者单独验证，脚本无法验证磁盘加密或 Windows ACL。
4. 原库和 review JSON 必须是独立的绝对路径普通文件；拒绝软链接、不安全目录及嵌套交叠目录。

## 命令

    npm run release:prepare:v62 -- \
      --sha=$(git rev-parse HEAD) \
      --db=/private/content-studio.sqlite \
      --backup-dir=/encrypted/release-backups \
      --review=/encrypted/v55.operator-review.json \
      --scratch-dir=/encrypted/release-scratch

所有路径仅作示例。操作者需在真实主机配置私有参数；有 GitHub API 速率限制时可通过 `GITHUB_TOKEN` 提供只读 API 访问，不要把令牌与备份上传至仓库。

## 实际行为

1. 校验精确 Git SHA，使用 V59 GitHub API 只读确认当前 PR #26 仍是 Draft、main 未变化、同一 SHA 上最新 Push/PR CI 均已成功。**如失败则不读取原始 SQLite 数据，也不创建备份**。
2. 只读校验操作者人工 review 文件与当前 SHA 一致、备份和 scratch 目录真实且权限受限；再校验当前本地 HEAD。
3. 只读计算真实源库的完整历史数据指纹。使用 node:sqlite 的 WAL-consistent backup API 在备份目录创建带 SHA 前缀与随机后缀的**新文件**及 manifest，不覆盖任何已有备份。
4. 校验 manifest 原始文件 SHA256，重新计算快照和当前原库的 schema、逐表行数与每行内容（含图片 BLOB）指纹。如果备份期间源数据变化，拒绝这个快照，并删除本轮新建的备份及清单，要求操作者重新准备。不会回滚或更改真实源库。
5. 若快照稳定，交给现有 V61 单命令技术验收，再核对最新 CI 与相同 SHA；操作者可从脱敏的 `backupFilename` 获知保留的备份文件名。

如果 V61 验收失败但 V62 备份已经验证且稳定，该**新备份会保留**在操作者的私有目录用于独立诊断或恢复，不会被自动删除或部署。已有的任何存档都不会被覆盖。

## 权限与安全界限

- 报告不包含原始路径、文章正文、BLOB、个人信息或令牌；只包含 SHA、受控的备份文件名、技术阶段状态和固定布尔值。
- `reviewReady=true` **不等于**授权合并或上线。`mergeAuthorized`、`deployAuthorized`、`releaseAuthorized` 和 `productionReady` 均固定为 false。真实外部托管设置和批准仍需由操作者独立核对。
- 备份与临时副本可能包含私人内容，必须保存在受保护加密盘。脚本不检验磁盘加密，文件删除也不是安全擦除。
- 检验仅反映执行时的 SQLite 内容。持续编辑可能让快照瞬间过期；一旦源库再有变化，须重新备份和验收。不要在运行中的生产数据库上直接覆盖恢复。

## CI

`npm run test:prepare:v62` 使用真实 SQLite、WAL、PNG BLOB 和模拟 GitHub 请求测试十个场景：正常快照、重复执行不覆盖、备份期间源数据变化、伪造 manifest、目录权限与 symlink、错误 SHA 人工声明、红色 CI、失败验收、完整 V55+V60+V61 路径。**CI 不操作真实用户主机**。

核验命令：`npm run check`、`npm run test:prepare:v62`、`npm test`、`npm run build`。

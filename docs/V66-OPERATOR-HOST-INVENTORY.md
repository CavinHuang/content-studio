# V66 — 操作者主机与自动部署触发器清点

**状态：** 仅在统一 Draft PR #26 中开发；主分支、生产服务、私人数据和外部部署钩子均不会由本工具修改。

## 为什么还需要这一阶段

V55 至 V65 覆盖了源码、CI、锁定依赖、Next 运行态、WAL 备份和隔离回滚。但主机是否有足够的空间同时保存原库、备份和多份恢复副本，备份与暂存目录是否暴露给其他系统账户，main push 是否会通过外部 webhook 直接触发部署，目前并不能从 GitHub 测试中自动得出结论。

V66 提供**只读真实主机预检**和一种明确的人工托管配置声明格式，拒绝把未知值默认为安全；输出只有汇总状态，不泄漏路径、原始文章内容或 API 密钥。

## 1. 生成未审查的托管清点模板

在实际主机检出当前完整提交后运行：

    npm run release:host:v66 -- template --sha=$(git rev-parse HEAD)

命令仅输出 JSON。将输出保存在主机**受保护、不会加入 Git**的私有文件（例如 `/encrypted/hosting-v66.private.json`）中。

默认 `githubActionsReviewed`、`externalHostingReviewed`、`allAutomaticDeploymentPaused`、`backupVolumeEncryptionReviewed`、`rollbackOwnerReviewed`、`localOnlyAccessReviewed` 全为 `false`；`mainPushTrigger` 和 `externalDeployHook` 默认是 `unknown`。操作者需要实际检查托管商控制台、GitHub Actions 和部署 Webhook 的当前配置后填写：

- `mainPushTrigger` 只可填写 `none`、`ci-only`、`auto-deploy` 或 `unknown`。只有 `none` 和 `ci-only` 可进入技术准备阶段；会自动部署及未知都会阻断。
- `externalDeployHook` 只可填写 `none`、`paused`、`active` 或 `unknown`。只有 `none` 和 `paused` 可进入技术准备阶段；存在活动钩子或未知都会阻断。
- `allAutomaticDeploymentPaused` 必须是 `true`，以及其他人工审核布尔字段均必须明确确认。未填写、额外添加敏感自由文本或 SHA 与候选提交不一致会阻断。

**这些值是受信操作者的自报声明，不是对第三方平台的独立 API 验证。** 不能将 `reviewReady` 当作发布批准。

## 2. 在真实主机执行只读预检

    npm ci --no-audit --no-fund
    npm run release:host:v66 -- \
      --sha=$(git rev-parse HEAD) \
      --db=/private/content-studio.sqlite \
      --backup-dir=/encrypted/release-backups \
      --scratch-dir=/encrypted/release-scratch \
      --review=/encrypted/v55.operator-review.json \
      --inventory=/encrypted/hosting-v66.private.json

以上均为示例路径，需由主机所有者选择。所有文件必须是普通文件，不可使用符号链接；备份与恢复目录必须是不同且不嵌套的现有目录。Unix 目录权限须为 0700，原库不能允许其他用户读取。Windows ACL、真实磁盘加密状态**不能**由脚本独立证明。

该命令核验 V63 清洁 Git 提交及 V65 依赖锁、对应 SHA 的 V55 人工审查 JSON、V66 托管清点声明、本仓库 GitHub Actions 工作流文件的静态统计、源库大小与所在文件系统及 backup/scratch 文件系统的可用字节。为单份新备份保留 `2 × SQLite 文件大小 + 128 MiB`，为同时多份恢复和回滚暂存保留 `3 × 文件大小 + 256 MiB`；若两目录同一设备则将两项相加。实际空间需求可能因 WAL、并行请求、视频和其他服务更高，操作者必须预留裕量。

工具只读取文件 metadata 与磁盘空间：**不打开 SQLite 数据内容，不创建备份，不修改磁盘布局，也不调用真实部署或内容发布**。读取 GitHub Actions 本地 YAML 只能发现关键词线索，不代表解析了所有 GitHub Actions 语义，更不能发现主机外部的 Webhook。

## 3. 技术预检通过后

继续运行 V62 的真实 WAL 安全备份与 V61 技术验收：

    npm run release:prepare:v62 -- \
      --sha=$(git rev-parse HEAD) \
      --db=/private/content-studio.sqlite \
      --backup-dir=/encrypted/release-backups \
      --review=/encrypted/v55.operator-review.json \
      --scratch-dir=/encrypted/release-scratch

必要时另外运行 V64 环回进程核验。完整验收后仍需真实操作者独立批准合并/部署。此工具既不能代替外部 Hosting 的访问权限，也不能证明生产数据恢复成功。

## CI 与安全限制

`npm run test:host:v66` 使用临时文件、真实 `statfs`、权限和符号链接进行 12 项正反例回归，包括错误候选 SHA、自动部署、未暂停 Webhook、磁盘容量不足、目录重叠、异常权限、未通过的 V55 声明等；所有数据均为合成内容。

结论中始终 `externalHostingIndependentlyVerified=false`、`releaseAuthorized=false`、`mergeAuthorized=false`、`deployAuthorized=false`、`productionReady=false`。本地预检不是托管商后台或外部机器的事实核查。


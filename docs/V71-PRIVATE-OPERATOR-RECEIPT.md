# V71 — 一次性、脱敏的本机操作者验收凭证

V67 的技术验收会执行真实主机预检、候选服务探测、V62 的 WAL 备份和隔离回滚，并打印技术报告。仅靠终端输出难以为变更评审保留稳定记录。V71 在原有 V67 执行链外增加一个严格受保护的文件凭证，不改变业务数据与上线权限。

## 准备

1. **先完成 V69 的系统用户隔离、V66 私有托管清点、V55 操作者审查，以及 V70 文档中的候选服务准备。** V71 不会启动或修改任何服务。必须已有受信的生产源库与独立候选库。
2. 在实际主机上，由准备运行 V67 的操作者**预先创建**自己拥有的私有目录，权限严格为 0700，置于 Git 仓库工作树之外，譬如 `/protected/receipts`。不要将凭证写入项目仓库、公开日志或上传到 GitHub PR。
3. 为每次验收选择**全新的唯一文件名**，须以 `.v71-receipt.json` 结尾。同名文件存在时直接阻断，不能覆盖历史技术证据，也不会重复运行备份。

## 完整执行

```sh
npm run release:handoff:v71 -- \
  --sha=$(git rev-parse HEAD) \
  --db=/private/content-studio.sqlite \
  --candidate-db=/encrypted/isolated-candidate.sqlite \
  --backup-dir=/encrypted/release-backups \
  --scratch-dir=/encrypted/release-scratch \
  --review=/encrypted/v55.operator-review.json \
  --inventory=/encrypted/hosting-v66.private.json \
  --url=http://127.0.0.1:4312/ \
  --receipt=/protected/receipts/review-01.v71-receipt.json
```

所有路径为示例，必须替换为操作者主机的真实受保护路径，不要在公开聊天或 PR 中展示原始私有凭据。命令使用 O_EXCL+0600 在备份开始前预留文件；成功后记录 Git SHA、Next BUILD_ID、实际构建与 npm 锁文件 SHA-256、五个 V67 技术阶段状态、**备份基名**和固定拒绝上线标记。异常或任何必要的 V67 检查失败时，写入只含 `technical_review_not_complete` 的最小阻断记录，并以非零状态退出。

## 复核已生成收据（离线）

```sh
npm run release:handoff:v71 -- verify \
  --sha=$(git rev-parse HEAD) \
  --receipt=/protected/receipts/review-01.v71-receipt.json
```

复核仅读取小型普通 JSON 文件并检查权限、文件 schema、固定拒绝上线字段和本地内容哈希；不打开数据库、不读备份内容、不查询 GitHub CI 或托管平台。`technicalReviewRecorded=true` 表示记录了当时 V67 的本机技术状态，绝不等于当前生产系统仍安全。

## 失败、权限和已知限制

- 非私有目录、符号链接凭证、Git 工作树内路径、额外字段、错误 SHA、无效构建摘要、已存在的同名文件一律拒绝。
- 受限的私有目录由操作员管理。本机内容 SHA-256 防意外改写，但**任何能修改凭证的操作者都可重新计算摘要**；不能把它称作独立可信的数字签名。
- 失败凭证仅反映技术未完成，不暴露失败环节内的任意异常文本、数据库路径、文章内容、运营材料或令牌；故障排查须在受保护主机内执行。
- 凭证创建失败不会删除 V62 已生成的备份；既有新备份仍由管理员保留和管理。预留路径在步骤开始前检查，拒绝覆盖历史凭证。
- 外部托管与 main push 自动部署行为仍需管理员进入实际托管面板核查，未经明确人工批准不得合并/部署。`releaseAuthorized=false`、`mergeAuthorized=false`、`deployAuthorized=false`、`productionReady=false` 永远保留。

## 测试

`npm run test:handoff:v71` 使用临时私有目录与注入的 V67 结果执行 11 项本地持久化、覆盖保护、权限、篡改、SHA/阶段/授权等负面测试。真实 V67 备份和真实多 UID 候选服务由 V62、V67、V70 的既有独立测试验证；本阶段 CI 不会操作用户主机或外部平台。


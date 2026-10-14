# V68 — 已运行候选服务的 SQLite 身份隔离

V67 之前要求在独立 SQLite 文件上启动候选 Next 服务，但只靠文档约定，并未验证运行中的服务是否真正连接到了这份候选库。V68 在 V67 发布前技术验收入口增加真实文件身份与服务 SQLite 连接一致性检查。

## 本轮实现

1. `--candidate-db` 是 V67 必填的独立绝对路径。V66 主机预检成功后、任何网络服务探测与 V62 WAL 备份之前，脚本通过真实文件的规范路径、设备号和 inode 比较候选与源库。即使两条路径不同，只要实际是同一个文件（硬链接），就会阻断。软链接、位于备份/暂存目录内的候选文件也会阻断。
2. Next `/api/health` 从正在使用的 `core.store.db` 执行 SQLite `PRAGMA database_list`，对当前数据库文件进行只读元数据检查；以一次性运行 nonce 对设备与 inode 生成 HMAC-SHA256 指纹，并在 `runtimeBuild.databaseIdentity` 中上报。不会回传路径、SQLite 正文、文件设备号、inode、图片或秘密。这里的 nonce 是公开标记，**不意味着带有秘密密钥的可信证明**。
3. V64 loopback 探针验证数据库身份格式并与候选进程构建记录一并读取。V67 在备份前后重新计算操作者指定候选文件的身份指纹并与 HTTP 响应比较；如果服务其实连接了源库、其他 SQLite 文件，或中途更换运行进程/连接，立即拒绝成功报告。
4. 即便全部通过，`candidateDatabaseIsolated=true` 也只表示本机文件与进程声明一致，`mergeAuthorized`、`deployAuthorized`、`releaseAuthorized`、`productionReady` 仍均为 `false`。V67 不会启动、停止或替换正在使用的服务。

## 真实主机准备

在实际主机上检出相同 Git SHA，运行 `npm ci --no-audit --no-fund` 和 `npm run build`。另一个终端，用全新的独立数据文件启动候选服务：

```sh
PORT=4312 CONTENT_STUDIO_DB_PATH=/encrypted/isolated-candidate.sqlite npm start
```

不得让该路径指向真实生产库，也不能软链接或硬链接到真实生产文件。启动完成后执行：

```sh
npm run release:review:v67 -- \
  --sha=$(git rev-parse HEAD) \
  --db=/private/content-studio.sqlite \
  --candidate-db=/encrypted/isolated-candidate.sqlite \
  --backup-dir=/encrypted/release-backups \
  --scratch-dir=/encrypted/release-scratch \
  --review=/encrypted/v55.operator-review.json \
  --inventory=/encrypted/hosting-v66.private.json \
  --url=http://127.0.0.1:4312/
```

所有示例路径应替换为本机可信路径，禁止上传私有审查声明到 GitHub。候选库必须是**已存在的普通文件**，数据库服务启动会创建新文件。不要把 `--candidate-db` 指向生产数据目录的备份。

## 安全边界与 CI

- 此功能防止误用同一物理 SQLite 文件，但它不是操作系统沙箱，也不能证明第三方托管后台、容器镜像、访问权限或进程二进制经过独立认证。运行服务及操作者主机必须是可信环境。
- 用 nonce 与设备号/inode 生成的哈希是不透明一致性标识，不是保密身份凭证；不能当作加密签名、发布审批或攻击者无法伪造的证据。
- GitHub CI 使用 `npm run test:isolation:v68` 的 11 项真正临时 SQLite/文件系统测试，以及已扩展的 V64 真实 Next.js 守护运行进程测试。不会连接真实生产数据库或自动部署。
- 备份前后的文件检查仍存在操作系统级竞态窗口。若主机上存在不受信的并行进程替换文件，本工具不提供安全保证；需对数据库目录配置系统级写权限控制。


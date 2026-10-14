# V70 — 在 Linux 不同用户下运行完整 Next.js 候选进程

本阶段仍属于统一 Draft PR #26，不修改主分支，不部署任何服务，不读取或备份用户真实数据库。

## 为什么要做

V69 的测试确认了 `nobody` UID 在真实 POSIX 权限下不能打开被隔离的 SQLite 文件；但并未启动完整的 Next.js 候选服务，因此没有验证 Next 的构建资源权限、`.next` 运行时缓存、实际 SQLite 连接、HTTP 健康接口和 V67 串联之间的兼容性。

## 合成跨账号演练

`npm run test:candidate:real:v70` 在 GitHub Ubuntu runner 的**临时目录**中创建两个真实但合成的 SQLite 文件：模拟生产源库由 runner 用户拥有，放置于 `0700` 目录且文件 `0600`；候选库由 `nobody` 拥有且仅本人可读写。全程不读取任何真实服务器路径。

从通过 V64 封装校验的构建结果中复制 `app/components/src/lib/scripts`、`.next`、`node_modules`、依赖锁、配置和 `.git` 到临时候选工作区，后者交给 `nobody`。通过非交互式 `sudo -u nobody` 运行**真实** `scripts/runtime-guard.mjs candidate-start`；从另外一个 runner 用户通过 `127.0.0.1` 动态端口读取 `/api/health`，核对候选进程的提交、BUILD_ID、构建和锁文件摘要、当前真实 SQLite 连接的匿名指纹、运行 UID 和操作系统对源数据库的拒绝访问状态。

接着复用真实 `probeServingBuild`、`verifyCandidateIsolation`、`verifyOperatorOsBoundary`、`inspectHostReadiness` 与 `reviewOperatorRelease`，对同一候选服务执行 V67 的前后状态核验，并验证丢失 OS 安全证明后不会进入备份阶段。

## 仍未覆盖的环节

为了避免测试自身依赖“PR HEAD 的 GitHub CI 已经通过”这一循环条件，V70 **只对 V62 结果注入一个合成固定值，不执行 V62 的真实备份回滚**。V62/V61 的真实 SQLite WAL 和故障恢复在既有独立测试中完成。V70 两种事实不可互相代替。

另外，本测试发生在 GitHub runner 的隔离合成文件系统，而不是操作者拥有的生产主机。它不证明实际托管 Webhook 已暂停、磁盘加密安全、容器用户/挂载与真实 POSIX UID 一致或生产数据库备份已成功。实际主机仍须运行 V66/V67 + V62，并由操作者独立批准合并及部署。

## 失败即拒绝

若另一个 UID 无法读取构建产物、运行 SQLite 连接不属于声明的候选文件、候选进程能打开源库、主机目录权限异常、构建文件/依赖锁不一致或 OS 证明在前后检查中失效，测试立即失败。临时工作区与子进程只用于本轮 CI；它们不是持续在线的实例。

任何 V70 报告依然具有 `mergeAuthorized=false`、`deployAuthorized=false`、`releaseAuthorized=false`、`productionReady=false`，且不产生真正的生产授权。


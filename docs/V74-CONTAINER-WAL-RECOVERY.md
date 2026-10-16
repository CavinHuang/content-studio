# V74 · Docker WAL 在线备份、保留和隔离恢复

面向 Linux 单机 localhost 环境。仅操作者手动执行备份恢复，PR #26 不合并也不部署。

## 容器隔离

- 应用只挂载 `studio-data:/app/data`，不接触备份卷。
- `backup-operator` 在无网络、只读 rootfs 和非 root UID 下，从只读 `studio-data` 读取 WAL/SQLite，并用 V45 node:sqlite 在线备份 API 向 `studio-backups` 创建新快照。
- `restore-operator` 不挂载 `studio-data`，仅从只读归档卷写入独立的 `studio-restored:/app/restore`，严禁覆盖已有文件。
- 维护脚本检查 Linux 精确卷挂载点、0600 归档/manifest、0700 私有目录、归档 basename、manifest SHA-256 和 SQLite 完整性；错误只打印固定脱敏信息。

## 在线备份（原有应用保持运行）

```sh
docker compose -f compose.local.yml --profile maintenance run --rm --no-deps backup-operator backup
```

输出仅包含归档 basename、摘要与行数。不能直接复制运行中的 `*.sqlite` 作为备份，因为 WAL 可能保留未检查点的事务。备份卷仍需独立加密、异地副本和人工保留策略。

## 查看备份与保留

```sh
docker compose -f compose.local.yml --profile maintenance run --rm --no-deps backup-operator list
docker compose -f compose.local.yml --profile maintenance run --rm --no-deps backup-operator prune --keep=7 --apply=no
# 只有经人工确认才执行不可逆清理
docker compose -f compose.local.yml --profile maintenance run --rm --no-deps backup-operator prune --keep=7 --apply=yes
```

保留策略的 N 必须大于等于 2；清理前对所有归档做 V45 SHA-256 manifest 与 SQLite 内容验证，遇缺失、软链接、损坏或陌生文件即整体阻断。没有定时自动清理。

## 离线恢复至全新数据卷

```sh
docker compose -f compose.local.yml --profile maintenance run --rm --no-deps restore-operator restore --backup=content-studio-v74-YYYY-MM-DDTHH-mm-ss-0123456789abcdef.sqlite
```

`--backup` 必须是 list 返回的文件名，不接受任何目录。默认 `studio-restored` 只允许成功恢复一次；下一轮演练请创建不同的专用卷，不得删除或复用正式数据卷。恢复完成后使用另一回环端口、同一候选镜像和恢复卷启动新应用验证历史数据、BLOB 和 V64 来源。整个工具不会自动切换正式容器的数据卷。

## 验证与局限

CI 用真实 Docker 测试在线 WAL 快照、SQLite BLOB、已存在目标的覆盖拒绝、恢复卷的独立 Next 实例及 V64 身份。测试数据均为合成，未访问任何真实主机或业务 SQLite。

本方案不证明卷加密或异地灾备，也不替代 V67/V71 的正式人工验收。发布、合并、部署、生产就绪授权均保持 false。

# V73 — 只读根文件系统、临时缓存和 SQLite 数据卷

V72 已能构建、启动和重启由 V63/V64/V65 校验的非 root 容器，但默认 Docker 容器根文件系统仍然可写。V73 将 Linux 本地单用户部署收紧到 **只读 rootfs + 明确允许写入的最小目录**。

## Linux 本地使用

```sh
docker compose -f compose.local.yml build
docker compose -f compose.local.yml up -d
docker compose -f compose.local.yml ps
curl --fail http://127.0.0.1:4312/api/health
```

镜像内容包括 Git 浅层来源、`package.json`、`node_modules`、Next.js 生产构建及其 V64 收据，都位于只读根文件系统中。非 root UID 为 10001，取消 Linux capabilities，禁止提权，并限制进程数。

### 允许写入的目录

| 目录 | 存储类型 | 用途 |
|---|---|---|
| `/app/data` | Docker named volume | 唯一持久化 SQLite 文件以及 WAL/SHM；需要正式 WAL 安全备份 |
| `/tmp` | 64 MiB tmpfs | Node/操作系统临时文件；随容器停止销毁 |
| `/app/.next/cache` | 128 MiB tmpfs | Next.js 可变缓存；不计入 V64 构建摘要 |
| `/app/.next/server/route-cache` | 64 MiB tmpfs | Next 16 可变路由缓存；不计入 V64 构建摘要 |

其他路径（包括 `/app/.git`、`/app/package.json`、`/app/.next/BUILD_ID`）不允许写入。临时缓存无持久保证，不应该保存业务内容或用户素材。缓存大小是有界的，特殊高并发负载可导致空间用尽，应在可信环境中按实际业务量评估。

## 验证

CI 的 `smoke/docker-local-v72.sh` 已加强为真实只读运行：通过 `docker inspect` 检查 rootfs 只读；尝试写入源码、Git/HEAD、构建 BUILD_ID 必须得到 EROFS/EACCES；检查 3 个临时目录可写；随后请求真实首页、状态和健康接口，用 Node SQLite 写入合成标记，重启容器，再检验 V64 运行收据与业务数据仍在持久卷。

也可以在本机执行只读检测：

```sh
docker compose -f compose.local.yml exec -T content-studio sh -c 'test -w /app/data && id'
docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$(docker compose -f compose.local.yml ps -q content-studio)"
```

Linux host 网络下应用仍绑定 `127.0.0.1`，未提供互联网访问所需认证/鉴权，不能直接暴露端口或擅自修改 `--network host`/绑定地址。

## 明确不覆盖的内容

- 这是运行文件系统的权限控制，而不是防所有提权漏洞的完整沙箱。容器用户仍有写 SQLite 持久卷的权限，必须备份且需要受信宿主管理。
- 不支持把整个宿主工作目录作为读写 bind mount，避免破坏 V63/V64 的哈希与 Git 检出校验。
- Docker Compose 配置由 GitHub CI 的真实 `docker run` 等效配置验证，但**没有在生产主机、Docker Desktop 或真实私有数据库上执行部署**。
- V67/V71 的真实主机验收和托管部署触发器复核仍须单独完成；所有合并、发布、部署授权标记均为 false。

PR #26 保持 Draft，不自动部署或合并。

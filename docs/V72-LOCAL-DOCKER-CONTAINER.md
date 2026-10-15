# V72 · Content Studio Docker（仅单机 localhost 模式）

V73 的只读根文件系统及限定临时缓存说明参见 [V73 只读容器运行指南](V73-IMMUTABLE-DOCKER-RUNTIME.md)。

此仓库之前只有 doocs/md 的辅助 Compose，并无 Content Studio 的主 Dockerfile。本次新增可运行的多阶段构建、最小化 Git 来源状态、生产依赖、SQLite 持久卷、本地健康检测和 Linux 本地 Compose。

## 严格边界

Content Studio 当前没有公网访问所需的用户认证与访问控制。**镜像不会开放公网服务**；Next 生产启动由现有 `scripts/runtime-guard.mjs` 绑定到容器内部的 `127.0.0.1`，不能用常见的 `-p 4312:4312` 或桥接网络解决访问，这样也无法正确访问容器内 loopback。Linux 主机使用 `network_mode: host`，绑定的是主机的 loopback；macOS/Windows Docker Desktop 的 host networking 可用性依版本和设置而异，本配置不保证跨平台直接访问。

## 构建、运行和健康检查（Linux）

从 **完整的、已检出的 Git 仓库根目录**操作（不能直接使用 GitHub ZIP/Source Archive）：

```sh
docker compose -f compose.local.yml build
docker compose -f compose.local.yml up -d
curl --fail http://127.0.0.1:4312/api/health
docker compose -f compose.local.yml ps
```

数据库存于持久卷 `studio-data` 的 `/app/data/content-studio.sqlite`，进程使用 UID 10001（非 root），默认使用 `tini` 转发信号。除非你已备份并确认不再需要数据，**不要**执行 `docker compose down -v`。如需数据备份，请使用项目已有的 V45/V62 WAL 安全备份工具；不要直接复制正在使用的 `*.sqlite` 而忽略 WAL 和 SHM。

用 `docker exec` 在容器内验证和应用一致的 commit / 构建摘要：

```sh
docker compose -f compose.local.yml exec -T content-studio sh -c \
  'npm run release:runtime:v64 -- --sha=$(git rev-parse HEAD) --url=http://127.0.0.1:4312/'
```

## 镜像组成

- **build**：Node.js 22.16.0；先执行 V63 清洁检出校验，再 `npm ci`、V65 锁文件检查和 V50/V64 构建封存。
- **reviewed Git clone**：从 build 阶段的 commit 创建浅层、detached 的 Git checkout，去掉 remote。运行镜像不保留原始工作区的 remote URL、reflog 或完整历史，但仍能执行 V63 精确 SHA 和完整跟踪文件验证。Docker 构建上下文仍需要原始 `.git` 的 index/objects/HEAD；`.dockerignore` 排除 `.git/config`、hooks、reflogs 和 Git remotes。**仅从可信工作站或 CI 构建**；历史 Git objects 在构建缓存中仍可能存在，敏感历史应使用合适的受信 builder。
- **production-deps**：`npm ci --omit=dev` 使用完全锁定的依赖。无需浏览器 Playwright 依赖。
- **runtime**：包含一个浅层检出的当前 Git SHA、完整原始跟踪工作树（满足 V63）、锁文件、生产 Node modules、已封存的 `.next`、git/tini；切换到 UID 10001 后重新执行 V63、V65 和 V64 构建收据校验。启动时再次核对构建摘要，并以严格 loopback 绑定。
- **健康检查**：只通过容器内 `127.0.0.1:$PORT/api/health` 探测本地运行身份。

镜像**不会**包含运行时 `.env`、数据库、备份、操作员凭证或宿主的私有 npm 配置；如需接入模型 API，必须在运行时通过受保护的环境管理方式注入，不要将密钥作为 Docker build arg 或嵌入 `NEXT_PUBLIC_` 变量。

## 限制

- Git 浅层仓库和 V64 哈希收据是**本地一致性检测**，不是 CI 签名、完整镜像软件供应链证明或生产批准。
- `docker compose` 本地启动不等于 V67/V71 操作者真实主机验收。CI 中的 Docker smoke 仅使用独立临时卷、合成数据并且明确不会把这个镜像直接推送到生产仓库。
- 在有其他用户的主机上，Linux host networking/loopback 仍可被同机其它进程访问。此程序依旧只能被可信单用户使用。
- 如果改为公网、多用户或容器编排系统部署，必须先设计独立的认证、授权、网络入口、密钥管理与备份恢复方案。

没有自动合并、部署、发稿或访问私有数据库；PR #26 仍然保持 Draft。

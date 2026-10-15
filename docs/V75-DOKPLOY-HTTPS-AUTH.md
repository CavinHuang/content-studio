# V75 · Dokploy HTTPS 反向代理 + 单管理员认证部署（仅手动部署）

当前仓库的统一 PR #26 仍为 **Draft**。此指南只描述未来的人工部署准备与回归方式，执行 CI 测试不等于实际部署。不要将当前 PR 合并或启用 Dokploy Auto Deploy。

## 部署架构与威胁边界

浏览器必须先经过 HTTPS Traefik 域名，Traefik 将请求转发到 Docker 网络内监听 `0.0.0.0:4312` 的单实例 Next.js。**容器不能通过宿主 `ports:` 公开监听；不得配置 `network_mode: host`。** 登录密码由 scrypt 口令验证器保存于 Dokploy 的受保护环境变量；会话为 8 小时 HMAC-SHA256 签名 `__Host-` Secure、HttpOnly、SameSite=Strict Cookie。密码或签名密钥轮换后现有会话失效（更换签名密钥），单进程全局最多 8 次错误尝试/15 分钟，并且需要在 Traefik 或前置 WAF 补充边缘 IP 限流和日志监控。

使用 Next 16 `proxy.js` 保护页面与业务路由；`dispatchApi` 内部再次强制校验会话，避免只靠代理层做授权。所有远程变更请求必须携带与 `CONTENT_STUDIO_PUBLIC_ORIGIN` 完全一致的 HTTPS Origin 和 JSON Content-Type；Host、X-Forwarded-Host、X-Forwarded-Proto 都必须吻合。任何未配置的密钥或非法部署模式导致启动拒绝。`/api/health` 允许匿名用于健康检查，但不泄露 SHA/运行 nonce；其他 API 未登录为 401，页面重定向至 `/login`。

这是一套**单管理员访问保护**，不是多租户身份平台：不提供 OAuth、密码重置邮件、2FA、IP 级可靠分布式限流、会话服务端强制撤销或用户级细粒度权限。不要将容器连接到对不可信租户公开的共享 Docker 网络。Dokploy 的 Isolated Deployments 优先；运营者仍须审查 Preview Compose 产生的网络和 Traefik 标签以及其他同主机容器的可达性。

## 1. 在本机离线生成凭证

不要通过聊天、Git PR、Docker build args 或 CLI 命令行参数传递真实密码。以下命令在操作者自己的安全终端中以 stdin 输入密码：

```sh
read -r -s -p 'Content Studio 管理员密码（至少16字符）: ' CS_PASSWORD; echo
printf '%s' "$CS_PASSWORD" | node scripts/generate-dokploy-credentials-v75.mjs
unset CS_PASSWORD
```

将输出的 `CONTENT_STUDIO_AUTH_PASSWORD_SCRYPT` 和 `CONTENT_STUDIO_AUTH_SESSION_KEY` **仅**复制到 Dokploy 服务的保密环境变量，不提交任何 `.env` 文件。不要把这些数值展示于聊天/CI 日志。单机 Docker Compose 环境变量可能进入容器 inspect，务必控制 Docker Socket、Dokploy 面板账户、主机 root 和备份权限。更换任何一个凭证后需要单独验证登录。

## 2. Dokploy 创建 Compose（不要选择 Docker Stack）

- 选择仓库 `CavinHuang/content-studio`，固定候选分支和经 CI 验证的 SHA。Compose Path 为 `./compose.dokploy.yml`，部署方式 Docker Compose，单副本，关闭 Auto Deploy。
- Dokploy Environment 中配置 `CONTENT_STUDIO_PUBLIC_ORIGIN=https://studio.example.com`（以实际域名替换，无尾部斜杠、端口或路径），再配置以上两项秘密环境变量。
- 在 Domains 添加**这一项** `content-studio` 服务的自有 DNS 域名，Container Port `4312`，Path `/`，启用 Let's Encrypt HTTPS，HTTP 必须重定向到 HTTPS；建议 HSTS 与 Traefik 前置速率限制。
- 优先开启 Isolated Deployments，使用 Dokploy 的 Preview Compose 确认域名自动注入的 Traefik labels 与网络，同时保证**没有公网 `ports:`、没有其他域名和没有 HTTP 明文路由**。不要添加重复手写 Traefik labels。
- 添加 DNS A/AAAA 指向对应主机，确保服务器有有效 TLS 证书。公共域名应与 `CONTENT_STUDIO_PUBLIC_ORIGIN` 完全一致。
- 数据使用 `studio-data:/app/data` Docker named volume，UID 10001。不能横向扩容 Next.js 多副本共享同一 SQLite 数据库。根据 V74 建立另行备份与恢复任务，不要删除卷或直接文件级复制活跃 WAL。

Dokploy 官方文档说明：Compose 的 Domains 标签在部署时注入；与 Application 不同，域名改动后需重新部署才生效。务必手动确认最终 Preview Compose： https://docs.dokploy.com/docs/core/docker-compose/domains

## 3. Dokploy 配置检查清单

- 确认 HTTPS 访问 `/login` 展示管理员密码输入页面、密码错误返回 401、正确密码进入 `/`。
- 没有 Cookie 时访问 `/` 应跳到 `/login`，访问 `/api/status` 返回 401。匿名 `/api/health` 只返回脱敏存活状态。
- 不匹配 Host / X-Forwarded-Host、无 `x-forwarded-proto: https`、跨站 Origin 与 POST 无 Origin 均应返回 403；无需对外暴露 API key。
- 退出登录后原 Cookie 不能再在浏览器使用；注意这是客户端清 Cookie，密钥轮换才会使所有历史会话失效。需要全局强制登出时更换 `CONTENT_STUDIO_AUTH_SESSION_KEY`。
- 备份卷应由独立维护任务访问；部署镜像不会自动进行备份或恢复。

## 4. CI 验证范围

`npm run test:dokploy:v75` 验证密码哈希、签名和过期、Strict Cookie、Host/Origin/转发协议绕过、绕开 proxy 时 API 拒绝未登录调用；`npm run test:dokploy:real:v75` 在 CI 的合成 SQLite、loopback 端口模拟 TLS 已在反向代理终止，实际启动 Next.js，检查登录/访问权限/跨站写拒绝；`smoke/docker-dokploy-v75.sh` 使用临时合成卷启动镜像并测试安全模式与重启后登录。

CI 模拟的转发头不是真实 TLS 证书和 Traefik 路由，**不能证明用户主机 Dokploy 配置已经正确、对公网安全或可以上线**。实际域名、证书、后端网络、边缘限流、日志和灾备仍需管理员独立验收。所有 merge/deploy/production 授权标记保持 false。

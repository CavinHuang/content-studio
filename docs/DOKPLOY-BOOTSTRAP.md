# Dokploy 临时启动模式（禁止长期公网运行）

本方案用于排除“Dokploy 显示 Deploy Done，但容器 Restarting，公网域名 404”问题。旧的 Dockerfile 发布证明链和运行时 guard 不参与此模式；Next.js 直接执行 `next start`。

**重要风险：这个模式不要求管理员登录，页面及全部业务 API 均可直接访问。公网用户可以读取或修改工作台数据，且可能触发昂贵模型调用。请先禁用公网 Domains 或限制来源访问，仅在短时间内排障。不要加载真实的 AI Provider API Key，不要用真实隐私数据进行测试。临时模式使用全新的 `studio-bootstrap-data` 卷，**不挂载原有的 `studio-data` 正式数据库**；回到正式模式后原卷数据保持不变。确认服务可启动后立即切回正式 HTTPS 认证 Compose。**

## 只用 Dokploy 网页执行

1. 在 Content Studio Compose 服务的 **General** 把 Compose Path 临时改为 `./compose.dokploy.bootstrap.yml`，继续使用现有 PR 分支。**关闭 Auto Deploy**。
2. 不需要再提供 `CONTENT_STUDIO_AUTH_PASSWORD_SCRYPT`、`CONTENT_STUDIO_AUTH_SESSION_KEY`、`CONTENT_STUDIO_PUBLIC_ORIGIN`。临时 Compose 不会把这三项环境变量传给应用。可以保留 Dokploy Environment 中原有值，但出于安全建议轮换曾在聊天记录出现的管理员凭证。
3. 临时撤下对公网的 Domains 路由，或者在入口侧做网络访问限制；不要将无登录保护的编辑 API 长期暴露给互联网。
4. 等待本分支新的 `bootstrap-container-smoke` GitHub Actions 通过。随后点击 **Deploy**（仅用户手动执行）。
5. 先进入 **Monitoring**。预期容器从 Restarting 变为 `running (healthy)`；再查看 **Logs**，应出现 Next.js 正常启动日志，不再出现 `Local runtime denied`。
6. 容器健康后才考虑恢复限时测试域名。测试根路径 `/`、`/api/health`、`/api/status`。此模式不会自动跳转登录页，`/api/health` 返回 `{"ok":true,"mode":"unauthenticated-bootstrap",...}`。
7. 验证成功后，把 Compose Path **切回** `./compose.dokploy.yml`，启用真实登录和 HTTPS 检查，填好正确凭证，重新 Deploy，确保容器健康，再对外开放域名。

## 隔离边界

- `Dockerfile.dokploy.bootstrap`：仅直接编译/启动 Next.js，无 V63 Git 工作树校验、V64 构建收据和 V49 启动拒绝。
- `compose.dokploy.bootstrap.yml`：继续使用非 root 账号、独立空白的 `studio-bootstrap-data` SQLite 命名卷、只读根文件系统、Dokploy 外部网络；**没有宿主机 ports 映射**。
- 只有明确配置 `CONTENT_STUDIO_DEPLOY_MODE=dokploy-bootstrap` 的运行态才绕过 API/页面验证。普通 `dokploy` 模式的认证、CSRF、Host 校验保留，不受此次变动影响。
- CI 独立执行合成环境的 Docker 构建、真实容器启动、health/UI/API 匿名探测，不接触真实数据或生产域名。
- **不要把容器启动成功等同于应用能够安全接入公网；恢复正式模式后重新验证。**

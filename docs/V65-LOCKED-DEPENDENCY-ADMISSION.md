# V65 — npm v3 固定依赖与构建来源验证

本轮沿用统一 Draft PR #26，**不合并 main，不部署，不操作真实私人数据库或任何公众号发布平台**。

## 依赖解析与固定

由 GitHub Actions 的 Node.js 22.16.0 / npm 10.9.2 执行 `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` 生成真正的 npm lockfileVersion=3 的 package-lock.json。此版本记录 58 个条目和 npm Registry HTTPS 包源及 SRI，已提交 Git；临时生成工作流已从分支删除。

此前 CI 使用动态 `npm install --no-package-lock`；当前使用固定 Node 22.16.0 的 `npm ci --no-audit --no-fund`，该命令不会默默修改依赖锁，并会校验获取的 tarball 整体性。CI 还执行纯本地读取的 `npm run release:lock:v65`，拒绝根依赖差异、缺少 SRI、HTTP/Git/file 引用及格式异常的记录。

## 操作者执行

    npm ci --no-audit --no-fund
    npm run release:lock:v65
    npm run release:checkout:v63 -- --sha=$(git rev-parse HEAD)
    npm run build
    npm start

另一个终端可以用 `npm run release:runtime:v64 -- --sha=$(git rev-parse HEAD) --url=http://127.0.0.1:4312/` 检查真实运行进程声明的构建摘要。

## 构建来源保护

V64 的 SHA-256 收据新增 dependencyLockSha256，绑定对应提交已解析的完整依赖清单。启动时再次核对本地锁文件摘要，服务健康信息也包含运行进程声明的摘要，V64 回环端口核验把它与磁盘上的锁文件进行比较；篡改任何传递依赖的哈希值后将不再允许原构建正常启动。

## 局限

锁定依赖图不等于跨平台二进制字节可复现，操作系统和可选原生依赖仍可能导致产物差异；也不证明依赖无 CVE、CI 镜像未被入侵、包源的完整供应链签名、真实外部主机和自动部署钩子已经审查。当前依旧是单用户本地部署版本，不能直接开放公网。

CI 中所有 SQLite、浏览器测试和 doocs/md 测试均使用合成资料或本地服务；`mergeAuthorized=false`、`deployAuthorized=false`、`productionReady=false` 保持不变，发布必须另行获得操作者明确批准。

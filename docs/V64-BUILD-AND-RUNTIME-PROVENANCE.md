# V64 — Next.js 构建文件指纹和运行进程身份核验

V63 已确保操作员源代码仓库的 HEAD 与已评审提交一致，但 `npm run build` 生成的 `.next` 构建目录尚未与此 SHA 绑定，也无法从 `/api/health` 查询进程宣称的构建身份。V64 增加这层技术检查，不改变单用户 localhost 的运行模式。

## 工作原理

1. `npm run build` 仍先运行 V50 的 NEXT_PUBLIC 敏感环境保护，然后启动真正的 Next.js 16 build。**构建开始前会移除过期的旧收据**；成功后 `scripts/build-provenance-v64.mjs` 对 `.next` 中的构建文件逐一计算 SHA-256，并把文件大小与相对路径一起写入 `.next/content-studio-v64-build-receipt.json`，绑定 `git rev-parse HEAD` 与 `.next/BUILD_ID`。缓存目录和 trace 日志不计入指纹。
2. `npm start` 经由 `scripts/runtime-guard.mjs` 在启动子进程之前重新计算构建指纹，要求本地 Git SHA、BUILD_ID 和收据完全一致。篡改、删除、替换或增加被纳入校验的文件会阻止启动。
3. 真正被守护入口启动的 Next.js 子进程得到 Git SHA、构建摘要、BUILD_ID 与本次启动生成的随机 128 位运行标记。仅供本机的 `/api/health` 返回这些**非秘密的自报字段**与实际进程 PID。
4. 操作员使用只读的 `release:runtime:v64` 访问指定的 127.0.0.1 回环端口，将健康接口返回的声明与**再次计算过的本地**构建收据进行比较。查询前后重复检查 V63 清洁 Git 工作区、文件哈希和 SHA；拒绝重定向、非本地端口、伪造的 SHA、摘要、BUILD_ID 及缺失的进程标记。

## 真实主机操作

需要先确保 git 工作区清洁且依赖已安装。当前仓库尚未纳入 npm 锁文件；如需安装依赖，应使用 `npm install --no-package-lock`，避免 npm 自动生成未纳入 Git 的 `package-lock.json` 使 V63 工作区检查失败。此方式**不提供依赖版本可复现性**；后续应将固定的依赖锁文件正式纳入版本控制。在当前完整提交上生成真正的 Next.js 生产包。

    npm run release:checkout:v63 -- --sha=$(git rev-parse HEAD)
    npm run build
    npm start

另一个终端运行：

    npm run release:runtime:v64 -- --sha=$(git rev-parse HEAD) --url=http://127.0.0.1:4312/

`PORT` 自定义时需使用对应端口。既有 `release:prepare:v62` 私有数据库快照及 V61 操作员验收继续保持独立要求。这个运行检查不会自动创建备份或访问云端管理后台。

## 已知安全边界

- **文件哈希收据不是经过可信构建服务器签名的证明。** 拥有本机文件写权限的攻击者仍可能同时替换构建与收据，或绕开 guard 直接启动 next。
- 健康接口返回的 SHA 和 nonce 是*由运行进程声明*的数据，而不是可信执行环境证明，不能独立证明进程二进制未被替换。
- `.next/cache`、trace、node_modules、操作系统加载模块和 `.gitignore` 下的本地数据不在文件哈希范围内。验证完成到实际加载存在潜在时间窗口；应将运行机器视为受信环境。
- 真实托管平台的镜像、容器和 CI 部署产物仍需独立核验；没有任何真实发布、账号登录、收费模型调用、数据库升级或自动合并。
- `mergeAuthorized=false`、`deployAuthorized=false`、`releaseAuthorized=false`、`productionReady=false` 始终固定；Draft PR 未获得任何自动批准。

## CI

离线 `npm run test:provenance:v64` 覆盖 SHA 错位、文件改动/增删、清单伪造、软链接、运行进程伪造标记、恶意 URL 等测试；构建后运行 `npm run test:runtime:v64`，启动真实 Next 生产进程并探测其 Git SHA、BUILD_ID 与文件哈希一致性。CI 仅使用合成内容及临时 SQLite。

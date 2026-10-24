# Content Studio

项目已于 2026-10-24 完全重置（代码与 Git 历史全部清除），进入重新规划阶段。

- 本仓库自此提交起为全新历史。
- 旧代码与旧提交仅存于操作机本地备份分支，未推送远端。
- 新的规划与架构决策确定后，从本文件之上开始重建。

## 开发运行（M1）

要求 Node >= 22.19。

    npm ci          # 安装依赖
    npm start       # 启动应用（开发模式）
    npm test        # vitest 单元 + 渲染进程测试
    npm run e2e     # Playwright Electron 端到端
    npm run typecheck

首次启动选择内容库文件夹；测试可用环境变量 `CONTENTDECK_LIBRARY=<路径>` 直定库根。
内容即文件：每条内容一个文件夹（content.md + assets/），可随时用任何工具打开。

## 依赖与网络

仓库**不带** `.npmrc`：镜像约定属于本机环境，提交到仓库会强制 CI 也走镜像。
CI（`.github/workflows/ci.yml`）显式使用 npm 官方源，`package-lock.json` 的
`resolved` 也指向 `registry.npmjs.org`。

本机重装依赖如需镜像加速，用环境变量临时指定，不要写回仓库：

    # npm 包走 npmmirror（可选）
    npm ci --registry=https://registry.npmmirror.com
    # Electron 二进制走 npmmirror（.npmrc 的 electron_mirror 等价环境变量形式）
    export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
    export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/


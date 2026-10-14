# V63 — 操作员工作区完整性校验

本轮继续在 **统一 Draft PR #26** 中开发；不会合并 main、启动部署或调用实际发布平台。

## 修复的真实风险

此前 V61/V62 多次执行 `git rev-parse HEAD` 与 GitHub 最新 SHA 对照，但 Git 仓库里可能已经存在未提交的脚本、已暂存但未提交的修改、额外的未跟踪文件，甚至使用 Git `assume-unchanged` 或 `skip-worktree` 把改动隐藏在状态查询之外。以上情况下，GitHub CI 的绿色结果只验证原始提交，不能证明本机执行了同一份代码。

V63 将 V61 的 `requireLocalHead` 改为重复执行严格的 `verifyCleanCheckout`，V62 因为依赖该函数，也自动继承校验。首次 GitHub API 查询和真正读取用户数据库之前就会拒绝本地不一致；创建备份后、V55/V60 演练前后还会重复检查。

## 使用方法

在受信操作员主机上，检出当前 Draft PR 的 **完整** SHA，然后运行：

    npm run release:checkout:v63 -- --sha=$(git rev-parse HEAD)

该命令只读取 Git 本地状态，不接触数据库或远端 API。通过时输出状态 JSON；失败只输出通用警告，不暴露未跟踪文件名、隐私文件路径或源代码片段。

操作员接着运行 V62 一站式备份验收命令：

    npm run release:prepare:v62 -- \
      --sha=$(git rev-parse HEAD) \
      --db=/private/content-studio.sqlite \
      --backup-dir=/encrypted/release-backups \
      --review=/encrypted/v55.operator-review.json \
      --scratch-dir=/encrypted/release-scratch

路径为示例。真实主机需事先准备受保护加密备份和临时目录，并由有权限者独立审查外部托管平台自动部署行为。

## 严格的本地审查范围

- `git rev-parse --show-toplevel` 要求执行目录就是工作区根。
- `git rev-parse --verify HEAD^{commit}` 必须等于显式指定的 40 位小写 SHA。
- `git status --porcelain=v1 -z --untracked-files=all --ignore-submodules=none` 必须为空，同时拒绝已暂存、已修改、已删除和额外未跟踪文件。
- `git ls-files -v -z` 中不得存在 assume-unchanged 或 skip-worktree 标志，防止利用索引隐藏已编辑脚本。
- 本地 Git 子进程清除 `GIT_*` 环境变量，并禁用可造成状态缓存不新鲜的 fsmonitor/untrackedCache。测试采用临时真实 Git 仓库，避免依赖真实主机内容。

## 不提供的证明

该工具不会扫描被 `.gitignore` 排除的私有数据库和本机依赖，也不能证明 `.next` 二进制构建来源、正在运行的服务进程来自当前提交，或第三方 hosting/webhook 管理后台已完成审查。Git 工作区可能在两次检查之间短暂发生变化，因此受信主机仍需确保无并行修改。

CI 新增 `npm run test:checkout:v63`，覆盖 10 种场景，含工作区修改、stage、untracked、假装未改动的 Git index flags、环境覆盖及子目录执行。

`mergeAuthorized=false`、`deployAuthorized=false`、`productionReady=false` 永远不因这项本地检查转为 true。PR 必须保持 Draft，直到实际数据备份与独立人工上线审批完成。

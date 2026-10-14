# V59 — GitHub 最终提交 CI + 操作者证据联合核验

本阶段在 **原统一 Draft PR #26** 中新增可在操作者主机执行的只读远端检查，不修改 main 或真实数据库，不自动触发任何发布操作。

## 要解决的风险

此前 V54 验证 Git 祖先，V55–V57 验证本地 WAL 备份、恢复和正式 Next.js 进程，V58 校验本地 API。但 GitHub Actions 可能出现同一提交一次通过、另一次失败；并且历史绿色 CI 不代表当前 HEAD 仍然相同。V59 将 GitHub 最新提交身份和相应的 CI 实际运行绑定，并与受保护的 V55 操作者记录进行一致性比对。

## 操作者执行

在独立安全环境中确认并固定 PR 当前完整 SHA：

    git fetch origin --prune
    git checkout feat/v54-consolidated-integration-gate
    git pull --ff-only
    git rev-parse HEAD

由操作者依照 V55 说明，在受信主机创建 WAL 安全备份、检查原始库与备份的行级内容，并生成 **当前同一 SHA** 的 V55 evidence JSON。备份应位于受保护/加密的位置，V55 临时副本可能包含未加密内容。

    npm run release:evidence:v55 -- --db=/trusted/content-studio.sqlite --backup=/protected/backup.sqlite --review=/protected/operator-review.json > /protected/release-evidence.json

完成后使用：

    npm run release:remote:v59 -- --sha=$(git rev-parse HEAD) --operator-evidence=/protected/release-evidence.json

如果暂时没有真实操作员证据，可以不提供 --operator-evidence 仅查看 GitHub 检查状态，但此时技术证据不齐全，命令返回非零退出码。对公开仓库允许匿名查询；GitHub API 速率限制或已授权环境需要设置仅供该命令使用的 GITHUB_TOKEN。**切勿粘贴令牌、原始数据库、操作者路径或原始 JSON 到 PR。**

## GitHub 验证规则

只访问 api.github.com 的固定仓库只读端点：PR #26、当前集成分支、main 和按 SHA 查询的 Actions 运行。要求：
- PR 为 open + Draft、尚未合并，base 指向正确的仓库 main、head SHA 和分支名称一致。
- GitHub 分支 HEAD 必须等于显式传入的 SHA，且 main 尚未改变自 V54 审查基线。
- 精确匹配 .github/workflows/ci.yml 同一分支/仓库的 push 和 pull_request 事件；要求各自最新匹配运行均为 completed/success，PR 运行关联 #26。
- 失败、进行中、错误工作流路径、错 SHA、错分支/仓库、PR 关闭或非 Draft 均不得获得绿灯。
- 可选 V55 包必须与同一 SHA 和主分支绑定，所有本地恢复证据与作者手动申明字段齐全且不得自行声明已授权部署；仅判断文件形状及一致性，不独立证明报告来源。

## 安全与界限

- CI **只跑离线 mock 的 11 项自动化回归测试**：npm run test:release:v59，不在 Actions 中读取真实宿主机资料或访问 GitHub 远端 API。
- 使用固定域名及限定端点、仅 GET、禁止重定向、8 秒超时，网络失败返回通用错误，不打印令牌和私有路径。
- 本命令即使输出 technicalEvidenceComplete=true，也不代表 webhook 或外部部署配置经独立审查，更不代表操作者身份、审批、生产升级、微信/知乎发布或收费模型测试通过。
- 始终令 releaseAuthorized、mergeAuthorized、deployAuthorized、productionReady 为 false。管理员仍需核对外部托管自动部署、备份权限与撤销方案，提交明确批准后再考虑人工合并；本轮不会执行任何合并或部署。

## 验证命令

    npm run check
    npm test
    npm run test:release:v59
    npm run build
    npm run test:production
    npm run test:staging:v57

V59 属于最终上线前的操作员工具，不代替真实生产主机验收。

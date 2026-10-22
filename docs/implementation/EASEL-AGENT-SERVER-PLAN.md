# 服务端写作 Agent 产品·本期切片方案（EASEL-AGENT-SERVER-PLAN）

> 基线（2026-10-22 复核）：工作区 HEAD = `3d48afe83a03a42262d1564f5e3dc4d925bf4e09`，
> 分支 `feat/easel-port-phase2`（`git rev-parse HEAD` / `git branch --show-current` 实测；
> 工作树仅有 `docs/implementation/EASEL-PORT-PLAN.md` 一处未提交修改）。
> Run A/Run B 基线、PR #51 状态 OPEN、e2e 计数 29 等口径引自 Phase 2 规格附注
> （§10 基线节），本文未重跑 `gh` 逐一复核。

## 0. 一句话定位

让**远程登录作者**能稳定地驱动多步写作 Agent：流不冻、断线自愈、重部署后可重驱动，
且整条链路（作者会话 × 传输校验 × 每作者 workspace × NDJSON 流）有真实进程级自动化验证——
**本期只修"远程下会坏"的部分，不堆新功能**。

## 1. 硬约束与预算（违反即方案无效）

- 本期新增施工项 **3 个**（SA-01/02/03）；加上 Phase 2 三项（P2-01/02/03，规格见
  `EASEL-PORT-PLAN.md` §5；名册已回写同步：该文档 §3/§10.2 现记 Run B 共 6 项、
  AG-01/AG-02 移出本期），总施工项 **= 6 ≤ 6**。
- **禁止改 SQLite schema**：`agent_runs`/`agent_run_steps` 表保持
  `src/agent-runtime.mjs:33-48` 的现有 DDL 不动；续跑溯源走步骤行（§SA-02），不加列。
- **禁止新开公开端点**：三项全部复用既有路由——事件流是既有
  `GET …/agent-runs/:runId/events`（`lib/creator-api.mjs:36-75`）加查询参数，
  续跑是既有 `POST …/agent-runs`（:28-31）加请求体字段；无任何新 path/方法。
- **V75/V58 边界一律不碰**：远程写继续走 `validateRemoteWrite`（精确 HTTPS Origin +
  JSON content-type + 禁导航式提交，`src/remote-auth-v75.mjs:158-166`；MULTIUSER 路径
  在 `src/local-api-boundary.mjs:91-93` 强制）；传输三重校验双层执行不变
  （`proxy.js:14-15` + `lib/api.mjs:30-31`，边界校验先于 SQLite 打开）。
- 复用既有 API 与组件；Next.js 16 App Router 单前端；AGPL gzh-design 不搬；
  不触碰发布阶段、`expectedRevision`/保存/decide/master-sync 语义、导出 gate 4 处
  （`WritingWorkspace.jsx:1728/:1747/:1754/:1787`）与 `goStage` 不重挂载约束
  （同 `EASEL-PORT-PLAN.md` §10.4 对 P2 三项的约束，本切片同守）。
- 不新增 NDJSON **领域事件 kind**：SA-01 的心跳是**空行字节**（见 §SA-01），不是新事件；
  客户端解析已天然忽略空行（`components/AgentRuns.jsx:28` 的 `if(line.trim())`）。

## 2. 远程勘察结论（本次逐条在 HEAD 复核）

**今天能用**（均已读码证实）：

- Agent 运行全生命周期 API：POST/GET `…/agent-runs`、GET run、POST cancel
  （`lib/creator-api.mjs:25-35` → `src/agent-runtime.mjs:144-187`）；NDJSON 流带
  seq 游标增量（`runSince`，`src/agent-runtime.mjs:118-128`）、`run_done` 终态帧
  （`lib/creator-api.mjs:59-61`）、客户端断开即停推（:39-41,68-72）、
  `application/x-ndjson` + no-store + nosniff 头（:74）。
- 安闸门全在服务端：consent 403（:151）、expectedRevision 409（:154）、同稿同渠道
  单飞 409（:155-156）、24 步上限（:18,:200,:233）、连续 3 次模型失败熔断（:210-216）、
  执行期逐次复核工具白名单/写模式（:242-250）、正文漂移 409→interrupted（:257-260）。
- 循环与 HTTP 解耦：`startRun` 把 `_loop` 挂到后台 `loopPromises`（:169-175），
  浏览器断开不影响运行本身——远程可用的重要正面事实。
- 轨迹持久化：步骤落 `agent_run_steps`（:129-132），重启把 running 改 interrupted
  （:49-51，测试 `test/agent-runtime.test.mjs:30-36`）；完成后仍可远程读全轨迹。
- MULTIUSER 线上拓扑：`proxy.js:12-24` 作者会话分支 + `lib/api.mjs:47-49` 会话复核后
  `getAuthorCore` 每作者独立 SQLite（`lib/core.mjs:52`）。

**远程会坏**（三大 high 缺口，全部本次读码证实）：

1. **流式可靠性**：事件流 600s 硬截止静默关流（`lib/creator-api.mjs:37`，到点仅
   `controller.close()` :69-70，无终止语义）；流内无心跳字节，仅在有新步骤时 emit
   （:51-63，轮询间隔 800ms）；客户端只接一次流、流结束后仅整体拉取一次 run
   （`components/AgentRuns.jsx:23-31`），**没有用服务端已支持的 seq 游标自动重连**；
   模型调用静默期最长 120s + 配图更久，Traefik/Dokploy 缓冲与空闲超时行为仓库内零证据。
   另：面板挂载时只拉技能与代理配置，**不拉最近运行**（`AgentRuns.jsx:14-17`）——
   刷新页面后进行中的运行在 UI 里直接消失。
2. **中断无恢复**：重启/重部署一律把 running 改 interrupted 终态（:49-51），无 resume；
   `binding_json` 已随行持久化（:42,:159-162）却无消费方；对照写作生成有 `resumeOf`
   续跑先例（`src/writing.mjs:149-176`）。`stop_grace_period: 20s`
   （`compose.dokploy.yml:58`）意味着**每次发版都会杀掉在跑循环**。
3. **线上拓扑测试真空**：唯一 agent 路由测试直接调 `dispatchApi` 绕过 proxy/TLS
   （`test/agent-runtime.test.mjs:148`）；dokploy 冒烟不含 agent 端点且明言
   "simulated HTTPS headers, NO public TLS"（`smoke/dokploy-auth-v75.test.mjs:1-4`）；
   e2e 走的是 MULTIUSER 但 DEPLOY_MODE 为空（`e2e/agent-runtime.spec.mjs:97`）——
   「dokploy 传输校验 × 作者会话 × per-workspace core × agent NDJSON」这条真实路径
   无任何自动化验证。

## 3. 切片决策

| 缺口 | 施工项 | 一句话 |
|---|---|---|
| 流式可靠性（high） | **SA-01** | 服务端空行心跳 + `?since=` 续读；客户端基于 seq 游标自动重连 + 挂载时接续**本渠道**进行中的运行 |
| 中断无恢复（high） | **SA-02** | 既有 POST 加 `resumeOf`：按原技能/绑定重驱动，溯源记为步骤行 |
| 拓扑测试真空（high） | **SA-03** | dokploy+MULTIUSER 模拟 HTTPS 头真实进程冒烟：登录→存稿→发起→NDJSON→取消→负例 |

**与 §10.3 的关系**：`EASEL-PORT-PLAN.md` §10.3 起草的 AG-01/AG-02（`article-pipeline`
全流程技能）是**新功能**，本期预算（3 项）全部让位给上述远程可靠性修复，AG-01/AG-02
移出本期、设计原样保留（见 §7 Out of Scope 第 1 条）。若操作者坚持本期做 pipeline
技能，则三项可靠性最多保留其一——不建议：三个缺口全是"远程第一次真实使用就会踩"的问题。

## 4. 施工详单

### SA-01 事件流心跳 + 客户端 seq 游标自动重连 + 刷新接续（风险：medium）

**做什么**

1. **服务端心跳（零新事件 kind）**：`lib/creator-api.mjs` events 分支（:36-75）内，
   记录 `lastEmit` 时间戳；每轮 800ms 轮询后若距上次发射 ≥ 心跳间隔且无新步骤，
   `controller.enqueue(encoder.encode("\n"))` 发射**空行**。字节水存在，代理层看到
   字节流动；客户端既有解析按 `line.trim()` 过滤空行（`AgentRuns.jsx:28`），curl/cossumer
   语义不变。心跳间隔取模块常量
   `Math.max(3000, Number(process.env.CONTENT_STUDIO_AGENT_STREAM_HEARTBEAT_MS) || 15000)`
   （非 secret、非 NEXT_PUBLIC 的服务端可调参数，默认 15s；仅为可测试性开放覆盖，
   build-guard 规则不受影响）。
2. **服务端续读游标**：同一分支把 `let seq = 0`（:44）改为
   `const since = Number(u.searchParams.get("since")); let seq = Number.isInteger(since) && since >= 0 ? since : 0;`
   ——既有 `runSince(projectId, runId, afterSeq)`（`agent-runtime.mjs:118-128`）本就
   支持游标，此处只是把查询参数接上；`u` 在 `creatorApi` 作用域已有（:12）。
   600s 截止保持不变：它是**单连接**寿命上限，配合 3 的重连后不再是"运行可见性的上限"。
3. **客户端自动重连**：`components/AgentRuns.jsx` 的 `follow(id)`（:23-31）改为
   `follow(id, since = 0, attempt = 0)`：
   - 逐帧维护 `lastSeq`：**只有步骤帧（runSince 投影行）携带 `seq`**；`run_done`
     （`lib/creator-api.mjs:60`）与 `error`（:66）帧均不含 `seq`——**无 `seq` 的帧
     跳过游标更新**（防止 `undefined` 写入游标），空行同样跳过；防御性去重：
     `seq <= lastSeq` 的帧不追加；
   - 流自然结束（done）或 fetch 非 ok/网络错误：先 `GET …/agent-runs/:id` 整体刷新
     （既有端点，:29 同形态），**刷新后回填游标：`lastSeq = max(刷新结果 steps 的
     seq, lastSeq)`**（与第 4 点挂载路径同一取法）——否则断流期间新落库的步骤已被
     刷新整体并入组件 state，而重连流按 `seq > since` 重放（`agent-runtime.mjs:126`），
     时间线会出现重复条目；随后若 `status === 'running'` 且 `attempt < 5` 且组件仍
     挂载，按退避 `[1s,2s,4s,8s,15s]` 以回填后的 `lastSeq` 调
     `follow(id, lastSeq, attempt + 1)`；
   - 退避耗尽仍失败：`onNotice('实时进度连接已断开，运行仍在服务端继续；请刷新页面查看轨迹。')`
     ——如实措辞，不伪造进度（循环与 HTTP 解耦是既有事实，`agent-runtime.mjs:169-175`）；
   - 401 沿用既有 api 助手语义跳 /signin（:8）；events 的裸 fetch 需补同等的 401 分支。
4. **挂载时接续最近运行**：`AgentRuns.jsx` 挂载 effect（:14-17）在拉技能/配置的同一
   `Promise.all` 后追加 `GET …/agent-runs`（既有端点，`lib/creator-api.mjs:32`；
   服务端按 rowid DESC LIMIT 20 返回含步骤列表，`agent-runtime.mjs:81-105`，**列表
   不分渠道**；组件持有所在渠道 prop——`WritingWorkspace.jsx:2341-2346` 已传
   `channel`）：**仅过滤 `channel === props.channel` 且 `status === 'running'` 的
   运行**，取最新一条 `setRun` 并以其 `max(steps.seq, 0)` 为游标 `follow(id, lastSeq)`；
   **不回落展示其它渠道或终态运行**——跨渠道附着会渲染出错误上下文的「取消运行」
   按钮（单飞门禁按 project+channel 划分，`agent-runtime.mjs:155-156`，取消是破坏性
   入口），终态运行若每次挂载重现「运行完成/未完成」提示（:74）会改变面板初始为空
   的既有语义。效果：刷新页面 / 代理掐流后重开页面，**本渠道**进行中的运行自动重新
   附着；其它渠道与历史终态运行维持现状（不经本面板，入口留后续期）。
5. UI 状态文案：重连期间在步骤时间线上方显示一行 `writing-source-note` 小字
   「进度连接重连中（第 N 次）…」，终态后消失；不新增停止入口（既有取消按钮 :71 是
   唯一停止入口，P2-03 的 pill 语义不受影响）。

**接哪些既有端点**：`GET …/agent-runs`（列表）、`GET …/agent-runs/:id`（整体刷新）、
`GET …/agent-runs/:id/events?since=N`（同一路由加查询参数）。无新端点、无 schema 变更、
无新事件 kind（心跳是空行）。

**怎么验收**

- 单测（`test/agent-runtime.test.mjs`，沿用 :145-168 的 dispatchApi 直调形态）：
  - `?since=` 语义：跑完一次运行后 `GET events?since=<末seq>`，流应立即只收到
    `run_done` 帧、不重放已消费步骤（对照 :345-379 已有 runSince 域级游标分区断言，
    此处在 HTTP 层复证一次）；
  - 心跳：以 `CONTENT_STUDIO_AGENT_STREAM_HEARTBEAT_MS=3000` 启动用例（公式下限即
    3000ms，更小值会被 `Math.max` 抬到 3000，验收不得按 200 断言周期），gated
    provider 挂住模型调用，在 ≥8s 读窗口内断言无步骤期间周期性读到 ≥2 个空行帧
    （read 不超时）；
  - 既有 :145-168 断言（流头、终态等待）零回归。
- e2e（`e2e/agent-runtime.spec.mjs`）：既有用例（:181-231）全绿零改动为回归底线；
  新增一条「刷新接续」用例：合成 provider 对含特定指令标记的任务把工具结果调用挂起
  数秒 → 启动运行 → `page.reload()` → 断言面板自动恢复显示该 running 运行与已有步骤
  → 放行 provider → 运行在页面上走到完成。断言落点：`.agent-run-steps` 步骤数、
  `writing-source-note` 的完成文案（:74 形态）。
- 诚实性：重连失败文案不得暗示"已暂停/已失败"——运行仍在服务端继续。
- `npm run check`、`npm test`、`npm run build`、`npm run test:e2e` 通过；QA 记录进
  `docs/implementation/CREATOR-V2-QA.md`（新增「Run B · 服务端 Agent 切片」小节）。

**files**：`lib/creator-api.mjs`、`components/AgentRuns.jsx`、
`test/agent-runtime.test.mjs`、`e2e/agent-runtime.spec.mjs`、
`docs/implementation/CREATOR-V2-QA.md`

### SA-02 中断/失败运行的重驱动（resumeOf，风险：medium）

**做什么**

1. **领域层**（`src/agent-runtime.mjs` `startRun` :144-176）：请求体新增可选
   `resumeOf: "ar_…"`（对照 `src/writing.mjs:149` 先例）：
   - 存在即校验：`old = this.run(projectId, resumeOf)`（不存在自然 404）；
     `old.channel === channel` 否则 409「续跑须沿用原渠道」；
     `old.status ∈ {interrupted, failed}` 否则 409（completed/cancelled/running 均不可
     续跑——cancelled 是作者显式意图，与 writing 先例 :163 的口径一致）；
     技能取 `skillById(old.skill_id)`（客户端传入的 `skillId` 若与 `old.skill_id` 不符
     则 409「续跑须沿用原技能」；缺省则直接用原技能）。
   - **binding 复用**：`binding = JSON.parse(old.binding_json)`。**该列 DDL 默认
     `'{}'`（:42）**，解析结果无 `id` 字段即视为原运行无可用绑定，**409「原运行无
     可用模型绑定，请直接重新发起」**——不建跑、不留必然失败的轨迹（captureBinding
     产物必含 `id: row?.id || "platform"`，`src/creator-services.mjs:341-359`；
     手工插入的 stale 行如 `test/agent-runtime.test.mjs:32` 即 `'{}'`）。有效绑定
     则复用；若原连接/模型事后被停用，V76 指纹校验在调用时 fail-closed、运行如实
     failed（同 `src/writing.mjs:175` 复用 saved.binding 的语义），不静默换模型。
     首次运行（无 resumeOf）仍走 `captureBinding("text")`（:157）。
   - 既有门禁全部照旧适用于续跑：consent 403、markdown 模式 409、**当前** 正文
     expectedRevision 409（:151-154）、同稿同渠道单飞 409（:155-156）——续跑以**当前
     正文**为基准开新运行，不是断点续传。
   - **溯源（零 schema 变更）**：插入新 run 行后、进入循环前记一行步骤
     `{kind:"resume", payload:{resumeOf: old.id, baseRevision: doc.revision}}`；
     `_loop` 增加起始 seq 参数（默认 0）避免与 `PRIMARY KEY(run_id,seq)` 冲突。
     该行随既有 `run()/runs()/runSince` 投影与 NDJSON 流自然透出，UI 时间线可见。
2. **UI**（`components/AgentRuns.jsx`）：
   - `renderStep`（:40-61）新增 `resume` 分支：显示「从运行 ar_…（原状态）继续，
     基准修订 N」；
   - 终态提示区（:74）当 `run.status ∈ {interrupted, failed}` 时渲染按钮
     「按原技能与模型绑定重新驱动」+ 说明小字：「以当前正文为基准开启一条新运行；
     原运行轨迹保留可查，已入库的建议/修订不受影响。」点击 = 复用表单当前值 +
     `skillId: run.skillId` + `resumeOf: run.id` 走既有 `start()`（consent 勾选仍必填，
     费用同意逐次有效）。
3. **诚实性**：所有文案不出现"断点续传/自动恢复"；interrupted（正文漂移）场景明确
   提示先核对正文再重驱动；partial 产出（已入库建议/修订）如实保留可审。

**接哪些既有端点**：仅既有 `POST …/agent-runs`（`lib/creator-api.mjs:28-31` 的 body
原样透传 `core.agent.startRun`，路由层零改动）；读取仍用既有 run/runs/events。

**怎么验收**

- 单测（`test/agent-runtime.test.mjs`）：
  - 重启造 interrupted（:30-36 形态 reopen）→ `startRun({resumeOf})` 跑到 completed，
    首步骤 `kind==='resume'` 且 `payload.resumeOf === 旧id`，两次运行的产出建议共存；
  - 409 矩阵：completed / cancelled / running / 渠道不符 / 技能不符 / 当前正文
    expectedRevision 不符 / **binding_json 为 `'{}'`（DDL 默认，:32 stale 夹具形态，
    断言不新建运行行）**；404：不存在的 resumeOf；403：未勾 consent；
  - binding 复用：平台绑定（CONTENT_AI 合成域）下续跑调用确实复用原 binding_json
    （断言 fetchImpl 收到的请求头/体一致）。
- e2e（`e2e/agent-runtime.spec.mjs`）：既有完成态运行下**不**出现重驱动按钮
  （回归守卫）；interrupted 态在 e2e 中难以真实构造（需进程重启），语义由上述
  node 测试承载——QA 如实记录此覆盖边界，不虚报 e2e 覆盖。
- `npm run check`、`npm test`、`npm run build`、`npm run test:e2e` 通过；QA 记录同 SA-01 小节。

**files**：`src/agent-runtime.mjs`、`components/AgentRuns.jsx`、
`test/agent-runtime.test.mjs`、`e2e/agent-runtime.spec.mjs`、
`docs/implementation/CREATOR-V2-QA.md`

### SA-03 dokploy+MULTIUSER 拓扑冒烟：登录→存稿→发起→NDJSON→取消（风险：low，纯测试）

**做什么**

新增 `smoke/dokploy-agent-multiuser-v76.test.mjs`，模式照抄 `smoke/dokploy-auth-v75.test.mjs`
（真实 Next 进程经 `scripts/runtime-guard.mjs start` 拉起 + 模拟 HTTPS 头 :50-53 +
Set-Cookie 手工回填 :95），叠加 `e2e/agent-runtime.spec.mjs:15-109` 的合成回环模型
provider（`CONTENT_AI_BASE_URL=http://127.0.0.1:<port>/v1/`，回环 http 先例 :100）。
环境：`CONTENT_STUDIO_DEPLOY_MODE=dokploy` + `CONTENT_STUDIO_MULTIUSER=1` +
`CONTENT_STUDIO_REGISTRATION_OPEN=1`（仅合成环境）+ V75 凭据 env（:34-44 形态）。

覆盖链路（全部带 `host`/`x-forwarded-host`/`x-forwarded-proto` 传输头穿过 proxy.js:14-24
与 dispatchApi 双层校验）：

1. 匿名：`/api/health` 200 且 `runtimeBuild === null`（`lib/api.mjs:33`）；
   `GET /api/creator/agent-skills` → 401（`proxy.js:20`）。
2. 作者注册/登录（`/api/accounts/register|login`，`lib/api.mjs:37-41`；dokploy 下注册门
   :38 要求 REGISTRATION_OPEN=1）→ 断言 `__Host-studio_author` cookie 的
   Secure/HttpOnly/SameSite=Strict。
3. 登录态：技能列表 200 且 7 个技能；经 `/api/writing/projects` 建稿、PUT markdown
   （精确 Origin + JSON content-type，命中 `validateRemoteWrite`）。
4. **发起 agent 运行**（POST agent-runs + consent）→ 201、status running；
5. **读 NDJSON 流**（GET events，带同一套传输头）→ 断言 `content-type:
   application/x-ndjson` + nosniff、逐步读到 `run_done`、步骤非空——这是
   「agent NDJSON 过传输校验」的第一条自动化证据；
6. **取消**：第二用例用 gated provider 挂住运行 → POST cancel → cancelled，
   流以 `run_done(cancelled)` 收尾。
7. **负例**：跨站 Origin 的 POST → 403；`text/plain` 写请求 → 403/400（V58 JSON-only）；
   伪造 `x-forwarded-host` → 403（:101-102 形态）。
8. **workspace 隔离**：注册第二名作者 → 对第一名作者的项目 id `GET …/agent-runs`
   → **200 且 `runs: []`**（列表走 `core.agent.runs(projectId)`，无行早退返回空数组，
   `src/agent-runtime.mjs:85`，不是 404）；再对编造的运行 id 具名
   `GET …/agent-runs/ar_<编造>` → **404**（具名走 `run()`，
   `src/agent-runtime.mjs:106-108`）——两个断言共同证实每作者独立 SQLite 的结构性
   隔离，经真实 HTTP 路径首次验证。

`package.json` 增加脚本 `"test:dokploy:agent": "node --test smoke/dokploy-agent-multiuser-v76.test.mjs"`
（与既有 `test:dokploy:v75` / `test:dokploy:real:v75` 命名同级）。

**诚实边界**：文件头注释照抄 :1-4 的免责声明——模拟 HTTPS 头、**无真实公网
TLS/Traefik**；Traefik 对空闲流/缓冲的真实行为本冒烟不能证明（见 §8 操作者清单）。

**怎么验收**

- `npm run test:dokploy:agent` 本地全绿（需先 `npm run build`，runtime-guard 校验
  V64 receipt；与 `test:dokploy:real:v75` 同类，非 CI 单测，QA 如实记录运行环境）；
- `npm run check`、`npm test`、`npm run build` 通过；既有
  `test/agent-runtime.test.mjs`、`e2e/agent-runtime.spec.mjs` 零回归；
- QA 记录：实际执行的命令、环境（Node 版本、是否 Docker 外真机）、负例矩阵结果。

**files**：`smoke/dokploy-agent-multiuser-v76.test.mjs`（新建）、`package.json`、
`docs/implementation/CREATOR-V2-QA.md`

## 5. 不变量护栏对照（本切片）

- **四项人工检查按渠道独立 / 导出 ≠ 发布**：三项均不触碰 compose 阶段、检查状态与
  导出 gate；SA-02 文案止于「已入库的建议/修订」，不出现「已发布/可发布」。
- **AI 输出是假设**：SA-02 续跑仍先入待采纳区/新修订，`expectedRevision` 链零改动
  （409→interrupted 语义保持，`agent-runtime.mjs:257-260`）。
- **V76 模型 provenance**：SA-02 复用原 binding 而不是静默换模型，指纹 fail-closed
  语义不放松；run 投影回传模型名/连接名摘要留待下期（§7 第 2 条）。
- **单前端/不重挂载**：SA-01/02 的改动全部在 `AgentRuns` 组件内部与其数据获取，
  不触碰 `goStage`/阶段状态机/编辑器挂载。
- **V49 单进程持久磁盘**：不引入队列/多副本；后台循环与 workspace core 进程态结构
  保持（§7 第 3 条解释为何"后台化"是反向指标）。

## 6. 验收命令（每个 workItem 完成时）

```
npm run check
npm test
npm run build
npm run test:e2e          # e2e/agent-runtime.spec.mjs 与 /compose 相关 spec 必须全绿
node --test test/agent-runtime.test.mjs        # SA-01/02 定向调试
npx playwright test e2e/agent-runtime.spec.mjs # SA-01/02 定向调试
npm run test:dokploy:agent                     # SA-03（新脚本，先 npm run build）
```

QA 记录统一追加进 `docs/implementation/CREATOR-V2-QA.md` 新设「Run B · 服务端 Agent
切片」小节，如实记录降级、覆盖边界（SA-02 的 e2e 覆盖限制）与未验证环境项。

## 7. Out of Scope（明确不做与理由）

1. **`article-pipeline` 全流程技能（AG-01/AG-02，`EASEL-PORT-PLAN.md` §10.3）**：
   新功能；本期预算（3 项）全部给远程可靠性。其设计（编排即技能、零端点零 schema、
   三处技能数断言 7→8）原样保留，**下期首位候选**——届时 SA-01 的可靠流与 SA-02 的
   重驱动恰好是其运行前提。
2. **Agent 运行 pin V76 开放模型 + 投影回传模型 provenance**（勘察 gap 6）：真实缺口
   （`agent-runtime.mjs:157` 固定 selected 默认模型；:98-115 投影不含 binding/model），
   但不是"远程会坏"；SA-02 的 binding 复用与其正交。留待下期与 pipeline 技能同批。
3. **后台化长任务 / 任务队列 / 多副本**：与 V49 单进程持久磁盘约束直接冲突
   （`boundaryRules` 单进程条款：多副本即破坏单飞与限速语义）。本期以 SA-02 把
   重部署损失降为"一键重驱动"，不做队列。
4. **多用户规模与审计增强**（core 缓存 100 上限不淘汰 `lib/core.mjs:52`、
   `agent_runs.owner` 为进程级随机 UUID `agent-runtime.mjs:32,162`）：改 owner 语义
   涉及审计口径的产品决策，且在"不改 schema"约束下只能部分做；留下期。
5. **单次模型调用时长预算可配置化**（120s 硬超时 `creator-services.mjs` 命中超 3 次
   即整跑 failed）：涉及计费与体验权衡；短期由 SA-02 重驱动兜底。
6. **运行轨迹/产物包导出**（zip 先例 `lib/creator-api.mjs:110-119`）：low；本期产物
   = 应用内可见的轨迹 + 建议/修订；导出须带「导出 ≠ 实际发布」标注，留下期。
7. **公网注册面收紧**：非代码缺陷——`compose.dokploy.yml:34-38` 注释已写明首位作者
   注册后须置 `CONTENT_STUDIO_REGISTRATION_OPEN=0` 并重部署；列入 §8 操作者行动项。
8. **Traefik/Dokploy 真实缓冲与空闲超时验证**：本机不可验证；SA-03 只覆盖应用层，
   真实域验证列入 §8 操作者清单。
9. 既有不包含项维持：xhs 渠道布局（Phase 5）、版本 diff 与 confirm 替换（Phase 4）、
   CreatorHome 改版（Phase 3）、检查快照绑定（Phase 6）、AgentRuns 卡片化（Phase 7）。

## 8. 操作者行动项（非本期代码，部署侧）

1. 首位作者注册完成后立即置 `CONTENT_STUDIO_REGISTRATION_OPEN: "0"` 并重新部署
   （`compose.dokploy.yml:34-38` 注释自认；当前线上为 "1"，公网任何人可自建作者空间）。
2. 真实域流式验证（一次性手工）：部署 SA-01 后经真实 Traefik 域名
   `curl -sN https://<域名>/api/creator/projects/…/agent-runs/…/events` 挂住一次
   running 运行 ≥ 15 分钟（跨一次心跳周期与一次 600s 截止 + 客户端重连），确认
   Traefik 不缓冲掐流；结果记入 QA。此为本切片唯一无法在仓库内自动化的验证。
3. 边缘/WAF 限速与 Dokploy 实际路由核对（AGENTS.md V75 既有操作者责任，维持）。

## 9. 假设与未决

- 心跳空行对 Traefik 是否足够**未验证**（§8 第 2 条的实测是唯一裁决方式）；若实测
  仍被缓冲，后备方案是把心跳升级为带 `X-Accel-Buffering: no` 响应头 + 考虑分块语义，
  属 SA-01 施工内的既有响应头调整（:74 的 headers 处追加），不改变本方案结构。
- SA-01 重连上限（5 次/约 30s 退避）与心跳间隔（15s）为初值，施工时按 e2e 实测微调，
  记 QA。
- 本方案引用行号均在 HEAD `3d48afe` 复核；P2 三项施工会漂移 `AgentRuns.jsx` 之外的
  行号，但 P2-01/02/03 均不触碰本切片文件（`lib/creator-api.mjs`、`agent-runtime.mjs`、
  `AgentRuns.jsx` 仅 P2-03 的 pill 导航间接引用助手面板），冲突风险低；若同分支叠加
  施工，以"先合入方为准、后方 rebase 后复核锚点"处理。

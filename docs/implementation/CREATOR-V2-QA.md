# Creator V2 QA 记录（CREATOR-V2-QA）

> 记录本分支（`feat/creator-v2-real-workspace`）实现与验收期间实际执行的命令与结果（PASS/FAIL）、基线豁免说明、截图索引与异常降级记录。
> 所有日志原始文件在 `.superpowers/`（gitignore:38，不入库；本文引用其路径与关键输出行作为留档索引）。留档时间均为 2026-10-19 ~ 2026-10-20。

## 1. 环境

- **宿主**：Windows（win32 10.0.26300 x64），Git Bash + Docker Desktop；宿主 shell 不跑 POSIX 安全门禁（`scripts/runtime-guard.mjs` 等在 Windows 宿主必然 fail）。
- **核心验证环境**：Linux 容器 `node22-studio:pw`（Node 22 系镜像 + Playwright 1.64.0 + chromium-1248，浏览器在卷 `agent_pw_browsers`；镜像配方与精确构建步骤见 `.superpowers/v2-env-recipes.md`——Node 具体 micro 版本未单独留档，镜像名即 Node 22 系）。
- **仓库级 git 配置**（容器内干净树门禁前提）：`core.filemode=false`、`core.autocrlf=true`（否则挂载树 414 个假 modified 使 verifyCleanCheckout/构建封存 fail-closed，实测见配方 §0.2）。
- **Linux 原生依赖**：宿主 node_modules 补装 5 个 Linux 二进制包（@next/swc-linux-x64-gnu、@img/sharp-linux-x64、@img/sharp-libvips-linux-x64、lightningcss-linux-x64-gnu、@tailwindcss/oxide-linux-x64-gnu，npm pack + tar 方式，配方 §0.3）。
- **数据库**：一律容器本地盘 `/tmp/<mktemp>/data.sqlite`（`CONTENT_STUDIO_DB_PATH`），不落挂载盘、不写真实用户数据；图像供应商指向环回合成服务或未监听环回端口，**无任何远程付费请求**。
- **npm ci**：本分支留档中**无 `npm ci` 执行日志**（node_modules 按上述配方准备）。V65 依赖锁哈希已绑定进 V64 构建回执并经 runtime-guard 校验（间接核对 manifest↔lock 一致）。如实标注：npm ci 全新安装路径本轮未验证。

## 2. 执行的命令与结果

| 命令 | 环境/提交 | 结果 | 日志 |
|---|---|---|---|
| `npm test`（基线） | 容器，f938fe8，2026-10-19 | **562 tests / 557 pass / 2 fail / 3 skipped**（既有失败，见 §3） | npm-test.log |
| `npm run check` | 容器，14:34 | **PASS**（node --check 全列表无输出=通过；日志仅含命令头 6 行，与成功一致） | check-final.log |
| `npm run build`（build-guard 封存） | 容器，14:37 | **PASS**：✓ Compiled successfully in 40s，26/26 static pages，V64 回执（HEAD↔BUILD_ID↔产物 SHA256 清单↔V65 依赖锁）。注：不含 V49 的后置门禁 `npm run test:production`（本分支未执行，见下） | build.log / build-verify.log |
| `npm test`（实现中期） | 容器，14:38 | **624 / 619 pass / 2 fail（同基线 V74）/ 3 skip（V69）** | npm-test-final.log |
| `npx playwright test`（基线全量） | 容器，f938fe8，2026-10-19 | **53 passed / 0 failed / 0 flaky，2.8m，退出码 0**（12 spec） | e2e.log |
| `npx playwright test`（全量，中期） | 容器 | **77 passed**（e2e-all-fix.log）→ **101 passed**（e2e-final.log） | 同左 |
| `npm test`（最终） | 容器，16:58 | **633 / 628 pass / 2 fail（同基线 V74）/ 3 skip（V69）** —— 较基线净增 71 测，无新增失败 | npm-test-settings.log |
| `npx playwright test`（全量，最终） | 容器，17:20 | **112 passed / 0 failed，7.7m**（23 个 spec 文件，其中 creator-v2-* 页面用例 59 例；含 mobile-audit 16 例） | e2e-settings3.log |

### 分页 e2e（每页指定命令，独立容器内运行，webServer 均为 runtime-guard 校验 V64 回执后的真实生产服务）

| spec | 结果 | 日志 |
|---|---|---|
| `e2e/creator-v2-home.spec.mjs` | 4 passed (42.1s) | home-e2e.log |
| `e2e/creator-v2-works.spec.mjs` | 4 passed (43.9s) | works-e2e.log |
| `e2e/creator-v2-compose.spec.mjs` | 4 passed (55.8s) | compose-e2e-run.log |
| `e2e/creator-v2-hotspots.spec.mjs` | 5 passed (45.4s) | hotspots-e2e2.log |
| `e2e/creator-v2-topics.spec.mjs` | 7 passed (52.5s；复验 48.4s) | topics-r2-e2e2.log / topics-accept-e2e.log |
| `e2e/creator-v2-illustrations.spec.mjs` | 5 passed (47.9s) | illu-accept-e2e.log |
| `e2e/creator-v2-publish.spec.mjs` | 5 passed (45.2s) | publish-e2e-accept.log |
| `e2e/creator-v2-library.spec.mjs` | 8 passed (51.9s) | e2e-library.log |
| `e2e/creator-v2-calendar.spec.mjs` | 6 passed (43.1s) | e2e-calendar.log |
| `e2e/creator-v2-insights.spec.mjs` | 5 passed (43.3s) | e2e-insights-final.log |
| `e2e/creator-v2-settings.spec.mjs` | 6 passed (44.6s) | acc-settings-e2e.log |

### 独立功能探针（容器内真实服务 + 真实域 API 造数 + node:sqlite 只读直验）

| 页面 | 脚本/结果 | 留档 |
|---|---|---|
| home | 39 项断言：38 过、1 败（Esc 焦点，见 §4） | home-accept-state.json / home-accept.mjs |
| works | 51/51、0 pageerror | works-accept-state.json / works-accept.mjs |
| compose | 46/46、542 次 API 调用、0 pageerror/5xx | compose-accept-state.json |
| hotspots | 53/53 | hotspots-accept-report.json / hotspots-accept.mjs |
| topics | 22 项 0 失败 + 5 项增量复核 | topics-accept-func.json / topics-accept-delta.json |
| illustrations | 39 步、**3 项失败**（未修复，见 §4 与偏差登记） | illu-verify-summary.json / illu-verify.mjs |
| publish | 105 项断言中 104 过、1 项 pass:false（「控制台无 error」，detail 含 2×net::ERR_FAILED + 1×409 Conflict——与探针内故意的断网/冲突回滚演练并存，归因未单独复核，见 §4 #12）、externalRequests 空 | publish-accept-result.json / publish-accept.mjs |
| calendar | 36 项断言中 34 过、2 项 ok:false（「周视图:10 月 23 日出现新事件胶囊」「工具栏计数更新为 4 项计划（实测 3 项计划）」；同探针内 targetDate 落库与月视图 4 胶囊为通过；归因未复核，见 §4 #13） | cal-func-result.json / cal-func.mjs |
| settings | 35/35 | acc-settings-func.json / acc-settings-func.mjs |
| library | 无留档结果 JSON（验证以 e2e 8 例 + 单测为主） | verify-library*.mjs |

### 未执行（如实登记）

- `npm ci`（全新安装路径）：未执行，无日志（见 §1）。
- `npm run test:production`（V49 真实进程重启持久性）：本分支未执行；V57 恢复复制冒烟在 CI 侧独立覆盖，本轮未在本地重跑。**该门禁是 AGENTS.md/V49 对「build 之后」的强制要求，本分支欠此项，合并前须补跑。**
- `npm run integration:preflight`（V54 历史）、`npm run test:release:*`（V55/V56）：不属本交付范围，未执行。
- 真实公网 RSS 抓取、真实付费生图、真实平台发布、生产 Dokploy 部署：无凭据/权限，**未验证**。

## 3. 基线豁免说明

以下失败/跳过在实现开工前的基线（f938fe8，2026-10-19）即存在，为**环境门禁**，非本分支回归；最终一轮（16:58）失败名单与基线完全一致：

1. **2 failed —— V74 容器恢复**（`test/container-recovery-v74.test.mjs:81,:100`）：错误即测试自身的环境守卫文案 `V74 maintenance requires an unprivileged Linux container`——验证容器以 root 运行，不满足「非特权 Linux 容器」前提。基线 npm-test.log 与最终 npm-test-settings.log 错误一致。
2. **3 skipped —— V69 独立 UID 候选**（test 内 `# SKIP requires non-root current UID` / `sudo -u nobody unavailable`）：同因（root 容器），node:test 计 skipped。
3. 基线时点这两类即已记录于 `.superpowers/v2-env-recipes.md` §4（2026-10-19），并在任务书 §4.1「区分存量与新增」框架下豁免。**在 ubuntu 非 root CI runner 上这两类应通过；本轮未在 CI 复跑，未验证 CI 绿。**

## 4. 异常与降级记录（诚实登记）

| # | 异常 | 处置 | 状态 |
|---|---|---|---|
| 1 | 首次 compose e2e 构建以 exit 78 失败：dev server（Turbopack）在 `.next/dev/node_modules/` 留下 `sharp-*` 等符号链接，V64 inspectBuildFiles 拒绝含符号链接的构建（配方陷阱 9） | 停止全部服务进程 + `rm -rf .next` 后重建成功，回执 candidateCommit=1a5f97b… ↔ buildId HyY09Z60lAHEzLl1C3k6h ↔ 719 文件 | 已闭环 |
| 2 | home e2e 后 dev 运行毒化 `.next`（同上 symlink 陷阱），补拍生产对照截图前已 `rm -rf .next` 重建并二次验证回执（candidateCommit=2eca608…，buildId 6iqU2LQLBQbVq1CxCPzc4，718 文件） | 已闭环 | 已闭环 |
| 3 | home 验收 39 项断言 1 项失败：移动「更多」面板 Esc 关闭后 `activeElement=BODY`，与 `CreatorShell.jsx:124-136` 注释声称的还焦行为不符（面板头部关闭按钮路径正常） | 登记为缺陷（偏差登记 /home #5、FEATURE-MATRIX 横切 #1），未修复 | 未修复 |
| 4 | works 验收（cd9e176 时点）发现稀疏态主列 718px 窄列（flex 容器内 `margin:0 auto` + `width:auto` 使 stretch 失效，实测定量） | commit 18a6c7f（同日 02:37）已将该规则改为 `width:100%`（现 `app/creator-v2.css:110`，注释即说明为消除 shrink-to-fit）——机制已修；**稀疏态视觉复测未重摄**（验收截图均为 18a6c7f 之前所摄），当前视觉结果未验证 | 机制已修，视觉复测待执行 |
| 5 | illustrations 验收探针 3 项失败（重试不清错误态 / 保存无反馈 / 390px 预览页脚不可点）；其中两项已在 HEAD 代码复核确认仍存在（`IllustrationStudio.jsx:355-364`、`:630-632`） | 登记为缺陷（偏差登记 /illustrations 验收轮），未修复 | 未修复 |
| 6 | hotspots 验收发现移动详情遮罩呈不透明白（旧 `.creator-main button` 特异性覆盖） | commit 6f92c26 修复（补 `.cv2-app` 前缀），探针复测 `rgba(27,33,56,0.66)`=设计值，e2e 补断言 | 已修复 |
| 7 | compose 发布准备对话框 Esc 不关、冲突/网络错误文案英文原文 | 登记（偏差登记 /compose #14），未修复 | 未修复 |
| 12 | publish 探针 105 项中断言 104 过：「控制台无 error」1 项 pass:false（detail 含 2×net::ERR_FAILED + 1×409 Conflict，与探针内故意的断网/冲突回滚演练并存，归因未单独复核；本文档修正轮补登记，原「0 失败」表述有误） | 登记（FEATURE-MATRIX 横切 #11），待归因复核 | 待复核 |
| 13 | calendar 探针 36 项中断言 34 过：「周视图:10 月 23 日出现新事件胶囊」「工具栏计数更新为 4 项计划（实测 3 项计划）」2 项 ok:false；同探针内 targetDate 落库与月视图 4 胶囊为通过，对应 e2e 用例（排期→周视图→刷新持久化）通过；归因（探针时序 vs 周视图过滤/计数口径）未复核（本文档修正轮补登记，原「12 项 0 失败」表述有误） | 登记（FEATURE-MATRIX 横切 #10），待归因复核 | 待复核 |
| 8 | settings e2e 合成公众号凭据被既有格式校验拒绝（AppID/Secret 格式、域校验） | commit 0da5b60：凭据改为满足既有格式（wx+16hex/≥16 位），**域校验属服务端安全边界不绕过** | 已闭环 |
| 9 | 实现期 works-desktop.png 为 1280×720（不符合 1440×900 视口约定）；works-mobile.png 经 IHDR 实测为 390×844（符合移动视口约定） | 验收轮按 1440×900/390×844 重摄 desktop.png/mobile.png；旧图保留、以新图为准 | 已闭环 |
| 10 | dev 截图含 Next.js dev 徽标伪影（390px 盖住底栏 tab） | home/works 均已用封存生产服务重摄干净对照图（desktop-prod/mobile-prod 等） | 已闭环 |
| 11 | 单元测试量随实现增长：562（基线）→ 624 → 633；每轮失败名单恒为基线 V74 两项 | 见 §3 豁免 | 豁免 |

## 5. 截图索引

### 设计基准（41 张，`docs/implementation/screenshots/design/`）

容器内对 `public/design/creator-v2.2.html` / `creator-v2.3-visual.html` 真实渲染（`.superpowers/design-shots.mjs` 驱动页面自身控件切换状态，未注入样式）；41 张 PNG 全部经 IHDR 解析确认尺寸（1440×900 / 390×844），`pageerror`/`console.error`=0（design-shots-summary.json：expectedShots 41 / filesOnDisk 41 / badDimensions []）。清单见 `.superpowers/v2-design-manifest.md` 附录。

### 实现截图（按页，全部 1440×900 / 390×844 双档，PNG IHDR 校验）

| 目录 | 张数 | 内容 |
|---|---|---|
| `screenshots/home/` | 8 | desktop/mobile、空态、断网、通知任务、更多面板、desktop-prod/mobile-prod（封存生产服务重摄） |
| `screenshots/works/` | 8+2 | desktop/mobile、空库、断网、筛选、搜索无匹配、建文弹窗×2（+实现期旧图 2 张：works-desktop.png 1280×720 不符约定、works-mobile.png 390×844 符合约定；保留备查） |
| `screenshots/compose/` | 11+5 | desktop、空态×2、公众号渠道、冲突、配图视图×2、发布准备、断网、mobile×2（+实现期 compose-*.png 5 张） |
| `screenshots/hotspots/` | 11+5 | desktop、详情、信源/搜索/关注筛选、刷新失败、断网、转换落地、抽屉、mobile×2（+实现期 hotspots-*.png 5 张） |
| `screenshots/topics/` | 5 | desktop、判断卡、推荐、mobile、mobile 判断卡 |
| `screenshots/illustrations/` | 6 | desktop、规划、对比、预览、mobile、mobile 规划 |
| `screenshots/publish/` | 13 | desktop、检查、冲突回滚、交付面板、空态、已导出、断网、待核对、知乎预览、作者报告、切换作品、mobile×2 |
| `screenshots/calendar/` | 5 | desktop、月视图、排期弹窗、mobile、mobile 月视图 |
| `screenshots/insights/` | 10 | desktop、空态、保存后、90 天、录入弹窗、风格待定/已采纳、加载失败、mobile×2 |
| `screenshots/library/` | 12+1 | desktop、集合筛选、详情、搜索空态、导入弹窗、导入错误、列表错误、移除影响×2、视觉系列、mobile×3 |
| `screenshots/settings/` | 6 | desktop、模型组、账号组、信源组、mobile×2 |
| `screenshots/impl/` | 3 | 实现过程留档（home-data/empty，dev 徽标伪影说明见偏差登记 /home #6） |

## 6. QA 结论

- 构建（build-guard 封存）、语法检查（check）、单元测试（除基线豁免的环境门禁项外全绿，净增 71 测）、全量 e2e（112/112）与 11 页分页 e2e（合计 59 例）全部通过。
- 视觉验证（41 张设计基准 vs 111 张实现截图（含 impl/ 过程留档 3 张），双视口）完成并有偏差登记；功能验证（各页独立探针见 §2 表 + 分页/全量 e2e）除登记的未修复缺陷外全部通过。
- 遗留：/illustrations 3 项缺陷（2 项 HEAD 复核确认）、/home 壳层 Esc 焦点、/compose 两项轻微项、/calendar 探针 2 项与 /publish 探针 1 项待归因复核（见 §4 #12/#13 与 FEATURE-MATRIX 横切表）；/works 稀疏态机制已由 18a6c7f 修复、视觉复测未执行；npm ci、test:production（V49 强制后置门禁，合并前须补跑）、真实付费生图、真实平台发布、生产部署未执行/未验证。

## 7. Easel 式阶段焦点视图改版（2026-10-21，feat/easel-stage-flow）

### 7.1 改动内容

用户反馈 /compose 单屏 60+ 控件不可用。参照 Easel（ZJU-REAL，Apache-2.0）「资料→编写→制作→发布」分阶段流水线的设计，把原有装饰性的六步阶段条（研究›大纲›写作›审稿›配图›发布，来源 `src/compose-view.mjs` 真实事实推导）升级为**可点击的阶段导航**，一次只呈现一个阶段的焦点工作面：

| 阶段 | 视图内容 | 吸收自原界面的控件 |
|---|---|---|
| 研究 | 选题简报与来源卡片 + 作者设定与参考资料（WritingContext）+ 「下一步：进入写作」CTA | 原左栏参考资料区 |
| 大纲/写作（默认） | 编辑器+预览、结构大纲左栏、创作助手（指令输入前置；技能任务 AgentRuns 折叠） | 原三栏核心 |
| 审稿 | 待审阅建议清单（与助手共用同一渲染）+ 四项检查状态 + 主稿同步/平台稿入口 + 证据链接 | 原建议区+渠道提示 |
| 配图 | 编辑器（保持挂载，选段配图可用）+ 配图助手 + 配图定位/素材左栏 + 配图视图 | 原配图助手与视觉板 |
| 发布 | 原发布准备对话框内容改为阶段内联（四项检查、导出、发布记录、PublishingControls）+ 发布边界说明；主稿渠道显示引导卡 | 原弹窗全部能力 |

同步简化：头部移除「配图工作台」链接（并入配图阶段）；移除移动端底部工作流栏（阶段条承担切换）；移动端助手面板按阶段显示「AI 写作助手 / AI 配图助手」。

**明确不变的边界**：修订树/`expectedRevision` 冲突检测、四项人工检查按渠道独立、导出≠实际发布、AI 建议先入待采纳区、建议接受/拒绝语义、SSR 流式生成与恢复——全部原样保留；本次为呈现层重构，数据模型与 API 零改动。Easel 的 gzh-design 主题组件为 AGPL，未搬用任何代码。

### 7.2 门禁与验证（容器内 node22-studio / node22-studio:pw）

- `npm run check` 绿；`npm test` 657 项 = 652 过 / 2 失败（V74 root 容器既有环境豁免）/ 3 跳过（V69 sudo），与基线一致。
- 封存构建（V64，净树绑 HEAD）绿 ×3（含两次修正后重建）。
- 全量 e2e：**270 过 / 1 抖动 / 16 fixme 跳过**——唯一失败为 `creator-v2-publish` 键盘可达用例（/publish 页，与本次改动无交集），单独复跑秒过，按既有抖动定性规则归为套内时序抖动。
- 核心两套件复跑（最后一次修正后）：creator-v2-compose + writing-workspace 39 过 / 2 fixme 跳过。
- e2e 同步更新：creator-v2-compose（发布准备对话框→阶段视图断言、移除工作流底栏/左栏开合断言、新增阶段切换用例）、writing-workspace（上传/选段配图走阶段导航）、creator-v1（作者设定走研究阶段）、agent-runtime（技能任务面板先展开）。
- 视觉留档：`screenshots/compose/stage-{write,write-mobile,research,review,images,publish-master,publish-wechat}.png`（1440×900 / 390×844，真实生产服务 + 合成数据，目检通过）。

### 7.3 已知偏差与遗留

- 阶段条 done/now 事实语义与 `src/compose-view.mjs` 完全一致；active 高亮为呈现状态（写作视图按「有真实标题→写作，否则→大纲」单高亮）。
- 发布准备不再是对话框（Esc 关闭 fixme 用例文本已同步修正）；版本历史与主稿审阅仍为对话框。
- 真实付费生图、真实平台发布、生产部署仍未执行/未验证（与此前边界一致）。

## 8. Easel 移植 Run A / Phase 1：阶段状态进 URL（P1-01，2026-10-21，feat/easel-port-phase1）

### 8.1 改动内容（EASEL-PORT-PLAN.md §4 P1-01）

`/compose` 的五阶段焦点视图（研究/写作/审稿/配图/发布）状态进入 URL，支持 `?stage=` 深链与浏览器前进后退。三条 `setStage` 路径（goStage / openPlanner / epoch effect）全部纳入 URL 协同，`?stage=` 写入单点化为 `syncStageUrl(next, mode)`（`WritingWorkspace.jsx`，push=点击切换、replace=装载协同）：

1. `src/compose-view.mjs` 新增纯函数 `parseStage(value)`：白名单 `research|write|review|images|publish`，非法/缺失一律返回 `"write"`；不产生任何新领域事实。
2. `stage` 初值改 `parseStage(query.get("stage"))`；默认阶段不写 URL 参数（缺省即 write），既有 `/compose?project=…&channel=…` 深链形态不变。
3. `goStage` 点击后 `syncStageUrl(next,"push")`（可前进后退）；`openPlanner` 保持自身 mobilePane 语义（助手面板）不改走 goStage，仅补 `syncStageUrl("images","push")`。
4. projects 加载 effect 依赖从整个 `query` 收窄为 `query.get("project")`/`query.get("channel")` 两个字符串——切阶段不再重跑 refreshProjects。
5. 新增 popstate 对齐 effect：以 `query.get("stage")` 字符串为唯一依赖，等值守卫（函数式 setState，同值 bail）防循环；依赖收窄后它是浏览器后退/前进的唯一落点。

**epoch effect :327 一行改动的护栏说明**：`setStage("write")` 改为 `setStage(parseStage(query.get("stage")))` 并紧随 `syncStageUrl(该值,"replace")`——mount 与 project/channel 切换都用 replaceState，不制造历史条目。该行只重置呈现层焦点视图，**不触碰 expectedRevision、保存（persist/flush）、建议 decide、master-sync、导出任何一行逻辑**；effect 依赖 `[projectId, channel]` 不变，文档重载防线（setProjectId 同值不触发）不受影响。深链 `stage=publish` + 主稿落既有「主稿不直接发布」引导卡、+ 小红书落既有 xhs 发布卡，均为既有可达状态，无特判。

### 8.2 pushState 集成验证与降级决定

- **未触发降级**。方案 §4 点 6 的施工首日最小验证（切阶段 → query 更新、:286 effect 不重跑、文档不重取）通过：静态核对 Next 16.4.0 对原生 `window.history.pushState/replaceState` 打补丁（`node_modules/next/dist/client/components/app-router.js` 的 patch → `navigator.restore` → `ACTION_RESTORE` → 纯客户端路由状态更新，无服务端请求；`useSearchParams` 由 `canonicalUrl` 派生）；运行时由下述 e2e 用例 28 的网络断言证实（切阶段与前进步后退全程 0 次文档 GET、0 次 refreshProjects GET）。
- 前进后退保住了，未走「全 replaceState」降级分支。

### 8.3 门禁与验证（容器内 node22-studio:pw，Node v22.23.3 / Playwright 1.64.1；仓库挂载、独立临时容器、干净树）

| 命令 | 提交 | 结果 |
|---|---|---|
| `npm run check` | 8b32a42 | **PASS**（exit 0） |
| `npm test` | 8b32a42 | **658 tests = 653 pass / 2 fail / 3 skipped**——2 失败与 3 跳过与 §3/§7.2 基线完全一致（V74 root 容器环境豁免 ×2、V69 sudo 跳过 ×3）；较 §7.2 净增 1 测（`parseStage` 白名单/非法/缺省单测）且全过 |
| `npm run build`（build-guard 封存） | 8b32a42 | **PASS**：✓ Compiled successfully，26/26 static pages，V64 回执 candidateCommit=8b32a42…、buildId=vHCINYpcth3Ecfs9WZNyl、709 文件、V65 依赖锁绑定 |
| `npx playwright test e2e/creator-v2-compose.spec.mjs` | 8b32a42 | **29 passed / 2 skipped（既有 fixme），1.6m**——既有 26 条全数保留全绿（含阶段条与通知条用例） |
| `npx playwright test`（全量） | 8b32a42 | **274 passed / 0 failed / 16 skipped（既有 fixme），9.3m** |

新增 e2e（`e2e/creator-v2-compose.spec.mjs`，验收条款逐条对应）：

1. **深链防二次重置**：`?project=<id>&stage=publish` 打开 → 保存徽标出现真实修订（文档装载完成）后仍停发布阶段、URL 保持 `stage=publish`、「主稿不直接发布」卡片与渠道创建按钮可见、发布步骤 `aria-current="step"`（防 epoch :327 二次重置回写作）；
2. **切阶段写 URL 且不重取**：切审稿 → URL 含 `stage=review`、ribbon 可见；网络断言全程 0 次文档 GET（`/api/writing/projects/`）与 0 次 refreshProjects GET（`/api/editor/projects`，证实依赖收窄）；未保存修改切回写作后仍在（编辑器不重挂载）；
3. **后退前进**：后退回写作（grid 可见、URL 丢失 stage=review、正文仍在），前进再回审稿，全程 0 次文档 GET；
4. **openPlanner 路径**：板内图位 → 配图助手（mobilePane=assistant 语义）后 URL 保持 `stage=images`。

### 8.4 边界与遗留

- 本期为呈现层改动：`src/writing.mjs`、`lib/api.mjs` 零 diff，零新增请求；修订树、`expectedRevision` 冲突检测、主稿/平台稿独立、四项人工检查、导出 ≠ 实际发布、AI 建议待采纳区语义全部不变。
- Windows 宿主上的 `npm test` 因凭据存储权限等 POSIX 环境门禁存在 122 项与本次改动无关的既有失败（与基线逐项 diff 确认零新增）；权威验证以容器内上述结果为准。
- P2-01/02/03（就绪度条、大纲跳转、通知分级）按方案留待 Run B；未验证真实平台发布与生产部署（与此前边界一致）。

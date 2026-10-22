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

## 9. Easel 移植 Run B：P2-01/02/03 + 服务端 Agent 切片 SA-01/02/03（2026-10-22，feat/easel-agent-server）

### 9.1 改动内容（对应 EASEL-PORT-PLAN.md §5/§10 与 EASEL-AGENT-SERVER-PLAN.md §SA-01/02/03）

**P2-01 发布就绪度全阶段可见**
- `src/compose-view.mjs` 新增纯函数 `readinessFacts({brief,outlineCount,pendingSuggestions,decidedSuggestions,checks,checkTotal,staleImagePlan,insertedImages})`：返回有序事实 chips（key/label/tone good|warn|info|detail），逐条对齐 composeSteps 现用布尔与原 ribbon 检查事实；人工检查复用 `checkSummary`；诚实上限是「人工检查 4/4 完成（该渠道独立记录）」，全部 label 不含「已发布/可发布」。
- `WritingWorkspace.jsx`：仅 review/publish 可见的 ribbon 升级为全阶段就绪度条（容器沿用 `.cv2-compose-ribbon` 类 + `cv2-readiness` 修饰，非 xhs 渠道；xhs 渠道维持现状），保留「AI 建议先进入待采纳区」「主稿 / 平台稿独立」两行语义；staleImagePlan 取左栏同源 `illustrationPlan?.stale` 判定。发布侧卡「人工检查 n/4」行删除（就绪度条单一承载），侧卡保留「导出 ≠ 实际发布」边界文案与返回按钮；四处导出 disabled 条件（`resolving||dirty||!allChecksDone`，含 `allChecksDone` 定义）与 PublishingControls 的 disabled 零改动，发布用例回归通过。
- 样式进 `app/compose/compose-v2.css`（ribbon 同文件；新增 `.cv2-pill.detail` 仅降强调、不引入新语义色，移动端 chips 单行横向滚动）。

**P2-02 大纲点击真跳转 + active 跟随光标**
- `src/compose-view.mjs`：`outlineItems` 每项新增 1-based `line`；新增 `markdownLineOffsets(markdown)`（行偏移表唯一生产者，逐行累计 UTF-16 起始偏移，多字节/末行无换行入单测）与 `activeOutlineIndex(items,cursorFrom,lineOffsets)`（光标所在/之前的最后一个标题，无匹配返回 -1）。
- `DoocsEditor.jsx`：ref 新增 `revealLine(line)`——折叠 selection 锚定 `doc.line(line).from` + `scrollIntoView:true` + focus，不产生选中文本，行号超界收敛到首/末行；另在 extensions 加 `highlightActiveLine()`（来自既有依赖 @codemirror/view，无新包），使 `.cm-activeLine` 存在以支撑 e2e 光标行断言与视觉跟随。
- `WritingWorkspace.jsx`：大纲按钮 onClick 改 `revealOutline(o)`（源码视图下先 setView("split")，`requestAnimationFrame` 后再跳转——隐藏节点上 scrollIntoView 无效，该交互细节记入本节）；active class 从固定 `i===0` 改 `i===activeOutline`，`useMemo` 内调用 compose-view 纯函数（`markdownLineOffsets(markdown)` + `activeOutlineIndex(outline, selection?.from ?? 0, offsets)`），`selection.from` 来自既有 `onSelection={setSelection}`。

**P2-03 通知分级 + 生成中全局指示**
- 内部 state 改 `{text,tone: info|error|success}`；`notify(text,tone="info")` 唯一入口，`setNotice` 保留为 `notify(text)` 别名——既有调用点零改动（现 `setNotice(` 出现 31 处，含别名定义）；仅关键路径显式升级：persist 保存冲突/retrySave/recoverDraft（blocked）→ error，导出复制/下载成功、恢复为新版本、发布回填、图片插入成功 → success。
- 渲染：error 用 `role="alert"` + 语义色（`.writing-notice.has-error`，compose-v2.css 用 --cv2-error token），其余 `role="status"`；单条槽位语义保持（不做队列），关闭按钮不变。
- 头部 actions 在 `busy||compareProgress` 非空时渲染非阻塞 pill「助手生成中…」（`.cv2-generating-pill`），点击 = `setRightOpen(true)+setAssistantTab("writing")` 回到既有助手与停止控件，不新增第二套停止入口；生成结束/失败即消失；保存徽标原样。移动端点击额外 `setMobilePane("assistant")`——否则正文面板遮挡右栏（见 9.3 偏差）。

**SA-01 事件流心跳 + seq 游标自动重连 + 本渠道运行刷新接续**
- 服务端（`lib/creator-api.mjs` events 分支）：①空行心跳——`lastEmit` 时间戳，每轮 800ms 轮询后无新步骤且距上次发射 ≥ 间隔即 `enqueue("\n")`，零新事件 kind；间隔 `Math.max(3000, Number(process.env.CONTENT_STUDIO_AGENT_STREAM_HEARTBEAT_MS)||15000)`（非 secret 非 NEXT_PUBLIC）。②续读游标——`?since=` 整数 ≥0 才生效，底层 `runSince(afterSeq)`；600s 单连接截止保持。
- 客户端（`components/AgentRuns.jsx`）：`follow(id,since=0,attempt=0)`；只有步骤帧携带 seq（run_done/error 帧与空行无 seq——跳过游标更新，防 undefined 写入），`seq<=lastSeq` 帧不追加（防御性去重）；流结束/出错先 GET `…/agent-runs/:id` 整体刷新，回填 `lastSeq=max(刷新结果 steps 的 seq, lastSeq)` 后按退避 [1s,2s,4s,8s,15s] 重连（status==='running' 且 attempt<5 且仍挂载且 scope 未变）；耗尽后 onNotice 如实提示「实时进度连接已断开，运行仍在服务端继续；请刷新页面查看轨迹。」；events 裸 fetch 补 401→/signin。挂载 effect 追加 GET `…/agent-runs`，**仅过滤 channel===props.channel 且 status==='running' 的最新一条** setRun 并以 `max(steps.seq,0)` 游标 follow；不回落展示其它渠道或终态运行。重连期间时间线上方 `writing-source-note`「进度连接重连中（第 N 次）…」；不新增停止入口。

**SA-02 中断/失败运行的重驱动（resumeOf，binding_json 首个消费方）**
- `src/agent-runtime.mjs startRun`：新增可选 `resumeOf`。`old=this.run(projectId,resumeOf)` 不存在自然 404；渠道不符 409「续跑须沿用原渠道」；status ∈ {interrupted,failed} 否则 409（cancelled 是作者显式意图，口径同 writing.mjs）；技能缺省取 `old.skill_id`（客户端传入不符则 409「续跑须沿用原技能」）；`binding_json` 解析无 id 字段即 409「原运行无可用模型绑定，请直接重新发起」——不建跑、不留必然失败的轨迹；有效绑定则复用（原连接事后停用时 V76 指纹调用时 fail-closed 如实 failed，不静默换模型）。首次运行仍走 `captureBinding("text")`。既有门禁全部照旧（consent 403、markdown 409、expectedRevision 409、单飞 409）。
- 溯源零 schema 变更：新 run 行插入后记首步骤 `{kind:"resume",payload:{resumeOf,baseRevision,fromStatus}}`（fromStatus 为规格 payload 的超集，用于 UI「（原状态）」文案，见 9.3）；`_loop` 加起始 seq 参数避免 `PRIMARY KEY(run_id,seq)` 冲突。
- UI：renderStep 加 resume 分支「从运行 ar_…（原状态：…）继续，基准修订 vN」；终态提示区在 interrupted/failed 渲染「按原技能与模型绑定重新驱动」按钮 + 说明（以当前正文为基准开启新运行、原轨迹保留、已入库建议/修订不受影响、consent 需重新勾选），点击复用 start 语义强制 `skillId=run.skillId` 并带 resumeOf。

**SA-03 dokploy+MULTIUSER 拓扑冒烟**
- 新增 `smoke/dokploy-agent-multiuser-v76.test.mjs` + `package.json` 脚本 `test:dokploy:agent`。模式照抄 smoke/dokploy-auth-v75.test.mjs（真实 Next 经 runtime-guard start 拉起 + 模拟 HTTPS 头 + Set-Cookie 手工回填），叠加合成回环模型 provider。链路断言：匿名 health 200 且 runtimeBuild===null、agent-skills 401；注册/登录并断言 `__Host-studio_author` Secure/HttpOnly/SameSite=Strict；登录态技能 7 个、经 /api/writing 建稿存稿（精确 Origin+JSON）；POST agent-runs+consent→201 running；GET events → application/x-ndjson+nosniff 逐步读到 run_done；gated provider 下 cancel→cancelled 且流以 run_done(cancelled) 收尾；负例：跨站 Origin 403、text/plain 400、伪造 x-forwarded-host 403；workspace 隔离双断言——第二名作者 GET …/agent-runs → 200 且 `runs: []`，具名 GET 编造 ar_ id → 404。文件头声明：模拟 HTTPS 头、无真实公网 TLS/Traefik；Traefik 对 NDJSON 的缓冲行为留操作者 curl -N 实测。

### 9.2 门禁与验证（容器内 node22-studio 与 node22-studio:pw；仓库 bind 挂载、node_modules/pw-browsers 为独立卷）

| 命令 | 结果 |
|---|---|
| `npm run check` | **PASS**（exit 0） |
| `npm test` | **667 tests = 662 pass / 2 fail / 3 skipped**——2 失败（V74 no-retention ×2）与 3 跳过（V69 sudo）与 §3/§8.3 基线完全一致（root 容器既有环境豁免），零新增失败；净增 10 项单测全部通过（readinessFacts 三态、markdownLineOffsets 多字节/末行、activeOutlineIndex 四位置、events ?since= 游标分区、心跳下限与钳制、resumeOf 续跑/409 矩阵/空绑定/绑定复用） |
| `npm run build`（build-guard 封存） | **PASS**：✓ Compiled successfully，V64 回执 candidateCommit=3d48afe…、buildId=See0jqiKVZldct__mCBxi、709 文件、V65 依赖锁绑定。如实注明：构建发生在工作树（HEAD=3d48afe + Run B 未提交改动），回执键为 HEAD 提交；客户端最终修订后重建一次并复跑 compose+agent e2e 与本 smoke |
| `npx playwright test`（全量 e2e，node22-studio:pw + agent_pw_browsers 卷） | **276 passed / 0 failed / 16 skipped（既有 fixme），11.1m**（较 Run A 基线 274 净增 2 条新用例）；客户端最终修订后复跑 `e2e/creator-v2-compose.spec.mjs + e2e/agent-runtime.spec.mjs`：**32 passed / 2 skipped** |
| `npm run test:dokploy:agent` | **1/1 PASS**（非 CI 单测：容器内真实 guarded Next 进程 + 模拟 HTTPS 头 + 合成回环 provider；无真实公网 TLS/Traefik，无真实平台发布） |
| Windows 宿主 `npm test` | 未作为权威口径（§8.4 已登记的 122 项 POSIX 环境既有失败，与本次改动无关，未重新逐项清点） |

e2e 同步更新：creator-v2-compose（就绪度条全阶段断言 + 诚实性上限断言、大纲真跳转/active 跟随/.cm-activeLine、发布侧卡无检查行、通知分级 role/语义色、生成中 pill 桌面与移动 390 溢出用例）、agent-runtime（completed 无重驱动按钮回归守卫 + 刷新接续/他渠道不附着新用例）。

### 9.3 边界与已知偏差（如实登记）

- **P2-01**：ribbon 容器类名保留 `.cv2-compose-ribbon`（新增 `cv2-readiness` 修饰）以便既有 e2e 断言最小迁移；样式落在 compose-v2.css（§5 spec 文本指定），workItem files 列表写的 writing.css 未动（两文件同路由均加载）。
- **P2-02**：为使 e2e 能断言光标行，给编辑器加了 `highlightActiveLine()`（既有依赖，非新安装）；源码视图跳转交互=先切回分栏、下一帧再 revealLine。验收中的「手工冒烟：接受建议产生的新标题也出现在大纲」以 e2e 等价断言承载（追加标题 → 大纲 4 项 + chip「大纲 4 个标题」；接受建议与手输同走 `setMarkdown` 派生路径，未单独构造接受建议场景）。
- **P2-03**：pill 点击在 spec 公式（setRightOpen+setAssistantTab）之外补了 `setMobilePane("assistant")`——移动端正文面板会遮挡右栏，不加则点击后仍看不到停止控件；桌面无副作用（mobiletabs 仅窄屏渲染）。
- **SA-02**：resume 步骤 payload 含 `fromStatus`（规格写 `{resumeOf,baseRevision}` 的超集），因 UI 文案要求显示「（原状态）」；interrupted 态需进程重启，难以在 e2e 真实构造——语义由 node 测试承载（含 :30-36 reopen 形态之外的 gated/漂移构造与 '{}' 空绑定行），QA 如实记录该覆盖边界，不虚报 e2e 已覆盖。
- **SA-03**：模拟 HTTPS 头（无真实 TLS）；冒烟中发现 provider 收到过非 chat-completions 形状的请求，已对合成 provider 做防御性解析（非攻击面变更）。每作者隔离是**进程内两套独立 SQLite 经真实 HTTP 首次自动化验证**，不等价于多租户生产部署认证。
- 边界保持：修订树/expectedRevision 冲突检测、四项人工检查按渠道独立、导出 ≠ 实际发布、AI 建议待采纳区语义全部不变；`src/writing.mjs`、SQLite schema、`lib/api.mjs` 门禁零 diff；真实平台发布、真实付费模型、生产部署仍未执行/未验证。

## 10. 完整还原 · vendor 适配期（Run C：AG-01/AG-02 + VA-03/VA-04，2026-10-22，feat/easel-full-port）

### 10.1 改动内容（对应 EASEL-PORT-PLAN.md §11.3–§11.6）

**AG-01 `article-pipeline` 全流程技能（技能本体 + 域级单测）**
- `src/agent-skills.mjs` 追加第 8 技能 `article-pipeline`（version 1，全流程初稿流水线，stage:"write"），tools=[read_document,read_brief,read_context,search_assets,write_revision,write_suggestions] ⊆ DEFAULT_AGENT_TOOLS，结构性排除发布/导出/配图/图组工具；systemPrompt 五步编排（读→确保大纲→生成初稿（revisions 直写 / 建议制降级，空稿+建议制如实说明需切换直写）→自审一轮（一律 write_suggestions ≤12 处，四维与 edit-review 同）→收尾止于「导出准备」）+ GUARD 结尾；文件头来源注释列出 5 个 vendor adaptedFrom 与全部弃用替代（三层加载/references 层不引入、WebSearch→search_assets、outline.md 落盘→修订制、wordcount.py 字数门不做、persona_prefix→read_context）。
- 同文件为全部 8 技能新增纯展示字段 `stage`（白名单同 compose-view parseStage；映射 task-brief→research、article-pipeline/draft-writer→write、claim-evidence/edit-review/selection-rewriter→review、illustration-orchestrator→images、xhs-group→publish），只进 UI（`skills()` 投影透出，src/agent-runtime.mjs），不进 systemPrompt/门禁/存储。
- 单测：agent-skills ids 7→8 + 新增 pipeline 声明断言（GUARD/tools 子集/双模式契约/五步关键字/无「自动发布/已发布」承诺）+ stage 白名单与 8 映射断言；agent-runtime 技能数 7→8 + fetchImpl 脚本化全流程（revisions 模式：read_brief→write_revision→write_suggestions→收尾，断言步骤序、修订推进（note 落库）、无越权工具名、收尾 content 含「人工/导出准备」且无发布措辞）。

**AG-02 e2e 全流程用例 + HTTP 冒烟**
- `e2e/agent-runtime.spec.mjs`：技能数 toHaveCount(7)→8（optgroup 下 option 计数语义不变）；新增 article-pipeline 全流程用例（脚本化 provider 依次回 read_brief→write_revision（标题骨架+正文）→write_suggestions（1 条自审）→final；断言 completed、模型/工具步骤序列、修订历史 +1（revision=baseline+1 且 markdown=直写稿）、建议列表 1 条待审、收尾止于「导出准备」且面板文本无「已发布/自动发布」；finally 恢复写模式）。
- curl 全流程实跑记录见 §10.2。

**VA-03 首页作品行六槽进度点**
- `src/creator-home.mjs` 新增纯函数 `projectProgress(project)`：固定六槽 research/body/review/checks/delivery/publish，每槽 {key,tone good|warn|info|todo,title}，只吃 overview 既有载荷（editorial.get()，briefId/document.paragraphs/openCorrections/checks/status）；研究=briefId 非空；正文=master 非种子内容（channelHasContent 同源判定）；核对=无内容→todo、openCorrections 0→good、>0→warn；检查=两渠道四检查合计 n/8（8/8→good、0→todo、其余 warn；title 明示「公众号稿与知乎稿独立记录」）；交付=任一渠道 exported→info「已导出（未发布）」；发表=任一渠道 reported_published→warn「作者报告已发表（未核验）」。大纲标题数/待采纳建议数/配图状态不在载荷内——不设槽。不建表/不加列/不新增端点或响应字段（manifest.py Python 落盘契约 → 请求时派生，零新存储；failed 断点续跑语义由既有 SA-02 resumeOf 承担）。
- `components/CreatorHome.jsx` 最近作品行：projectStage Tag 保留承载终态文字 + `cv2-progress-dots` 点串（每槽一颗 `cv2-progress-dot is-<tone>`，title 承载诚实文案）；`CalendarWorkspace.jsx:372` 与 `src/insights-view.mjs` 的 projectStage 用法零改动（防回归面）；`app/creator-v2-home.css` 新增点串样式（--cv2-success/warning/info/border 语义 token，无内联新 hex；窄屏沿用 .cv2-works-stage white-space:normal 先例折行）。
- 单测：projectProgress 六槽键序与 tone 枚举、空稿全 todo、部分完成（2/8 warn）、待核对>0 warn、全完成（8/8 good + 已导出 info）、报告已发表（warn + 未核验）五态 + 逐槽无「已发布/自动发布」断言。

**VA-04 AgentRuns 轨迹卡片化 + 技能分组与诚实角标**
- `components/AgentRuns.jsx`（follow/redrive/取消逻辑零改动，只动渲染层）：①技能 select 平铺 options → 按 stage 分组 `<optgroup>`（组名 研究/写作/审稿/配图/发布，组序固定、空组不渲染，option 数不变）；②技能说明行诚实角标：`skill.tools ∩ profile.tools` 为空 → 「工具全部被禁用，启动将被拒绝」（对应服务端工具交集空 403 门禁），tools 含 generate_image 且交集缺它 → 「需先在偏好中启用图片工具」——事后 403 变事前预告；③时间线折叠：`.agent-run-steps` 外包 `<details class="agent-run-steps-box">`，运行中 open 自动展开、终态默认收起为「执行过程 N 步」（N=steps 真实计数）；SA-01 重连提示保持在折叠层外附着可见。文件头注明 adaptedFrom（MessageBubble.tsx:87-92 doneSteps details、SkillPage.tsx:74-83 layer 分区、capabilityMenu.ts:9-19 legend）与弃用清单（113 技能手工菜单/SkillDrawer/layer 五色体系不搬）。
- 单测：stage 白名单 + 8 技能映射齐全（test/agent-skills.test.mjs）。

### 10.2 §10.3 curl 全流程实跑记录（本期真跑，此前设计阶段未实跑）

- **环境**：Linux 容器 node22-studio（Node v22.23.3），真实构建生产服务经 `node scripts/runtime-guard.mjs start` 拉起（local-only 模式，HOST/PORT=127.0.0.1:4412，V64 回执 candidateCommit=ec73910、buildId=UtfDIrgAZoNWe0EjhmojM、健康检查 mode=local-only）；SQLite 落容器本地 /tmp/qa-ag02/data.sqlite（一次性，不落挂载盘、无真实用户数据）；模型指向回环合成 provider（127.0.0.1:43990，脚本化五步响应，无真实付费调用）。容器无 curl，用 node fetch 等价回放同一回环 HTTP 面（脚本 `.superpowers` 留档 /tmp/qa-ag02/flow.mjs + transcript.txt）。
- **实跑结果（全部通过）**：① GET /api/creator/agent-skills → 200，8 技能含 article-pipeline（tools/outputContract 如声明，stage:"write" 透出）；② PUT /api/creator/agent {"writeMode":"revisions"} → 200；③ POST /api/writing/projects + PUT master 种子（无标题正文）→ revision 3；④ POST /api/creator/projects/<id>/agent-runs {skillId:"article-pipeline",consent} → 201 running（channel master，baseRevision 3）；⑤ GET …/events → content-type application/x-ndjson，帧序 model→tool:read_brief→model→tool:write_revision→model→tool:write_suggestions→model→run_done(completed)；⑥ GET …/agent-runs/<id> 轨迹 → completed，steps 与帧序一致，stopReason=收尾文案（含「人工下一步…导出准备」）；⑦ 领域效果：master revision 3→4、markdown=直写稿、note=「全流程冒烟初稿」；GET …/master/suggestions → 1 条 pending（original/replacement 为自审编辑，instruction「agent：全流程初稿流水线」）；⑧ 取消路径：provider 挂起（instruction 含 QA-HANG 永不响应）→ 201 running → POST …/cancel → 200 cancelled（stopReason「作者取消运行」）；⑨ 负例：text/plain 写请求 → 400（V58 JSON-only 守卫）。
- **边界说明**：本地默认模式（非 dokploy、非 MULTIUSER）无会话要求，V58 边界内回环 + JSON-only 写请求；`CONTENT_STUDIO_MULTIUSER=1` 下需持登录会话 cookie（e2e agent-runtime 夹具的 page.request 形态即该差异的自动化覆盖，本期全绿）。留档服务仅监听容器回环，无任何远程/公网请求。

### 10.3 门禁与验证（容器内 node22-studio / node22-studio:pw；最终代码态）

| 命令 | 结果 |
|---|---|
| `npm run check` | **PASS**（exit 0） |
| `npm test` | **676 tests = 671 pass / 2 fail / 3 skipped**——2 失败（V74 root 容器环境豁免，test/container-recovery-v74.test.mjs:81,:100）与 3 跳过（V69 sudo）与 §3/§9.2 基线完全一致，零新增失败；净增 9 项单测全部通过（pipeline 声明/stage 白名单/脚本化全流程/projectProgress 五态等） |
| `npm run build`（build-guard 封存） | **PASS**：✓ Compiled successfully in 25.4s，26/26 页面；施工中多次重建（含 A/B 对拍临时构建），最终构建 buildId=Q7qvhOpMkts0hkimW-YKr |
| `npx playwright test`（全量，pw 容器 + agent_pw_browsers 卷） | 最终代码态全量：**277 passed / 0 failed / 16 skipped（既有 fixme），11.5m**（较 Run B 276 净增 1 条：article-pipeline 全流程用例）。过程留档：首轮全量 276 passed / 1 failed（creator-v1:662 系列任务重试流程，与本批改动无交集，单独复跑 10.8s 通过，按 §7.2 既有抖动定性规则归为套内负载时序抖动）；三套件复跑与首页套件三连跑中 creator-v2-home:399 一次因 worker tick 超时抖动失败（单独复跑与最终全量均通过）。最终态复跑：agent-runtime 3/3（含新 pipeline 用例，既有两用例零回归）、creator-v1 全套 8/8、creator-v2-home 16/16 ×2 |
| VA-04 交互冒烟（真实浏览器 headless chromium + 真实构建服务 + 合成回环 provider，`.superpowers/va04-smoke.mjs`） | **13/13 全过**：optgroup 下技能 option 计数 8；运行中 details 自动展开 + 真实步数摘要（挂起中「执行过程 0 步」）；终态 details 默认收起；failed 出现重驱动按钮；重驱动 UI 点击 → 运行完成且轨迹含 resume/续跑与 write_suggestions、摘要「执行过程 4 步」；图片工具角标「需先在偏好中启用图片工具」与工具全禁角标「工具全部被禁用，启动将被拒绝」两态均现；API 层 resumeOf（201→completed+resume 首步骤）补验通过；全程 0 pageerror |
| AG-02 curl 冒烟 | 见 §10.2，全流程实跑通过 |

### 10.4 边界、缺陷与已知偏差（如实登记）

1. **既有缺陷（非本期回归，A/B 对拍定位）**：AgentRuns 面板「取消运行」按钮在运行中点击不触发任何网络请求（真实浏览器点击与键盘 Enter 均不触发；elementFromPoint 命中按钮本身、无遮挡、无 pageerror、window.fetch 打点为空）。**同问题在本批改动前 HEAD 构建（仅回退 AgentRuns.jsx 的 A/B 对拍构建）上完全复现**，且本期 spec 明确「取消逻辑零改动、只动渲染层」，故不修复、如实登记：取消的领域语义由既有单测（cancelled 不被迟到结果覆盖等）与 §10.2 curl 冒烟（API cancel → cancelled）承载。「重新驱动」按钮点击正常（冒烟内 UI 全链路走通）。探测证据留档 `.superpowers/va04-probe.mjs`。
2. **e2e 覆盖边界**：article-pipeline 的 provider 脚本为合成指令回放（SKILL-SPEC tests 契约的关键字匹配映射），不覆盖真实模型行为；「不过先改再交付」质量门由脚本编排的自审建议轮验证（social-content 步骤 7 语义）；空稿+建议制「如实说明需切换直写」分支由单测断言 prompt 措辞承载，未单列 e2e。SA-02 interrupted→resumeOf 的 e2e 未构造（进程重启语义，沿用 Run B §9.3 口径，node 测试承载）。
3. **VA-03**：检查槽 tone 按规格公式纯由 checksDone 决定（8/8 good、0 todo、其余 warn），未叠加「主稿无内容→todo」的额外条件；发表槽规格文案写作「warning」，按 tone 枚举 good|warn|info|todo 落为 warn（诚实上限不变：「作者报告已发表（未核验）」，六槽任何文案无「已发布」，单测断言）。首页视觉仅行内多一串点，creator-v2-home e2e 16/16 两次通过证明选择器无冲突。
4. **VA-04**：stage 只进 `/api/creator/agent-skills` 响应与 UI 分组，不进 systemPrompt/门禁/存储（agent_runs 行零 schema 变更）；optgroup 下 e2e toHaveCount(8) 实测语义不变（playwright locator("option") 计含 optgroup 内 option，实测通过并记 QA）；诚实角标只读 `skills × profile` 既有数据，不发新请求（冒烟中工具变更后需重挂载重取 profile，与设置页返回 compose 的真实路径一致）。
5. **环境与口径**：权威验证在容器内（Windows 宿主不作为口径，§8.4 既有登记继续有效）；真实付费模型、真实平台发布、生产部署仍未执行/未验证（与此前边界一致）；`npm run test:production`（V49）本分支仍未补跑（§2 既有欠账，合并前须补）。

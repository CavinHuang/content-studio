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

## 11. 还原第二批 + 缺陷修复（Run D：DF-01 + RD-01/02/03，2026-10-23，feat/easel-restore-batch2）

> 方案依据：EASEL-PORT-PLAN.md §12（Run D 定稿）。施工在叠层分支 `feat/easel-restore-batch2`
> （基于 `feat/easel-full-port`，基线 HEAD=d0b7570）完成；工作树内同期的
> EASEL-PORT-PLAN.md §12 方案章节为本 run 设计师产出，随本批一并入库。

### 11.1 DF-01：「取消运行」按钮 UI 点击不生效——根因修复（关闭 §10.4.1 登记）

- **根因（施工时按方案四假设逐一复核确认）**：`components/AgentRuns.jsx:84` 的
  `cancel` 函数在同一 try 块内 `const {run}` 解构声明了与组件态同名的变量，URL
  模板串 `${run.id}` 求值命中 const 暂时性死区 → `ReferenceError: Cannot access
  'run' before initialization` 在 fetch 发起**之前**抛出、被 catch 吞进 onNotice
  ——与 §10.4.1 探测证据（无网络请求、elementFromPoint 命中按钮、无 pageerror）
  完全吻合；假设 1-3（绑定/条件渲染/遮挡）逐项排除。设计期最小复现（同形代码，
  EASEL-PORT-PLAN §12.1 留档）：`node /tmp/tdz-cancel-repro.mjs` →
  `{"fetchCalled":false,"noticeType":"ReferenceError","notice":"Cannot access
  'run' before initialization"}`——`fetchCalled:false` 证实异常在 fetch 发起前抛出。
- **修复**：解构改名 `const {run:updated}=…; setRun(updated)`；函数首行加
  `if(!run)return;`（闭包空档防御）；旁注两行根因注释。follow/redrive/启动路径与
  API 形态零改动。
- **真实点击 e2e 回归（A/B 两轮，同 §10.4.1 口径）**：`e2e/agent-runtime.spec.mjs`
  新增独立用例「取消运行：真实点击后按钮消失、轨迹 cancelled」——holdModel 闸门
  构造 running 态 → `page.getByRole("button",{name:"取消运行"}).click()` 真实用户
  点击 → 断言 ①按钮消失 ②终态文案「运行未完成」「作者取消运行」③ page.request
  GET 运行轨迹 `status==='cancelled'` 且 `stopReason==='作者取消运行'`（领域真值
  双确认）④ pageerror 为空；finally 释放 holdModel。
  - **A 轮（未修复代码）**：`npx playwright test --grep 取消运行` → **FAIL**，
    失败点 `toHaveCount(0)`（点击后按钮仍在，34 次重试均 resolved to 1 element，
    轨迹停在 running）——与方案预测的失败形态一致；
  - **B 轮（修复后）**：agent-runtime 全套 **4 passed**（新用例 1.9s，既有 3 条
    零回归）。
- **§10.4.1 登记就此关闭**：缺陷根因、复现形态、修复与回归证据齐备（原登记的
  「取消领域语义由单测与 curl 冒烟承载」过渡口径由真实 UI 链路取代）。

### 11.2 RD-01：检查快照绑定——独立评审（Branch A 通过）+ 服务端 checkedRevision 版本指针

**第 0 步独立评审结论（先行落 QA，阻塞施工已遵守）：通过，按 Branch A 施工。**
评审输入全部施工时实测复核：

- **reset-on-save 覆盖面比方案所列更宽**：checklist_json 的全部写入点实测为六处
  重置 + 一处盖章——`src/writing.mjs:576-589`（markdown save 漏斗：decide :1212、
  syncMaster :745、create :466 均经此路径）、`src/editorial.mjs:67-73`（段落 save，
  copyMaster :79 经此）、`editorial.mjs:88-89`（attachKnowledge）、
  `editorial.mjs:128-136`（saveLayoutDraft）、`src/precision.mjs:97-108`（更正
  apply_local）、`src/xiaohongshu.mjs:38`（xhs _write）；唯一写非假值的是
  `setChecks`（editorial.mjs:83-87，expectedRevision 门禁保护）。结论与方案前言
  一致：**当前已知路径下「检查 valid 但内容已变」不可达**。
- **裁定（通过理由）**：① 防御——reset-on-save 是散布在六处调用点的事务性约定，
  任何未来绕过（新导入路径/迁移脚本/重构丢行）都会让「过期但有效」的检查静默
  存活，checkedRevision 指针把它变成可检测状态（checksStale → RD-02「需复核」），
  当前路径行为零改变；② 溯源——「核对于 v{n}」是真实的作者可见 provenance，
  符合本工作区证据优先原则；③ 成本——落既有 `checklist_json` JSON 列（零 DDL，
  `git diff` 对照无 CREATE/ALTER），旧行（四键无指针）读作 null 且 checksStale
  恒 false，旧行为兼容。

**Branch A 施工**：① `setChecks`（editorial.mjs）四布尔校验行零改动，写入时盖章
`checkedRevision: doc.revision`（ack_master_revision 语义保持）；② payload 两个
读取点剥离指针键——`editorial.get()` 与 `writing.document()` 的 `checks` 保持四
布尔形态，指针以同层独立字段 `checkedRevision`（int|null）透出（消费方核查：
`compose-view.checkSummary`、`publish-center.boolChecks` 按四个具名键读取；另有
`StudioApp.jsx:130` 与 `creator-home.mjs:102/:183` 按 `Object.values(checks)` 计数
——剥离正是保形的关键）；③ `src/publish-center.mjs` 新增纯函数
`checksStale(entry)`：`checkedRevision != null && checkedRevision !==
entry.document?.revision → true`，null 恒 false（防御性，当前路径恒 false）；
④ 单测：test/editorial.test.mjs 新增 3 条（盖章 + 两读取点剥离形态、:84 校验行
回归——多余键/非布尔/缺键仍 400、旧行 null→false 与合成指针错位→true——错位用
域路径 save 推进文档到 v2 后手工写指针 1 构造，不经伪造路径）+ test/
editorial-api.test.mjs HTTP 级断言（载荷四布尔 + checkedRevision===2、多余键
400）。不写「改字后需重审」e2e（路径不可达，方案明示不伪造）。

### 11.3 RD-02：发布中心对齐——ManualPublishPage 审核闸门适配（UI 面）

- `src/publish-center.mjs`：`channelState` 新增 `reviewReady`（全勾且无复核类
  blockers）与 statusTag 三分（reviewReady→「检查完成」success；全勾但有复核类
  blockers→「需复核」warning；否则「待确认」现状）；`publishState` 顶条 pill 同步
  （有渠道需复核→「有渠道稿需复核」）。PUBLISH_CHANNELS 每渠道新增
  officialUrl/officialHint（wechat→`https://mp.weixin.qq.com/`、zhihu→
  `https://zhuanlan.zhihu.com/write`）。`buildDeliveryTimeline`「人工核查完成」行
  在 RD-01 Branch A 落地后 detail 逐渠道追加「核对于 v{checkedRevision}」（旧行
  如实「核对版本未记录」，不伪造版本号）。
- `components/PublishCenter.jsx`：交付面板闸门改 `state.reviewReady` 才展开；
  全勾但有复核类 blockers 时主按钮点击走 onPrimary 并逐条列出 blockers（服务端
  `_canExport` editorial.mjs:141-147 既有拦截零改动，仍是唯一真值）；交付面板内
  新增官方发布页跳转引导卡（`<a target="_blank" rel="noopener noreferrer">` 纯
  作者手动跳转，无自动打开、无服务端外呼，V75 边界不动；保留「导出不代表已发布；
  由你在官方页面亲自点击发布」边界文案）。文件头落 adaptedFrom 注释
  （ManualPublishPage.tsx:211-235/:230/:224 语义与弃用清单），publish-center.mjs
  头部落 :63-67（snapshot/approved → 服务端指针）适配声明。样式进
  `app/creator-v2-publish.css`（.cv2-official-card 等，全部 --cv2-* 既有 token，
  不内联新 hex）。
- 单测（test/publish-center.test.mjs 新增 5 条）：statusTag 三分矩阵、checksStale
  合成 payload 联动（错位→需复核）、pill 需复核口径、时间线「核对于 vN」与旧行
  「未记录」、官方页 URL/hint 与「新增标签无『已发布』承诺」断言。
- e2e（creator-v2-publish.spec.mjs 新增 1 条）：全勾对照态 → 面板可展开、官方页
  链接 href/target/rel 正确、时间线「公众号核对于 vN」可见；API 把 master 页外
  推进一版（masterOutdated 真实可达）→ 「需复核」Tag + blocker 文案 + 顶条
  「有渠道稿需复核」可见、主按钮点击逐条列出 blockers、面板不可展开。

### 11.4 RD-03：版本历史两版对比 diff（Phase 4 首切片，自有设计非 vendor 适配）

- 新建 `src/version-diff.mjs`：`diffLines(oldText,newText)` 行级 LCS（公共前后缀
  裁剪 + DP；**如实注明：不是 Myers O(ND) 算法，是裁剪后的 O(N·M) DP**，配合
  任一侧 >2000 行返回 `{tooLarge:true}` 的诚实降级）；`diffSummary(ops)` 真实计
  数 {added,removed}。零新依赖、零新增请求（两版 markdown 全在既有 GET /history
  载荷，src/writing.mjs:625-657）。
- `components/WritingWorkspace.jsx`：版本历史对话框除最早一版外每行新增「与上一
  版对比」`<details>`（history 为 revision DESC，上一版即下一项），展开时客户端
  按需计算（onToggle 惰性求值，不预计算全量两两 diff）；del/add 行语义色区分、
  顶行「N 行新增 / M 行删除」；`row.note` 有值随行显示（payload 既有字段）。
  「查看内容」与「恢复为新版本」（restore :1011-1040，不可变修订语义）零改动。
  样式进 `app/compose/writing.css`（--cv2-error/success 系 token + 既有
  --writing-line，不内联新 hex）。
- 单测（test/version-diff.test.mjs 新建，8 条）：相同/空（空串按单个空行参与，
  不伪造零变化）/纯增/纯删/改写/多字节中文六态 + CRLF 与 null 入参 + tooLarge
  降级（含恰好 2000 行边界）+ summary 计数 + 输出无「已发布」措辞。
- e2e：**落在 `e2e/writing-workspace.spec.mjs`（非方案指定的
  creator-v2-compose.spec.mjs）**，理由见 §11.6 偏差 2；断言连续 PUT 两版后展开
  对比：del/add 行内容与计数（2 行新增 / 1 行删除）、备注随行显示、最早一版无对
  比入口、恢复按钮不受影响、0 pageerror。

### 11.5 门禁与验证（容器内 node22-studio:pw，Node v22.23.3 / Playwright 1.64.1）

| 命令 | 结果 |
|---|---|
| `npm run check` | **PASS**（exit 0） |
| `npm test` | **692 tests = 687 pass / 2 fail / 3 skipped**——2 失败（V74 root 容器环境豁免，test/container-recovery-v74.test.mjs:81,:100）与 3 跳过（V69 sudo）与 §3/§10.3 基线完全一致，零新增失败；较 Run C 676 净增 16 测（RD-01 3 + publish-center 5 + version-diff 8）全部通过 |
| `npm run build`（build-guard 封存） | **PASS** ×多轮（DF-01 A/B 各一轮 + 本批最终两轮）：最终 ✓ Compiled successfully in 46s。如实注明：回执键为 HEAD=d0b7570（Run C 提交），构建发生在含 Run D 未提交改动的工作树——沿用 §9.2/§10.3 既有披露口径 |
| `npx playwright test`（全量） | **279 passed / 1 failed / 16 skipped（既有 fixme），14.8m**。唯一失败 `creator-v1.spec.mjs:662`（系列任务重试流程）——与 §10.3 首轮全量为**同一用例的既有套内负载抖动**（本批改动无交集），单独复跑 `npx playwright test e2e/creator-v1.spec.mjs:662` → **16.9s 通过**，按 §7.2 既有抖动定性规则归为抖动；277+3（DF-01 取消 / RD-02 闸门 / RD-03 对比）= 280 条账目相符 |
| 四套件复跑（agent-runtime / creator-v2-publish / writing-workspace / creator-v2-compose） | **全部通过**：agent-runtime 4/4（含 DF-01 新用例，既有 3 条零回归）、creator-v2-publish 21/21 过 1 fixme（含 RD-02 新用例；既有 20 条零回归）、writing-workspace 14/14（含 RD-03 新用例，既有 13 条零回归）、creator-v2-compose 全绿（其曾挂的 RD-03 用例已迁出，见 §11.6 偏差 2） |

### 11.6 边界与已知偏差（如实登记）

1. **RD-02 复核类 blockers 收窄（与方案 §12.3 ①字面公式的偏差）**：方案公式
   `reviewReady = allChecked && blockers.length===0` 会让「渠道稿还没有正文」这一
   提示性 blocker 把种子渠道的全勾状态翻成「需复核」——施工期用真实 core 探针
   实证（createProject 后 checkAll，blockers=[无正文]，字面公式 → 需复核），这将
   整体翻转既有 creator-v2-publish 用例编码的对照态（如知乎种子渠道全勾后面板可
   展开并成功下载交付包），与「既有用例零回归」硬冲突。按方案括号内所指
   （blockers 里有**主稿更新/待处理更正**）收窄为复核类 blockers（masterOutdated、
   openCorrections、RD-01 checksStale）参与闸门与 Tag 三分；「无正文」blocker 保持
   现行列表渲染但不参与翻转。规格 e2e 的「全勾且无 blockers 对照态」按收窄后口径
   构造并通过。
2. **RD-03 e2e 落点从 creator-v2-compose 迁至 writing-workspace**：compose 套件
   每条用例真实 signup，注册限流（author-accounts.mjs:29 `_limit('registration',30)`
   每 10 分钟/进程）在既有 30 条处**恰好打满**；首轮三套件联跑中新用例第 31 次
   signup 被 429 拒绝（「尝试次数过多」），证实该套件注册预算无余量。版本历史对话
   框同属 WritingWorkspace 组件，writing-workspace.spec.mjs 既有该对话框用例且其
   worker 服务独立（隔离 SQLite + 独立限流预算），故迁入；不放宽限流阈值（安全
   边界不为测试让步）。creator-v2-compose.spec.mjs 恢复原状（31 处 signup，原
   套件全绿）。
3. **RD-03 算法与语义口径**：diffLines 为「公共前后缀裁剪 + 行级 LCS DP」，不是
   方案文本所写的 O(ND)（Myers）；在 2000 行诚实降级上限内正确且零依赖，源码注
   释按实描述，不虚标复杂度。行级语义下空行是真实一行：diff 计数会把新增的空行
   计入 added（单测与 e2e 按此口径断言）。
4. **RD-02 onPrimary 文案两分支**：首轮联跑暴露实现 bug（blockers 存在时未按
   allChecked 分流，未全勾场景误出「需先复核」文案，creator-v2-publish :186/:1041
   失败）；已修复（`pending == null && blockers?.length` 才走复核分支）并复跑通过
   ——过程留档 `.superpowers/rund-e2e-three.log`。
5. **边界保持**：修订树/expectedRevision 冲突检测、四项检查按渠道独立、导出 ≠
   实际发布、AI 建议待采纳区语义全部不变；零新增 HTTP 路由、零 DDL（checklist_json
   既有 JSON 列）、V75 边界不动（官方页卡为纯客户端 `<a>`，无 fetch、无自动打开）；
   RD-03 对比纯客户端只读派生，restore 路径零改动。真实付费模型、真实平台发布、
   生产部署仍未执行/未验证（与此前边界一致）；`npm run test:production`（V49）
   继续保持 §2 既有欠账，合并前须补。

## 12. 服务端续批 + 快赢二则（Run E：SC-01/SC-02 + AW-01/AW-02，2026-10-23，feat/easel-server-continue）

### 12.1 SC-01：agent_runs 进程内排队（零 DDL）

- `status` 扩 `'queued'`（TEXT 无 CHECK，构造函数 CREATE TABLE 逐字未动，git diff
  核对无新表无新列）。`runs()/run()/runSince()` 新增只读派生 `queuePosition`
  （非 queued 为 null）。**口径说明（偏差 1）**：= 全库（按 core）活跃行
  （running+queued）中 rowid 更早者计数 + 1——方案字面「COUNT queued rows」与
  验收用例①「A running、B queued → queuePosition=2」相互矛盾，按验收取活跃行
  口径（对「等待并发空位」最诚实：认领本就按 rowid 全局推进）。
- `startRun` 入队语义：既有门禁（技能 404/渠道 403/工具交集空 403/consent 403/
  markdown 409/expectedRevision 409/resumeOf 矩阵/binding 捕获）全部先行零改动；
  单飞检查扩为 `status IN ('running','queued')`——命中 running 改入队（201 queued，
  消除 409 死胡同），命中 queued 仍 409（队列槽每 project+channel 至多 1）；无同
  渠道活跃行但全局 running ≥ `agentMaxConcurrent()`（读时求值
  `Math.max(1, Number(env CONTENT_STUDIO_AGENT_MAX_CONCURRENT)||2)`，形态同心跳
  间隔先例）→ 入队。入队行照常落 binding_json（绑定入队时定格，drain 不重新
  capture）与 resume 溯源首步骤，不建 controller/loopPromises，HTTP 仍 201。
- `drainQueued()` 认领（r6.1 评审 high 项）：单条 BEGIN IMMEDIATE 事务内「数
  running → 认领 SELECT 带相关子查询 `NOT EXISTS (…r2.project_id=… AND
  r2.channel=… AND r2.status='running')` 按项目+渠道配对（评审建议的裸 channel
  NOT IN 会误伤其它项目同渠道，不采纳）取最旧可认领行 → CAS UPDATE 校验
  .changes（仿 creator.mjs creator_jobs 先例）」，守卫与 CAS 同事务无 TOCTOU；
  忙渠道 queued 自动跳过、不阻塞其它渠道补位。认领后复核不静默换基准：markdown
  模式、`doc.revision===base_revision`（不符 → interrupted「排队期间正文已变化…」）、
  skillById 存在、工具交集非空、binding_json 含 id；复核过且重读行仍 running
  （防认领后 controllers.set 前 cancelRun 空档）才起 _loop（seq 起点
  COALESCE(MAX(seq),0) 兼容 resume 首步骤）。
- 触发点两处：`src/creator-worker.mjs` runCreatorTick 两分支 runDue 旁
  `void core.agent.drainQueued().catch(()=>{})` + startRun loop.finally 追加补位
  （drain 链式传递）；runs() 不加惰性清扫。
- 启动清扫 WHERE 扩 `IN('running','queued')`，queued 专属 stop_reason「进程重启，
  排队任务未保留，请重新发起或重驱动」。cancelRun 放开 queued：纯 UPDATE CAS
  （无 controller），CAS 失败落既有 running abort 分支，终态仍 409。
- events 流：running/queued 都不算终态；queued 相位（含位次）变化发非游标帧
  `{kind:"run_status",status:"queued",queuePosition}`（无 seq），仅 queued→running
  过渡发 running 帧——从未排队的运行不产生任何 run_status 帧（旧流形状不变，
  既有游标/心跳用例零回归）。600s deadline 与心跳不变。
- 客户端 AgentRuns.jsx：附着过滤纳入 queued（单运行附着、附最新活跃行）；
  run_status 帧分流（更新状态/位次，不追加 steps、不推进游标）；重连条件、取消
  按钮、启动面 disabled 统一 `activeRun=running||queued`；新增 queued 文案
  「排队中（第 n 位）：等待并发空位后自动开始；进程重启后不会自动执行，可取消」。
- **五项语义决定（acceptance 追记）**：①排队不跨重启（consent 未落库，跨重启
  自动开跑等于用旧 consent 发新付费调用，排队不承诺跨重启存活）；②并发上限按
  core 计（每作者独立 SQLite 即独立上限）；③认领守卫与入队单飞是同一不变量
  （每 project+channel 至多 1 running+1 queued）的执行半边——同渠道 queued 仅在
  前序终态后认领；④面板单运行附着限制（只附本渠道最新活跃行，避免渲染错误
  上下文的取消按钮）；⑤revisions 排队被诚实转 interrupted（前序直写推进
  revision 后 drain 复核必然失败，不静默换基准，redrive 一步接手；建议制不推进
  revision 正常补位）。

### 12.2 SC-02：run 级模型请求预算 + 429 快速失败 + 面板额度

- `_loop` 的 chatWithTools 单次调用包进既有
  `usingTask(runId, binding, agentRunRequestCap(), …)`；只包单调用点、绝不包整个
  _loop——await 返回后 AsyncLocalStorage 上下文即退出，`_executeTool` 内图片工具
  预留天然在任务上下文外，不撞「任务未授权该用途」403（既有图片路径套件全绿
  由包裹位置结构性保证，npm test 含图片套件验证）。
- cap：`agentRunRequestCap()` 读时求值 `Math.min(20, Math.max(1, Number(env
  CONTENT_STUDIO_AGENT_RUN_REQUEST_CAP)||20))`。**诚实边界（QA 追记）**：缺省
  20、钳制 [1,20]；20 为 usingTask 既有校验上限，AGENT_MAX_STEPS=24 的极端运行
  第 21 次请求 429 快速 failed，resumeOf 重驱动获得新 run 新预算，不放宽共享
  上界。既有「步数上限」用例（原 :213-228）据此改写：预算先于步数上限生效
  （20<24，24 次 fetch 断言不可达），改断言恰 20 次 fetch + stopReason /额度/。
- 429 快速失败：_loop catch 在 failures++ 前判 `e?.status===429` → 记一帧
  model_error 后 `_finish('failed','模型请求额度已用完…')`，不再 3 次必然失败
  重试；429 尝试不消耗额度（_reserve 在 BEGIN IMMEDIATE 内 fail 即 ROLLBACK，
  单测断言 service_usage_tasks 中 task_id=runId 恰 2 行）。
- 面板额度：挂载第三路并行拉既有 GET /api/creator/usage（零新端点），渲染
  「今日模型请求剩余 n/m 次（逐次记账）」；**剩余口径**=limits.textLimit −
  Σ today[kind='text' 且 state∈(reserved,completed,unknown)].requests，与
  _reserve 占用逐字对齐（failed 退额不计）；展示为启动前预判，不做启动前硬闸
  （真值在服务端逐次占用）。consent 文案改「单次运行最多 {cap} 次模型请求，
  逐次计入每日额度」，cap 来自 GET /api/creator/agent 响应增列 runRequestCap
  （同一钳制 helper）；consent checkbox 加 aria-label="允许本次运行调用模型与
  图片服务"，e2e 4 处定位换该稳定锚点。额度行用独立类 `writing-usage-note`
  （偏差 3：初版复用 writing-source-note 与终态/排队文案串联，playwright strict
  mode 下既有 `.writing-source-note` 定位命中双元素，已拆分）。
- 既有计费回路用例（生产路径 dispatchApi 计费）零改动通过——wrap 后计费不变
  （最重要回归底线）。

### 12.3 AW-01：建议卡就地 original→replacement 对比

- `src/compose-view.mjs` 新增纯函数 `suggestionCompareView(s)` 四态（both /
  replacement-only / original===replacement 退化 / revoked 空原文降级，异常数据
  不伪装对比）；WritingWorkspace 待审建议卡（写作助手与审稿阶段共用渲染）升级
  常显对比块（`.writing-version-line is-del/is-add` 复用版本对比既有结构与
  --cv2-error/success token，块顶「原文片段 → 替换内容」说明行 +
  aria-label="建议对比"）；零新增请求。**交互决定（QA 追记）**：就地对比为主，
  「在正文中查看」保留为上下文定位次级入口；接受/拒绝与 decide/expectedRevision
  路径零改动。

### 12.4 AW-02：助手快捷指令菜单（Brush 适配）

- 8 技能各加纯展示字段 `preset`（与 stage 同待遇：只进 skills() UI 投影，不进
  systemPrompt/门禁/存储），措辞止于产出/审阅（无发布承诺，单测逐条断言）。
- AgentRuns.jsx 新增 `<details aria-label="快捷指令">`：顶部
  aria-label="搜索快捷指令" 输入（substring 匹配 title+preset，对齐 BrushEntry
  q/ql/hit 语义）+ 按既有 STAGE_GROUPS 分组列表项；点击=setSkillId+
  setInstruction(preset)+收起。**边界（QA 追记）**：预填不自动发送——consent 与
  「启动运行」disabled 门禁零改动，e2e 断言选中后 consent 未勾选、启动仍禁用。
- adaptedFrom 登记（见 src/agent-skills.mjs 与 components/AgentRuns.jsx 头注）：
  BrushEntry.tsx:7（选中即预填不自动发送）、:11,:31-32,:70-71（q/ql/hit 搜索）、
  :34-37（pick→onPick 仅预填）——**r6.1 行段更正**：原引 :5,48-57 是 DOT 表与
  画笔 SVG，不对应所引内容；capabilityMenu.ts:25 起 tabs 分组数据（:9-19
  meta/legend/counts 不引入）。弃用：BrushEntry 画笔动效、113 技能手工菜单、
  四态 legend、SkillDrawer 就地配 key。

### 12.5 门禁与验证（容器 node22-studio:pw，Node v22.23.3）

| 命令 | 结果 |
|---|---|
| `npm run check` | **PASS**（exit 0） |
| `npm test` | **704 tests = 699 pass / 2 fail / 3 skipped**。2 失败=V74 root 容器基线豁免（test/container-recovery-v74.test.mjs:81,:100「V74 maintenance requires an unprivileged Linux container」，与 §11.5 逐字同因同位置）；3 跳过=V69 sudo（基线一致）；**零新增失败**，净增 12 测全部通过（agent-runtime 25→35、agent-skills 4→5、compose-view 10→11） |
| `npm run build`（build-guard 封存） | **PASS**（✓ Compiled successfully in 23.8s；本轮内共 3 次全绿，最终一次为全量源码定稿后）。回执键仍为含未提交改动工作树的 HEAD——沿用 §9.2/§10.3/§11.5 既有披露口径 |
| `npm run test:production`（V49） | **PASS 1/1**——既有 §2/§11.6 欠账本轮补上（真实构建产物 + 进程重启持久化） |
| `npx playwright test e2e/agent-runtime.spec.mjs` | **6/6 通过**（既有 4 条零回归 + SC-01 排队新用例（含 r6.1 中间态守卫断言：放行前运行列表恰一条 running+一条 queued）+ AW-02 快捷指令新用例） |
| `npx playwright test e2e/writing-workspace.spec.mjs` | **15/15 通过**（既有 14 条零回归 + AW-01 就地对比新用例） |

- **e2e 环境披露**：Windows 宿主（Node v24.1.0）跑不了本仓库测试——
  `credentialKey` 的 POSIX 权限检查在 NTFS（mkdtemp 文件 mode 0666）下必然 503
  「凭据存储权限不安全」，宿主实测既有基线用例同样全挂（probe：file mode
  100666 & 0o077=54），与本轮改动无关；故全部门禁按 QA §1/§11.5 既有口径在
  容器内执行。node22-studio:pw 镜像仅含浏览器依赖库、无浏览器本体，本轮在临时
  容器内 `npx playwright install chromium`（Chrome Headless Shell 156.0.8078.4，
  仅写容器可写层，不进镜像/仓库）；webServer 以 PLAYWRIGHT_PORT=4391/4392 起独
  立实例。
- e2e 范围披露：本轮只全量重跑两个被触碰套件（agent-runtime、writing-workspace
  ——恰好覆盖全部触碰的 e2e 文件），其余套件与本轮改动无交集，未在本轮重跑。

### 12.6 已知偏差（如实登记）

1. **queuePosition 口径**（§12.1）：方案字面「COUNT queued rows」与验收①
   queuePosition=2 冲突，按「活跃行（running+queued）rowid 计数 +1」实现并通过
   全部验收断言；「第 n 位」= 你之前还有几条活跃运行（按 core 全局）。
2. **步数上限用例改写**（§12.2）：SC-02 使 24 次 fetch 的步数上限路径在 cap=20
   下结构性不可达；原用例改写为预算边界用例（恰 20 次 fetch + /额度/），步数
   上限收尾分支自此仅在预算未启用时可达，如实记录不虚留断言。
3. **writing-usage-note 独立类**（§12.2）：额度行不复用 writing-source-note，
   避免面板 `.writing-source-note` 定位在 strict mode 下串联。
4. **测试基建披露**：`npm test`/e2e 在 Windows 宿主不可用为既有环境限制（本轮
   以容器执行并实测记录）；既有 V74×2 失败与 V69×3 跳过为基线豁免，未做任何
   放宽或绕过。
5. **边界保持**：零 DDL、零新增公开端点、V75 边界不动、--cv2-*/既有 token 零新
   hex（writing.css 仅复用既有色值与 var(--writing-line)）、不搬 AGPL、未
   npm install（容器内 playwright install 仅测试浏览器，不触碰 package.json/
   lockfile）。真实付费模型、真实平台发布、生产部署仍未执行/未验证（与此前
   边界一致）。

### 12.7 全量 e2e 第 1 轮失败修复（Run E 追记，同日）

- 第 1 轮全量 `npx playwright test`（容器内）：**282 passed / 1 failed / 16
  skipped（11.8m）**，唯一失败
  `creator-v2-compose.spec.mjs:977 建议卡三控件`——等待
  `getByText('查看替换内容')` 超时。
- **定性：真实交互迁移，非抖动**。单跑复现（`-g '三控件'` 同样失败）；与 AW-01
  改动直接相关：该用例的合成建议带非空 original（服务端把 selection 填充为整篇
  原文，writing.mjs:887-890,972），`suggestionCompareView` 判 both 模式后
  `<details>查看替换内容</details>` 被「常显对比块」按方案取代（§12.3）——
  按「真实回归必须修」处理，不按抖动跳过。
- **修复**：该用例改写为断言新交互（原控件仅剩 replacement-only 降级态，
  WritingWorkspace.jsx:1344 仍在）：`[aria-label="建议对比"]` 常显可见，
  同时含「原文片段 → 替换内容」说明、原文片段（需要打磨的原始表达。）与替换
  内容（经过审阅的新表达。）——用例意图（作者无需展开即可核对真实替换文本 +
  拒绝后正文保持原样）完整保留；「在正文中查看」「拒绝」两控件断言零改动。
  用例名同步改为「建议卡「在正文中查看」、就地对比替换内容（AW-01 常显对比
  块）、「拒绝」三控件」。
- 第 2 轮全量 `npx playwright test`（容器内）：**283 passed / 0 failed / 16
  skipped（11.0m，exit 0）**——较第 1 轮 282→283 为改写用例计数口径（标题变更
  不改条数；第 1 轮该用例计 failed，本轮计入 passed），16 skipped 全部为既有
  fixme/skip（含 creator-v2-compose:1545「缺真实 API 种子路径」）。creator-v2
  -compose 套件单跑复核 30 passed / 2 skipped / 0 failed，既有用例零回归。
- 覆盖面说明（如实）：「查看替换内容」details（replacement-only 降级态）自此
  无 e2e 点击覆盖；其渲染分支由 suggestionCompareView 四态单测（§12.3）门控，
  风险为纯静态 details>pre 渲染。

### 12.8 全量 e2e 第 2 轮「webServer 启动失败」修复（Run E 追记，同日）

- 第 2 轮全量 `npx playwright test`：failed=0，但 harness 报
  `Process from config.webServer was not able to start. Exit code: 78`——无任何
  用例执行，属启动闸门拒绝而非用例回归。
- **根因（实证）**：V64 守卫按设计工作——`.next/content-studio-v64-build-receipt.json`
  封存的 `candidateCommit=1126119…`，而工作树 HEAD 已前进到 `feff130…`，
  `verifyBuildReceipt` 的 `candidateCommit!==expectedSha` 抛「Build receipt does
  not match pinned Git commit」→ `scripts/runtime-guard.mjs:73` status 78。
  上一轮（§12.7 第 2 轮 283/0）的 webServer 是在 HEAD 仍为 1126119 时启动的
  （feff130 提交落在该轮运行中途），故未触发。
- **修复（V64 设计内工作流，无任何守卫绕过）**：在当前干净 HEAD（feff130）重新
  `npm run build`（✓ Compiled successfully in 23.4s，exit 0），回执重封
  `candidateCommit=feff130…`；随后 `npm run test:production`（走受守卫
  start 路径）1/1 通过，证实 `npm start` 启动恢复。
- 第 3 轮全量 `npx playwright test`（容器内，HEAD=feff130）：**283 passed /
  0 failed / 16 skipped（11.1m，exit 0）**，与 §12.7 第 2 轮账目一致，16
  skipped 全部为既有 fixme/skip。
- 流程追记：自此每次新提交后如需再跑 e2e，须先在当次 HEAD 上
  `npm run build` 重封回执——这是 V64「build 封存、start 校验」的既定代价，
  登记为操作须知而非缺陷。

## 13. 登记缺陷批量修复（FIX-01…FIX-05，2026-10-23，feat/defect-fixes-agent）

- **范围**：五项登记缺陷一次修复，分支 `feat/defect-fixes-agent`（基于 main
  `00fb1a1`，开工时工作树干净）。权威验证环境：Linux 容器
  `node22-studio:pw`（§1 既有口径；Windows 宿主 `npm test` 因凭据存储权限
  POSIX 门禁无法启动测试，本轮实测复核依旧，§8.4 登记继续有效）。
- **FIX-01 幽灵 running 行（认领后复核收敛）**：`src/agent-runtime.mjs`
  `_startClaimed` 认领后复核段（writing.document()/profile()/skillById/
  binding 解析）整体包入 try/catch——认领 COMMIT 之后任何复核抛出统一以
  `_finish(runId,'interrupted','排队运行认领后复核异常终止：…')` 收敛落行
  （`_finish` 仅命中 status='running'，与既有显式 interrupted 返回路径幂等），
  不再沿 drainQueued 裸传播、被调用方 `void…catch(()=>{})` 吞掉后留下无
  controller/loopPromises 的幽灵 running 行占用渠道单飞/排队槽。新增单测
  「FIX-01 认领后复核异常」（删 agent_profiles 行触发 profile() 404）：断言
  B 行收敛 interrupted 终态、stopReason /复核异常/、零模型调用、
  controller/loopPromises 双空、该渠道 running/queued 活跃行归零、
  `drainQueued()` doesNotReject 且二次 drain 不改变已收敛终态。
- **FIX-02 切渠道后残留上一渠道运行卡片**：`components/AgentRuns.jsx` 刷新
  接续 effect 在按 props.channel 过滤后无本渠道活跃运行时 `setRun(null)`
  （原 early return 不清 run state），使组件自身行为与 :43-47「不回落展示
  其它渠道」自述一致。e2e「刷新接续」用例扩展：master running（holdModel
  保持）→ 切公众号 tab → 取消按钮与运行时间线消失 → 切回主稿 → 刷新接续
  重新附着本渠道 running 运行（取消按钮与「模型」帧回归）。
  **判别力披露（实证，如实登记）**：将本修复 stash 后重建再跑同用例仍然
  通过——WritingWorkspace 切渠道装载 effect `setDoc(null)`
  （components/WritingWorkspace.jsx:399，依赖 `[projectId, channel]`
  :477）会整体卸载包含 AgentRuns 的 `cv2-compose-grid`（:1962），组件随
  重挂复位，登记缺陷所述「组件又不重挂载」的前提在当前 WritingWorkspace
  结构下不成立，组件级残留当前被工作区重挂掩蔽。本修复保留为组件自洽性
  修正（防未来任何持久挂载形态复现该残留），e2e 扩展钉住用户可见契约。
- **FIX-03 主稿渠道检查类呈现（永不消解的 0/4）**：服务端显式拒绝 master
  的 checks（src/editorial.mjs:87「Checks belong to each publishing
  channel」）不变；呈现侧 `components/WritingWorkspace.jsx`：①就绪度条
  master 不渲染 checks chip（readiness 过滤 `key==='checks'`），右侧说明
  改为「人工发布检查按各平台渠道独立记录；主稿不直接发布。」；②审稿阶段
  侧卡 master 分支不再渲染四检查列表与「逐项勾选在发布准备里完成」指引
  （主稿上不可达成），改「主稿不直接发布」说明 + 创建公众号/知乎/小红书
  平台稿入口（与发布阶段既有「主稿不直接发布」卡同形态），非 master 渠道
  呈现逐字不变。e2e 同步三处 master 断言（V2 版式、阶段切换写 URL、前进
  后退）：负断言 `/待完成人工检查 \d\/\d/` 计 0 + 诚实文案可见；阶段切换
  用例另断言侧卡无 `cv2-check-list`、含 3 个「创建…平台稿」入口。
  compose 套件更新后 30 passed / 2 skipped / 0 failed。
- **FIX-04 排队期间 writeMode 翻转边（入队快照）**：`startRun` 入队时把
  writeMode 合并快照进该行既有 `binding_json` JSON 列（`{...binding,
  writeMode: profile.writeMode}`，零 DDL，与 resume 复用 binding 同一复用
  模式；resume 行快照取当前 profile，覆写旧行可能残留的同名键）；
  `_startClaimed` 认领时以快照 writeMode 附着 loop（陈旧行无快照键回退
  现读 profile，行为同修复前）；`_executeTool` 写模式门禁改按本运行
  `ctx.writeMode` 判定（与 `_loop` 工具面过滤同源，运行内不再现读
  profile）。语义决定（记 QA）：排队运行整体以入队快照 writeMode 运行，
  排队期间的建议制↔直写翻转只影响之后新开的运行。新增单测「FIX-04 排队
  期间 writeMode 翻转」：入队（建议制）→ 排队期间 `saveProfile({writeMode:
  'revisions'})`（面板 select 已 disabled，第二会话/直接 PUT 形态）→ drain
  认领后模型消息 `writeMode==='suggestions'` 且宣告工具面无 write_revision。
- **FIX-05 两处文案回改（EASEL-PORT-PLAN §13 定稿）**：①interrupted
  「排队期间正文已变化」补诊断——定稿全句「排队期间正文已变化（入队基准
  v{X}，当前 v{Y}），未按旧基准开跑；可按原绑定重驱动」（两个 revision 在
  认领复核处均可得）；②429 额度耗尽 stopReason 恢复「模型请求额度已用
  完：」+ 占用侧/provider message（不再丢 provider 信息，作者可定位是日
  额度还是任务预算耗尽）。单测增强：drain 复核用例断言诊断字段与
  /未按旧基准开跑/；额度快速失败用例断言 `^模型请求额度已用完：今日请求
  额度已用完`（日额度分支）、run 级预算用例断言 /该任务请求上限已用完/
  （任务预算分支）。
- **验证（容器内实跑）**：
  - `npm test`：**706 tests = 701 pass / 2 fail / 3 skipped**。2 失败为 V74
    root 容器既有环境豁免（test/container-recovery-v74.test.mjs:81,:100，
    错误逐字 `V74 maintenance requires an unprivileged Linux container`）、
    3 跳过为 V69（`requires non-root current UID` ×2 + `sudo -u nobody
    unavailable` ×1），与 §3 基线完全一致，零新增失败；净增 2 测
    （FIX-01、FIX-04）与全部增强断言通过。
  - `npm run build`（HEAD=`00fb1a1`，工作树含本批修复）：✓ Compiled
    successfully，V64 回执按当次 HEAD 封存。
  - `npx playwright test e2e/agent-runtime.spec.mjs
    e2e/creator-v2-compose.spec.mjs`：**36 passed / 2 skipped / 0 failed**
    （2 skipped 为既有 compose fixme/缺种子路径项）；agent-runtime 6/6
    （含 FIX-02 扩展断言），compose 更新断言全过。
  - 全量 e2e 本轮未重跑（§12.7/§12.8 第 3 轮 283/0 为最近一次全量账目；
    本批仅涉 compose/agent-runtime 两套件与 agent-runtime 服务端，定向
    套件已覆盖受影响面；如需全量，须先在提交后 HEAD 重建重封回执）。
- **边界**：零 DDL（binding_json/checklist_json 均既有 JSON 列复用）、零新
  端点、V75 远程边界与 --cv2-* 令牌未触碰、export≠实际发布语义未变。

### 13.1 全量 e2e 两轮追记：第 1 轮 3 失败定性 + 本批测试竞态修复（同日）

- **第 1 轮全量 `npx playwright test`**（容器内，HEAD=`1c9e657`，V64 回执
  同 commit）：**280 passed / 3 failed / 16 skipped（12.6m）**。逐条定性：
  1. `e2e/agent-runtime.spec.mjs:252`（刷新接续，**本批 FIX-02 扩展步骤，
     有交集→必须修**）：trace 取证（test-results trace 解包留档）——运行全程
     held running；最终挂载已附着运行（runs GET 08.817Z 响应 status=running、
     follow SSE 08.834Z 打开、失败 DOM 中技能 select 带 disabled=activeRun）；
     无重载、无重挂、无 effect 重跑（network log 穷尽）。唯一不满足项是
     `details.cv2-assistant-advanced` 的 open 属性。**根因（测试步骤竞态，
     非产品回归）**：`expect(cm).toBeVisible()` 可在「渠道已翻转、旧文档尚未
     卸载」的过渡渲染通过，其后一次性 `evaluate(el=>{el.open=true})` 绑定的
     details 会被装载 effect 的 `setDoc(null)` 整体卸载，最终挂载的 details
     恢复默认闭合——目标「取消运行」按钮在闭合 details 内，getByRole（可及
     性树）不可见 → 15s 超时。轻载定向复跑时序落在另一侧故此前 3 次（含
     stash 判别力探针）通过。**修复**：切回主稿后改为
     `expect(async()=>{evaluate 重开 details; toBeVisible; toContainText})
     .toPass({timeout:20_000})` 原子重试，对装载时序稳健。验证：单独复跑
     **3/3 通过**；第 2 轮全量通过。
  2. `e2e/creator-v2-home.spec.mjs:399`（通知待办，与本批无交集）：单独复跑
     **4.8s 通过**——后台系列准备 worker tick 的套内负载时序抖动（§9 曾登记
     同一用例同型抖动），按 §7.2 既有抖动定性规则归为抖动，不修。
  3. `e2e/creator-v2-publish.spec.mjs:1041`（键盘可达，与本批无交集）：单独
     复跑 **2.0s 通过**——/publish 页键盘焦点断言的套内负载时序抖动（§7 曾
     登记同型抖动），按 §7.2 归为抖动，不修。
- **第 2 轮全量 `npx playwright test`**（修复后；HEAD 仍 `1c9e657`，本批仅改
  e2e 用例不进 Next 构建，回执继续匹配）：**283 passed / 0 failed / 16
  skipped（15.2m，exit 0）**，与 §12.8 账目一致（16 skipped 全部为既有
  fixme/skip）。上节「全量 e2e 本轮未重跑」一句由此追记取代。

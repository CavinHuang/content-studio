# Creator V2 设计偏差登记（CREATOR-V2-DESIGN-DEVIATIONS）

> 依据 `docs/agent-tasks/CREATOR-V2-IMPLEMENTATION-PROMPT.md` §视觉与交互保真度硬性要求第 6 条：
> 当页面按原稿无法在真实数据、无障碍要求或安全约束下工作时，保留主要结构与视觉语言，做最小必要调整并在此登记。
> 每条包含：设计源位置/参考截图、实际差异、必要原因、替代方案、对应测试/截图。

## /compose 创作空间（2026-10-20，commit 范围 `feat/creator-v2-real-workspace` 分支）

1. **编辑器正文为 CodeMirror Markdown（分栏源码+预览），不是原型的 contenteditable 富文本纸面**
   - 设计源：`public/design/creator-v2.2.html:159`（`.editable` contenteditable 正文）、参考截图 `docs/implementation/screenshots/design/compose-desktop.png`。
   - 实际差异：正式页保留既有 `DoocsEditor`（CodeMirror 6，Markdown 源码）+ `WritingPreview`（doocs 本地渲染），默认「分栏」视图，白纸卡与 `MASTER DRAFT` 标签保留。
   - 必要原因：任务书「不可破坏」清单要求保留既有编辑器、自动保存、expectedRevision 冲突保护与不可变修订；contenteditable 原型只是视觉示意，没有保存/冲突语义。
   - 替代方案：以设计的稿纸卡（白底、圆角、纸标签、字数页脚）包住真实编辑器，视觉层级对齐设计。
   - 证据：`docs/implementation/screenshots/compose/compose-desktop.png`；`e2e/writing-workspace.spec.mjs`（12 例全过）、`e2e/creator-v2-compose.spec.mjs`。

2. **正文中不渲染原型式的内联图位按钮；图位以「配图视图」卡片 + 左栏配图定位 + 移动助手呈现**
   - 设计源：`public/design/creator-v2.3-visual.html:38-39`（正文段落间 `.inline-slot` 虚线按钮）、`v23-article-mobile.png`。
   - 实际差异：Markdown 编辑器正文内是真实的 `asset://` 图片行；图位状态在「切换到配图」视图（`ComposeVisualBoard`，虚线槽位卡样式与设计一致）与右栏配图助手（`WritingImages`）中呈现。
   - 必要原因：在 CodeMirror 文档内插入非编辑区块装饰需要深改编辑器，会危及不可破坏的编辑/保存/建议内联行为；任务书红线优先。
   - 替代方案：槽位视觉语言（虚线边框、＋占位、状态 pill、去生成/去审阅动作）完整搬到配图视图卡片上，状态全部来自真实 `GET /api/illustrations/projects/:id`。
   - 证据：`docs/implementation/screenshots/compose/compose-visual-desktop.png`；`e2e/creator-v2-compose.spec.mjs`「V2.3 配图入口」用例。

3. **渠道分段保留第四个真实渠道「小红书」**
   - 设计源：`creator-v2.2.html:159`（分段只有 主稿/公众号/知乎）。
   - 实际差异：分段控件为 主稿/微信公众号/知乎/小红书 四项。
   - 必要原因：小红书图文工作区（`XiaohongshuWorkspace`）是既有真实能力，`e2e/creator-v1.spec.mjs` 依赖；删除会丢功能。
   - 替代方案：沿用同一分段控件样式，四项并存。
   - 证据：`e2e/creator-v1.spec.mjs` 小红书导出链路通过。

4. **编辑器头部按钮比原型多（当前文章切换、新建文章、版本）**
   - 设计源：`creator-v2.2.html:159`（头部右侧仅 保存状态/返回作品/配图工作台/发布准备）。
   - 实际差异：增加 文章切换 select（`当前文章`）、`新建文章`、`版本` 三个真实操作入口。
   - 必要原因：多作品切换、建文与修订历史是 /compose 的真实既有功能，旧 UI 有、新设计未画。
   - 替代方案：保持设计的按钮次级样式（白底描边），主按钮仍为「发布准备」；窄屏按设计只保留主按钮与保存状态。
   - 证据：`e2e/writing-workspace.spec.mjs` 版本历史/新建流程；`e2e/creator-v2-compose.spec.mjs`。

5. **保存/冲突/恢复条保留旧交互形态，未做成 toast**
   - 设计源：`creator-v2.2.html:204`（编辑即存 toast 提示）。
   - 实际差异：保存状态为头部常驻 `role=status` 文本（已保存 · vN / 待保存 / 正在保存… / 保存暂停）；冲突与本地草稿恢复为醒目横幅（下载本地草稿/重试保存/载入服务器版本）。
   - 必要原因：冲突保护是安全边界（expectedRevision 409 后本地内容必须可下载、可重试），常驻横幅比 2.7 秒 toast 更不容易丢；`e2e/writing-workspace.spec.mjs` 断言这些横幅。
   - 替代方案：横幅配色对齐 V2 tokens。
   - 证据：`e2e/writing-workspace.spec.mjs`「two open pages cannot overwrite newer server content」。

6. **阶段条「配图」不显示已生成张数，仅以真实事实（已插入 asset:// 图片）标 done**
   - 设计源：`creator-v2.2.html:159`（done/now 态，示例数据写死 editorStep）。
   - 实际差异：研究/大纲/审稿/配图的 done 只来自真实事实（简报存在、真实标题行、已决策建议、已插入图片），发布恒为数字（写作文档不含导出/作者报告事实）；见 `src/compose-view.mjs` 注释与 `test/compose-view.test.mjs`。
   - 必要原因：任务书红线「无后端可信依据不得展示」；原型 editorStep 是写死的示例状态。
   - 证据：`test/compose-view.test.mjs`；`e2e/creator-v2-compose.spec.mjs` 阶段条断言。

7. **移动端工作流底栏叠加在全局底栏上方（不合并、不覆盖）**
   - 设计源：`creator-v2.3-visual.html:14,53`（底部固定 正文/配图规划/选图编辑/预览）；V2.3 原型无全局底栏。
   - 实际差异：正式页同时有 CreatorShell 全局移动底栏；工作流底栏固定在其上方（`bottom: calc(var(--cv2-mobile-nav-h) + …)`），两者并存。
   - 必要原因：设计清单要求「不允许与全局底栏随意合并或互相覆盖」。
   - 证据：`docs/implementation/screenshots/compose/compose-mobile.png`；`e2e/creator-v2-compose.spec.mjs` 移动用例（断言两个导航同时可见且无横向溢出）。

8. **文章标题使用 h1（样式为设计的 20px 编辑器头部字号）**
   - 设计源：`creator-v2.2.html:159` 编辑器头部标题为 h2（原型侧栏 logo 占用 h1）。
   - 实际差异：文章标题为页面主标题 `h1`，20px 样式与设计一致。
   - 必要原因：无障碍语义（页面主标题应为文章标题）；既有 e2e 以 level-1 heading 断言文章标题。
   - 证据：`e2e/writing-workspace.spec.mjs`、`e2e/creator-v1.spec.mjs` 通过。

9. **图位名称沿用配图领域序号（封面=1，正文图位从 02 起）**
   - 设计源：`creator-v2.3-visual.html:21-23`（正文配图 01/02 独立编号）。
   - 实际差异：图位标题用计划内真实 `ordinal`（文章封面、正文配图 02/03…）。
   - 必要原因：序号来自 `article_illustration_shots.ordinal`（含封面的计划内序号），选段配图（无封面）时序号从 1 开始，改编号会在无封面计划下显示 00。
   - 替代方案：状态标签（待生成/待审阅/已选用/生成失败）与设计一致。
   - 证据：`src/compose-view.mjs#shotTitle`、`test/compose-view.test.mjs`。

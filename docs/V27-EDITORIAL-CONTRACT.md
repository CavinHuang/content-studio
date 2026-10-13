# V27 统一编辑器 · 模型、接口与状态契约

## 设计目标

在同一个工作界面完成主稿／渠道稿编辑、段落级来源标注、证据过时提醒、研究更正和本地交付。严禁把 AI 建议、作者判断和真实平台事实混为一谈。

## 关键数据模型

| 表 | 职责 | 核心约束 |
|---|---|---|
| `editorial_projects` | 一篇文章的业务根、关联 Brief 与可选知识卡 | `id` 主键；卡只能关联一次，跨 Brief 研究关系必须相同 |
| `editorial_channel_refs` | 每渠道独立引用、检查、导出和作者报告状态 | `UNIQUE(project_id,channel)`；`master/wechat/zhihu` |
| `article_documents` + `article_document_revisions`（V26 原有） | **唯一文稿段落存储** | 稳定段落 ID；追加不可变修订；乐观锁 `expectedRevision` |
| `paragraph_claims`（V26 原有） | 原句、段落、准确证据 ID、知识修订及研究版本 | 精确短句存在、证据属于该知识修订；旧锚点不能自动改绑 |
| `precision_corrections`（V26 原有） | 研究变化触发核查、提案和人工批准 | 多阶段状态；唯一触发版本；原文修改和结论处理单事务 |
| `editorial_exports` | 本地交付版本与内容快照 | 内容不可随着以后修改自动变化 |
| `editorial_publication_reports` | 作者登记外部 URL 的历史记录 | 与导出修订对应，不声称核验外部平台 |

V27 新编辑器复用旧版 `PrecisionService._ref()`，优先查 `editorial_channel_refs`，兼容旧版 `KnowledgeService.references()`。这避免在两套编辑器间复制各自不可相互引用的证据系统。

## REST API

| Method | URI | 行为 |
|---|---|---|
| GET | `/api/editor/projects` | 文章列表、当前文稿、来源及核对状态 |
| POST | `/api/editor/projects` | 创建文章及三份独立初始文稿，可选 `briefId`、`paragraphs` |
| GET | `/api/editor/projects/:projectId` | 读取三渠道版本、证据与待更正任务 |
| PUT | `/api/editor/projects/:projectId/:channel/document` | 带 `expectedRevision` 保存不可变新版及重置检查 |
| POST | `/api/editor/projects/:projectId/:channel/refresh` | `confirmOverwrite:true` + `expectedRevision` 才可显式沿用主稿；不可静默覆盖 |
| POST | `/api/editor/projects/:projectId/:channel/checks` | 四项显式布尔值 + 当前文稿修订号，记录渠道人工确认 |
| POST | `/api/editor/projects/:projectId/knowledge` | 绑定有历史修订的知识卡，必要时验证 Brief 同案关系并重置复核状态 |
| POST | `/api/precision/claims`（旧接口） | 段落精准原句引用与知识证据关联 |
| POST | `/api/precision/corrections/scan` | 研究修订差异形成待核查任务 |
| POST | `/api/precision/corrections/:id/propose` | 保存候选更正，不改文章 |
| POST | `/api/precision/corrections/:id/decide` | 作者批准本地稿更正并追加不可变文稿修订 |
| POST | `/api/editor/projects/:id/:channel/export` | 校验渠道状态并冻结 HTML/TXT 快照，返回待下载内容 |
| GET | `/api/editor/projects/:id/:channel/exports` | 导出历史 |
| POST | `/api/editor/projects/:id/:channel/reported` | 仅作者报告已发表 URL，需匹配当前已导出版本 |
| GET | `/api/precision/documents/:refId/history` | 文稿全部历史版本 |

约定：不匹配的正文修订或研究触发版本必须返回 **409**，不存在的 ID 返回 **404**，缺少同源 Origin 权限时拒绝写入。对于编辑器新增段落，ID 格式为 `p_...`。

## 渠道状态规则

1. 主稿更新 → 不更改已有公众号／知乎正文；展示 `masterOutdated`。首次人工修改并保存渠道稿视为对当时主稿的明确复核，复用独立版本体系。
2. 任意渠道正文保存 → 追加修订、四项检查变回未完成、当前渠道状态重置为 `draft`；旧 `exportedRevision` 保留。
3. 研究变化或引文漂移 → 原始证据锚点保留，旧研究引用显示 `needsResearchReview`；生成新的更正任务；直到处理适当核查不得导出。
4. 导出 → 必须四项人工确认、相应主稿版本确认、无过期引文、无未解决更正、有效当前修订；然后本地记录快照。**绝不是自动发表**。
5. 作者登记发表 → 当前修订必须有本地导出；存入 `editorial_publication_reports`；任何本地再编辑都会回到 `draft`，旧发表 URL 仅保留历史。
6. 公众号和知乎所有核对/导出/发表状态相互隔离；不自动向第三方发布或更改文本。

## 已知限制与下轮候选

- V21 使用浏览器 localStorage 文稿；V27 通过显式按钮单篇复制保存稿进入 SQLite，不自动双向镜像，也没有自动从旧 V26 批量迁移内容引用。
- 单用户本地工程，缺少生产身份授权、账户权限、数据备份与安全审计。
- 仅纯文本段落；复杂富文本应采用结构化 AST/ProseMirror，保留稳定块/文本范围、资产引用与跨渠道序列化，并进行公众号、知乎真实后台粘贴验收。
- 编辑器未实现实时多人协作、真实 AI 内联 diff 或生产级离线同步。人工决策与模型推断必须继续分开。

# Content Studio V25 · 研究知识、引用影响与反馈技术契约

## 设计目标与客观边界

将 V24 的 `verification_cases` 变成可用于创作的追加式知识资产，并在证据发生变化时提醒引用过该知识的主稿、公众号稿和知乎稿；允许作者把发表后的读者问题转入新一轮验证。**作者手动录入的信息不应升级为平台认证或已独立确认的事实。**

## 数据表（服务启动自动 `CREATE TABLE IF NOT EXISTS`，兼容 V24 已有 DB）

| 表 | 核心字段与约束 |
| --- | --- |
| `knowledge_cards` | `id`，`case_id UNIQUE`，`current_revision`，标题与时间。一个验证档案对应一张知识卡。 |
| `knowledge_revisions` | `card_id/revision UNIQUE`、`case_version`、`case_status`、假设/结论/提炼内容/局限性/证据快照。只追加版本，不原位改写旧修订。 |
| `content_references` | `brief_id`、`card_id`、初始知识修订/研究版本、渠道、作者填报状态、复核水位与理由。强制卡片与 Brief 引用同一验证档案。 |
| `audience_feedback` | 关联引用文章、类型、匿名摘要、待验证假设、人工填报来源、关联验证档案。 |
| `knowledge_audit` | 卡片版本创建、引用登记、人工复核、反馈新建/转研究的操作日志。 |

V24 的 `briefs` JSON 快照保持不可变。V25 只对新建 Brief 的 `verification` 字段增加 `caseVersion`，不回写 V24 历史 Brief；旧版无水位时显示“历史版本不明”，不得默认为最新。

## HTTP API

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/api/knowledge` | 聚合卡片、引用、反馈与未处理数 |
| `GET` | `/api/knowledge/:id` | 当前卡片及全部知识修订历史 |
| `POST` | `/api/knowledge` | `{caseId,synthesis,limitations}`；只允许已有锁定结论，若同一 `caseVersion` 已保存返回 409 |
| `GET` | `/api/briefs` | 只读历史 Brief 列表（本地单用户前提） |
| `GET` | `/api/content-references` | 关联文章列表及动态影响分析 |
| `POST` | `/api/content-references` | `{briefId,cardId,title,channel,status,reportedUrl?}`；`channel=master/wechat/zhihu`，`status=draft/exported/reported_published` |
| `POST` | `/api/content-references/:id/review` | `{currentRevision,currentCaseVersion,action,note}`；状态水位冲突返回 409，操作含 `checked_no_change/correction_planned/correction_reported` |
| `GET` | `/api/feedback` | 作者反馈汇总及关联验证状态 |
| `POST` | `/api/feedback` | `{referenceId,kind,summary,hypothesis,sourceUrl?,privacyConfirmed:true}`；读者评论/提问仅可关联作者报告已发表的文章；作者观察可关联草稿 |
| `POST` | `/api/feedback/:id/promote` | 使用合成的内部 `feedback_...` 事件新建 V24 验证档案，初始 `open`、零证据；重复请求复用同一档案 |

错误状态包括 400（字段无效）、403（非法跨域 Origin）、404（实体不存在）、409（知识或引用版本冲突、不符合业务状态）。服务继续仅监听 `127.0.0.1`。写操作没有额外身份认证，因此不对公网暴露。

## 影响判断：两个可分离的警示

`needsReview = knowledge.currentRevision != reference.reviewedRevision OR verification.caseVersion != reference.reviewedCaseVersion`。复核完成后将当前水位与动作、说明保存到引用记录；如果研究再次变化，又会出现提醒。

`briefSnapshotOutdated = brief.verification.caseVersion is missing OR brief.verification.caseVersion != verification.caseVersion`。此属性不因“已处理”而消失；必须生成新的 Brief / 内容快照才可能得到新的历史版本。

例：研究 v3 → 知识 v1 → 公众号文章 A 引用 Brief(v3)。研究重新打开变 v4：A `needsReview=true`。作者登记已计划修订后 A `needsReview=false`，但 `briefSnapshotOutdated=true`，证明没有静默改写历史。研究又改 v5 或知识发布 v2，A 再次出现 `needsReview=true`。

## 隐私与独立性

平台评论只能人工输入去标识化摘要，且须显式勾选隐私确认；没有自动识别姓名、邮箱或电话号码的能力。绝不将“一条评论/一次本地复现/一篇转载”自动认定为需求普遍成立。`reported_published`、`correction_reported` 都是**作者自报，不是平台核验**。

## 工程风险与下一步

- 缺少数据库 schema 版本管理；本轮只新增表/字段，正式迁移建议引入版本化 migration + 可恢复备份。
- 单进程 SQLite 同步写，跨进程部署需要更严格事务协调与幂等请求键。
- 内容关联目前按 Brief+知识卡**人工登记**，还没有从富文本逐段提取精确引用和自动更正定位。
- 浏览器与外部源的真实联网、真实读者研究、数据合规和正式发文仍需独立验收。

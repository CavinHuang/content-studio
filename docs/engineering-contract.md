# V23 · 数据流、同步合同与 UX 判断边界

## 1. 信息结构

```text
信息源：AIHOT selected snapshot/changes · GitHub Release · Hacker News · 官方 RSS
    ↓ 公开元数据标准化（id、sourceId、nativeId、originalUrl、role、publishedAt）
SQLite items（条目） + selected_mirror（精选当前集合） + selected_sync_state（服务端水位）
    ↓ 同一规范化原文 URL 才做自动归并
Event（来源分角色）
    ↓ problemSignals + area match + evidence gaps（规则候选，非事实认证）
Opportunity
    ↓ 人工选择、可选显式模型分析
Brief immutable evidence snapshot → 旧有 Content Studio 创作工作台
```

### 数据实体

`source_state` 是原有六源检查结果，`selected_sync_state` 是 AIHOT **全量精选镜像**独立水位；两者不能混用。

`selected_mirror` 保存 AIHOT 原始条目 JSON（本地只读副本）。`items` 保存标准化活跃条目。原始链接可为空时优先 AIHOT 站内链接；`selected_mirror` 不代替网站的全文权限。

`briefs.snapshot` 保存创建当时的证据关系，后续撤选也不会静默重写历史 Brief。需要增加单独的撤选警告与重新核查时可在未来迭代引入。

## 2. AIHOT 完整精选同步契约

依据 AIHOT `/openapi-v1.json` 与官方同步指南，必须：

1. 第一次请求 `/api/v1/selected/snapshot?fields=default&limit=500`。
2. `hasMore=true` 时只用 `nextPage` 访问续页，不将其作为后续同步水位；所有页面 `cursor` 必须与第一页一致。
3. 全部页完成后，在 **同一个 SQLite 事务** 内替换旧精选集合、对应 `items` 行和水位。任何一页出错、字段损坏、游标重复时保留旧数据。
4. 后续用 `/api/v1/selected/changes?cursor=<stored>`，每一页 `upsert`、`remove` 与返回的 `cursor` 原子提交。
5. `409` **且 code 为** `snapshot_required` 才做完整重建；429/503 尊重 `Retry-After`，并保留上次成功水位及所有记录；无关 409 不做破坏性恢复。
6. 不连续快速轮询，保持检查最短 3 分钟间隔；快照翻页最多 50 页的安全上限。源账号权限／商业使用规则独立于技术接口。

### 已知局限

- Selected Changes 未做长期压力测试；没有调度器和重启恢复外的监控告警。生产场景仍需容量、备份、预留磁盘空间和原子快照的性能验收。
- V22 的 AIHOT 最近 24h 列表采集与完整镜像在启用后互斥：已有完整镜像水位时不再重复采集列表，避免把已撤选内容重新引入 active items。
- 暂不做语义相似事件合并，仅合并精确规范化的原始 URL。这种保守方式牺牲覆盖率以保证不误合并两个不同事件。

## 3. 用户真实问题识别的界限

- `problemSignals` 必须引用现存 `item.id`，包含来源 ID、证据类别和文本片段。即使同帖包含多个关键词，也只能成为一条原始证据记录。
- 社区直接问题与官方发布分开计数，热度不得当作证据确证。`validatedUserProblem` 在 V23 中始终为 `false`；这是故意设计：自动打分**没有资格确认需求真实且普遍**。
- 评分用于**研究优先级排序**，不用于事实可信度或商业回报预测。领域初始规则由词典匹配，实际准确率尚未量化。
- 模型只接收外部公开来源的标题、短摘要与 id，不发送私有文档；AI 输出只允许关联已给定的证据 ID。模型会产生错误，因此页面显著标明“未经验证”。
- 下一阶段建议在 UI 中增加人工确认“已经复现／采访确认”的闭环，以真实证据修订候选，避免只靠模型或关键词排序。

## 4. 交互状态与异常

| 状态 | 预期 UI 行为 |
|---|---|
| 未采集 | 真实空状态，提供跳转信源按钮；不默认注入样本 |
| 场景样本 | `/live` 用显眼文字声明合成数据；选题也带原始 `scenario fixture` 标题 |
| 需要一手证据 | 黄色缺口提示；允许创建 Brief，但不代表文章可发表 |
| 镜像同步失败 | 保留旧条目与 cursor；记录错误和下一次允许重试时间 |
| AI 未配置 | 禁用 AI 按钮；可解释规则照常可用 |
| AI 返回缺失引用 | 对无效 `evidenceItemIds` 直接剔除；绝不伪造来源 |
| 导出 Brief | 独立版本，不会自动覆盖正在编辑的旧稿 |

## 5. 对下轮的工程建议

首次真实联网验收之后，优先建设基于实际场景的用户问题证据账本（可确认、驳回、回访、复现实验），再用证据闭环训练／校准推荐，不宜盲目堆积更多来源。

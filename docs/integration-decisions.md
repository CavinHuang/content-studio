# V22 工程验证决策与下一轮建设计划

## 1. 架构

`P0 Adapter → HTTP Client（ETag、限流、超时）→ Normalize → SQLite Items → URL-key Events → Evidence Classification → Immutable Brief → V21 Editor`

- **可信度边界**：上游新闻标题、官方宣发、讨论均是“来源陈述”，不是系统认证的事实。最多从 URL、来源类型推断角色。 `independentConfirmed` 恒为 0，直到未来有人工核验机制。
- **聚合粒度**：去 `utm_*` 等常见追踪参数，统一规范 URL；同一规范链接跨源归一为单事件。相似标题、不同 URL 暂不自动聚合。原始来源 URL 仍存储在 SQLite 供核验。
- **存储**：单机 SQLite 按 `source_id + native_id` 幂等入库；source_state 保留 ETag、上次检查、成功时间、next_retry；briefs 独立存快照 JSON。
- **同步控制**：手动 POST 的逐源顺序执行，单进程互斥；AIHOT 最小间隔 60 秒，自动计划时间间隔 15 分钟；Github/官方 RSS 依各自设定的 20-60 分钟建议间隔。429 优先遵循 Retry-After，若无则读取 GitHub reset 时间。
- **网络安全**：UI 不提交任意待抓 URL；六种来源的配置写死在适配器里，仅允许 HTTPS、禁止重定向、响应最大 2MB、请求超时 10s，服务默认 loopback 绑定。
- **元数据采集**：不为了提高“素材完整度”大量复制原始全文；只存标题、有限摘要和原文链接。

## 2. 当前源配置

| ID | Provider | Endpoint | 初步接入限制 |
|---|---|---|---|
| aihot | AIHOT | `/api/v1/items?mode=selected&window=24h&limit=20` | 初始只是最近一天第一页；商用需确认许可 |
| github-claude | GitHub | `GET /repos/anthropics/claude-code/releases` | 仅 Release，不能代表所有代码变化 |
| github-opencode | GitHub | `GET /repos/anomalyco/opencode/releases` | Repo 示例可后续配置化 |
| hackernews | HN Firebase | `topstories` + 前 12 个 `item/{id}.json` | 社区热度不等于独立真实性 |
| rss-openai | OpenAI 官方 | `https://openai.com/news/rss.xml` | 需要验证生产环境具体 HTTP 兼容性 |
| rss-deepmind | DeepMind 官方 | `https://deepmind.google/blog/rss.xml` | 需要验证生产环境具体 HTTP 兼容性 |

正式外部调用尚未在当前容器执行成功：构建环境 DNS 解析不可用。

## 3. 数据语义

`role='primary_statement'`：由项目维护者或官方博客直接发布的声明，不代表第三方已核实；
`role='syndication'`：由聚合器收录，不能因为多处收录就将相同原文算成多个独立来源；
`role='discussion_signal'`：社区话题、票数或用户意见，关注“痛点是什么”，但不给事实证实加分。

选择一条事件创建 Brief，会产生新的快照，包含 source ID、角色、原链接、首次采集时间。作者必须补全事实边界、个人实践和适配平台时的版式检查。该操作不会自动写出已通过审查的新闻文章。

## 4. 外部 API 验证清单（本阶段未通过）

- [ ] 在可联网机器分别测试六源：HTTP 200、字段映射、可用字符集、页面数量和时间窗口
- [ ] AIHOT `ETag`/304、429 的真实响应结构及商业授权是否满足使用场景
- [ ] GitHub 未认证限额、使用 token 后限额、不同 release/prerelease 边界
- [ ] HN 故事列表过大时抓取预算、404/删除帖/无外链内容
- [ ] 官方 RSS 的实际订阅返回（以及跳转、CDATA、Atom）
- [ ] 完整精选 snapshot + changes、cursor 过期、409 snapshot_required 恢复
- [ ] 新闻更正／撤选对既有 Brief 的再核查提示

## 5. 下一轮 P0 真实连通性验收

在用户真实运行环境中执行上述清单，保存每个来源的时间、HTTP 状态、是否成功解析、进入 SQLite 的条目数、原始 URL、同步耗时与错误。若全部来源失败，显示“来源不可用＋已有缓存”，绝不改成假实时榜单。完成后再考虑 AI 筛选、个人领域权重和问题信号提取。

## 6. 参考资料

- AIHOT API：<https://aihot.news/agent?tab=api>；其 v1 接口为匿名只读，公开服务不承诺 SLA。
- AIHOT 接入与授权：<https://aihot.news/agent?tab=api>。
- GitHub Releases：<https://docs.github.com/en/rest/releases/releases>。
- GitHub 限流：<https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>。
- Hacker News：<https://github.com/HackerNews/API>。

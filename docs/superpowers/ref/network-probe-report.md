# 外网信息源可达性探针报告

- 日期：2026-10-28
- 分支：`feat/real-foundation`
- 探针方式：Node v24.1.0 原生 fetch（undici），只读 GET，每源 15 秒超时，跟随重定向。共测四轮：第一轮浏览器 UA 摸底；第二轮错误路径修正与重试确认；第三轮限流冷却后复核；第四轮换用产品真实抓取 UA 复测。探针脚本放在系统临时目录运行，未入库。
- 产品 UA（第四轮所用，与真实抓取器逐字一致）：`Mozilla/5.0 ContentStudio/0.1 (creator hotspot fetcher)`，见 `packages/desktop/src/main/discovery/feed.ts:242`。
- 结论摘要：**3 个源可作默认预置候选**（阮一峰 atom.xml、AIHOT feed.xml、60s `/v2/weibo`）；Hacker News 在本网络环境被 TLS 层阻断，**只能用户自配**；60s 实例有无前缀 404、Cloudflare 限流与间歇空数组三个坑，预置时须避开。

## 1. 源清单与路径修正

| 源 | 探针地址 | 说明 |
| --- | --- | --- |
| 阮一峰科技爱好者周刊 | `https://www.ruanyifeng.com/blog/atom.xml` | Atom 订阅 |
| Hacker News | `https://news.ycombinator.com/rss` | RSS 2.0 |
| AIHOT | `https://aihot.news/feed.xml` | RSS 2.0（`application/rss+xml`） |
| 60s 微博热榜 | `https://60s.viki.moe/v2/weibo` | JSON 热榜（vikiboss/60s 公益实例） |
| 60s 知乎热榜 | `https://60s.viki.moe/v2/zhihu` | 同上 |
| 60s 抖音热榜 | `https://60s.viki.moe/v2/douyin` | 同上 |

**路径修正（重要）**：任务给定的 60s 无前缀路径 `/weibo`、`/zhihu`、`/douyin` 全部返回 404，响应体是 87 字节的 JSON 错误对象（`{code, message, data}`）。正确路径带 `/v2/` 前缀。产品若接入，帮助文案与预置配置都必须用 `/v2/*`。

## 2. 探针结果总表

所有数字均来自本次真实运行（第四轮为产品 UA、请求间隔 8 秒；此前三轮为浏览器 UA）。

| 源 | 状态 | 耗时 | 格式与条数 | 备注 |
| --- | --- | --- | --- | --- |
| 阮一峰 atom.xml | 200 | 727–1116ms（TTFB 799ms） | Atom，3 条 | 订阅本身只携带最近 3 期周刊（416／415／414 期），`<updated>` 为 2026-10-27T03:02:20Z，内容新鲜；48681 字节 |
| Hacker News rss | ❌ 阻断 | ~5 秒后失败 | — | 4 次尝试（含产品 UA 1 次）全部 `Client network socket disconnected before secure TLS connection was established`，TLS 握手层被断，稳定复现 |
| AIHOT feed.xml | 200 | 116–363ms | RSS 2.0，50 条 | 40509 字节，响应最快 |
| 60s `/v2/weibo` | 200 | 1165–2552ms | JSON，50 条 | 字段 `title`／`hot_value`／`link` |
| 60s `/v2/zhihu` | 200 | 866–1140ms | JSON，30 条 | 第二轮返回过一次 `data: []` 空数组（间歇性），冷却后恢复 30 条 |
| 60s `/v2/douyin` | 200 | 1797ms | JSON，50 条 | 连续快速请求时被 Cloudflare 429（HTML 挑战页）；间隔 8 秒后正常 |
| 60s `/v2/60s`（每日榜单） | 429 | 235–682ms | — | 与 douyin 同轮被限流，未再复测（非任务要求源，仅记录） |

补充事实：

1. 第四轮（产品真实 UA）对全部 5 个可达源的测试与浏览器 UA 结果一致——上述源不挑 UA。
2. 60s 实例的限流是按请求频率触发的：同一 IP 连发 4 个请求即 429，间隔 8 秒全部放行。
3. HN 的失败发生在 TLS 握手阶段（服务器与 UA 均未及参与），属于本机网络环境对外阻断，不能据此断言源本身故障；但产品目标用户若多数处于同类网络，预置即常态报错。

## 3. 对产品来源功能的建议

产品现状锚点：热点域目前内置的是演示冻结快照 `DEMO_SOURCES`（`packages/desktop/src/main/discovery/service.ts:36`，定义在 `packages/desktop/src/shared/discovery-demo.ts:44`），真实预置源是待新增能力；抓取器按内容嗅探 JSON 热榜／XML 订阅两条路径（`packages/desktop/src/main/discovery/feed.ts:260-293`），15 秒超时、3MB 上限、非 2xx 直接抛「来源返回 N」（`feed.ts:244`）。

### 3.1 可作默认预置源（真实抓取验证通过）

1. **阮一峰 atom.xml**：快、稳、新鲜，直接命中 Atom 解析分支（`feed.ts:113-135`）。订阅仅 3 条是源侧设计，预置时条数预期要按此沟通。
2. **AIHOT feed.xml**：最快（116ms）、50 条、标准 RSS 2.0，命中 `feed.ts:95-112` 分支，零适配成本。
3. **60s `/v2/weibo`**（三选一，见 3.2）：JSON 形状 `{code, message, data: [{title, hot_value, link}]}` 与热榜适配器完全匹配——列表路径命中 `['data']` 兜底（`feed.ts:141-152`），标题／链接／热度字段全部命中（`feed.ts:171-173`），解析层零改动。

### 3.2 只能靠用户自配（或预置需降级预期）

1. **Hacker News rss**：本网络环境 TLS 层阻断（4／4 次复现）。作为默认预置源会常态报错，建议放「自配源示例」而非预置；文档可注明「依网络环境而定」。
2. **60s `/v2/zhihu`、`/v2/douyin`**：可达但两个坑——快速连发触发 Cloudflare 429；zhihu 会间歇性返回空数组。若预置多个 60s 端点，刷新必须错峰（串行＋间隔），且预置至多一个为宜。用户自配单端点则风险很低。
3. **一个待办的产品侧改进（本次未改代码，仅记录）**：`parseHotListJson` 的 `findItemList` 要求非空数组（`feed.ts:164`），60s zhihu 空数组时会抛「热榜数据格式无法识别：没有找到条目列表」——把「请求成功但列表为空」与「格式错误」区分开，报错语义会更准确。
4. **限流与正文补抓解耦**：热榜条目逐条补抓正文的上限是 10 条（`feed.ts:228`），补抓目标打到条目自身链接（如微博搜索页）而非 60s 实例，不会加剧其限流；限流风险只在「同实例多端点刷新」时存在。

### 3.3 一句话结论

默认预置：阮一峰 ＋ AIHOT ＋ 60s `/v2/weibo`（三者均以产品真实 UA 实测通过）；HN 与 60s 其余端点留给用户自配，并在添加源的界面文案中提示网络环境差异与限流可能。

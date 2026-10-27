# 纪要一：公众号 API 2026-10 实测形状与微信排版转换链设计要点

> 来源：M3 实施计划 `git show 0929d66:docs/superpowers/plans/2026-10-24-m3-variants-publish.md`（探针事实 #6/#7 与 Task 3/Task 6 规格）＋ 提取代码 `19f5778-wechat-mp.ts`、`19f5778-markdown-to-wechat-html.ts`、`e7767d6-wechat-typeset.mjs`。
> 计划作者声明这些探针事实在写计划时「实际跑通」且 API 形状经「官方文档确认，2026-10」。本次仅整理，未重新联网验证。

## 一、公众号 API 2026-10 实测形状

### 1. 鉴权：stable_token（推荐，替代旧 token 接口）

- `POST /cgi-bin/stable_token`，JSON body `{ grant_type: 'client_credential', appid, secret }` → 响应 `{ access_token, expires_in }`。
- 客户端缓存策略（19f5778 实现）：到期前 5 分钟提前刷新——`expiresAt = now + expires_in*1000 - 300_000`；未到期直接复用缓存，不发请求。
- 业务接口带 token 的拼接形状：path 已带查询串（如 `add_material?type=IMAGE`）时用 `&access_token=` 接，否则 `?access_token=`——避免 `?` 重复的畸形 URL。

### 2. 素材与草稿接口字段

| 接口 | 请求 | 响应 | 用途 |
|---|---|---|---|
| `POST /cgi-bin/material/add_material?access_token=..&type=IMAGE` | multipart 字段 `media` | `{ media_id, url }` | 封面等**永久素材**；`thumb_media_id` 必须来自这里 |
| `POST /cgi-bin/media/uploadimg` | multipart 字段 `media` | `{ url }` | **正文内图片必须用此 URL**（draft/add 硬约束，外链图片会被屏蔽） |
| `POST /cgi-bin/draft/add` | body `{ articles: [{ title, author, digest, content, thumb_media_id, need_open_comment: 0, only_fans_can_comment: 0 }] }` | `{ media_id }` | 创建草稿，**停在草稿态**；正式群发由用户在公众号后台操作 |

### 3. draft/add 字段限制（计划原文照录）

- title 必填 **≤32 字**；author **≤16**；digest **≤120**（留空平台取正文前 54 字）；content 必填 **<2 万字符且 <1M** 且**去 JS**；thumb_media_id 必填（封面永久素材 media_id）。

### 4. 错误形状与 40001 单次强刷

- 错误统一形如 `{ errcode, errmsg }`；网络层与 API 层分开（`WechatNetworkError` vs `WechatApiError`）。
- token 类错误码 **40001/40014/41001/42001**：业务调用遇其中之一 → `getAccessToken(true)` **强刷一次**并重试**一次**，绝不循环强刷（19f5778 的 `call()` 实现：catch 后 force 刷新再 post，二次失败原样抛出）。
- 登录探测（loginCheck）对 `40125`/`40013` 附加人话提示：「检查 AppSecret 是否正确、本机出口 IP 是否已加入公众号后台 IP 白名单」。

### 5. 前提条件：IP 白名单（spec D2）

- **调用出口 IP 必须在公众号后台 IP 白名单内**——这是用户配置前提，需在配置界面与人工验收清单明示（spec 风险登记 D2 原文：「公众号 API 需要用户自备 appid/secret 且有白名单域名要求，M3 实施时验证实际约束，文档明示配置前提」）。

### 6. 零依赖基础（探针事实 #6）

- Node≥18 全局 `fetch/FormData/Blob` 已实测可用（本机 Node 24.1.0 与 Electron 45 主进程 Node 22.22 双验证）：FormData append 后 `get('media') instanceof Blob === true` 且带 filename/size ⇒ multipart 上传**零新 npm 依赖**。fetch 全程可注入（`opts.fetchImpl`），单测不联网。

## 二、微信排版转换链设计要点（e7767d6，两条路径）

历史上有**两条互补的转换路径**，移植时按用途选择：

1. **极小转换器**（19f5778 `markdown-to-wechat-html.ts`，服务 draft/add API 链）：标题/段落/加粗/斜体/链接/图片/引用/分隔线；**转义在前、不产 JS**（draft/add 约束）；配套 `replaceLocalImages` 把正文内本地图片逐个经 `uploadimg` 换成微信 URL；`safeJoin` 做路径越界防护（`ASSET_OUT_OF_FOLDER`）。
2. **主题化排版引擎**（e7767d6 `wechat-typeset.mjs`，服务预览/下载交接）：marked 解析 + 主题内联 + 脚注 + CJK 间距 + 校验器。

排版引擎的五个设计要点：

- **内联主题**：公众号编辑器会剥离 `<style>` 与 class ⇒ 主题不写 CSS 文件，而是**语义 token 集**（root/h1/h2/p/blockquote/code/pre/img/footnote…每个元素一段内联 CSS），`applyTheme` 用正则把 `style="..."` 逐元素注入；三套主题（墨版经典/纸面暖调/冷静科技）。
- **外链转脚注**：正文 `<a>` 只留「文本 + 上标序号」，链接集中到文末「参考链接」节；脚注样式经 `__FOOTNOTE__` 占位符二次替换注入。
- **CJK 间距**：中西文之间补空格，只处理**标签外文本段**，`code/pre` 内的空格是代码语义原样保留（分段时维护 inCode 计数）。
- **句读移出加粗**：微信正文里句尾标点在 strong/em 内会被原样加粗 ⇒ `<strong>句子。</strong>` → `<strong>句子</strong>。`。
- **发布前校验器**：确定性规则而非目检——`<script>`（整段过滤）、`<style>`（必须内联）、`<iframe>`（不支持）、**外链图片**（会被屏蔽，必须先经 uploadimg）→ 返回 `{ ok, errors }`。

管道顺序固定：`marked.parse → movePunctuationOutOfEmphasis → externalLinksToFootnotes → cjkSpacing → applyTheme → placeFootnoteStyles → validate`。转换全是纯函数，可离线单测。

### 借鉴边界（AGPL 铁律，必须延续）

e7767d6 提交声明：架构借鉴 wewrite（MIT，内联主题与平台兼容修复清单）与 Easel gzh-design（AGPL，仅借鉴「主题组件库 + 确定性校验」思路），**未复制任何一方代码**，实现为旧仓库原创。继续移植时同样只许借鉴思路，自有实现必须原创。

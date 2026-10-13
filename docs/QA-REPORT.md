# V22 QA / 工程验证报告

## 实际执行的验证

- Node v22.16.0：`npm test` 适配器/去重/存储/ETag/429/限流/Brief 等 **15 / 15** 通过。
- Browser (Chromium + Playwright)：HTML 注入方式执行，利用 Python 转发前端 API 请求到运行中的真实 Node 服务，**10 / 10** 通过；覆盖来源状态、跨源归并、证据详情、搜索、创建 Brief、V21 Brief 导入、JS 错误和 390px 移动端溢出。
- Node HTTP 服务实际监听并返回 `/api/status`、`/api/events`、`POST /api/fixture/seed`、`POST /api/briefs`；本次浏览器测试调用的是运行中的 Node API，而不是直接 mock API 结果。
- 纯离线 scenario fixture 样本来自固定 JSON、RSS 测试文本；录入样本不发外网请求。

## 本轮未验证

- 对 `aihot.news`、`api.github.com`、`hacker-news.firebaseio.com`、`openai.com` 或 `deepmind.google` 的实际 HTTP 200 成功连接。容器 curl 返回 DNS 解析失败。
- Chromium 的 http://127.0.0.1 本地直连以及跨刷新持久化；浏览器页面经注入方式测试，受当前运行环境管理员策略限制。
- AIHOT 全精选 snapshot/changes 的增量重建、撤稿同步、GitHub RateLimit 实际上限、官方 RSS 实际字符集。
- 真实用户体验、公众号／知乎发布测试、商业环境授权确认和公网部署安全审计。

## 质量边界

“15 + 10 通过”仅代表确定性的程序测试与本地联调；**不代表六个第三方来源已完成真实联网验收**。

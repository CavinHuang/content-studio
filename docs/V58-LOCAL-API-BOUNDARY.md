# V58 — 本地 API 入口安全边界

## 目标与背景

本项目尚无多用户身份认证，因此只有单机回环访问是可接受的。V49 已守护生产进程绑定，旧 API 仅检查 URL/Origin 的部分信息；V58 在 API 路由内部增加统一入口验证，不修改编辑、排版、配图或发布业务模型。

## 实现

- **网络地址**：请求 URL 必须为 HTTP(S) loopback；传入 Host 时同时验证其 authority 为 localhost/127.0.0.1/[::1] 且端口必须与 URL 一致，拒绝逗号 Host 链、用户信息、路径和远程 DNS 主机名。代理头不被视为认证或真实来源。
- **浏览器来源**：存在 Origin 时要求与请求同协议、同端口、回环地址；允许 localhost 与 127.0.0.1 的同端口别名；拒绝不可信 Origin、cross-site Fetch Metadata、导航式写入，以及没有 Origin 的 same-site 写入。
- **写入类型**：带请求体的 POST、PUT、PATCH、DELETE 要求 application/json（可选 UTF-8 charset），不接受浏览器简单表单 content-type，也不接受没有类型的请求体。无正文写入保持可用。
- **顺序**：`lib/api.mjs` 在懒加载默认 Core/SQLite 之前执行安全检查，避免未授权请求触发数据库创建或模型任务。
- **兼容**：站内 fetch 仍使用相对路径和 application/json；错误使用既有 API JSON 响应体与状态码。

## 验证

```bash
npm run test:security:v58
npm run check
npm test
npm run build
```

测试包括恶意 Host、端口变化、同端口别名、Origin 改协议和跨端口、缺失 Origin 的跨站标记、简单表单 CSRF、无请求体操作和真实 SQLite API 的拒绝写入情况。5 个独立 Node 单元测试在 Node 22.16.0 本地运行通过。GitHub CI 对合并后的完整应用进行检验，最终状态须以对应提交的 Actions 为准。

## 安全边界

此措施只是未经认证的 **loopback** 工作台的纵深防御，不是身份认证或授权系统。具有本机进程访问权的程序仍可调用 API；无法由此得出已具备公网部署、外部托管、真实用户库迁移、微信公众号/知乎发文或付费模型调用的许可。V54–V57 的备份、版本准入和人工上线审批限制继续有效。PR #26 保持 Draft。

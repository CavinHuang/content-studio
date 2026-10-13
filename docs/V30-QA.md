# V30 质量验证 · 2026-10-13

**本地运行环境**：Node.js 22.16，内存 SQLite。

- `npm test`：105/105 PASS（本地源码）。
- `npm run check`：通过。
- React JSX：TypeScript parser 语法解析通过。
- `npm view next@16.2.0`：DNS `EAI_AGAIN`，未能安装依赖。
- `npm run build`：未运行，不应宣称 Next.js 实际构建成功。
- doocs/md 运行、真实微信公众号与知乎后台复制兼容：未执行。

用例覆盖文案变化、Markdown 样式保持、重复段落、链接变化、段落调序、证据复核、预览令牌、409 版本冲突、审阅摘要历史、双渠道隔离与检查失效。

**设计限制**：没有完整 Markdown AST、没有自动事实认证、没有真实外部发表。

# V30 — doocs/md 排版 Markdown 回流差异审阅

## 工作流

频道正文 → 导出 Markdown → 独立 doocs/md 排版 → 导回 → 差异审阅 → 显式确认 → 新排版修订 → 重新人工审核。

此工程**不具备**经验证的 doocs/md 自动双向同步 API，不会读取第三方 iframe、自动发布文章或自动认定事实可靠。

## API

- `GET /api/composer/projects/:id/:channel`：当前渠道、文稿版本、最近导回审阅摘要。
- `POST /api/composer/projects/:id/:channel/review`：输入 `{expectedLayoutRevision,expectedDocumentRevision,markdown}`，只读检查并返回源段落匹配、未匹配段落、顺序变化、外链/图片变化、证据复核提示、`reviewToken`。
- `PUT /api/composer/projects/:id/:channel`：如果存在文字实质变化或过时证据，强制要求 `acknowledgeDrift:true` 与有效 `reviewToken`，且绑定当前文稿/排版修订，旧预览和换稿保存会拒绝（409）。
- `GET /api/composer/projects/:id/:channel/history`：不可变排版历史，包含作者当时的审阅摘要。

数据追加到 `editorial_layout_review_history`，与 `editorial_layout_history` 同事务写入。历史数据无审阅摘要时返回 null，不应被视为自动审核成功。

## 发布安全

- 匹配文字不代表事实已经核实；改写部分绝不自动继承原句证据。
- 保存渠道稿后撤销该渠道四项确认；主稿与另一渠道不受影响。
- 本地导出不是已发表；未接入微信/知乎自动发文或更正。
- 这是保守的文本启发式审查，**不是 CommonMark 完整 AST，也不是事实核查器**；复杂 HTML、表格、代码和跨段落语义仍需人工检查。
- GitHub 目前是 Public 仓库，不得提交用户文档、SQLite 数据库、密钥、个人笔记。

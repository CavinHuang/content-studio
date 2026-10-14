# Content Studio V31：微信 / 知乎粘贴兼容性预检

## 已实现

- V30 Markdown 逐段差异审阅后同时运行静态兼容预检；
- 阻断级：本地图片路径、file/data/javascript URI、动态 HTML、未闭合代码围栏。服务端禁止把含阻断问题的新稿存档（422），人工勾选不能绕过；
- 警告级：HTTP 链接、内嵌 HTML 等，允许存档但需要复核；
- 待实测：代码高亮、表格布局、引用样式、外部图片存活及微信/知乎后台复制效果。
- 每渠道单独生成 6 项人工验收清单，所有项目初始 **pending**，可填写平台/日期/截图编号并导出附内容哈希的 JSON；
- 导回的排版修订历史保留静态分析摘要，公众号和知乎互不覆盖。

## API

- POST /api/composer/projects/:id/:channel/review：返回 V30 文字证据对照和 V31 compatibility。
- PUT /api/composer/projects/:id/:channel：按既有 token/版本锁校验；存在兼容阻断时返回 422。
- GET /api/composer/projects/:id/:channel/compatibility：只读扫描当前渠道排版稿。
- GET /api/composer/projects/:id/:channel/history：查询不可变排版与预检历史。

## 测试步骤

分别将三类 fixture 提供给 doocs/md 并导回 Content Studio：01 事实/引用；02 表格/代码/图片；03 有危险链接和本地图片的故障样本。正常文章在两个渠道的真实编辑器中粘贴并截图，记录失败兜底策略，复测后保留证据。故障样本应该被程序阻断。

**边界**：静态预检不是 CommonMark 的完整解析器、HTML sanitizer、实际微信/知乎粘贴验证，也不代表已经发表。真实平台测试与授权账号尚未执行。

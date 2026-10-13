# V32 · Agent 自动配图与素材库契约

## 目的

让作者在完成正文后从 `/compose` 进入 `/illustrations`，由系统根据**当前不可变主稿版本**生成封面和章节配图候选，再经人工挑选进入排版稿。图片生成结果属于**AI 合成的概念配图**，不作为事实证据，不暗示真实实验照片、真实人物肖像、真实产品截图或可验证图表。

## 实际完成的步骤

1. `POST /api/illustrations/projects/:id/plan` + `expectedMasterRevision`: 本地确定封面和最多两张章节配图的段落锚点、alt 和提示词；**不调用外部模型**，不发送私人正文。
2. `POST /api/illustrations/projects/:id/shots/:shotId/generate` + `{allowExternalAI:true}`：用户逐次显式授权后，请求环境变量配置的 OpenAI-compatible Images API (`POST images/generations`) 生成真正的 base64 图像。后端保存到本地 SQLite BLOB 素材库，严禁未经确认的 URL-only 下载和自动上传公网。
3. `POST /api/illustrations/projects/:id/shots/:shotId/decision` `{decision:"approve"|"reject"}`：作者逐张审阅并选择图片。成功生成不等于自动批准。
4. 每渠道手动上传到 doocs/md 或具有使用授权的素材站点，并使用 `PUT /api/assets/:id/mappings/:channel` 登记该渠道真正可使用的 HTTPS URL 和人工操作记录。
5. `GET /api/illustrations/projects/:id/handoff/:channel` 生成**只读带图 Markdown 提案**；无法定位原段落时保留警告而不乱插图片。不会直接改动原有 `editorial_layout_drafts`。
6. 将提案复制到 doocs/md 排版，按照 V30/V31 导回审阅和渠道核查；真实平台粘贴效果和版权必须人工验证。

## 环境配置

```dotenv
CONTENT_IMAGE_API_BASE_URL=https://api.openai.com/v1/
CONTENT_IMAGE_MODEL=<支持 images/generations 且响应 b64_json 的图像模型>
CONTENT_IMAGE_API_KEY=<secret>
```

密钥**只在服务端读取**；不要写入 `NEXT_PUBLIC_` 环境变量，也不要提交 `.env.local`。模型必须支持 `images/generations` 的 `b64_json` 返回。调用失败时保留失败状态供手动重试；无配置时仍可离线生成方案、不能凭空生成图片。

## 关键状态和安全契约

- 源主稿版本与配图计划版本绑定；修改主稿后旧计划显示过期，拒绝继续生成、批准或创建新交接。
- 同一图片生成任务在单实例内防止并发重复调用；失败写入失败状态，重试必须重新授权。
- 支持 PNG / JPEG / GIF / WebP 的字节签名检查，存储最大 6 MiB；SHA-256 去重。**并不证明图像内容可靠或版权合规。**
- 上传图像永远先存本地；预览路由 `no-store` 且响应 MIME 固定为服务端检测的类型；不通过服务器转发公网图片或用户传入 URL，避免 SSRF。
- 公众号与知乎分别维护图片 URL 映射。未映射的素材不会进入带图稿；HTTP、本机、私网和危险 URL 均会被拒绝。
- `handoff` 仅写入响应，不写数据库中的正式稿件；页面继续以 V30 的导回审阅和 V31 的人工粘贴清单为交付路径。
- 不收集或存储图片模型调用凭据，计划仅持有当前文章标题／选定段落摘要。**点击生成时会向配置的服务发送这些摘要。**
- 单用户本地模式，不可未经额外鉴权和网络隔离直接部署到公网。

## 明确不包含

- 微信公众号、知乎的自动图片上传／发文／真正的兼容性验收；
- 对图中事实、人物、商标和版权自动核验；
- 自动用 AI 图替代需要准确尺寸、数值、代码或截图的技术证据图；
- doocs/md 未提供的私有双向同步接口。

## QA

运行 `npm test` 验证权限、失败、版本、隔离、映射和图片存储约束；`npm run build` 和微信/知乎实际粘贴测试应由 GitHub CI 与授权测试环境分别执行。

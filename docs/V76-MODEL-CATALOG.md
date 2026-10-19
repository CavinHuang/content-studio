# V76 — 远程模型目录、开放模型多选与创作期模型对比

## 范围

- 设置页「写作与配图服务」连接表单支持在填写 Base URL + API Key 后，
  经服务端向 `{baseUrl}/models` 拉取 OpenAI 兼容模型列表，并多选「开放使用」的模型。
- 每个连接的开放模型集合存于新表 `service_connection_models(connection_id, model)`；
  默认模型始终开放（旧连接由迁移回填），集合仅在保存时显式整体替换，事务内完成。
- 创作工作台可选定一个或多个开放模型：多个时按顺序各发起一次独立生成
  （每个生成仍是独立的 `writing_generations` 记录、独立绑定、独立用量预留），
  建议与生成记录均标注来源模型，便于同版本对比后接受其一。

## 端点

- `POST /api/creator/services/models`：body `{baseUrl, apiKey, allowExternalCheck}`。
  `allowExternalCheck` 为假时 403；地址必须通过既有 `publicEndpoint`（公网 HTTPS、
  无凭据/查询/内网端口）；请求经既有 pinned-DNS/TLS 边界（`publicRequest`），
  20 秒超时、500KB 上限、不跟随重定向。列表请求不预留生成额度，也不计入每日额度。

## 不变量

- 绑定完整性不变：`captureBinding(kind, choice)` 允许指定备用连接的任一开放模型，
  指纹按 `[id, base_url, 所选模型, secret]` 计算；旧绑定（未指定模型）指纹不变。
  `resolveBinding` 在结算前复核所选模型仍在开放集合内，被收回即失败关闭（403）。
- 生成 != 发布：对比结果只是待审阅建议，接受仍走既有 `expectedRevision` 冲突检测；
  V27 各渠道独立、四项人工检查、来源标注均不受影响。
- 模型列表是服务商自报的目录，不代表模型质量或可用性已验证；
  真实公网服务商 `/models` 兼容性未验证（测试全部使用注入的合成传输层）。
- 凭据行为不变：apiKey 仅在服务端加密保存；列表请求的密钥只发送到
  通过校验的同一服务商地址，不落日志、不入库。

## 测试

`test/model-catalog-v76.test.mjs`（8 例）：授权与公网 HTTPS 强制、列表解析去重裁剪、
失败提示、开放集合替换语义、备用连接指定模型、任务内 env 使用所选模型、
开放集收回后旧任务失败关闭、streamGeneration 按所选模型生成并暴露来源、
恢复请求须沿用原模型、API 路由行为。

全量套件在 `node:22`（含 git 与 Noto CJK 字体）容器运行：554/560 通过，3 跳过；
3 个失败（V74 归档清理 ×2、`agent-xhs-tools` 字节一致性 ×1）经干净 HEAD 基线
复跑确认为容器环境既有问题，与本次改动无关。

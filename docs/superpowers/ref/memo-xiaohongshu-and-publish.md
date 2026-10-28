# 纪要二：小红书注入铁律、WebContentsView 会话要点与发布编排参数

> 来源：M3 实施计划 `git show 0929d66:docs/superpowers/plans/2026-10-24-m3-variants-publish.md`（探针事实 #1–#5、Global Constraints、Task 4/5 规格）＋ 旧总规格 `git show 63d3433:docs/superpowers/specs/2026-10-24-content-ops-workbench-design.md`（§5/§6/§11）＋ 提取代码 `cc0f351-inject-script-xiaohongshu.ts`、`cc0f351-platform-session.ts`、`cc0f351-adapter.ts`、`edf225b-publish-service.ts`、`edf225b-domain-tools.ts`。

## 一、小红书注入铁律（全部机械化，不是口头约定）

1. **自包含**：注入函数不引用任何模块级变量/导入——它经 `toString()` 序列化后由主进程 `webContents.executeJavaScript` 在页面上下文执行（探针事实 #4：`eval('(' + fn.toString() + ')')` 往返实测可行）。
2. **只填不点**：脚本只填标题/正文/话题（话题以 `#` 追加在正文尾）；**绝不点击「发布」类按钮**——注入脚本不含任何点击发布按钮的代码路径。
3. **发布按钮点击数 = 0 是硬断言**：fixture 编辑器页（`tests/fixtures/xiaohongshu-editor.html`，cc0f351 落盘）的发布按钮点击会上报 fixture 服务器专用端点，e2e **断言上报数为 0**。这是「绝不点发布」的可执行验证，不是注释。
4. **不调平台内部接口**：DOM 注入只派发 UI 事件（input/change/paste/blur），脚本内无 fetch/XHR 到平台域名。
5. **注入前防覆盖**：编辑器已有内容且与本次负载**不一致** ⇒ 拒绝注入并明确报错（`ALREADY_HAS_CONTENT`，绝不静默）；**一致**视为幂等重试允许重填（判定：标题全等 + 正文含新负载前 16 字归一化前缀）。
6. **登录前置**：URL 含 `/login` 或页面文案命中「扫码登录/手机号登录/登录后创作/请先登录」⇒ `NOT_LOGGED_IN`，引导用户先登录。
7. **jsdom 探针事实 #3**：jsdom 29.1.1 无 `DataTransfer`/`ClipboardEvent` ⇒ 粘贴路径必须有 `typeof` 守卫，单测走 textContent+InputEvent 回退；真 Chromium（e2e/真实平台）走粘贴优先，粘贴后校验前缀落位，失败回退，再失败报 `FILL_FAILED`。
8. **选择器多级降级**：标题/编辑器各有 3–4 个候选选择器按可见性取第一个；全部找不到 ⇒ `PAGE_CHANGED`（「适配器需更新」，绝不静默）。标题超 20 字自动截断并出 warning。
9. **AGPL 借鉴边界**：仅借鉴 WeSight（AGPL-3.0）的定位/等待/填充思路，实现必须原创；选择器对照本仓库 fixture 与真实平台人工验收整理。

## 二、WebContentsView 平台会话要点（cc0f351 `platform-session.ts`）

- **每平台一个常驻 `WebContentsView`**（Electron 45 实证存在，探针 #2），会话用 `session.fromPartition('persist:<platform>')`——**登录态 cookie 由平台自己写入 partition，应用不落明文、不入库**。
- **安全三开关**：`contextIsolation: true, nodeIntegration: false, sandbox: true`。
- **URL 白名单**：只加载平台白名单域名（默认 `creator.xiaohongshu.com`）；env/设置显式覆盖编辑器地址时 hostname 才追加进白名单——覆盖必须是用户的显式动作。地址不合法/不在白名单 ⇒ `EDITOR_URL_INVALID`/`EDITOR_URL_BLOCKED`。
- **UA 常规化**：剥离 `Electron/x.y.z` 与应用名 token，窗口特征与常规浏览器一致（风控）。
- **挂载形态**：`attach(visible)` 挂主窗口 contentView——visible=右半屏（x=55% 宽 45%），false=**零尺寸隐藏**（登录探测/后台注入仍可执行）。
- **evaluate 超时**：`executeJavaScript` 包 90s `Promise.race` 超时，防页面脚本卡死编排层。
- **Playwright 探针事实 #1（关键）**：Playwright 的 `ElectronApplication` **没有 `contents()`**，e2e 无法直接访问 WebContentsView 页面内容 ⇒ 断言只有两条路：①发布中心 UI 状态（回读结果）；②**fixture 服务器的请求日志**（fixture 页在 input 事件上报编辑器状态、发布按钮点击上报专用端点）。
- **测试环境**：单测用 `// @vitest-environment jsdom` pragma（探针 #5 实测生效；若不生效退路=挪进 `tests/renderer/`）。

## 三、发布编排：重试三分类、限速参数与人机边界

### 失败三分类＋两个显式扩展（spec §6 原定义 + M3 裁决）

| 分类 | 触发码 | UI 动作 |
|---|---|---|
| `not_logged_in` | `NOT_LOGGED_IN` | 引导去登录页 |
| `page_changed` | `PAGE_CHANGED` / `FILL_FAILED` | 明确报「适配器需更新」，**绝不静默失败** |
| `network` | `NETWORK` / `TIMEOUT` | 可重试 |
| （扩展）`already_has_content` | `ALREADY_HAS_CONTENT` | 防覆盖拒绝，引导人工清空编辑器 |
| （扩展）`api_error` | `WECHAT_API`（errcode 非 token 类） | 公众号 API 错误如实呈现 |

映射函数在 `adapter.ts` 的 `classifyFailure()`；`validation`/`unknown` 为编排层内生的两类。UI 逐类有中文文案与对应动作。

### 限速与串行参数

- **全局串行互斥链**：所有平台所有任务共用一条 `chain: Promise` 链，逐个执行；`next.catch(() => {})` 保证**链不断**——单任务失败不影响其他平台/任务。
- **相邻执行最小间隔**：默认 **15 000 ms**，env `CONTENTDECK_PUBLISH_MIN_INTERVAL_MS` 可调，构造参数 `minIntervalMs` 可注入（测试置 0）。
- **任务相位机**：`queued → validating → login_check → injecting → reading_back → prepared`（api 平台跳过回读）；终态 `prepared`/**停在草稿态**——「人工在平台点发布」是人机边界的一部分。每次相位变化 `emit({kind:'task_update', task})` 外发。
- **重试**：`retry(taskId)` 仅 `phase === 'failed'` 可重试，重置后重新入链。
- **AI 侧边界**（domain-tools）：agent 只有 `save_variant`（写草稿区）与 `create_publish_task`（**只建任务，绝不触发注入**——注入只能由人在发布中心点击发起）；`create_publish_task` 失败（无适配器平台/服务未就绪）返回 `isError` **如实反馈，绝不谎报「已创建」**。

### 凭证最小信任

AppSecret 存 userData：safeStorage 加密优先（base64 编码存储），不可用则 `plain:` 前缀明文回退并在视图标记 `encrypted: false`；出主进程的只有脱敏视图（`hasSecret`/尾四位）；保存时未改密钥用占位 `KEEP_WECHAT_SECRET` 沿用旧值；解密失败（换机器）视同未配置引导重填；**绝不进内容库/git**。

### M3 当时「明确不做」的边界（移植时重新评估，勿默认照搬）

- 变体图片的自动上传注入（小红书为纯文本注入；例外：公众号封面走 API 上传，属 API 非 DOM 注入）。
- 微信草稿 `draft/update`（仅 `add`——重试会产生新草稿，UI 需提示）。
- `publishes` SQLite 持久化（M3 任务态在内存、重启清空，属当时防 scope 漂移的裁决；spec §4.2 本有 publishes 表设计，归 M4 运营域）。

### 适配器接口（双模式）

```ts
PlatformAdapter {
  key; rules; usesSession: boolean;  // dom=true（页面驱动）；api=false（无页面，PublishService 传 noPageDriver 占位）
  loginCheck(d: PageDriver); injectDraft(d, {doc, variantPath, contentFolder}); readBackStatus(d);
}
```

api 平台误用 driver 即显式报错（noPageDriver.evaluate 抛「API 平台无页面会话」）。发布流程总纲（spec §6）：`选内容+平台 → 变体确认（本地规则校验先行）→ 登录探测 → 草稿注入（串行限速）→ 停在草稿态 → 状态回读`。

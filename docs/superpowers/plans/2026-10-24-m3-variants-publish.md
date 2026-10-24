# ContentDeck M3 实施计划：一稿多态变体工作台 + 公众号文章 API + 小红书适配器

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 M2 的 pi agent 创作流之上交付 spec §10 M3 行：①一稿多态变体工作台（`platforms/*.md` 读写、内置四平台硬规则与本地校验、`variant-convert` 转化技能、`save_variant`/`create_publish_task` 领域工具）；②公众号文章官方 API 链（stable_token 缓存、图片素材上传、草稿创建，停在草稿态）；③小红书 DOM 适配器（WebContentsView + `persist:xiaohongshu` 独立 partition、UA 常规化、可配置编辑器 URL、自包含注入脚本：只填标题/正文/话题，绝不点发布）。全程不依赖真实平台与真实 API key：单测 mock fetch + jsdom fixture 回放，e2e 用本地 fixture 编辑器页与 mock 微信 API 服务器走发布中心全链；真实平台行为=人工验收清单（spec §9，不伪造）。

**Architecture:** 变体是内容（文件）：`platforms/<platform>.md`（frontmatter `platform/title/topics/digest/cover/updated` + 正文），经既有原子写模式落盘；AI 产出仍只进草稿区（`.studio/drafts/<内容id>/`，草稿新增 `platform` 元数据字段），人确认后才进变体文件——M2 铁律原样延伸。发布链在主进程：`PublishService`（任务队列/全局串行互斥+最小间隔/三分类失败+防覆盖映射/事件外发）编排 `PlatformAdapter`（`loginCheck/injectDraft/readBackStatus/platformRules`，spec §6 接口）；`PlatformSession` 封装 WebContentsView（`persist:<platform>` partition、UA 常规化、URL 白名单、`executeJavaScript` 注入自包含脚本）；公众号文章适配器同一接口但走 `WechatMpClient`（fetch 可注入，stable_token 缓存与 40001 单次强刷），凭证存 userData（safeStorage 加密优先，脱敏视图不出主进程——沿用 M2 评审模式）。渲染进程新增两页：变体工作台（编辑/校验/采纳变体草稿/去发布）与发布中心（选内容+平台卡片/登录态探测/变体确认+本地规则校验/注入进度/失败分类重试/平台视图区）。

**Tech Stack:** 零新增 npm 依赖——`fetch/FormData/Blob` 用 Node 22 内置（探针实证，见下），DOM fixture 用既有 jsdom，e2e 用既有 Playwright；**不引 better-sqlite3**（publishes 表随 M4 运营域 SQLite 一起交付，M3 发布任务态在内存，见「M3 明确不做」）。

**Spec:** `docs/superpowers/specs/2026-10-24-content-ops-workbench-design.md`（本计划实现其 §10 M3 行；§5 save_variant/create_publish_task 与一稿多态技能、§6 发布链全程、§4.1 platforms/ 变体文件、§9 测试策略、§2 非目标「自动发布永不做」生效）

## 依据与借鉴边界（必读：WeSight 为 AGPL-3.0）

- 已读 `D:\workspace\wesight\wesight-chrome\LICENSE`：**WeSight 浏览器扩展采用 GNU AGPL-3.0**（强传染 copyleft）。spec §12 对 WeSight 的定位是「本地源码研读，未复制代码」。
- **借鉴边界（铁律）**：只借鉴其**思路**——标题框按 placeholder 含「标题」定位、正文框按 contenteditable 定位、轮询 waitFor 等元素出现、登录态用页面文案特征探测、粘贴优先+textContent 回退的填充策略、上传前后轮询预览计数。**不复制任何代码**；本计划的注入脚本为本仓库原创实现（`src/main/publish/inject-script-xiaohongshu.ts`），选择器列表对照**本仓库 fixture 页**与真实平台人工验收时独立整理。CSS 选择器串本身视为对平台 DOM 的事实性标识，不构成 AGPL 意义上的衍生。
- 本仓库不因此引入 AGPL 义务；任何执行者不得从 wesight-chrome 复制文件进本仓库。

## 探针已验证事实（执行者必读，勿重新发明）

以下全部在写本计划时**实际跑通**（本机 Windows + Git Bash，仓库依赖就绪态）：

1. **Playwright 无 WebContentsView 页面访问**：`node_modules/playwright-core/types/types.d.ts` 的 `ElectronApplication` 方法面只有 `evaluate/browserWindow/close/context/firstWindow/process/waitForEvent/windows(+事件)`，**没有 `contents()`**。⇒ e2e 断言平台视图内容只能走两条路：发布中心 UI 状态（回读结果）与 **fixture 服务器的请求日志**（fixture 页在 input 事件上报编辑器状态、发布按钮点击上报专用端点——e2e 断言点击数为 0）。
2. **Electron 45 有 `WebContentsView`**：`node_modules/electron/electron.d.ts:19720`（class WebContentsView extends View）与 `BrowserWindow.contentView.addChildView`（:4121/:16840）。
3. **jsdom 29.1.1 无 `DataTransfer`/`ClipboardEvent`**（probe 输出两者均 `undefined`），`InputEvent`/`Event` 可用。⇒ 注入脚本必须以 `typeof ClipboardEvent !== 'undefined' && typeof DataTransfer !== 'undefined'` 守卫粘贴路径，jsdom 单测走 textContent+InputEvent 回退路径；真 Chromium（e2e/真实平台）走粘贴优先。
4. **函数源码 eval 往返可行**：`eval('(' + fn.toString() + ')')` 在 jsdom 环境下正常调用（probe 返回预期 JSON）；`new JSDOM(html, { url })` 的 `url` 选项可设定 `location.href`（登录 URL 分支可测）。
5. **vitest jsdom pragma 生效**：在 `tests/unit/` 下用 `// @vitest-environment jsdom` 文档块覆盖 node 项目环境（实测 1 passed）。若个别版本不生效，退路=把该测试文件挪进 `tests/renderer/`（判定标准：vitest run 该文件通过）。
6. **Node 全局 fetch/FormData/Blob**（本机 Node 24.1.0 probe：`fetch: function`、FormData append 后 `get('media') instanceof Blob === true` 且带 filename/size；Electron 45 主进程 Node 22.22 同样内置，Node≥18 即有）。⇒ 公众号客户端 multipart 上传零新依赖。
7. **公众号 API 形状（官方文档确认，2026-10）**：`POST /cgi-bin/stable_token`（body `{grant_type:'client_credential', appid, secret}`，推荐替代旧 token 接口）→ `{access_token, expires_in}`；`POST /cgi-bin/material/add_material?access_token=..&type=IMAGE`（multipart `media`）→ `{media_id, url}`；`POST /cgi-bin/media/uploadimg`（multipart）→ `{url}`（正文内图片必须用此 URL）；`POST /cgi-bin/draft/add`（body `{articles:[...]}`）→ `{media_id}`。**draft/add 字段限制：title 必填 ≤32 字、author ≤16、digest ≤120（留空平台取正文前 54 字）、content 必填 <2 万字符且 <1M 且去 JS、thumb_media_id 必填（封面永久素材 media_id）**。错误形如 `{errcode, errmsg}`，token 类错误码 40001/40014/41001/42001；**调用出口 IP 必须在公众号后台 IP 白名单**（spec D2，人工验收清单明示）。
8. **X 加权计数按 spec §5 定义实现**：链接按 t.co 缩短长度计 23、中文（CJK/全角区间）每字计 2、其余计 1，加权 ≤280——本计划以此为本地规则（不做适配器，M4）。
9. 即刻发布必须经过话题/圈子选择 UI（wesight `jike-post.ts:194-200` 现象佐证）⇒ M3 即刻规则=「至少一个话题，存 frontmatter `topics`」；正文不设本地硬上限（无公开文档依据，不发明数字）。

## Global Constraints

- 既有 M1/M2 能力**只复用不重构**：变体落盘复用 content-library 的原子写模式与 `mustFind`；`save_variant` 只写草稿区（M2 铁律延伸）；所有既有测试保持绿。
- **风控边界（spec §6，全部机械化）**：只注入草稿（脚本只填标题/正文/话题）；**绝不点发布按钮**（注入脚本不含任何点击「发布」类按钮的代码路径；fixture 页发布按钮点击会上报 fixture 服务器，e2e 断言上报数为 0）；**不调平台内部接口**（DOM 注入只派发 UI 事件，脚本内无 fetch/XHR 到平台域名）；平台间**串行限速**（PublishService 全局互斥链 + 相邻注入最小间隔，默认 15s，env 可调）；**注入前防覆盖**（编辑器已有内容且与本次负载不一致 ⇒ 拒绝注入并明确报错，绝不静默；一致视为幂等重试允许重填）。
- **失败三分类 + 显式扩展**（spec §6）：`not_logged_in`（引导去登录页）/ `page_changed`（明确报「适配器需更新」，绝不静默失败）/ `network`（可重试）；外加两个必须显式呈现的非静默结果：`already_has_content`（防覆盖拒绝）、`api_error`（公众号 errcode 非 token 类）。UI 逐类有中文文案与对应动作。
- **人机边界不变**：AI 只有 `save_variant`（写草稿区）与 `create_publish_task`（只建任务不注入）；`platforms/*.md` 的写入路径只有「人在变体工作台确认/编辑保存」；注入只能由人在发布中心点击发起。变体草稿（带 `platform` 元数据）**不出现在编辑器 AI 助手的草稿区列表**——其唯一采纳路径是变体工作台（Task 7 在 AgentPanel 过滤）。
- **凭证最小信任**（spec §3/§6，沿用 M2 评审模式）：公众号 AppSecret 出主进程的只有脱敏视图（`hasSecret`/尾四位）；保存时未改密钥用占位 `KEEP_WECHAT_SECRET` 沿用旧值；存 userData（safeStorage 加密优先，不可用则 `plain:` 前缀明文并在视图标记），绝不进内容库/git。
- **平台会话安全**：WebContentsView 只加载平台白名单域名（默认 `creator.xiaohongshu.com`；env/设置显式覆盖的编辑器地址 hostname 追加进白名单——覆盖是用户的显式动作）；`contextIsolation: true, nodeIntegration: false, sandbox: true`；UA 常规化（剥离 Electron 与应用名 token）。
- 单测不联网：公众号客户端注入 fetch 替身；注入脚本 jsdom fixture 回放；发布编排用 FakeAdapter/FakeRuntime。e2e 全本地（fixture 编辑器服务器 + mock 微信 API + mock OpenAI 复用 M2）。**真实平台行为=人工验收清单**（Task 8 文档化，不伪造自动化通过，spec §9）。
- UI 文案全部中文；可达名（aria-label）以 Task 7 测试为准（e2e 依赖）。
- 每个任务收尾跑 `npm run typecheck && npm test`，绿了才 commit；不推送远端。
- **M3 明确不做**（防 scope 漂移）：知乎/公众号图文/X/即刻适配器（M4，spec §6 分批 P2/P3）；**变体图片的自动上传注入**（M3 小红书为文本注入——标题/正文/话题；`platforms/*.md` 的 `images/cover` 配图引用先落文件，图片在平台编辑器由人工添加或 M4 注入；公众号封面图例外——官方 API 链必须传封面，属 API 上传非 DOM 注入）；publishes/SQLite 持久化（M4 运营域，M3 任务态在内存、重启清空，发布中心有提示文案）；微信草稿更新 `draft/update`（仅 `add`，重试产生新草稿，UI 提示）；运营台（M4）；自动发布（永不做，spec §2）。

## File Structure（新建/修改）

```
src/shared/types.ts                          # +PlatformKey/VariantDoc/VariantValidation/PublishTask/PublishEventOut/
                                             #  WechatMpConfigView/KEEP_WECHAT_SECRET；Settings.+wechatMp/platforms；DraftSummary.+platform
src/shared/platform-rules.ts                 # 四平台规则与本地校验（纯逻辑，主/渲染共用）（Task 1）
src/main/variants.ts                         # platforms/*.md 读写 + 变体草稿解析采纳（Task 1）
src/main/content-library.ts                  # mustFind 改为 export（Task 1，加法）
src/main/drafts.ts                           # 草稿增 platform 元数据（Task 2）
src/main/agent/domain-tools.ts               # +save_variant（Task 2）；+create_publish_task（Task 5）
src/main/agent/agent-service.ts              # save_variant 的 tool_end 也触发 drafts_changed（Task 2）
src/main/agent/real-session.ts               # deps.+createPublishTask 透传（Task 5）
skills/variant-convert/SKILL.md              # 一稿多态转化技能（Task 2）
src/main/publish/wechat-mp.ts                # 公众号 API 客户端（stable_token/素材/草稿）（Task 3）
src/main/publish/wechat-credentials.ts       # AppID/AppSecret 存取与脱敏视图（safeStorage 注入式）（Task 3）
src/main/publish/markdown-to-wechat-html.ts  # 极小 md→公众号 HTML + 正文图上传替换 + safeJoin（Task 3）
src/main/publish/inject-script-xiaohongshu.ts# 自包含页面注入脚本（loginCheck/inject/readBack）（Task 4）
src/main/publish/platform-session.ts         # WebContentsView 会话（partition/UA/白名单/evaluate）（Task 4）
src/main/publish/adapter.ts                  # PlatformAdapter 接口+小红书/公众号文章适配器+分类映射（Task 4）
tests/fixtures/xiaohongshu-editor.html       # fixture 编辑器页（登录态/编辑器态/状态上报/发布按钮上报）（Task 4）
src/main/publish/publish-service.ts          # 发布编排（队列/串行限速/三分类/事件）（Task 5）
src/main/ipc.ts                              # +variant/publish/wechat 通道与装配（Task 6）
src/main/index.ts                            # will-quit 时 dispose 发布会话（Task 6）
src/preload/index.ts                         # +window.studio.variant / window.studio.publish（Task 6）
src/renderer/lib/publish-bridge.ts           # 渲染桥（惰性，同 agent-bridge 模式）（Task 6）
src/renderer/pages/VariantsPage.tsx          # 变体工作台（Task 7）
src/renderer/pages/PublishCenter.tsx         # 发布中心（Task 7）
src/renderer/components/WechatSettingsModal.tsx# 公众号配置弹窗（Task 7）
src/renderer/components/AgentPanel.tsx       # SKILLS +「一稿多态转化」+ 草稿区过滤变体草稿（Task 7）
src/renderer/App.tsx / pages/Board.tsx / pages/Editor.tsx  # 视图路由与导航（Task 7）
src/renderer/styles.css                      # +两页样式（Task 7）
tests/unit/platform-rules.test.ts            # Task 1
tests/unit/variants.test.ts                  # Task 1
tests/unit/drafts.test.ts                    # Task 2 追加用例
tests/unit/domain-tools.test.ts              # Task 2/5 追加用例
tests/unit/skills.test.ts                    # Task 2 更新断言
tests/unit/agent-service.test.ts             # Task 2 追加用例
tests/unit/wechat-mp.test.ts / wechat-credentials.test.ts / markdown-to-wechat-html.test.ts   # Task 3
tests/unit/inject-script-xiaohongshu.test.ts # Task 4（jsdom fixture 回放）
tests/unit/adapter.test.ts                   # Task 4
tests/unit/publish-service.test.ts           # Task 5
tests/renderer/VariantsPage.test.tsx / PublishCenter.test.tsx                                # Task 7
tests/helpers/fixture-server.ts              # Task 8
tests/e2e/variants.spec.ts / publish.spec.ts # Task 8
docs/manual-acceptance-m3.md                 # 真实平台人工验收清单（Task 8）
README.md                                    # +M3 运行说明（Task 8）
```

---

### Task 1: 平台规则与变体文件域（platform-rules + variants.ts）

**Files:**
- Create: `src/shared/platform-rules.ts`、`src/main/variants.ts`
- Modify: `src/shared/types.ts`（+PlatformKey/VariantDoc/VariantValidation）、`src/main/content-library.ts`（mustFind 导出）
- Test: `tests/unit/platform-rules.test.ts`、`tests/unit/variants.test.ts`

**Interfaces:**
- Produces（后续所有任务依赖）:
  - `PlatformKey = 'xiaohongshu' | 'x' | 'jike' | 'wechat-article'`
  - `VariantDoc = { platform; title; topics: string[]; body; digest?; cover?; updatedAt? }`；`VariantValidation = { ok; errors: string[]; warnings: string[] }`
  - `PLATFORM_RULES: Record<PlatformKey, PlatformRules>`（`PlatformRules = { key; label; mode:'dom'|'api'; editorUrl?; notes: string[]; validate(doc) }`）、`platformKeys()`、`validateVariant(platform, doc)`、`xWeightedLength(text)`
  - `variants.ts`：`readVariant(root, contentId, platform): Promise<VariantDoc | null>`、`saveVariant(root, contentId, platform, input): Promise<{ savedAt }>`（原子写）、`listVariants(root, contentId): Promise<PlatformKey[]>`、`parseVariantDraftMarkdown(md): { title; topics; body }`、`applyVariantDraft(root, contentId, platform, draftName)`（草稿→变体文件，人确认动作）、`assertPlatform(platform)`（未知平台抛 `code:'VARIANT_BAD_PLATFORM'`）
- Consumes: `mustFind`（本任务从 content-library 导出）、既有原子写模式。

- [ ] **Step 1: 失败测试 `tests/unit/platform-rules.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { validateVariant, xWeightedLength, PLATFORM_RULES } from '../../src/shared/platform-rules';
import type { PlatformKey, VariantDoc } from '../../src/shared/types';

const doc = (platform: PlatformKey, over: Partial<VariantDoc> = {}): VariantDoc => ({
  platform, title: '标题', topics: [], body: '正文', ...over,
});

describe('平台规则（spec §5 硬规则）', () => {
  it('X 加权计数：中文计 2、链接计 23、其余计 1', () => {
    expect(xWeightedLength('abc')).toBe(3);
    expect(xWeightedLength('中文')).toBe(4);
    expect(xWeightedLength('看 https://example.com/a 这篇')).toBe(31); // 看(2)+空格(1)+链接(23)+空格(1)+这(2)+篇(2)
    expect(xWeightedLength('ｆｕｌｌｗｉｄｔｈ')).toBe(16); // 全角 ASCII 计 2
  });
  it('X 校验：无标题、加权 ≤280 才通过', () => {
    expect(validateVariant('x', doc('x', { title: '', body: 'hello' })).ok).toBe(true);
    expect(validateVariant('x', doc('x', { title: '有标题', body: 'hi' })).errors).toContain('X 动态没有标题，请把内容放进正文');
    const over = validateVariant('x', doc('x', { title: '', body: '字'.repeat(141) })); // 282
    expect(over.ok).toBe(false);
    expect(over.errors[0]).toContain('280');
  });
  it('小红书：标题 ≤20 硬上限；正文 600–900 建议区间、1000 硬上限', () => {
    expect(validateVariant('xiaohongshu', doc('xiaohongshu', { title: '一二三四五六七八九十', body: '字'.repeat(700) })).ok).toBe(true);
    const titleOver = validateVariant('xiaohongshu', doc('xiaohongshu', { title: '一二三四五六七八九十一', body: '字'.repeat(700) }));
    expect(titleOver.ok).toBe(false);
    const warnLow = validateVariant('xiaohongshu', doc('xiaohongshu', { body: '字'.repeat(500) }));
    expect(warnLow.ok).toBe(true);
    expect(warnLow.warnings.join()).toContain('600');
    const hardOver = validateVariant('xiaohongshu', doc('xiaohongshu', { body: '字'.repeat(1001) }));
    expect(hardOver.ok).toBe(false);
    expect(hardOver.errors.join()).toContain('1000');
  });
  it('即刻：需至少一个话题', () => {
    expect(validateVariant('jike', doc('jike', { title: '', topics: [] })).errors).toContain('即刻动态需至少一个话题');
    expect(validateVariant('jike', doc('jike', { title: '', topics: ['产品沉思'] })).ok).toBe(true);
  });
  it('公众号文章：标题必填 ≤32、摘要 ≤120、封面必填、正文 <2 万字符', () => {
    const ok = validateVariant('wechat-article', doc('wechat-article', { title: '标题', cover: 'assets/cover.png', body: '正文' }));
    expect(ok.ok).toBe(true);
    expect(validateVariant('wechat-article', doc('wechat-article', { title: '', cover: 'a.png', body: 'x' })).errors.join()).toContain('标题');
    expect(validateVariant('wechat-article', doc('wechat-article', { title: '标', digest: '摘'.repeat(121), cover: 'a.png', body: 'x' })).errors.join()).toContain('120');
    expect(validateVariant('wechat-article', doc('wechat-article', { title: '标', body: 'x' })).errors.join()).toContain('封面');
    expect(validateVariant('wechat-article', doc('wechat-article', { title: '标', cover: 'a.png', body: 'x'.repeat(20000) })).errors.join()).toContain('2 万');
  });
  it('四平台规则齐备且 notes 非空（技能与 UI 共用文案）', () => {
    for (const key of ['xiaohongshu', 'x', 'jike', 'wechat-article'] as PlatformKey[]) {
      expect(PLATFORM_RULES[key].label).toBeTruthy();
      expect(PLATFORM_RULES[key].notes.length).toBeGreaterThan(0);
    }
  });
});
```

`tests/unit/variants.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  readVariant, saveVariant, listVariants, parseVariantDraftMarkdown, applyVariantDraft, assertPlatform,
} from '../../src/main/variants';
import { saveDraft, draftsDir } from '../../src/main/drafts';
import { createContent } from '../../src/main/content-library';
import { makeLibrary } from '../helpers/libFixture';

describe('变体文件域', () => {
  let root = ''; let id = ''; let folder = '';
  beforeEach(async () => {
    root = makeLibrary();
    const meta = await createContent(root, { title: '变体测试' });
    id = meta.id; folder = meta.folder;
  });

  it('saveVariant 原子落 platforms/<platform>.md（frontmatter+正文原样），readVariant/listVariants 往返', async () => {
    await saveVariant(root, id, 'xiaohongshu', { title: '小红书标题', topics: ['话题A'], body: '正文一\n\n正文二' });
    const file = path.join(root, folder, 'platforms', 'xiaohongshu.md');
    expect(existsSync(file)).toBe(true);
    const raw = readFileSync(file, 'utf8');
    expect(raw).toContain('platform: xiaohongshu');
    expect(raw).toContain('title: 小红书标题');
    expect(raw.endsWith('正文一\n\n正文二')).toBe(true); // 正文逐字节保留（不经条件补换行）
    const doc = await readVariant(root, id, 'xiaohongshu');
    expect(doc).toMatchObject({ platform: 'xiaohongshu', title: '小红书标题', topics: ['话题A'], body: '正文一\n\n正文二' });
    expect(await readVariant(root, id, 'x')).toBeNull(); // 未保存的平台 null
    expect(await listVariants(root, id)).toEqual(['xiaohongshu']);
  });
  it('parseVariantDraftMarkdown：# 标题行 + 可选话题行 + 正文（技能产出格式）', () => {
    expect(parseVariantDraftMarkdown('# 我的标题\n话题: 话题A、话题B\n\n正文段落')).toEqual({ title: '我的标题', topics: ['话题A', '话题B'], body: '正文段落' });
    expect(parseVariantDraftMarkdown('没有标题行直接正文')).toEqual({ title: '', topics: [], body: '没有标题行直接正文' });
    expect(parseVariantDraftMarkdown('# 标\n话题: 逗号,分隔\n\n正文')).toEqual({ title: '标', topics: ['逗号', '分隔'], body: '正文' });
  });
  it('applyVariantDraft：草稿→解析→变体文件，草稿被消费', async () => {
    const d = await saveDraft(root, id, { markdown: '# 转化标题\n话题: 话题A\n\n转化正文', note: '变体:xiaohongshu', platform: 'xiaohongshu' });
    const r = await applyVariantDraft(root, id, 'xiaohongshu', d.name);
    expect(r.savedAt).toBeTruthy();
    const doc = await readVariant(root, id, 'xiaohongshu');
    expect(doc).toMatchObject({ title: '转化标题', topics: ['话题A'], body: '转化正文' });
    expect(existsSync(path.join(draftsDir(root, id), d.name))).toBe(false);
  });
  it('assertPlatform 拒绝未知平台（VARIANT_BAD_PLATFORM，防 IPC 任意路径）', () => {
    expect(() => assertPlatform('xiaohongshu')).not.toThrow();
    expect(() => assertPlatform('../evil')).toThrowError(expect.objectContaining({ code: 'VARIANT_BAD_PLATFORM' }));
    expect(() => assertPlatform('zhihu')).toThrowError(expect.objectContaining({ code: 'VARIANT_BAD_PLATFORM' })); // M4 平台
  });
  it('内容不存在时抛 CONTENT_NOT_FOUND', async () => {
    await expect(readVariant(root, 'c_20990101_zzzz', 'x')).rejects.toMatchObject({ code: 'CONTENT_NOT_FOUND' });
  });
});
```

- [ ] **Step 2: 确认失败**（模块不存在）

- [ ] **Step 3: 实现**

`src/shared/types.ts` 追加：
```ts
export type PlatformKey = 'xiaohongshu' | 'x' | 'jike' | 'wechat-article';
export type VariantDoc = {
  platform: PlatformKey;
  title: string;        // X 动态恒为空
  topics: string[];     // 即刻必填；小红书可选；其余平台忽略
  body: string;
  digest?: string;      // 仅 wechat-article（公众号摘要，≤120 字）
  cover?: string;       // 仅 wechat-article（内容库内相对路径，如 assets/cover.png）
  updatedAt?: string;
};
export type VariantValidation = { ok: boolean; errors: string[]; warnings: string[] };
```
`Settings` 追加两字段（向后兼容）：
```ts
export type Settings = {
  libraryRoot: string | null; model?: ModelConfig | null;
  wechatMp?: { appid: string; secretStore: string } | null;
  platforms?: { xiaohongshuEditorUrl?: string } | null;
};
```
`DraftSummary` 增 `platform?: string`（Task 2 使用，此处一并定义）。

`src/shared/platform-rules.ts`：
```ts
import type { PlatformKey, VariantDoc, VariantValidation } from './types';

export type PlatformRules = {
  key: PlatformKey;
  label: string;
  mode: 'dom' | 'api'; // dom=内嵌浏览器注入；api=官方 API（公众号文章）
  editorUrl?: string;  // dom 平台默认真实编辑器 URL（可被设置/env 覆盖）
  notes: string[];     // 写作硬规则文案（技能 SKILL.md 与 UI 共用口径）
  validate(doc: VariantDoc): VariantValidation;
};

export function platformKeys(): PlatformKey[] { return ['xiaohongshu', 'x', 'jike', 'wechat-article']; }
export function isPlatformKey(v: string): v is PlatformKey { return (platformKeys() as string[]).includes(v); }

const chars = (s: string): number => Array.from(s.replace(/\s+/g, '')).length;

/** X 加权计数（spec §5）：链接按 t.co 缩短长度计 23，中文/全角每字计 2，其余计 1。 */
export function xWeightedLength(text: string): number {
  let weight = 0;
  const rest = text.replace(/https?:\/\/\S+/g, () => { weight += 23; return ''; });
  for (const ch of rest) weight += /[\u2E80-\u9FFF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  return weight;
}

function make(key: PlatformKey, label: string, mode: 'dom' | 'api', notes: string[], validate: PlatformRules['validate'], editorUrl?: string): PlatformRules {
  return { key, label, mode, notes, validate, ...(editorUrl ? { editorUrl } : {}) };
}

const xiaohongshu = make('xiaohongshu', '小红书', 'dom', [
  '正文 600–900 字（硬上限 1000 字）', '标题不超过 20 字', '话题可选，多个用顿号分隔，注入时以 #话题 追加到正文末尾',
], (doc) => {
  const errors: string[] = []; const warnings: string[] = [];
  const title = Array.from(doc.title.trim());
  if (title.length === 0) errors.push('标题不能为空');
  if (title.length > 20) errors.push(`标题 ${title.length} 字，超过小红书 20 字上限`);
  const n = chars(doc.body);
  if (n > 1000) errors.push(`正文 ${n} 字，超过小红书 1000 字硬上限`);
  else if (n > 900) warnings.push(`正文 ${n} 字，超过 900 字建议区间`);
  else if (n < 600) warnings.push(`正文 ${n} 字，低于 600 字建议区间`);
  if (doc.topics.some((t) => !t.trim())) errors.push('话题不能为空白');
  return { ok: errors.length === 0, errors, warnings };
}, 'https://creator.xiaohongshu.com/publish/publish');

const x = make('x', 'X（Twitter）', 'dom', [
  '动态无标题', '加权计数 ≤280：中文每字计 2、链接按缩短长度计 23',
], (doc) => {
  const errors: string[] = [];
  if (doc.title.trim()) errors.push('X 动态没有标题，请把内容放进正文');
  const w = xWeightedLength(doc.body);
  if (w > 280) errors.push(`X 加权计数 ${w}，超过 280`);
  return { ok: errors.length === 0, errors, warnings: [] };
});

const jike = make('jike', '即刻', 'dom', [
  '动态需至少一个话题（发布时在平台选择话题/圈子）', '正文短评式，无本地字数硬上限',
], (doc) => {
  const errors: string[] = [];
  if (doc.topics.map((t) => t.trim()).filter(Boolean).length === 0) errors.push('即刻动态需至少一个话题');
  return { ok: errors.length === 0, errors, warnings: [] };
});

const wechatArticle = make('wechat-article', '公众号文章', 'api', [
  '标题必填，不超过 32 字', '摘要可选，不超过 120 字（留空平台取正文前 54 字）',
  '封面必填（内容库内图片相对路径，如 assets/cover.png）', '正文少于 2 万字符；图片用 Markdown 引用内容库内路径',
], (doc) => {
  const errors: string[] = [];
  const title = Array.from(doc.title.trim());
  if (title.length === 0) errors.push('标题不能为空');
  if (title.length > 32) errors.push(`标题 ${title.length} 字，超过公众号 32 字上限`);
  if (Array.from((doc.digest ?? '').trim()).length > 120) errors.push('摘要超过 120 字上限');
  if (!doc.cover?.trim()) errors.push('需要封面图（公众号草稿必填 thumb 封面素材）');
  if (chars(doc.body) === 0) errors.push('正文不能为空');
  if (doc.body.length >= 20000) errors.push(`正文 ${doc.body.length} 字符，达到公众号 2 万字符上限`);
  return { ok: errors.length === 0, errors, warnings: [] };
});

export const PLATFORM_RULES: Record<PlatformKey, PlatformRules> = {
  xiaohongshu, x, jike, 'wechat-article': wechatArticle,
};

export function validateVariant(platform: PlatformKey, doc: VariantDoc): VariantValidation {
  return PLATFORM_RULES[platform].validate({ ...doc, platform });
}
```

`src/main/content-library.ts` 仅把 `async function mustFind` 改为 `export async function mustFind`。

`src/main/variants.ts`：
```ts
import { readFile, writeFile, rename, unlink, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import matter from 'gray-matter';
import type { PlatformKey, VariantDoc } from '../shared/types';
import { isPlatformKey } from '../shared/platform-rules';
import { mustFind } from './content-library';
import { readDraft, draftsDir } from './drafts';

export function assertPlatform(platform: string): asserts platform is PlatformKey {
  if (!isPlatformKey(platform)) {
    const err = new Error(`未知平台: ${platform}`) as Error & { code: string };
    err.code = 'VARIANT_BAD_PLATFORM'; throw err;
  }
}

async function atomicWrite(file: string, contents: string): Promise<void> {
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try { await writeFile(tmp, contents, 'utf8'); await rename(tmp, file); }
  catch (err) { await unlink(tmp).catch(() => {}); throw err; }
}

export async function readVariant(root: string, contentId: string, platform: PlatformKey): Promise<VariantDoc | null> {
  assertPlatform(platform);
  const meta = await mustFind(root, contentId);
  const file = path.join(root, meta.folder, 'platforms', `${platform}.md`);
  let raw: string;
  try { raw = await readFile(file, 'utf8'); } catch { return null; }
  const { data, content } = matter(raw);
  return {
    platform,
    title: String(data.title ?? ''),
    topics: Array.isArray(data.topics) ? data.topics.map(String) : [],
    body: content.replace(/^\n+/, ''),
    ...(data.digest ? { digest: String(data.digest) } : {}),
    ...(data.cover ? { cover: String(data.cover) } : {}),
    ...(data.updated ? { updatedAt: String(data.updated) } : {}),
  };
}

export async function saveVariant(
  root: string, contentId: string, platform: PlatformKey,
  input: { title: string; topics: string[]; body: string; digest?: string; cover?: string },
): Promise<{ savedAt: string }> {
  assertPlatform(platform);
  const meta = await mustFind(root, contentId);
  const dir = path.join(root, meta.folder, 'platforms');
  await mkdir(dir, { recursive: true });
  const updated = new Date().toISOString();
  const data: Record<string, unknown> = { platform, title: input.title, topics: input.topics, updated };
  if (input.digest) data.digest = input.digest;
  if (input.cover) data.cover = input.cover;
  // 与 content-library 同策略：gray-matter 序列化 YAML 块后不做条件补换行，正文逐字节保留
  const front = matter.stringify('', data).slice(0, -1);
  const file = path.join(dir, `${platform}.md`);
  await atomicWrite(file, front + input.body);
  return { savedAt: updated };
}

export async function listVariants(root: string, contentId: string): Promise<PlatformKey[]> {
  const meta = await mustFind(root, contentId);
  const dir = path.join(root, meta.folder, 'platforms');
  try {
    const entries = await (await import('node:fs/promises')).readdir(dir);
    return entries.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).filter(isPlatformKey);
  } catch { return []; }
}

/** 技能产出的变体草稿格式：首行 `# 标题`，可选 `话题: A、B`（顿号/逗号分隔），空行后正文。 */
export function parseVariantDraftMarkdown(md: string): { title: string; topics: string[]; body: string } {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let title = '';
  let topics: string[] = [];
  let i = 0;
  if (lines[0]?.startsWith('# ')) { title = lines[0].slice(2).trim(); i = 1; }
  if (lines[i]?.startsWith('话题:')) {
    topics = lines[i].slice(3).split(/[、,，]/).map((t) => t.trim()).filter(Boolean);
    i += 1;
  }
  return { title, topics, body: lines.slice(i).join('\n').replace(/^\n+/, '') };
}

/** 人确认动作：变体草稿 → 解析 → platforms/<platform>.md（原子写）→ 消费草稿。 */
export async function applyVariantDraft(
  root: string, contentId: string, platform: PlatformKey, draftName: string,
): Promise<{ savedAt: string }> {
  assertPlatform(platform);
  const md = await readDraft(root, contentId, draftName);
  const { title, topics, body } = parseVariantDraftMarkdown(md);
  const r = await saveVariant(root, contentId, platform, { title, topics, body });
  await unlink(path.join(draftsDir(root, contentId), draftName)).catch(() => {});
  return r;
}
```
（`listVariants` 的动态 import 换成顶部静态 `readdir` 导入也可——以 typecheck 通过为准，两者等价。）

- [ ] **Step 4: 通过 + typecheck**

```bash
npx vitest run tests/unit/platform-rules.test.ts tests/unit/variants.test.ts   # 6 + 5 passed
npm run typecheck && npm test    # 既有全绿（Settings 加字段向后兼容）
```

- [ ] **Step 5: Commit** `git commit -m "feat(m3): 四平台硬规则与本地校验、platforms 变体文件域（读写/草稿解析/确认采纳）"`

---

### Task 2: save_variant 领域工具 + variant-convert 技能 + 草稿 platform 元数据

**Files:**
- Create: `skills/variant-convert/SKILL.md`
- Modify: `src/main/drafts.ts`（+platform）、`src/main/agent/domain-tools.ts`（+save_variant）、`src/main/agent/agent-service.ts`（save_variant 触发 drafts_changed）
- Test: `tests/unit/drafts.test.ts`、`tests/unit/domain-tools.test.ts`、`tests/unit/skills.test.ts`、`tests/unit/agent-service.test.ts`（均追加/更新）

**Interfaces:**
- Consumes: Task 1 的 `parseVariantDraftMarkdown/validateVariant/assertPlatform`、既有 `saveDraft`。
- Produces:
  - `saveDraft(root, contentId, { markdown, note?, platform? })`：platform 写入草稿 frontmatter；`DraftSummary.platform?`。
  - 领域工具 `save_variant(id, platform, markdown)`：写**草稿区**（note=`变体:<platform>`），返回文本附本地规则校验结果（错误/提示给模型）；平台白名单外 `isError`。
  - 技能 `variant-convert`（ASCII 名，pi 技能名规则）；AgentPanel 技能入口在 Task 7 接。
  - `agent-service`：`tool_end(save_variant)` → `drafts_changed` 事件（变体工作台刷新信号）。

- [ ] **Step 1: 失败测试（先追加用例再跑）**

`tests/unit/drafts.test.ts` 追加用例：
```ts
  it('platform 元数据随草稿落盘并可往返', async () => {
    const d = await saveDraft(root, id, { markdown: '# x', note: '变体:xiaohongshu', platform: 'xiaohongshu' });
    const list = await listDrafts(root, id);
    expect(list[0]).toMatchObject({ name: d.name, platform: 'xiaohongshu' });
    const plain = await saveDraft(root, id, { markdown: '# y' });
    expect((await listDrafts(root, id)).find((x) => x.name === plain.name)!.platform).toBeUndefined();
  });
```

`tests/unit/domain-tools.test.ts` 追加用例（复用文件既有 `tools/exec` 辅助；`ts[4]` 即第 5 个工具）：
```ts
  it('save_variant 只落草稿区（note=变体:平台）并把本地规则结果带回给模型', async () => {
    const root = makeLibrary();
    addContent(root, '2026-10-24-a', `id: ${ID}\ntitle: 甲\nstage: draft\ncreated: "2026-10-24"`);
    const ts = await tools(root);
    const r = await exec(ts[4]!, { id: ID, platform: 'xiaohongshu', markdown: '# 这条标题实在太长了明显超过二十个字的硬上限\n\n正文' }); // 标题 21 字 > 20 → 必走「标题 N 字，超过小红书 20 字上限」错误分支
    expect(r.content[0]?.text).toContain('变体草稿已保存');
    expect(r.content[0]?.text).toContain('人工');
    expect(r.content[0]?.text).toContain('20 字'); // 规则未过→模型可见
    const files = readdirSync(draftsDir(root, ID));
    expect(files.some((f) => f.startsWith('draft-'))).toBe(true);
    const bad = await exec(ts[4]!, { id: ID, platform: 'zhihu', markdown: 'x' });
    expect(bad.isError).toBe(true); // 平台白名单外
  }, 30_000);
```

`tests/unit/skills.test.ts` 断言更新（技能多了一个）：
```ts
    expect(r.skills.map((s) => s.name).sort()).toEqual(['longform-draft', 'review-revise', 'variant-convert']);
```

`tests/unit/agent-service.test.ts` 追加用例：
```ts
  it('save_variant 的 tool_end 也触发 drafts_changed', async () => {
    const h = harness((s) => {
      s.promptImpl = async (_t, self) => {
        self.emit({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'save_variant', result: { content: [{ type: 'text', text: '变体草稿已保存：draft-x.md' }] }, isError: false });
      };
    });
    await h.svc.send('c1', '转');
    await waitFor(() => h.events.some((e) => e.kind === 'drafts_changed'));
  });
```

- [ ] **Step 2: 确认失败 → 实现**

`src/main/drafts.ts` 改动（两处小加法）：
```ts
// saveDraft 签名与 frontmatter：
export async function saveDraft(
  root: string, contentId: string,
  input: { markdown: string; note?: string; platform?: string },
): Promise<DraftSummary> {
  // …原逻辑不变，frontmatter 行改为：
  const front = matter.stringify('', { created, note: input.note ?? '', ...(input.platform ? { platform: input.platform } : {}) }).slice(0, -1);
  // 返回值改为：
  return { name, created, note: input.note ?? '', bytes: ..., ...(input.platform ? { platform: input.platform } : {}) };
}
// listDrafts 的 out.push 增：
      const platform = String(data.platform ?? '');
      out.push({ ..., ...(platform ? { platform } : {}) });
```

`src/main/agent/domain-tools.ts`：`TOOL_NAMES` 改为 `['list_contents', 'read_content', 'write_draft', 'ask_user', 'save_variant'] as const`，顶部 import 增 `parseVariantDraftMarkdown, assertPlatform`（`../variants`）与 `validateVariant`（`../../shared/platform-rules`），在 `askUserTool` 定义后追加：
```ts
  const saveVariantTool = pi.defineTool({
    name: 'save_variant',
    label: '保存平台变体草稿',
    description: '把一稿多态转化产物保存为该内容的平台变体草稿（等待人工在变体工作台确认后才进 platforms/<平台>.md）。markdown 格式：首行 `# 标题`（x 平台省略），可选一行 `话题: A、B`，空行后为正文。',
    parameters: T.Type.Object({
      id: T.Type.String(),
      platform: T.Type.String({ description: 'xiaohongshu | x | jike | wechat-article' }),
      markdown: T.Type.String(),
    }),
    annotations: { destructiveHint: false },
    async execute(_id, params) {
      try {
        try { assertPlatform(params.platform); } catch { return textErr(`save_variant 失败：未知平台 ${params.platform}（支持 xiaohongshu/x/jike/wechat-article）`); }
        await readContent(deps.root, params.id); // 校验内容存在
        const platform = params.platform as 'xiaohongshu' | 'x' | 'jike' | 'wechat-article';
        const parsed = parseVariantDraftMarkdown(params.markdown);
        const v = validateVariant(platform, { platform, title: parsed.title, topics: parsed.topics, body: parsed.body });
        const d = await saveDraft(deps.root, params.id, { markdown: params.markdown, note: `变体:${platform}`, platform });
        const lines = [`变体草稿已保存：${d.name}（${platform}，等待人工在变体工作台确认采纳）`];
        if (!v.ok) lines.push(`本地规则未通过（确认前需修正）：${v.errors.join('；')}`);
        if (v.warnings.length) lines.push(`提示：${v.warnings.join('；')}`);
        return text(lines.join('\n'));
      } catch (err) { return textErr(`save_variant 失败：${String(err)}`); }
    },
  });
```
返回数组末尾加 `saveVariantTool`。

`src/main/agent/agent-service.ts` 一行改动：
```ts
        if (tool === 'write_draft' || tool === 'save_variant') this.deps.emit({ kind: 'drafts_changed', contentId });
```

`skills/variant-convert/SKILL.md`（逐字写入）：
```markdown
---
name: variant-convert
description: 一稿多态转化——把当前长文转为指定平台的变体（小红书/X/即刻/公众号文章），保存为变体草稿等待人工确认
---

# 一稿多态转化

你正在把当前内容转化为一稿多态的平台变体。目标平台（xiaohongshu / x / jike / wechat-article）由用户指令给出。

各平台硬规则（必须逐条满足）：
- 小红书：标题 ≤ 20 字；正文 600–900 字（硬上限 1000 字）；口语化、可断行、可用 emoji；话题可选（写入「话题:」行）。
- X：无标题；动态加权计数 ≤ 280（中文每字计 2，链接计 23）；一条只讲一个点。
- 即刻：需至少一个话题（写入「话题:」行，多个用顿号分隔）；正文短评式。
- wechat-article：标题 ≤ 32 字；摘要 ≤ 120 字（可留空）；正文保持长文结构（< 2 万字符）；封面由用户在变体工作台填写，你无需提供。

流程：
1. 用 read_content 读当前内容全文，吃透立意与结构。
2. 按平台体裁**重写**（不是摘抄：重排结构、改语气、按平台习惯重构），拿不准取舍先用 ask_user 问。
3. 产出格式（save_variant 的 markdown 参数，严格遵守）：首行 `# 标题`（x 平台省略此行）；可选一行 `话题: 话题A、话题B`；空一行；正文。
4. 调用 save_variant（id=当前内容 id，platform=目标平台）保存为变体草稿。
5. 铁律：你只保存变体草稿；人工在「变体工作台」确认后才写入 platforms/<平台>.md；你没有任何发布或注入工具，也不存在「已发布」。

转化指示（若为空则按内容自行判断平台侧重）：$ARGUMENTS
```

- [ ] **Step 3: 通过 + typecheck**

```bash
npx vitest run tests/unit/drafts.test.ts tests/unit/domain-tools.test.ts tests/unit/skills.test.ts tests/unit/agent-service.test.ts
npm run typecheck && npm test    # 全绿（domain-tools 既有用例的 exec 索引不变：新工具排在第 5 位）
```

- [ ] **Step 4: Commit** `git commit -m "feat(m3): save_variant 领域工具（草稿区+规则反馈）、variant-convert 技能与草稿平台元数据"`

---

### Task 3: 公众号文章 API 客户端 + 凭证存储 + markdown→HTML

**Files:**
- Create: `src/main/publish/wechat-mp.ts`、`src/main/publish/wechat-credentials.ts`、`src/main/publish/markdown-to-wechat-html.ts`
- Test: `tests/unit/wechat-mp.test.ts`、`tests/unit/wechat-credentials.test.ts`、`tests/unit/markdown-to-wechat-html.test.ts`

**Interfaces:**
- Produces:
  - `WechatMpClient`：构造 `(cfg: { getAppid(): string; getSecret(): string }, opts?: { baseUrl?; fetchImpl?; now? })`；`getAccessToken(force?)`（stable_token，缓存到期前 5 分钟刷新）、`uploadImageMaterial(bytes, filename, mimeType?) → {mediaId, url}`、`uploadContentImage(bytes, filename, mimeType?) → url`、`createDraft({title, author?, digest?, content, thumbMediaId}) → mediaId`；业务调用遇 token 错误码（40001/40014/41001/42001）**单次**强刷重试；错误类型 `WechatApiError{errcode, errmsg}` / `WechatNetworkError`。
  - `wechat-credentials.ts`：`SecretCodec`/`plainCodec`（`plain:` 前缀）、`makeSafeStorageCodec(safeStorage)`（注入式，单测可仿造）、`setSecretCodec(codec, encrypted)`、`getWechatCredentials()`、`setWechatCredentials({appid, secret})`（secret=`KEEP_WECHAT_SECRET` 时沿用旧值）、`wechatCredentialsView()`（脱敏：appid/hasSecret/secretTail/encrypted）。
  - `markdownToWechatHtml(md)`（标题/段落/加粗/斜体/链接/图片/引用/分隔线，HTML 转义在前，不产 JS）、`replaceLocalImages(html, baseDir, upload)`、`safeJoin(base, rel)`（越界抛 `code:'ASSET_OUT_OF_FOLDER'`）。

- [ ] **Step 1: 失败测试**

`tests/unit/wechat-mp.test.ts`：
```ts
import { describe, it, expect, vi } from 'vitest';
import { WechatMpClient, WechatApiError, WechatNetworkError } from '../../src/main/publish/wechat-mp';

type Call = { url: string; body?: unknown };
function makeFetch(script: (c: Call) => Record<string, unknown> | { __status: number }) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init: { method: string; body?: unknown }) => {
    let body: unknown = init.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* 保留原串 */ } }
    if (typeof FormData !== 'undefined' && body instanceof FormData) body = { __form: [...body.entries()].map(([k, v]) => ({ k, name: (v as File).name, size: (v as File).size })) };
    const c: Call = { url, body };
    calls.push(c);
    const r = script(c);
    if ('__status' in (r as object)) {
      const status = (r as { __status: number }).__status;
      return { ok: status < 400, status, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => r as Record<string, unknown> };
  });
  return { fetchImpl, calls };
}
const cfg = { getAppid: () => 'wx-test', getSecret: () => 'secret-test' };

describe('WechatMpClient', () => {
  it('stable_token 获取与缓存：第二次业务调用不再请求 token', async () => {
    const { fetchImpl, calls } = makeFetch((c) => {
      if (c.url.includes('/cgi-bin/stable_token')) return { access_token: 'T1', expires_in: 7200 };
      return { media_id: 'D1' };
    });
    const client = new WechatMpClient(cfg, { fetchImpl: fetchImpl as never });
    const d1 = await client.createDraft({ title: '标题', content: '<p>x</p>', thumbMediaId: 'TH' });
    const d2 = await client.createDraft({ title: '标题', content: '<p>x</p>', thumbMediaId: 'TH' });
    expect(d1).toBe('D1'); expect(d2).toBe('D1');
    expect(calls.filter((c) => c.url.includes('stable_token'))).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ grant_type: 'client_credential', appid: 'wx-test', secret: 'secret-test' });
    expect((calls[1]!.body as { articles: { thumb_media_id: string }[] }).articles[0].thumb_media_id).toBe('TH');
  });
  it('token 过期后重新获取：过期的 T1 不再随业务请求发出', async () => {
    let t = 0; let tokens = 0;
    const { fetchImpl, calls } = makeFetch((c) => {
      if (c.url.includes('stable_token')) { tokens += 1; return { access_token: `T${tokens}`, expires_in: 7200 }; }
      return { media_id: 'D9' };
    });
    const client = new WechatMpClient(cfg, { fetchImpl: fetchImpl as never, now: () => t });
    await client.getAccessToken();            // T1（expiresAt = 6_900_000，含 5 分钟提前量）
    t = 7_200_000;                            // 已过期
    const id = await client.createDraft({ title: 'a', content: 'x', thumbMediaId: 'TH' });
    expect(id).toBe('D9');
    expect(tokens).toBe(2);                   // 恰好重取一次
    expect(calls.some((c) => c.url.includes('access_token=T1'))).toBe(false); // 旧 token 不再发出
  });
  it('缓存未过期：业务请求携带 T1；返回 40001 时单次强刷后重试成功', async () => {
    let t = 60_000; let tokens = 0; let draftCalls = 0;
    const { fetchImpl, calls } = makeFetch((c) => {
      if (c.url.includes('stable_token')) { tokens += 1; return { access_token: `T${tokens}`, expires_in: 7200 }; }
      draftCalls += 1;
      if (draftCalls === 1 && c.url.includes('T1')) return { errcode: 40001, errmsg: 'invalid credential' };
      return { media_id: 'D9' };
    });
    const client = new WechatMpClient(cfg, { fetchImpl: fetchImpl as never, now: () => t });
    await client.getAccessToken();            // T1 未过期（60_000 < 6_960_000）→ 首次业务调用必携带 T1
    const id = await client.createDraft({ title: 'a', content: 'x', thumbMediaId: 'TH' });
    expect(id).toBe('D9');                    // 强刷 T2 后重试成功
    expect(tokens).toBe(2);                   // 40001 恰好触发一次强刷
    expect(draftCalls).toBe(2);               // 首次(T1)被拒 → 重试(T2)成功，只重试一次
    expect(calls.some((c) => c.url.includes('access_token=T1') && (c.body as { articles?: unknown })?.articles)).toBe(true);
  });
  it('非 token errcode 直接抛 WechatApiError；HTTP 非 200 抛 WechatNetworkError', async () => {
    const { fetchImpl } = makeFetch((c) => c.url.includes('draft/add') ? { errcode: 45009, errmsg: 'reach max api daily quota' } : { access_token: 'T', expires_in: 7200 });
    const client = new WechatMpClient(cfg, { fetchImpl: fetchImpl as never });
    await expect(client.createDraft({ title: 'a', content: 'x', thumbMediaId: 'TH' })).rejects.toBeInstanceOf(WechatApiError);
    const { fetchImpl: f2 } = makeFetch(() => ({ __status: 502 }));
    const c2 = new WechatMpClient(cfg, { fetchImpl: f2 as never });
    await expect(c2.getAccessToken()).rejects.toBeInstanceOf(WechatNetworkError);
  });
  it('素材上传走 multipart：add_material 带文件名与字节，uploadimg 返回 url', async () => {
    const { fetchImpl, calls } = makeFetch((c) => {
      if (c.url.includes('add_material')) return { media_id: 'TH1', url: 'https://mmbiz/cover.jpg' };
      if (c.url.includes('uploadimg')) return { url: 'https://mmbiz/in.jpg' };
      return { access_token: 'T', expires_in: 7200 };
    });
    const client = new WechatMpClient(cfg, { fetchImpl: fetchImpl as never });
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await client.uploadImageMaterial(bytes, 'cover.png')).toMatchObject({ mediaId: 'TH1', url: 'https://mmbiz/cover.jpg' });
    expect(await client.uploadContentImage(bytes, 'in.png')).toBe('https://mmbiz/in.jpg');
    const form = (calls.find((c) => c.url.includes('add_material'))!.body as { __form: { k: string; name: string; size: number }[] }).__form;
    expect(form[0]).toMatchObject({ k: 'media', name: 'cover.png', size: 3 });
    expect(calls.find((c) => c.url.includes('add_material'))!.url).toContain('type=IMAGE');
  });
  it('未配置凭证抛业务错误', async () => {
    const client = new WechatMpClient({ getAppid: () => '', getSecret: () => '' });
    await expect(client.getAccessToken()).rejects.toMatchObject({ errcode: -1 });
  });
});
```

`tests/unit/wechat-credentials.test.ts`：
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  plainCodec, makeSafeStorageCodec, setSecretCodec, getWechatCredentials, setWechatCredentials, wechatCredentialsView,
} from '../../src/main/publish/wechat-credentials';
import { KEEP_WECHAT_SECRET } from '../../src/shared/types';

describe('公众号凭证（settings.json + 注入式编解码）', () => {
  const prev = process.env.CONTENTDECK_USER_DATA;
  beforeEach(() => {
    process.env.CONTENTDECK_USER_DATA = mkdtempSync(path.join(tmpdir(), 'ud-'));
    setSecretCodec(plainCodec, false);
  });
  afterEach(() => { process.env.CONTENTDECK_USER_DATA = prev; setSecretCodec(plainCodec, false); });

  it('set/get 往返（plainCodec）：settings.json 以 plain: 前缀存，可解回明文', () => {
    setWechatCredentials({ appid: 'wx1', secret: 's3cret' });
    const raw = readFileSync(path.join(process.env.CONTENTDECK_USER_DATA!, 'settings.json'), 'utf8');
    expect(raw).toContain('"plain:s3cret"'); // 明文回退编解码的可识别形态（视图层标 encrypted:false）
    expect(getWechatCredentials()).toEqual({ appid: 'wx1', secret: 's3cret' });
  });
  it('makeSafeStorageCodec：可用时 base64 加解密往返；不可用回退 plainCodec', () => {
    const store = new Map<string, string>();
    const fake = makeSafeStorageCodec({
      isEncryptionAvailable: () => true,
      encryptString: (s) => { const v = `enc(${s})`; store.set(v, s); return Buffer.from(v); },
      decryptString: (b) => store.get(b.toString()) ?? '',
    });
    setSecretCodec(fake.codec, fake.encrypted);
    setWechatCredentials({ appid: 'wx2', secret: 'topsecret' });
    const raw = readFileSync(path.join(process.env.CONTENTDECK_USER_DATA!, 'settings.json'), 'utf8');
    expect(raw).not.toContain('topsecret');
    expect(getWechatCredentials()).toEqual({ appid: 'wx2', secret: 'topsecret' });
    const fallback = makeSafeStorageCodec({ isEncryptionAvailable: () => false, encryptString: () => Buffer.of(), decryptString: () => '' });
    expect(fallback.encrypted).toBe(false);
    expect(fallback.codec).toBe(plainCodec);
  });
  it('KEEP_WECHAT_SECRET 沿用旧值；脱敏视图只回 appid/hasSecret/尾四位', () => {
    setWechatCredentials({ appid: 'wx1', secret: 'abcdef1234' });
    setWechatCredentials({ appid: 'wx1', secret: KEEP_WECHAT_SECRET });
    expect(getWechatCredentials()).toEqual({ appid: 'wx1', secret: 'abcdef1234' });
    expect(wechatCredentialsView()).toMatchObject({ appid: 'wx1', hasSecret: true, secretTail: '1234', encrypted: false });
    expect(JSON.stringify(wechatCredentialsView())).not.toContain('abcdef1234'); // 全量密钥不出视图
  });
  it('加密编解码激活时，plain: 前缀旧值仍可读（跨机器/回退兼容；e2e 预置凭证依赖此路径）', () => {
    setSecretCodec(plainCodec, false);
    setWechatCredentials({ appid: 'wx3', secret: 'legacy' });
    // 切到加密编解码后读取：plain: 值按前缀分流、不进 safeStorage 解密
    // （decryptString 对垃圾输入行为不定——分流保证 e2e 打包环境 safeStorage 可用时预置明文凭证确定性生效）
    const store = new Map<string, string>();
    const fake = makeSafeStorageCodec({
      isEncryptionAvailable: () => true,
      encryptString: (s) => { const v = `enc(${s})`; store.set(v, s); return Buffer.from(v); },
      decryptString: (b) => { const v = b.toString(); if (!store.has(v)) throw new Error('解密失败'); return store.get(v)!; },
    });
    setSecretCodec(fake.codec, true);
    expect(getWechatCredentials()).toEqual({ appid: 'wx3', secret: 'legacy' });
  });
});
```

`tests/unit/markdown-to-wechat-html.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { markdownToWechatHtml, replaceLocalImages, safeJoin } from '../../src/main/publish/markdown-to-wechat-html';
import { makeLibrary } from '../helpers/libFixture';

describe('markdown → 公众号 HTML', () => {
  it('标题/段落/加粗/斜体/链接/图片/引用/分隔线，HTML 转义在前', () => {
    const html = markdownToWechatHtml('# 大标题\n\n段落<b>加粗</b>与[链接](https://a.com)\n\n![图](assets/a.png)\n\n> 引用\n\n---\n\n尾段');
    expect(html).toContain('<h2>大标题</h2>');
    expect(html).toContain('<p>段落&lt;b&gt;加粗&lt;/b&gt;与<a href="https://a.com">链接</a></p>');
    expect(html).toContain('<img src="assets/a.png" alt="图" />');
    expect(html).toContain('<blockquote>引用</blockquote>');
    expect(html).toContain('<hr />');
    expect(html).toContain('<p>尾段</p>');
  });
  it('行内标记：**加粗** 与 *斜体*', () => {
    expect(markdownToWechatHtml('**粗** 与 *斜*')).toContain('<strong>粗</strong>');
    expect(markdownToWechatHtml('**粗** 与 *斜*')).toContain('<em>斜</em>');
  });
  it('safeJoin 拒绝越出内容目录的相对路径', () => {
    expect(safeJoin('C:/lib/a', 'assets/cover.png').endsWith(path.join('assets', 'cover.png'))).toBe(true);
    expect(() => safeJoin('C:/lib/a', '../evil.png')).toThrowError(expect.objectContaining({ code: 'ASSET_OUT_OF_FOLDER' }));
  });
  it('replaceLocalImages：本地 src 全部替换为上传 URL，http(s) 不动', async () => {
    const lib = makeLibrary();
    mkdirSync(path.join(lib, '2026-10-24-a', 'assets'), { recursive: true });
    writeFileSync(path.join(lib, '2026-10-24-a', 'assets', 'a.png'), new Uint8Array([1, 2, 3]));
    const html = '<p><img src="assets/a.png" /></p><img src="https://x/b.png" />';
    const out = await replaceLocalImages(html, path.join(lib, '2026-10-24-a'), async (bytes, name) => {
      expect(bytes.length).toBe(3);
      expect(name).toBe('a.png');
      return `https://mmbiz/${name}`;
    });
    expect(out).toContain('src="https://mmbiz/a.png"');
    expect(out).toContain('src="https://x/b.png"');
    expect(out).not.toContain('assets/a.png');
  });
});
```
（`pathJoin` 辅助在本测试文件内定义于 describe 之前即可；`replaceLocalImages` 用例需真实文件——执行时用 `makeLibrary` + `writeFileSync` 造 `assets/a.png` 两字节内容，`C:/base` 换为临时库路径。）

- [ ] **Step 2: 确认失败 → 实现 `src/main/publish/wechat-mp.ts`**

```ts
/** 公众号（mp.weixin.qq.com）API 客户端。探针事实 #7：stable_token 推荐；draft/add 字段限制；
 *  token 错误码 40001/40014/41001/42001 单次强刷重试。fetch 全程可注入（单测不联网）。 */
export class WechatApiError extends Error {
  constructor(readonly errcode: number, readonly errmsg: string) { super(`公众号 API 错误 ${errcode}: ${errmsg}`); }
}
export class WechatNetworkError extends Error {}
const TOKEN_ERRCODES = new Set([40001, 40014, 41001, 42001]);

export type WechatResponse = { ok: boolean; status: number; json(): Promise<unknown> };
export type WechatFetch = (url: string, init: { method: string; headers?: Record<string, string>; body?: unknown }) => Promise<WechatResponse>;

export class WechatMpClient {
  private readonly base: string;
  private readonly fetchImpl: WechatFetch;
  private readonly now: () => number;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly cfg: { getAppid(): string; getSecret(): string },
    opts: { baseUrl?: string; fetchImpl?: WechatFetch; now?: () => number } = {},
  ) {
    this.base = (opts.baseUrl ?? 'https://api.weixin.qq.com').replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as WechatFetch);
    this.now = opts.now ?? Date.now;
  }

  private async post(pathWithQuery: string, body: unknown): Promise<Record<string, unknown>> {
    const isForm = body instanceof FormData;
    let res: WechatResponse;
    try {
      res = await this.fetchImpl(`${this.base}${pathWithQuery}`, {
        method: 'POST',
        headers: isForm ? undefined : { 'content-type': 'application/json' },
        body: isForm ? body : JSON.stringify(body ?? {}),
      });
    } catch (err) {
      throw new WechatNetworkError(err instanceof Error ? err.message : String(err));
    }
    if (!res.ok) throw new WechatNetworkError(`HTTP ${res.status}`);
    const data = await res.json().catch(() => { throw new WechatNetworkError('响应不是合法 JSON'); }) as Record<string, unknown>;
    if (typeof data.errcode === 'number' && data.errcode !== 0) throw new WechatApiError(data.errcode, String(data.errmsg ?? ''));
    return data;
  }

  async getAccessToken(force = false): Promise<string> {
    if (!force && this.token && this.now() < this.token.expiresAt) return this.token.value;
    const appid = this.cfg.getAppid(); const secret = this.cfg.getSecret();
    if (!appid || !secret) throw new WechatApiError(-1, '未配置公众号 AppID/AppSecret');
    const data = await this.post('/cgi-bin/stable_token', { grant_type: 'client_credential', appid, secret });
    const value = String(data.access_token ?? '');
    if (!value) throw new WechatApiError(-2, 'stable_token 响应缺少 access_token');
    this.token = { value, expiresAt: this.now() + Math.max(0, Number(data.expires_in ?? 7200) * 1000 - 300_000) };
    return value;
  }

  private async call(path: string, body?: unknown): Promise<Record<string, unknown>> {
    let token = await this.getAccessToken();
    try {
      return await this.post(`${path}?access_token=${encodeURIComponent(token)}`, body);
    } catch (err) {
      if (err instanceof WechatApiError && TOKEN_ERRCODES.has(err.errcode)) {
        token = await this.getAccessToken(true);
        return this.post(`${path}?access_token=${encodeURIComponent(token)}`, body);
      }
      throw err;
    }
  }

  async uploadImageMaterial(bytes: Uint8Array, filename: string, mimeType = 'image/png'): Promise<{ mediaId: string; url: string }> {
    const fd = new FormData();
    fd.append('media', new Blob([bytes as unknown as BlobPart], { type: mimeType }), filename);
    const data = await this.call('/cgi-bin/material/add_material?type=IMAGE', fd);
    return { mediaId: String(data.media_id ?? ''), url: String(data.url ?? '') };
  }

  async uploadContentImage(bytes: Uint8Array, filename: string, mimeType = 'image/png'): Promise<string> {
    const fd = new FormData();
    fd.append('media', new Blob([bytes as unknown as BlobPart], { type: mimeType }), filename);
    const data = await this.call('/cgi-bin/media/uploadimg', fd);
    return String(data.url ?? '');
  }

  async createDraft(a: { title: string; author?: string; digest?: string; content: string; thumbMediaId: string }): Promise<string> {
    const data = await this.call('/cgi-bin/draft/add', {
      articles: [{
        title: a.title, author: a.author ?? '', digest: a.digest ?? '', content: a.content,
        thumb_media_id: a.thumbMediaId, need_open_comment: 0, only_fans_can_comment: 0,
      }],
    });
    return String(data.media_id ?? '');
  }
}
```

`src/main/publish/wechat-credentials.ts`：
```ts
import { loadSettings, saveSettings } from '../settings';
import { KEEP_WECHAT_SECRET, type WechatMpConfigView } from '../../shared/types';

export type SecretCodec = { encrypt(plain: string): string; decrypt(stored: string): string };
/** 明文回退编解码：带 plain: 前缀，视图层标记 encrypted:false 提醒用户。 */
export const plainCodec: SecretCodec = {
  encrypt: (s) => `plain:${s}`,
  decrypt: (s) => (s.startsWith('plain:') ? s.slice(6) : s),
};

/** safeStorage 注入式适配（单测用仿造 safeStorage；主进程在 ipc 装配时注入真实现）。 */
export function makeSafeStorageCodec(safeStorage: {
  isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string;
}): { codec: SecretCodec; encrypted: boolean } {
  if (!safeStorage.isEncryptionAvailable()) return { codec: plainCodec, encrypted: false };
  return {
    codec: {
      encrypt: (s) => safeStorage.encryptString(s).toString('base64'),
      decrypt: (s) => safeStorage.decryptString(Buffer.from(s, 'base64')),
    },
    encrypted: true,
  };
}

let active: { codec: SecretCodec; encrypted: boolean } = { codec: plainCodec, encrypted: false };
export function setSecretCodec(codec: SecretCodec, encrypted: boolean): void { active = { codec, encrypted }; }

function invalid(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = 'WECHAT_CONFIG_INVALID'; return err;
}

export function getWechatCredentials(): { appid: string; secret: string } | null {
  const w = loadSettings().wechatMp;
  if (!w?.appid || !w.secretStore) return null;
  // plain: 前缀分流在前（不进 safeStorage 解密——其对垃圾输入行为不定；
  // e2e 预置明文凭证在打包环境 safeStorage 可用时也确定性生效）
  if (w.secretStore.startsWith('plain:')) return { appid: w.appid, secret: plainCodec.decrypt(w.secretStore) };
  try { return { appid: w.appid, secret: active.codec.decrypt(w.secretStore) }; }
  catch { return null; } // 解密失败（换了机器/系统凭据）视同未配置，引导重填
}

export function setWechatCredentials(input: { appid: string; secret: string }): void {
  const prev = loadSettings().wechatMp;
  const appid = input.appid.trim();
  if (!appid) throw invalid('AppID 不能为空');
  const secretStore = input.secret === KEEP_WECHAT_SECRET ? prev?.secretStore ?? '' : input.secret ? active.codec.encrypt(input.secret) : '';
  if (!secretStore) throw invalid('AppSecret 不能为空');
  saveSettings({ ...loadSettings(), wechatMp: { appid, secretStore } });
}

export function wechatCredentialsView(): WechatMpConfigView | null {
  const w = loadSettings().wechatMp;
  if (!w) return null;
  let tail = '';
  try { tail = w.secretStore ? active.codec.decrypt(w.secretStore).slice(-4) : ''; } catch { tail = ''; }
  return { appid: w.appid, hasSecret: Boolean(w.secretStore), secretTail: tail, encrypted: active.encrypted };
}
```
（`WechatMpConfigView` 与 `KEEP_WECHAT_SECRET` 本任务加入 `src/shared/types.ts`：
```ts
export type WechatMpConfigView = { appid: string; hasSecret: boolean; secretTail: string; encrypted: boolean };
export const KEEP_WECHAT_SECRET = '__KEEP_SAVED_SECRET__';
```
）

`src/main/publish/markdown-to-wechat-html.ts`：
```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function safeJoin(base: string, rel: string): string {
  const p = path.resolve(base, rel);
  if (p !== path.resolve(base) && !p.startsWith(path.resolve(base) + path.sep)) {
    const err = new Error(`路径越出内容目录: ${rel}`) as Error & { code: string };
    err.code = 'ASSET_OUT_OF_FOLDER'; throw err;
  }
  return p;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => `<img src="${esc(src)}" alt="${esc(alt)}" />`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, href: string) => `<a href="${esc(href)}">${text}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/** 极小 Markdown → 公众号正文 HTML：标题/段落/加粗/斜体/链接/图片/引用/分隔线；转义在前、不产 JS（draft/add 约束）。 */
export function markdownToWechatHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(esc(para.join(' ')))}</p>`); para = []; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flush(); out.push(`<h${h[1]!.length + 1}>${inline(esc(h[2]!))}</h${h[1]!.length + 1}>`); continue; }
    if (/^(---|\*\*\*)\s*$/.test(line)) { flush(); out.push('<hr />'); continue; }
    if (line.startsWith('> ')) { flush(); out.push(`<blockquote>${inline(esc(line.slice(2)))}</blockquote>`); continue; }
    para.push(line.trim());
  }
  flush();
  return out.join('\n');
}

/** 正文内本地图片 → uploadimg URL（draft/add 约束：图片必须来自该接口）。 */
export async function replaceLocalImages(
  html: string, baseDir: string, upload: (bytes: Uint8Array, filename: string) => Promise<string>,
): Promise<string> {
  const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]!).filter((s) => !/^(https?:)?\/\//.test(s));
  let out = html;
  for (const src of [...new Set(srcs)]) {
    const file = safeJoin(baseDir, src);
    const bytes = new Uint8Array(await readFile(file));
    const url = await upload(bytes, path.basename(file));
    out = out.split(`src="${src}"`).join(`src="${url}"`);
  }
  return out;
}
```

- [ ] **Step 3: 通过 + typecheck**

```bash
npx vitest run tests/unit/wechat-mp.test.ts tests/unit/wechat-credentials.test.ts tests/unit/markdown-to-wechat-html.test.ts
npm run typecheck && npm test
```

- [ ] **Step 4: Commit** `git commit -m "feat(m3): 公众号 API 客户端（stable_token 缓存/素材/草稿）、safeStorage 凭证与 md→HTML"`

---

### Task 4: 小红书注入脚本 + 平台会话 + PlatformAdapter

**Files:**
- Create: `src/main/publish/inject-script-xiaohongshu.ts`、`src/main/publish/platform-session.ts`、`src/main/publish/adapter.ts`、`tests/fixtures/xiaohongshu-editor.html`
- Test: `tests/unit/inject-script-xiaohongshu.test.ts`、`tests/unit/adapter.test.ts`

**Interfaces:**
- Produces:
  - `xiaohongshuInjectScript(payload): Promise<XhsResult>`（**自包含**：不引用模块级任何东西；经 `toString()` 序列化后 `executeJavaScript` 注入；payload 携带 `timeoutMs?` 供测试缩短等待）。模式：`loginCheck` / `inject{title, body, topics}` / `readBack`；失败码 `NOT_LOGGED_IN | PAGE_CHANGED | ALREADY_HAS_CONTENT | FILL_FAILED`。
  - `PlatformSession`（electron 专属，仅 ipc.ts 引用）：`open(url, allowedHosts)`（persist partition + UA 常规化 + 白名单校验 + loadURL）、`driver(): PageDriver`（`evaluate(fnSource, payload)`/`currentUrl()`）、`attach(visible)`（挂到主窗口 contentView；visible=右侧半屏/隐藏=零尺寸）、`dispose()`。`normalizeUserAgent(ua)` 导出供测试。
  - `adapter.ts`：`PlatformAdapter`（spec §6 接口：`loginCheck/injectDraft/readBackStatus` + `rules` + `usesSession`）、`xiaohongshuAdapter`、`createWechatArticleAdapter({client})`、`classifyFailure(code): PublishFailureCategory`、`PageDriver` 类型。
  - fixture 页：登录态（文案含「扫码登录」+ 模拟登录按钮）/编辑器态（placeholder 标题框 + `.ql-editor[contenteditable]` + 发布按钮）；input 事件 POST `/fixture/state`，发布按钮点击 POST `/fixture/published`（e2e 断言零点击）。

- [ ] **Step 1: fixture 页与失败测试**

`tests/fixtures/xiaohongshu-editor.html`（完整写入；选择器与真实平台同形——placeholder 标题框、ql-editor contenteditable）：
```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><title>小红书创作服务平台（fixture）</title></head>
<body>
  <div id="root"></div>
  <script>
    // fixture 行为：默认登录态 UI（文案与真实平台登录页同特征）；?login=1 或 localStorage 标记 → 编辑器。
    // 编辑器 input 事件上报 /fixture/state；「发布」按钮点击上报 /fixture/published（e2e 断言为 0——
    // 应用只注入草稿，发布永远由人点；本按钮的存在使「被程序点击」变为可检测事件）。
    (function () {
      var logged = location.search.indexOf('login=1') !== -1 || localStorage.getItem('fixture-login') === '1';
      var root = document.getElementById('root');
      if (!logged) {
        root.innerHTML = '<div class="login-panel"><p>扫码登录小红书创作服务平台</p><button id="mock-login">模拟登录</button></div>';
        document.getElementById('mock-login').onclick = function () {
          localStorage.setItem('fixture-login', '1'); location.search = '?login=1';
        };
        return;
      }
      root.innerHTML = '<div class="publish-page">' +
        '<input id="title" placeholder="填写标题会有更多赞哦~" maxlength="20" />' +
        '<div class="ql-editor" contenteditable="true" data-placeholder="填写正文" role="textbox"></div>' +
        '<button id="publish">发布</button></div>';
      var report = function () {
        fetch('/fixture/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          title: document.getElementById('title').value,
          body: document.querySelector('.ql-editor').textContent,
        }) }).catch(function () {});
      };
      document.getElementById('title').addEventListener('input', report);
      document.querySelector('.ql-editor').addEventListener('input', report);
      document.getElementById('publish').addEventListener('click', function () { fetch('/fixture/published', { method: 'POST' }).catch(function () {}); });
    })();
  </script>
</body>
</html>
```

`tests/unit/inject-script-xiaohongshu.test.ts`（jsdom fixture 回放，spec §9）：
```ts
// @vitest-environment jsdom   （探针事实 #5：pragma 覆盖 node 项目环境；若不生效挪到 tests/renderer/）
import { describe, it, expect } from 'vitest';
import { xiaohongshuInjectScript } from '../../src/main/publish/inject-script-xiaohongshu';

const run = eval(`(${xiaohongshuInjectScript.toString()})`) as typeof xiaohongshuInjectScript; // 探针事实 #4
const EDITOR_HTML = `
  <input placeholder="填写标题会有更多赞哦~" />
  <div class="ql-editor" contenteditable="true" data-placeholder="填写正文"></div>
  <button>发布</button>`;
const LOGIN_HTML = '<div class="login"><p>扫码登录</p><p>手机号登录</p></div>';
const payload = { kind: 'inject', title: '测试标题', body: '这是注入的正文内容', topics: ['话题A'], timeoutMs: 200 } as const;

describe('小红书注入脚本（jsdom fixture 回放）', () => {
  it('登录态页面 → loginCheck 与 inject 都报 NOT_LOGGED_IN', async () => {
    document.body.innerHTML = LOGIN_HTML;
    expect(await run({ kind: 'loginCheck', timeoutMs: 200 })).toMatchObject({ ok: false, code: 'NOT_LOGGED_IN' });
    expect(await run(payload)).toMatchObject({ ok: false, code: 'NOT_LOGGED_IN' });
  });
  it('编辑器页注入：标题/正文/话题落位（jsdom 无 DataTransfer 走 textContent 回退——探针事实 #3），话题以 # 追加', async () => {
    document.body.innerHTML = EDITOR_HTML;
    const r = await run(payload);
    expect(r).toMatchObject({ ok: true, kind: 'inject' });
    const input = document.querySelector<HTMLInputElement>("input[placeholder*='标题']")!;
    const editor = document.querySelector<HTMLElement>('.ql-editor')!;
    expect(input.value).toBe('测试标题');
    expect(editor.textContent).toContain('这是注入的正文内容');
    expect(editor.textContent).toContain('#话题A');
    expect((r as { draftUrl: string }).draftUrl).toBe(location.href);
  });
  it('标题超 20 字自动截断并带 warning', async () => {
    document.body.innerHTML = EDITOR_HTML;
    const r = await run({ ...payload, title: '一二三四五六七八九十一二三四五六七八九十一' });
    expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('一二三四五六七八九十一二三四五六七八九十');
    expect((r as { warnings: string[] }).warnings.join()).toContain('20');
  });
  it('防覆盖：已有不同内容拒绝（ALREADY_HAS_CONTENT）；同内容幂等重填允许', async () => {
    document.body.innerHTML = EDITOR_HTML;
    document.querySelector<HTMLInputElement>('input')!.value = '别人的标题';
    const r = await run(payload);
    expect(r).toMatchObject({ ok: false, code: 'ALREADY_HAS_CONTENT' });
    // 幂等：先注入成功，再注入同一负载 → 允许重填
    document.body.innerHTML = EDITOR_HTML;
    await run(payload);
    const again = await run(payload);
    expect(again).toMatchObject({ ok: true });
  });
  it('页面无编辑器元素 → PAGE_CHANGED（绝不静默）', async () => {
    document.body.innerHTML = '<div>空页面</div>';
    expect(await run(payload)).toMatchObject({ ok: false, code: 'PAGE_CHANGED' });
  });
  it('readBack 回读标题与正文字数', async () => {
    document.body.innerHTML = EDITOR_HTML;
    await run(payload);
    const r = await run({ kind: 'readBack', timeoutMs: 200 });
    expect(r).toMatchObject({ ok: true, kind: 'readBack', title: '测试标题' });
    expect((r as { bodyChars: number }).bodyChars).toBeGreaterThan(0);
  });
});
```

`tests/unit/adapter.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { xiaohongshuAdapter, createWechatArticleAdapter, classifyFailure } from '../../src/main/publish/adapter';
import type { PageDriver } from '../../src/main/publish/adapter';
import { xiaohongshuInjectScript } from '../../src/main/publish/inject-script-xiaohongshu';
import { PLATFORM_RULES } from '../../src/shared/platform-rules';

function driverWith(result: unknown): PageDriver {
  return {
    evaluate: async (src, payload) => {
      expect(src).toBe(xiaohongshuInjectScript.toString()); // 注入脚本源原样下发
      expect(payload).toBeTruthy();
      return result as never;
    },
    currentUrl: () => 'https://creator.xiaohongshu.com/publish/publish',
  };
}

describe('适配器层', () => {
  it('小红书适配器：loginCheck/inject/readBack 结果映射与 rules 引用', async () => {
    expect(xiaohongshuAdapter.rules).toBe(PLATFORM_RULES.xiaohongshu);
    expect(xiaohongshuAdapter.usesSession).toBe(true);
    expect(await xiaohongshuAdapter.loginCheck(driverWith({ ok: true, kind: 'loginCheck', loggedIn: true })))).toEqual({ loggedIn: true });
    expect(await xiaohongshuAdapter.loginCheck(driverWith({ ok: false, code: 'NOT_LOGGED_IN', message: 'x' }))).toEqual({ loggedIn: false, message: 'x' });
    const r = await xiaohongshuAdapter.injectDraft(driverWith({ ok: true, kind: 'inject', draftUrl: 'https://u', warnings: [] }), {
      doc: { platform: 'xiaohongshu', title: 't', topics: [], body: 'b' }, variantPath: 'p/platforms/xiaohongshu.md', contentFolder: 'C:/c',
    });
    expect(r).toEqual({ ok: true, draftUrl: 'https://u', warnings: [] });
    const bad = await xiaohongshuAdapter.injectDraft(driverWith({ ok: false, code: 'ALREADY_HAS_CONTENT', message: 'm' }), {
      doc: { platform: 'xiaohongshu', title: 't', topics: [], body: 'b' }, variantPath: 'p', contentFolder: 'C:/c',
    });
    expect(bad).toMatchObject({ ok: false, code: 'ALREADY_HAS_CONTENT' });
  });
  it('公众号文章适配器：未配置凭证时 loginCheck 引导配置；注入返回 WECHAT_API', async () => {
    const a = createWechatArticleAdapter({ client: () => null });
    expect(a.rules).toBe(PLATFORM_RULES['wechat-article']);
    expect(a.usesSession).toBe(false);
    expect(await a.loginCheck(null as never)).toMatchObject({ loggedIn: false });
    const r = await a.injectDraft(null as never, { doc: { platform: 'wechat-article', title: 't', topics: [], body: 'b', cover: 'c.png' }, variantPath: 'p', contentFolder: 'C:/c' });
    expect(r).toMatchObject({ ok: false, code: 'WECHAT_API' });
  });
  it('classifyFailure：三分类+扩展类映射', () => {
    expect(classifyFailure('NOT_LOGGED_IN')).toBe('not_logged_in');
    expect(classifyFailure('PAGE_CHANGED')).toBe('page_changed');
    expect(classifyFailure('FILL_FAILED')).toBe('page_changed');
    expect(classifyFailure('NETWORK')).toBe('network');
    expect(classifyFailure('TIMEOUT')).toBe('network');
    expect(classifyFailure('ALREADY_HAS_CONTENT')).toBe('already_has_content');
    expect(classifyFailure('WECHAT_API')).toBe('api_error');
    expect(classifyFailure('WHATEVER')).toBe('unknown');
  });
});
```

- [ ] **Step 2: 确认失败 → 实现注入脚本 `src/main/publish/inject-script-xiaohongshu.ts`**

```ts
/**
 * 小红书创作服务平台页面注入脚本。
 * 自包含约束（铁律）：不引用任何模块级变量/导入——本函数经 toString() 序列化后由主进程
 * webContents.executeJavaScript 在页面上下文执行。借鉴边界：仅借鉴 wesight（AGPL-3.0）的
 * 定位/等待/填充思路，实现为本仓库原创；选择器对照本仓库 fixture 与真实平台人工验收整理。
 * 风控（spec §6）：只填标题/正文/话题，绝不点击「发布」类按钮，不发起任何平台接口请求。
 * jsdom 无 DataTransfer/ClipboardEvent（探针事实 #3）：粘贴路径有守卫，回退 textContent+InputEvent。
 */
export type XhsPayload = (
  | { kind: 'loginCheck' }
  | { kind: 'inject'; title: string; body: string; topics: string[] }
  | { kind: 'readBack' }
) & { timeoutMs?: number };
export type XhsResult =
  | { ok: true; kind: 'loginCheck'; loggedIn: boolean }
  | { ok: true; kind: 'inject'; draftUrl: string; warnings: string[] }
  | { ok: true; kind: 'readBack'; title: string; bodyChars: number; url: string }
  | { ok: false; code: 'NOT_LOGGED_IN' | 'PAGE_CHANGED' | 'ALREADY_HAS_CONTENT' | 'FILL_FAILED'; message: string };

export async function xiaohongshuInjectScript(payload: XhsPayload): Promise<XhsResult> {
  const TITLE_SELECTORS = ["input[placeholder*='标题']", "textarea[placeholder*='标题']", 'input.d-text'];
  const EDITOR_SELECTORS = [".ql-editor[contenteditable='true']", "div[contenteditable='true'][role='textbox']", "div[contenteditable='true'][data-placeholder*='正文']", "div[contenteditable='true']"];
  const TITLE_LIMIT = 20;
  const timeoutMs = payload.timeoutMs ?? 15000;
  const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const visible = (el: Element): boolean => {
    if (typeof HTMLElement === 'undefined' || !(el instanceof HTMLElement)) return true;
    if (el.hidden || el.closest("[aria-hidden='true']")) return false;
    const s = el.ownerDocument.defaultView?.getComputedStyle(el);
    return s?.display !== 'none' && s?.visibility !== 'hidden';
  };
  const firstVisible = <T extends Element>(selectors: string[]): T | null => {
    for (const sel of selectors) {
      const el = document.querySelector<T>(sel);
      if (el && visible(el)) return el;
    }
    return null;
  };
  const waitFor = async <T extends Element>(selectors: string[]): Promise<T | null> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const el = firstVisible<T>(selectors);
      if (el) return el;
      if (Date.now() >= deadline) return null;
      await delay(150);
    }
  };
  const loginRequired = (): boolean => {
    if (/\/login(?:[/?#]|$)/i.test(location.href)) return true;
    if (firstVisible(EDITOR_SELECTORS)) return false;
    const text = document.body.textContent?.replace(/\s+/g, ' ') ?? '';
    return /(?:扫码登录|手机号登录|登录后创作|请先登录)/.test(text);
  };
  const composeBody = (body: string, topics: string[]): string => {
    const tags = topics.map((t) => t.replace(/^#+|#+$/g, '').trim()).filter(Boolean).map((t) => `#${t}`);
    return [body.trim(), tags.join(' ')].filter(Boolean).join('\n\n');
  };

  if (loginRequired()) {
    return { ok: false, code: 'NOT_LOGGED_IN', message: '请先登录小红书创作服务平台（发布中心「打开平台页」完成登录后重试）' };
  }
  if (payload.kind === 'loginCheck') return { ok: true, kind: 'loginCheck', loggedIn: true };

  const title = await waitFor<HTMLInputElement | HTMLTextAreaElement>(TITLE_SELECTORS);
  const editor = await waitFor<HTMLElement>(EDITOR_SELECTORS);
  if (!title || !editor) {
    return { ok: false, code: 'PAGE_CHANGED', message: '未找到标题框或正文编辑器：页面结构可能已更新，适配器需更新' };
  }

  if (payload.kind === 'readBack') {
    return { ok: true, kind: 'readBack', title: title.value ?? '', bodyChars: Array.from(editor.textContent ?? '').length, url: location.href };
  }

  // 注入前防覆盖（spec §6 风控）：已有内容且与本次负载不一致 → 拒绝；一致视为幂等重试允许重填。
  const newTitle = Array.from(payload.title.trim()).slice(0, TITLE_LIMIT).join('');
  const newBody = composeBody(payload.body, payload.topics);
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const existingTitle = title.value ?? '';
  const existingBody = editor.textContent ?? '';
  const prefix = norm(newBody).slice(0, 16);
  const isRefill = existingTitle === newTitle && norm(existingBody).includes(prefix);
  if (!isRefill && (existingTitle.trim() || existingBody.trim())) {
    return { ok: false, code: 'ALREADY_HAS_CONTENT', message: `编辑器已有内容（标题「${existingTitle.slice(0, 12)}」），为防覆盖已停止注入；确认覆盖请先在平台编辑器清空` };
  }

  title.focus();
  title.value = newTitle;
  title.dispatchEvent(new Event('input', { bubbles: true }));
  title.dispatchEvent(new Event('change', { bubbles: true }));

  editor.focus();
  const canPaste = typeof ClipboardEvent !== 'undefined' && typeof DataTransfer !== 'undefined';
  if (canPaste) {
    const dt = new DataTransfer();
    dt.setData('text/plain', newBody);
    editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
    await delay(150);
  }
  if (!norm(editor.textContent ?? '').includes(prefix)) {
    editor.textContent = newBody;
    const InputEventCtor = (editor.ownerDocument.defaultView as unknown as { InputEvent?: typeof InputEvent })?.InputEvent ?? InputEvent;
    editor.dispatchEvent(new InputEventCtor('input', { bubbles: true, inputType: 'insertText', data: newBody.slice(0, 64) }));
  }
  editor.dispatchEvent(new Event('change', { bubbles: true }));
  editor.dispatchEvent(new Event('blur', { bubbles: true }));
  if (!norm(editor.textContent ?? '').includes(prefix)) {
    return { ok: false, code: 'FILL_FAILED', message: '正文填充未生效（平台编辑器可能拦截注入）：可重试，或复制变体内容手动粘贴' };
  }
  return {
    ok: true, kind: 'inject', draftUrl: location.href,
    warnings: Array.from(payload.title.trim()).length > TITLE_LIMIT ? [`标题超过 ${TITLE_LIMIT} 字，已截断填充`] : [],
  };
}
```

- [ ] **Step 3: 实现 `src/main/publish/platform-session.ts`**

```ts
import { BrowserWindow, WebContentsView, session, app } from 'electron';

/** UA 常规化（spec §6：窗口特征与常规浏览器一致）：剥离 Electron 与应用名 token。 */
export function normalizeUserAgent(ua: string): string {
  const appName = app.name?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') ?? '';
  return ua.replace(/\s*Electron\/[\d.]+/i, '').replace(new RegExp(`\\s*${appName}/[\\d.]+`), '').trim();
}

function coded(message: string, code: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code; return err;
}

/** 每平台一个常驻会话：persist partition 保存登录态（cookie 由平台写入，应用不落明文，spec §4.2）。 */
export class PlatformSession {
  private view: WebContentsView | null = null;
  private url = '';

  constructor(private readonly platform: string) {}

  async open(url: string, allowedHosts: string[]): Promise<void> {
    let host: string;
    try { host = new URL(url).hostname; } catch { throw coded(`编辑器地址不合法: ${url}`, 'EDITOR_URL_INVALID'); }
    if (!allowedHosts.includes(host)) throw coded(`编辑器地址 ${url} 不在 ${this.platform} 平台白名单内`, 'EDITOR_URL_BLOCKED');
    if (!this.view) {
      const ses = session.fromPartition(`persist:${this.platform}`);
      ses.setUserAgent(normalizeUserAgent(ses.getUserAgent()));
      this.view = new WebContentsView({
        webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
    }
    if (this.url !== url) {
      await this.view.webContents.loadURL(url);
      this.url = url;
    }
  }

  /** 挂到主窗口：visible=窗口右半屏；false=零尺寸隐藏（登录探测/后台注入）。 */
  attach(visible: boolean): void {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    if (!win || !this.view) return;
    try { win.contentView.addChildView(this.view); } catch { /* 已挂载 */ }
    const [w, h] = win.getContentSize();
    this.view.setBounds(visible ? { x: Math.floor(w * 0.55), y: 0, width: Math.ceil(w * 0.45), height: h } : { x: 0, y: 0, width: 0, height: 0 });
  }

  async evaluate<T>(fnSource: string, payload: unknown): Promise<T> {
    if (!this.view) throw coded('平台页未打开', 'SESSION_NOT_OPEN');
    const exec = this.view.webContents.executeJavaScript(`(${fnSource})(${JSON.stringify(payload)})`, true) as Promise<T>;
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(coded('平台页脚本执行超时', 'TIMEOUT')), 90_000);
    });
    return Promise.race([exec, timeout]);
  }

  currentUrl(): string { return this.view?.webContents.getURL() ?? ''; }

  dispose(): void {
    if (!this.view) return;
    for (const w of BrowserWindow.getAllWindows()) {
      try { w.contentView.removeChildView(this.view); } catch { /* 窗口已销毁 */ }
    }
    try { this.view.webContents.close(); } catch { /* 已关闭 */ }
    this.view = null; this.url = '';
  }
}
```
（单测不 import 本文件——electron 专属；UA 规则由 adapter.test 之外的独立用例覆盖与否以「typecheck 通过+e2e 覆盖」为判定。若执行者想单测 `normalizeUserAgent`，需把 app.name 依赖参数化——不强求。）

- [ ] **Step 4: 实现 `src/main/publish/adapter.ts`**

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PlatformKey, PublishFailureCategory, VariantDoc } from '../../shared/types';
import { PLATFORM_RULES, type PlatformRules } from '../../shared/platform-rules';
import { xiaohongshuInjectScript, type XhsPayload, type XhsResult } from './inject-script-xiaohongshu';
import { markdownToWechatHtml, replaceLocalImages, safeJoin } from './markdown-to-wechat-html';
import { WechatApiError, WechatNetworkError, type WechatMpClient } from './wechat-mp';

/** 页面驱动：PlatformSession（electron）实现；测试替身实现同接口。 */
export type PageDriver = {
  evaluate<T>(fnSource: string, payload: unknown): Promise<T>;
  currentUrl(): string;
};
export type LoginCheckResult = { loggedIn: boolean; message?: string };
export type InjectInput = { doc: VariantDoc; variantPath: string; contentFolder: string };
export type InjectResult =
  | { ok: true; draftUrl?: string; mediaId?: string; warnings: string[] }
  | { ok: false; code: string; message: string };
export type ReadBackResult = { ok: true; title: string; bodyChars: number; url?: string } | { ok: false; message: string };

/** spec §6 适配器接口：loginCheck / injectDraft / readBackStatus / rules（platformRules）。 */
export interface PlatformAdapter {
  readonly key: PlatformKey;
  readonly rules: PlatformRules;
  readonly usesSession: boolean; // dom=true（页面驱动）；api=false（无页面——PublishService 跳过 runtime.open，传空驱动 noPageDriver）
  loginCheck(d: PageDriver): Promise<LoginCheckResult>;
  injectDraft(d: PageDriver, input: InjectInput): Promise<InjectResult>;
  readBackStatus(d: PageDriver): Promise<ReadBackResult>;
}

export function classifyFailure(code: string): PublishFailureCategory {
  switch (code) {
    case 'NOT_LOGGED_IN': return 'not_logged_in';
    case 'PAGE_CHANGED': case 'FILL_FAILED': return 'page_changed';
    case 'ALREADY_HAS_CONTENT': return 'already_has_content';
    case 'NETWORK': case 'TIMEOUT': return 'network';
    case 'WECHAT_API': return 'api_error';
    default: return 'unknown';
  }
}

function msg(err: unknown): string { return err instanceof Error ? err.message : String(err); }

export const xiaohongshuAdapter: PlatformAdapter = {
  key: 'xiaohongshu',
  rules: PLATFORM_RULES.xiaohongshu,
  usesSession: true,
  async loginCheck(d) {
    const r = await d.evaluate<XhsResult>(xiaohongshuInjectScript.toString(), { kind: 'loginCheck' } satisfies XhsPayload);
    return r.ok ? { loggedIn: true } : { loggedIn: false, message: r.message };
  },
  async injectDraft(d, input) {
    const r = await d.evaluate<XhsResult>(xiaohongshuInjectScript.toString(), {
      kind: 'inject', title: input.doc.title, body: input.doc.body, topics: input.doc.topics,
    } satisfies XhsPayload);
    return r.ok && r.kind === 'inject'
      ? { ok: true, draftUrl: r.draftUrl, warnings: r.warnings }
      : r.ok ? { ok: false, code: 'PAGE_CHANGED', message: '意外结果' } : { ok: false, code: r.code, message: r.message };
  },
  async readBackStatus(d) {
    const r = await d.evaluate<XhsResult>(xiaohongshuInjectScript.toString(), { kind: 'readBack' } satisfies XhsPayload);
    return r.ok && r.kind === 'readBack'
      ? { ok: true, title: r.title, bodyChars: r.bodyChars, url: r.url }
      : { ok: false, message: r.ok ? '意外结果' : r.message };
  },
};

/** 公众号文章（API 模式）：封面→永久素材；正文 md→HTML 且本地图片全部经 uploadimg；创建草稿停在草稿态。 */
export function createWechatArticleAdapter(deps: { client(): WechatMpClient | null }): PlatformAdapter {
  return {
    key: 'wechat-article',
    rules: PLATFORM_RULES['wechat-article'],
    usesSession: false,
    async loginCheck() {
      const c = deps.client();
      if (!c) return { loggedIn: false, message: '未配置公众号 AppID/AppSecret（发布中心 →「公众号配置」）' };
      try { await c.getAccessToken(); return { loggedIn: true }; }
      catch (err) {
        const hint = err instanceof WechatApiError && (err.errcode === 40125 || err.errcode === 40013)
          ? '（检查 AppSecret 是否正确、本机出口 IP 是否已加入公众号后台 IP 白名单）' : '';
        return { loggedIn: false, message: `${msg(err)}${hint}` };
      }
    },
    async injectDraft(_d, input) {
      const c = deps.client();
      if (!c) return { ok: false, code: 'WECHAT_API', message: '未配置公众号凭证' };
      try {
        const coverPath = safeJoin(input.contentFolder, input.doc.cover ?? '');
        const coverBytes = new Uint8Array(await readFile(coverPath));
        const { mediaId: thumbMediaId } = await c.uploadImageMaterial(coverBytes, path.basename(coverPath));
        let html = markdownToWechatHtml(input.doc.body);
        html = await replaceLocalImages(html, input.contentFolder, (bytes, name) => c.uploadContentImage(bytes, name));
        const mediaId = await c.createDraft({
          title: input.doc.title, digest: input.doc.digest || undefined, content: html, thumbMediaId,
        });
        return { ok: true, mediaId, warnings: [] };
      } catch (err) {
        if (err instanceof WechatNetworkError) return { ok: false, code: 'NETWORK', message: msg(err) };
        if (err instanceof WechatApiError) return { ok: false, code: 'WECHAT_API', message: msg(err) };
        if ((err as { code?: string })?.code === 'ASSET_OUT_OF_FOLDER') return { ok: false, code: 'WECHAT_API', message: msg(err) };
        return { ok: false, code: 'UNKNOWN', message: msg(err) };
      }
    },
    async readBackStatus() { return { ok: true, title: '', bodyChars: 0 }; }, // API 模式无页面回读；草稿以 media_id 为准（后台人工可见）
  };
}
```
（`PublishFailureCategory` 需先在 `src/shared/types.ts` 定义——本任务加入：
```ts
export type PublishPhase = 'queued' | 'validating' | 'login_check' | 'injecting' | 'reading_back' | 'prepared' | 'failed';
export type PublishFailureCategory = 'not_logged_in' | 'page_changed' | 'network' | 'already_has_content' | 'api_error' | 'validation' | 'unknown';
export type PublishTask = {
  taskId: string; contentId: string; platform: PlatformKey; phase: PublishPhase;
  category?: PublishFailureCategory; message?: string;
  draftUrl?: string; mediaId?: string; variantPath?: string;
  readBack?: { title: string; bodyChars: number; url: string }; updatedAt: string;
};
export type PublishEventOut = { kind: 'task_update'; task: PublishTask };
```
）

- [ ] **Step 5: 通过 + typecheck**

```bash
npx vitest run tests/unit/inject-script-xiaohongshu.test.ts tests/unit/adapter.test.ts   # 6 + 3 passed
npm run typecheck && npm test
```

- [ ] **Step 6: Commit** `git commit -m "feat(m3): 小红书自包含注入脚本（防覆盖/绝不点发布）+ WebContentsView 平台会话 + 双适配器"`

---

### Task 5: PublishService 发布编排 + create_publish_task 工具

**Files:**
- Create: `src/main/publish/publish-service.ts`
- Modify: `src/main/agent/domain-tools.ts`（+create_publish_task）、`src/main/agent/real-session.ts`（deps.+createPublishTask）
- Test: `tests/unit/publish-service.test.ts`、`tests/unit/domain-tools.test.ts`（追加）

**Interfaces:**
- Produces:
  - `PublishService`（构造注入 `{ root(), runtime: PublishRuntime, emit(ev), minIntervalMs?, now? }`——FakeRuntime 可测）：
    - `createTask(contentId, platform): CreateTaskResult`（spec §5：只建任务不触发注入）
    - `run(taskId): Promise<void>`（**全局串行互斥链** + 相邻执行最小间隔；用户在发布中心点「注入草稿」触发）
    - `retry(taskId)`（仅 failed 可重试；重置后重新入链）
    - `checkLogin(platform): Promise<{loggedIn, message?}>`
    - `showView(platform, visible)`、`task(taskId)`、`list(): PublishTask[]`
    - 每次相位变化 `emit({kind:'task_update', task})`
  - `PublishRuntime = { adapter(platform), open(platform): Promise<PageDriver>, show(platform, visible) }`——`runtime.open` **只对 `usesSession=true`（dom）平台调用**；api 平台（公众号文章）无内嵌编辑器（`ElectronPublishRuntime.editorUrl` 对非 xiaohongshu 平台直接 throw），服务层对其传空驱动 `noPageDriver`（`evaluate` 即抛错——API 适配器约定不使用 driver，误用显式报错）
  - 领域工具 `create_publish_task(id, platform)`：经 `deps.createPublishTask`（**返回 `CreateTaskResult`，不吞返回值**）建任务，成功返回确认文本；`ok:false`（如 x/jike 无适配器 → `PUBLISH_PLATFORM_UNSUPPORTED`）与服务未接均 `isError` 如实呈现，绝不谎报「已创建」。

- [ ] **Step 1: 失败测试 `tests/unit/publish-service.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PublishService, type PublishRuntime } from '../../src/main/publish/publish-service';
import type { PlatformAdapter, PageDriver } from '../../src/main/publish/adapter';
import { makeLibrary, addContent } from '../helpers/libFixture';
import type { PublishEventOut, PublishTask } from '../../src/shared/types';

const XHS_ID = 'c_20261024_aa01';

function fakeAdapter(over: Partial<PlatformAdapter> = {}): PlatformAdapter {
  return {
    key: 'xiaohongshu',
    rules: { key: 'xiaohongshu', label: '小红书', mode: 'dom', notes: [], validate: () => ({ ok: true, errors: [], warnings: [] }) },
    usesSession: true,
    loginCheck: vi.fn(async () => ({ loggedIn: true })),
    injectDraft: vi.fn(async () => ({ ok: true, draftUrl: 'https://creator.xiaohongshu.com/publish/publish', warnings: [] })),
    readBackStatus: vi.fn(async () => ({ ok: true, title: 't', bodyChars: 10, url: 'https://u' })),
    ...over,
  } as PlatformAdapter;
}
const driver: PageDriver = { evaluate: async () => ({ ok: true }) as never, currentUrl: () => 'https://u' };

function harness(adapter: PlatformAdapter, opts: { minIntervalMs?: number } = {}) {
  const events: PublishEventOut[] = [];
  const open = vi.fn(async () => driver);
  const show = vi.fn(async () => {});
  const runtime: PublishRuntime = { adapter: (p) => (p === adapter.key ? adapter : undefined), open, show };
  const root = makeLibrary();
  addContent(root, '2026-10-24-a', `id: ${XHS_ID}\ntitle: 甲\nstage: variants\ncreated: "2026-10-24"`);
  // libFixture.addContent 只写 content.md；变体文件直接落盘（与 variants.saveVariant 同构）
  mkdirSync(path.join(root, '2026-10-24-a', 'platforms'), { recursive: true });
  writeFileSync(path.join(root, '2026-10-24-a', 'platforms', 'xiaohongshu.md'),
    `---\nplatform: xiaohongshu\ntitle: 变体标题\ntopics: []\nupdated: "2026-10-24"\n---\n${'字'.repeat(650)}`, 'utf8');
  const svc = new PublishService({ root: () => root, runtime, emit: (e) => events.push(e), minIntervalMs: opts.minIntervalMs ?? 0 });
  const last = (): PublishTask => events[events.length - 1]!.task;
  return { svc, events, last, open, show, adapter, root };
}

describe('PublishService（spec §6：串行限速/三分类/防覆盖映射）', () => {
  it('全链相位 queued→validating→login_check→injecting→reading_back→prepared，变体路径与回读落任务', async () => {
    const h = harness(fakeAdapter());
    const r = h.svc.createTask(XHS_ID, 'xiaohongshu');
    expect(r.ok).toBe(true);
    await h.svc.run((r as { task: PublishTask }).task.taskId);
    const phases = h.events.map((e) => e.task.phase);
    expect(phases[phases.length - 1]).toBe('prepared');
    for (const p of ['queued', 'validating', 'login_check', 'injecting', 'reading_back', 'prepared']) expect(phases).toContain(p);
    const t = h.last();
    expect(t.draftUrl).toContain('xiaohongshu.com');
    expect(t.readBack).toMatchObject({ title: 't', bodyChars: 10 });
    expect(t.variantPath).toContain('platforms/xiaohongshu.md');
  });
  it('变体不存在/未过校验 → failed(validation)，绝不进入注入', async () => {
    const h = harness(fakeAdapter());
    const r = await h.svc.createTask('c_20261024_bb02', 'xiaohongshu'); // 内容不存在
    expect(r.ok).toBe(true);
    await h.svc.run((r as { task: PublishTask }).task.taskId);
    expect(h.last()).toMatchObject({ phase: 'failed', category: 'validation' });
    expect(h.adapter.injectDraft).not.toHaveBeenCalled();
  });
  it('未登录 → failed(not_logged_in)；页面结构变更 → failed(page_changed)；防覆盖 → failed(already_has_content)', async () => {
    const noLogin = harness(fakeAdapter({ loginCheck: vi.fn(async () => ({ loggedIn: false, message: '请先登录' })) }));
    const t1 = (await noLogin.svc.createTask(XHS_ID, 'xiaohongshu') as { task: PublishTask }).task;
    await noLogin.svc.run(t1.taskId);
    expect(noLogin.last()).toMatchObject({ phase: 'failed', category: 'not_logged_in', message: '请先登录' });

    const changed = harness(fakeAdapter({ injectDraft: vi.fn(async () => ({ ok: false, code: 'PAGE_CHANGED', message: 'm' })) }));
    const t2 = (await changed.svc.createTask(XHS_ID, 'xiaohongshu') as { task: PublishTask }).task;
    await changed.svc.run(t2.taskId);
    expect(changed.last()).toMatchObject({ phase: 'failed', category: 'page_changed' });

    const guard = harness(fakeAdapter({ injectDraft: vi.fn(async () => ({ ok: false, code: 'ALREADY_HAS_CONTENT', message: '已有内容' })) }));
    const t3 = (await guard.svc.createTask(XHS_ID, 'xiaohongshu') as { task: PublishTask }).task;
    await guard.svc.run(t3.taskId);
    expect(guard.last()).toMatchObject({ phase: 'failed', category: 'already_has_content' });
  });
  it('平台间串行：第二个任务等第一个完成才执行；最小间隔生效', async () => {
    let release!: () => void;
    const slow = fakeAdapter({ injectDraft: vi.fn(() => new Promise((res) => { release = () => res({ ok: true, warnings: [] }); })) });
    const h = harness(slow, { minIntervalMs: 50 });
    const t1 = (await h.svc.createTask(XHS_ID, 'xiaohongshu') as { task: PublishTask }).task;
    const t2 = (await h.svc.createTask(XHS_ID, 'xiaohongshu') as { task: PublishTask }).task;
    const p1 = h.svc.run(t1.taskId);
    const p2 = h.svc.run(t2.taskId);
    await new Promise((r) => setTimeout(r, 20));
    expect((slow.injectDraft as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1); // 串行：第二个未开始
    release();
    await p1; await p2;
    expect((slow.injectDraft as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
  it('retry 重跑失败任务；checkLogin 不建任务；showView 透传', async () => {
    const h = harness(fakeAdapter({ injectDraft: vi.fn(async () => ({ ok: false, code: 'NETWORK', message: '断网' })) }));
    const t = (await h.svc.createTask(XHS_ID, 'xiaohongshu') as { task: PublishTask }).task;
    await h.svc.run(t.taskId);
    expect(h.last().category).toBe('network');
    (h.adapter.injectDraft as ReturnType<typeof vi.fn>).mockImplementation(async () => ({ ok: true, draftUrl: 'u', warnings: [] }));
    h.svc.retry(t.taskId);
    await new Promise((r) => setTimeout(r, 10));
    await vi.waitFor(() => expect(h.last().phase).toBe('prepared'));
    expect(await h.svc.checkLogin('xiaohongshu')).toEqual({ loggedIn: true });
    await h.svc.showView('xiaohongshu', true);
    expect(h.show).toHaveBeenCalledWith('xiaohongshu', true);
  });
  it('api 平台（usesSession=false）不调 runtime.open：checkLogin/execute 传空驱动，全链到 prepared 且无回读', async () => {
    const api = fakeAdapter({
      key: 'wechat-article',
      rules: { key: 'wechat-article', label: '公众号文章', mode: 'api', notes: [], validate: () => ({ ok: true, errors: [], warnings: [] }) },
      usesSession: false,
      injectDraft: vi.fn(async () => ({ ok: true, mediaId: 'e2e-draft-1', warnings: [] })),
    });
    const h = harness(api);
    // wechat-article 变体需过其平台规则（封面必填；fake 适配器不读文件，只校验 doc）
    writeFileSync(path.join(h.root, '2026-10-24-a', 'platforms', 'wechat-article.md'),
      '---\nplatform: wechat-article\ntitle: 变体标题\ntopics: []\ncover: assets/cover.png\nupdated: "2026-10-24"\n---\n公众号正文', 'utf8');
    expect(await h.svc.checkLogin('wechat-article')).toEqual({ loggedIn: true });
    expect(h.open).not.toHaveBeenCalled();
    const r = h.svc.createTask(XHS_ID, 'wechat-article');
    expect(r.ok).toBe(true);
    await h.svc.run((r as { task: PublishTask }).task.taskId);
    expect(h.last()).toMatchObject({ phase: 'prepared', mediaId: 'e2e-draft-1' });
    expect(h.open).not.toHaveBeenCalled(); // ElectronPublishRuntime 对无编辑器平台 open 即 throw——服务必须按 usesSession 分流（e2e 前的回归闸）
    expect(h.adapter.readBackStatus).not.toHaveBeenCalled(); // api 模式无页面回读
  });
});
```

`tests/unit/domain-tools.test.ts` 追加（Task 2 后工具数组第 6 位）：
```ts
  it('create_publish_task 只建任务不注入（回调可注入）；CreateTaskResult 失败如实 isError，服务未接时 isError', async () => {
    const created: [string, string][] = [];
    const pi = await loadPi(); const T = await loadTypebox();
    const ts = await buildDomainTools(pi, T, {
      root: makeLibrary(), askUser: async () => 'x',
      createPublishTask: (id: string, p: string) => { // 与 PublishService.createTask 同形：无适配器平台（M4）返回 ok:false
        created.push([id, p]);
        return p === 'xiaohongshu'
          ? { ok: true as const, task: { taskId: 't_1', contentId: id, platform: 'xiaohongshu', phase: 'queued', updatedAt: 't' } }
          : { ok: false as const, code: 'PUBLISH_PLATFORM_UNSUPPORTED', message: `平台 ${p} 的发布适配器暂未提供` };
      },
    });
    const r = await exec(ts[5]!, { id: ID, platform: 'xiaohongshu' });
    expect(r.content[0]?.text).toContain('发布任务已创建');
    expect(created).toEqual([[ID, 'xiaohongshu']]);
    const unsupported = await exec(ts[5]!, { id: ID, platform: 'jike' }); // 无适配器平台 → 服务端拒绝路径
    expect(unsupported.isError).toBe(true);                               // 绝不谎报「已创建」
    expect(unsupported.content[0]?.text).toContain('PUBLISH_PLATFORM_UNSUPPORTED');
    expect(created).toEqual([[ID, 'xiaohongshu'], [ID, 'jike']]);
    const ts2 = await buildDomainTools(pi, T, { root: makeLibrary(), askUser: async () => 'x' });
    const bad = await exec(ts2[5]!, { id: ID, platform: 'xiaohongshu' });
    expect(bad.isError).toBe(true);
  }, 30_000);
```

- [ ] **Step 2: 确认失败 → 实现 `src/main/publish/publish-service.ts`**

```ts
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { listContents } from '../content-library';
import { readVariant } from '../variants';
import { validateVariant } from '../../shared/platform-rules';
import { classifyFailure, type PageDriver, type PlatformAdapter } from './adapter';
import type { PlatformKey, PublishEventOut, PublishTask } from '../../shared/types';

export type PublishRuntime = {
  adapter(platform: PlatformKey): PlatformAdapter | undefined;
  open(platform: PlatformKey): Promise<PageDriver>;
  show(platform: PlatformKey, visible: boolean): Promise<void>;
};
export type CreateTaskResult = { ok: true; task: PublishTask } | { ok: false; code: string; message: string };

function msg(err: unknown): string { return err instanceof Error ? err.message : String(err); }

/** api 平台（usesSession=false）无页面：空驱动占位——API 适配器约定不使用 driver，误用即显式报错。 */
const noPageDriver: PageDriver = {
  evaluate: async () => { throw new Error('API 平台无页面会话，driver 不可用'); },
  currentUrl: () => '',
};

/** 发布编排（spec §6）：选内容+平台→变体确认（本地校验先行）→登录探测→注入（全局串行+限速）→停在草稿态→回读。 */
export class PublishService {
  private readonly tasks = new Map<string, PublishTask>();
  private chain: Promise<void> = Promise.resolve();
  private lastRunAt = 0;
  private readonly minIntervalMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: {
    root(): string | null; runtime: PublishRuntime; emit(ev: PublishEventOut): void;
    minIntervalMs?: number; now?: () => number;
  }) {
    this.minIntervalMs = deps.minIntervalMs ?? Number(process.env.CONTENTDECK_PUBLISH_MIN_INTERVAL_MS ?? 15_000);
    this.now = deps.now ?? Date.now;
  }

  /** spec §5：只建任务，不触发注入（注入由人在发布中心发起）。 */
  createTask(contentId: string, platform: PlatformKey): CreateTaskResult {
    if (!this.deps.runtime.adapter(platform)) return { ok: false, code: 'PUBLISH_PLATFORM_UNSUPPORTED', message: `平台 ${platform} 的发布适配器暂未提供` };
    if (!this.deps.root()) return { ok: false, code: 'NO_LIBRARY', message: '尚未选择内容库' };
    const task: PublishTask = {
      taskId: `t_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`,
      contentId, platform, phase: 'queued', updatedAt: new Date().toISOString(),
    };
    this.tasks.set(task.taskId, task);
    this.emit(task);
    return { ok: true, task };
  }

  list(): PublishTask[] { return [...this.tasks.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  task(taskId: string): PublishTask | undefined { return this.tasks.get(taskId); }

  async checkLogin(platform: PlatformKey): Promise<{ loggedIn: boolean; message?: string }> {
    const adapter = this.deps.runtime.adapter(platform);
    if (!adapter) return { loggedIn: false, message: '平台暂不支持' };
    try { return await adapter.loginCheck(await this.openDriver(adapter, platform)); }
    catch (err) { return { loggedIn: false, message: msg(err) }; }
  }

  /** dom 平台（usesSession=true）才开页面会话；api 平台（公众号文章等）无内嵌编辑器，跳过 runtime.open 传空驱动。 */
  private async openDriver(adapter: PlatformAdapter, platform: PlatformKey): Promise<PageDriver> {
    return adapter.usesSession ? await this.deps.runtime.open(platform) : noPageDriver;
  }

  async showView(platform: PlatformKey, visible: boolean): Promise<void> { await this.deps.runtime.show(platform, visible); }

  /** 全局串行互斥链 + 相邻执行最小间隔（spec §6 平台间限速串行注入）。 */
  run(taskId: string): Promise<void> {
    const next = this.chain.then(async () => {
      const wait = this.lastRunAt + this.minIntervalMs - this.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRunAt = this.now();
      await this.execute(taskId);
    });
    this.chain = next.catch(() => {}); // 链不断：单任务失败不影响其他平台/任务
    return next;
  }

  retry(taskId: string): void {
    const t = this.tasks.get(taskId);
    if (!t || t.phase !== 'failed') return;
    t.phase = 'queued'; t.category = undefined; t.message = undefined;
    this.emit(t);
    void this.run(taskId);
  }

  private emit(t: PublishTask): void {
    t.updatedAt = new Date().toISOString();
    this.deps.emit({ kind: 'task_update', task: { ...t } });
  }

  private async execute(taskId: string): Promise<void> {
    const t = this.tasks.get(taskId);
    if (!t) return;
    const adapter = this.deps.runtime.adapter(t.platform);
    const root = this.deps.root();
    if (!adapter || !root) return this.fail(t, 'validation', !root ? '尚未选择内容库' : '平台适配器不可用');
    try {
      t.phase = 'validating'; this.emit(t);
      const scan = await listContents(root);
      const meta = scan.items.find((m) => m.id === t.contentId);
      if (!meta) return this.fail(t, 'validation', `内容不存在: ${t.contentId}`);
      const doc = await readVariant(root, t.contentId, t.platform);
      if (!doc) return this.fail(t, 'validation', `变体不存在：请先在变体工作台生成并保存 ${adapter.rules.label} 变体`);
      const v = validateVariant(t.platform, doc);
      if (!v.ok) return this.fail(t, 'validation', `变体未通过本地规则校验：${v.errors.join('；')}`);
      t.variantPath = `${meta.folder}/platforms/${t.platform}.md`;

      t.phase = 'login_check'; this.emit(t);
      const driver = await this.openDriver(adapter, t.platform);
      const login = await adapter.loginCheck(driver);
      if (!login.loggedIn) return this.fail(t, 'not_logged_in', login.message ?? '请先登录平台');

      t.phase = 'injecting'; this.emit(t);
      const r = await adapter.injectDraft(driver, { doc, variantPath: t.variantPath, contentFolder: path.join(root, meta.folder) });
      if (!r.ok) return this.fail(t, classifyFailure(r.code), `${r.message}`);
      t.draftUrl = r.draftUrl; t.mediaId = r.mediaId; t.message = r.warnings.length ? r.warnings.join('；') : undefined;

      if (adapter.usesSession) {
        t.phase = 'reading_back'; this.emit(t);
        const rb = await adapter.readBackStatus(driver);
        if (rb.ok) t.readBack = { title: rb.title, bodyChars: rb.bodyChars, url: rb.url ?? driver.currentUrl() };
        else t.message = `草稿已注入但回读失败：${rb.message}`;
      }
      t.phase = 'prepared'; this.emit(t); // 停在草稿态（spec §6：人工在平台点发布）
    } catch (err) {
      const code = (err as { code?: string })?.code;
      this.fail(t, code ? classifyFailure(code) : 'unknown', msg(err));
    }
  }

  private fail(t: PublishTask, category: PublishTask['category'], message: string): void {
    t.category = category; t.message = message; t.phase = 'failed'; this.emit(t);
  }
}
```

`src/main/agent/domain-tools.ts` 追加（`TOOL_NAMES` 增 `'create_publish_task'`；deps 增 `createPublishTask?: (contentId: string, platform: string) => CreateTaskResult`——顶部 `import type { CreateTaskResult } from '../publish/publish-service'`；返回数组追加）：
```ts
  const createPublishTaskTool = pi.defineTool({
    name: 'create_publish_task',
    label: '创建发布任务',
    description: '为内容创建一个平台发布任务（只建任务，绝不触发注入——注入由用户在发布中心手动发起）。',
    parameters: T.Type.Object({
      id: T.Type.String(),
      platform: T.Type.String({ description: 'xiaohongshu | wechat-article' }),
    }),
    annotations: { readOnlyHint: true },
    async execute(_id, params) {
      try { assertPlatform(params.platform); } catch { return textErr(`create_publish_task 失败：未知平台 ${params.platform}`); }
      if (!deps.createPublishTask) return textErr('create_publish_task 失败：发布服务尚未就绪');
      const r = deps.createPublishTask(params.id, params.platform);
      if (!r.ok) return textErr(`create_publish_task 失败（${r.code}）：${r.message}`); // 无适配器平台（x/jike）等失败如实反馈，绝不谎报「已创建」
      return text(`发布任务已创建（${params.platform}，只建任务不注入）；请在发布中心确认变体并手动发起注入`);
    },
  });
```
（注意：`assertPlatform` 允许四平台建任务，但 M3 只有 xiaohongshu/wechat-article 有适配器——`PublishService.createTask` 对无适配器平台返回 `PUBLISH_PLATFORM_UNSUPPORTED`；**`deps.createPublishTask` 必须把 `CreateTaskResult` 原样返回给工具**（Task 6 ipc 装配即 `createPublishTask: (id, p) => publishService().createTask(id, p as PlatformKey)`，不得吞掉返回值），工具对 `ok:false` 以 `isError` 呈现——「工具文案因此如实反馈」由该接线成立。本计划采用 `assertPlatform` 四平台 + 服务端拒绝 + 结果回传，与「能力可选化」一致。**对应地 Task 5 的 domain-tools 测试补无适配器平台的失败路径断言。**）

`src/main/agent/real-session.ts`：`RealSessionFactoryDeps` 增 `createPublishTask?: (contentId: string, platform: string) => CreateTaskResult`（`import type { CreateTaskResult } from '../publish/publish-service'`），`buildDomainTools(pi, T, { root, askUser, ...(deps.createPublishTask ? { createPublishTask: deps.createPublishTask } : {}) })`（Task 6 在 ipc 装配处传入）。

- [ ] **Step 3: 通过 + typecheck**

```bash
npx vitest run tests/unit/publish-service.test.ts tests/unit/domain-tools.test.ts
npm run typecheck && npm test
```

- [ ] **Step 4: Commit** `git commit -m "feat(m3): PublishService 发布编排（串行限速/三分类/回读）与 create_publish_task 领域工具"`

---

### Task 6: IPC 通道 + preload + 渲染桥 + 主进程装配

**Files:**
- Modify: `src/main/ipc.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/lib/bridge.ts`（类型）
- Create: `src/renderer/lib/publish-bridge.ts`

**Interfaces:**
- Produces（渲染端唯一 variant/publish 入口，Task 7 UI 依赖）:
  ```ts
  window.studio.variant = {
    read(contentId, platform): Promise<VariantDoc | null>;
    save(contentId, platform, input): Promise<{ ok: true; savedAt: string } | { ok: false; code: string; message: string }>;
    list(contentId): Promise<PlatformKey[]>;
    applyDraft(contentId, platform, name): Promise<{ ok: true; savedAt: string } | { ok: false; code: string; message: string }>;
  };
  window.studio.publish = {
    tasks(): Promise<PublishTask[]>;
    createTask(contentId, platform): Promise<{ ok: true; task: PublishTask } | { ok: false; code: string; message: string }>;
    run(taskId): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
    retry(taskId): Promise<{ ok: true }>;
    checkLogin(platform): Promise<{ loggedIn: boolean; message?: string }>;
    showView(platform, visible): Promise<{ ok: true }>;
    getWechatConfig(): Promise<{ config: WechatMpConfigView | null }>;
    setWechatConfig(input: { appid: string; secret: string }): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
    onEvent(cb: (ev: PublishEventOut) => void): () => void;
  };
  ```
- 主→渲染事件：`studio:publish:event`。env 注入：`CONTENTDECK_XHS_EDITOR_URL`（fixture/自定编辑器地址）、`CONTENTDECK_WECHAT_API_BASE`（mock/代理 API 基址）、`CONTENTDECK_PUBLISH_MIN_INTERVAL_MS`。

- [ ] **Step 1: `src/main/ipc.ts` 增量实现（M1/M2 通道原样保留）**

在既有 import 之后追加，并在 `registerIpc()` 末尾追加通道注册：
```ts
import { readVariant, saveVariant, listVariants, applyVariantDraft, assertPlatform } from './variants';
import { PublishService, type PublishRuntime } from './publish/publish-service';
import { PlatformSession } from './publish/platform-session';
import { xiaohongshuAdapter, createWechatArticleAdapter } from './publish/adapter';
import { WechatMpClient } from './publish/wechat-mp';
import {
  makeSafeStorageCodec, setSecretCodec, getWechatCredentials, setWechatCredentials, wechatCredentialsView,
} from './publish/wechat-credentials';
import { safeStorage } from 'electron';
import { PLATFORM_RULES } from '../shared/platform-rules';
import type { PlatformKey, PublishEventOut } from '../shared/types';

// —— 发布运行时装配（electron 专属层；单测不 import 本段）——
class ElectronPublishRuntime implements PublishRuntime {
  private readonly sessions = new Map<string, PlatformSession>();
  private readonly wechatAdapter = createWechatArticleAdapter({ client: () => wechatClient() });
  adapter(platform: PlatformKey) {
    if (platform === 'xiaohongshu') return xiaohongshuAdapter;
    if (platform === 'wechat-article') return this.wechatAdapter;
    return undefined; // x/jike 适配器 M4；变体规则本地已可用
  }
  private editorUrl(platform: PlatformKey): string {
    if (platform !== 'xiaohongshu') throw new Error('该平台无内嵌编辑器');
    return process.env.CONTENTDECK_XHS_EDITOR_URL
      ?? loadSettings().platforms?.xiaohongshuEditorUrl
      ?? PLATFORM_RULES.xiaohongshu.editorUrl!;
  }
  private allowedHosts(platform: PlatformKey): string[] {
    const hosts = new Set(['creator.xiaohongshu.com']);
    try { hosts.add(new URL(this.editorUrl(platform)).hostname); } catch { /* 非法覆盖地址会在 open 报错 */ }
    return [...hosts];
  }
  private session(platform: PlatformKey): PlatformSession {
    let s = this.sessions.get(platform);
    if (!s) { s = new PlatformSession(platform); this.sessions.set(platform, s); }
    return s;
  }
  async open(platform: PlatformKey) { // 仅 dom 平台（usesSession=true）会被调用：PublishService 按 usesSession 分流，api 平台（公众号文章）无页面不经此处
    const s = this.session(platform);
    await s.open(this.editorUrl(platform), this.allowedHosts(platform));
    return { evaluate: <T>(fn: string, payload: unknown) => s.evaluate<T>(fn, payload), currentUrl: () => s.currentUrl() };
  }
  async show(platform: PlatformKey, visible: boolean) {
    const s = this.session(platform);
    await s.open(this.editorUrl(platform), this.allowedHosts(platform));
    s.attach(visible);
  }
  dispose() { for (const s of this.sessions.values()) s.dispose(); this.sessions.clear(); }
}

function wechatClient(): WechatMpClient | null {
  const cred = getWechatCredentials();
  if (!cred) return null;
  return new WechatMpClient(
    { getAppid: () => getWechatCredentials()?.appid ?? '', getSecret: () => getWechatCredentials()?.secret ?? '' },
    { baseUrl: process.env.CONTENTDECK_WECHAT_API_BASE || undefined },
  );
}

const runtime = new ElectronPublishRuntime();
let publish: PublishService | null = null;
function publishService(): PublishService {
  if (!publish) {
    publish = new PublishService({
      root: currentRoot,
      runtime,
      emit: (ev: PublishEventOut) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('studio:publish:event', ev); },
    });
  }
  return publish;
}
export function disposePublish(): void { runtime.dispose(); publish = null; }
```
`registerIpc()` 内 `agentService()` 的工厂依赖改为传入 `createPublishTask`（real-session 透传给领域工具）：
```ts
      createSession: createRealSessionFactory({
        root: currentRoot,
        skillsDir: () => (app.isPackaged ? path.join(process.resourcesPath, 'skills') : path.join(app.getAppPath(), 'skills')),
        createPublishTask: (contentId, platform) => publishService().createTask(contentId, platform as PlatformKey), // CreateTaskResult 原样回传给领域工具（失败如实 isError，不吞返回值）
      }),
```
`registerIpc()` 末尾追加通道：
```ts
  // ---- variant 域（读写只在用户动作路径；AI 走 save_variant 草稿区）----
  ipcMain.handle('studio:variant:read', (_e, contentId: string, platform: string) => { assertPlatform(platform); return readVariant(root(), contentId, platform); });
  ipcMain.handle('studio:variant:save', (_e, contentId: string, platform: string, input: { title: string; topics: string[]; body: string; digest?: string; cover?: string }) => {
    try { assertPlatform(platform); return { ok: true as const, ...saveVariant(root(), contentId, platform, input) }; }
    catch (err) { return fail(err); }
  });
  ipcMain.handle('studio:variant:list', (_e, contentId: string) => listVariants(root(), contentId));
  ipcMain.handle('studio:variant:applyDraft', (_e, contentId: string, platform: string, name: string) => {
    try { assertPlatform(platform); return { ok: true as const, ...applyVariantDraft(root(), contentId, platform, name) }; }
    catch (err) { return fail(err); }
  });

  // ---- publish 域（spec §5/§6：注入只由人发起；凭证脱敏）----
  ipcMain.handle('studio:publish:tasks', () => publishService().list());
  ipcMain.handle('studio:publish:createTask', (_e, contentId: string, platform: string) => {
    try { assertPlatform(platform); return publishService().createTask(contentId, platform); }
    catch (err) { return fail(err); }
  });
  ipcMain.handle('studio:publish:run', async (_e, taskId: string) => {
    try { await publishService().run(taskId); return { ok: true as const }; }
    catch (err) { return fail(err); }
  });
  ipcMain.handle('studio:publish:retry', (_e, taskId: string) => { publishService().retry(taskId); return { ok: true as const }; });
  ipcMain.handle('studio:publish:checkLogin', (_e, platform: string) => {
    try { assertPlatform(platform); return publishService().checkLogin(platform); }
    catch (err) { return fail(err); }
  });
  ipcMain.handle('studio:publish:showView', async (_e, platform: string, visible: boolean) => {
    try { assertPlatform(platform); await publishService().showView(platform, visible); return { ok: true as const }; }
    catch (err) { return fail(err); }
  });
  ipcMain.handle('studio:publish:getWechatConfig', () => ({ config: wechatCredentialsView() }));
  ipcMain.handle('studio:publish:setWechatConfig', (_e, input: { appid: string; secret: string }) => {
    try { setWechatCredentials(input); return { ok: true as const }; }
    catch (err) { return fail(err); }
  });
```
`registerIpc()` 开头（`getSettings` 注册前）装配 safeStorage 编解码：
```ts
  const { codec, encrypted } = makeSafeStorageCodec(safeStorage);
  setSecretCodec(codec, encrypted);
```

- [ ] **Step 2: `src/main/index.ts` 一行改动**

```ts
import { registerIpc, disposeAgent, disposePublish } from './ipc';
// will-quit：
app.on('will-quit', () => { disposeAgent(); disposePublish(); });
```

- [ ] **Step 3: `src/preload/index.ts` 追加（既有内容不动，`exposeInMainWorld` 的对象里增两个子对象）**

```ts
import type { PublishEventOut, VariantDoc, WechatMpConfigView } from '../shared/types';
// …contextBridge.exposeInMainWorld('studio', { …既有…,
  variant: {
    read: (contentId: string, platform: string) => ipcRenderer.invoke('studio:variant:read', contentId, platform),
    save: (contentId: string, platform: string, input: { title: string; topics: string[]; body: string; digest?: string; cover?: string }) => ipcRenderer.invoke('studio:variant:save', contentId, platform, input),
    list: (contentId: string) => ipcRenderer.invoke('studio:variant:list', contentId),
    applyDraft: (contentId: string, platform: string, name: string) => ipcRenderer.invoke('studio:variant:applyDraft', contentId, platform, name),
  },
  publish: {
    tasks: () => ipcRenderer.invoke('studio:publish:tasks'),
    createTask: (contentId: string, platform: string) => ipcRenderer.invoke('studio:publish:createTask', contentId, platform),
    run: (taskId: string) => ipcRenderer.invoke('studio:publish:run', taskId),
    retry: (taskId: string) => ipcRenderer.invoke('studio:publish:retry', taskId),
    checkLogin: (platform: string) => ipcRenderer.invoke('studio:publish:checkLogin', platform),
    showView: (platform: string, visible: boolean) => ipcRenderer.invoke('studio:publish:showView', platform, visible),
    getWechatConfig: () => ipcRenderer.invoke('studio:publish:getWechatConfig'),
    setWechatConfig: (input: { appid: string; secret: string }) => ipcRenderer.invoke('studio:publish:setWechatConfig', input),
    onEvent: (cb: (ev: PublishEventOut) => void) => {
      const listener = (_e: unknown, ev: PublishEventOut) => cb(ev);
      ipcRenderer.on('studio:publish:event', listener);
      return () => { ipcRenderer.removeListener('studio:publish:event', listener); };
    },
  },
// });
```

- [ ] **Step 4: `src/renderer/lib/publish-bridge.ts`（惰性，同 agent-bridge 模式）**

```ts
import type { PlatformKey, PublishEventOut, PublishTask, VariantDoc, WechatMpConfigView } from '../../shared/types';

export type VariantBridge = {
  read(contentId: string, platform: PlatformKey): Promise<VariantDoc | null>;
  save(contentId: string, platform: PlatformKey, input: { title: string; topics: string[]; body: string; digest?: string; cover?: string }): Promise<{ ok: true; savedAt: string } | { ok: false; code: string; message: string }>;
  list(contentId: string): Promise<PlatformKey[]>;
  applyDraft(contentId: string, platform: PlatformKey, name: string): Promise<{ ok: true; savedAt: string } | { ok: false; code: string; message: string }>;
};
export type PublishBridge = {
  tasks(): Promise<PublishTask[]>;
  createTask(contentId: string, platform: PlatformKey): Promise<{ ok: true; task: PublishTask } | { ok: false; code: string; message: string }>;
  run(taskId: string): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  retry(taskId: string): Promise<{ ok: true }>;
  checkLogin(platform: PlatformKey): Promise<{ loggedIn: boolean; message?: string }>;
  showView(platform: PlatformKey, visible: boolean): Promise<{ ok: true }>;
  getWechatConfig(): Promise<{ config: WechatMpConfigView | null }>;
  setWechatConfig(input: { appid: string; secret: string }): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  onEvent(cb: (ev: PublishEventOut) => void): () => void;
};

function api() {
  const v = window.studio.variant; const p = window.studio.publish;
  if (!v || !p) throw new Error('window.studio.variant/publish 不可用（preload 桥未注入）');
  return { v, p };
}
export const variantBridge: VariantBridge = {
  read: (id, p) => api().v.read(id, p),
  save: (id, p, input) => api().v.save(id, p, input),
  list: (id) => api().v.list(id),
  applyDraft: (id, p, n) => api().v.applyDraft(id, p, n),
};
export const publishBridge: PublishBridge = {
  tasks: () => api().p.tasks(),
  createTask: (id, p) => api().p.createTask(id, p),
  run: (t) => api().p.run(t),
  retry: (t) => api().p.retry(t),
  checkLogin: (p) => api().p.checkLogin(p),
  showView: (p, v) => api().p.showView(p, v),
  getWechatConfig: () => api().p.getWechatConfig(),
  setWechatConfig: (i) => api().p.setWechatConfig(i),
  onEvent: (cb) => api().p.onEvent(cb),
};
```
`src/renderer/lib/bridge.ts` 的 `StudioBridge` 追加可选字段（类型从 publish-bridge 导入，无循环引用——publish-bridge 不 import bridge）：
```ts
import type { VariantBridge, PublishBridge } from './publish-bridge';
// StudioBridge 内：
  variant?: VariantBridge;
  publish?: PublishBridge;
```

- [ ] **Step 5: 验证**

```bash
npm run typecheck && npm test    # 全绿（本任务无新用例；桥正确性由 Task 7/8 覆盖）
npm start   # 人工冒烟：devtools 执行 await window.studio.publish.tasks() → []
```

- [ ] **Step 6: Commit** `git commit -m "feat(m3): studio:variant:*/studio:publish:* IPC、preload/渲染双桥与主进程装配（safeStorage/URL 白名单/env 覆盖）"`

---

### Task 7: UI——变体工作台 + 发布中心 + 导航

**Files:**
- Create: `src/renderer/pages/VariantsPage.tsx`、`src/renderer/pages/PublishCenter.tsx`、`src/renderer/components/WechatSettingsModal.tsx`
- Modify: `src/renderer/App.tsx`、`src/renderer/pages/Board.tsx`（+发布中心按钮）、`src/renderer/pages/Editor.tsx`（+变体工作台按钮）、`src/renderer/components/AgentPanel.tsx`（+技能按钮+草稿区过滤变体草稿）、`src/renderer/styles.css`
- Test: `tests/renderer/VariantsPage.test.tsx`、`tests/renderer/PublishCenter.test.tsx`、`tests/renderer/AgentPanel.test.tsx`（追加用例）

**Interfaces:**
- Consumes: `variantBridge/publishBridge`（Task 6）、`agentBridge.onEvent`（drafts_changed 刷新）、Task 1 规则（渲染端直接 import `validateVariant/PLATFORM_RULES`——纯模块可入渲染 bundle）。
- Produces:
  - `VariantsPage({ initialContentId, onBack, onGoPublish })`：内容选择 + 四平台卡片（字段编辑/实时本地校验/保存；wechat-article 额外摘要+封面；x 无标题）+ 每平台变体草稿（`DraftSummary.platform` 匹配）「采纳入变体」+「去发布 <平台>」。
  - `PublishCenter({ initial, onBack })`：内容选择 + 平台卡片（小红书 dom / 公众号文章 api）+ 登录态探测（自动+手动）/「打开平台页」（视图区右侧）+ 变体确认面板（读变体+校验，errors 阻塞注入）+ 任务相位/分类/重试 + 公众号配置弹窗 + 风控提示常驻。
  - `WechatSettingsModal({ onClose })`：AppID/AppSecret（回显脱敏，未改用占位）。
  - 可达名（e2e 契约）：`变体工作台`、`发布中心`、`内容选择`、`发布内容选择`、`变体 小红书`/`变体 X（Twitter）`/`变体 即刻`/`变体 公众号文章`、`变体标题输入`、`变体话题输入`、`变体摘要输入`、`变体封面输入`、`变体正文输入`、`保存变体`、`采纳入变体 <name>`、`去发布 <平台label>`、`平台卡片 小红书`、`平台卡片 公众号文章`、`检查登录`、`打开平台页`、`隐藏平台页`、`注入草稿`、`重试注入`、`发布任务列表`、`公众号配置`、`AppID`、`AppSecret`、`保存配置`、`AI 生成变体提示`。

- [ ] **Step 1: 失败测试 `tests/renderer/VariantsPage.test.tsx`**

```tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { VariantsPage } from '../../src/renderer/pages/VariantsPage';
import type { ContentMeta, DraftSummary, VariantDoc } from '../../src/shared/types';

const mocks = vi.hoisted(() => ({
  listContents: vi.fn(async () => ({
    items: [{ id: 'c_1', title: '内容甲', stage: 'draft', tags: [], created: '2026-10-24', media: 'article', folder: 'f' } as ContentMeta],
    warnings: [],
  })),
  read: vi.fn(async (): Promise<VariantDoc | null> => null),
  save: vi.fn(async () => ({ ok: true as const, savedAt: 't' })),
  listDrafts: vi.fn(async () => [] as DraftSummary[]),
  applyDraft: vi.fn(async () => ({ ok: true as const, savedAt: 't' })),
}));
vi.mock('../../src/renderer/lib/bridge', () => ({ bridge: { listContents: mocks.listContents } }));
vi.mock('../../src/renderer/lib/agent-bridge', () => ({ agentBridge: { listDrafts: mocks.listDrafts, onEvent: () => () => {} } }));
vi.mock('../../src/renderer/lib/publish-bridge', () => ({
  variantBridge: { read: mocks.read, save: mocks.save, list: vi.fn(async () => []), applyDraft: mocks.applyDraft },
  publishBridge: { onEvent: () => () => {} },
}));
const draft: DraftSummary = { name: 'draft-20261024-120000-ab12.md', created: '2026-10-24T12:00:00Z', note: '变体:xiaohongshu', bytes: 10, platform: 'xiaohongshu' };

beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue(null); mocks.listDrafts.mockResolvedValue([]); });
// 四平台卡片同名字段并存（保存变体/标题输入等多实例）：一切查询 scope 在目标卡片内（within）
const xhsCard = async () => within(await screen.findByRole('region', { name: '变体 小红书' }));

describe('VariantsPage', () => {
  it('四平台卡片渲染；小红书卡实时校验：规则不过禁存，合规后可存', async () => {
    render(<VariantsPage initialContentId="c_1" onBack={() => {}} onGoPublish={() => {}} />);
    const c = await xhsCard();
    expect(screen.getByRole('region', { name: '变体 公众号文章' })).toBeInTheDocument();
    fireEvent.change(c.getByLabelText('变体标题输入'), { target: { value: '超过二十个字的标题一定超过二十个字的标题呀' } });
    fireEvent.change(c.getByLabelText('变体正文输入'), { target: { value: '短' } });
    expect(await c.findByText(/20 字上限/)).toBeInTheDocument();
    expect(c.getByRole('button', { name: '保存变体' })).toBeDisabled();
    fireEvent.change(c.getByLabelText('变体标题输入'), { target: { value: '合规标题' } });
    fireEvent.change(c.getByLabelText('变体正文输入'), { target: { value: '字'.repeat(650) } });
    await waitFor(() => expect(c.getByRole('button', { name: '保存变体' })).toBeEnabled());
  });
  it('已保存变体回显；保存调用 variantBridge.save（话题按顿号拆数组）', async () => {
    mocks.read.mockResolvedValue({ platform: 'xiaohongshu', title: '旧标题', topics: ['旧话题'], body: '旧正文' } as VariantDoc);
    render(<VariantsPage initialContentId="c_1" onBack={() => {}} onGoPublish={() => {}} />);
    const c = await xhsCard();
    await waitFor(() => expect(c.getByLabelText('变体标题输入')).toHaveValue('旧标题'));
    fireEvent.click(c.getByRole('button', { name: '保存变体' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('c_1', 'xiaohongshu', expect.objectContaining({ title: '旧标题', topics: ['旧话题'] })));
  });
  it('AI 变体草稿按平台展示，采纳入变体调用 applyDraft', async () => {
    mocks.listDrafts.mockResolvedValue([draft]);
    render(<VariantsPage initialContentId="c_1" onBack={() => {}} onGoPublish={() => {}} />);
    const c = await xhsCard();
    fireEvent.click(await c.findByRole('button', { name: `采纳入变体 ${draft.name}` }));
    await waitFor(() => expect(mocks.applyDraft).toHaveBeenCalledWith('c_1', 'xiaohongshu', draft.name));
  });
  it('去发布按钮携带内容与平台回调', async () => {
    const go = vi.fn();
    render(<VariantsPage initialContentId="c_1" onBack={() => {}} onGoPublish={go} />);
    const c = await xhsCard();
    fireEvent.click(c.getByRole('button', { name: '去发布 小红书' }));
    expect(go).toHaveBeenCalledWith('c_1', 'xiaohongshu');
  });
});
```

`tests/renderer/PublishCenter.test.tsx`：
```tsx
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { PublishCenter } from '../../src/renderer/pages/PublishCenter';
import type { ContentMeta, PublishTask, VariantDoc } from '../../src/shared/types';

const state = { onEvent: null as null | ((ev: never) => void) };
const mocks = vi.hoisted(() => ({
  listContents: vi.fn(async () => ({ items: [{ id: 'c_1', title: '内容甲', stage: 'variants', tags: [], created: '2026-10-24', media: 'article', folder: 'f' } as ContentMeta], warnings: [] })),
  read: vi.fn(async (): Promise<VariantDoc | null> => null),
  tasks: vi.fn(async () => [] as PublishTask[]),
  createTask: vi.fn(async () => ({ ok: true as const, task: { taskId: 't1', contentId: 'c_1', platform: 'xiaohongshu', phase: 'queued', updatedAt: 't' } })),
  run: vi.fn(async () => ({ ok: true as const })),
  retry: vi.fn(async () => ({ ok: true as const })),
  checkLogin: vi.fn(async () => ({ loggedIn: true })),
  showView: vi.fn(async () => ({ ok: true as const })),
  getWechatConfig: vi.fn(async () => ({ config: null })),
  setWechatConfig: vi.fn(async () => ({ ok: true as const })),
  onEvent: (cb: (ev: never) => void) => { state.onEvent = cb; return () => { state.onEvent = null; }; },
}));
vi.mock('../../src/renderer/lib/bridge', () => ({ bridge: { listContents: mocks.listContents } }));
vi.mock('../../src/renderer/lib/publish-bridge', () => ({
  variantBridge: { read: mocks.read, save: vi.fn(), list: vi.fn(async () => []), applyDraft: vi.fn() },
  publishBridge: {
    tasks: mocks.tasks, createTask: mocks.createTask, run: mocks.run, retry: mocks.retry,
    checkLogin: mocks.checkLogin, showView: mocks.showView,
    getWechatConfig: mocks.getWechatConfig, setWechatConfig: mocks.setWechatConfig, onEvent: mocks.onEvent,
  },
}));

beforeEach(() => { vi.clearAllMocks(); state.onEvent = null; mocks.tasks.mockResolvedValue([]); mocks.read.mockResolvedValue(null); mocks.checkLogin.mockResolvedValue({ loggedIn: true }); });

const emit = (ev: unknown) => state.onEvent?.(ev as never);
// 内容列表异步加载后才可选中；选中后触发登录探测与变体读取
const selectContent = async () => {
  await screen.findByRole('option', { name: '内容甲' });
  fireEvent.change(screen.getByLabelText('发布内容选择'), { target: { value: 'c_1' } });
};
const xhs = () => within(screen.getByRole('region', { name: '平台卡片 小红书' }));

describe('PublishCenter', () => {
  it('平台卡片与风控提示常驻；未选内容时注入禁用并提示先生成变体', async () => {
    render(<PublishCenter onBack={() => {}} />);
    expect(screen.getByText(/只注入草稿，最终发布由你在平台编辑器手动完成/)).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: '平台卡片 小红书' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '平台卡片 公众号文章' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '注入草稿' })).toBeDisabled();
    expect(screen.getByText(/先在变体工作台/)).toBeInTheDocument();
  });
  it('变体缺失时注入禁用；合法变体+已就绪 → 注入调用 createTask+run，事件驱动相位到 prepared 并回读可见', async () => {
    render(<PublishCenter onBack={() => {}} />);
    await selectContent();
    expect(screen.getByRole('button', { name: '注入草稿' })).toBeDisabled(); // read=null → 变体不存在
    mocks.read.mockResolvedValue({ platform: 'xiaohongshu', title: '标题', topics: [], body: '字'.repeat(650) } as VariantDoc);
    fireEvent.change(screen.getByLabelText('发布内容选择'), { target: { value: '' } }); // 重新触达变体读取
    await selectContent();
    await waitFor(() => expect(xhs().getByRole('button', { name: '注入草稿' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '注入草稿' }));
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledWith('c_1', 'xiaohongshu'));
    await waitFor(() => expect(mocks.run).toHaveBeenCalledWith('t1'));
    emit({ kind: 'task_update', task: { taskId: 't1', contentId: 'c_1', platform: 'xiaohongshu', phase: 'injecting', updatedAt: 't' } });
    expect(await screen.findByText('注入中')).toBeInTheDocument();
    emit({ kind: 'task_update', task: { taskId: 't1', contentId: 'c_1', platform: 'xiaohongshu', phase: 'prepared', draftUrl: 'https://u', readBack: { title: '标题', bodyChars: 654, url: 'https://u' }, updatedAt: 't' } });
    expect(await screen.findByText('已停在草稿态')).toBeInTheDocument();
    expect(screen.getByText(/回读：标题「标题」/)).toBeInTheDocument();
  });
  it('失败三分类：not_logged_in 任务呈现未登录分类、可打开平台页登录引导、可重试', async () => {
    mocks.read.mockResolvedValue({ platform: 'xiaohongshu', title: '标题', topics: [], body: '字'.repeat(650) } as VariantDoc);
    render(<PublishCenter onBack={() => {}} />);
    await selectContent();
    await waitFor(() => expect(screen.getByRole('button', { name: '注入草稿' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '注入草稿' }));
    emit({ kind: 'task_update', task: { taskId: 't1', contentId: 'c_1', platform: 'xiaohongshu', phase: 'failed', category: 'not_logged_in', message: '请先登录小红书', updatedAt: 't' } });
    expect(await screen.findByText('未登录')).toBeInTheDocument();          // 任务行分类标签
    expect(screen.getByText('请先登录小红书')).toBeInTheDocument();          // 失败消息
    fireEvent.click(screen.getByRole('button', { name: '打开平台页' }));    // 任务 not_logged_in → 登录引导可见
    await waitFor(() => expect(mocks.showView).toHaveBeenCalledWith('xiaohongshu', true));
    fireEvent.click(screen.getByRole('button', { name: '重试注入' }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith('t1'));
  });
  it('公众号配置弹窗：回显脱敏、未改密钥用占位保存', async () => {
    mocks.getWechatConfig.mockResolvedValue({ config: { appid: 'wx1', hasSecret: true, secretTail: '1234', encrypted: false } });
    render(<PublishCenter onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '公众号文章' })); // 切换到公众号卡片（确认面板仅活动卡片渲染）
    fireEvent.click(await screen.findByRole('button', { name: '公众号配置' }));
    expect(screen.getByLabelText('AppID')).toHaveValue('wx1');
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));   // Secret 已预填 KEEP 占位（回显时）
    await waitFor(() => expect(mocks.setWechatConfig).toHaveBeenCalledWith({ appid: 'wx1', secret: '__KEEP_SAVED_SECRET__' }));
  });
});
```

- [ ] **Step 2: 确认失败（页面组件不存在）→ 实现**

`src/renderer/components/WechatSettingsModal.tsx`：
```tsx
import { useEffect, useState } from 'react';
import { publishBridge } from '../lib/publish-bridge';
import { KEEP_WECHAT_SECRET } from '../../../shared/types';

export function WechatSettingsModal({ onClose }: { onClose: () => void }) {
  const [appid, setAppid] = useState('');
  const [secret, setSecret] = useState('');
  const [tail, setTail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void publishBridge.getWechatConfig().then(({ config }) => {
      if (!config) return;
      setAppid(config.appid);
      if (config.hasSecret) { setTail(config.secretTail); setSecret(KEEP_WECHAT_SECRET); }
    });
  }, []);
  const save = async () => {
    setBusy(true); setError(null);
    const r = await publishBridge.setWechatConfig({ appid, secret });
    setBusy(false);
    if (r.ok) onClose(); else setError(r.message);
  };
  return (
    <div className="modal-mask" role="dialog" aria-label="公众号配置">
      <div className="modal">
        <h2>公众号配置</h2>
        <label>AppID<input aria-label="AppID" value={appid} onChange={(e) => setAppid(e.target.value)} /></label>
        <label>AppSecret
          <input aria-label="AppSecret" type="password" value={secret} placeholder={tail ? `已保存（尾四位 ${tail}），留原值即沿用` : ''}
            onChange={(e) => setSecret(e.target.value)} />
        </label>
        {error && <p role="alert">{error}</p>}
        <button onClick={() => void save()} disabled={busy}>保存配置</button>
        <button onClick={onClose}>取消</button>
        <p className="hint">仅存本机用户数据目录（系统加密可用时加密存储）；正式调用需在公众号后台把本机出口 IP 加入白名单。</p>
      </div>
    </div>
  );
}
```

`src/renderer/pages/VariantsPage.tsx`：
```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { bridge } from '../lib/bridge';
import { agentBridge } from '../lib/agent-bridge';
import { variantBridge } from '../lib/publish-bridge';
import { PLATFORM_RULES, platformKeys, validateVariant } from '../../../shared/platform-rules';
import type { ContentMeta, DraftSummary, PlatformKey, VariantDoc } from '../../../shared/types';

type Draft = { title: string; topics: string; body: string; digest: string; cover: string };
const splitTopics = (s: string): string[] => s.split(/[、,，]/).map((t) => t.trim()).filter(Boolean);
const toDraft = (doc: VariantDoc | null): Draft => ({
  title: doc?.title ?? '', topics: (doc?.topics ?? []).join('、'), body: doc?.body ?? '',
  digest: doc?.digest ?? '', cover: doc?.cover ?? '',
});

export function VariantsPage({ initialContentId, onBack, onGoPublish }: {
  initialContentId?: string; onBack: () => void; onGoPublish: (contentId: string, platform: PlatformKey) => void;
}) {
  const [items, setItems] = useState<ContentMeta[]>([]);
  const [contentId, setContentId] = useState(initialContentId ?? '');
  const [docs, setDocs] = useState<Partial<Record<PlatformKey, Draft>>>({});
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [savedAt, setSavedAt] = useState<Partial<Record<PlatformKey, string>>>({});

  useEffect(() => { void bridge.listContents().then((s) => setItems(s.items)); }, []);
  const refresh = useCallback(async (id: string) => {
    const next: Partial<Record<PlatformKey, Draft>> = {};
    for (const p of platformKeys()) next[p] = toDraft(await variantBridge.read(id, p));
    setDocs(next);
    setDrafts((await agentBridge.listDrafts(id)).filter((d) => d.platform));
  }, []);
  useEffect(() => { if (contentId) void refresh(contentId); }, [contentId, refresh]);
  useEffect(() => agentBridge.onEvent((ev) => {
    if (ev.kind === 'drafts_changed' && ev.contentId === contentId) void refresh(contentId);
  }), [contentId, refresh]);

  const set = (p: PlatformKey, patch: Partial<Draft>) => setDocs((d) => ({ ...d, [p]: { ...(d[p] ?? toDraft(null)), ...patch } }));

  return (
    <div className="variants-page">
      <header className="page-header">
        <button onClick={onBack}>← 返回看板</button>
        <h1>变体工作台</h1>
        <select aria-label="内容选择" value={contentId} onChange={(e) => setContentId(e.target.value)}>
          <option value="">选择内容…</option>
          {items.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
      </header>
      {!contentId
        ? <p className="hint">先选择一篇内容。AI 生成入口在编辑器右侧「AI 助手 → 一稿多态转化」。</p>
        : <div className="variants-grid">
          {platformKeys().map((p) => <VariantCard key={p} platform={p} contentId={contentId} d={docs[p] ?? toDraft(null)}
            onChange={(patch) => set(p, patch)} savedAt={savedAt[p]}
            drafts={drafts.filter((x) => x.platform === p)}
            onAdopted={() => void refresh(contentId)}
            onGoPublish={() => onGoPublish(contentId, p)} setSavedAt={(t) => setSavedAt((s) => ({ ...s, [p]: t }))} />)}
        </div>}
    </div>
  );
}

function VariantCard({ platform, contentId, d, onChange, savedAt, drafts, onAdopted, onGoPublish, setSavedAt }: {
  platform: PlatformKey; contentId: string; d: Draft; onChange: (patch: Partial<Draft>) => void;
  savedAt?: string; drafts: DraftSummary[]; onAdopted: () => void; onGoPublish: () => void; setSavedAt: (t: string) => void;
}) {
  const rules = PLATFORM_RULES[platform];
  const v = useMemo(() => validateVariant(platform, {
    platform, title: d.title, topics: splitTopics(d.topics), body: d.body,
    ...(d.digest ? { digest: d.digest } : {}), ...(d.cover ? { cover: d.cover } : {}),
  }), [platform, d]);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    const r = await variantBridge.save(contentId, platform, {
      title: d.title, topics: splitTopics(d.topics), body: d.body,
      ...(d.digest ? { digest: d.digest } : {}), ...(d.cover ? { cover: d.cover } : {}),
    });
    if (r.ok) { setSavedAt(r.savedAt); setMsg(null); } else setMsg(r.message);
  };
  const adopt = async (name: string) => {
    const r = await variantBridge.applyDraft(contentId, platform, name);
    if (!r.ok) setMsg(r.message); else onAdopted();
  };
  return (
    <section className="variant-card" role="region" aria-label={`变体 ${rules.label}`}>
      <h2>{rules.label}<span className="mode-tag">{rules.mode === 'api' ? '官方 API' : '浏览器注入'}</span></h2>
      <ul className="rule-notes">{rules.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      {platform !== 'x' && <label>标题<input aria-label="变体标题输入" value={d.title} onChange={(e) => onChange({ title: e.target.value })} /></label>}
      {(platform === 'xiaohongshu' || platform === 'jike') && (
        <label>话题（顿号分隔）<input aria-label="变体话题输入" value={d.topics} onChange={(e) => onChange({ topics: e.target.value })} /></label>
      )}
      {platform === 'wechat-article' && (
        <>
          <label>摘要（≤120 字，可空）<input aria-label="变体摘要输入" value={d.digest} onChange={(e) => onChange({ digest: e.target.value })} /></label>
          <label>封面（内容库内路径，如 assets/cover.png）<input aria-label="变体封面输入" value={d.cover} onChange={(e) => onChange({ cover: e.target.value })} /></label>
        </>
      )}
      <label>正文<textarea aria-label="变体正文输入" value={d.body} onChange={(e) => onChange({ body: e.target.value })} /></label>
      <div className="validation" aria-label="校验结果">
        {v.errors.map((e) => <p key={e} className="v-error" role="alert">{e}</p>)}
        {v.warnings.map((w) => <p key={w} className="v-warn">{w}</p>)}
        {!v.errors.length && !v.warnings.length && <p className="v-ok">已满足本地规则</p>}
      </div>
      {msg && <p role="alert">{msg}</p>}
      <div className="variant-actions">
        <button onClick={() => void save()} disabled={!v.ok}>保存变体</button>
        <button onClick={onGoPublish}>去发布 {rules.label}</button>
        {savedAt && <span className="hint">已保存 {savedAt.slice(0, 19).replace('T', ' ')}</span>}
      </div>
      {drafts.length > 0 && (
        <div className="variant-drafts">
          <h3>AI 变体草稿（确认后写入本卡）</h3>
          <ul>
            {drafts.map((x) => (
              <li key={x.name}>
                <span>{x.note || '草稿'} · {x.created.slice(0, 19).replace('T', ' ')}</span>
                <button onClick={() => void adopt(x.name)}>采纳入变体 {x.name}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
```

`src/renderer/pages/PublishCenter.tsx`：
```tsx
import { useCallback, useEffect, useState } from 'react';
import { bridge } from '../lib/bridge';
import { variantBridge, publishBridge } from '../lib/publish-bridge';
import { validateVariant, PLATFORM_RULES } from '../../../shared/platform-rules';
import { WechatSettingsModal } from '../components/WechatSettingsModal';
import type { ContentMeta, PlatformKey, PublishEventOut, PublishTask, VariantDoc } from '../../../shared/types';

const PUBLISHABLE: PlatformKey[] = ['xiaohongshu', 'wechat-article'];
const PHASE_LABEL: Record<string, string> = {
  queued: '待运行', validating: '校验变体', login_check: '检查登录', injecting: '注入中',
  reading_back: '回读状态', prepared: '已停在草稿态', failed: '失败',
};
const CATEGORY_LABEL: Record<string, string> = {
  not_logged_in: '未登录', page_changed: '页面结构变更（适配器需更新）', network: '网络（可重试）',
  already_has_content: '编辑器已有内容（防覆盖停止）', api_error: '平台 API 错误', validation: '变体未过校验', unknown: '未知错误',
};

export function PublishCenter({ initial, onBack }: {
  initial?: { contentId: string; platform: PlatformKey }; onBack: () => void;
}) {
  const [items, setItems] = useState<ContentMeta[]>([]);
  const [contentId, setContentId] = useState(initial?.contentId ?? '');
  const [platform, setPlatform] = useState<PlatformKey>(initial?.platform ?? 'xiaohongshu');
  const [login, setLogin] = useState<Partial<Record<PlatformKey, { status: 'unknown' | 'ok' | 'failed'; message?: string }>>>({});
  const [doc, setDoc] = useState<VariantDoc | null>(null);
  const [tasks, setTasks] = useState<PublishTask[]>([]);
  const [showView, setShowView] = useState(false);
  const [wechatOpen, setWechatOpen] = useState(false);

  useEffect(() => { void bridge.listContents().then((s) => setItems(s.items)); }, []);
  const refreshTasks = useCallback(async () => setTasks(await publishBridge.tasks()), []);
  useEffect(() => { void refreshTasks(); }, [refreshTasks]);
  useEffect(() => publishBridge.onEvent((ev: PublishEventOut) => {
    setTasks((ts) => { const i = ts.findIndex((t) => t.taskId === ev.task.taskId); const next = [...ts]; if (i >= 0) next[i] = ev.task; else next.unshift(ev.task); return next; });
  }), []);

  const checkLogin = useCallback(async (p: PlatformKey) => {
    setLogin((s) => ({ ...s, [p]: { status: 'unknown' } }));
    const r = await publishBridge.checkLogin(p);
    setLogin((s) => ({ ...s, [p]: r.loggedIn ? { status: 'ok' } : { status: 'failed', message: r.message } }));
  }, []);
  useEffect(() => { if (contentId) void checkLogin(platform); }, [contentId, platform, checkLogin]);

  useEffect(() => { setDoc(null); if (contentId) void variantBridge.read(contentId, platform).then(setDoc); }, [contentId, platform]);
  const validation = doc ? validateVariant(platform, doc) : null;

  useEffect(() => () => { void publishBridge.showView('xiaohongshu', false).catch(() => {}); }, []);

  const myTasks = tasks.filter((t) => t.contentId === contentId && t.platform === platform);
  const latest = myTasks[0];

  const inject = async () => {
    const r = await publishBridge.createTask(contentId, platform);
    if (!r.ok) return;
    const run = await publishBridge.run(r.task.taskId);
    if (!run.ok) void refreshTasks();
  };
  const toggleView = async () => {
    const next = !showView;
    setShowView(next);
    await publishBridge.showView('xiaohongshu', next);
  };
  const canInject = Boolean(contentId && doc && validation?.ok && login[platform]?.status !== 'unknown');

  return (
    <div className="publish-page">
      <header className="page-header">
        <button onClick={onBack}>← 返回看板</button>
        <h1>发布中心</h1>
        <select aria-label="发布内容选择" value={contentId} onChange={(e) => setContentId(e.target.value)}>
          <option value="">选择内容…</option>
          {items.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
      </header>
      <p className="risk-note" role="note">风控边界：只注入草稿，最终发布由你在平台编辑器手动完成；平台间串行限速；注入前检查已有内容防覆盖。</p>
      <div className="publish-main">
        <div className="publish-left">
          {PUBLISHABLE.map((p) => {
            const rules = PLATFORM_RULES[p];
            const l = login[p];
            return (
              <section key={p} role="region" aria-label={`平台卡片 ${rules.label}`}
                className={`platform-card ${platform === p ? 'active' : ''}`}>
                <button className="platform-pick" onClick={() => setPlatform(p)}>
                  <h2>{rules.label}</h2><span className="mode-tag">{rules.mode === 'api' ? '官方 API（草稿箱）' : '浏览器注入'}</span>
                </button>
                {platform === p && <>
                  <div className="login-line">
                    {p === 'wechat-article' && <button onClick={() => setWechatOpen(true)}>公众号配置</button>}
                    <button onClick={() => void checkLogin(p)}>检查登录</button>
                    {l?.status === 'ok' && <span className="ok">已就绪{l.message ? `：${l.message}` : ''}</span>}
                    {l?.status === 'failed' && <span className="bad" role="alert">未登录或未就绪：{l.message ?? ''}</span>}
                    {l?.status === 'unknown' && <span className="hint">探测中…</span>}
                    {(p === 'xiaohongshu' && (l?.status === 'failed' || latest?.category === 'not_logged_in')) && (
                      <button onClick={() => void toggleView()}>{showView ? '隐藏平台页' : '打开平台页'}</button>
                    )}
                  </div>
                  <div className="variant-confirm">
                    <h3>变体确认（本地规则校验先行）</h3>
                    {doc
                      ? <>
                          <p className="hint">{doc.title || '（无标题）'} · 正文 {Array.from(doc.body.replace(/\s+/g, '')).length} 字 {doc.topics.length ? `· 话题 ${doc.topics.join('、')}` : ''}</p>
                          {validation?.errors.map((e) => <p key={e} className="v-error" role="alert">{e}</p>)}
                          {validation?.warnings.map((w) => <p key={w} className="v-warn">{w}</p>)}
                        </>
                      : <p className="hint">变体不存在：先在变体工作台生成并保存{rules.label}变体。</p>}
                    <button onClick={() => void inject()} disabled={!canInject}>注入草稿</button>
                  </div>
                </>}
              </section>
            );
          })}
          <section className="publish-tasks" aria-label="发布任务列表">
            <h3>发布任务（本机内存态，重启清空；发布记录持久化随 M4 运营域交付）</h3>
            {myTasks.length === 0 && <p className="hint">暂无任务</p>}
            {myTasks.map((t) => (
              <div key={t.taskId} className={`task phase-${t.phase}`}>
                <span>{PHASE_LABEL[t.phase] ?? t.phase}</span>
                {t.category && <span className="bad">{CATEGORY_LABEL[t.category] ?? t.category}</span>}
                {t.message && <span className="hint">{t.message}</span>}
                {t.draftUrl && <span className="hint">草稿页：{t.draftUrl}</span>}
                {t.mediaId && <span className="hint">草稿 media_id：{t.mediaId}</span>}
                {t.readBack && <span className="hint">回读：标题「{t.readBack.title}」正文 {t.readBack.bodyChars} 字</span>}
                {t.phase === 'failed' && t.category !== 'validation' && <button onClick={() => void publishBridge.retry(t.taskId)}>重试注入</button>}
              </div>
            ))}
          </section>
        </div>
        <div className="publish-view-host" aria-hidden={!showView}>
          {showView && <p className="hint">平台编辑器显示在此区域右侧（登录/核对草稿用；发布按钮由你手动点击）</p>}
        </div>
      </div>
      {wechatOpen && <WechatSettingsModal onClose={() => { setWechatOpen(false); void checkLogin('wechat-article'); }} />}
    </div>
  );
}
```

`src/renderer/components/AgentPanel.tsx` 两处改动：
```ts
// ① SKILLS 数组追加：
  { label: '一稿多态转化', command: '/skill:variant-convert' },
// ② refreshDrafts 过滤变体草稿——带 platform 的草稿若在此列出，「采纳入正文」会把变体写进
//    content.md，形成与架构声明相抵的第二条采纳路径；变体草稿唯一采纳路径是变体工作台：
  const refreshDrafts = useCallback(async () => {
    setDrafts((await agentBridge.listDrafts(contentId)).filter((d) => !d.platform));
  }, [contentId]);
```

`tests/renderer/AgentPanel.test.tsx` 追加用例（复用文件既有 `draft` 夹具与 mocks）：
```tsx
  it('变体草稿（带 platform）不进 AI 助手草稿区——唯一采纳路径是变体工作台', async () => {
    mocks.listDrafts.mockResolvedValue([
      { ...draft, name: 'draft-20261024-130000-cd34.md', note: '变体:xiaohongshu', platform: 'xiaohongshu' },
    ]);
    render(<AgentPanel contentId="c_1" onApplied={() => {}} />);
    await screen.findByRole('list', { name: '草稿区' });
    expect(screen.queryByRole('button', { name: /采纳入正文/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/变体:xiaohongshu/)).not.toBeInTheDocument();
  });
```

`src/renderer/App.tsx` 整体替换：
```tsx
import { useEffect, useState } from 'react';
import { Board } from './pages/Board';
import { Editor } from './pages/Editor';
import { VariantsPage } from './pages/VariantsPage';
import { PublishCenter } from './pages/PublishCenter';
import { bridge } from './lib/bridge';
import type { PlatformKey } from '../shared/types';

type View =
  | { view: 'setup' }
  | { view: 'board' }
  | { view: 'editor'; id: string }
  | { view: 'variants'; id?: string }
  | { view: 'publish'; initial?: { contentId: string; platform: PlatformKey } };
export function App() {
  const [v, setV] = useState<View>({ view: 'setup' });
  useEffect(() => {
    void bridge.getSettings().then((s) => setV(s.libraryRoot ? { view: 'board' } : { view: 'setup' }));
  }, []);
  if (v.view === 'setup') return (
    <div className="setup">
      <h1>ContentDeck</h1>
      <p>选择一个文件夹作为你的内容库（内容始终是你的文件）。</p>
      <button onClick={async () => {
        const r = await bridge.chooseLibrary();
        if ('libraryRoot' in r) setV({ view: 'board' });
      }}>选择内容库文件夹</button>
    </div>
  );
  if (v.view === 'editor') return <Editor id={v.id} onBack={() => setV({ view: 'board' })} onVariants={(id) => setV({ view: 'variants', id })} />;
  if (v.view === 'variants') return <VariantsPage initialContentId={v.id} onBack={() => setV({ view: 'board' })}
    onGoPublish={(contentId, platform) => setV({ view: 'publish', initial: { contentId, platform } })} />;
  if (v.view === 'publish') return <PublishCenter initial={v.initial} onBack={() => setV({ view: 'board' })} />;
  return <Board onOpen={(id) => setV({ view: 'editor', id })} onPublish={() => setV({ view: 'publish' })} />;
}
```
`src/renderer/pages/Board.tsx`：props 增**可选** `onPublish?: () => void`（必填会破坏既有 `tests/renderer/Board.test.tsx` 的 `<Board onOpen={...}/>` 用法），header 内加 `<button onClick={() => onPublish?.()}>发布中心</button>`。
`src/renderer/pages/Editor.tsx`：同理 props 增**可选** `onVariants?: (id: string) => void`，header 内加 `<button onClick={() => onVariants?.(id)}>变体工作台</button>`（App 始终传入，可选仅为兼容既有 Editor 测试渲染）。

`src/renderer/styles.css` 追加：
```css
/* M3：变体工作台与发布中心 */
.page-header { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid #E3E5EF; }
.page-header h1 { font-size: 16px; margin: 0; flex: 1; }
.variants-page, .publish-page { display: flex; flex-direction: column; height: 100vh; }
.variants-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; padding: 12px; overflow: auto; }
.variant-card { border: 1px solid #E3E5EF; border-radius: 8px; padding: 10px; background: #fff; display: flex; flex-direction: column; gap: 6px; }
.variant-card h2 { font-size: 14px; margin: 0; display: flex; align-items: center; gap: 6px; }
.mode-tag { font-size: 11px; color: #5A5E72; border: 1px solid #E3E5EF; border-radius: 4px; padding: 0 4px; }
.rule-notes { margin: 0; padding-left: 16px; font-size: 12px; color: #8A8FA8; }
.variant-card label { display: flex; flex-direction: column; font-size: 12px; gap: 2px; }
.variant-card input, .variant-card textarea { font: inherit; padding: 4px 6px; }
.variant-card textarea { min-height: 120px; resize: vertical; }
.v-error { color: #C4342B; font-size: 12px; margin: 2px 0; }
.v-warn { color: #9A6B00; font-size: 12px; margin: 2px 0; }
.v-ok { color: #2E7D32; font-size: 12px; }
.variant-actions { display: flex; gap: 8px; align-items: center; }
.variant-drafts ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.variant-drafts li { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; border-top: 1px dashed #E3E5EF; padding-top: 4px; }
.risk-note { margin: 0; padding: 6px 12px; background: #FFF7E0; font-size: 12px; color: #7A5B00; }
.publish-main { display: flex; flex: 1; min-height: 0; }
.publish-left { flex: 1; padding: 12px; display: flex; flex-direction: column; gap: 12px; overflow: auto; }
.platform-card { border: 1px solid #E3E5EF; border-radius: 8px; background: #fff; padding: 8px; }
.platform-card.active { border-color: #465FD7; }
.platform-pick { all: unset; cursor: pointer; display: flex; align-items: center; gap: 8px; width: 100%; }
.platform-card h2 { font-size: 14px; margin: 0; }
.login-line { display: flex; align-items: center; gap: 8px; margin: 8px 0; flex-wrap: wrap; }
.login-line .ok { color: #2E7D32; font-size: 12px; }
.login-line .bad { color: #C4342B; font-size: 12px; }
.variant-confirm { border-top: 1px solid #E3E5EF; padding-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.publish-tasks { border: 1px solid #E3E5EF; border-radius: 8px; background: #fff; padding: 8px; }
.publish-tasks .task { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; padding: 4px 0; border-top: 1px dashed #E3E5EF; }
.task.phase-prepared > span:first-child { color: #2E7D32; font-weight: 600; }
.publish-view-host { flex: 0 0 0px; }
.publish-view-host p { width: 0; overflow: hidden; }
```

- [ ] **Step 3: 通过 + typecheck**

```bash
npx vitest run tests/renderer/VariantsPage.test.tsx tests/renderer/PublishCenter.test.tsx tests/renderer/AgentPanel.test.tsx
npm run typecheck && npm test    # 既有 Board/Editor/AgentPanel 用例保持绿（新按钮与草稿过滤不参与既有断言）
```

- [ ] **Step 4: Commit** `git commit -m "feat(m3): 变体工作台与发布中心（登录探测/变体确认/注入进度/三分类重试/公众号配置）"`

---

### Task 8: e2e 全链（fixture 编辑器 + mock 微信 API）+ 人工验收清单 + README

**Files:**
- Create: `tests/helpers/fixture-server.ts`、`tests/e2e/variants.spec.ts`、`tests/e2e/publish.spec.ts`、`docs/manual-acceptance-m3.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 6 的 `CONTENTDECK_XHS_EDITOR_URL`/`CONTENTDECK_WECHAT_API_BASE`/`CONTENTDECK_USER_DATA`/`CONTENTDECK_LIBRARY` 注入；Task 4 fixture 页；M2 `MockOpenai`；Task 7 可达名。
- `FixtureServer`：`start() → url`；`GET /xhs-editor`（fixture 页）；`POST /fixture/state`（记录编辑器最终状态）；`POST /fixture/published`（计数——e2e 断言为 0）；`POST /cgi-bin/stable_token|material/add_material|media/uploadimg|draft/add`（mock 微信 API，记录请求供断言）。

- [ ] **Step 1: `tests/helpers/fixture-server.ts`（完整）**

```ts
import http from 'http';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** e2e 本地夹具服务器：小红书 fixture 编辑器页 + 状态/发布按钮上报 + mock 微信 API。绝不联网。 */
export class FixtureServer {
  readonly publishClicks = { count: 0 };
  readonly editorState = { last: null as { title: string; body: string } | null };
  readonly wechat = {
    tokens: 0, materials: [] as string[], contentImages: 0,
    drafts: [] as { title: string; digest: string; content: string; thumb_media_id: string }[],
  };
  private readonly server: http.Server;
  private port = 0;
  constructor() {
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      let body = '';
      req.on('data', (c: string) => (body += c));
      req.on('end', () => {
        const json = () => JSON.parse(body || '{}') as Record<string, unknown>;
        if (req.method === 'GET' && url.pathname === '/xhs-editor') {
          const html = readFileSync(path.resolve('tests/fixtures/xiaohongshu-editor.html'), 'utf8');
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }
        if (req.method === 'POST' && url.pathname === '/fixture/published') { this.publishClicks.count += 1; res.writeHead(204); res.end(); return; }
        if (req.method === 'POST' && url.pathname === '/fixture/state') { this.editorState.last = json() as { title: string; body: string }; res.writeHead(204); res.end(); return; }
        if (req.method === 'POST' && url.pathname === '/cgi-bin/stable_token') {
          this.wechat.tokens += 1;
          const b = json();
          if (b.appid !== 'wx-e2e' || b.secret !== 'e2e-secret') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ errcode: 40125, errmsg: 'invalid appid or secret' })); return; }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ access_token: 'e2e-token', expires_in: 7200 }));
          return;
        }
        if (req.method === 'POST' && url.pathname === '/cgi-bin/material/add_material') {
          const name = body.match(/filename="([^"]+)"/)?.[1] ?? 'unknown';
          this.wechat.materials.push(name);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ media_id: `e2e-thumb-${this.wechat.materials.length}`, url: 'https://mmbiz.example/cover.jpg' }));
          return;
        }
        if (req.method === 'POST' && url.pathname === '/cgi-bin/media/uploadimg') {
          this.wechat.contentImages += 1;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ url: `https://mmbiz.example/in-${this.wechat.contentImages}.jpg` }));
          return;
        }
        if (req.method === 'POST' && url.pathname === '/cgi-bin/draft/add') {
          const article = ((json().articles as unknown[]) ?? [])[0] as { title: string; digest: string; content: string; thumb_media_id: string };
          this.wechat.drafts.push(article);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ media_id: `e2e-draft-${this.wechat.drafts.length}` }));
          return;
        }
        res.writeHead(404); res.end();
      });
    });
  }
  get url(): string { return `http://127.0.0.1:${this.port}`; }
  async start(): Promise<string> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()));
    this.port = (this.server.address() as { port: number }).port;
    return this.url;
  }
  async close(): Promise<void> { await new Promise<void>((r) => this.server.close(() => r())); }
}
```

- [ ] **Step 2: `tests/e2e/variants.spec.ts`（AI 一稿多态 → 草稿 → 人工采纳入变体文件）**

```ts
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MockOpenai, type MockScript } from '../helpers/mock-openai';

async function launch(lib: string, ud: string, extra: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await _electron.launch({
    args: ['.'],
    env: { ...process.env, CONTENTDECK_LIBRARY: lib, CONTENTDECK_USER_DATA: ud, ...extra },
  });
  return { app, page: await app.firstWindow() };
}
const makeLib = () => mkdtempSync(path.join(tmpdir(), 'deck-m3-'));
const makeUd = (mockUrl?: string, lib?: string) => {
  const ud = mkdtempSync(path.join(tmpdir(), 'deck-m3-ud-'));
  writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(mockUrl
    ? { libraryRoot: lib ?? null, model: { providerId: 'contentdeck', name: 'E2E', baseUrl: mockUrl, apiKey: 'k', modelId: 'mock' } }
    : { libraryRoot: lib ?? null }), 'utf8');
  return ud;
};
const contentIdOf = (lib: string): string => {
  const folder = readdirSync(lib).find((f) => /^\d{4}-\d{2}-\d{2}-/.test(f))!;
  return readFileSync(path.join(lib, folder, 'content.md'), 'utf8').match(/id: (c_\d{8}_[0-9a-f]{4})/)![1]!;
};

test('一稿多态转化：技能→save_variant 草稿→变体工作台人工采纳→platforms 文件落盘', async () => {
  const mock = new MockOpenai(({ messages }) => {
    // 与 M2 agent.spec 同模式：首轮无 tool 消息 → 先 list_contents 让 id 进入上下文，
    // 否则 save_variant 的 id 无从获得（mock 自己就是"模型"）
    const toolMsgs = JSON.stringify(messages.filter((m) => m.role === 'tool'));
    if (!messages.some((m) => m.role === 'tool')) return [{ type: 'tool', name: 'list_contents', args: {} }];
    const id = toolMsgs.match(/c_\d{8}_[0-9a-f]{4}/)?.[0];
    if (id && !toolMsgs.includes('变体草稿已保存')) {
      return [{ type: 'tool', name: 'save_variant', args: {
        id, platform: 'xiaohongshu',
        markdown: '# 转化出的标题\n话题: 测试话题\n\n这是按小红书体裁重写的变体正文。',
      } }];
    }
    return [{ type: 'text', text: '变体已存草稿区，请到变体工作台确认。' }];
  } as MockScript);
  const url = await mock.start();
  const lib = makeLib(); const ud = makeUd(url, lib);

  const { app, page } = await launch(lib, ud);
  await page.getByRole('button', { name: '新建内容' }).click();
  await page.getByLabel('标题').fill('一稿多态第一篇');
  await page.getByRole('button', { name: '创建' }).click();
  await page.getByRole('button', { name: '一稿多态第一篇', exact: true }).click();
  await page.getByRole('button', { name: '一稿多态转化' }).click();
  await page.getByLabel('AI 指令输入').fill('/skill:variant-convert 小红书');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByLabel('AI 对话记录')).toContainText('变体已存草稿区', { timeout: 30_000 });

  await page.getByRole('button', { name: '变体工作台' }).click();
  const card = page.getByRole('region', { name: '变体 小红书' });
  await expect(card.getByRole('button', { name: /采纳入变体/ })).toBeVisible({ timeout: 10_000 });
  await card.getByRole('button', { name: /采纳入变体/ }).click();
  await expect(card.getByLabelText('变体标题输入')).toHaveValue('转化出的标题');
  await expect(card.getByLabelText('变体正文输入')).toHaveValue(/这是按小红书体裁重写的变体正文。/);

  const id = contentIdOf(lib);
  const folder = readdirSync(lib).find((f) => f.startsWith('2026-'))!;
  const raw = readFileSync(path.join(lib, folder, 'platforms', 'xiaohongshu.md'), 'utf8');
  expect(raw).toContain('title: 转化出的标题');
  expect(raw).toContain('这是按小红书体裁重写的变体正文。');
  expect(readdirSync(path.join(lib, '.studio', 'drafts', id))).toEqual([]); // 草稿被消费
  await app.close();
  await mock.close();
});
```

- [ ] **Step 3: `tests/e2e/publish.spec.ts`（发布中心全链）**

```ts
import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FixtureServer } from '../helpers/fixture-server';

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64',
);
async function launch(env: Record<string, string>): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await _electron.launch({ args: ['.'], env: { ...process.env, ...env } });
  return { app, page: await app.firstWindow() };
}
async function createContent(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: '新建内容' }).click();
  await page.getByLabel('标题').fill(title);
  await page.getByRole('button', { name: '创建' }).click();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
}

test.describe('小红书：fixture 编辑器全链（选内容+平台→变体确认→注入→草稿态停住→回读→防覆盖→绝不点发布）', () => {
  test('未登录探测：全新 partition 呈现未登录分类与登录引导', async () => {
    const fixture = new FixtureServer();
    const base = await fixture.start();
    const lib = mkdtempSync(path.join(tmpdir(), 'deck-m3-'));
    const ud = mkdtempSync(path.join(tmpdir(), 'deck-m3-ud-'));
    const { app, page } = await launch({
      CONTENTDECK_LIBRARY: lib, CONTENTDECK_USER_DATA: ud,
      CONTENTDECK_XHS_EDITOR_URL: `${base}/xhs-editor`, // 无 ?login=1 → fixture 登录页
    });
    await createContent(page, '未登录路径');
    await page.getByRole('button', { name: '发布中心' }).click();
    await page.getByRole('region', { name: '平台卡片 小红书' }).getByRole('button', { name: '检查登录' }).click();
    await expect(page.getByText('请先登录小红书创作服务平台')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('未登录')).toBeVisible();
    await app.close();
    await fixture.close();
  });

  test('登录态全链：注入停在草稿→回读可见→二次注入防覆盖→发布按钮零点击', async () => {
    const fixture = new FixtureServer();
    const base = await fixture.start();
    const lib = mkdtempSync(path.join(tmpdir(), 'deck-m3-'));
    const ud = mkdtempSync(path.join(tmpdir(), 'deck-m3-ud-'));
    const editorUrl = `${base}/xhs-editor?login=1`; // fixture 已登录态（模拟登录由平台页/人工路径完成）
    const { app, page } = await launch({
      CONTENTDECK_LIBRARY: lib, CONTENTDECK_USER_DATA: ud, CONTENTDECK_XHS_EDITOR_URL: editorUrl,
    });
    // 造内容与合法变体（UI 路径）
    await createContent(page, '发布全链');
    await page.getByRole('button', { name: '发布全链', exact: true }).click();
    await page.getByRole('button', { name: '变体工作台' }).click();
    const card = page.getByRole('region', { name: '变体 小红书' });
    await card.getByLabelText('变体标题输入').fill('全链测试标题');
    await card.getByLabelText('变体话题输入').fill('测试话题');
    await card.getByLabelText('变体正文输入').fill('正文'.repeat(325)); // 650 字
    await card.getByRole('button', { name: '保存变体' }).click();
    await expect(card.getByText('已满足本地规则')).toBeVisible();

    await page.getByRole('button', { name: '← 返回看板' }).click();
    await page.getByRole('button', { name: '发布中心' }).click();
    await page.getByLabel('发布内容选择').selectOption({ label: '发布全链' }); // 从看板进入无 initial：canInject 与任务列表均按 contentId 过滤，必先选内容（对齐单测 selectContent）
    const xhs = page.getByRole('region', { name: '平台卡片 小红书' });
    await xhs.getByRole('button', { name: '检查登录' }).click();
    await expect(xhs.getByText('已就绪')).toBeVisible({ timeout: 30_000 });
    await xhs.getByRole('button', { name: '注入草稿' }).click();

    await expect(page.getByText('已停在草稿态')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/回读：标题「全链测试标题」/)).toBeVisible();
    // fixture 服务器状态 == 注入结果（Playwright 无 WebContentsView 访问，探针事实 #1）
    await expect.poll(() => fixture.editorState.last?.title).toBe('全链测试标题');
    await expect.poll(() => fixture.editorState.last?.body ?? '').toContain('#测试话题');

    // 防覆盖：同一编辑器再次注入 → already_has_content（内容一致则幂等重填——先改负载再注入触发拒绝）
    await page.getByRole('button', { name: '← 返回看板' }).click();
    await page.getByRole('button', { name: '发布全链', exact: true }).click();
    await page.getByRole('button', { name: '变体工作台' }).click();
    await card.getByLabelText('变体标题输入').fill('另一个不同标题');
    await card.getByRole('button', { name: '保存变体' }).click();
    await page.getByRole('button', { name: '← 返回看板' }).click();
    await page.getByRole('button', { name: '发布中心' }).click();
    await page.getByLabel('发布内容选择').selectOption({ label: '发布全链' }); // 重进发布中心 contentId 复位为 ''：重新选内容
    await xhs.getByRole('button', { name: '注入草稿' }).click();
    await expect(page.getByText('编辑器已有内容（防覆盖停止）')).toBeVisible({ timeout: 60_000 });

    expect(fixture.publishClicks.count).toBe(0); // 绝不点发布（spec §6 铁律的 e2e 机械断言）
    await app.close();
    await fixture.close();
  });
});

test('公众号文章：mock API 全链（token→封面素材→正文图→草稿创建，停在草稿态）', async () => {
  const fixture = new FixtureServer();
  const base = await fixture.start();
  const lib = mkdtempSync(path.join(tmpdir(), 'deck-m3-'));
  const ud = mkdtempSync(path.join(tmpdir(), 'deck-m3-ud-'));
  // 预置凭证（plain: 前缀值在 getWechatCredentials 按 prefix 分流，不依赖 safeStorage 可用性——
  // 打包环境 safeStorage 可用时同样确定性生效，见 Task 3 实现）
  writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({
    libraryRoot: lib,
    wechatMp: { appid: 'wx-e2e', secretStore: 'plain:e2e-secret' },
  }), 'utf8');

  const { app, page } = await launch({
    CONTENTDECK_LIBRARY: lib, CONTENTDECK_USER_DATA: ud,
    CONTENTDECK_WECHAT_API_BASE: base,
  });
  await createContent(page, '公众号文章全链');
  const folder = readdirSync(lib).find((f) => f.startsWith('2026-'))!;
  mkdirSync(path.join(lib, folder, 'platforms'), { recursive: true });
  writeFileSync(path.join(lib, folder, 'assets', 'cover.png'), PNG_1PX); // createContent 已建 assets/

  await page.getByRole('button', { name: '公众号文章全链', exact: true }).click();
  await page.getByRole('button', { name: '变体工作台' }).click();
  const card = page.getByRole('region', { name: '变体 公众号文章' });
  await card.getByLabelText('变体标题输入').fill('公众号草稿测试标题');
  await card.getByLabelText('变体摘要输入').fill('这是摘要');
  await card.getByLabelText('变体封面输入').fill('assets/cover.png');
  await card.getByLabelText('变体正文输入').fill('# 小节\n\n正文段落，含一张图：\n\n![封面复用](assets/cover.png)\n\n结束');
  await card.getByRole('button', { name: '保存变体' }).click();
  await expect(card.getByText('已满足本地规则')).toBeVisible();

  await page.getByRole('button', { name: '← 返回看板' }).click();
  await page.getByRole('button', { name: '发布中心' }).click();
  // 切换到公众号文章卡片（确认面板只渲染活动平台）——先切卡片再选内容：选中即对活动平台自动 checkLogin，
  // api 平台走 mock API（usesSession=false 不开页面），不会触碰小红书默认编辑器 URL
  await page.getByRole('button', { name: '公众号文章' }).click();
  await page.getByLabel('发布内容选择').selectOption({ label: '公众号文章全链' }); // 从看板进入无 initial：canInject 与任务列表均按 contentId 过滤，必先选内容
  const wx = page.getByRole('region', { name: '平台卡片 公众号文章' });
  await wx.getByRole('button', { name: '检查登录' }).click();
  await expect(wx.getByText('已就绪')).toBeVisible({ timeout: 30_000 });
  await wx.getByRole('button', { name: '注入草稿' }).click();
  await expect(page.getByText('已停在草稿态')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/草稿 media_id：e2e-draft-1/)).toBeVisible();

  expect(fixture.wechat.tokens).toBeGreaterThanOrEqual(1);
  expect(fixture.wechat.materials).toEqual(['cover.png']);           // 封面先传永久素材
  expect(fixture.wechat.contentImages).toBe(1);                       // 正文 1 张本地图 → uploadimg
  const draft = fixture.wechat.drafts[0]!;
  expect(draft.title).toBe('公众号草稿测试标题');
  expect(draft.digest).toBe('这是摘要');
  expect(draft.thumb_media_id).toBe('e2e-thumb-1');
  expect(draft.content).toContain('<h2>小节</h2>');
  expect(draft.content).toContain('https://mmbiz.example/in-1.jpg');
  await app.close();
  await fixture.close();
});
```

- [ ] **Step 4: 人工验收清单 `docs/manual-acceptance-m3.md`（真实平台，不伪造自动化——spec §9）**

```markdown
# M3 真实平台人工验收清单

自动化只覆盖本地 fixture 与 mock API（`npm run e2e`）。真实平台行为按下表人工验收，
如实记录结果与日期；失败即缺陷，不得改自动化绕过。

## A. 小红书（DOM 注入）

前置：真实小红书账号；ContentDeck 设置不变（默认编辑器 URL）。

| # | 步骤 | 预期 | 结果/日期 |
|---|---|---|---|
| A1 | 发布中心→小红书→检查登录（首次） | 分类=未登录，出现「打开平台页」 | |
| A2 | 打开平台页→在应用内平台视图完成扫码登录 | 登录态落在 persist:xiaohongshu partition；重开应用仍登录 | |
| A3 | 再次检查登录 | 已就绪 | |
| A4 | 变体工作台保存合法小红书变体（600–900 字+话题）→发布中心注入 | 标题/正文/#话题 落入真实编辑器；**停在草稿态，发布按钮不被点击** | |
| A5 | 平台编辑器内已有他人草稿时注入 | 明确报「编辑器已有内容，防覆盖停止」，不覆盖 | |
| A6 | 注入成功后人工点平台「发布」 | 正常发布（发布永远由人执行） | |
| A7 | 记录当前页面结构指纹（标题框 placeholder、编辑器类名） | 与 `inject-script-xiaohongshu.ts` 选择器一致；不一致=适配器需更新（R1） | |

## B. 公众号文章（官方 API）

前置：已认证公众号；**后台「IP 白名单」加入本机出口 IP**（spec D2）；AppID/AppSecret。

| # | 步骤 | 预期 | 结果/日期 |
|---|---|---|---|
| B1 | 发布中心→公众号配置：填 AppID/AppSecret 保存 | 只回显尾四位；重开应用无需重填 | |
| B2 | 检查登录 | 已就绪（stable_token 获取成功）；Secret 错/IP 未加白名单时给出明确错误分类 | |
| B3 | 变体含封面与正文图→注入 | 草稿箱出现新草稿：封面/摘要/正文图显示正常，正文 HTML 结构正确 | |
| B4 | 在公众号后台打开该草稿 | 内容完整可编辑；**群发由人工在后台操作** | |
| B5 | 注入两次（重试场景） | 草稿箱新增一条（M3 无 draft/update，UI 有提示） | |

## C. 风控边界自查

- [ ] 注入过程无任何对平台内部接口的调用（代码评审+网络面板抽查）
- [ ] 平台间注入串行且有 ≥15s 间隔（两次不同平台注入观察）
- [ ] 应用退出后重开，登录态仍在（partition 持久），凭证不进内容库/git
```

- [ ] **Step 5: README 追加（M3 段落）**

```markdown
## 一稿多态与发布（M3）

- **变体工作台**：编辑器顶栏进入。四平台（小红书/X/即刻/公众号文章）硬规则实时校验；
  在编辑器「AI 助手 → 一稿多态转化」生成变体草稿，回到变体工作台「采纳入变体」确认落盘 `platforms/<平台>.md`。
- **发布中心**：看板顶栏进入。选内容+平台→登录态探测→变体确认（本地校验先行）→「注入草稿」→
  **停在草稿态**；失败按三分类呈现（未登录/页面结构变更/网络）并可重试。小红书走应用内嵌浏览器
  （独立登录态 partition），公众号文章走官方 API（草稿箱）。
- **风控边界**：只注入草稿、绝不点发布按钮、不调平台内部接口、平台间串行限速、注入前防覆盖检查。
  最终发布永远由你在平台编辑器/后台手动完成。
- 公众号配置（AppID/AppSecret）存本机用户数据目录；正式调用需在公众号后台将本机出口 IP 加入白名单。
- 测试不依赖真实平台：`npm test`（单测）与 `npm run e2e`（本地 fixture 编辑器 + mock 微信 API + mock OpenAI）；
  真实平台验收见 `docs/manual-acceptance-m3.md`。
- 环境变量（测试/自定）：`CONTENTDECK_XHS_EDITOR_URL`（覆盖小红书编辑器地址）、
  `CONTENTDECK_WECHAT_API_BASE`（覆盖公众号 API 基址）、`CONTENTDECK_PUBLISH_MIN_INTERVAL_MS`（注入最小间隔）。
```

- [ ] **Step 6: 全量验证**

```bash
npm run typecheck
npm test        # 单测+渲染全绿（新增 unit×8 文件、renderer×2 文件）
npm run e2e     # electron-forge package && playwright test：既有 5 条 + variants 1 条 + publish 3 条全绿
```

- [ ] **Step 7: Commit** `git commit -m "test(m3): e2e 发布中心全链（fixture 编辑器/mock 微信 API/防覆盖/零发布点击）与人工验收清单"`

---

## 自审记录（Self-Review）

1. **Spec 覆盖**：§10 M3 行「一稿多态变体工作台」=Task 1（规则+文件域）/Task 2（技能+save_variant）/Task 7（VariantsPage）；「公众号文章进草稿箱」=Task 3（API 客户端）/Task 6（装配）/Task 8 e2e 公众号用例（断言 draft/add 请求体含 thumb/摘要/HTML 正文图 URL）+人工验收 B1–B5；「小红书动态进真实编辑器草稿」=Task 4（注入脚本）/Task 8 e2e 全链（停在草稿态断言+发布按钮零点击）+人工验收 A1–A7。§5 落点：save_variant（Task 2，只进草稿区——铁律延伸）、create_publish_task（Task 5，只建任务）、一稿多态技能（Task 2，四平台硬规则内嵌）、技能名 ASCII（探针事实沿用 M2 #7）。§6 落点：PlatformAdapter 四成员接口（Task 4 `adapter.ts`）；公众号=官方 API 草稿箱（Task 3）；小红书=创作服务平台 DOM 注入（Task 4）；状态回读写任务（Task 5 `readBack`）；失败三分类（Task 4 `classifyFailure`+Task 5 fail 路径+Task 7 文案）；风控五条（注入脚本无发布点击代码路径+fixture 上报断言零点击、无平台接口调用、串行互斥+最小间隔、防覆盖检查、单平台失败不影响其他——chain 不断）。§4.1 platforms/ 变体文件=Task 1。§9 落点：单测平台规则（Task 1）、DOM fixture 回放（Task 4 jsdom，fixture 即"真实页面结构快照"的仓库内形态）、真实平台人工验收清单（Task 8 文档）、e2e 主流程含变体与发布任务（Task 8）。§3 落点：WebContentsView 域名白名单（Task 4/6）、凭证脱敏（Task 3/6）。§8 落点：适配器 DOM 结构指纹思想=选择器+PAGE_CHANGED 明确报错（Task 4）。
2. **探针/文档结论落地**：Playwright 无 WebContentsView 访问（#1→e2e 断言走 UI+fixture 服务器日志）；jsdom 无剪贴板 API（#3→脚本守卫+回退，单测覆盖回退路径）；pragma（#5→Task 4 测试头）；函数源 eval（#4→Task 4 测试）；Node fetch/FormData/Blob（#6→零新依赖的 multipart）；公众号字段限制（#7→wechat-article 规则与 mock 断言一致）；X 计数（#8→Task 1）；即刻话题必选（#9→Task 1）。WeSight AGPL-3.0 边界单列章节+Global Constraints+注入脚本头部注释三处落实。
3. **占位符扫描**：无 TBD、无"以实现为准微调"类悬置指令。两处带判定标准的回退说明保留（vitest pragma 失效时挪 `tests/renderer/`，判定=该文件 vitest run 通过；Task 4 platform-session 的 UA 归一化单测可选，判定=typecheck+e2e 覆盖），均为环境回退而非行为未定义。
4. **类型一致性**：`PlatformKey/VariantDoc/VariantValidation`（Task 1 定义，2/4/5/6/7/8 消费）；`PublishTask/PublishEventOut/PublishFailureCategory/PublishPhase`（Task 4 定义发布任务形状于 shared/types，Task 5 服务/Task 6 桥/Task 7 UI/e2e 消费）；`InjectInput` 含 `contentFolder`（Task 4 定义，Task 5 execute 构造，微信适配器消费）；`XhsPayload.timeoutMs`（Task 4 脚本与测试共用）；`WechatMpConfigView/KEEP_WECHAT_SECRET`（Task 3 定义，Task 6 IPC/Task 7 弹窗消费）；可达名字符串在 Task 7 Interfaces 集中声明并被 Task 8 e2e 逐一引用。
5. **任务独立可测**：每任务"失败测试→实现→通过→typecheck+全量 npm test→commit"收口；electron 专属层（PlatformSession/ElectronPublishRuntime）只进 ipc.ts，纯逻辑（规则/变体/客户端/脚本/服务/适配器映射）全部单测隔离（fetch 替身/jsdom/FakeRuntime）；真实 Electron 链路集中在 Task 8 e2e。
6. **不回归**：M1/M2 文件改动全部加法——content-library 仅导出 mustFind；drafts 增可选 platform（既有断言不涉及）；domain-tools 数组追加（既有用例索引 0–3 不变）；agent-service 一行扩展（新增用例覆盖）；ipc 既有通道逐字保留、agent 工厂仅增 createPublishTask 注入；preload 只增两个子对象；App/Board/Editor 增导航（既有可达名不动，AgentPanel 增技能按钮并在草稿区过滤变体草稿——变体草稿唯一采纳路径是变体工作台；既有 AgentPanel 断言不涉及 platform 草稿，保持绿）；skills.test 断言更新为三技能（显式列出）；CI 工作流零改动（e2e 命令不变）。
7. **取舍声明**（对 spec 的显式偏移，均在「M3 明确不做」）：小红书 M3 文本注入（图片自动上传留 M4——ask 的 fixture 范围即标题/正文/发布按钮，公众号封面因 API 必须传属例外）；publishes 表留 M4（M3 任务内存态+UI 明示）；微信仅 draft/add（无 update）。D2（IP 白名单）在 Task 8 验收清单 B 前置条件与设置弹窗提示两处落地。

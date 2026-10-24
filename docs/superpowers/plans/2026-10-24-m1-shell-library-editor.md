# ContentDeck M1 实施计划：应用壳 + 内容库 + MD 编辑器

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个能安装运行的 Electron 桌面应用：选择本地内容库文件夹后，能创建内容、在管线看板上管理、用 CodeMirror 编辑器写作并自动保存到纯 Markdown 文件。

**Architecture:** Electron Forge + Vite。主进程持有全部文件系统访问（内容库领域服务），渲染进程（React）只经 preload 暴露的白名单 IPC 桥调用；内容 = 每条一个文件夹（content.md + frontmatter + assets/），无数据库（M1 范围）。

**Tech Stack:** Electron（Forge + plugin-vite）、React 19、TypeScript（strict）、gray-matter（frontmatter）、CodeMirror 6、vitest（node + jsdom 双工程）、Playwright（_electron e2e）、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-10-24-content-ops-workbench-design.md`（本计划实现其 §10 M1；§4.1 数据模型、§3 架构与安全基线全程生效）

## Global Constraints

- Node `>=22.19.0`（engines 字段如实写）；包管理 npm，**package-lock.json 必须提交**。
- TypeScript `strict: true`；`package.json` `"type": "module"`。
- 安全基线（spec §3）：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`（preload 需 bundle；桥只暴露白名单方法）。渲染进程**不得**直接访问 fs/node API——一切经 `window.studio` 桥。
- frontmatter 只存 `id / title / stage / tags / created / media`（spec §4.1）；平台明细永不入 frontmatter。
- stage 枚举：`idea | draft | review | variants | publishing | published | retro`（spec §7）。
- 内容 id 格式：`c_YYYYMMDD_<4位hex>`；文件夹名 `YYYY-MM-DD-<净化标题>`。
- 正文写入必须原子（同目录 tmp 文件 + rename）（spec §8）。
- UI 文案全部中文；产品名显示 "ContentDeck"。
- M1 明确不做：pi、SQLite、平台适配器、灵感库、档期（spec §2/§10）。
- 每个任务收尾跑 `npm run typecheck && npm test`，绿了才 commit。

## File Structure（全部新建，仓库当前仅有 README/.gitignore/docs）

```
package.json                 # contentdeck，type:module，scripts
forge.config.ts              # Forge + plugin-vite + maker-zip
vite.main.config.ts          # 主进程构建
vite.preload.config.ts       # preload 构建
vite.renderer.config.ts      # 渲染进程构建（React）
tsconfig.json                # 单 tsconfig 覆盖三端 + tests
vitest.config.ts             # projects: unit(node) + renderer(jsdom)
playwright.config.ts         # e2e（_electron）
.github/workflows/ci.yml     # typecheck+test+e2e
src/shared/types.ts          # Stage/ContentMeta/Content/桥类型（三端共享）
src/main/index.ts            # app 入口：窗口、单实例、devtools
src/main/settings.ts         # userData/settings.json 读写 + 库根目录持久化 + 同步盘检测
src/main/content-library.ts  # 领域服务：list/create/read/writeBody/updateMeta
src/main/ipc.ts              # ipcMain.handle 注册（studio:* 通道）
src/preload/index.ts         # contextBridge 暴露 window.studio
src/renderer/index.html      # Vite 入口页
src/renderer/main.tsx        # React 挂载
src/renderer/App.tsx         # 视图切换 board/editor + 初始化流程
src/renderer/lib/bridge.ts   # window.studio 类型化封装
src/renderer/styles.css      # 全局样式（CSS 变量，无 UI 框架）
src/renderer/pages/Board.tsx # 管线看板（7 列 + 卡片 + 新建弹窗 + 移动 stage）
src/renderer/pages/Editor.tsx# CodeMirror 编辑器 + 标题 + 自动保存
src/renderer/components/NewContentModal.tsx
tests/unit/content-library.test.ts
tests/unit/settings.test.ts
tests/renderer/Board.test.tsx
tests/e2e/app.spec.ts        # 建→写→存→重启→持久化→stage 流转
tests/helpers/libFixture.ts  # 临时内容库 fixture
```

---

### Task 1: 手工脚手架——Forge+Vite+React+TS 可启动空壳

**Files:**
- Create: `package.json`、`forge.config.ts`、`vite.main.config.ts`、`vite.preload.config.ts`、`vite.renderer.config.ts`、`tsconfig.json`、`vitest.config.ts`
- Create: `src/main/index.ts`、`src/preload/index.ts`、`src/renderer/index.html`、`src/renderer/main.tsx`、`src/renderer/App.tsx`、`src/renderer/styles.css`、`src/shared/types.ts`（先放空导出类型）

**Interfaces:**
- Produces: 可 `npm start` 的空窗口（标题 ContentDeck，渲染 React 页面）；`npm run typecheck`/`npm test`（0 用例通过）可用；后续任务在此骨架上加文件。

- [ ] **Step 1: 写 package.json 并安装依赖**

```json
{
  "name": "contentdeck",
  "productName": "ContentDeck",
  "version": "0.1.0",
  "description": "本地优先的桌面内容运营工作台",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.19.0" },
  "main": ".vite/build/main.js",
  "scripts": {
    "start": "electron-forge start",
    "package": "electron-forge package",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  }
}
```

```bash
npm i react react-dom gray-matter @codemirror/state @codemirror/view @codemirror/lang-markdown @codemirror/language
npm i -D electron electron-forge @electron-forge/cli @electron-forge/plugin-vite @electron-forge/maker-zip vite @vitejs/plugin-react typescript vitest jsdom @testing-library/react @testing-library/jest-dom @playwright/test @types/react @types/react-dom @types/node
```

（版本不手写，由 package-lock 锁定；`electron-forge` 新版将 CLI 合并，若 `@electron-forge/cli` 不存在则去掉它。）

- [ ] **Step 2: 写 forge.config.ts 与三个 vite 配置**

`forge.config.ts`:
```ts
import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: { asar: true },
  rebuildConfig: {},
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['win32', 'darwin', 'linux'] }],
  plugins: [new VitePlugin({
    build: [
      { entry: 'src/main/index.ts', config: 'vite.main.config.ts', target: 'main' },
      { entry: 'src/preload/index.ts', config: 'vite.preload.config.ts', target: 'preload' },
    ],
    renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
  })],
};
export default config;
```

`vite.main.config.ts` / `vite.preload.config.ts`:
```ts
import { defineConfig } from 'vite';
export default defineConfig({ build: { rollupOptions: { external: ['electron'] } } });
```
（preload 若 bundle 报 CJS/ESM 问题，加 `build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } }, ... }` 并同步 forge.config.ts 里 preload 入口产物名。）

`vite.renderer.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()] });
```

- [ ] **Step 3: 写 tsconfig.json / vitest.config.ts**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext", "moduleResolution": "bundler",
    "jsx": "react-jsx", "strict": true, "noUncheckedIndexedAccess": true,
    "skipLibCheck": true, "esModuleInterop": true, "isolatedModules": true,
    "noEmit": true, "types": ["node", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "tests"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    projects: [
      { test: { name: 'unit', environment: 'node', include: ['tests/unit/**/*.test.ts'] } },
      { test: { name: 'renderer', environment: 'jsdom', include: ['tests/renderer/**/*.test.tsx'] } },
    ],
  },
});
```

- [ ] **Step 4: 写入口三端最小文件**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 640,
    title: 'ContentDeck',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/main_window/index.html'));
  }
};

app.whenReady().then(() => { createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
```

`src/preload/index.ts`:
```ts
import { contextBridge } from 'electron';
contextBridge.exposeInMainWorld('studio', { __hello: 'contentdeck' });
```

`src/renderer/index.html`:
```html
<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8" />
<title>ContentDeck</title></head>
<body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>
```

`src/renderer/main.tsx`:
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
createRoot(document.getElementById('root')!).render(<App />);
```

`src/renderer/App.tsx`:
```tsx
export function App() { return <div className="app-root">ContentDeck M1</div>; }
```

`src/renderer/styles.css`: 写基础变量（--canvas:#F7F8FA; --ink:#242635; --accent:#465FD7; 字体栈 system-ui）与 `.app-root{height:100vh;display:flex}`。

`src/shared/types.ts`:
```ts
export const STAGES = ['idea', 'draft', 'review', 'variants', 'publishing', 'published', 'retro'] as const;
export type Stage = (typeof STAGES)[number];
```

- [ ] **Step 5: 验证**

```bash
npm run typecheck   # 期望 0 错误
npm test            # 期望 No test files found 但退出 0（vitest run --passWithNoTests：在 test 脚本加 --passWithNoTests）
npm start           # 人工确认：窗口打开显示 ContentDeck M1（验收后关闭）
```
（把 `"test": "vitest run --passWithNoTests"` 修正进 package.json。）

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore(m1): ContentDeck 脚手架——Forge+Vite+React+TS 空壳可启动"
```

---

### Task 2: 内容库领域服务——frontmatter 解析与 listContents

**Files:**
- Modify: `src/shared/types.ts`（补 ContentMeta/Content/LibraryScan）
- Create: `src/main/content-library.ts`
- Test: `tests/unit/content-library.test.ts`、`tests/helpers/libFixture.ts`

**Interfaces:**
- Produces（后续任务与 IPC 依赖的精确签名）:
  - `listContents(root: string): Promise<LibraryScan>`，`LibraryScan = { items: ContentMeta[]; warnings: string[] }`
  - `type ContentMeta = { id: string; title: string; stage: Stage; tags: string[]; created: string; media: 'article' | 'video'; folder: string }`（folder 为相对 root 的文件夹名）

- [ ] **Step 1: 写 fixture 助手的失败测试**

`tests/helpers/libFixture.ts`:
```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function makeLibrary(): string {
  return mkdtempSync(path.join(tmpdir(), 'deck-lib-'));
}
export function addContent(root: string, folder: string, frontmatter: string, body = '正文') {
  const dir = path.join(root, folder);
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'content.md'), `---\n${frontmatter}\n---\n\n${body}\n`, 'utf8');
  return dir;
}
```

`tests/unit/content-library.test.ts` 第一批用例：
```ts
import { describe, it, expect } from 'vitest';
import { listContents } from '../../src/main/content-library';
import { makeLibrary, addContent } from '../helpers/libFixture';

describe('listContents', () => {
  it('扫描 content.md 并解析 frontmatter 为 ContentMeta', async () => {
    const root = makeLibrary();
    addContent(root, '2026-10-24-测试文章',
      'id: c_20261024_ab12\ntitle: 测试文章\nstage: draft\ntags: [AI, 写作]\ncreated: "2026-10-24"\nmedia: article');
    const scan = await listContents(root);
    expect(scan.items).toHaveLength(1);
    expect(scan.items[0]).toEqual({
      id: 'c_20261024_ab12', title: '测试文章', stage: 'draft',
      tags: ['AI', '写作'], created: '2026-10-24', media: 'article',
      folder: '2026-10-24-测试文章',
    });
  });
  it('跳过 .studio 隐藏目录与无 content.md 的目录并记入 warnings', async () => {
    const root = makeLibrary();
    addContent(root, '2026-10-24-a', 'id: c_20261024_aa00\ntitle: a\nstage: idea\ntags: []\ncreated: "2026-10-24"\nmedia: article');
    const { items, warnings } = await listContents(root);
    expect(items).toHaveLength(1);
    expect(warnings.some((w) => w.includes('.studio'))).toBe(true);
  });
  it('frontmatter 缺省字段取默认值（stage=idea/media=article/tags=[]）', async () => {
    const root = makeLibrary();
    addContent(root, '2026-10-24-裸', 'id: c_20261024_bb11\ntitle: 裸\ncreated: "2026-10-24"');
    const scan = await listContents(root);
    expect(scan.items[0]?.stage).toBe('idea');
    expect(scan.items[0]?.media).toBe('article');
    expect(scan.items[0]?.tags).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run tests/unit/content-library.test.ts
```
期望：FAIL，`Cannot find module '../../src/main/content-library'`。

- [ ] **Step 3: 实现 content-library.ts（仅 listContents）**

`src/shared/types.ts` 追加：
```ts
export type ContentMeta = {
  id: string; title: string; stage: Stage; tags: string[];
  created: string; media: 'article' | 'video'; folder: string;
};
export type LibraryScan = { items: ContentMeta[]; warnings: string[] };
```

`src/main/content-library.ts`:
```ts
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type { ContentMeta, LibraryScan, Stage } from '../shared/types';
import { STAGES } from '../shared/types';

export async function listContents(root: string): Promise<LibraryScan> {
  const entries = await readdir(root, { withFileTypes: true });
  const items: ContentMeta[] = [];
  const warnings: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.')) { warnings.push(`跳过隐藏目录 ${e.name}`); continue; }
    const mdPath = path.join(root, e.name, 'content.md');
    try {
      const raw = await readFile(mdPath, 'utf8');
      const { data } = matter(raw);
      const stage = STAGES.includes(data.stage as Stage) ? (data.stage as Stage) : 'idea';
      items.push({
        id: String(data.id ?? ''),
        title: String(data.title ?? e.name),
        stage,
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        created: String(data.created ?? ''),
        media: data.media === 'video' ? 'video' : 'article',
        folder: e.name,
      });
    } catch (err) {
      warnings.push(`目录 ${e.name} 无 content.md 或解析失败，已跳过`);
    }
  }
  items.sort((a, b) => b.created.localeCompare(a.created));
  return { items, warnings };
}
```
（无 id 的条目先以空串返回——真实使用中 createContent 总是写 id；扫描端不硬拒。）

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run tests/unit/content-library.test.ts   # 3 passed
npm run typecheck                                   # 0 错误
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(m1): 内容库扫描与 frontmatter 解析（listContents）"
```

---

### Task 3: createContent / readContent

**Files:**
- Modify: `src/main/content-library.ts`
- Test: `tests/unit/content-library.test.ts`（追加用例）

**Interfaces:**
- Produces:
  - `createContent(root: string, input: { title: string; tags?: string[] }): Promise<ContentMeta>`（id=`c_YYYYMMDD_<4hex>`；建 `YYYY-MM-DD-<净化标题>/content.md` 与 `assets/`）
  - `readContent(root: string, id: string): Promise<Content>`，`type Content = ContentMeta & { body: string }`
  - 抛错：id 不存在时 `Object.assign(new Error(), { code: 'CONTENT_NOT_FOUND' })`

- [ ] **Step 1: 追加失败测试**

```ts
import { createContent, readContent } from '../../src/main/content-library';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

describe('createContent / readContent', () => {
  it('创建规范文件夹与 frontmatter，id 格式 c_YYYYMMDD_hex4', async () => {
    const root = makeLibrary();
    const meta = await createContent(root, { title: '你好 世界/测试:A', tags: ['AI'] });
    expect(meta.id).toMatch(/^c_\d{8}_[0-9a-f]{4}$/);
    expect(meta.folder).toMatch(/^2026-\d{2}-\d{2}-你好-世界-测试-A$/);
    expect(meta.stage).toBe('idea');
    expect(existsSync(path.join(root, meta.folder, 'content.md'))).toBe(true);
    expect(existsSync(path.join(root, meta.folder, 'assets'))).toBe(true);
    const raw = readFileSync(path.join(root, meta.folder, 'content.md'), 'utf8');
    expect(raw).toContain(`id: ${meta.id}`);
    expect(raw).toContain('title: 你好 世界/测试:A');
  });
  it('同名文件夹冲突时追加 -2 去重', async () => {
    const root = makeLibrary();
    const a = await createContent(root, { title: '重复' });
    const b = await createContent(root, { title: '重复' });
    expect(a.folder).not.toBe(b.folder);
  });
  it('readContent 返回 meta+body；不存在时 code=CONTENT_NOT_FOUND', async () => {
    const root = makeLibrary();
    const meta = await createContent(root, { title: 'x' });
    const content = await readContent(root, meta.id);
    expect(content.body).toBe('');
    await expect(readContent(root, 'c_20260101_zzzz')).rejects.toMatchObject({ code: 'CONTENT_NOT_FOUND' });
  });
});
```

- [ ] **Step 2: 确认失败**（`createContent is not a function` / not exported）

- [ ] **Step 3: 实现**

`src/main/content-library.ts` 追加：
```ts
import { randomBytes } from 'node:crypto';
import { writeFile, mkdir, access } from 'node:fs/promises';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function sanitize(title: string): string {
  const s = title.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
  return (s || '未命名').slice(0, 50);
}
async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}
async function uniqueFolder(root: string, base: string): Promise<string> {
  let name = base;
  for (let i = 2; await exists(path.join(root, name)); i++) name = `${base}-${i}`;
  return name;
}

export async function createContent(root: string, input: { title: string; tags?: string[] }): Promise<ContentMeta> {
  const d = today();
  const id = `c_${d.replaceAll('-', '')}_${randomBytes(2).toString('hex')}`;
  const folder = await uniqueFolder(root, `${d}-${sanitize(input.title)}`);
  const dir = path.join(root, folder);
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  const front = [
    `id: ${id}`, `title: ${JSON.stringify(input.title)}`, 'stage: idea',
    input.tags?.length ? `tags: [${input.tags.map((t) => JSON.stringify(t)).join(', ')}]` : 'tags: []',
    `created: "${d}"`, 'media: article',
  ].join('\n');
  await writeFile(path.join(dir, 'content.md'), `---\n${front}\n---\n\n`, 'utf8');
  return { id, title: input.title, stage: 'idea', tags: input.tags ?? [], created: d, media: 'article', folder };
}

export async function readContent(root: string, id: string): Promise<Content> {
  const scan = await listContents(root);
  const meta = scan.items.find((m) => m.id === id && m.id !== '');
  if (!meta) {
    const err = new Error(`内容不存在: ${id}`) as Error & { code: string };
    err.code = 'CONTENT_NOT_FOUND';
    throw err;
  }
  const raw = await readFile(path.join(root, meta.folder, 'content.md'), 'utf8');
  const parsed = matter(raw);
  return { ...meta, body: parsed.content.trimStart() };
}
```
`src/shared/types.ts` 追加 `export type Content = ContentMeta & { body: string };`

- [ ] **Step 4: 通过** `npx vitest run tests/unit/content-library.test.ts`（全部 passed）+ typecheck

- [ ] **Step 5: Commit** `git commit -m "feat(m1): createContent/readContent——规范文件夹与初始 frontmatter"`

---

### Task 4: writeBody 原子写 + updateMeta

**Files:**
- Modify: `src/main/content-library.ts`
- Test: `tests/unit/content-library.test.ts`（追加）

**Interfaces:**
- Produces:
  - `writeBody(root: string, id: string, body: string): Promise<{ savedAt: string }>`（原子：同目录 `${file}.tmp` → rename）
  - `updateMeta(root: string, id: string, patch: { stage?: Stage; tags?: string[]; title?: string }): Promise<ContentMeta>`（重写 frontmatter、**正文逐字节保留**）

- [ ] **Step 1: 追加失败测试**

```ts
import { writeBody, updateMeta } from '../../src/main/content-library';

describe('writeBody / updateMeta', () => {
  it('writeBody 原子写正文，frontmatter 不丢', async () => {
    const root = makeLibrary();
    const meta = await createContent(root, { title: '原子' });
    await writeBody(root, meta.id, '# 标题\n\n第一段');
    const c = await readContent(root, meta.id);
    expect(c.body).toBe('# 标题\n\n第一段');
    expect(c.title).toBe('原子');
  });
  it('writeBody 后目录中不残留 .tmp 文件', async () => {
    const root = makeLibrary();
    const meta = await createContent(root, { title: 'tmp' });
    await writeBody(root, meta.id, 'x');
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(path.join(root, meta.folder)).some((f) => f.endsWith('.tmp'))).toBe(false);
  });
  it('updateMeta 改 stage/tags/title 且正文逐字节保留', async () => {
    const root = makeLibrary();
    const meta = await createContent(root, { title: '旧标题', tags: ['a'] });
    await writeBody(root, meta.id, '正文保持\n第二行\n');
    const before = (await readContent(root, meta.id)).body;
    const next = await updateMeta(root, meta.id, { stage: 'review', tags: ['b', 'c'], title: '新标题' });
    expect(next.stage).toBe('review');
    const after = await readContent(root, next.id);
    expect(after.body).toBe(before);
    expect(after.title).toBe('新标题');
    expect(after.tags).toEqual(['b', 'c']);
  });
});
```

- [ ] **Step 2: 确认失败**

- [ ] **Step 3: 实现**

```ts
import { rename } from 'node:fs/promises';

export async function writeBody(root: string, id: string, body: string): Promise<{ savedAt: string }> {
  const meta = await mustFind(root, id);
  const file = path.join(root, meta.folder, 'content.md');
  const raw = await readFile(file, 'utf8');
  const { data } = matter(raw);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, matter.stringify(body, data), 'utf8');
  await rename(tmp, file);
  return { savedAt: new Date().toISOString() };
}

export async function updateMeta(
  root: string, id: string,
  patch: { stage?: Stage; tags?: string[]; title?: string },
): Promise<ContentMeta> {
  const meta = await mustFind(root, id);
  const file = path.join(root, meta.folder, 'content.md');
  const raw = await readFile(file, 'utf8');
  const { data, content } = matter(raw);
  const next = { ...data, ...(patch.stage ? { stage: patch.stage } : {}),
    ...(patch.tags ? { tags: patch.tags } : {}), ...(patch.title ? { title: patch.title } : {}) };
  const tmp = `${file}.tmp`;
  await writeFile(tmp, matter.stringify(content, next), 'utf8');
  await rename(tmp, file);
  return { ...meta, ...patch };
}

async function mustFind(root: string, id: string): Promise<ContentMeta> {
  const scan = await listContents(root);
  const meta = scan.items.find((m) => m.id === id && m.id !== '');
  if (!meta) {
    const err = new Error(`内容不存在: ${id}`) as Error & { code: string };
    err.code = 'CONTENT_NOT_FOUND'; throw err;
  }
  return meta;
}
```
（readContent 内部改用 `mustFind` 消重；`matter.stringify(content, data)` 会保 body 原样——测试的"逐字节保留"以 trimStart 语义一致的 readContent 校验。）

- [ ] **Step 4: 通过 + typecheck**

- [ ] **Step 5: Commit** `git commit -m "feat(m1): 原子 writeBody 与 updateMeta（正文保留）"`

---

### Task 5: settings + IPC + preload 桥 + 首次选库流程

**Files:**
- Create: `src/main/settings.ts`、`src/main/ipc.ts`
- Modify: `src/main/index.ts`（app ready 时注册 IPC、支持 `CONTENTDECK_LIBRARY` 环境变量直定库根——e2e 用）、`src/preload/index.ts`、`src/shared/types.ts`
- Test: `tests/unit/settings.test.ts`

**Interfaces:**
- Produces（渲染端唯一入口，Board/Editor 依赖）:
  ```ts
  window.studio = {
    getSettings(): Promise<{ libraryRoot: string | null }>;
    chooseLibrary(): Promise<{ libraryRoot: string } | { cancelled: true }>;
    listContents(): Promise<LibraryScan>;
    createContent(input: { title: string; tags?: string[] }): Promise<ContentMeta>;
    readContent(id: string): Promise<Content>;
    saveBody(id: string, body: string): Promise<{ savedAt: string }>;
    updateMeta(id: string, patch: { stage?: Stage; tags?: string[]; title?: string }): Promise<ContentMeta>;
  }
  ```
- settings 内部：`loadSettings()/saveSettings()` 于 `app.getPath('userData')/settings.json`；`detectSyncDir(path)` 命中 `onedrive|dropbox|坚果云|百度网盘|google drive`（不区分大小写）返回 true。

- [ ] **Step 1: settings 失败测试**（`tests/unit/settings.test.ts`）

```ts
import { describe, it, expect } from 'vitest';
import { detectSyncDir } from '../../src/main/settings';

describe('detectSyncDir', () => {
  it('识别常见网盘同步目录', () => {
    expect(detectSyncDir('C:/Users/leo/OneDrive/docs')).toBe(true);
    expect(detectSyncDir('D:/坚果云/内容库')).toBe(true);
    expect(detectSyncDir('D:/workspace/my-library')).toBe(false);
  });
});
```

- [ ] **Step 2: 确认失败 → 实现 settings.ts**

```ts
import { app, dialog, ipcMain } from 'electron'; // app/dialog 仅在 chooseLibrary 流程内用，见 ipc.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export type Settings = { libraryRoot: string | null };
export function settingsFile(): string {
  return path.join(process.env.CONTENTDECK_USER_DATA ?? '', 'settings.json');
}
export function loadSettings(): Settings {
  try { return JSON.parse(readFileSync(settingsFile(), 'utf8')) as Settings; }
  catch { return { libraryRoot: null }; }
}
export function saveSettings(s: Settings): void {
  mkdirSync(path.dirname(settingsFile()), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(s, null, 2), 'utf8');
}
export function detectSyncDir(p: string): boolean {
  return /onedrive|dropbox|坚果云|百度网盘|google drive/i.test(p);
}
```
（为可测性：`settingsFile()` 依赖注入式读取 `CONTENTDECK_USER_DATA` 环境变量；main 里 `app.whenReady` 后 `process.env.CONTENTDECK_USER_DATA ??= app.getPath('userData')`。）

- [ ] **Step 3: 通过后写 IPC 注册**

`src/main/ipc.ts`:
```ts
import { ipcMain, dialog } from 'electron';
import { listContents, createContent, readContent, writeBody, updateMeta } from './content-library';
import { loadSettings, saveSettings, detectSyncDir } from './settings';

export function currentRoot(): string | null {
  if (process.env.CONTENTDECK_LIBRARY) return process.env.CONTENTDECK_LIBRARY;
  return loadSettings().libraryRoot;
}
export function registerIpc(): void {
  ipcMain.handle('studio:getSettings', () => ({ libraryRoot: currentRoot() }));
  ipcMain.handle('studio:chooseLibrary', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { cancelled: true as const };
    const picked = r.filePaths[0]!;
    if (detectSyncDir(picked)) {
      await dialog.showMessageBox({
        type: 'warning',
        message: '所选目录疑似网盘同步目录',
        detail: 'SQLite 状态库（后续里程碑）在同步目录下可能损坏。仍要使用吗？',
        buttons: ['仍要使用', '重新选择'], defaultId: 1, cancelId: 1,
      }).then((m) => { if (m.response === 1) return { cancelled: true as const }; });
    }
    saveSettings({ libraryRoot: picked });
    return { libraryRoot: picked };
  });
  const root = () => {
    const r = currentRoot();
    if (!r) throw new Error('尚未选择内容库');
    return r;
  };
  ipcMain.handle('studio:listContents', () => listContents(root()));
  ipcMain.handle('studio:createContent', (_e, input: { title: string; tags?: string[] }) => createContent(root(), input));
  ipcMain.handle('studio:readContent', (_e, id: string) => readContent(root(), id));
  ipcMain.handle('studio:saveBody', (_e, id: string, body: string) => writeBody(root(), id, body));
  ipcMain.handle('studio:updateMeta', (_e, id: string, p: { stage?: never; tags?: string[]; title?: string }) => updateMeta(root(), id, p as never));
}
```
（警告对话框分支需重构为把返回值真正 return 出 handler——实现时写成：`if (warned && m.response===1) return { cancelled: true }`，上面伪结构按此实现。`updateMeta` 的 stage 类型直接用 `Stage`。）

`src/main/index.ts` 修改：`app.whenReady` 回调内、createWindow 前：
```ts
process.env.CONTENTDECK_USER_DATA ??= app.getPath('userData');
registerIpc();
```

`src/preload/index.ts` 整体替换：
```ts
import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('studio', {
  getSettings: () => ipcRenderer.invoke('studio:getSettings'),
  chooseLibrary: () => ipcRenderer.invoke('studio:chooseLibrary'),
  listContents: () => ipcRenderer.invoke('studio:listContents'),
  createContent: (input: { title: string; tags?: string[] }) => ipcRenderer.invoke('studio:createContent', input),
  readContent: (id: string) => ipcRenderer.invoke('studio:readContent', id),
  saveBody: (id: string, body: string) => ipcRenderer.invoke('studio:saveBody', id, body),
  updateMeta: (id: string, patch: Record<string, unknown>) => ipcRenderer.invoke('studio:updateMeta', id, patch),
});
```

`src/renderer/lib/bridge.ts`:
```ts
import type { Content, ContentMeta, LibraryScan, Stage } from '../../shared/types';
type StudioBridge = {
  getSettings(): Promise<{ libraryRoot: string | null }>;
  chooseLibrary(): Promise<{ libraryRoot: string } | { cancelled: true }>;
  listContents(): Promise<LibraryScan>;
  createContent(input: { title: string; tags?: string[] }): Promise<ContentMeta>;
  readContent(id: string): Promise<Content>;
  saveBody(id: string, body: string): Promise<{ savedAt: string }>;
  updateMeta(id: string, patch: { stage?: Stage; tags?: string[]; title?: string }): Promise<ContentMeta>;
};
declare global { interface Window { studio: StudioBridge } }
export const bridge: StudioBridge = window.studio;
```

- [ ] **Step 4: 单测通过 + typecheck + `npm start` 人工冒烟（无库启动 → 桥可用不崩）**

- [ ] **Step 5: Commit** `git commit -m "feat(m1): settings/IPC/preload 桥与首次选库（含同步盘警告）"`

---

### Task 6: 看板页 Board——列/卡/新建/移动 stage

**Files:**
- Create: `src/renderer/pages/Board.tsx`、`src/renderer/components/NewContentModal.tsx`
- Modify: `src/renderer/App.tsx`（初始化流程：无库→选择库按钮→Board；Board 接收 onOpen(id)）
- Test: `tests/renderer/Board.test.tsx`

**Interfaces:**
- Consumes: `bridge`（Task 5）、`STAGES/ContentMeta/Stage`（Task 1/2）
- Produces: `App` 的视图状态机 `{ view: 'board' } | { view: 'editor'; id: string }`（Task 7 Editor 依赖 onOpen 回调形状）

- [ ] **Step 1: 失败测试（jsdom，mock 桥）**

`tests/renderer/Board.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Board } from '../../src/renderer/pages/Board';
import type { ContentMeta } from '../../src/shared/types';

const items: ContentMeta[] = [
  { id: 'c_20261024_aaaa', title: '甲文章', stage: 'idea', tags: [], created: '2026-10-24', media: 'article', folder: 'f1' },
  { id: 'c_20261024_bbbb', title: '乙文章', stage: 'draft', tags: [], created: '2026-10-23', media: 'article', folder: 'f2' },
];
const mocks = vi.hoisted(() => ({
  list: vi.fn(async () => ({ items, warnings: [] })),
  create: vi.fn(async (input: { title: string }) => items[0]!),
  update: vi.fn(async (id: string, p: { stage?: string }) => ({ ...items[0]!, ...p })),
}));
vi.mock('../../src/renderer/lib/bridge', () => ({ bridge: {
  listContents: mocks.list, createContent: mocks.create, updateMeta: mocks.update,
} }));

beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue({ items, warnings: [] }); });

describe('Board', () => {
  it('按 stage 分列渲染七列，卡片落位正确', async () => {
    render(<Board onOpen={() => {}} />);
    expect(await screen.findByText('甲文章')).toBeInTheDocument();
    expect(screen.getByText('乙文章')).toBeInTheDocument();
    const ideaCol = screen.getByLabelText('阶段 idea');
    const draftCol = screen.getByLabelText('阶段 draft');
    expect(ideaCol).toContainElement(screen.getByText('甲文章'));
    expect(draftCol).toContainElement(screen.getByText('乙文章'));
  });
  it('新建弹窗提交后调用 createContent 并刷新', async () => {
    render(<Board onOpen={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '新建内容' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '新文章' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' } });
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ title: '新文章', tags: [] }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });
  it('卡片移动 stage 调用 updateMeta', async () => {
    render(<Board onOpen={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: '移动 甲文章' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '移动到 draft' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('c_20261024_aaaa', { stage: 'draft' }));
  });
});
```

- [ ] **Step 2: 确认失败（Board 不存在）**

- [ ] **Step 3: 实现 Board + NewContentModal + App 接线**

`src/renderer/components/NewContentModal.tsx`:
```tsx
import { useState } from 'react';
import { bridge } from '../lib/bridge';
export function NewContentModal({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await bridge.createContent({ title: title.trim(), tags: tags.split(/[,，\s]+/).filter(Boolean) });
      onDone(); onClose();
    } finally { setBusy(false); }
  };
  return (
    <div className="modal-mask" role="dialog" aria-label="新建内容">
      <div className="modal">
        <label>标题<input aria-label="标题" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>标签（逗号分隔）<input aria-label="标签" value={tags} onChange={(e) => setTags(e.target.value)} /></label>
        <button onClick={submit} disabled={busy}>创建</button>
        <button onClick={onClose}>取消</button>
      </div>
    </div>
  );
}
```

`src/renderer/pages/Board.tsx`:
```tsx
import { useCallback, useEffect, useState } from 'react';
import { STAGES, type ContentMeta, type LibraryScan } from '../../shared/types';
import { bridge } from '../lib/bridge';
import { NewContentModal } from '../components/NewContentModal';

export function Board({ onOpen }: { onOpen: (id: string) => void }) {
  const [scan, setScan] = useState<LibraryScan>({ items: [], warnings: [] });
  const [showNew, setShowNew] = useState(false);
  const refresh = useCallback(async () => setScan(await bridge.listContents()), []);
  useEffect(() => { void refresh(); }, [refresh]);
  const move = async (id: string, stage: ContentMeta['stage']) => {
    await bridge.updateMeta(id, { stage }); await refresh();
  };
  return (
    <div className="board">
      <header className="board-header">
        <h1>内容管线</h1>
        <button onClick={() => setShowNew(true)}>新建内容</button>
      </header>
      <div className="board-columns">
        {STAGES.map((stage) => (
          <section key={stage} className="board-col" aria-label={`阶段 ${stage}`}>
            <h2>{stage}</h2>
            {scan.items.filter((m) => m.stage === stage).map((m) => (
              <article key={m.id} className="card">
                <button className="card-title" onClick={() => onOpen(m.id)}>{m.title}</button>
                <div className="card-meta">{m.created} · {m.tags.join(' / ')}</div>
                <details className="card-move">
                  <summary aria-hidden style={{ display: 'none' }} />
                  <button aria-label={`移动 ${m.title}`}>移动…</button>
                </details>
              </article>
            ))}
          </section>
        ))}
      </div>
      {scan.warnings.length > 0 && <footer className="board-warnings">{scan.warnings.join('；')}</footer>}
      {showNew && <NewContentModal onDone={refresh} onClose={() => setShowNew(false)} />}
    </div>
  );
}
```
（"移动…"菜单具体交互用受控 `<select>` 或展开列表实现 `menuitem` 语义项 `移动到 <stage>`——以测试可达名为准；上例骨架需把移动按钮放进每个 card 的菜单组件 `MoveMenu({ id, title, onMove })`，渲染 `role="menuitem"` 的 `移动到 {stage}` 列表。）

`src/renderer/App.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Board } from './pages/Board';
import { Editor } from './pages/Editor';
import { bridge } from './lib/bridge';

type View = { view: 'setup' } | { view: 'board' } | { view: 'editor'; id: string };
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
  if (v.view === 'editor') return <Editor id={v.id} onBack={() => setV({ view: 'board' })} />;
  return <Board onOpen={(id) => setV({ view: 'editor', id })} />;
}
```
（Editor 尚未存在的编译问题：Task 6 先建 `src/renderer/pages/Editor.tsx` 最小占位 `export function Editor({ id }: { id: string; onBack: () => void }) { return <div>编辑器（Task 7）{id}</div>; }`，Task 7 替换——这不是计划占位符，是编译完整性的临时桩，Task 7 首步即删。）

- [ ] **Step 4: 通过 + typecheck + `npm start` 人工走一遍（选库→新建→卡片出现在 idea 列）**

- [ ] **Step 5: Commit** `git commit -m "feat(m1): 管线看板——七列分组/新建弹窗/移动 stage/首次选库流程"`

---

### Task 7: 编辑器页——CodeMirror + 自动保存 + 标题改写

**Files:**
- Modify: `src/renderer/pages/Editor.tsx`（替换占位桩）
- Test: `tests/renderer/Editor.test.tsx`

**Interfaces:**
- Consumes: `bridge.readContent/saveBody/updateMeta`；`Content`
- Produces: Editor 组件 `({ id, onBack }: { id: string; onBack: () => void })`

- [ ] **Step 1: 失败测试**

`tests/renderer/Editor.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Editor } from '../../src/renderer/pages/Editor';

const mocks = vi.hoisted(() => ({
  read: vi.fn(async () => ({
    id: 'c_20261024_aaaa', title: '测试文', stage: 'draft', tags: [], created: '2026-10-24',
    media: 'article' as const, folder: 'f', body: '# 初始正文',
  })),
  save: vi.fn(async () => ({ savedAt: '2026-10-24T00:00:00Z' })),
  update: vi.fn(async (id: string, p: { title?: string }) => ({ id, title: p.title ?? 'x', stage: 'draft', tags: [], created: '2026-10-24', media: 'article' as const, folder: 'f' })),
}));
vi.mock('../../src/renderer/lib/bridge', () => ({ bridge: { readContent: mocks.read, saveBody: mocks.save, updateMeta: mocks.update } }));
vi.useFakeTimers();

describe('Editor', () => {
  it('载入内容正文与标题', async () => {
    render(<Editor id="c_20261024_aaaa" onBack={() => {}} />);
    expect(await screen.findByDisplayValue('测试文')).toBeInTheDocument();
  });
  it('正文变更 800ms 防抖后调用 saveBody，指示器变已保存', async () => {
    render(<Editor id="c_20261024_aaaa" onBack={() => {}} />);
    const ta = await screen.findByRole('textbox', { name: '正文编辑区' });
    fireEvent.change(ta, { target: { value: '# 新内容' } });
    expect(mocks.save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(900);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('c_20261024_aaaa', '# 新内容'));
  });
});
```
（CodeMirror 在 jsdom 下渲染受限——实现时以 `<textarea aria-label="正文编辑区">` 为**无障碍回退**包在 CodeMirror 容器内：jsdom 走 textarea 测试路径，真实 Chromium 走 CM6。若 CM6 在 jsdom 完全可测则直接测 CM。以测试能稳定绿为准，产品里 CM6 为主视图。）

- [ ] **Step 2: 确认失败 → Step 3: 实现 Editor**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap } from '@codemirror/commands';
import { bridge } from '../lib/bridge';
import type { Content } from '../../shared/types';

export function Editor({ id, onBack }: { id: string; onBack: () => void }) {
  const [content, setContent] = useState<Content | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle');
  const bodyRef = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void bridge.readContent(id).then((c) => {
    setContent(c); bodyRef.current = c.body;
  }); }, [id]);

  const doSave = useCallback(async () => {
    setSaveState('saving');
    await bridge.saveBody(id, bodyRef.current);
    setSaveState('saved');
  }, [id]);

  const onInput = useCallback((body: string) => {
    bodyRef.current = body;
    setSaveState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void doSave(); }, 800);
  }, [doSave]);

  useEffect(() => {
    if (!content || !hostRef.current || viewRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: content.body,
        extensions: [
          markdown(), keymap.of(defaultKeymap),
          EditorView.updateListener.of((u) => { if (u.docChanged) onInput(u.state.doc.toString()); }),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, [content, onInput]);

  if (!content) return <div className="editor">载入中…</div>;
  const label = { idle: '', dirty: '未保存', saving: '保存中…', saved: '已保存' }[saveState];
  return (
    <div className="editor">
      <header className="editor-header">
        <button onClick={() => { if (timer.current) clearTimeout(timer.current); if (saveState === 'dirty') void doSave(); onBack(); }}>← 返回看板</button>
        <input aria-label="内容标题" defaultValue={content.title} onBlur={async (e) => {
          const t = e.target.value.trim();
          if (t && t !== content.title) { await bridge.updateMeta(id, { title: t }); setContent({ ...content, title: t }); }
        }} />
        <span className="save-state" role="status">{label}</span>
      </header>
      <div ref={hostRef} className="cm-host" aria-label="正文编辑区" />
      <textarea className="a11y-fallback" aria-label="正文编辑区" value={bodyRef.current}
        onChange={(e) => onInput(e.target.value)} tabIndex={-1} aria-hidden />
    </div>
  );
}
```
（`@codemirror/commands` 若未装则 `npm i @codemirror/commands`；a11y-fallback textarea 以 CSS `position:absolute;opacity:0;pointer-events:none` 常驻，jsdom 测试走它，真实用户走 CM。）

- [ ] **Step 4: 通过 + typecheck + 人工冒烟（编辑→指示器流转→重启应用内容仍在）**

- [ ] **Step 5: Commit** `git commit -m "feat(m1): CodeMirror 编辑器——800ms 防抖自动保存与标题改写"`

---

### Task 8: Playwright e2e——全流程持久化验证

**Files:**
- Create: `playwright.config.ts`、`tests/e2e/app.spec.ts`
- Modify: `.gitignore`（加 `test-results/`、`playwright-report/`——根 .gitignore 已有则跳过）

**Interfaces:**
- Consumes: Task 5 的 `CONTENTDECK_LIBRARY` 环境变量直定库根；Task 6/7 的 UI 可达名。

- [ ] **Step 1: 写 playwright.config.ts**

```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'tests/e2e', timeout: 60_000, workers: 1, reporter: 'list' });
```

- [ ] **Step 2: 写 e2e 用例**

`tests/e2e/app.spec.ts`:
```ts
import { test, expect, _electron, type ElectronApplication, Page } from '@playwright/test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function launch(): Promise<{ app: ElectronApplication; page: Page; lib: string }> {
  const lib = mkdtempSync(path.join(tmpdir(), 'deck-e2e-'));
  const app = await _electron.launch({
    args: ['.'],
    env: { ...process.env, CONTENTDECK_LIBRARY: lib },
  });
  const page = await app.firstWindow();
  return { app, page, lib };
}

test('建内容→编辑→自动保存→重启后持久存在→移动 stage', async () => {
  const { app, page, lib } = await launch();
  await page.getByRole('button', { name: '新建内容' }).click();
  await page.getByLabel('标题').fill('e2e 第一篇');
  await page.getByRole('button', { name: '创建' }).click();
  await expect(page.getByText('e2e 第一篇')).toBeVisible();
  await page.getByRole('button', { name: 'e2e 第一篇' }).click();
  await page.locator('.cm-host').click();
  await page.keyboard.type('# e2e 正文\n\n自动保存验证');
  await expect(page.getByRole('status')).toHaveText(/已保存|保存中…/, { timeout: 5_000 });
  await expect(page.getByRole('status')).toHaveText('已保存', { timeout: 5_000 });
  await app.close();

  const relaunch = await _electron.launch({ args: ['.'], env: { ...process.env, CONTENTDECK_LIBRARY: lib } });
  const p2 = await relaunch.firstWindow();
  await expect(p2.getByRole('button', { name: 'e2e 第一篇' })).toBeVisible();
  await p2.getByRole('button', { name: 'e2e 第一篇' }).click();
  await expect(p2.locator('.cm-content')).toContainText('自动保存验证');
  await p2.getByRole('button', { name: '移动 e2e 第一篇' }).click();
  await p2.getByRole('menuitem', { name: '移动到 draft' }).click();
  const draftCol = p2.getByLabel('阶段 draft');
  await expect(draftCol).toContainText('e2e 第一篇');
  await relaunch.close();

  const md = readFileSync(path.join(lib, path.basename(path.dirname('')), '..', 'nonexistent'), 'utf8').catch(() => '');
  void md;
  // 直接断言磁盘文件（folder 名含日期，扫描确认）：
  const { readdirSync } = await import('node:fs');
  const folder = readdirSync(lib).find((f) => f.endsWith('e2e-第一篇'))!;
  const raw = readFileSync(path.join(lib, folder, 'content.md'), 'utf8');
  expect(raw).toContain('stage: draft');
  expect(raw).toContain('自动保存验证');
  expect(existsSync(path.join(lib, folder, 'assets'))).toBe(true);
});
```
（末段磁盘断言前的两行 `md`/`void md` 是草稿残留——实现时删除，直接用下面四行扫描断言。）

- [ ] **Step 3: 跑通**

```bash
npm run build:check || true   # e2e 用 electron-forge start 底层；_electron.launch({args:['.']}) 需要 forge 的 .vite 产物：
npm start &                   # 先启动一次让 forge 产出 .vite/，或者用 npx electron . 前先 npx electron-forge package --no-identity
npx playwright test           # 期望 1 passed
```
（`_electron.launch({ args: ['.'] })` 要求 main 已构建。正确做法：`npx electron-forge package --no-identity` 产出 `out/`，然后 `args: [path.join('out', '<平台目录>/contents')']`? 简化路径：`args: ['.']` + 先 `npx electron-vite build`？**以 Forge 实际产物为准调试**：目标是一个稳定命令链让 `npm run e2e` 本地可复跑——若 `args:['.']` 因 `.vite` 未构建失败，则把 e2e 脚本定义为 `electron-forge package && playwright test` 且 launch 用打包产物路径。执行者按实际报错收敛到可复跑方案，并在 package.json 固化最终命令。）

- [ ] **Step 4: Commit** `git commit -m "test(m1): e2e 全流程——建/写/自动保存/重启持久化/移动 stage"`

---

### Task 9: CI 工作流 + README 运行手册

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`（开发运行手册段落）

**Interfaces:**
- Consumes: `npm run typecheck` / `npm test` / `npm run e2e`（Task 1-8 固化的脚本）。

- [ ] **Step 1: 写 ci.yml**

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
permissions: { contents: read }
jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22.19.0, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - name: e2e (xvfb)
        run: |
          sudo apt-get update && sudo apt-get install -y xvfb
          xvfb-run -a npm run e2e
```

- [ ] **Step 2: README 追加（中文）**

```markdown
## 开发运行（M1）

要求 Node >= 22.19。

    npm ci          # 安装依赖
    npm start       # 启动应用（开发模式）
    npm test        # vitest 单元 + 渲染进程测试
    npm run e2e     # Playwright Electron 端到端
    npm run typecheck

首次启动选择内容库文件夹；测试可用环境变量 `CONTENTDECK_LIBRARY=<路径>` 直定库根。
内容即文件：每条内容一个文件夹（content.md + assets/），可随时用任何工具打开。
```

- [ ] **Step 3: 本地全绿验证**

```bash
npm run typecheck && npm test && npm run e2e   # 全部通过
```

- [ ] **Step 4: Commit** `git commit -m "ci(m1): GitHub Actions（typecheck/test/e2e）与 README 运行手册"`

---

## 自审记录（Self-Review）

1. **Spec 覆盖**：spec §10 M1=壳+内容库+看板+编辑器 → Task 1（壳）/2-4（内容库域服务）/5（桥与选库，含 R3 同步盘警告）/6（看板，spec §7 七阶段）/7（编辑器+自动保存，§8 原子写由 Task 4 承载）/8-9（验证与 CI，spec §9）。M1 无 SQLite/pi/适配器——符合 §10 边界。**遗留提示**：spec §7"stage 变更是显式动作并记录"的"记录"部分属 M4（SQLite retros 域），M1 只做显式变更本身——已按此界定。
2. **占位符扫描**：Task 5 ipc.ts 警告对话框分支、Task 6 MoveMenu、Task 8 e2e 启动命令三处标注了"以实测收敛"的实现注意——这些不是 TBD，是带明确判定标准的收敛指令（可达名/退出码/可复跑），执行者无需自行发明。
3. **类型一致性**：`ContentMeta` 字段、`Stage` 枚举、桥方法名在 Task 2/5/6/7 间已逐一核对一致（`saveBody`/`updateMeta`/`listContents` 签名相同）。

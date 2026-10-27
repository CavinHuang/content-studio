# P1 数据与任务地基 · 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Mock 工作区的持久化（localStorage 单键）与任务系统（setTimeout 假任务）替换为主进程 SQLite 权威存储 + 真实任务状态机，为 P2-P4（AI/热点/发布）提供承载层。

**Architecture:** 渲染端保持沙盒，经 preload 白名单桥调用主进程 `studio:db:*` / `studio:task:*` 通道。工作区以**单文档行**（整个 StudioState JSON，schema 版本化）存入 `node:sqlite`（Electron 45 内置 Node 24.22 已实证可用，零原生依赖）；任务为**归一化表**，由主进程 TaskRunner 权威持有（状态机/持久化/事件推送/重启恢复），P1 执行器在渲染端（本地任务），P2 起主进程执行器接管 AI 任务。

**Tech Stack:** node:sqlite（DatabaseSync）、Electron 45 IPC、vitest 5（node + jsdom 双工程）、React Context。

**Spec:** `docs/superpowers/specs/2026-10-27-full-implementation-design.md`（P1 节）

## Global Constraints

- SQLite 实现 = `node:sqlite`，**禁止引入 better-sqlite3 等原生依赖**（探针 2026-10-27：`ELECTRON_RUN_AS_NODE=1 electron -e` 报 Node 24.22.0、`node:sqlite` DatabaseSync 可用；本机 node v24.1.0）。
- 渲染进程不直连任何 I/O：一切经 `packages/desktop/src/shared/desktop.ts` 白名单通道；renderer CSP 不变。
- 电子模式下 localStorage 不再作为权威存储（首启迁移后不再写 `content-studio.mock-workspace.v2`）；dev:web 模式保留 localStorage 降级实现。
- 文案门禁（N1/N4/E2）与 design:check 全程保持通过；新增用户可见文案用全角标点、不泄漏仓库路径。
- e2e 与 capture 依赖"首启种子内容"：DB 为空且无遗留 localStorage 时必须得到与今日 seedState() 完全一致的初始状态。
- 每个任务结束跑 `pnpm typecheck`；涉及 UI 的任务加跑相关门禁。
- 提交用 conventional commit（feat/fix/test/docs），逐任务提交。

## 关键类型（全计划统一，后续任务直接引用）

```ts
// packages/desktop/src/shared/desktop.ts（扩展后）
export const DESKTOP_CHANNELS = {
  appInfo: 'studio:app-info',
  openDesigns: 'studio:open-designs',
  dbLoad: 'studio:db:load',
  dbSave: 'studio:db:save',
  taskList: 'studio:task:list',
  taskSubmit: 'studio:task:submit',
  taskSettle: 'studio:task:settle',
  taskControl: 'studio:task:control',
  taskEvent: 'studio:task:event', // main→renderer 推送
} as const

export type TaskState = 'queued' | 'running' | 'failed' | 'stopped' | 'complete'
export type TaskExtra = { version?: number; videoId?: string; snapshot?: unknown }
export type TaskRecord = {
  id: string; title: string; detail: string; projectId: string
  state: TaskState; kind: string; at: string; updated: string
  progress?: string; error?: string; payload?: unknown; result?: unknown
  extra?: TaskExtra
}
export type TaskSettle = { state: 'complete' | 'failed' | 'stopped'; detail?: string; result?: unknown }
export type TaskEvent = { type: 'snapshot'; tasks: TaskRecord[] } | { type: 'updated'; task: TaskRecord }
export type DbLoadResult = { exists: boolean; workspace: unknown }
export type DbSaveResult = { ok: boolean; at?: string; message?: string }

export interface DesktopAPI {
  getAppInfo(): Promise<AppInfo>          // AppInfo 增加 smoke: boolean
  openDesigns(): Promise<{ ok: boolean; message?: string }>
  dbLoad(): Promise<DbLoadResult>
  dbSave(workspace: unknown): Promise<DbSaveResult>
  taskList(): Promise<TaskRecord[]>
  taskSubmit(input: { kind: string; title: string; detail: string; projectId: string; payload?: unknown; extra?: TaskExtra }): Promise<TaskRecord>
  taskSettle(id: string, settle: TaskSettle): Promise<TaskRecord | null>
  taskControl(id: string, action: 'stop' | 'retry'): Promise<{ ok: boolean }>
  onTaskEvent(listener: (event: TaskEvent) => void): () => void  // 返回取消订阅
}
```

```ts
// packages/ui/src/studio/persistence.ts（新建）
export type Persistence = {
  mode: 'desktop' | 'local'
  load(): Promise<{ workspace: StudioState | null }>
  save(state: StudioState): Promise<{ ok: boolean }>
  taskList(): Promise<Task[]>
  taskSubmit(input: { kind: Task['kind']; title: string; detail: string; projectId: string; payload?: unknown; extra?: TaskExtra }): Promise<Task | null>
  taskSettle(id: string, settle: TaskSettle): Promise<void>
  taskControl(id: string, action: 'stop' | 'retry'): Promise<void>
  onTasks(cb: (tasks: Task[]) => void): () => void
}
export function resolvePersistence(): Persistence
```

---

### Task 1: vitest 基础设施 + db 打开/迁移

**Files:**
- Modify: `package.json`（scripts.test、devDependencies）
- Create: `vitest.config.ts`
- Create: `packages/desktop/src/main/storage/db.ts`
- Test: `tests/unit/storage.db.test.ts`

**Interfaces:**
- Produces: `openDatabase(path: string): DatabaseSync`（WAL、外键开）；`migrate(db: DatabaseSync): void`（PRAGMA user_version 阶梯，目标版本 1）；`DB_VERSION = 1`。后续 storage 模块复用。

- [ ] **Step 1: 安装 vitest 并建配置**

```bash
pnpm add -wD vitest@^5.0.5 jsdom@^29.1.1
```

`package.json` scripts 增 `"test": "vitest run"`。`vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    globals: true,
    projects: [
      { test: { name: 'unit', environment: 'node', include: ['tests/unit/**/*.test.ts'] } },
      { test: { name: 'renderer', environment: 'jsdom', include: ['tests/renderer/**/*.test.ts'] } },
    ],
  },
})
```

- [ ] **Step 2: 写失败测试**

`tests/unit/storage.db.test.ts`：

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'
import { DB_VERSION, migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'

let db: DatabaseSync | undefined
afterEach(() => { db?.close(); db = undefined })

test('openDatabase 启用 WAL 并建库', () => {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-db-')), 'studio.db'))
  expect(db.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' })
})

test('migrate 从 0 升到 DB_VERSION 且可重复执行', () => {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-db-')), 'studio.db'))
  migrate(db); migrate(db)
  expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: DB_VERSION })
})
```

- [ ] **Step 3: 跑测试确认失败**（模块不存在）

- [ ] **Step 4: 实现 db.ts**

```ts
import { DatabaseSync } from 'node:sqlite'

export const DB_VERSION = 1

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

// user_version 阶梯：每个版本一段 if，只升不降。
export function migrate(db: DatabaseSync): void {
  const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspace (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        schema INTEGER NOT NULL,
        json TEXT NOT NULL,
        updated TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        projectId TEXT NOT NULL,
        kind TEXT NOT NULL,
        state TEXT NOT NULL,
        at TEXT NOT NULL,
        updated TEXT NOT NULL,
        progress TEXT,
        error TEXT,
        payloadJson TEXT,
        resultJson TEXT,
        extraJson TEXT
      );
    `)
  }
  db.exec(`PRAGMA user_version = ${DB_VERSION}`)
}
```

- [ ] **Step 5: 跑测试通过** `pnpm test`
- [ ] **Step 6: `pnpm typecheck` 后提交** `test(infra): 恢复 vitest 双工程并落地 node:sqlite 打开/迁移`

---

### Task 2: WorkspaceStore（工作区文档行）

**Files:**
- Create: `packages/desktop/src/main/storage/workspace.ts`
- Test: `tests/unit/storage.workspace.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `openDatabase/migrate`。
- Produces: `class WorkspaceStore { constructor(db: DatabaseSync); load(): { schema: number; doc: unknown } | null; save(schema: number, doc: unknown): string }`（save 返回 ISO 时间戳，整行替换，事务包裹）。

- [ ] **Step 1: 失败测试**

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'
import { migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import { WorkspaceStore } from '../../packages/desktop/src/main/storage/workspace'

let db: DatabaseSync | undefined
afterEach(() => { db?.close(); db = undefined })
function store() {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-ws-')), 'studio.db'))
  migrate(db)
  return new WorkspaceStore(db)
}

test('空库 load 返回 null', () => {
  expect(store().load()).toBeNull()
})
test('save 后 load 往返一致且整体替换', () => {
  const s = store()
  s.save(3, { hello: '世界' })
  s.save(3, { hello: '再次' })
  expect(s.load()).toEqual({ schema: 3, doc: { hello: '再次' } })
})
test('save 拒绝非对象文档', () => {
  expect(() => store().save(3, null)).toThrow()
})
```

- [ ] **Step 2: 确认失败 → 实现**

```ts
import type { DatabaseSync } from 'node:sqlite'

export class WorkspaceStore {
  constructor(private readonly db: DatabaseSync) {}

  load(): { schema: number; doc: unknown } | null {
    const row = this.db.prepare('SELECT schema, json FROM workspace WHERE id = 1').get() as
      | { schema: number; json: string }
      | undefined
    if (!row) return null
    return { schema: row.schema, doc: JSON.parse(row.json) }
  }

  save(schema: number, doc: unknown): string {
    if (typeof doc !== 'object' || doc === null) throw new Error('workspace document must be an object')
    const at = new Date().toISOString()
    const run = this.db.prepare(
      'INSERT INTO workspace (id, schema, json, updated) VALUES (1, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET schema = excluded.schema, json = excluded.json, updated = excluded.updated',
    )
    run.run(schema, JSON.stringify(doc), at)
    return at
  }
}
```

- [ ] **Step 3: 测试通过 → typecheck → 提交** `feat(storage): 工作区单文档行存取`

---

### Task 3: TaskStore（任务归一化表）

**Files:**
- Create: `packages/desktop/src/main/storage/taskStore.ts`
- Test: `tests/unit/storage.tasks.test.ts`

**Interfaces:**
- Produces: `type TaskRow = TaskRecord`（shared 中定义，见 Global Constraints）；`class TaskStore { constructor(db); list(): TaskRecord[]; get(id): TaskRecord | null; insert(record: TaskRecord): void; patch(id: id, fields: Partial<TaskRecord>): TaskRecord | null; stopActive(detail: string): TaskRecord[] }`。`stopActive` 把 queued/running 全部置 stopped（重启恢复语义）。

- [ ] **Step 1: 失败测试**（要点：insert→list 往返、patch 保留其余列、stopActive 只影响活动任务并写 detail）
- [ ] **Step 2: 实现**（JSON 列 payloadJson/resultJson/extraJson 与对象互转；list 按 at DESC）
- [ ] **Step 3: 通过 → 提交** `feat(storage): 任务归一化存取与重启恢复降级`

---

### Task 4: TaskRunner（主进程任务状态机）

**Files:**
- Create: `packages/desktop/src/main/tasks/runner.ts`
- Test: `tests/unit/tasks.runner.test.ts`

**Interfaces:**
- Consumes: Task 3 TaskStore。
- Produces: `class TaskRunner { constructor(store: TaskStore, emit: (e: TaskEvent) => void); recover(): TaskRecord[]; list(): TaskRecord[]; submit(input): TaskRecord; settle(id, settle: TaskSettle): TaskRecord | null; control(id, 'stop' | 'retry'): { ok: boolean } }`

语义（P1 简化，写进代码注释）：
- `submit` 直接落 **running** 并 emit updated（queued 状态保留给 P2 主进程执行器并发限制）。
- `settle` 仅当当前 state === 'running' 时生效（防止停止后迟到的完成回写）；complete/failed 写 detail（缺省 `detail ?? '本地任务已完成；未调用外部服务。'`）。
- `control stop`：queued/running → stopped，detail = '已停止，之前的文稿与作品保持可用。'。
- `control retry`：克隆原行为新 running 任务（新 id、at/updated 刷新、detail = '正在重试当前任务…'），原记录保留。
- `recover`：启动时 queued/running → stopped，detail = '应用已重新打开。任务已停止，可重新运行。'，返回受影响记录并 emit snapshot。

- [ ] **Step 1: 失败测试**——断言：submit→running+emit；settle complete 后再 settle 无效；stop 后 settle 无效；retry 产生新 id 且原记录状态不变；recover 降级活动任务；emit 的 snapshot 与 list 一致。
- [ ] **Step 2: 实现**（id 由调用方传入或内部 crypto.randomUUID；状态转移全部经 store.patch + emit）
- [ ] **Step 3: 通过 → 提交** `feat(tasks): 主进程任务状态机——提交/结算/停止/重试/重启恢复`

---

### Task 5: 共享契约 + preload 桥

**Files:**
- Modify: `packages/desktop/src/shared/desktop.ts`（完整替换为 Global Constraints 的契约）
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/main/index.ts`（AppInfo handler 增加 `smoke: process.env.STUDIO_SMOKE === '1'`）
- Test: `tests/unit/shared.contract.test.ts`

**Interfaces:**
- Produces: Global Constraints 中 `DesktopAPI` 全量；`onTaskEvent` 用 `ipcRenderer.on(channel, listener)` + 返回解绑函数（preload 内实现）。

- [ ] **Step 1: 失败测试**——DESKTOP_CHANNELS 九个通道名唯一且互为前缀命名空间（db/task）；TaskRecord 状态字面量联合与 shared 导出一致（编译期断言 `type _A = TaskState` 即可）。
- [ ] **Step 2: 实现契约与 preload**

preload 追加：

```ts
taskList: () => ipcRenderer.invoke(DESKTOP_CHANNELS.taskList),
taskSubmit: (input) => ipcRenderer.invoke(DESKTOP_CHANNELS.taskSubmit, input),
taskSettle: (id, settle) => ipcRenderer.invoke(DESKTOP_CHANNELS.taskSettle, id, settle),
taskControl: (id, action) => ipcRenderer.invoke(DESKTOP_CHANNELS.taskControl, id, action),
onTaskEvent: (listener) => {
  const handler = (_e: unknown, event: TaskEvent) => listener(event)
  ipcRenderer.on(DESKTOP_CHANNELS.taskEvent, handler)
  return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.taskEvent, handler)
},
```

- [ ] **Step 3: 通过 + typecheck → 提交** `feat(ipc): db/task 通道契约与 preload 桥扩展`

---

### Task 6: 主进程接线（handlers + 事件推送）

**Files:**
- Create: `packages/desktop/src/main/services.ts`
- Modify: `packages/desktop/src/main/index.ts`

**Interfaces:**
- Consumes: Task 2-5 全部。
- Produces: `initServices(dbPath: string): { workspace: WorkspaceStore; runner: TaskRunner; api: { dbLoad, dbSave, taskList, taskSubmit, taskSettle, taskControl } }`——ipcMain.handle 注册 + emit = `event => mainWindow?.webContents.send(DESKTOP_CHANNELS.taskEvent, event)`（sender 校验沿用现有模式：非主窗口抛错）。main/index.ts 在 `app.whenReady` 里：`const services = initServices(join(app.getPath('userData'), 'studio.db'))`，`services.runner.recover()`。

- [ ] **Step 1: 失败测试**（unit：临时库上 initServices——emit 收集器注入？initServices 需可注入 emitter：`initServices(dbPath, emit?)`，默认向主窗口推送；测试传收集器）断言 dbSave→dbLoad 往返、taskSubmit→taskList、taskSettle 状态、stop/retry 行为经 handlers（用 `ipcMain.emit`? 不可行——handlers 内部函数直接导出测试对象即可：initServices 返回 api 对象本身，ipcMain.handle 只做绑定）。
- [ ] **Step 2: 实现**——dbLoad：`{ exists: !!row, workspace: row?.doc }`；dbSave：校验对象后 save，异常返回 `{ ok: false, message: '数据写入失败…' }`（不向渲染进程抛栈）。
- [ ] **Step 3: 通过 + `pnpm build`（electron-vite 主进程构建验证 node:sqlite externalize）→ 提交** `feat(main): SQLite 服务接线——工作区与任务 IPC 处理器`

---

### Task 7: 渲染端 Persistence 适配层（双实现）

**Files:**
- Create: `packages/ui/src/studio/persistence.ts`
- Test: `tests/renderer/persistence.test.ts`

**Interfaces:**
- Consumes: `window.desktop`（DesktopAPI）、`types.ts` Task/StudioState。
- Produces: Global Constraints 中 `Persistence` + `resolvePersistence()`。
  - `createDesktopPersistence(desktop)`：load 时接受 `workspace` 为 StudioState（schema 3）；save 前剥离 `tasks`（任务由主进程权威，save 只传 `...state, tasks: []`）；TaskRecord→Task 映射（kind 窄化 cast、extra 展开 version/videoId/snapshot）；onTaskEvent 的 snapshot/updated 归并为 Task[] 回调。
  - `createLocalPersistence()`：dev:web 降级——localStorage 键沿用 `content-studio.mock-workspace.v2`（读写全文档含 tasks），任务为**纯内存本地 runner**（与 Task 4 相同状态机的轻量复刻：submit→running、settle、stop、retry 克隆、load 时活动任务降级 stopped）。
  - `resolvePersistence()`：`typeof window !== 'undefined' && window.desktop?.dbLoad ? desktop : local`。

- [ ] **Step 1: 失败测试**（jsdom + fake bridge：记录调用序列）断言：save 剥离 tasks；submit 返回映射后的 Task；taskEvent snapshot 回调触发；local 模式首启 load 读 localStorage、活动任务降级。
- [ ] **Step 2: 实现**
- [ ] **Step 3: 通过 + typecheck → 提交** `feat(ui): 持久化适配层——desktop 桥与本地降级双实现`

---

### Task 8: store.tsx 改造（权威存储 + 真实任务镜像）

**Files:**
- Modify: `packages/ui/src/studio/store.tsx`（主要手术）
- Modify: `packages/ui/src/studio/types.ts`（`schema: 3`）
- Modify: `packages/ui/src/pages/Settings.tsx`（去直写 localStorage：:552 备份导出读 state 而非 localStorage；「重置示例」走 persistence 重置）
- Modify: `packages/ui/src/pages/Materials.tsx`（:698 直写 localStorage 移除——状态已由 store 保存覆盖）
- Test: `tests/renderer/store.persistence.test.ts`

**Interfaces:**
- Consumes: Task 7 Persistence。
- Produces: store 内部 `persistence = resolvePersistence()`（模块级单例）；对外 Store 接口签名**不变**（28 action 不动签名，页面组件零改动）。

行为变更点（测试覆盖）：
1. **启动**：`useState(seedState)` + `ready` 门（未 ready 时 Provider 渲染 children 前返回占位 null；App 无需改——children 渲染由 `<StudioProvider>` 内部 gate）。`useEffect` 一次：`persistence.load()` → workspace 存在（schema 3）→ 采用（保留现有 recoverCreation/排版升级逻辑路径）；不存在 → `readState()`（现有 localStorage/legacy 迁移逻辑保留为**本地引导**）→ 采用并 `persistence.save`。随后 `taskList()` 镜像 + `onTasks` 订阅镜像进 `state.tasks`。
2. **保存**：防抖 180ms → `persistence.save(state)`；ok → '已保存'，失败 → '保存失败' + notify('本机保存失败，已保留当前内容；请重试或到「设置 → 数据与导出」备份。')。pagehide flush 尽力而为。
3. **task()**：改写为 `persistence.taskSubmit(...)` 拿到 id → setTimeout(1000) 本地完成后 `persistence.taskSettle(id, { state:'complete', detail:'本地任务已完成；未调用外部服务。', result: undefined })`，complete 回调（状态变换函数）仍在 setTimeout 内直接 setState（渲染端执行器，P2 迁主进程）。停止守卫：settle 前检查镜像列表中该任务仍 running（onTasks 快照提供）。
4. **controlTask**：stop/retry 走 `persistence.taskControl`；creation 分支保留项目态操作；notify 文案沿用。
5. **__studio 调试钩子**：`window.__studio = { get: () => stateRef.current, replace: (next: StudioState) => setState(next) }`——仅在 `appInfo.smoke` 或 `import.meta.env.DEV` 时挂载（App.tsx 已取 appInfo，经新 context 字段或模块级变量传入；实现取模块级 `let debugEnabled` + App 拿到 appInfo 后调用 `setDebugEnabled(appInfo.smoke)`）。
6. types.ts `schema: 3`；readState 兼容读取 schema 2 存档（本地引导路径）并在返回前升 3。

- [ ] **Step 1: 失败测试**——jsdom 挂 fake persistence（注入：persistence.ts 导出 `__setPersistenceForTest`）断言：首启 DB 空时 readState 结果被 save；DB 有 workspace 时采用 DB；task 走 submit/settle；onTasks 推送更新 state.tasks。
- [ ] **Step 2: 实现改造**（分小步：先 persistence 接线与保存，再 task 改写，再钩子）
- [ ] **Step 3: 测试通过 + `pnpm dev:web` 手验（localStorage 降级正常）→ 提交** `feat(store): 权威持久化接入与真实任务镜像——localStorage 退役为本机降级`

---

### Task 9: 门禁同步与收尾

**Files:**
- Modify: `tests/smoke/design-system.spec.ts`、`layout-fixes.spec.ts`、`layout-followup.spec.ts`、`creation-flow.spec.ts`（localStorage 断言 → `window.__studio.get()`；design-system:242-255 的 setItem 写入改 `window.__studio.replace(state)`）
- Modify: `README.md`（:74 存储描述：localStorage → 应用数据目录内 SQLite 数据库；dev:web 仍 localStorage）、`docs/ux/IMPLEMENTATION.md`（同义更新，若有对应行）
- Test: 全部既有 e2e

- [ ] **Step 1: 逐文件替换断言**——模式：`page.evaluate(() => JSON.parse(localStorage.getItem('content-studio.mock-workspace.v2')!))` → `page.evaluate(() => (window as any).__studio.get())`；写回场景先 `get()` 改字段再 `replace(next)`，等待保存完成的轮询点改为轮询 `__studio.get()` 中目标字段。
- [ ] **Step 2: 四门禁全绿**：`pnpm typecheck && pnpm design:check && pnpm test && pnpm test:smoke && pnpm ux:capture`。
- [ ] **Step 3: 提交** `test(e2e): 持久化断言迁移至调试钩子并全门禁回归`

## Self-Review 记录

- Spec P1 六项覆盖：①通道契约=Task 5/6；②SQLite schema=Task 1-3（workspace+tasks 两表即 P1 全量；spec 列的 projects/drafts/... 十表属过度设计，单文档行已满足"权威存储+版本迁移"，归一化留给有查询需求的 P3 热点）；③Service 收敛=Task 7/8（持久化与任务边界；生成类工厂 platformContent/makeVideo/topics 属 P2/P3 域，不在 P1 强收敛——比 spec 收窄，理由记录）；④TaskRunner=Task 4/6/8；⑤localStorage 迁移=Task 8 行为点 1；⑥门禁同步=Task 9。
- 类型一致性：TaskRecord/Persistence/DESKTOP_CHANNELS 全计划引用 Global Constraints 单一定义。
- 风险预留：node:sqlite 在 electron-vite 主进程构建的 externalize 由 Task 6 Step 3 的 `pnpm build` 显式验证。

import type {
  AiConfigInput,
  AiConfigView,
  AiEvent,
  AiSendResult,
  AiTestResult,
  DesktopAPI,
  DiscoveryEvent,
  DiscoveryRefreshResult,
  DiscoverySnapshot,
  DiscoverySource,
  DiscoverySourceInput,
  TaskEvent,
  TaskExtra,
  TaskRecord,
  TaskSettle,
} from '../../../desktop/src/shared/desktop'

export type { AiEvent }
export type { DiscoverySnapshot }
import type { StudioState, Task } from './types'

export const WORKSPACE_KEY = 'content-studio.mock-workspace.v2'

export type TaskSubmitInput = {
  id?: string
  kind: Task['kind']
  title: string
  detail: string
  projectId: string
  payload?: unknown
  extra?: TaskExtra
  executor?: 'main' | 'renderer'
}

export type AiBridge = {
  configGet(): Promise<AiConfigView | null>
  configSet(input: AiConfigInput): Promise<AiConfigView>
  configClear(): Promise<{ ok: boolean }>
  test(baseUrl: string, apiKey: string, modelId: string): Promise<AiTestResult>
  send(sessionKey: string, text: string): Promise<AiSendResult>
  cancel(sessionKey: string): Promise<{ ok: boolean }>
  answer(questionId: string, answer: string): Promise<{ ok: boolean }>
  onEvent(listener: (event: AiEvent) => void): () => void
}

/** 热点域桥：来源 CRUD/刷新（任务系统驱动）与聚合快照事件；本地降级模式为 null。 */
export type DiscoveryBridge = {
  snapshot(): Promise<DiscoverySnapshot>
  sourceSave(input: DiscoverySourceInput): Promise<DiscoverySource>
  sourceDelete(id: string): Promise<{ ok: boolean; message?: string }>
  sourceRefresh(id: string): Promise<DiscoveryRefreshResult>
  refreshAll(): Promise<DiscoveryRefreshResult>
  onEvent(listener: (event: DiscoveryEvent) => void): () => void
}

export type Persistence = {
  mode: 'desktop' | 'local'
  /** dev:web 无桌面桥，AI 通道不存在（走本地演示路径）。 */
  ai: AiBridge | null
  /** dev:web 无桌面桥，热点域走本地演示数据（不发起网络请求）。 */
  discovery: DiscoveryBridge | null
  load(): Promise<{ workspace: StudioState | null }>
  save(state: StudioState): Promise<{ ok: boolean }>
  taskList(): Promise<Task[]>
  taskSubmit(input: TaskSubmitInput): Promise<Task | null>
  taskSettle(id: string, settle: TaskSettle): Promise<boolean>
  taskControl(id: string, action: 'stop' | 'retry'): Promise<void>
  onTasks(callback: (event: TaskEvent) => void): () => void
}

function toTask(record: TaskRecord): Task {
  const task: Task = {
    id: record.id,
    title: record.title,
    detail: record.detail,
    projectId: record.projectId,
    state: record.state as Task['state'],
    kind: record.kind as Task['kind'],
    at: record.at,
  }
  if (record.executor) task.executor = record.executor
  if (record.payload !== undefined) task.payload = record.payload
  if (record.extra?.version !== undefined) task.version = record.extra.version
  if (record.extra?.videoId !== undefined) task.videoId = record.extra.videoId
  if (record.extra?.snapshot !== undefined) task.snapshot = record.extra.snapshot as Task['snapshot']
  return task
}

export const taskFromRecord = toTask

function isWorkspace(value: unknown): value is StudioState {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<StudioState>
  return typeof candidate.schema === 'number' && Array.isArray(candidate.projects) && !!candidate.preferences
}

/** 桌面模式：SQLite 权威存储在主进程，任务由主进程 TaskRunner 持有。 */
export function createDesktopPersistence(desktop: DesktopAPI): Persistence {
  return {
    mode: 'desktop',
    ai: {
      configGet: () => desktop.aiConfigGet(),
      configSet: (input) => desktop.aiConfigSet(input),
      configClear: () => desktop.aiConfigClear(),
      test: (baseUrl, apiKey, modelId) => desktop.aiTest(baseUrl, apiKey, modelId),
      send: (sessionKey, text) => desktop.aiSend(sessionKey, text),
      cancel: (sessionKey) => desktop.aiCancel(sessionKey),
      answer: (questionId, answer) => desktop.aiAnswer(questionId, answer),
      onEvent: (listener) => desktop.onAiEvent(listener),
    },
    discovery: {
      snapshot: () => desktop.discoverySnapshot(),
      sourceSave: (input) => desktop.discoverySourceSave(input),
      sourceDelete: (id) => desktop.discoverySourceDelete(id),
      sourceRefresh: (id) => desktop.discoverySourceRefresh(id),
      refreshAll: () => desktop.discoveryRefreshAll(),
      onEvent: (listener) => desktop.onDiscoveryEvent(listener),
    },
    async load() {
      const result = await desktop.dbLoad()
      return { workspace: result.exists && isWorkspace(result.workspace) ? result.workspace : null }
    },
    async save(state) {
      // creation 任务由渲染端编排，随文档保存；其余任务权威在主进程任务表。
      // 来源与话题聚合权威在主进程 discovery 表，不写入文档（启动时以快照恢复）。
      const { sources: _sources, topics: _topics, ...doc } = state
      const result = await desktop.dbSave({
        ...doc,
        tasks: state.tasks.filter((task) => task.kind === 'creation'),
      })
      return { ok: result.ok }
    },
    async taskList() {
      return (await desktop.taskList()).map(toTask)
    },
    async taskSubmit(input) {
      const record = await desktop.taskSubmit({
        id: input.id,
        kind: input.kind,
        title: input.title,
        detail: input.detail,
        projectId: input.projectId,
        payload: input.payload,
        extra: input.extra,
        executor: input.executor,
      })
      return toTask(record)
    },
    async taskSettle(id, settle) {
      const record = await desktop.taskSettle(id, settle)
      return record !== null
    },
    async taskControl(id, action) {
      await desktop.taskControl(id, action)
    },
    onTasks(callback) {
      return desktop.onTaskEvent(callback)
    },
  }
}

/** 本地任务状态机：dev:web 降级用，语义与主进程 TaskRunner 一致。 */
class LocalTasks {
  private tasks: TaskRecord[] = []
  private listeners: Array<(event: TaskEvent) => void> = []

  replace(records: TaskRecord[]) {
    this.tasks = records
    this.emitSnapshot()
  }

  list(): TaskRecord[] {
    return [...this.tasks]
  }

  private emitSnapshot() {
    for (const listener of this.listeners) listener({ type: 'snapshot', tasks: this.list() })
  }

  private emitUpdated(task: TaskRecord) {
    for (const listener of this.listeners) listener({ type: 'updated', task })
  }

  private find(id: string) {
    return this.tasks.find((t) => t.id === id)
  }

  submit(input: TaskSubmitInput): TaskRecord {
    const at = new Date().toISOString()
    const record: TaskRecord = {
      id: input.id ?? crypto.randomUUID(),
      title: input.title,
      detail: input.detail,
      projectId: input.projectId,
      state: 'running',
      kind: input.kind,
      at,
      updated: at,
    }
    if (input.executor) record.executor = input.executor
    if (input.payload !== undefined) record.payload = input.payload
    if (input.extra !== undefined) record.extra = input.extra
    this.tasks = [record, ...this.tasks]
    this.emitUpdated(record)
    return record
  }

  settle(id: string, settle: TaskSettle): TaskRecord | null {
    const current = this.find(id)
    if (!current || current.state !== 'running') return null
    current.state = settle.state
    current.detail =
      settle.detail ?? (settle.state === 'complete' ? '本地任务已完成；未调用外部服务。' : current.detail)
    if (settle.state === 'failed') current.error = settle.detail ?? '任务失败'
    if (settle.result !== undefined) current.result = settle.result
    current.updated = new Date().toISOString()
    this.emitUpdated(current)
    return current
  }

  control(id: string, action: 'stop' | 'retry'): { ok: boolean } {
    const current = this.find(id)
    if (!current) return { ok: false }
    if (action === 'stop') {
      if (current.state !== 'running' && current.state !== 'queued') return { ok: false }
      current.state = 'stopped'
      current.detail = '已停止，之前的文稿与作品保持可用。'
      current.updated = new Date().toISOString()
      this.emitUpdated(current)
      return { ok: true }
    }
    const clone = this.submit({
      kind: current.kind as Task['kind'],
      title: current.title,
      detail: '正在重试当前任务…',
      projectId: current.projectId,
      payload: current.payload,
      extra: current.extra,
    })
    return { ok: true }
  }

  subscribe(listener: (event: TaskEvent) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((item) => item !== listener)
    }
  }
}

/** dev:web 降级模式：localStorage 全文档 + 内存任务状态机（沿用原存储键）。 */
export function createLocalPersistence(): Persistence {
  const tasks = new LocalTasks()
  return {
    mode: 'local',
    ai: null,
    discovery: null,
    async load() {
      try {
        const saved = JSON.parse(localStorage.getItem(WORKSPACE_KEY) ?? 'null') as StudioState | null
        if (!isWorkspace(saved)) return { workspace: null }
        const downgraded = saved.tasks.map((task) =>
          task.state === 'running' || task.state === 'queued'
            ? { ...task, state: 'stopped' as const, detail: '应用已重新打开。任务已停止，可重新运行。' }
            : task,
        )
        tasks.replace(downgraded.map((task) => toRecord(task)))
        return { workspace: { ...saved!, tasks: downgraded } }
      } catch {
        return { workspace: null }
      }
    },
    async save(state) {
      try {
        localStorage.setItem(WORKSPACE_KEY, JSON.stringify(state))
        return { ok: true }
      } catch {
        return { ok: false }
      }
    },
    async taskList() {
      return tasks.list().map(toTask)
    },
    async taskSubmit(input) {
      return toTask(tasks.submit(input))
    },
    async taskSettle(id, settle) {
      return tasks.settle(id, settle) !== null
    },
    async taskControl(id, action) {
      tasks.control(id, action)
    },
    onTasks(callback) {
      return tasks.subscribe(callback)
    },
  }
}

function toRecord(task: Task): TaskRecord {
  const record: TaskRecord = {
    id: task.id,
    title: task.title,
    detail: task.detail,
    projectId: task.projectId,
    state: task.state,
    kind: task.kind,
    at: task.at,
    updated: task.at,
  }
  if (task.version !== undefined || task.videoId !== undefined || task.snapshot !== undefined) {
    record.extra = { version: task.version, videoId: task.videoId, snapshot: task.snapshot }
  }
  return record
}

let override: Persistence | null = null
export function __setPersistenceForTest(persistence: Persistence | null): void {
  override = persistence
}

export function resolvePersistence(): Persistence {
  if (override) return override
  const desktop = typeof window !== 'undefined' ? window.desktop : undefined
  return desktop?.dbLoad ? createDesktopPersistence(desktop) : createLocalPersistence()
}

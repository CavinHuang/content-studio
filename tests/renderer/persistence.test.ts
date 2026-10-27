import { beforeEach, expect, test } from 'vitest'
import type {
  DesktopAPI,
  TaskEvent,
  TaskRecord,
  TaskSettle,
  TaskSubmitPayload,
} from '../../packages/desktop/src/shared/desktop'
import { seedState } from '../../packages/ui/src/studio/mock'
import {
  WORKSPACE_KEY,
  __setPersistenceForTest,
  createDesktopPersistence,
  createLocalPersistence,
  resolvePersistence,
} from '../../packages/ui/src/studio/persistence'
import type { StudioState } from '../../packages/ui/src/studio/types'

function makeState(): StudioState {
  return { ...(seedState() as Omit<StudioState, 'schema'>), schema: 3 } as unknown as StudioState
}

class FakeBridge implements DesktopAPI {
  savedDocs: unknown[] = []
  doc: { exists: boolean; workspace: unknown } = { exists: false, workspace: null }
  records: TaskRecord[] = []
  private listeners: Array<(event: TaskEvent) => void> = []
  private seq = 0

  getAppInfo: DesktopAPI['getAppInfo'] = async () => ({
    name: 'Content Studio',
    version: '0.0.0',
    platform: 'win32',
    electron: '45',
    smoke: true,
  })
  openDesigns: DesktopAPI['openDesigns'] = async () => ({ ok: true })
  async dbLoad() {
    return this.doc
  }
  async dbSave(workspace: unknown) {
    this.savedDocs.push(workspace)
    return { ok: true, at: '2026-10-27T00:00:00.000Z' }
  }
  async taskList() {
    return [...this.records]
  }
  async taskSubmit(input: TaskSubmitPayload) {
    const at = new Date().toISOString()
    const record: TaskRecord = {
      id: `t${++this.seq}`,
      title: input.title,
      detail: input.detail,
      projectId: input.projectId,
      state: 'running',
      kind: input.kind,
      at,
      updated: at,
      payload: input.payload,
      extra: input.extra,
    }
    this.records = [record, ...this.records]
    this.emit({ type: 'updated', task: record })
    return record
  }
  async taskSettle(id: string, settle: TaskSettle) {
    const record = this.records.find((t) => t.id === id)
    if (!record || record.state !== 'running') return null
    record.state = settle.state
    record.detail = settle.detail ?? record.detail
    this.emit({ type: 'updated', task: record })
    return record
  }
  async taskControl(id: string, action: 'stop' | 'retry') {
    const record = this.records.find((t) => t.id === id)
    if (!record) return { ok: false }
    if (action === 'stop') {
      record.state = 'stopped'
      this.emit({ type: 'updated', task: record })
    }
    return { ok: true }
  }
  onTaskEvent(listener: (event: TaskEvent) => void) {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((item) => item !== listener)
    }
  }
  private emit(event: TaskEvent) {
    for (const listener of this.listeners) listener(event)
  }
}

beforeEach(() => {
  localStorage.clear()
  __setPersistenceForTest(null)
})

test('desktop 模式：save 剥离 tasks，不写入任务到文档', async () => {
  const bridge = new FakeBridge()
  const persistence = createDesktopPersistence(bridge)
  const result = await persistence.save(makeState())
  expect(result).toEqual({ ok: true })
  expect(bridge.savedDocs).toHaveLength(1)
  expect((bridge.savedDocs[0] as { tasks: unknown[] }).tasks).toEqual([])
})

test('desktop 模式：load 接受合法工作区、拒绝不合法', async () => {
  const bridge = new FakeBridge()
  const persistence = createDesktopPersistence(bridge)
  expect(await persistence.load()).toEqual({ workspace: null })
  const state = makeState()
  bridge.doc = { exists: true, workspace: state }
  expect(await persistence.load()).toEqual({ workspace: state })
  bridge.doc = { exists: true, workspace: { schema: 3 } }
  expect(await persistence.load()).toEqual({ workspace: null })
})

test('desktop 模式：taskSubmit 映射 extra 到 Task 字段，事件转发', async () => {
  const bridge = new FakeBridge()
  const persistence = createDesktopPersistence(bridge)
  const events: TaskEvent[] = []
  persistence.onTasks((event) => events.push(event))
  const task = (await persistence.taskSubmit({
    kind: 'export',
    title: '导出',
    detail: '',
    projectId: 'p1',
    extra: { videoId: 'v1', version: 2 },
  }))!
  expect(task).toMatchObject({ kind: 'export', videoId: 'v1', version: 2, state: 'running' })
  await persistence.taskSettle(task.id, { state: 'complete', detail: '已完成' })
  expect(events.at(-1)).toMatchObject({ type: 'updated', task: { id: task.id, state: 'complete' } })
})

test('local 模式：save/load 往返，重启时活动任务降级为 stopped', async () => {
  const state = makeState()
  state.tasks = [
    {
      id: 'run',
      title: 't',
      detail: '',
      projectId: 'p1',
      state: 'running',
      kind: 'agent',
      at: '2026-10-27T00:00:00.000Z',
    },
  ]
  const writer = createLocalPersistence()
  expect(await writer.save(state)).toEqual({ ok: true })
  expect(localStorage.getItem(WORKSPACE_KEY)).toBeTruthy()
  const reader = createLocalPersistence()
  const { workspace } = await reader.load()
  expect(workspace!.projects).toEqual(state.projects)
  expect(workspace!.tasks[0]).toMatchObject({
    state: 'stopped',
    detail: '应用已重新打开。任务已停止，可重新运行。',
  })
})

test('local 模式：任务状态机与主进程语义一致', async () => {
  const persistence = createLocalPersistence()
  const task = (await persistence.taskSubmit({ kind: 'agent', title: 'a', detail: '', projectId: 'p1' }))!
  expect(task.state).toBe('running')
  await persistence.taskSettle(task.id, { state: 'complete' })
  const list = await persistence.taskList()
  expect(list[0]).toMatchObject({ state: 'complete', detail: '本地任务已完成；未调用外部服务。' })
  const other = (await persistence.taskSubmit({ kind: 'source', title: 'b', detail: '', projectId: 'p1' }))!
  await persistence.taskControl(other.id, 'stop')
  await persistence.taskSettle(other.id, { state: 'complete' })
  expect((await persistence.taskList()).find((t) => t.id === other.id)).toMatchObject({ state: 'stopped' })
  await persistence.taskControl(other.id, 'retry')
  expect(await persistence.taskList()).toHaveLength(3)
})

test('resolvePersistence：无桌面桥走 local，有桥走 desktop', () => {
  expect(resolvePersistence().mode).toBe('local')
  const bridge = new FakeBridge()
  ;(window as { desktop?: DesktopAPI }).desktop = bridge
  expect(resolvePersistence().mode).toBe('desktop')
  delete (window as { desktop?: DesktopAPI }).desktop
})

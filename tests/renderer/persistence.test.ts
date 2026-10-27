import { beforeEach, expect, test } from 'vitest'
import type {
  DesktopAPI,
  DiscoveryEvent,
  DiscoverySourceInput,
  TaskEvent,
  TaskRecord,
  TaskSettle,
  TaskSubmitPayload,
  WechatConfigInput,
  WechatConfigView,
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
  // AI 通道桩（persistence 测试不覆盖 AI 行为）。
  aiConfigGet: DesktopAPI['aiConfigGet'] = async () => null
  aiConfigSet: DesktopAPI['aiConfigSet'] = async () => {
    throw new Error('not implemented')
  }
  aiConfigClear: DesktopAPI['aiConfigClear'] = async () => ({ ok: true })
  aiTest: DesktopAPI['aiTest'] = async () => ({ ok: true, message: 'stub' })
  aiSend: DesktopAPI['aiSend'] = async () => ({ ok: false, code: 'STUB' })
  aiCancel: DesktopAPI['aiCancel'] = async () => ({ ok: true })
  aiAnswer: DesktopAPI['aiAnswer'] = async () => ({ ok: true })
  onAiEvent: DesktopAPI['onAiEvent'] = () => () => {}
  // 热点域通道桩：记录调用并回放最小快照。
  savedSources: DiscoverySourceInput[] = []
  deletedSources: string[] = []
  snapshot: DesktopAPI['discoverySnapshot'] extends () => Promise<infer T> ? T : never = {
    sources: [],
    topics: [],
    lastSyncAt: '',
  } as never
  discoverySnapshot: DesktopAPI['discoverySnapshot'] = async function (this: FakeBridge) {
    return this.snapshot
  }
  discoverySourceList: DesktopAPI['discoverySourceList'] = async () => []
  discoverySourceSave: DesktopAPI['discoverySourceSave'] = async function (this: FakeBridge, input) {
    this.savedSources.push(input)
    return {
      id: input.id ?? 's-new',
      name: input.name,
      type: input.type,
      category: input.category,
      enabled: input.enabled,
      status: 'unconfigured',
      updated: '',
      url: input.url,
    }
  }
  discoverySourceDelete: DesktopAPI['discoverySourceDelete'] = async function (this: FakeBridge, id) {
    this.deletedSources.push(id)
    return { ok: true }
  }
  discoverySourceRefresh: DesktopAPI['discoverySourceRefresh'] = async () => ({ ok: true, taskId: 't1' })
  discoveryRefreshAll: DesktopAPI['discoveryRefreshAll'] = async () => ({ ok: true, taskId: 't2' })
  onDiscoveryEvent: DesktopAPI['onDiscoveryEvent'] = (_listener: (event: DiscoveryEvent) => void) => () => {}
  // 公众号发布通道桩：记录调用并回放最小视图。
  savedWechat: WechatConfigInput[] = []
  wechatView: WechatConfigView | null = null
  publishConfigGet: DesktopAPI['publishConfigGet'] = async function (this: FakeBridge) {
    return this.wechatView
  }
  publishConfigSave: DesktopAPI['publishConfigSave'] = async function (this: FakeBridge, input) {
    this.savedWechat.push(input)
    this.wechatView = { appId: input.appId, hasSecret: true, secretTail: input.secret.slice(-4) }
    return this.wechatView
  }
  publishConfigClear: DesktopAPI['publishConfigClear'] = async function (this: FakeBridge) {
    this.wechatView = null
    return { ok: true }
  }
  publishCanInject: DesktopAPI['publishCanInject'] = async () => ({ ok: true, message: 'stub' })
  publishRenderHtml: DesktopAPI['publishRenderHtml'] = async () => ({ ok: true, html: '<p>stub</p>' })
  publishSaveDraft: DesktopAPI['publishSaveDraft'] = async () => ({ ok: true, taskId: 't3' })
  private emit(event: TaskEvent) {
    for (const listener of this.listeners) listener(event)
  }
}

beforeEach(() => {
  localStorage.clear()
  __setPersistenceForTest(null)
})

test('desktop 模式：save 剥离 tasks 与热点聚合，不写入任务/来源/话题到文档', async () => {
  const bridge = new FakeBridge()
  const persistence = createDesktopPersistence(bridge)
  const result = await persistence.save(makeState())
  expect(result).toEqual({ ok: true })
  expect(bridge.savedDocs).toHaveLength(1)
  const doc = bridge.savedDocs[0] as { tasks: unknown[]; sources?: unknown; topics?: unknown }
  expect(doc.tasks).toEqual([])
  expect(doc.sources).toBeUndefined()
  expect(doc.topics).toBeUndefined()
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
  const persistence = resolvePersistence()
  expect(persistence.mode).toBe('desktop')
  delete (window as { desktop?: DesktopAPI }).desktop
})

test('desktop 模式：discovery 桥映射保存/删除/刷新，local 模式为 null', async () => {
  const bridge = new FakeBridge()
  const desktop = createDesktopPersistence(bridge)
  const discovery = desktop.discovery!
  expect(createLocalPersistence().discovery).toBeNull()
  expect(await discovery.snapshot()).toEqual(bridge.snapshot)
  const saved = await discovery.sourceSave({
    name: '我的订阅',
    type: 'RSS',
    category: '生活',
    enabled: true,
    url: 'https://example.com/feed',
  })
  expect(bridge.savedSources).toHaveLength(1)
  expect(saved).toMatchObject({ name: '我的订阅', status: 'unconfigured' })
  expect(await discovery.sourceDelete('s1')).toEqual({ ok: true })
  expect(bridge.deletedSources).toEqual(['s1'])
  expect(await discovery.sourceRefresh('s1')).toMatchObject({ ok: true, taskId: 't1' })
  expect(await discovery.refreshAll()).toMatchObject({ ok: true, taskId: 't2' })
  const off = discovery.onEvent(() => {})
  expect(typeof off).toBe('function')
  off()
})

test('desktop 模式：publish 桥映射配置/探测/渲染/存草稿，local 模式为 null', async () => {
  const bridge = new FakeBridge()
  const desktop = createDesktopPersistence(bridge)
  const publish = desktop.publish!
  expect(createLocalPersistence().publish).toBeNull()
  expect(await publish.configGet()).toBeNull()
  const view = await publish.configSave({ appId: 'wx1234567890abcdef', secret: 'secret-9999' })
  expect(view).toMatchObject({ appId: 'wx1234567890abcdef', hasSecret: true, secretTail: '9999' })
  expect(bridge.savedWechat).toHaveLength(1)
  expect(await publish.configGet()).toEqual(view)
  expect(await publish.canInject()).toMatchObject({ ok: true })
  expect(await publish.renderHtml('# 标题')).toMatchObject({ ok: true, html: '<p>stub</p>' })
  expect(await publish.saveDraft({ projectId: 'p1', title: '标题', body: '正文' })).toMatchObject({
    ok: true,
    taskId: 't3',
  })
  await publish.configClear()
  expect(await publish.configGet()).toBeNull()
})

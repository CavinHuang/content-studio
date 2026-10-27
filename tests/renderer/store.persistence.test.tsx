import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import type { DiscoveryEvent, DiscoverySnapshot, TaskEvent, TaskRecord, TaskSettle } from '../../packages/desktop/src/shared/desktop'
import { seedState } from '../../packages/ui/src/studio/mock'
import {
  __setPersistenceForTest,
  type Persistence,
  type TaskSubmitInput,
} from '../../packages/ui/src/studio/persistence'
import { StudioProvider, useStudio, type Store } from '../../packages/ui/src/studio/store'
import type { StudioState, Task } from '../../packages/ui/src/studio/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeState(): StudioState {
  return { ...(seedState() as Omit<StudioState, 'schema'>), schema: 3 } as unknown as StudioState
}

function fakePersistence(workspace: StudioState | null) {
  const saved: StudioState[] = []
  const submitted: TaskSubmitInput[] = []
  const settled: Array<[string, TaskSettle]> = []
  const listeners: Array<(event: TaskEvent) => void> = []
  let tasks: Task[] = []
  const persistence: Persistence = {
    mode: 'local',
    ai: null,
    discovery: null,
    async load() {
      return { workspace }
    },
    async save(state) {
      saved.push(state)
      return { ok: true }
    },
    async taskList() {
      return tasks
    },
    async taskSubmit(input) {
      submitted.push(input)
      const task: Task = {
        id: input.id ?? 'task-1',
        title: input.title,
        detail: input.detail,
        projectId: input.projectId,
        state: 'running',
        kind: input.kind,
        at: new Date().toISOString(),
      }
      tasks = [task, ...tasks]
      return task
    },
    async taskSettle(id, settle) {
      settled.push([id, settle])
      const task = tasks.find((t) => t.id === id)
      if (!task || task.state !== 'running') return false
      task.state = settle.state
      if (settle.detail) task.detail = settle.detail
      return true
    },
    async taskControl() {},
    onTasks(callback) {
      listeners.push(callback)
      return () => {}
    },
  }
  return {
    persistence,
    saved,
    submitted,
    settled,
    emit: (event: TaskEvent) => listeners.forEach((listener) => listener(event)),
    setTasks: (next: Task[]) => {
      tasks = next
    },
  }
}

let root: Root | null = null
let container: HTMLElement | null = null
let latest: Store | null = null
function Probe() {
  latest = useStudio()
  return null
}

async function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <StudioProvider>
        <Probe />
      </StudioProvider>,
    )
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  latest = null
  __setPersistenceForTest(null)
  vi.restoreAllMocks()
})

test('空库首启：readState 引导结果写入权威存储，任务镜像就位', async () => {
  localStorage.clear()
  const fake = fakePersistence(null)
  __setPersistenceForTest(fake.persistence)
  await mount()
  expect(latest!.state.schema).toBe(3)
  expect(fake.saved.length).toBeGreaterThanOrEqual(1)
  expect(fake.saved[0]!.projects.length).toBeGreaterThan(0)
  // 顺序不敏感：桥的时间戳与提交节奏无关，镜像只需全员就位
  expect([...latest!.state.tasks.map((t) => t.id)].sort()).toEqual(
    [...seedState().tasks.map((t) => t.id)].sort(),
  )
})

test('权威库已有工作区：采用 DB 文档且不做引导写回', async () => {
  const dbState = makeState()
  dbState.projects[0]!.title = '来自数据库的项目'
  const fake = fakePersistence(dbState)
  __setPersistenceForTest(fake.persistence)
  await mount()
  expect(latest!.state.projects.some((p) => p.title === '来自数据库的项目')).toBe(true)
  expect(fake.saved).toEqual([])
})

test('task 走 submit/settle，完成后镜像更新', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const fake = fakePersistence(makeState())
  __setPersistenceForTest(fake.persistence)
  await mount()
  let id = ''
  act(() => {
    id = latest!.task('准备平台版本', '正在适配…', 'agent')
  })
  expect(fake.submitted[0]).toMatchObject({ id, kind: 'agent', title: '准备平台版本' })
  expect(latest!.state.tasks.some((t) => t.id === id && t.state === 'running')).toBe(true)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1150))
  })
  expect(fake.settled).toEqual([[id, { state: 'complete', detail: '演示任务已完成；未调用外部服务。' }]])
  expect(latest!.state.tasks.find((t) => t.id === id)?.state).toBe('complete')
})

test('任务事件快照整体替换镜像，未知运行任务被本地执行器接管', async () => {
  const fake = fakePersistence(makeState())
  __setPersistenceForTest(fake.persistence)
  await mount()
  const clone: Task = {
    id: 'retry-clone',
    title: '导出',
    detail: '正在重试当前任务…',
    projectId: 'p1',
    state: 'running',
    kind: 'export',
    at: new Date().toISOString(),
  }
  await act(async () => {
    fake.emit({ type: 'updated', task: clone as unknown as TaskRecord })
  })
  expect(latest!.state.tasks.some((t) => t.id === 'retry-clone')).toBe(true)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1150))
  })
  expect(fake.settled).toEqual([
    ['retry-clone', { state: 'complete', detail: '演示任务已完成；未调用外部服务。' }],
  ])
})

test('discovery 桥：启动应用聚合快照，事件推送替换来源与话题', async () => {
  const snapshot = {
    sources: [
      {
        id: 'real',
        name: '实时订阅',
        type: 'RSS',
        category: 'AI 科技',
        enabled: true,
        status: 'ready',
        updated: '2026-10-27T10:00:00Z',
        url: 'https://real.example.com/feed.xml',
      },
    ],
    topics: [
      {
        id: 't_real_1',
        title: '真实热点',
        summary: '来自真实来源的聚合话题',
        category: 'AI 科技',
        tags: ['AI 科技'],
        image: 'room',
        articles: [
          {
            id: 'a_real_1',
            title: '真实条目',
            sourceIds: ['real'],
            url: 'https://real.example.com/posts/1',
            body: '正文摘要',
            published: '10/27 18:00',
            collected: '10/27 18:05',
          },
        ],
        angles: [],
        ageHours: 1,
        updated: '2026-10-27T10:05:00Z',
      },
    ],
    lastSyncAt: '2026-10-27T10:05:00Z',
  } as const
  const discoveryListeners: Array<(event: DiscoveryEvent) => void> = []
  const refreshCalls: string[] = []
  const fake = fakePersistence(makeState())
  fake.persistence.discovery = {
    snapshot: async () => snapshot as unknown as DiscoverySnapshot,
    sourceSave: async () => {
      throw new Error('not used')
    },
    sourceDelete: async () => ({ ok: true }),
    sourceRefresh: async (id: string) => {
      refreshCalls.push(id)
      return { ok: true, taskId: 't-r' }
    },
    refreshAll: async () => {
      refreshCalls.push('all')
      return { ok: true, taskId: 't-all' }
    },
    onEvent: (listener) => {
      discoveryListeners.push(listener)
      return () => {}
    },
  }
  __setPersistenceForTest(fake.persistence)
  await mount()
  expect(latest!.state.sources.map((s) => s.id)).toEqual(['real'])
  expect(latest!.state.topics.map((t) => t.id)).toEqual(['t_real_1'])
  expect(latest!.state.discoverySyncAt).toBe('2026-10-27T10:05:00Z')
  await act(async () => {
    discoveryListeners.forEach((listener) =>
      listener({
        type: 'snapshot',
        snapshot: { ...snapshot, lastSyncAt: '2026-10-27T11:00:00Z' } as unknown as DiscoverySnapshot,
      }),
    )
  })
  expect(latest!.state.discoverySyncAt).toBe('2026-10-27T11:00:00Z')
  act(() => {
    latest!.refreshAllSources()
  })
  expect(refreshCalls).toEqual(['all'])
})

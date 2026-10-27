import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import { seedState } from '../../packages/ui/src/studio/mock'
import {
  __setPersistenceForTest,
  type Persistence,
} from '../../packages/ui/src/studio/persistence'
import { StudioProvider, useStudio, type Store } from '../../packages/ui/src/studio/store'
import type { StudioState, Task } from '../../packages/ui/src/studio/types'
import { TasksPage } from '../../packages/ui/src/pages/Tasks'

// 回归：kind 'publish' 自小红书注入接入后跨平台共用，任务中心的平台归属标签与
// 重试通知必须按 payload.platform 分派（'redbook' → 小红书；其余含未标注历史任务 → 公众号），
// 不得把小红书注入任务误标为「公众号草稿箱 / 官方草稿箱」。
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeState(tasks: Task[]): StudioState {
  const state = { ...(seedState() as Omit<StudioState, 'schema'>), schema: 3 } as unknown as StudioState
  state.tasks = [...tasks]
  return state
}

function publishTask(id: string, platform?: 'wechat' | 'redbook'): Task {
  const task: Task = {
    id,
    title: platform === 'redbook' ? '注入小红书草稿' : '存入公众号草稿箱',
    detail:
      platform === 'redbook' ? '正在把《演示》注入小红书草稿…' : '正在把《演示》存入公众号草稿箱…',
    projectId: 'publish',
    state: 'failed',
    kind: 'publish',
    executor: 'main',
    at: new Date().toISOString(),
    error: '演示失败原因',
  }
  if (platform) task.payload = { platform, title: '演示', body: '正文' }
  return task
}

let root: Root | null = null
let container: HTMLElement | null = null
let latest: Store | null = null
function Probe() {
  latest = useStudio()
  return null
}

async function mount(tasks: Task[]) {
  const controls: Array<[string, 'stop' | 'retry']> = []
  const persistence: Persistence = {
    mode: 'local',
    ai: null,
    discovery: null,
    publish: null,
    async load() {
      return { workspace: makeState(tasks) }
    },
    async save() {
      return { ok: true }
    },
    async taskList() {
      return tasks
    },
    async taskSubmit() {
      return null
    },
    async taskSettle() {
      return false
    },
    async taskControl(id, action) {
      controls.push([id, action])
    },
    onTasks() {
      return () => {}
    },
  }
  __setPersistenceForTest(persistence)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(
      <StudioProvider>
        <Probe />
        <TasksPage />
      </StudioProvider>,
    )
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })
  return controls
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  latest = null
  __setPersistenceForTest(null)
})

test('任务中心按 payload.platform 分派发布任务标签：小红书注入 ≠ 公众号草稿箱', async () => {
  await mount([publishTask('pub-redbook', 'redbook'), publishTask('pub-wechat', 'wechat'), publishTask('pub-legacy')])
  const metas = [...container!.querySelectorAll('.small-meta')].map((el) => el.textContent ?? '')
  // 小红书注入任务：如实标注平台网页会话注入
  expect(metas.some((m) => /^小红书 · /.test(m) && m.endsWith(' · 平台草稿注入'))).toBe(true)
  // 公众号任务（含未标注 platform 的历史任务，缺省视为公众号）标签保持原样
  expect(metas.filter((m) => /^公众号草稿箱 · /.test(m) && m.endsWith(' · 官方草稿箱')).length).toBe(2)
  // 不允许出现前缀与后缀平台互相矛盾的组合
  expect(metas.some((m) => /^公众号草稿箱 · /.test(m) && m.endsWith(' · 平台草稿注入'))).toBe(false)
  expect(metas.some((m) => /^小红书 · /.test(m) && m.endsWith(' · 官方草稿箱'))).toBe(false)
})

test('发布任务重试通知按平台分派：小红书注入不再误称「存草稿」', async () => {
  const controls = await mount([publishTask('pub-redbook', 'redbook'), publishTask('pub-wechat', 'wechat')])
  act(() => {
    latest!.controlTask('pub-redbook', 'retry')
  })
  expect(latest!.notice).toBe('已重新发起小红书草稿注入任务，原失败记录保留。')
  act(() => {
    latest!.controlTask('pub-wechat', 'retry')
  })
  expect(latest!.notice).toBe('已重新发起存草稿任务，原失败记录保留。')
  expect(controls).toEqual([
    ['pub-redbook', 'retry'],
    ['pub-wechat', 'retry'],
  ])
})

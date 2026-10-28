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

// §12 第六态「部分完成」：已完成产物可用；可重试失败项（重试沿用既有 retry 克隆）。
// 任务中心徽标、筛选与重试入口必须为 partial 提供显式映射，不得落回「已完成/失败」语义。
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeState(tasks: Task[]): StudioState {
  const state = { ...(seedState() as Omit<StudioState, 'schema'>), schema: 3 } as unknown as StudioState
  state.tasks = [...tasks]
  return state
}

function partialTask(id: string): Task {
  return {
    id,
    title: '准备平台版本',
    detail: '已生成 1 个平台版本；失败：zhihu。',
    projectId: 'publish',
    state: 'partial',
    kind: 'agent',
    executor: 'main',
    at: new Date().toISOString(),
    payload: { job: 'platforms', platforms: ['wechat', 'zhihu'] },
    result: { drafts: { wechat: { title: 't', body: 'b' } }, failed: ['zhihu'] },
  }
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
    video: null,
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

test('partial 任务显示「部分完成」徽标，不再落回已完成或失败文案', async () => {
  await mount([partialTask('task-partial')])
  const badges = [...container!.querySelectorAll('[data-slot="badge"]')].map((el) => el.textContent ?? '')
  expect(badges).toContain('部分完成')
  expect(badges).not.toContain('已完成')
  expect(badges).not.toContain('失败')
})

test('筛选映射：「部分完成」筛选只保留 partial 任务', async () => {
  const partial = partialTask('task-partial')
  const complete: Task = { ...partialTask('task-complete'), state: 'complete', detail: '已生成 2 个平台版本。' }
  await mount([partial, complete])
  const chip = [...container!.querySelectorAll('button')].find((el) => el.textContent === '部分完成')
  expect(chip).toBeTruthy()
  await act(async () => {
    chip!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  const titles = [...container!.querySelectorAll('.task-card h3')].map((el) => el.textContent ?? '')
  expect(titles).toEqual(['准备平台版本'])
  expect(titles).toHaveLength(1)
  const badge = [...container!.querySelectorAll('[data-slot="badge"]')].map((el) => el.textContent ?? '')
  expect(badge).toContain('部分完成')
})

test('partial 可重试失败项：重试按钮可见并走既有 retry 克隆通道', async () => {
  const controls = await mount([partialTask('task-partial')])
  const card = container!.querySelector('.task-card')!
  const retry = [...card.querySelectorAll('button')].find((el) => el.textContent?.includes('重试'))
  expect(retry).toBeTruthy()
  await act(async () => {
    retry!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  expect(controls).toEqual([['task-partial', 'retry']])
})

test('页首统计把 partial 计入「需要留意」，不计入已完成', async () => {
  const partial = partialTask('task-partial')
  const complete: Task = { ...partialTask('task-complete'), state: 'complete', detail: '已生成 2 个平台版本。' }
  await mount([partial, complete])
  const stats = [...container!.querySelectorAll('.source-stats > div')].map((el) => el.textContent ?? '')
  expect(stats).toEqual(['0进行中', '1已完成', '1需要留意'])
})

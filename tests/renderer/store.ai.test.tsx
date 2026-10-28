import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import type {
  AiConfigView,
  AiEvent,
  TaskEvent,
  TaskRecord,
  TaskSettle,
} from '../../packages/desktop/src/shared/desktop'
import { SAMPLE_BODY, seedState } from '../../packages/ui/src/studio/mock'
import {
  __setPersistenceForTest,
  taskFromRecord,
  type AiBridge,
  type Persistence,
  type TaskSubmitInput,
} from '../../packages/ui/src/studio/persistence'
import { StudioProvider, useStudio, type Store } from '../../packages/ui/src/studio/store'
import type { StudioState } from '../../packages/ui/src/studio/types'

// 评审 2026-10-28 修复项（渲染端 store/页面域）：
// F01 配置模型后创作入口走真实生成；F03 建议 baseBody 取请求时快照；
// F05 对话上下文真实带入素材；F06 多条建议逐条保留；F07 会话键加对话身份；F08 来源版本取任务快照。

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeState(): StudioState {
  return { ...(seedState() as Omit<StudioState, 'schema'>), schema: 3 } as unknown as StudioState
}

type FakeHarness = {
  persistence: Persistence
  sends: Array<{ sessionKey: string; text: string }>
  submitted: TaskSubmitInput[]
  emitAi: (event: AiEvent) => void
  emitTask: (task: Partial<TaskRecord> & Pick<TaskRecord, 'id' | 'state'>) => void
}

function fakePersistence(workspace: StudioState, configured = true): FakeHarness {
  const listeners: Array<(event: TaskEvent) => void> = []
  const aiListeners: Array<(event: AiEvent) => void> = []
  const sends: Array<{ sessionKey: string; text: string }> = []
  const submitted: TaskSubmitInput[] = []
  let tasks: TaskRecord[] = []
  const view: AiConfigView | null = configured
    ? {
        providerId: 'p',
        baseUrl: 'https://model.example.com',
        modelId: 'm',
        hasKey: true,
        apiKeyTail: '…789',
      }
    : null
  const ai: AiBridge = {
    configGet: async () => view,
    configSet: async () => {
      throw new Error('not used')
    },
    configClear: async () => ({ ok: true }),
    test: async () => ({ ok: true, message: '已连接' }),
    send: async (sessionKey, text) => {
      sends.push({ sessionKey, text })
      return { ok: true, runId: 'run-1' }
    },
    cancel: async () => ({ ok: true }),
    answer: async () => ({ ok: true }),
    onEvent(listener) {
      aiListeners.push(listener)
      return () => {}
    },
  }
  const persistence: Persistence = {
    mode: 'local',
    ai,
    discovery: null,
    publish: null,
    video: null,
    async load() {
      return { workspace }
    },
    async save() {
      return { ok: true }
    },
    async taskList() {
      return tasks.map(taskFromRecord)
    },
    async taskSubmit(input) {
      submitted.push(input)
      const at = new Date().toISOString()
      const record: TaskRecord = {
        id: input.id ?? 'task-1',
        title: input.title,
        detail: input.detail,
        projectId: input.projectId,
        state: 'running',
        kind: input.kind,
        at,
        updated: at,
        ...(input.executor ? { executor: input.executor } : {}),
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
      }
      tasks = [record, ...tasks]
      return {
        id: record.id,
        title: record.title,
        detail: record.detail,
        projectId: record.projectId,
        state: 'running',
        kind: 'agent',
        at: record.at,
        executor: input.executor,
        payload: input.payload,
      }
    },
    async taskSettle(_id, _settle: TaskSettle) {
      return false
    },
    async taskControl() {},
    onTasks(callback) {
      listeners.push(callback)
      return () => {}
    },
  }
  return {
    persistence,
    sends,
    submitted,
    emitAi: (event) => aiListeners.forEach((listener) => listener(event)),
    emitTask: (partial) => {
      const at = new Date().toISOString()
      const record: TaskRecord = {
        title: '主进程任务',
        detail: '',
        projectId: workspace.projects[0]!.id,
        kind: 'agent',
        at,
        updated: at,
        executor: 'main',
        ...partial,
      }
      for (const listener of listeners) listener({ type: 'updated', task: record })
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

async function mount(persistence: Persistence) {
  __setPersistenceForTest(persistence)
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

async function send(text: string) {
  // 分两次 act：setComposer 触发重渲染后，sendMessage 才能读到新的 composer 闭包。
  await act(async () => {
    latest!.setComposer(text)
    await Promise.resolve()
  })
  await act(async () => {
    latest!.sendMessage()
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
})

test('F07：两个 conversationId 的会话键彼此独立（p:<项目>:<对话>）', async () => {
  const state = makeState()
  const project = state.projects[0]!
  const conversationA = project.activeConversation
  project.conversations.push({ id: 'conv-b', title: '第二个对话', messages: [] })
  const fake = fakePersistence(state)
  await mount(fake.persistence)
  await send('对话 A 的问题')
  const keyA = fake.sends[0]!.sessionKey
  expect(keyA).toBe(`p:${project.id}:${conversationA}`)
  await act(async () => {
    latest!.patchProject(project.id, (p) => ({ ...p, activeConversation: 'conv-b' }))
    await Promise.resolve()
  })
  await send('对话 B 的问题')
  const keyB = fake.sends[1]!.sessionKey
  expect(keyB).toBe(`p:${project.id}:conv-b`)
  expect(keyB).not.toBe(keyA)
})

test('F05：对话请求真实带入本篇素材，截断时在 prompt 尾部说明范围', async () => {
  const state = makeState()
  const project = state.projects[0]!
  state.materials = [
    ...state.materials,
    {
      id: 'm-long',
      title: '超长素材',
      type: 'text',
      body: `【截断标记】${'长'.repeat(900)}`,
      url: '',
      tags: [],
      at: '2026-10-26T00:00:00Z',
    },
  ]
  project.materialIds = ['m1', 'm-long']
  const fake = fakePersistence(state)
  await mount(fake.persistence)
  await send('结合素材，整理成自己的观点')
  const prompt = fake.sends[0]!.text
  // 与界面「已带入 N 份本篇素材」口径一致
  expect(prompt).toContain('本篇素材（2 份）')
  expect(prompt).toContain('【创作，从一个小念头开始】')
  expect(prompt).toContain('不必一开始就知道要写什么')
  expect(prompt).toContain('【超长素材】')
  expect(prompt).toContain('【截断标记】')
  // 截断范围如实说明，且放在发给模型的 prompt 尾部
  expect(prompt.includes('长'.repeat(900))).toBe(false)
  expect(prompt.endsWith('（以上素材正文为截选：每份仅保留前 800 字；全文保存在本机素材库中。）')).toBe(true)
})

test('F03：发起时改稿后，迟到建议以冻结正文为基线，采用被过期拦截', async () => {
  const state = makeState()
  const fake = fakePersistence(state)
  await mount(fake.persistence)
  await send('帮我润色第二段')
  const sessionKey = fake.sends[0]!.sessionKey
  const original = '灵感并不稀缺，稀缺的是我们愿意为它停留的片刻。'
  // 模型运行期间用户改稿
  await act(async () => {
    latest!.patchDraft({ body: '用户在生成期间改写的新正文。' })
    await Promise.resolve()
  })
  await act(async () => {
    fake.emitAi({
      type: 'suggestion',
      sessionKey,
      runId: 'run-1',
      suggestion: { platform: 'master', original, replacement: '模型给出的替换。' },
    })
    await Promise.resolve()
  })
  const message = latest!.state.projects[0]!.conversations[0]!.messages.at(-1)!
  const suggestion = message.suggestions?.[0]
  expect(suggestion).toBeTruthy()
  // 基线是发起请求时的正文，而不是建议到达时的正文
  expect(suggestion!.baseBody).toBe(SAMPLE_BODY)
  // 采用被过期保护拦截，手改正文不被覆盖
  await act(async () => {
    latest!.resolveSuggestion(suggestion!.id, 'accept')
    await Promise.resolve()
  })
  expect(latest!.notice).toContain('这条建议已过期')
  expect(latest!.state.projects[0]!.drafts.master!.body).toBe('用户在生成期间改写的新正文。')
})

test('F06：同一回复的两条建议逐条保留，均可分别采用', async () => {
  const state = makeState()
  const fake = fakePersistence(state)
  await mount(fake.persistence)
  await send('同时润色两处')
  const sessionKey = fake.sends[0]!.sessionKey
  const original1 = '一次散步、一本书、一段对话，甚至是一闪而过的念头，都可能成为一篇内容的起点。'
  const original2 = '灵感并不稀缺，稀缺的是我们愿意为它停留的片刻。'
  await act(async () => {
    fake.emitAi({
      type: 'suggestion',
      sessionKey,
      runId: 'run-1',
      suggestion: { platform: 'master', original: original1, replacement: '替换一。' },
    })
    fake.emitAi({
      type: 'suggestion',
      sessionKey,
      runId: 'run-1',
      suggestion: { platform: 'master', original: original2, replacement: '替换二。' },
    })
    await Promise.resolve()
  })
  const message = latest!.state.projects[0]!.conversations[0]!.messages.at(-1)!
  expect(message.suggestions).toHaveLength(2)
  const s1 = message.suggestions![0]!
  const s2 = message.suggestions![1]!
  expect(s1.id).not.toBe(s2.id)
  expect(s1.original).toBe(original1)
  expect(s2.original).toBe(original2)
  // 采用第一条；不相交的第二条基线跟随新正文，仍可继续采用
  await act(async () => {
    latest!.resolveSuggestion(s1.id, 'accept')
    await Promise.resolve()
  })
  const after1 = latest!.state.projects[0]!.conversations[0]!.messages.at(-1)!
  expect(after1.suggestions![0]!.status).toBe('accepted')
  expect(after1.suggestions![1]!.status).toBe('pending')
  expect(after1.suggestions![1]!.baseBody).toBe(latest!.state.projects[0]!.drafts.master!.body)
  await act(async () => {
    latest!.resolveSuggestion(s2.id, 'accept')
    await Promise.resolve()
  })
  const after2 = latest!.state.projects[0]!.conversations[0]!.messages.at(-1)!
  expect(after2.suggestions![1]!.status).toBe('accepted')
  expect(latest!.state.projects[0]!.drafts.master!.body).toContain('替换一。')
  expect(latest!.state.projects[0]!.drafts.master!.body).toContain('替换二。')
  expect(latest!.notice).toBe('已采用修改，并保留原文版本。')
})

test('F06：旧文档的单值 suggestion 字段继续可读、可采用（兼容）', async () => {
  const state = makeState()
  const fake = fakePersistence(state)
  await mount(fake.persistence)
  // 种子对话携带历史单值字段建议
  const legacy = latest!.state.projects[0]!.conversations[0]!.messages.find((m) => m.suggestion)!
  const suggestion = legacy.suggestion!
  expect(suggestion.status).toBe('pending')
  await act(async () => {
    latest!.resolveSuggestion(suggestion.id, 'accept')
    await Promise.resolve()
  })
  const after = latest!.state.projects[0]!.conversations[0]!.messages.find((m) => m.suggestion)!
  expect(after.suggestion!.status).toBe('accepted')
  expect(latest!.state.projects[0]!.drafts.master!.body).toContain(suggestion.replacement.slice(0, 12))
})

test('F01：配置模型后「整理成初稿」发起主进程母稿任务，产出经候选流落位', async () => {
  const state = makeState()
  const project = state.projects[0]!
  project.creation = { input: '第一行主题\n周五记录：存了很多链接，却很少重读。【唯一输入标记】', status: 'idle' }
  const fake = fakePersistence(state)
  await mount(fake.persistence)
  await act(async () => {
    latest!.runCreation()
    await Promise.resolve()
  })
  const submission = fake.submitted[0]!
  expect(submission).toMatchObject({ kind: 'agent', executor: 'main', projectId: project.id })
  const payload = submission.payload as {
    job: string
    briefText: string
    materialsText?: string
    snapshot: { input: string }
    creationSource?: string
  }
  expect(payload.job).toBe('master')
  expect(payload.briefText).toContain('主题：第一行主题')
  expect(payload.briefText).toContain('【唯一输入标记】')
  expect(payload.materialsText).toContain('创作，从一个小念头开始')
  expect(payload.snapshot.input).toBe(project.creation.input)
  expect(payload.creationSource).toBe('input')
  // 现有母稿不动，creation 不进入演示 running 态
  expect(latest!.state.projects[0]!.drafts.master!.body).toBe(SAMPLE_BODY)
  expect(latest!.state.projects[0]!.creation!.status).toBe('idle')
  // 模拟主进程任务完成：候选落位，采用前现有正文保留
  await act(async () => {
    fake.emitTask({
      id: submission.id!,
      state: 'complete',
      payload: submission.payload,
      result: { title: '新母稿标题', body: 'AI 生成的母稿正文。' },
    })
    await Promise.resolve()
  })
  const flow = latest!.state.projects[0]!.creation!
  expect(flow.status).toBe('candidate')
  expect(flow.candidate).toMatchObject({
    title: '新母稿标题',
    body: 'AI 生成的母稿正文。',
    baseBody: SAMPLE_BODY,
  })
  // 快照沿用发起时冻结值；来源保持 input，不误标 plan
  expect(flow.snapshot?.input).toBe(project.creation.input)
  expect(flow.source).toBe('input')
})

test('F01：未配置模型时整理仍走演示路径', async () => {
  const state = makeState()
  state.projects[0]!.creation = { input: '主题行\n记录', status: 'idle' }
  const fake = fakePersistence(state, false)
  await mount(fake.persistence)
  await act(async () => {
    latest!.runCreation()
    await Promise.resolve()
  })
  expect(fake.submitted).toEqual([])
  expect(latest!.state.projects[0]!.creation!.status).toBe('running')
})

test('F01/F08：单平台重新适配产出候选，来源标注取发起时的母稿与版本', async () => {
  const state = makeState()
  const fake = fakePersistence(state)
  await mount(fake.persistence)
  const redbookBody = latest!.state.projects[0]!.drafts.redbook!.body
  await act(async () => {
    latest!.regeneratePlatform('redbook')
    await Promise.resolve()
  })
  const submission = fake.submitted[0]!
  expect(submission).toMatchObject({ kind: 'agent', executor: 'main' })
  const payload = submission.payload as {
    job: string
    platforms: string[]
    skip: string[]
    masterBody: string
    sourceVersion: number
    regenerate?: boolean
  }
  expect(payload).toMatchObject({
    job: 'platforms',
    platforms: ['redbook'],
    skip: [],
    regenerate: true,
  })
  expect(payload.masterBody).toBe(SAMPLE_BODY)
  expect(payload.sourceVersion).toBe(1)
  // 生成期间母稿被改到 v2
  await act(async () => {
    latest!.patchDraft({ body: '生成期间的新母稿 v2。' }, '手动修改', 'master')
    await Promise.resolve()
  })
  await act(async () => {
    fake.emitTask({
      id: submission.id!,
      state: 'complete',
      payload: submission.payload,
      result: { drafts: { redbook: { title: '候选标题', body: 'AI 候选正文。' } } },
    })
    await Promise.resolve()
  })
  // 候选落位，现有平台稿不被覆盖；来源基线是发起时的母稿与版本
  const candidate = latest!.platformCandidate!
  expect(candidate).toMatchObject({
    projectId: state.projects[0]!.id,
    platform: 'redbook',
    title: '候选标题',
    body: 'AI 候选正文。',
    base: redbookBody,
    master: SAMPLE_BODY,
    version: 1,
  })
  expect(latest!.state.projects[0]!.drafts.redbook!.body).toBe(redbookBody)
  await act(async () => {
    latest!.adoptPlatformCandidate()
    await Promise.resolve()
  })
  const after = latest!.state.projects[0]!.drafts.redbook!
  expect(after.body).toBe('AI 候选正文。')
  expect(after.title).toBe('候选标题')
  // F08：来源标注指向发起时的母稿 v1，而不是落位时的 v2
  expect(after.sourceBody).toBe(SAMPLE_BODY)
  expect(after.sourceVersion).toBe(1)
  expect(latest!.platformCandidate).toBeNull()
})

test('F08：平台批量生成落位的来源标注取任务负载中的母稿快照，而非当前母稿', async () => {
  const state = makeState()
  const fake = fakePersistence(state)
  await mount(fake.persistence)
  // 落位前母稿已被改写
  await act(async () => {
    latest!.patchDraft({ body: '当前新母稿。' }, '手动修改', 'master')
    await Promise.resolve()
  })
  await act(async () => {
    fake.emitTask({
      id: 'task-platforms',
      state: 'complete',
      payload: { job: 'platforms', platforms: ['douyin'], masterBody: '发起时的母稿 v1。', sourceVersion: 4 },
      result: { drafts: { douyin: { title: '抖音标题', body: '抖音候选。' } } },
    })
    await Promise.resolve()
  })
  const douyin = latest!.state.projects[0]!.drafts.douyin!
  expect(douyin.body).toBe('抖音候选。')
  expect(douyin.sourceBody).toBe('发起时的母稿 v1。')
  expect(douyin.sourceVersion).toBe(4)
})

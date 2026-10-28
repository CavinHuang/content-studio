import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test } from 'vitest'
import type { AiConfigView, AiEvent } from '../../packages/desktop/src/shared/desktop'
import { seedState } from '../../packages/ui/src/studio/mock'
import { supplementArticlesToProject, topicNewArticles } from '../../packages/ui/src/studio/hotspot-followup'
import {
  __setPersistenceForTest,
  type AiBridge,
  type Persistence,
} from '../../packages/ui/src/studio/persistence'
import { StudioProvider, useStudio, type Store } from '../../packages/ui/src/studio/store'
import { HotspotsPage } from '../../packages/ui/src/pages/Hotspots'
import type { StudioState, Topic } from '../../packages/ui/src/studio/types'

// §20.4 显式更新流程 + §20.2/§20.3 AI 话题概览入口：
// 新文章差集计算、补充引用动作（不触母稿正文）、概览入口的未配置降级。

;(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

function makeState(): StudioState {
  return { ...(seedState() as Omit<StudioState, 'schema'>), schema: 3 } as unknown as StudioState
}

/** 模拟热点后续变化：向 commute 话题追加快照之外的新文章。 */
function appendFollowupArticles(state: StudioState, ...ids: string[]): Topic {
  const topic = state.topics.find((t) => t.id === 'commute')!
  for (const [index, id] of ids.entries())
    topic.articles.push({
      id,
      title: `通勤观察的新进展 ${index + 1}`,
      sourceIds: ['zhihu'],
      url: `https://example.com/articles/${id}`,
      body: index % 2 === 0 ? '【演示原文】这条是创建内容之后新收录的进展。' : '',
      published: '10/27 08:00',
      collected: '10/27 09:00',
    })
  return topic
}

function localPersistence(workspace: StudioState): Persistence {
  return {
    mode: 'local',
    ai: null,
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
      return workspace.tasks
    },
    async taskSubmit() {
      return null
    },
    async taskSettle() {
      return false
    },
    async taskControl() {},
    onTasks() {
      return () => {}
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

type AiHarness = {
  ai: AiBridge
  sends: Array<{ sessionKey: string; text: string }>
  emit: (event: AiEvent) => void
}

function aiPersistence(workspace: StudioState, configured = true): { persistence: Persistence } & AiHarness {
  const listeners: Array<(event: AiEvent) => void> = []
  const sends: Array<{ sessionKey: string; text: string }> = []
  const view: AiConfigView | null = configured
    ? { providerId: 'p', baseUrl: 'https://model.example.com', modelId: 'm', hasKey: true, apiKeyTail: '…789' }
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
      return { ok: true, runId: 'run-overview' }
    },
    cancel: async () => ({ ok: true }),
    answer: async () => ({ ok: true }),
    onEvent(listener) {
      listeners.push(listener)
      return () => {}
    },
  }
  return {
    persistence: { ...localPersistence(workspace), ai },
    ai,
    sends,
    emit: (event) => listeners.forEach((listener) => listener(event)),
  }
}

async function mount(persistence: Persistence, children: React.ReactNode = <Probe />) {
  // children 由调用方传入；默认仅挂 Probe
  __setPersistenceForTest(persistence)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<StudioProvider>{children}</StudioProvider>)
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
})

test('§20.4 差集：新文章＝当前聚合 − 创建时快照 − 已补充记录；不相关项目不产出', () => {
  const state = makeState()
  const topic = appendFollowupArticles(state, 'commute-3', 'commute-4')
  const project = state.projects.find((p) => p.source?.topicId === 'commute')!
  expect(project.source!.articleIds).toEqual(['commute-1', 'commute-2'])
  expect(topicNewArticles(topic, project).map((a) => a.id)).toEqual(['commute-3', 'commute-4'])
  // 非本热点创建的项目没有差集可言
  expect(topicNewArticles(topic, state.projects[0]!)).toEqual([])
  // 已补充过的文章不再计为新文章（快照本身保持创建时原样）
  project.source!.supplementedArticleIds = ['commute-3']
  expect(topicNewArticles(topic, project).map((a) => a.id)).toEqual(['commute-4'])
})

test('§20.4 补充动作：选中文章保存为素材并引用到项目，母稿正文与创建快照不动', () => {
  const state = makeState()
  appendFollowupArticles(state, 'commute-3')
  const project = state.projects.find((p) => p.source?.topicId === 'commute')!
  const master = project.drafts.master!
  const materialsBefore = state.materials.length
  const next = supplementArticlesToProject(state, 'commute', project.id, ['commute-3'])
  const after = next.projects.find((p) => p.id === project.id)!
  // 母稿正文、标题与版本记录一概不动（改稿只经既有建议/候选流）
  expect(after.drafts.master?.body).toBe(master.body)
  expect(after.drafts.master?.title).toBe(master.title)
  expect(after.drafts.master?.versions).toHaveLength(master.versions.length)
  // 创建时快照保留；补充记录另行落位
  expect(after.source?.articleIds).toEqual(['commute-1', 'commute-2'])
  expect(after.source?.supplementedArticleIds).toEqual(['commute-3'])
  // 保存为素材并引用（沿用既有素材引用模型）
  expect(next.materials).toHaveLength(materialsBefore + 1)
  const material = next.materials.find((m) => m.url === 'https://example.com/articles/commute-3')!
  expect(material).toMatchObject({ title: '通勤观察的新进展 1', readState: 'ready' })
  expect(after.materialIds).toContain(material.id)
  // 项目侧提示落在当前会话：已补充 N 篇新进展素材，可在 Agent 中生成修改建议
  const conversation = after.conversations.find((c) => c.id === after.activeConversation)!
  expect(conversation.messages.at(-1)?.text).toContain('已补充 1 篇新进展素材，可在 Agent 中生成修改建议')
  // 重复补充同一篇：无变化（素材不重复、引用不重复）
  const again = supplementArticlesToProject(next, 'commute', project.id, ['commute-3'])
  expect(again).toBe(next)
})

test('§20.4 补充动作：同一链接已有素材时复用，不重复入库；仅链接文章如实标注', () => {
  const state = makeState()
  appendFollowupArticles(state, 'commute-3', 'commute-4')
  const project = state.projects.find((p) => p.source?.topicId === 'commute')!
  state.materials = [
    ...state.materials,
    {
      id: 'existing-material',
      title: '用户先前保存的原文',
      type: 'link',
      body: '',
      url: 'https://example.com/articles/commute-3',
      tags: ['热点来源'],
      at: '2026-10-26T00:00:00Z',
    },
  ]
  const next = supplementArticlesToProject(state, 'commute', project.id, ['commute-3', 'commute-4'])
  const after = next.projects.find((p) => p.id === project.id)!
  // commute-3 复用既有素材；commute-4 新建（仅链接 → link-only）
  expect(next.materials.filter((m) => m.url === 'https://example.com/articles/commute-3')).toHaveLength(1)
  expect(after.materialIds).toContain('existing-material')
  const fresh = next.materials.find((m) => m.url === 'https://example.com/articles/commute-4')!
  expect(fresh.readState).toBe('link-only')
  expect(after.materialIds).toContain(fresh.id)
})

test('§20.4 入口：话题详情按项目显示「本热点有 N 篇新文章」，勾选后经 store 动作补充', async () => {
  const state = makeState()
  appendFollowupArticles(state, 'commute-3')
  state.page = 'hotspots'
  state.selectedTopic = 'commute'
  await mount(localPersistence(state), <><Probe /><HotspotsPage /></>)
  expect(container!.textContent).toContain('本热点有 1 篇新文章')
  // 勾选新文章并点击补充（Radix Checkbox 渲染为 role=checkbox 按钮）
  const check = container!.querySelector('.topic-update-project button[role="checkbox"]') as HTMLButtonElement
  expect(check).toBeTruthy()
  await act(async () => {
    check.click()
    await Promise.resolve()
  })
  const button = [...container!.querySelectorAll('.topic-update-project button')].find((b) =>
    b.textContent?.includes('补充所选'),
  )! as HTMLButtonElement
  expect(button.textContent).toContain('补充所选（1）')
  const projectId = state.projects.find((p) => p.source?.topicId === 'commute')!.id
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
  const project = latest!.state.projects.find((p) => p.id === projectId)!
  expect(project.source?.supplementedArticleIds).toEqual(['commute-3'])
  expect(latest!.state.materials.some((m) => m.url === 'https://example.com/articles/commute-3')).toBe(true)
  expect(latest!.notice).toContain('已补充 1 篇新进展素材，可在 Agent 中生成修改建议')
  // 补充完成后入口不再罗列该文章
  expect(container!.textContent).not.toContain('本热点有 1 篇新文章')
})

test('§20.2/§20.3 AI 概览入口：未配置模型不出现，配置后经一次性会话生成并与原文分开显示', async () => {
  const state = makeState()
  state.page = 'hotspots'
  state.selectedTopic = 'commute'
  // 未配置（含本地降级 ai:null）：入口不出现 —— 照角度建议先例的模型就绪门禁
  await mount(localPersistence(state))
  expect([...container!.querySelectorAll('button')].some((b) => b.textContent?.includes('AI 概览'))).toBe(false)
  act(() => root?.unmount())
  container?.remove()
  // 已配置模型：入口出现，点击后经 AgentService 一次性会话生成概览
  const harness = aiPersistence(state)
  await mount(harness.persistence, <><Probe /><HotspotsPage /></>)
  const overviewButton = () =>
    [...container!.querySelectorAll('button')].find((b) => b.textContent?.includes('AI 概览'))!
  expect(overviewButton()).toBeTruthy()
  await act(async () => {
    overviewButton().click()
    await Promise.resolve()
  })
  expect(latest!.overviewBusy['commute']).toBe(true)
  expect(harness.sends).toHaveLength(1)
  expect(harness.sends[0]!.sessionKey.startsWith('gen:overview-')).toBe(true)
  // prompt 约束：只依据所给来源正文；未读正文的来源不得生成确定口吻摘要
  expect(harness.sends[0]!.text).toContain('只依据所给来源正文')
  expect(harness.sends[0]!.text).toContain('未读正文的来源不得生成确定口吻摘要')
  await act(async () => {
    harness.emit({ type: 'run_start', sessionKey: harness.sends[0]!.sessionKey, runId: 'run-overview' })
    harness.emit({ type: 'delta', sessionKey: harness.sends[0]!.sessionKey, runId: 'run-overview', text: '通勤讨论的新背景：' })
    harness.emit({ type: 'delta', sessionKey: harness.sends[0]!.sessionKey, runId: 'run-overview', text: '来源观点存在差异。' })
    await Promise.resolve()
  })
  await act(async () => {
    harness.emit({ type: 'run_end', sessionKey: harness.sends[0]!.sessionKey, runId: 'run-overview', ok: true })
    await Promise.resolve()
  })
  expect(latest!.state.topicOverviews['commute']).toMatchObject({
    text: '通勤讨论的新背景：来源观点存在差异。',
  })
  expect(latest!.overviewBusy['commute']).toBe(false)
  // 展示区与原文分栏并明确标注「AI 归纳，与原文分开」
  const overviewPanel = container!.querySelector('.topic-overview')
  expect(overviewPanel).toBeTruthy()
  expect(overviewPanel!.textContent).toContain('AI 归纳，与原文分开')
  expect(overviewPanel!.textContent).toContain('通勤讨论的新背景：来源观点存在差异。')
  // 原文清单仍在（分栏而非替换）
  expect(container!.querySelector('.topic-article-list')).toBeTruthy()
})

test('§20.2/§20.3 AI 概览失败降级：run_end 失败时不落概览、通知如实，原文来源不受影响', async () => {
  const state = makeState()
  state.page = 'hotspots'
  state.selectedTopic = 'commute'
  const harness = aiPersistence(state)
  await mount(harness.persistence, <Probe />)
  await act(async () => {
    latest!.generateTopicOverview(state.topics.find((t) => t.id === 'commute')!)
    await Promise.resolve()
  })
  const sessionKey = harness.sends[0]!.sessionKey
  await act(async () => {
    harness.emit({ type: 'run_end', sessionKey, runId: 'run-overview', ok: false, error: '模型请求失败' })
    await Promise.resolve()
  })
  expect(latest!.state.topicOverviews['commute']).toBeUndefined()
  expect(latest!.overviewBusy['commute']).toBe(false)
  expect(latest!.notice).toContain('概览生成失败')
})

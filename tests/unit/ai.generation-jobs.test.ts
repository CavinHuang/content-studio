import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, test } from 'vitest'
import type { TaskEvent } from '../../packages/desktop/src/shared/desktop'
import { migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import { TaskStore } from '../../packages/desktop/src/main/storage/taskStore'
import { TaskRunner } from '../../packages/desktop/src/main/tasks/runner'
import {
  createMasterDraftExecutor,
  createPlatformRewriteExecutor,
} from '../../packages/desktop/src/main/ai/generation-jobs'
import type { SessionLike } from '../../packages/desktop/src/main/ai/agent-service'
import type { AiDraftPayload } from '../../packages/desktop/src/shared/desktop'
import type { CollectFn } from '../../packages/desktop/src/main/ai/domain-tools'

let db: DatabaseSync | undefined
afterEach(() => {
  db?.close()
  db = undefined
})

function makeRunner() {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-gen-')), 'studio.db'))
  migrate(db)
  const events: TaskEvent[] = []
  const runner = new TaskRunner(new TaskStore(db), (event) => events.push(event))
  return { runner, events }
}

function scriptedSession(
  collect: CollectFn,
  script: (session: FakeGenSession, collect: CollectFn) => void,
): FakeGenSession {
  const session = new FakeGenSession()
  script(session, collect)
  return session
}

async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor 条件超时')
    await new Promise((r) => setTimeout(r, 5))
  }
}

class FakeGenSession implements SessionLike {
  promptImpl: (text: string) => Promise<void> = async () => {}
  /** abort() 时的附加行为：测试用它让挂起的 prompt 立即返回（模拟真实会话的中断）。 */
  onAbort: () => void = () => {}
  promptCalls = 0
  abortCalls = 0
  disposeCalls = 0
  subscribe() {
    return () => {}
  }
  async prompt(text: string) {
    this.promptCalls++
    await this.promptImpl(text)
  }
  async abort() {
    this.abortCalls++
    this.onAbort()
  }
  async waitForIdle() {}
  dispose() {
    this.disposeCalls++
  }
}

const config = { providerId: 'x', baseUrl: 'http://x/v1', apiKey: 'k', modelId: 'm' }

test('平台改写：逐平台会话经 collect 收集产物，skip 平台跳过', async () => {
  const { runner } = makeRunner()
  const prompts: string[] = []
  const sessions: FakeGenSession[] = []
  const platformExecutor = createPlatformRewriteExecutor({
    createSession: async (_key, _ask, collect) => {
      const session = scriptedSession(collect ?? (() => {}), (session, collect) => {
        session.promptImpl = async (text) => {
          prompts.push(text)
          const platform = /「(\w+)」平台版本/.exec(text)?.[1] ?? 'wechat'
          collect({
            kind: 'draft',
            payload: {
              title: `${platform} 标题`,
              body: `${platform} 正文`,
              note: platform,
            } as AiDraftPayload,
          })
        }
      })
      sessions.push(session)
      return session
    },
    getConfig: () => config,
  })
  runner.registerExecutor('agent', platformExecutor)
  const task = runner.submit({
    kind: 'agent',
    executor: 'main',
    title: '准备平台版本',
    detail: '',
    projectId: 'p1',
    payload: {
      job: 'platforms',
      platforms: ['wechat', 'redbook'],
      skip: ['redbook'],
      masterTitle: '母',
      masterBody: '正文',
    },
  })
  await new Promise((r) => setTimeout(r, 30))
  const done = runner.get(task.id)!
  expect(done.state).toBe('complete')
  expect(done.detail).toContain('已生成 1 个平台版本')
  const result = done.result as { drafts: Record<string, { title: string }> }
  expect(result.drafts.wechat).toMatchObject({ title: 'wechat 标题' })
  expect(result.drafts.redbook).toBeUndefined()
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toContain('write_master_draft')
  expect(sessions).toHaveLength(1)
  expect(sessions[0]!.disposeCalls).toBe(1) // 一次性会话在结束后恰好释放一次
})

test('平台改写部分失败：结算 partial（§12 部分完成），成功平台产物可用、失败项列明', async () => {
  const { runner } = makeRunner()
  const platformExecutor = createPlatformRewriteExecutor({
    createSession: async (_key, _ask, collect) =>
      scriptedSession(collect ?? (() => {}), (session, collect) => {
        session.promptImpl = async (text) => {
          const platform = /「(\w+)」平台版本/.exec(text)?.[1] ?? 'wechat'
          if (platform === 'zhihu') return // zhihu 会话未提交候选 → 失败项
          collect({
            kind: 'draft',
            payload: {
              title: `${platform} 标题`,
              body: `${platform} 正文`,
              note: platform,
            } as AiDraftPayload,
          })
        }
      }),
    getConfig: () => config,
  })
  runner.registerExecutor('agent', platformExecutor)
  const task = runner.submit({
    kind: 'agent',
    executor: 'main',
    title: '准备平台版本',
    detail: '',
    projectId: 'p1',
    payload: { job: 'platforms', platforms: ['wechat', 'zhihu'], masterTitle: '母', masterBody: '正文' },
  })
  await new Promise((r) => setTimeout(r, 30))
  const done = runner.get(task.id)!
  expect(done.state).toBe('partial')
  expect(done.detail).toContain('已生成 1 个平台版本')
  expect(done.detail).toContain('失败：zhihu')
  const result = done.result as { drafts: Record<string, { title: string }>; failed: string[] }
  expect(result.drafts.wechat).toMatchObject({ title: 'wechat 标题' })
  expect(result.failed).toEqual(['zhihu'])
})

test('母稿候选：无产出判失败；停止拒绝迟到结算', async () => {
  const { runner } = makeRunner()
  const masterExecutor = createMasterDraftExecutor({
    createSession: async () =>
      scriptedSession(
        () => {},
        () => {},
      ),
    getConfig: () => config,
  })
  runner.registerExecutor('agent', masterExecutor)
  const task = runner.submit({
    kind: 'agent',
    executor: 'main',
    title: '按方案生成母稿',
    detail: '',
    projectId: 'p1',
    payload: { job: 'master', briefText: '主题：测试' },
  })
  await new Promise((r) => setTimeout(r, 20))
  expect(runner.get(task.id)).toMatchObject({ state: 'failed', detail: '模型未提交候选。' })
})

test('main 执行器中止：control stop 触发 AbortSignal', async () => {
  const { runner } = makeRunner()
  let aborted = false
  runner.registerExecutor('kind-hold', async (_task, ctx) => {
    return new Promise((resolve) => {
      ctx.signal.addEventListener('abort', () => {
        aborted = true
        resolve({ state: 'failed', detail: '已中止。' })
      })
    })
  })
  const task = runner.submit({ kind: 'kind-hold', executor: 'main', title: 't', detail: '', projectId: 'p1' })
  await new Promise((r) => setTimeout(r, 10))
  runner.control(task.id, 'stop')
  await new Promise((r) => setTimeout(r, 20))
  expect(aborted).toBe(true)
  expect(runner.get(task.id)).toMatchObject({ state: 'stopped' })
})

test('母稿生成：停止任务会中止运行中的会话请求，结束时恰好释放一次', async () => {
  const { runner } = makeRunner()
  const session = new FakeGenSession()
  let releasePrompt: () => void = () => {}
  session.promptImpl = () =>
    new Promise<void>((resolve) => {
      releasePrompt = resolve
    })
  session.onAbort = () => releasePrompt() // 模拟真实会话：abort 中断当前请求使 prompt 返回
  const masterExecutor = createMasterDraftExecutor({
    createSession: async () => session,
    getConfig: () => config,
  })
  runner.registerExecutor('agent', masterExecutor)
  const task = runner.submit({
    kind: 'agent',
    executor: 'main',
    title: '按方案生成母稿',
    detail: '',
    projectId: 'p1',
    payload: { job: 'master', briefText: '主题：测试' },
  })
  await waitFor(() => session.promptCalls === 1) // prompt 正在运行
  runner.control(task.id, 'stop')
  await waitFor(() => session.abortCalls === 1) // 运行中的请求收到中止
  releasePrompt()
  await new Promise((r) => setTimeout(r, 20))
  expect(session.abortCalls).toBe(1)
  expect(session.disposeCalls).toBe(1)
  // 停止后执行器的迟到结算被拒：任务保持 stopped，不回写失败/完成
  expect(runner.get(task.id)).toMatchObject({ state: 'stopped' })
})

test('母稿生成：会话创建期间已停止时不发起 prompt，创建后直接释放', async () => {
  const { runner } = makeRunner()
  const session = new FakeGenSession()
  let resolveCreate: (s: FakeGenSession) => void = () => {}
  const masterExecutor = createMasterDraftExecutor({
    createSession: () =>
      new Promise<FakeGenSession>((resolve) => {
        resolveCreate = resolve
      }),
    getConfig: () => config,
  })
  runner.registerExecutor('agent', masterExecutor)
  const task = runner.submit({
    kind: 'agent',
    executor: 'main',
    title: '按方案生成母稿',
    detail: '',
    projectId: 'p1',
    payload: { job: 'master', briefText: '主题：测试' },
  })
  await new Promise((r) => setTimeout(r, 10)) // 执行器已进入会话创建等待
  runner.control(task.id, 'stop')
  resolveCreate(session)
  await new Promise((r) => setTimeout(r, 20))
  expect(session.promptCalls).toBe(0) // 竞态：创建前已停止则不再 prompt
  expect(session.disposeCalls).toBe(1)
  expect(runner.get(task.id)).toMatchObject({ state: 'stopped' })
})

test('平台改写：停止任务中止当前平台请求且不再进入下一平台', async () => {
  const { runner } = makeRunner()
  const sessions: FakeGenSession[] = []
  const platformExecutor = createPlatformRewriteExecutor({
    createSession: async () => {
      const s = new FakeGenSession()
      let release: () => void = () => {}
      s.promptImpl = () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
      s.onAbort = () => release() // abort 中断当前平台请求
      sessions.push(s)
      return s
    },
    getConfig: () => config,
  })
  runner.registerExecutor('agent', platformExecutor)
  const task = runner.submit({
    kind: 'agent',
    executor: 'main',
    title: '准备平台版本',
    detail: '',
    projectId: 'p1',
    payload: { job: 'platforms', platforms: ['wechat', 'redbook'], masterTitle: '母', masterBody: '正文' },
  })
  await waitFor(() => sessions.length === 1 && sessions[0]!.promptCalls === 1)
  runner.control(task.id, 'stop')
  await new Promise((r) => setTimeout(r, 20))
  expect(sessions[0]!.abortCalls).toBe(1) // 当前平台的请求被中止
  expect(sessions[0]!.disposeCalls).toBe(1)
  expect(sessions).toHaveLength(1) // 中止后不再创建第二平台的会话
  expect(runner.get(task.id)).toMatchObject({ state: 'stopped' })
})

test('母稿生成：请求失败路径同样恰好释放会话一次', async () => {
  const { runner } = makeRunner()
  const session = new FakeGenSession()
  session.promptImpl = async () => {
    throw new Error('模型请求失败')
  }
  const masterExecutor = createMasterDraftExecutor({
    createSession: async () => session,
    getConfig: () => config,
  })
  runner.registerExecutor('agent', masterExecutor)
  const task = runner.submit({
    kind: 'agent',
    executor: 'main',
    title: '按方案生成母稿',
    detail: '',
    projectId: 'p1',
    payload: { job: 'master', briefText: '主题：测试' },
  })
  await new Promise((r) => setTimeout(r, 20))
  expect(runner.get(task.id)).toMatchObject({ state: 'failed', error: '模型请求失败' })
  expect(session.disposeCalls).toBe(1)
  expect(session.abortCalls).toBe(0)
})

test('renderer 执行器任务不受 main 注册影响', async () => {
  const { runner } = makeRunner()
  runner.registerExecutor('agent', async () => ({ state: 'complete' }))
  const task = runner.submit({ kind: 'agent', title: 't', detail: '', projectId: 'p1' })
  await new Promise((r) => setTimeout(r, 10))
  expect(runner.get(task.id)).toMatchObject({ state: 'running' }) // 由渲染端结算
  expect(runner.settle(task.id, { state: 'complete' })).toMatchObject({ state: 'complete' })
})

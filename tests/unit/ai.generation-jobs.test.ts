import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, test } from 'vitest'
import type { TaskEvent } from '../../packages/desktop/src/shared/desktop'
import { migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import { TaskStore } from '../../packages/desktop/src/main/storage/taskStore'
import { TaskRunner } from '../../packages/desktop/src/main/tasks/runner'
import { createMasterDraftExecutor, createPlatformRewriteExecutor } from '../../packages/desktop/src/main/ai/generation-jobs'
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

function scriptedSession(collect: CollectFn, script: (session: FakeGenSession, collect: CollectFn) => void): FakeGenSession {
  const session = new FakeGenSession()
  script(session, collect)
  return session
}

class FakeGenSession implements SessionLike {
  promptImpl: (text: string) => Promise<void> = async () => {}
  subscribe() {
    return () => {}
  }
  async prompt(text: string) {
    await this.promptImpl(text)
  }
  async abort() {}
  async waitForIdle() {}
  dispose() {}
}

const config = { providerId: 'x', baseUrl: 'http://x/v1', apiKey: 'k', modelId: 'm' }

test('平台改写：逐平台会话经 collect 收集产物，skip 平台跳过', async () => {
  const { runner } = makeRunner()
  const prompts: string[] = []
  const platformExecutor = createPlatformRewriteExecutor({
    createSession: async (_key, _ask, collect) => scriptedSession(collect ?? (() => {}), (session, collect) => {
        session.promptImpl = async (text) => {
          prompts.push(text)
          const platform = /「(\w+)」平台版本/.exec(text)?.[1] ?? 'wechat'
          collect({ kind: 'draft', payload: { title: `${platform} 标题`, body: `${platform} 正文`, note: platform } as AiDraftPayload })
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
    payload: { job: 'platforms', platforms: ['wechat', 'redbook'], skip: ['redbook'], masterTitle: '母', masterBody: '正文' },
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
})

test('母稿候选：无产出判失败；停止拒绝迟到结算', async () => {
  const { runner } = makeRunner()
  const masterExecutor = createMasterDraftExecutor({
    createSession: async () => scriptedSession(() => {}, () => {}),
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

test('renderer 执行器任务不受 main 注册影响', async () => {
  const { runner } = makeRunner()
  runner.registerExecutor('agent', async () => ({ state: 'complete' }))
  const task = runner.submit({ kind: 'agent', title: 't', detail: '', projectId: 'p1' })
  await new Promise((r) => setTimeout(r, 10))
  expect(runner.get(task.id)).toMatchObject({ state: 'running' }) // 由渲染端结算
  expect(runner.settle(task.id, { state: 'complete' })).toMatchObject({ state: 'complete' })
})

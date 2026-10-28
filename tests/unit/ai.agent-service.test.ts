import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { expect, test } from 'vitest'
import type { AiEvent } from '../../packages/desktop/src/shared/desktop'
import { AgentService, type SessionLike, type PiEventLike } from '../../packages/desktop/src/main/ai/agent-service'
import { createRealSessionFactory } from '../../packages/desktop/src/main/ai/real-session'
import { validateModelConfig } from '../../packages/desktop/src/main/ai/model-config'

function makeService(script: (session: FakeSession) => void) {
  const events: AiEvent[] = []
  let current: FakeSession | null = null
  const service = new AgentService({
    createSession: async () => {
      const session = new FakeSession()
      current = session
      script(session)
      return session
    },
    emit: (ev) => events.push(ev),
    hasModelConfig: () => true,
  })
  return { service, events, get current() { return current! } }
}

class FakeSession implements SessionLike {
  prompts: string[] = []
  private listeners: Array<(ev: PiEventLike) => void> = []
  promptImpl: (text: string) => Promise<void> = async () => {}
  subscribe(listener: (ev: PiEventLike) => void): () => void {
    this.listeners.push(listener)
    return () => {}
  }
  emit(ev: PiEventLike) {
    for (const listener of this.listeners) listener(ev)
  }
  async prompt(text: string) {
    this.prompts.push(text)
    await this.promptImpl(text)
  }
  async abort() {
    this.promptImpl = async () => {}
  }
  async waitForIdle() {}
  dispose() {}
}

test('send 成功：run_start/delta/run_end 序列，prompt 传原文', async () => {
  const { service, events } = makeService((session) => {
    session.promptImpl = async () => {
      session.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '你好' } })
    }
  })
  const result = await service.send('p:p1', '写一段')
  expect(result).toMatchObject({ ok: true })
  await new Promise((r) => setTimeout(r, 20))
  expect(events.map((e) => e.type)).toEqual(['run_start', 'delta', 'run_end'])
  expect(events[1]).toMatchObject({ text: '你好', sessionKey: 'p:p1' })
})

test('并发 1：运行中二次 send 拒绝（原子占用）', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const { service, events } = makeService((session) => {
    session.promptImpl = async () => {
      await gate
    }
  })
  await service.send('p:p1', '第一')
  const second = await service.send('p:p1', '第二')
  expect(second).toMatchObject({ ok: false, code: 'AGENT_BUSY' })
  release()
  await new Promise((r) => setTimeout(r, 20))
  expect(events.at(-1)).toMatchObject({ type: 'run_end', ok: true })
})

test('无模型配置：NO_MODEL_CONFIG 且不建会话', async () => {
  const events: AiEvent[] = []
  const service = new AgentService({ createSession: async () => new FakeSession(), emit: (ev) => events.push(ev), hasModelConfig: () => false })
  expect(await service.send('p:p1', 'hi')).toMatchObject({ ok: false, code: 'NO_MODEL_CONFIG' })
  expect(events).toEqual([])
})

test('write_suggestion/write_master_draft 产出随 run 结束事件化', async () => {
  const { service, events } = makeService(() => {})
  const run = await service.send('p:p1', '给建议')
  service.collect({ kind: 'suggestion', payload: { platform: 'master', original: '旧', replacement: '新' } })
  await new Promise((r) => setTimeout(r, 20))
  expect(events).toEqual(
    expect.arrayContaining([
      { type: 'suggestion', sessionKey: 'p:p1', runId: run.runId, suggestion: { platform: 'master', original: '旧', replacement: '新' } },
      { type: 'run_end', sessionKey: 'p:p1', runId: run.runId, ok: true },
    ]),
  )
})

test('ask_user 问询事件与回答回传；取消收口', async () => {
  const events: AiEvent[] = []
  let asked: ((question: string, options?: string[]) => Promise<string>) | null = null
  const service = new AgentService({
    createSession: async (_key, askUser) => {
      asked = askUser
      const session = new FakeSession()
      session.promptImpl = async () => {
        void askUser('目标读者是谁？', ['技术读者', '普通读者'])
      }
      return session
    },
    emit: (ev) => events.push(ev),
    hasModelConfig: () => true,
  })
  expect(asked).toBeNull()
  const run = await service.send('p:p1', '问我')
  await new Promise((r) => setTimeout(r, 20))
  const ask = events.find((e) => e.type === 'ask') as Extract<AiEvent, { type: 'ask' }> | undefined
  expect(ask).toMatchObject({ question: '目标读者是谁？', options: ['技术读者', '普通读者'] })
  service.answer(ask!.questionId, '技术读者')
  await new Promise((r) => setTimeout(r, 30))
  expect(events.at(-1)).toMatchObject({ type: 'run_end', sessionKey: 'p:p1', runId: run.runId, ok: true })
})

test('real-session 工厂：无配置抛 NO_MODEL_CONFIG；目录就位后建 stub 会话', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'studio-ai-session-'))
  const factory = createRealSessionFactory({
    userDataDir: () => userData,
    getConfig: () => null,
    collect: () => {},
  })
  await expect(factory('p:p1', async () => '')).rejects.toMatchObject({ code: 'NO_MODEL_CONFIG' })

  const config = validateModelConfig({ baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'k', modelId: 'm' })
  let seen: Record<string, unknown> | null = null
  const factory2 = createRealSessionFactory(
    {
      userDataDir: () => userData,
      getConfig: () => config,
      collect: () => {},
    },
    async (options) => {
      seen = options
      return new FakeSession()
    },
  )
  const session = await factory2('p:abc', async () => '')
  expect(typeof session.prompt).toBe('function')
  expect(existsSync(join(userData, 'pi-sessions', 'p-abc'))).toBe(true)
  expect(seen).toMatchObject({ sessionDir: join(userData, 'pi-sessions', 'p-abc') })
})

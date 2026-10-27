/**
 * PublishService 发布编排单测（spec P4 §4.4，全部假适配器＋假时钟，不联网不开页面）：
 * - 平台间串行互斥：共用一条链逐个执行，前一动作完成后一动作才开始；
 * - 相邻最小间隔：默认 15s（env STUDIO_PUBLISH_MIN_INTERVAL_MS 可调），首个动作不等待；
 * - 失败三分类：transient（网络/超时）按限速自动重试；credential（未配置/未登录）立即停下要求配置；
 *   permanent（其余）一次如实上报，绝不静默当成功；
 * - usesSession 分流：页面会话平台由编排层开平台会话，API 平台绝不触碰页面会话；
 * - 链不断：单任务失败不影响后续平台动作；未知平台如实拒绝；停止信号后不再执行平台动作。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type { TaskRecord } from '../../packages/desktop/src/shared/desktop'
import { migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import { TaskStore } from '../../packages/desktop/src/main/storage/taskStore'
import { TaskRunner } from '../../packages/desktop/src/main/tasks/runner'
import {
  PublishService,
  type PublishAdapter,
  type PublishRunOutcome,
} from '../../packages/desktop/src/main/publish/publish-service'

afterEach(() => {
  delete process.env.STUDIO_PUBLISH_MIN_INTERVAL_MS
})

/** 假时钟：now 可读、sleep 记录并推进时间（编排层限速全靠它，不真等）。 */
class FakeClock {
  time = 0
  readonly sleeps: number[] = []
  readonly now = (): number => this.time
  readonly sleep = (ms: number): Promise<void> => {
    this.sleeps.push(ms)
    this.time += ms
    return Promise.resolve()
  }
}

let taskSeq = 0
function makeTask(platform?: string): TaskRecord {
  taskSeq += 1
  return {
    id: `t-${taskSeq}`,
    title: '发布任务',
    detail: '正在执行…',
    projectId: 'p1',
    state: 'running',
    kind: 'publish',
    at: `2026-10-28T00:00:${String(taskSeq).padStart(2, '0')}.000Z`,
    updated: `2026-10-28T00:00:${String(taskSeq).padStart(2, '0')}.000Z`,
    executor: 'main',
    ...(platform ? { payload: { platform } } : {}),
  }
}

function makeCtx(signal?: AbortSignal) {
  const steps: string[] = []
  return {
    steps,
    ctx: { progress: (step: string) => steps.push(step), signal: signal ?? new AbortController().signal },
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 脚本化假适配器：按脚本逐次返回结果（缺省重复末项），记录每次调用的开始时间与会话。 */
function scriptedAdapter(options: {
  platform: string
  usesSession?: boolean
  now: () => number
  script: Array<PublishRunOutcome | Error | Promise<PublishRunOutcome>>
}): PublishAdapter & { calls: Array<{ at: number; session: unknown }> } {
  const calls: Array<{ at: number; session: unknown }> = []
  let index = 0
  const adapter: PublishAdapter = {
    platform: options.platform,
    usesSession: options.usesSession ?? false,
    run: async ({ session }) => {
      calls.push({ at: options.now(), session })
      const step = options.script[Math.min(index, options.script.length - 1)]!
      index += 1
      if (step instanceof Error) throw step
      return await step
    },
  }
  return Object.assign(adapter, { calls })
}

const ok = (detail: string): PublishRunOutcome => ({ ok: true, detail })
const transient = (detail: string, code = 'NETWORK'): PublishRunOutcome => ({
  ok: false,
  category: 'transient',
  code,
  detail,
})
const credential = (detail: string, code = 'NO_CONFIG'): PublishRunOutcome => ({
  ok: false,
  category: 'credential',
  code,
  detail,
})
const permanent = (detail: string, code?: string): PublishRunOutcome => ({
  ok: false,
  category: 'permanent',
  ...(code ? { code } : {}),
  detail,
})

function neverOpenSession(): Promise<unknown> {
  return Promise.reject(new Error('测试不应打开页面会话'))
}

test('串行互斥与限速：相邻平台动作间隔默认 15s，首个动作不等待', async () => {
  const clock = new FakeClock()
  let releaseFirst: (() => void) | undefined
  const firstRun = new Promise<PublishRunOutcome>((resolve) => {
    releaseFirst = () => resolve(ok('平台一完成'))
  })
  const a = scriptedAdapter({ platform: 'a', now: clock.now, script: [firstRun] })
  const b = scriptedAdapter({ platform: 'b', now: clock.now, script: [ok('平台二完成')] })
  const service = new PublishService({ openSession: neverOpenSession, now: clock.now, sleep: clock.sleep })
  service.register(a)
  service.register(b)
  const executor = service.createExecutor()
  const first = executor(makeTask('a'), makeCtx().ctx)
  const second = executor(makeTask('b'), makeCtx().ctx)
  await flush()
  // 串行：平台一未完成前，平台二绝不开始
  expect(a.calls).toHaveLength(1)
  expect(b.calls).toHaveLength(0)
  releaseFirst!()
  const outcomes = await Promise.all([first, second])
  expect(outcomes.map((outcome) => outcome.state)).toEqual(['complete', 'complete'])
  // 限速：平台二等满 15s 才开始；首个动作零等待
  expect(clock.sleeps).toEqual([15_000])
  expect(a.calls[0]!.at).toBe(0)
  expect(b.calls[0]!.at).toBe(15_000)
})

test('限速间隔可由 STUDIO_PUBLISH_MIN_INTERVAL_MS 覆盖；非法值回落默认 15s', async () => {
  const clock = new FakeClock()
  const run = async (env: string | undefined, expected: number) => {
    clock.time = 0
    clock.sleeps.length = 0
    if (env === undefined) delete process.env.STUDIO_PUBLISH_MIN_INTERVAL_MS
    else process.env.STUDIO_PUBLISH_MIN_INTERVAL_MS = env
    const a = scriptedAdapter({ platform: 'a', now: clock.now, script: [ok('完成')] })
    const b = scriptedAdapter({ platform: 'b', now: clock.now, script: [ok('完成')] })
    const service = new PublishService({ openSession: neverOpenSession, now: clock.now, sleep: clock.sleep })
    service.register(a)
    service.register(b)
    const executor = service.createExecutor()
    await executor(makeTask('a'), makeCtx().ctx)
    await executor(makeTask('b'), makeCtx().ctx)
    expect(clock.sleeps).toEqual([expected])
    expect(b.calls[0]!.at).toBe(expected)
  }
  await run('250', 250)
  await run('not-a-number', 15_000)
})

test('链不断：前一个任务失败不影响后续平台动作', async () => {
  const clock = new FakeClock()
  const a = scriptedAdapter({ platform: 'a', now: clock.now, script: [permanent('永久失败，如实上报')] })
  const b = scriptedAdapter({ platform: 'b', now: clock.now, script: [ok('平台二完成')] })
  const service = new PublishService({
    openSession: neverOpenSession,
    minIntervalMs: 0,
    now: clock.now,
    sleep: clock.sleep,
  })
  service.register(a)
  service.register(b)
  const executor = service.createExecutor()
  const first = await executor(makeTask('a'), makeCtx().ctx)
  const second = await executor(makeTask('b'), makeCtx().ctx)
  expect(first).toMatchObject({ state: 'failed' })
  expect(second).toMatchObject({ state: 'complete', detail: '平台二完成' })
  expect(b.calls).toHaveLength(1)
})

test('瞬态失败按限速自动重试，重试成功后任务如实完成', async () => {
  const clock = new FakeClock()
  const a = scriptedAdapter({
    platform: 'a',
    now: clock.now,
    script: [
      transient('无法连接平台接口', 'NETWORK'),
      transient('平台页脚本执行超时。', 'TIMEOUT'),
      ok('第三次成功'),
    ],
  })
  const service = new PublishService({
    openSession: neverOpenSession,
    minIntervalMs: 100,
    now: clock.now,
    sleep: clock.sleep,
  })
  service.register(a)
  const { ctx, steps } = makeCtx()
  const outcome = await service.createExecutor()(makeTask('a'), ctx)
  expect(outcome).toMatchObject({ state: 'complete', detail: '第三次成功' })
  expect(a.calls).toHaveLength(3)
  // 每次重试前按限速等待，尝试开始时间逐次间隔 100ms
  expect(clock.sleeps).toEqual([100, 100])
  expect(a.calls.map((call) => call.at)).toEqual([0, 100, 200])
  expect(steps.some((step) => step.includes('自动重试'))).toBe(true)
})

test('瞬态失败耗尽默认 3 次尝试：如实失败并说明已重试次数', async () => {
  const clock = new FakeClock()
  const a = scriptedAdapter({
    platform: 'a',
    now: clock.now,
    script: [transient('无法连接平台接口', 'NETWORK')],
  })
  const service = new PublishService({
    openSession: neverOpenSession,
    minIntervalMs: 10,
    now: clock.now,
    sleep: clock.sleep,
  })
  service.register(a)
  const outcome = await service.createExecutor()(makeTask('a'), makeCtx().ctx)
  expect(outcome).toMatchObject({ state: 'failed' })
  expect(a.calls).toHaveLength(3)
  expect(outcome.detail).toContain('无法连接平台接口')
  expect(outcome.detail).toContain('已自动重试 2 次')
  expect(outcome.result).toMatchObject({ category: 'transient', code: 'NETWORK' })
})

test('凭证失败立即停下要求配置：不重试，原话如实上报', async () => {
  const clock = new FakeClock()
  const detail = '尚未配置公众号，请先在发布准备页完成配置。'
  const a = scriptedAdapter({ platform: 'a', now: clock.now, script: [credential(detail)] })
  const service = new PublishService({
    openSession: neverOpenSession,
    minIntervalMs: 10,
    now: clock.now,
    sleep: clock.sleep,
  })
  service.register(a)
  const outcome = await service.createExecutor()(makeTask('a'), makeCtx().ctx)
  expect(outcome).toMatchObject({ state: 'failed', detail })
  expect(a.calls).toHaveLength(1)
  expect(outcome.result).toMatchObject({ category: 'credential', code: 'NO_CONFIG' })
})

test('永久失败一次如实上报：不重试', async () => {
  const clock = new FakeClock()
  const a = scriptedAdapter({
    platform: 'a',
    now: clock.now,
    script: [permanent('页面结构可能已更新，适配器需更新', 'PAGE_CHANGED')],
  })
  const service = new PublishService({
    openSession: neverOpenSession,
    minIntervalMs: 10,
    now: clock.now,
    sleep: clock.sleep,
  })
  service.register(a)
  const outcome = await service.createExecutor()(makeTask('a'), makeCtx().ctx)
  expect(outcome).toMatchObject({
    state: 'failed',
    detail: '页面结构可能已更新，适配器需更新',
  })
  expect(a.calls).toHaveLength(1)
  expect(outcome.result).toMatchObject({ category: 'permanent', code: 'PAGE_CHANGED' })
})

test('usesSession 分流：API 平台绝不开页面会话，会话平台由编排层开并传入', async () => {
  const clock = new FakeClock()
  const opened: string[] = []
  const service = new PublishService({
    openSession: async (platform) => {
      opened.push(platform)
      return `session-of-${platform}`
    },
    minIntervalMs: 0,
    now: clock.now,
    sleep: clock.sleep,
  })
  const api = scriptedAdapter({ platform: 'wechat', now: clock.now, script: [ok('API 完成')] })
  const dom = scriptedAdapter({
    platform: 'redbook',
    usesSession: true,
    now: clock.now,
    script: [ok('注入完成')],
  })
  service.register(api)
  service.register(dom)
  const executor = service.createExecutor()
  await executor(makeTask('wechat'), makeCtx().ctx)
  await executor(makeTask('redbook'), makeCtx().ctx)
  // API 平台：openSession 从未被调用，run 收到的 session 为 null
  expect(api.calls[0]!.session).toBeNull()
  expect(opened).toEqual(['redbook'])
  expect(dom.calls[0]!.session).toBe('session-of-redbook')
})

test('开平台会话失败也按三分类处理：超时可重试，地址被白名单拦截则如实停下', async () => {
  const clock = new FakeClock()
  const a = scriptedAdapter({
    platform: 'redbook',
    usesSession: true,
    now: clock.now,
    script: [ok('注入完成')],
  })
  const timeoutError = Object.assign(new Error('小红书平台页脚本执行超时。'), { code: 'TIMEOUT' })
  let openCalls = 0
  const service = new PublishService({
    openSession: async () => {
      openCalls += 1
      if (openCalls < 3) throw timeoutError
      return 'session'
    },
    minIntervalMs: 50,
    now: clock.now,
    sleep: clock.sleep,
  })
  service.register(a)
  const outcome = await service.createExecutor()(makeTask('redbook'), makeCtx().ctx)
  expect(outcome).toMatchObject({ state: 'complete' })
  expect(openCalls).toBe(3)
  expect(a.calls).toHaveLength(1)

  const blocked = Object.assign(new Error('小红书编辑器地址不在白名单内。'), { code: 'EDITOR_URL_BLOCKED' })
  const b = scriptedAdapter({
    platform: 'redbook2',
    usesSession: true,
    now: clock.now,
    script: [ok('不应执行')],
  })
  const service2 = new PublishService({
    openSession: async () => {
      throw blocked
    },
    minIntervalMs: 50,
    now: clock.now,
    sleep: clock.sleep,
  })
  service2.register(b)
  const outcome2 = await service2.createExecutor()(makeTask('redbook2'), makeCtx().ctx)
  expect(outcome2).toMatchObject({ state: 'failed', detail: '小红书编辑器地址不在白名单内。' })
  expect(b.calls).toHaveLength(0)
  expect(outcome2.result).toMatchObject({ category: 'permanent', code: 'EDITOR_URL_BLOCKED' })
})

test('未知平台：如实拒绝，不伪装成功', async () => {
  const clock = new FakeClock()
  const service = new PublishService({ openSession: neverOpenSession, now: clock.now, sleep: clock.sleep })
  const outcome = await service.createExecutor()(makeTask('zhihu'), makeCtx().ctx)
  expect(outcome).toMatchObject({ state: 'failed' })
  expect(outcome.detail).toContain('暂不支持')
  expect(outcome.detail).toContain('zhihu')
  expect(outcome.result).toMatchObject({ category: 'permanent', code: 'PUBLISH_PLATFORM_UNSUPPORTED' })
})

test('停止信号：任务已停止则不再执行任何平台动作', async () => {
  const clock = new FakeClock()
  const a = scriptedAdapter({ platform: 'a', now: clock.now, script: [ok('不应执行')] })
  const service = new PublishService({ openSession: neverOpenSession, now: clock.now, sleep: clock.sleep })
  service.register(a)
  const controller = new AbortController()
  controller.abort()
  const outcome = await service.createExecutor()(makeTask('a'), makeCtx(controller.signal).ctx)
  expect(outcome).toMatchObject({ state: 'failed' })
  expect(outcome.detail).toContain('已停止')
  expect(a.calls).toHaveLength(0)
})

test('任务系统集成：kind publish / executor main 经 TaskRunner 串行执行，批次与快照随任务落库', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-pubsvc-'))
  const db: DatabaseSync = openDatabase(join(dir, 'studio.db'))
  migrate(db)
  const events: TaskRecord[] = []
  const runner = new TaskRunner(new TaskStore(db), (event) => {
    if (event.type === 'updated') events.push(event.task)
  })
  const clock = new FakeClock()
  let releaseWechat: (() => void) | undefined
  const wechatRun = new Promise<PublishRunOutcome>((resolve) => {
    releaseWechat = () => resolve({ ok: true, detail: '已存入公众号草稿箱；正式发布请在公众号后台完成。', result: { mediaId: 'M1' } })
  })
  const wechat = scriptedAdapter({ platform: 'wechat', now: clock.now, script: [wechatRun] })
  const redbook = scriptedAdapter({
    platform: 'redbook',
    usesSession: true,
    now: clock.now,
    script: [ok('已注入小红书草稿；不会自动点击发布。')],
  })
  const service = new PublishService({
    openSession: async () => 'redbook-session',
    minIntervalMs: 0,
    now: clock.now,
    sleep: clock.sleep,
  })
  service.register(wechat)
  service.register(redbook)
  runner.registerExecutor('publish', service.createExecutor())

  const wechatTask = runner.submit({
    kind: 'publish',
    executor: 'main',
    title: '存入公众号草稿箱',
    detail: '正在把《让灵感成为作品》存入公众号草稿箱…',
    projectId: 'p1',
    payload: { platform: 'wechat', batchId: 'batch-1', title: '让灵感成为作品', body: '# 让灵感成为作品\n\n正文' },
  })
  const redbookTask = runner.submit({
    kind: 'publish',
    executor: 'main',
    title: '注入小红书草稿',
    detail: '正在注入…',
    projectId: 'p1',
    payload: { platform: 'redbook', batchId: 'batch-1', title: '让灵感成为作品', body: '正文', tags: '#个人创作' },
  })
  await flush()
  // 串行：公众号任务未完成前，小红书任务不执行
  expect(wechat.calls).toHaveLength(1)
  expect(redbook.calls).toHaveLength(0)
  releaseWechat!()
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const w = runner.get(wechatTask.id)
      const r = runner.get(redbookTask.id)
      if (w && r && w.state !== 'running' && r.state !== 'running') {
        clearInterval(timer)
        resolve()
      }
    }, 10)
  })
  const settledWechat = runner.get(wechatTask.id)!
  const settledRedbook = runner.get(redbookTask.id)!
  expect(settledWechat).toMatchObject({ state: 'complete', kind: 'publish', executor: 'main' })
  expect(settledRedbook).toMatchObject({ state: 'complete' })
  // 发布记录绑定批次＋平台＋内容快照（payload 逐字段落库）
  expect(settledWechat.payload).toEqual({
    platform: 'wechat',
    batchId: 'batch-1',
    title: '让灵感成为作品',
    body: '# 让灵感成为作品\n\n正文',
  })
  expect(settledRedbook.payload).toEqual({
    platform: 'redbook',
    batchId: 'batch-1',
    title: '让灵感成为作品',
    body: '正文',
    tags: '#个人创作',
  })
  expect(settledWechat.result).toMatchObject({ mediaId: 'M1' })
  expect(redbook.calls[0]!.session).toBe('redbook-session')
  db.close()
})

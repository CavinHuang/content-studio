import { expect, test } from 'vitest'
import type { TaskRecord } from '../../packages/desktop/src/shared/desktop'
import type { RedbookDriver } from '../../packages/desktop/src/main/publish/redbook/driver'
import type { RedbookPayload, RedbookResult } from '../../packages/desktop/src/main/publish/redbook/inject-script'
import {
  createRedbookPublishAdapter,
  parseRedbookTopics,
  type RedbookInjectPayload,
} from '../../packages/desktop/src/main/publish/redbook/inject-job'

function makeTask(payload: Partial<RedbookInjectPayload>): TaskRecord {
  return {
    id: 't1',
    title: '注入小红书草稿',
    detail: '正在注入…',
    projectId: 'p1',
    state: 'running',
    kind: 'publish',
    at: '2026-10-28T00:00:00.000Z',
    updated: '2026-10-28T00:00:00.000Z',
    executor: 'main',
    payload: { platform: 'redbook', title: '标题', body: '正文', ...payload },
  }
}

function makeContext() {
  const steps: string[] = []
  return {
    steps,
    ctx: {
      progress: (step: string) => steps.push(step),
      signal: new AbortController().signal,
    },
  }
}

/** 记录注入脚本收到的负载，按脚本语义给出结果（不引 jsdom，行为等价桩）。 */
function makeDriver(result: (payload: RedbookPayload) => RedbookResult): RedbookDriver & { calls: RedbookPayload[] } {
  const calls: RedbookPayload[] = []
  return {
    calls,
    async open() {},
    async evaluate(payload) {
      calls.push(payload)
      return result(payload)
    },
  }
}

/** 适配器直调：平台页会话由编排层打开后传入（usesSession=true 平台）。 */
function runWithDriver(driver: RedbookDriver, task: TaskRecord) {
  const adapter = createRedbookPublishAdapter()
  const { ctx, steps } = makeContext()
  return {
    steps,
    promise: adapter.run({ task, session: driver }, ctx),
  }
}

test('parseRedbookTopics：空白/中英文分隔、剥 #、去重去空', () => {
  expect(parseRedbookTopics('#个人创作 #创作习惯 #表达与记录')).toEqual(['个人创作', '创作习惯', '表达与记录'])
  expect(parseRedbookTopics('个人创作，创作习惯、表达与记录；随想')).toEqual([
    '个人创作',
    '创作习惯',
    '表达与记录',
    '随想',
  ])
  expect(parseRedbookTopics('  #个人创作#  个人创作  ')).toEqual(['个人创作'])
  expect(parseRedbookTopics(undefined)).toEqual([])
  expect(parseRedbookTopics('')).toEqual([])
})

test('适配器元数据：platform redbook / usesSession true（编排层据此开页面会话）', () => {
  const adapter = createRedbookPublishAdapter()
  expect(adapter.platform).toBe('redbook')
  expect(adapter.usesSession).toBe(true)
})

test('适配器：非 redbook 平台任务如实失败（分派边界）', async () => {
  const driver = makeDriver(() => ({ ok: true, kind: 'loginCheck', loggedIn: true }))
  const { promise } = runWithDriver(driver, makeTask({ platform: undefined }))
  const outcome = await promise
  expect(outcome).toMatchObject({ ok: false, category: 'permanent' })
  expect(outcome.ok === false && outcome.detail).toContain('暂只支持')
})

test('适配器：缺标题/缺正文零请求拒绝', async () => {
  const driver = makeDriver(() => ({ ok: true, kind: 'loginCheck', loggedIn: true }))
  const noTitle = await runWithDriver(driver, makeTask({ title: '' })).promise
  const noBody = await runWithDriver(driver, makeTask({ body: '' })).promise
  expect(noTitle).toMatchObject({ ok: false, category: 'permanent', detail: '缺少标题，无法注入小红书草稿。' })
  expect(noBody).toMatchObject({ ok: false, category: 'permanent', detail: '缺少正文，无法注入小红书草稿。' })
  expect(driver.calls).toHaveLength(0)
})

test('适配器：会话未打开（session 为空）→ 如实失败，不触碰驱动', async () => {
  const adapter = createRedbookPublishAdapter()
  const outcome = await adapter.run({ task: makeTask({}), session: null }, makeContext().ctx)
  expect(outcome).toMatchObject({ ok: false, category: 'permanent' })
  expect(outcome.ok === false && outcome.detail).toContain('平台会话未打开')
})

test('适配器：未登录 → 凭证类停下并引导登录（绝不伪装成功、不重试）', async () => {
  const driver = makeDriver((payload) =>
    payload.kind === 'loginCheck'
      ? { ok: false, code: 'NOT_LOGGED_IN', message: '请先登录小红书创作服务平台' }
      : ({ ok: true, kind: 'inject', draftUrl: 'https://creator.xiaohongshu.com/publish/publish', warnings: [] } as const),
  )
  const { promise } = runWithDriver(driver, makeTask({ tags: '#个人创作 #创作习惯' }))
  const outcome = await promise
  expect(outcome).toMatchObject({ ok: false, category: 'credential', code: 'NOT_LOGGED_IN' })
  expect(outcome.ok === false && outcome.detail).toContain('尚未登录小红书')
  expect(outcome.ok === false && outcome.detail).toContain('打开登录')
  // 登录失败后不再发起注入负载
  expect(driver.calls.map((call) => call.kind)).toEqual(['loginCheck'])
})

test('适配器：注入成功 → 停在草稿态，话题解析自快照 tags，结果携带回读', async () => {
  const driver = makeDriver((payload) => {
    if (payload.kind === 'loginCheck') return { ok: true, kind: 'loginCheck', loggedIn: true }
    if (payload.kind === 'readBack')
      return { ok: true, kind: 'readBack', title: '标题', bodyChars: 42, url: 'https://creator.xiaohongshu.com/publish/publish' }
    return { ok: true, kind: 'inject', draftUrl: 'https://creator.xiaohongshu.com/publish/publish', warnings: ['标题超过 20 字，已截断填充'] }
  })
  const { promise } = runWithDriver(driver, makeTask({ tags: '#个人创作 #创作习惯' }))
  const outcome = await promise
  expect(outcome.ok).toBe(true)
  expect(outcome.ok === true && outcome.detail).toContain('不会自动点击发布')
  expect(outcome.ok === true && outcome.result).toMatchObject({
    draftUrl: 'https://creator.xiaohongshu.com/publish/publish',
    title: '标题',
    bodyChars: 42,
    topics: ['个人创作', '创作习惯'],
    warnings: ['标题超过 20 字，已截断填充'],
  })
  const injectCall = driver.calls.find((call) => call.kind === 'inject')
  expect(injectCall).toMatchObject({ kind: 'inject', topics: ['个人创作', '创作习惯'] })
})

test('适配器：防覆盖拒绝（ALREADY_HAS_CONTENT）→ 永久类如实失败，原文不动', async () => {
  const driver = makeDriver((payload) => {
    if (payload.kind === 'loginCheck') return { ok: true, kind: 'loginCheck', loggedIn: true }
    return { ok: false, code: 'ALREADY_HAS_CONTENT', message: '编辑器已有内容（标题「已有」），为防覆盖已停止注入；确认覆盖请先在平台编辑器清空' }
  })
  const { promise } = runWithDriver(driver, makeTask({}))
  const outcome = await promise
  expect(outcome).toMatchObject({ ok: false, category: 'permanent', code: 'ALREADY_HAS_CONTENT' })
  expect(outcome.ok === false && outcome.detail).toContain('为防覆盖已停止注入')
})

test('适配器：页面结构变化（PAGE_CHANGED）→ 永久类明确报适配器需更新', async () => {
  const driver = makeDriver((payload) => {
    if (payload.kind === 'loginCheck') return { ok: true, kind: 'loginCheck', loggedIn: true }
    return { ok: false, code: 'PAGE_CHANGED', message: '未找到标题框或正文编辑器：小红书页面结构可能已更新，适配器需更新' }
  })
  const { promise } = runWithDriver(driver, makeTask({}))
  const outcome = await promise
  expect(outcome).toMatchObject({ ok: false, category: 'permanent', code: 'PAGE_CHANGED' })
  expect(outcome.ok === false && outcome.detail).toContain('适配器需更新')
})

test('适配器：脚本执行超时（TIMEOUT 抛出）→ 瞬态类，交给编排层限速重试', async () => {
  const timeout = Object.assign(new Error('小红书平台页脚本执行超时。'), { code: 'TIMEOUT' })
  const driver = makeDriver(() => {
    throw timeout
  })
  const { promise } = runWithDriver(driver, makeTask({}))
  const outcome = await promise
  expect(outcome).toMatchObject({ ok: false, category: 'transient', code: 'TIMEOUT' })
})

test('适配器：回读失败不推翻注入结论，只附说明', async () => {
  const driver = makeDriver((payload) => {
    if (payload.kind === 'loginCheck') return { ok: true, kind: 'loginCheck', loggedIn: true }
    if (payload.kind === 'readBack') return { ok: false, code: 'PAGE_CHANGED', message: '页面变化' }
    return { ok: true, kind: 'inject', draftUrl: 'https://creator.xiaohongshu.com/publish/publish', warnings: [] }
  })
  const { promise } = runWithDriver(driver, makeTask({}))
  const outcome = await promise
  expect(outcome.ok).toBe(true)
  expect(outcome.ok === true && outcome.detail).toContain('回读未成功')
})

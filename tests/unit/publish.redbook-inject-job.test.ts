import { expect, test } from 'vitest'
import type { TaskRecord } from '../../packages/desktop/src/shared/desktop'
import type { RedbookDriver } from '../../packages/desktop/src/main/publish/redbook/driver'
import type { RedbookPayload, RedbookResult } from '../../packages/desktop/src/main/publish/redbook/inject-script'
import {
  createRedbookInjectExecutor,
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

test('执行器：非 redbook 平台任务如实失败（分派边界）', async () => {
  const driver = makeDriver(() => ({ ok: true, kind: 'loginCheck', loggedIn: true }))
  const executor = createRedbookInjectExecutor(driver)
  const { ctx } = makeContext()
  const outcome = await executor(makeTask({ platform: undefined }), ctx)
  expect(outcome).toMatchObject({ state: 'failed' })
  expect(outcome.detail).toContain('暂只支持')
})

test('执行器：缺标题/缺正文零请求拒绝', async () => {
  const driver = makeDriver(() => ({ ok: true, kind: 'loginCheck', loggedIn: true }))
  const executor = createRedbookInjectExecutor(driver)
  const noTitle = await executor(makeTask({ title: '' }), makeContext().ctx)
  const noBody = await executor(makeTask({ body: '' }), makeContext().ctx)
  expect(noTitle).toMatchObject({ state: 'failed', detail: '缺少标题，无法注入小红书草稿。' })
  expect(noBody).toMatchObject({ state: 'failed', detail: '缺少正文，无法注入小红书草稿。' })
  expect(driver.calls).toHaveLength(0)
})

test('执行器：未登录 → 如实失败并引导登录（绝不伪装成功）', async () => {
  const driver = makeDriver((payload) =>
    payload.kind === 'loginCheck'
      ? { ok: false, code: 'NOT_LOGGED_IN', message: '请先登录小红书创作服务平台' }
      : ({ ok: true, kind: 'inject', draftUrl: 'https://creator.xiaohongshu.com/publish/publish', warnings: [] } as const),
  )
  const executor = createRedbookInjectExecutor(driver)
  const { ctx, steps } = makeContext()
  const outcome = await executor(makeTask({ tags: '#个人创作 #创作习惯' }), ctx)
  expect(outcome).toMatchObject({ state: 'failed' })
  expect(outcome.detail).toContain('尚未登录小红书')
  expect(outcome.detail).toContain('打开登录')
  // 登录失败后不再发起注入负载
  expect(driver.calls.map((call) => call.kind)).toEqual(['loginCheck'])
})

test('执行器：注入成功 → 停在草稿态，话题解析自快照 tags，结果携带回读', async () => {
  const driver = makeDriver((payload) => {
    if (payload.kind === 'loginCheck') return { ok: true, kind: 'loginCheck', loggedIn: true }
    if (payload.kind === 'readBack')
      return { ok: true, kind: 'readBack', title: '标题', bodyChars: 42, url: 'https://creator.xiaohongshu.com/publish/publish' }
    return { ok: true, kind: 'inject', draftUrl: 'https://creator.xiaohongshu.com/publish/publish', warnings: ['标题超过 20 字，已截断填充'] }
  })
  const executor = createRedbookInjectExecutor(driver)
  const { ctx } = makeContext()
  const outcome = await executor(makeTask({ tags: '#个人创作 #创作习惯' }), ctx)
  expect(outcome.state).toBe('complete')
  expect(outcome.detail).toContain('不会自动点击发布')
  expect(outcome.result).toMatchObject({
    draftUrl: 'https://creator.xiaohongshu.com/publish/publish',
    title: '标题',
    bodyChars: 42,
    topics: ['个人创作', '创作习惯'],
    warnings: ['标题超过 20 字，已截断填充'],
  })
  const injectCall = driver.calls.find((call) => call.kind === 'inject')
  expect(injectCall).toMatchObject({ kind: 'inject', topics: ['个人创作', '创作习惯'] })
})

test('执行器：防覆盖拒绝（ALREADY_HAS_CONTENT）→ 如实失败，原文不动', async () => {
  const driver = makeDriver((payload) => {
    if (payload.kind === 'loginCheck') return { ok: true, kind: 'loginCheck', loggedIn: true }
    return { ok: false, code: 'ALREADY_HAS_CONTENT', message: '编辑器已有内容（标题「已有」），为防覆盖已停止注入；确认覆盖请先在平台编辑器清空' }
  })
  const executor = createRedbookInjectExecutor(driver)
  const outcome = await executor(makeTask({}), makeContext().ctx)
  expect(outcome).toMatchObject({ state: 'failed' })
  expect(outcome.detail).toContain('为防覆盖已停止注入')
})

test('执行器：页面结构变化（PAGE_CHANGED）→ 明确报适配器需更新', async () => {
  const driver = makeDriver((payload) => {
    if (payload.kind === 'loginCheck') return { ok: true, kind: 'loginCheck', loggedIn: true }
    return { ok: false, code: 'PAGE_CHANGED', message: '未找到标题框或正文编辑器：小红书页面结构可能已更新，适配器需更新' }
  })
  const executor = createRedbookInjectExecutor(driver)
  const outcome = await executor(makeTask({}), makeContext().ctx)
  expect(outcome).toMatchObject({ state: 'failed' })
  expect(outcome.detail).toContain('适配器需更新')
})

test('执行器：回读失败不推翻注入结论，只附说明', async () => {
  const driver = makeDriver((payload) => {
    if (payload.kind === 'loginCheck') return { ok: true, kind: 'loginCheck', loggedIn: true }
    if (payload.kind === 'readBack') return { ok: false, code: 'PAGE_CHANGED', message: '页面变化' }
    return { ok: true, kind: 'inject', draftUrl: 'https://creator.xiaohongshu.com/publish/publish', warnings: [] }
  })
  const executor = createRedbookInjectExecutor(driver)
  const outcome = await executor(makeTask({}), makeContext().ctx)
  expect(outcome.state).toBe('complete')
  expect(outcome.detail).toContain('回读未成功')
})

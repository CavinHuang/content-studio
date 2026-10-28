import { expect, test } from 'vitest'
import type { RedbookDriver } from '../../packages/desktop/src/main/publish/redbook/driver'
import { createRedbookService } from '../../packages/desktop/src/main/publish/redbook/service'
import type { RedbookPayload, RedbookResult } from '../../packages/desktop/src/main/publish/redbook/inject-script'

function makeDriver(
  evaluateImpl: (payload: RedbookPayload) => Promise<RedbookResult>,
  openImpl?: (visible: boolean) => Promise<void>,
): RedbookDriver & { opens: boolean[] } {
  const opens: boolean[] = []
  return {
    opens,
    async open(visible) {
      opens.push(visible)
      await openImpl?.(visible)
    },
    evaluate: evaluateImpl,
  }
}

test('loginState：已登录路径 → ok 且 loginState=loggedIn', async () => {
  const driver = makeDriver(async (payload) => {
    if (payload.kind === 'loginCheck') return { ok: true, kind: 'loginCheck', loggedIn: true }
    throw new Error('unexpected payload')
  })
  const service = createRedbookService(driver)
  await expect(service.loginState()).resolves.toMatchObject({ ok: true, loginState: 'loggedIn' })
  // 登录探测以隐藏形态打开（零尺寸），不打扰用户
  expect(driver.opens).toEqual([false])
})

test('loginState：未登录（脚本 NOT_LOGGED_IN）→ loginState=notLoggedIn', async () => {
  const driver = makeDriver(async () =>
    Promise.resolve({ ok: false, code: 'NOT_LOGGED_IN', message: '请先登录' } as const),
  )
  const service = createRedbookService(driver)
  await expect(service.loginState()).resolves.toMatchObject({ ok: true, loginState: 'notLoggedIn' })
})

test('openSession：可见打开并探测；已可见会话不因后台探测被隐藏', async () => {
  const driver = makeDriver(async () => ({ ok: true, kind: 'loginCheck', loggedIn: true }))
  const service = createRedbookService(driver)
  await expect(service.openSession(true)).resolves.toMatchObject({ ok: true, loginState: 'loggedIn' })
  expect(driver.opens).toEqual([true])
  await service.loginState()
  expect(driver.opens).toEqual([true, false])
})

test('打开失败（地址白名单/网络）→ ok=false 携带 code，如实呈现', async () => {
  const driver = makeDriver(
    async () => ({ ok: true, kind: 'loginCheck', loggedIn: true }),
    () => {
      const err = new Error('小红书编辑器地址不在平台白名单内。') as Error & { code: string }
      err.code = 'EDITOR_URL_BLOCKED'
      throw err
    },
  )
  const service = createRedbookService(driver)
  const view = await service.openSession(true)
  expect(view.ok).toBe(false)
  expect(view.code).toBe('EDITOR_URL_BLOCKED')
  expect(view.loginState).toBeUndefined()
})

test('登录检测超时 → 给人话提示', async () => {
  const driver = makeDriver(async () => {
    const err = new Error('timeout') as Error & { code: string }
    err.code = 'TIMEOUT'
    throw err
  })
  const service = createRedbookService(driver)
  const view = await service.loginState()
  expect(view).toMatchObject({ ok: false, code: 'TIMEOUT' })
  expect(view.message).toContain('超时')
})

test('脚本结果异常（PAGE_CHANGED）→ ok=false 绝不伪装登录态', async () => {
  const driver = makeDriver(async () =>
    Promise.resolve({ ok: false, code: 'PAGE_CHANGED', message: '适配器需更新' } as const),
  )
  const service = createRedbookService(driver)
  const view = await service.loginState()
  expect(view.ok).toBe(false)
  expect(view.code).toBe('PAGE_CHANGED')
  expect(view.loginState).toBeUndefined()
})

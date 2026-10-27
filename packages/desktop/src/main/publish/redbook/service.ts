/**
 * 小红书平台会话服务：组合驱动与登录探测，产出 IPC 视图（RedbookSessionView）。
 * 不依赖 Electron（驱动注入），node 单测可用假驱动直测。
 */
import type { RedbookLoginState, RedbookSessionView } from '../../../shared/desktop'
import type { RedbookDriver } from './driver'

export type RedbookService = {
  /** 打开平台页（visible 由调用方决定）并探测登录态。 */
  openSession(visible: boolean): Promise<RedbookSessionView>
  /** 探测登录态：会话未打开时先以隐藏形态打开（零尺寸，不干扰用户）。 */
  loginState(): Promise<RedbookSessionView>
}

function errorView(err: unknown): RedbookSessionView {
  const code = (err as { code?: string } | null)?.code
  const raw = err instanceof Error ? err.message : String(err)
  return {
    ok: false,
    ...(code ? { code } : {}),
    message:
      code === 'EDITOR_URL_INVALID' || code === 'EDITOR_URL_BLOCKED'
        ? raw
        : code === 'TIMEOUT'
          ? '小红书平台页响应超时，请稍后重试。'
          : `无法连接小红书平台页：${raw}。请检查网络后重试。`,
  }
}

export function createRedbookService(driver: RedbookDriver): RedbookService {
  const probe = async (): Promise<RedbookSessionView> => {
    const result = await driver.evaluate({ kind: 'loginCheck' })
    if (result.ok && result.kind === 'loginCheck') {
      const loginState: RedbookLoginState = result.loggedIn ? 'loggedIn' : 'notLoggedIn'
      return { ok: true, loginState, ...(loginState === 'notLoggedIn' ? { message: '尚未登录小红书。' } : {}) }
    }
    if (!result.ok && result.code === 'NOT_LOGGED_IN') {
      return { ok: true, loginState: 'notLoggedIn', message: '尚未登录小红书，请在平台页扫码登录。' }
    }
    // 脚本结果异常（含 PAGE_CHANGED 等）：如实报错，绝不伪装成任一登录态。
    return {
      ok: false,
      code: result.ok ? 'UNKNOWN' : result.code,
      message: result.ok ? '登录检测结果异常，请重试。' : result.message,
    }
  }
  return {
    async openSession(visible) {
      try {
        await driver.open(visible)
      } catch (err) {
        return errorView(err)
      }
      try {
        return await probe()
      } catch (err) {
        return errorView(err)
      }
    },
    async loginState() {
      try {
        await driver.open(false)
      } catch (err) {
        return errorView(err)
      }
      try {
        return await probe()
      } catch (err) {
        return errorView(err)
      }
    },
  }
}

/**
 * 公众号发布域 IPC handlers：配置（脱敏视图）、连接探测（canInject）、
 * md→HTML 渲染（富文本复制用）与「存入草稿箱」任务创建（kind 'publish' / executor 'main'）。
 * 人机边界：这里没有任何「发布」动作——draft/add 之外的能力一律不接。
 */
import type { DatabaseSync } from 'node:sqlite'
import type {
  WechatConfigInput,
  WechatConfigView,
  WechatDraftInput,
  WechatDraftResult,
  WechatHtmlResult,
  WechatProbeResult,
} from '../../shared/desktop'
import type { Crypto } from '../ai/model-config'
import type { TaskRunner } from '../tasks/runner'
import { markdownToWechatHtml } from './markdown-to-wechat-html'
import {
  WECHAT_CREDENTIAL_HINT,
  WechatApiError,
  WechatMpClient,
  WechatNetworkError,
  type WechatFetch,
} from './wechat-mp'
import { clearWechatConfig, getWechatConfig, setWechatConfig, wechatConfigView } from './wechat-config'

export interface PublishHandlerDeps {
  db: DatabaseSync
  crypto: Crypto
  runner: TaskRunner
  /** 测试/本地 stub 注入；缺省走官方线上地址与全局 fetch。 */
  baseUrl?: string
  fetchImpl?: WechatFetch
}

export function buildPublishHandlers(deps: PublishHandlerDeps) {
  const clientFor = () => {
    const config = getWechatConfig(deps.db, deps.crypto)
    if (!config) return null
    return new WechatMpClient(
      { getAppId: () => config.appId, getSecret: () => config.secret },
      { ...(deps.baseUrl ? { baseUrl: deps.baseUrl } : {}), ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) },
    )
  }
  return {
    configGet(): WechatConfigView | null {
      return wechatConfigView(deps.db, deps.crypto)
    },
    configSave(input: WechatConfigInput): WechatConfigView {
      setWechatConfig(deps.db, deps.crypto, input)
      return wechatConfigView(deps.db, deps.crypto)!
    },
    configClear(): { ok: boolean } {
      clearWechatConfig(deps.db)
      return { ok: true }
    },
    /** 连接探测：取一次 stable_token；凭证/白名单错误给人话提示。 */
    async canInject(): Promise<WechatProbeResult> {
      const client = clientFor()
      if (!client) return { ok: false, code: 'NO_CONFIG', message: '尚未配置公众号 AppID 与 AppSecret。' }
      try {
        await client.getAccessToken()
        return { ok: true, message: '连接成功，可以存入草稿箱。' }
      } catch (err) {
        if (err instanceof WechatApiError) {
          const hint = [40013, 40125, 41004, 40164].includes(err.errcode) ? WECHAT_CREDENTIAL_HINT : ''
          return { ok: false, code: `ERR_${err.errcode}`, message: `公众号接口错误 ${err.errcode}：${err.errmsg}。${hint}` }
        }
        if (err instanceof WechatNetworkError) {
          return { ok: false, code: 'NETWORK', message: `无法连接公众号接口：${err.message}。请检查网络与本机出口 IP 白名单。` }
        }
        return { ok: false, code: 'UNKNOWN', message: err instanceof Error ? err.message : String(err) }
      }
    },
    /** md → 公众号正文 HTML（纯转换，无需凭证）：渲染端富文本复制使用。 */
    renderHtml(body: string): WechatHtmlResult {
      const source = String(body ?? '')
      if (!source.trim()) return { ok: false, message: '正文为空，无法生成公众号格式。' }
      return { ok: true, html: markdownToWechatHtml(source) }
    },
    /** 存入草稿箱：只建任务（executor 'main'），由 draft-job 执行；不配置时如实拒绝。 */
    saveDraft(input: WechatDraftInput): WechatDraftResult {
      const title = String(input?.title ?? '').trim()
      const body = String(input?.body ?? '')
      if (!title) return { ok: false, code: 'BAD_INPUT', message: '缺少标题，无法存入草稿箱。' }
      if (!body.trim()) return { ok: false, code: 'BAD_INPUT', message: '缺少正文，无法存入草稿箱。' }
      if (!getWechatConfig(deps.db, deps.crypto))
        return { ok: false, code: 'NO_CONFIG', message: '尚未配置公众号，请先在本页配置 AppID 与 AppSecret。' }
      const task = deps.runner.submit({
        kind: 'publish',
        executor: 'main',
        title: '存入公众号草稿箱',
        detail: `正在把《${title}》存入公众号草稿箱…`,
        projectId: input.projectId || 'publish',
        payload: {
          platform: 'wechat' as const,
          title,
          body,
          ...(input.batchId ? { batchId: input.batchId } : {}),
          ...(input.digest !== undefined && input.digest !== '' ? { digest: input.digest } : {}),
          ...(input.author ? { author: input.author } : {}),
          ...(input.assets && Object.keys(input.assets).length ? { assets: input.assets } : {}),
        },
      })
      return { ok: true, taskId: task.id, message: '已创建存草稿任务；进度与结果见任务中心。' }
    },
  }
}

export type PublishHandlers = ReturnType<typeof buildPublishHandlers>

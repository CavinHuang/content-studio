/**
 * 公众号（mp.weixin.qq.com）API 客户端。
 * 历史资产移植：docs/superpowers/ref/code/19f5778-wechat-mp.ts（自有 MIT 代码，
 * 适配当前仓库命名与转写风格；探针事实见 ref/memo-wechat-api-and-typeset.md）。
 * - stable_token 缓存：到期前 5 分钟提前刷新，未到期直接复用。
 * - token 错误码 40001/40014/41001/42001：单次强刷重试一次，绝不循环。
 * - fetch 全程可注入（单测不联网）。
 */

export class WechatApiError extends Error {
  constructor(
    readonly errcode: number,
    readonly errmsg: string,
  ) {
    super(`公众号 API 错误 ${errcode}：${errmsg}`)
  }
}
export class WechatNetworkError extends Error {}

const TOKEN_ERRCODES = new Set([40001, 40014, 41001, 42001])

/** 凭证/白名单类错误码：附加人话提示（IP 白名单是公众号 API 的配置前提）。 */
export const WECHAT_CREDENTIAL_HINT_ERRCODES = new Set([40013, 40125, 41004, 40164])
export const WECHAT_CREDENTIAL_HINT =
  '请检查 AppSecret 是否正确，并确认本机出口 IP 已加入公众号后台 IP 白名单。'

export type WechatResponse = { ok: boolean; status: number; json(): Promise<unknown> }
export type WechatFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: unknown },
) => Promise<WechatResponse>

export type WechatCredentials = { getAppId(): string; getSecret(): string }

export type WechatDraftArticle = {
  title: string
  author?: string
  digest?: string
  content: string
  thumbMediaId: string
}

/** draft/add 字段限制（2026-10 实测形状）：超限在发请求前就地失败，不浪费素材上传。 */
export function validateWechatDraftFields(input: {
  title: string
  author?: string
  digest?: string
  content: string
}): void {
  const title = input.title.trim()
  if (!title) throw new WechatApiError(-3, '草稿标题不能为空。')
  if (title.length > 32) throw new WechatApiError(-3, `草稿标题不能超过 32 字（当前 ${title.length} 字）。`)
  if ((input.author ?? '').length > 16) throw new WechatApiError(-3, '作者不能超过 16 字。')
  if ((input.digest ?? '').length > 120) throw new WechatApiError(-3, '摘要不能超过 120 字；留空时平台取正文开头。')
  const content = input.content
  if (!content.trim()) throw new WechatApiError(-3, '草稿正文不能为空。')
  if (content.length >= 20_000) throw new WechatApiError(-3, `草稿正文需少于 2 万字符（当前 ${content.length}）。`)
  if (/<script|<iframe|on[a-z]+\s*=/i.test(content))
    throw new WechatApiError(-3, '草稿正文不能包含脚本或内联事件（公众号要求）。')
}

export function validateWechatDraftArticle(article: WechatDraftArticle): void {
  validateWechatDraftFields(article)
  if (!article.thumbMediaId) throw new WechatApiError(-3, '缺少封面素材 media_id（thumb_media_id 必填）。')
}

export class WechatMpClient {
  private readonly base: string
  private readonly fetchImpl: WechatFetch
  private readonly now: () => number
  private token: { value: string; expiresAt: number } | null = null

  constructor(
    private readonly cfg: WechatCredentials,
    opts: { baseUrl?: string; fetchImpl?: WechatFetch; now?: () => number } = {},
  ) {
    this.base = (opts.baseUrl ?? 'https://api.weixin.qq.com').replace(/\/+$/, '')
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as WechatFetch)
    this.now = opts.now ?? Date.now
  }

  private async post(pathWithQuery: string, body: unknown): Promise<Record<string, unknown>> {
    const isForm = body instanceof FormData
    let res: WechatResponse
    try {
      res = await this.fetchImpl(`${this.base}${pathWithQuery}`, {
        method: 'POST',
        headers: isForm ? undefined : { 'content-type': 'application/json' },
        body: isForm ? body : JSON.stringify(body ?? {}),
      })
    } catch (err) {
      throw new WechatNetworkError(err instanceof Error ? err.message : String(err))
    }
    if (!res.ok) throw new WechatNetworkError(`HTTP ${res.status}`)
    const data = (await res.json().catch(() => {
      throw new WechatNetworkError('响应不是合法 JSON。')
    })) as Record<string, unknown>
    if (typeof data.errcode === 'number' && data.errcode !== 0)
      throw new WechatApiError(data.errcode, String(data.errmsg ?? ''))
    return data
  }

  async getAccessToken(force = false): Promise<string> {
    if (!force && this.token && this.now() < this.token.expiresAt) return this.token.value
    const appId = this.cfg.getAppId()
    const secret = this.cfg.getSecret()
    if (!appId || !secret) throw new WechatApiError(-1, '未配置公众号 AppID/AppSecret。')
    const data = await this.post('/cgi-bin/stable_token', {
      grant_type: 'client_credential',
      appid: appId,
      secret,
    })
    const value = String(data.access_token ?? '')
    if (!value) throw new WechatApiError(-2, 'stable_token 响应缺少 access_token。')
    // 到期前 5 分钟提前刷新（19f5778 实测形状）。
    this.token = {
      value,
      expiresAt: this.now() + Math.max(0, Number(data.expires_in ?? 7200) * 1000 - 300_000),
    }
    return value
  }

  private async call(path: string, body?: unknown): Promise<Record<string, unknown>> {
    // path 已带查询串（如 add_material?type=IMAGE）时用 & 接 access_token，避免 ? 重复的畸形 URL。
    const withToken = (p: string, t: string) => `${p}${p.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(t)}`
    let token = await this.getAccessToken()
    try {
      return await this.post(withToken(path, token), body)
    } catch (err) {
      if (err instanceof WechatApiError && TOKEN_ERRCODES.has(err.errcode)) {
        // 单次强刷后重试一次；二次失败原样抛出，绝不循环强刷。
        token = await this.getAccessToken(true)
        return this.post(withToken(path, token), body)
      }
      throw err
    }
  }

  /** 永久素材（封面 thumb_media_id 必须来自这里，不能走 uploadimg）。 */
  async uploadImageMaterial(
    bytes: Uint8Array,
    filename: string,
    mimeType = 'image/png',
  ): Promise<{ mediaId: string; url: string }> {
    const fd = new FormData()
    fd.append('media', new Blob([bytes as unknown as BlobPart], { type: mimeType }), filename)
    const data = await this.call('/cgi-bin/material/add_material?type=IMAGE', fd)
    return { mediaId: String(data.media_id ?? ''), url: String(data.url ?? '') }
  }

  /** 正文内图片：draft/add 硬约束，外链图片会被屏蔽，必须换成该接口返回的 URL。 */
  async uploadContentImage(bytes: Uint8Array, filename: string, mimeType = 'image/png'): Promise<string> {
    const fd = new FormData()
    fd.append('media', new Blob([bytes as unknown as BlobPart], { type: mimeType }), filename)
    const data = await this.call('/cgi-bin/media/uploadimg', fd)
    return String(data.url ?? '')
  }

  /** 创建草稿：停在草稿态；正式群发由用户在公众号后台操作（人机边界）。 */
  async createDraft(article: WechatDraftArticle): Promise<string> {
    validateWechatDraftArticle(article)
    const data = await this.call('/cgi-bin/draft/add', {
      articles: [
        {
          title: article.title.trim(),
          author: article.author ?? '',
          digest: article.digest ?? '',
          content: article.content,
          thumb_media_id: article.thumbMediaId,
          need_open_comment: 0,
          only_fans_can_comment: 0,
        },
      ],
    })
    return String(data.media_id ?? '')
  }
}

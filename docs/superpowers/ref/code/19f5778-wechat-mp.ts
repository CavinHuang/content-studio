/**
 * 【历史资产参考件——P4 公众号发布链】
 * 来源提交：19f5778（feat(m3): 公众号 API 客户端（stable_token 缓存/素材/草稿）、safeStorage 凭证与 md→HTML）
 * 原路径：src/main/publish/wechat-mp.ts
 * 提取方式：git show 19f5778:src/main/publish/wechat-mp.ts（2026-10-27 提取，内容未改动）
 * 说明：属重置前旧历史的实现，仅供移植参考，不参与当前构建。探针事实见 ref/memo-wechat-api-and-typeset.md。
 */

/** 公众号（mp.weixin.qq.com）API 客户端。探针事实 #7：stable_token 推荐；draft/add 字段限制；
 *  token 错误码 40001/40014/41001/42001 单次强刷重试。fetch 全程可注入（单测不联网）。 */
export class WechatApiError extends Error {
  constructor(readonly errcode: number, readonly errmsg: string) { super(`公众号 API 错误 ${errcode}: ${errmsg}`); }
}
export class WechatNetworkError extends Error {}
const TOKEN_ERRCODES = new Set([40001, 40014, 41001, 42001]);

export type WechatResponse = { ok: boolean; status: number; json(): Promise<unknown> };
export type WechatFetch = (url: string, init: { method: string; headers?: Record<string, string>; body?: unknown }) => Promise<WechatResponse>;

export class WechatMpClient {
  private readonly base: string;
  private readonly fetchImpl: WechatFetch;
  private readonly now: () => number;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly cfg: { getAppid(): string; getSecret(): string },
    opts: { baseUrl?: string; fetchImpl?: WechatFetch; now?: () => number } = {},
  ) {
    this.base = (opts.baseUrl ?? 'https://api.weixin.qq.com').replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as WechatFetch);
    this.now = opts.now ?? Date.now;
  }

  private async post(pathWithQuery: string, body: unknown): Promise<Record<string, unknown>> {
    const isForm = body instanceof FormData;
    let res: WechatResponse;
    try {
      res = await this.fetchImpl(`${this.base}${pathWithQuery}`, {
        method: 'POST',
        headers: isForm ? undefined : { 'content-type': 'application/json' },
        body: isForm ? body : JSON.stringify(body ?? {}),
      });
    } catch (err) {
      throw new WechatNetworkError(err instanceof Error ? err.message : String(err));
    }
    if (!res.ok) throw new WechatNetworkError(`HTTP ${res.status}`);
    const data = await res.json().catch(() => { throw new WechatNetworkError('响应不是合法 JSON'); }) as Record<string, unknown>;
    if (typeof data.errcode === 'number' && data.errcode !== 0) throw new WechatApiError(data.errcode, String(data.errmsg ?? ''));
    return data;
  }

  async getAccessToken(force = false): Promise<string> {
    if (!force && this.token && this.now() < this.token.expiresAt) return this.token.value;
    const appid = this.cfg.getAppid(); const secret = this.cfg.getSecret();
    if (!appid || !secret) throw new WechatApiError(-1, '未配置公众号 AppID/AppSecret');
    const data = await this.post('/cgi-bin/stable_token', { grant_type: 'client_credential', appid, secret });
    const value = String(data.access_token ?? '');
    if (!value) throw new WechatApiError(-2, 'stable_token 响应缺少 access_token');
    this.token = { value, expiresAt: this.now() + Math.max(0, Number(data.expires_in ?? 7200) * 1000 - 300_000) };
    return value;
  }

  private async call(path: string, body?: unknown): Promise<Record<string, unknown>> {
    // path 已带查询串（如 add_material?type=IMAGE）时用 & 接 access_token，避免 `?` 重复的畸形 URL（探针 #7 官方形状）
    const withToken = (p: string, t: string) => `${p}${p.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(t)}`;
    let token = await this.getAccessToken();
    try {
      return await this.post(withToken(path, token), body);
    } catch (err) {
      if (err instanceof WechatApiError && TOKEN_ERRCODES.has(err.errcode)) {
        token = await this.getAccessToken(true);
        return this.post(withToken(path, token), body);
      }
      throw err;
    }
  }

  async uploadImageMaterial(bytes: Uint8Array, filename: string, mimeType = 'image/png'): Promise<{ mediaId: string; url: string }> {
    const fd = new FormData();
    fd.append('media', new Blob([bytes as unknown as BlobPart], { type: mimeType }), filename);
    const data = await this.call('/cgi-bin/material/add_material?type=IMAGE', fd);
    return { mediaId: String(data.media_id ?? ''), url: String(data.url ?? '') };
  }

  async uploadContentImage(bytes: Uint8Array, filename: string, mimeType = 'image/png'): Promise<string> {
    const fd = new FormData();
    fd.append('media', new Blob([bytes as unknown as BlobPart], { type: mimeType }), filename);
    const data = await this.call('/cgi-bin/media/uploadimg', fd);
    return String(data.url ?? '');
  }

  async createDraft(a: { title: string; author?: string; digest?: string; content: string; thumbMediaId: string }): Promise<string> {
    const data = await this.call('/cgi-bin/draft/add', {
      articles: [{
        title: a.title, author: a.author ?? '', digest: a.digest ?? '', content: a.content,
        thumb_media_id: a.thumbMediaId, need_open_comment: 0, only_fans_can_comment: 0,
      }],
    });
    return String(data.media_id ?? '');
  }
}

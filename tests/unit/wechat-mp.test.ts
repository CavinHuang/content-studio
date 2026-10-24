import { describe, it, expect, vi } from 'vitest';
import { WechatMpClient, WechatApiError, WechatNetworkError } from '../../src/main/publish/wechat-mp';

type Call = { url: string; body?: unknown };
function makeFetch(script: (c: Call) => Record<string, unknown> | { __status: number }) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init: { method: string; body?: unknown }) => {
    let body: unknown = init.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* 保留原串 */ } }
    if (typeof FormData !== 'undefined' && body instanceof FormData) body = { __form: [...body.entries()].map(([k, v]) => ({ k, name: (v as File).name, size: (v as File).size })) };
    const c: Call = { url, body };
    calls.push(c);
    const r = script(c);
    if ('__status' in (r as object)) {
      const status = (r as { __status: number }).__status;
      return { ok: status < 400, status, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => r as Record<string, unknown> };
  });
  return { fetchImpl, calls };
}
const cfg = { getAppid: () => 'wx-test', getSecret: () => 'secret-test' };

describe('WechatMpClient', () => {
  it('stable_token 获取与缓存：第二次业务调用不再请求 token', async () => {
    const { fetchImpl, calls } = makeFetch((c) => {
      if (c.url.includes('/cgi-bin/stable_token')) return { access_token: 'T1', expires_in: 7200 };
      return { media_id: 'D1' };
    });
    const client = new WechatMpClient(cfg, { fetchImpl: fetchImpl as never });
    const d1 = await client.createDraft({ title: '标题', content: '<p>x</p>', thumbMediaId: 'TH' });
    const d2 = await client.createDraft({ title: '标题', content: '<p>x</p>', thumbMediaId: 'TH' });
    expect(d1).toBe('D1'); expect(d2).toBe('D1');
    expect(calls.filter((c) => c.url.includes('stable_token'))).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ grant_type: 'client_credential', appid: 'wx-test', secret: 'secret-test' });
    expect((calls[1]!.body as { articles: { thumb_media_id: string }[] }).articles[0]!.thumb_media_id).toBe('TH');
  });
  it('token 过期后重新获取：过期的 T1 不再随业务请求发出', async () => {
    let t = 0; let tokens = 0;
    const { fetchImpl, calls } = makeFetch((c) => {
      if (c.url.includes('stable_token')) { tokens += 1; return { access_token: `T${tokens}`, expires_in: 7200 }; }
      return { media_id: 'D9' };
    });
    const client = new WechatMpClient(cfg, { fetchImpl: fetchImpl as never, now: () => t });
    await client.getAccessToken();            // T1（expiresAt = 6_900_000，含 5 分钟提前量）
    t = 7_200_000;                            // 已过期
    const id = await client.createDraft({ title: 'a', content: 'x', thumbMediaId: 'TH' });
    expect(id).toBe('D9');
    expect(tokens).toBe(2);                   // 恰好重取一次
    expect(calls.some((c) => c.url.includes('access_token=T1'))).toBe(false); // 旧 token 不再发出
  });
  it('缓存未过期：业务请求携带 T1；返回 40001 时单次强刷后重试成功', async () => {
    let t = 60_000; let tokens = 0; let draftCalls = 0;
    const { fetchImpl, calls } = makeFetch((c) => {
      if (c.url.includes('stable_token')) { tokens += 1; return { access_token: `T${tokens}`, expires_in: 7200 }; }
      draftCalls += 1;
      if (draftCalls === 1 && c.url.includes('T1')) return { errcode: 40001, errmsg: 'invalid credential' };
      return { media_id: 'D9' };
    });
    const client = new WechatMpClient(cfg, { fetchImpl: fetchImpl as never, now: () => t });
    await client.getAccessToken();            // T1 未过期（60_000 < 6_960_000）→ 首次业务调用必携带 T1
    const id = await client.createDraft({ title: 'a', content: 'x', thumbMediaId: 'TH' });
    expect(id).toBe('D9');                    // 强刷 T2 后重试成功
    expect(tokens).toBe(2);                   // 40001 恰好触发一次强刷
    expect(draftCalls).toBe(2);               // 首次(T1)被拒 → 重试(T2)成功，只重试一次
    expect(calls.some((c) => c.url.includes('access_token=T1') && (c.body as { articles?: unknown })?.articles)).toBe(true);
  });
  it('非 token errcode 直接抛 WechatApiError；HTTP 非 200 抛 WechatNetworkError', async () => {
    const { fetchImpl } = makeFetch((c) => c.url.includes('draft/add') ? { errcode: 45009, errmsg: 'reach max api daily quota' } : { access_token: 'T', expires_in: 7200 });
    const client = new WechatMpClient(cfg, { fetchImpl: fetchImpl as never });
    await expect(client.createDraft({ title: 'a', content: 'x', thumbMediaId: 'TH' })).rejects.toBeInstanceOf(WechatApiError);
    const { fetchImpl: f2 } = makeFetch(() => ({ __status: 502 }));
    const c2 = new WechatMpClient(cfg, { fetchImpl: f2 as never });
    await expect(c2.getAccessToken()).rejects.toBeInstanceOf(WechatNetworkError);
  });
  it('素材上传走 multipart：add_material 带文件名与字节，uploadimg 返回 url', async () => {
    const { fetchImpl, calls } = makeFetch((c) => {
      if (c.url.includes('add_material')) return { media_id: 'TH1', url: 'https://mmbiz/cover.jpg' };
      if (c.url.includes('uploadimg')) return { url: 'https://mmbiz/in.jpg' };
      return { access_token: 'T', expires_in: 7200 };
    });
    const client = new WechatMpClient(cfg, { fetchImpl: fetchImpl as never });
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await client.uploadImageMaterial(bytes, 'cover.png')).toMatchObject({ mediaId: 'TH1', url: 'https://mmbiz/cover.jpg' });
    expect(await client.uploadContentImage(bytes, 'in.png')).toBe('https://mmbiz/in.jpg');
    const form = (calls.find((c) => c.url.includes('add_material'))!.body as { __form: { k: string; name: string; size: number }[] }).__form;
    expect(form[0]).toMatchObject({ k: 'media', name: 'cover.png', size: 3 });
    expect(calls.find((c) => c.url.includes('add_material'))!.url).toContain('type=IMAGE');
  });
  it('未配置凭证抛业务错误', async () => {
    const client = new WechatMpClient({ getAppid: () => '', getSecret: () => '' });
    await expect(client.getAccessToken()).rejects.toMatchObject({ errcode: -1 });
  });
});

import { afterEach, describe, expect, test } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  WechatApiError,
  WechatMpClient,
  WechatNetworkError,
  validateWechatDraftArticle,
  type WechatFetch,
  type WechatResponse,
} from '../../packages/desktop/src/main/publish/wechat-mp'

type Call = { url: string; init: { method: string; headers?: Record<string, string>; body?: unknown } }

function jsonResponse(payload: unknown, status = 200): WechatResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (typeof payload === 'object' && payload !== null && 'raw' in (payload as object)) {
        throw new Error('not json')
      }
      return payload
    },
  }
}

/** 可编排的 fetch 桩：按路径顺序回放响应并记录调用（单测不联网）。 */
function makeFetch(script: Array<{ match: RegExp; respond: () => WechatResponse | Promise<WechatResponse> }>) {
  const calls: Call[] = []
  const fetchImpl: WechatFetch = async (url, init) => {
    calls.push({ url, init })
    for (const step of script) {
      if (step.match.test(url)) return step.respond()
    }
    throw new Error(`unexpected url: ${url}`)
  }
  return { fetchImpl, calls }
}

function okToken(value = 'TOKEN-A', expiresIn = 7200): WechatResponse {
  return jsonResponse({ access_token: value, expires_in: expiresIn })
}

/** 惰性 getter 形状：凭证在每次调用时解析，配置更新后无需重建客户端。 */
const CREDS = { getAppId: () => 'wx1234567890abcdef', getSecret: () => 'secret-0123456789abcdef' }

function makeClient(
  script: Array<{ match: RegExp; respond: () => WechatResponse | Promise<WechatResponse> }>,
  now: () => number = Date.now,
) {
  const { fetchImpl, calls } = makeFetch(script)
  const client = new WechatMpClient(CREDS, { baseUrl: 'https://api.weixin.qq.com', fetchImpl, now })
  return { client, calls }
}

afterEach(() => {
  // 每个用例自建 client / 自管 server；无全局状态需要清理。
})

test('stable_token 请求形状正确并在有效期内复用缓存', async () => {
  let tokenCalls = 0
  const { client, calls } = makeClient([
    {
      match: /\/cgi-bin\/stable_token$/,
      respond: () => {
        tokenCalls += 1
        return okToken()
      },
    },
    { match: /\/cgi-bin\/media\/uploadimg/, respond: () => jsonResponse({ url: 'https://mmbiz.qpic.cn/u1.png' }) },
  ])
  const first = await client.uploadContentImage(new Uint8Array([1, 2, 3]), 'a.png')
  expect(first).toBe('https://mmbiz.qpic.cn/u1.png')
  await client.uploadContentImage(new Uint8Array([4, 5, 6]), 'b.png')
  expect(tokenCalls).toBe(1) // 第二次业务调用复用缓存，不再请求 token
  const tokenCall = calls[0]!
  expect(tokenCall.url).toBe('https://api.weixin.qq.com/cgi-bin/stable_token')
  expect(tokenCall.init.method).toBe('POST')
  expect(tokenCall.init.headers).toEqual({ 'content-type': 'application/json' })
  expect(JSON.parse(String(tokenCall.init.body))).toEqual({
    grant_type: 'client_credential',
    appid: 'wx1234567890abcdef',
    secret: 'secret-0123456789abcdef',
  })
  // uploadimg 不带 JSON 头（multipart），token 经查询串拼接
  const uploadCall = calls[1]!
  expect(uploadCall.url).toBe('https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=TOKEN-A')
  expect(uploadCall.init.headers).toBeUndefined()
  expect(uploadCall.init.body).toBeInstanceOf(FormData)
})

test('token 到期前 5 分钟提前刷新：跨过缓存窗口即重新获取', async () => {
  let clock = 1_000_000
  let issued = 0
  const { client } = makeClient([
    {
      match: /stable_token/,
      respond: () => {
        issued += 1
        return okToken(`TOKEN-${issued}`, 400) // expiresAt = now + 400s − 300s = now + 100s
      },
    },
    { match: /uploadimg/, respond: () => jsonResponse({ url: 'https://mmbiz.qpic.cn/x.png' }) },
  ], () => clock)
  await client.uploadContentImage(new Uint8Array([1]), 'a.png')
  expect(issued).toBe(1)
  clock += 99_999 // 99.999s：仍在缓存窗口内
  await client.uploadContentImage(new Uint8Array([2]), 'b.png')
  expect(issued).toBe(1)
  clock += 2 // 越过 expiresAt
  await client.uploadContentImage(new Uint8Array([3]), 'c.png')
  expect(issued).toBe(2)
})

test('40001 单次强刷：业务调用遇 token 错误码强制刷新并重试一次', async () => {
  let tokenCalls = 0
  let draftCalls = 0
  const { client } = makeClient([
    {
      match: /stable_token/,
      respond: () => {
        tokenCalls += 1
        return okToken(`TOKEN-${tokenCalls}`)
      },
    },
    {
      match: /\/cgi-bin\/draft\/add/,
      respond: () => {
        draftCalls += 1
        if (draftCalls === 1) return jsonResponse({ errcode: 40001, errmsg: 'invalid credential' })
        return jsonResponse({ media_id: 'DRAFT-MEDIA-ID' })
      },
    },
  ])
  const mediaId = await client.createDraft({
    title: '标题',
    content: '<p>正文</p>',
    thumbMediaId: 'THUMB',
  })
  expect(mediaId).toBe('DRAFT-MEDIA-ID')
  expect(tokenCalls).toBe(2) // 初次 + 强刷一次
  expect(draftCalls).toBe(2) // 失败一次 + 重试一次
})

test('强刷后仍 40001：原样抛出，绝不循环强刷', async () => {
  let tokenCalls = 0
  const { client } = makeClient([
    {
      match: /stable_token/,
      respond: () => {
        tokenCalls += 1
        return okToken(`TOKEN-${tokenCalls}`)
      },
    },
    { match: /draft\/add/, respond: () => jsonResponse({ errcode: 40001, errmsg: 'still invalid' }) },
  ])
  await expect(
    client.createDraft({ title: '标题', content: '<p>正文</p>', thumbMediaId: 'THUMB' }),
  ).rejects.toMatchObject({ errcode: 40001 })
  expect(tokenCalls).toBe(2)
})

test('add_material 查询串拼接：path 已带 ? 时用 & 接 access_token', async () => {
  const { client, calls } = makeClient([
    { match: /stable_token/, respond: () => okToken('TK') },
    { match: /add_material/, respond: () => jsonResponse({ media_id: 'M-1', url: 'https://mmbiz.qpic.cn/m1.png' }) },
  ])
  const material = await client.uploadImageMaterial(new Uint8Array([9, 9]), 'cover.png')
  expect(material).toEqual({ mediaId: 'M-1', url: 'https://mmbiz.qpic.cn/m1.png' })
  expect(calls[1]!.url).toBe('https://api.weixin.qq.com/cgi-bin/material/add_material?type=IMAGE&access_token=TK')
})

test('draft/add 请求体字段与官方形状一致', async () => {
  const { client, calls } = makeClient([
    { match: /stable_token/, respond: () => okToken() },
    { match: /draft\/add/, respond: () => jsonResponse({ media_id: 'D-1' }) },
  ])
  await client.createDraft({
    title: '让灵感成为作品',
    author: '作者',
    digest: '摘要',
    content: '<h2>标题</h2>\n<p>正文</p>',
    thumbMediaId: 'THUMB-1',
  })
  const call = calls[1]!
  expect(call.url).toBe('https://api.weixin.qq.com/cgi-bin/draft/add?access_token=TOKEN-A')
  expect(JSON.parse(String(call.init.body))).toEqual({
    articles: [
      {
        title: '让灵感成为作品',
        author: '作者',
        digest: '摘要',
        content: '<h2>标题</h2>\n<p>正文</p>',
        thumb_media_id: 'THUMB-1',
        need_open_comment: 0,
        only_fans_can_comment: 0,
      },
    ],
  })
})

test('错误分流：网络异常与非 JSON 响应为 WechatNetworkError，errcode 为 WechatApiError', async () => {
  const broken: WechatFetch = async () => {
    throw new Error('connect ECONNREFUSED')
  }
  const client = new WechatMpClient(CREDS, { fetchImpl: broken })
  await expect(client.getAccessToken()).rejects.toBeInstanceOf(WechatNetworkError)

  const notJson = makeClient([{ match: /stable_token/, respond: () => jsonResponse({ raw: true }) }])
  await expect(notJson.client.getAccessToken()).rejects.toBeInstanceOf(WechatNetworkError)

  const http500 = makeClient([
    { match: /stable_token/, respond: () => ({ ok: false, status: 500, json: async () => ({}) }) },
  ])
  await expect(http500.client.getAccessToken()).rejects.toBeInstanceOf(WechatNetworkError)

  const apiErr = makeClient([{ match: /stable_token/, respond: () => jsonResponse({ errcode: 40013, errmsg: 'invalid appid' }) }])
  const err = await apiErr.client.getAccessToken().catch((error: unknown) => error)
  expect(err).toBeInstanceOf(WechatApiError)
  expect((err as WechatApiError).errcode).toBe(40013)
  expect((err as WechatApiError).errmsg).toContain('invalid appid')
})

test('未配置凭证：token 获取直接失败且不发网络请求', async () => {
  const calls: Call[] = []
  const recordFetch: WechatFetch = async (url, init) => {
    calls.push({ url, init })
    return okToken()
  }
  const unconfigured = new WechatMpClient({ getAppId: () => '', getSecret: () => '' }, { fetchImpl: recordFetch })
  await expect(unconfigured.getAccessToken()).rejects.toMatchObject({ errcode: -1 })
  expect(calls).toHaveLength(0)
})

describe('草稿字段校验（draft/add 限制：title≤32 / author≤16 / digest≤120 / content<20000 / 无 JS）', () => {
  const ok = { title: '标题', content: '<p>正文</p>', thumbMediaId: 'T' }
  test('合法字段通过', () => {
    expect(() => validateWechatDraftArticle({ ...ok, title: '字'.repeat(32), author: '作'.repeat(16), digest: '摘'.repeat(120) })).not.toThrow()
  })
  test('标题为空或超长被拒', () => {
    expect(() => validateWechatDraftArticle({ ...ok, title: '  ' })).toThrowError(/标题/)
    expect(() => validateWechatDraftArticle({ ...ok, title: '字'.repeat(33) })).toThrowError(/32/)
  })
  test('作者与摘要超长被拒', () => {
    expect(() => validateWechatDraftArticle({ ...ok, author: '字'.repeat(17) })).toThrowError(/16/)
    expect(() => validateWechatDraftArticle({ ...ok, digest: '字'.repeat(121) })).toThrowError(/120/)
  })
  test('正文为空、超 2 万字符或含 script 被拒', () => {
    expect(() => validateWechatDraftArticle({ ...ok, content: '' })).toThrowError(/正文/)
    expect(() => validateWechatDraftArticle({ ...ok, content: '字'.repeat(20_000) })).toThrowError(/2 万/)
    expect(() => validateWechatDraftArticle({ ...ok, content: '<p>a</p><script>alert(1)</script>' })).toThrowError(/脚本/)
  })
})

// 本地 http stub：验证零依赖 multipart（FormData + Blob）真实发到线上形状的端点。
test('multipart 经真实 http 到达：字段名/文件名/字节完整（本地 stub）', async () => {
  const uploads: Array<{ url: string; filename?: string; bytes: Buffer }> = []
  const server = createServer((req, res) => {
    const url = req.url ?? ''
    if (url === '/cgi-bin/stable_token') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ access_token: 'HTTP-TOKEN', expires_in: 7200 }))
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk as Buffer))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const disposition = /filename="([^"]+)"/.exec(body.toString('latin1'))
      uploads.push({ url, filename: disposition?.[1], bytes: body })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ url: 'https://mmbiz.qpic.cn/http-upload.png' }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    const client = new WechatMpClient(CREDS, { baseUrl: base })
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const url = await client.uploadContentImage(png, 'photo.png')
    expect(url).toBe('https://mmbiz.qpic.cn/http-upload.png')
    expect(uploads).toHaveLength(1)
    expect(uploads[0]!.url).toBe('/cgi-bin/media/uploadimg?access_token=HTTP-TOKEN')
    expect(uploads[0]!.filename).toBe('photo.png')
    expect(uploads[0]!.bytes.includes(Buffer.from(png))).toBe(true)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

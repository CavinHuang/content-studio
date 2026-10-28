import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { DatabaseSync } from 'node:sqlite'
import { migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import { TaskRunner } from '../../packages/desktop/src/main/tasks/runner'
import { TaskStore } from '../../packages/desktop/src/main/storage/taskStore'
import { makePlaceholderCoverPng } from '../../packages/desktop/src/main/publish/cover'
import { PublishService } from '../../packages/desktop/src/main/publish/publish-service'
import { createWechatPublishAdapter } from '../../packages/desktop/src/main/publish/draft-job'
import type { TaskRecord } from '../../packages/desktop/src/shared/desktop'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from([1, 2, 3, 4]).toString('base64')}`

describe('makePlaceholderCoverPng：无封面时生成合法占位图（draft/add 的 thumb 必填）', () => {
  test('PNG 签名/IHDR 尺寸/像素数据完整', () => {
    const cover = makePlaceholderCoverPng()
    const bytes = Buffer.from(cover.bytes)
    expect(cover).toMatchObject({ filename: 'cover.png', mimeType: 'image/png' })
    expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
    // IHDR：长度 13 + 类型后接 width/height（大端）
    expect(bytes.readUInt32BE(16)).toBe(900)
    expect(bytes.readUInt32BE(20)).toBe(383)
    // IDAT 解压后行数 ×（过滤器字节 + width×RGB）
    const idatStart = bytes.indexOf(Buffer.from('IDAT', 'latin1'))
    const idatLength = bytes.readUInt32BE(idatStart - 4)
    const inflated = inflateSync(bytes.subarray(idatStart + 4, idatStart + 4 + idatLength))
    expect(inflated.length).toBe(383 * (1 + 900 * 3))
  })
})

type DraftSeen = {
  url: string
  article: Record<string, unknown> | null
  filename?: string
  body: Buffer
}

let server: Server
let base = ''
let db: DatabaseSync | undefined
const draftCalls: DraftSeen[] = []
const materialCalls: DraftSeen[] = []
const uploadCalls: DraftSeen[] = []
let tokenCalls = 0
let failFirstMaterialWith: number | null = null
let failDraftWith: number | null = null

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? ''
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk as Buffer))
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const json = () => JSON.parse(body.toString('utf8') || '{}') as Record<string, unknown>
      const sendJson = (payload: unknown) => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(payload))
      }
      if (url === '/cgi-bin/stable_token') {
        tokenCalls += 1
        sendJson({ access_token: `TK-${tokenCalls}`, expires_in: 7200 })
        return
      }
      if (url.startsWith('/cgi-bin/material/add_material')) {
        if (failFirstMaterialWith !== null) {
          const errcode = failFirstMaterialWith
          failFirstMaterialWith = null
          sendJson({ errcode, errmsg: 'invalid credential' })
          return
        }
        materialCalls.push({
          url,
          article: null,
          filename: /filename="([^"]+)"/.exec(body.toString('latin1'))?.[1],
          body,
        })
        sendJson({ media_id: 'COVER-MEDIA', url: 'https://mmbiz.qpic.cn/cover.png' })
        return
      }
      if (url.startsWith('/cgi-bin/media/uploadimg')) {
        uploadCalls.push({
          url,
          article: null,
          filename: /filename="([^"]+)"/.exec(body.toString('latin1'))?.[1],
          body,
        })
        sendJson({ url: `https://mmbiz.qpic.cn/up-${uploadCalls.length}.png` })
        return
      }
      if (url.startsWith('/cgi-bin/draft/add')) {
        if (failDraftWith !== null) {
          const errcode = failDraftWith
          failDraftWith = null
          sendJson({ errcode, errmsg: 'draft rejected' })
          return
        }
        draftCalls.push({ url, article: (json().articles as unknown as Record<string, unknown>[])[0]!, body })
        sendJson({ media_id: 'DRAFT-MEDIA-ID' })
        return
      }
      res.statusCode = 404
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  db?.close()
  db = undefined
})

function resetCalls() {
  draftCalls.length = 0
  materialCalls.length = 0
  uploadCalls.length = 0
  tokenCalls = 0
  failFirstMaterialWith = null
  failDraftWith = null
}

function makeRunner(configured: boolean) {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-pub-')), 'studio.db'))
  migrate(db)
  const events: TaskRecord[] = []
  const runner = new TaskRunner(new TaskStore(db), (event) => {
    if (event.type === 'updated') events.push(event.task)
  })
  const creds = configured ? { appId: 'wx1234567890abcdef', secret: 'secret' } : null
  // 生产装配路径：公众号适配器（API 平台）经 PublishService 编排串行限速执行。
  // openSession 若被调用即抛错——API 平台绝不开页面会话（usesSession 分流的可执行断言）。
  const service = new PublishService({
    openSession: () => Promise.reject(new Error('公众号为 API 平台，不应打开页面会话')),
    minIntervalMs: 0,
    sleep: async () => {},
  })
  service.register(
    createWechatPublishAdapter({
      getConfig: () => creds,
      baseUrl: base,
    }),
  )
  runner.registerExecutor('publish', service.createExecutor())
  return { runner, events, service }
}

async function runToSettled(runner: TaskRunner, submit: Parameters<TaskRunner['submit']>[0]): Promise<TaskRecord> {
  const task = runner.submit(submit)
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const current = runner.get(task.id)
      if (current && current.state !== 'running') {
        clearInterval(timer)
        resolve()
      }
    }, 10)
  })
  return runner.get(task.id)!
}

const BODY = [
  '# 让灵感成为作品',
  '',
  '开篇一句**加粗**的话。',
  '',
  '![配图](asset:m1)',
  '',
  '![外链](https://cdn.example.com/far.png)',
  '',
  '- 要点一',
  '- 要点二',
].join('\n')

test('全链路：md→HTML、asset 图换 uploadimg URL、占位封面、draft/add 字段与结果如实', async () => {
  resetCalls()
  const { runner, events } = makeRunner(true)
  const settled = await runToSettled(runner, {
    kind: 'publish',
    executor: 'main',
    title: '存入公众号草稿箱',
    detail: '正在存入公众号草稿箱…',
    projectId: 'p1',
    payload: {
      platform: 'wechat',
      title: '让灵感成为作品',
      body: BODY,
      digest: '摘要',
      assets: { m1: PNG_DATA_URL },
    },
  })
  expect(settled.state).toBe('complete')
  expect(settled.result).toMatchObject({
    mediaId: 'DRAFT-MEDIA-ID',
    cover: 'placeholder',
    images: { uploaded: 1, external: 1, unresolved: [] },
  })
  // 进度步骤如实推进（转换 → 图片 → 封面 → 存草稿）
  const progressSteps = events
    .filter((event) => event.state === 'running' && event.progress)
    .map((event) => event.progress)
  expect(progressSteps).toEqual([
    '正在转换正文为公众号 HTML…',
    '正在把正文图片替换为公众号图片链接…',
    '正在上传封面素材…',
    '正在存入公众号草稿箱…',
  ])
  // 封面走 add_material（永久素材）且为合法 PNG
  expect(materialCalls).toHaveLength(1)
  expect(materialCalls[0]!.url).toContain('/cgi-bin/material/add_material?type=IMAGE&access_token=TK-')
  expect(materialCalls[0]!.filename).toBe('cover.png')
  expect(materialCalls[0]!.body.subarray(0, 8).some(() => true)).toBe(true)
  expect(materialCalls[0]!.body.includes(PNG_SIGNATURE.subarray(0, 4))).toBe(true)
  // 正文图走 uploadimg
  expect(uploadCalls).toHaveLength(1)
  expect(uploadCalls[0]!.url).toContain('/cgi-bin/media/uploadimg?access_token=')
  expect(uploadCalls[0]!.filename).toMatch(/^image-[0-9a-f]{8}\.png$/)
  // draft/add：内容干净（无 data:/asset:），字段齐全
  expect(draftCalls).toHaveLength(1)
  const article = draftCalls[0]!.article as Record<string, unknown>
  expect(article).toMatchObject({
    title: '让灵感成为作品',
    digest: '摘要',
    thumb_media_id: 'COVER-MEDIA',
    need_open_comment: 0,
    only_fans_can_comment: 0,
  })
  const content = String(article.content)
  expect(content).toContain('<h2>让灵感成为作品</h2>')
  expect(content).toContain('<strong>加粗</strong>')
  expect(content).toContain('https://mmbiz.qpic.cn/up-1.png')
  expect(content).toContain('src="https://cdn.example.com/far.png"') // 外链保留，由结果提示
  expect(content).toContain('<ul>\n<li>要点一</li>\n<li>要点二</li>\n</ul>')
  expect(content).not.toContain('data:image')
  expect(content).not.toContain('asset:')
  // 完成语提示外链风险与人工发布边界
  expect(settled.detail).toContain('已存入公众号草稿箱')
  expect(settled.detail).toContain('外链图片')
  expect(settled.detail).toContain('公众号后台')
})

test('未配置凭证：任务如实失败（凭证类），且不发出任何请求', async () => {
  resetCalls()
  const { runner } = makeRunner(false)
  const settled = await runToSettled(runner, {
    kind: 'publish',
    executor: 'main',
    title: '存入公众号草稿箱',
    detail: '…',
    projectId: 'p1',
    payload: { platform: 'wechat', title: '让灵感成为作品', body: BODY },
  })
  expect(settled.state).toBe('failed')
  expect(settled.detail).toContain('尚未配置公众号')
  // 三分类：凭证失败 → credential，立即停下要求配置（不重试）
  expect(settled.result).toMatchObject({ category: 'credential', code: 'NO_CONFIG' })
  expect(tokenCalls + materialCalls.length + uploadCalls.length + draftCalls.length).toBe(0)
})

test('字段超限：上传前就地失败（title > 32 字，零请求）', async () => {
  resetCalls()
  const { runner } = makeRunner(true)
  const settled = await runToSettled(runner, {
    kind: 'publish',
    executor: 'main',
    title: '存入公众号草稿箱',
    detail: '…',
    projectId: 'p1',
    payload: { platform: 'wechat', title: '标'.repeat(33), body: BODY },
  })
  expect(settled.state).toBe('failed')
  expect(settled.detail).toContain('32')
  expect(tokenCalls + materialCalls.length + uploadCalls.length + draftCalls.length).toBe(0)
})

test('中途 40001：单次强刷后整链路仍完成', async () => {
  resetCalls()
  failFirstMaterialWith = 40001
  const { runner } = makeRunner(true)
  const settled = await runToSettled(runner, {
    kind: 'publish',
    executor: 'main',
    title: '存入公众号草稿箱',
    detail: '…',
    projectId: 'p1',
    payload: { platform: 'wechat', title: '让灵感成为作品', body: '只有正文。' },
  })
  expect(settled.state).toBe('complete')
  expect(tokenCalls).toBe(2)
  expect(materialCalls).toHaveLength(1)
})

test('draft/add 业务错误：任务失败并带错误码（永久类，不重试）', async () => {
  resetCalls()
  failDraftWith = 45009
  const { runner } = makeRunner(true)
  const settled = await runToSettled(runner, {
    kind: 'publish',
    executor: 'main',
    title: '存入公众号草稿箱',
    detail: '…',
    projectId: 'p1',
    payload: { platform: 'wechat', title: '让灵感成为作品', body: '只有正文。' },
  })
  expect(settled.state).toBe('failed')
  expect(settled.detail).toContain('45009')
  expect(settled.result).toMatchObject({ category: 'permanent' })
})

test('draft/add 凭证类错误（40125）：凭证分类停下并给白名单提示，不自动重试', async () => {
  resetCalls()
  failDraftWith = 40125
  const { runner } = makeRunner(true)
  const settled = await runToSettled(runner, {
    kind: 'publish',
    executor: 'main',
    title: '存入公众号草稿箱',
    detail: '…',
    projectId: 'p1',
    payload: { platform: 'wechat', title: '让灵感成为作品', body: '只有正文。' },
  })
  expect(settled.state).toBe('failed')
  expect(settled.detail).toContain('40125')
  expect(settled.detail).toContain('IP 白名单')
  expect(settled.result).toMatchObject({ category: 'credential' })
  // 凭证失败不重试：draft/add 只被请求一次（首次即失败）
  expect(draftCalls).toHaveLength(0)
})

test('网络异常：按瞬态自动重试 3 次后如实失败，不伪装成功', async () => {
  resetCalls()
  const dbPath = join(mkdtempSync(join(tmpdir(), 'studio-pub-')), 'studio.db')
  db = openDatabase(dbPath)
  migrate(db)
  const runner = new TaskRunner(new TaskStore(db), () => {})
  const service = new PublishService({
    openSession: () => Promise.reject(new Error('公众号为 API 平台，不应打开页面会话')),
    minIntervalMs: 0,
    sleep: async () => {},
  })
  service.register(
    createWechatPublishAdapter({
      getConfig: () => ({ appId: 'wx1234567890abcdef', secret: 'secret' }),
      baseUrl: 'http://127.0.0.1:1', // 不可达端口
    }),
  )
  runner.registerExecutor('publish', service.createExecutor())
  const settled = await runToSettled(runner, {
    kind: 'publish',
    executor: 'main',
    title: '存入公众号草稿箱',
    detail: '…',
    projectId: 'p1',
    payload: { platform: 'wechat', title: '让灵感成为作品', body: '只有正文。' },
  })
  expect(settled.state).toBe('failed')
  expect(settled.detail).toContain('无法连接')
  // 三分类：网络问题 → transient，默认自动重试 2 次后停下
  expect(settled.detail).toContain('已自动重试 2 次')
  expect(settled.result).toMatchObject({ category: 'transient' })
})

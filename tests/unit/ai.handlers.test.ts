import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, test } from 'vitest'
import { KEEP_API_KEY } from '../../packages/desktop/src/shared/desktop'
import { migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import { buildAiHandlers, testOpenAiEndpoint } from '../../packages/desktop/src/main/ai/handlers'
import type { Crypto } from '../../packages/desktop/src/main/ai/model-config'

const passthrough: Crypto = {
  encrypt: (plain) => ({ data: Buffer.from(plain, 'utf8'), plain: false }),
  decrypt: (data) => (data && (data as ArrayLike<number>).length ? Buffer.from(data as ArrayLike<number>).toString('utf8') : ''),
}

let db: DatabaseSync | undefined
let server: http.Server | undefined
afterEach(() => {
  db?.close()
  db = undefined
  server?.close()
  server = undefined
})

function makeHandlers(agentStub = { send: async () => ({ ok: true, runId: 'r1' }), cancel: async () => ({ ok: true }), answer: () => ({}) }) {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-ai-h-')), 'studio.db'))
  migrate(db)
  return buildAiHandlers({ db, crypto: passthrough, agent: agentStub as never })
}

test('configGet/Set/Clear：脱敏视图与占位 Key', () => {
  const handlers = makeHandlers()
  expect(handlers.configGet()).toBeNull()
  const view = handlers.configSet({ baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'sk-abcd1234', modelId: 'm1' })
  expect(view).toMatchObject({ hasKey: true, apiKeyTail: '1234' })
  expect(JSON.stringify(view)).not.toContain('sk-abcd1234')
  const kept = handlers.configSet({ baseUrl: 'http://127.0.0.1:9/v2', apiKey: KEEP_API_KEY, modelId: 'm1' })
  expect(kept).toMatchObject({ baseUrl: 'http://127.0.0.1:9/v2' })
  expect(handlers.configClear()).toEqual({ ok: true })
  expect(handlers.configGet()).toBeNull()
})

test('send 校验 sessionKey 形态', async () => {
  const handlers = makeHandlers()
  expect(await handlers.send('../evil', 'hi')).toMatchObject({ ok: false, code: 'BAD_SESSION' })
  expect(await handlers.send('p:project-1', 'hi')).toMatchObject({ ok: true, runId: 'r1' })
  expect(await handlers.send('gen:r_abc', 'hi')).toMatchObject({ ok: true })
  // F07：项目会话键含对话身份（p:<项目>:<对话>），新建对话不复用同一项目的模型历史。
  expect(await handlers.send('p:project-1:conv-9', 'hi')).toMatchObject({ ok: true })
  expect(await handlers.send('p:../evil:x', 'hi')).toMatchObject({ ok: false, code: 'BAD_SESSION' })
})

test('testOpenAiEndpoint：成功/401/超时', async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      if (req.headers.authorization !== 'Bearer good') {
        res.writeHead(401).end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
      return
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as { port: number }).port
  const base = `http://127.0.0.1:${port}/v1`
  expect(await testOpenAiEndpoint(base, 'good')).toMatchObject({ ok: true })
  expect(await testOpenAiEndpoint(base, 'bad')).toMatchObject({ ok: false, message: expect.stringContaining('401') })
  // 挂起不响应的端点验证超时路径。
  const silent = http.createServer(() => {})
  await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', () => resolve()))
  const silentPort = (silent.address() as { port: number }).port
  try {
    expect(await testOpenAiEndpoint(`http://127.0.0.1:${silentPort}/v1`, 'x', fetch, 300)).toMatchObject({
      ok: false,
      message: expect.stringContaining('超时'),
    })
  } finally {
    await new Promise<void>((resolve) => silent.close(() => resolve()))
  }
  expect(await testOpenAiEndpoint('ftp://x', 'x')).toMatchObject({ ok: false })
})

test('handlers.test 用库内真实 Key 测试连接（占位回传）', async () => {
  const handlers = makeHandlers()
  handlers.configSet({ baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'stored-key', modelId: 'm' })
  let seenAuth = ''
  server = http.createServer((req, res) => {
    seenAuth = String(req.headers.authorization)
    res.writeHead(200).end()
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as { port: number }).port
  const result = await handlers.test(`http://127.0.0.1:${port}/v1`, KEEP_API_KEY, 'm')
  expect(result).toMatchObject({ ok: true })
  expect(seenAuth).toBe('Bearer stored-key')
})

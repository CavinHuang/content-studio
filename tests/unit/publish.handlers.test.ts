import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import { TaskRunner } from '../../packages/desktop/src/main/tasks/runner'
import { TaskStore } from '../../packages/desktop/src/main/storage/taskStore'
import { buildPublishHandlers } from '../../packages/desktop/src/main/publish/handlers'
import type { WechatResponse } from '../../packages/desktop/src/main/publish/wechat-mp'
import type { Crypto } from '../../packages/desktop/src/main/ai/model-config'

let db: DatabaseSync | undefined
afterEach(() => {
  db?.close()
  db = undefined
})

const passthrough: Crypto = {
  encrypt: (plain) => ({ data: Buffer.from(plain, 'utf8'), plain: false }),
  decrypt: (data) => Buffer.from(data as ArrayLike<number>).toString('utf8'),
}

function makeHandlers(fetchImpl?: Parameters<typeof buildPublishHandlers>[0]['fetchImpl']) {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-pub-h-')), 'studio.db'))
  migrate(db)
  const runner = new TaskRunner(new TaskStore(db), () => {})
  const handlers = buildPublishHandlers({
    db,
    crypto: passthrough,
    runner,
    ...(fetchImpl ? { fetchImpl } : {}),
  })
  return { handlers, runner }
}

const okToken: WechatResponse = {
  ok: true,
  status: 200,
  json: async () => ({ access_token: 'TK', expires_in: 7200 }),
}

test('configSave/Get/Clear：脱敏视图往返', () => {
  const { handlers } = makeHandlers()
  expect(handlers.configGet()).toBeNull()
  const view = handlers.configSave({ appId: 'wx1234567890abcdef', secret: 'secret-xyz9' })
  expect(view).toMatchObject({ appId: 'wx1234567890abcdef', hasSecret: true, secretTail: 'xyz9' })
  expect(handlers.configGet()).toEqual(view)
  expect(handlers.configClear()).toEqual({ ok: true })
  expect(handlers.configGet()).toBeNull()
})

test('canInject：未配置返回 NO_CONFIG；成功返回可存草稿', async () => {
  const { handlers } = makeHandlers()
  await expect(handlers.canInject()).resolves.toMatchObject({ ok: false, code: 'NO_CONFIG' })
  handlers.configSave({ appId: 'wx1234567890abcdef', secret: 's' })
  const okHandlers = makeHandlers(async () => okToken)
  okHandlers.handlers.configSave({ appId: 'wx1234567890abcdef', secret: 's' })
  await expect(okHandlers.handlers.canInject()).resolves.toMatchObject({ ok: true })
})

test('canInject：凭证/白名单错误给人话提示', async () => {
  const { handlers } = makeHandlers(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ errcode: 40125, errmsg: 'invalid appsecret' }),
  }))
  handlers.configSave({ appId: 'wx1234567890abcdef', secret: 'wrong' })
  const result = await handlers.canInject()
  expect(result.ok).toBe(false)
  expect(result.message).toContain('40125')
  expect(result.message).toContain('IP 白名单')
})

test('renderHtml：纯转换无需凭证；空正文如实拒绝', () => {
  const { handlers } = makeHandlers()
  const result = handlers.renderHtml('# 标题\n\n正文**加粗**')
  expect(result.ok).toBe(true)
  expect(result.html).toContain('<h2>标题</h2>')
  expect(result.html).toContain('<strong>加粗</strong>')
  expect(handlers.renderHtml('  ')).toMatchObject({ ok: false })
})

test('saveDraft：未配置/缺字段如实拒绝，不创建任务', () => {
  const { handlers, runner } = makeHandlers()
  const noConfig = handlers.saveDraft({ projectId: 'p1', title: '标题', body: '正文' })
  expect(noConfig).toMatchObject({ ok: false, code: 'NO_CONFIG' })
  expect(runner.list()).toHaveLength(0)
  handlers.configSave({ appId: 'wx1234567890abcdef', secret: 's' })
  expect(handlers.saveDraft({ projectId: 'p1', title: '', body: '正文' })).toMatchObject({ code: 'BAD_INPUT' })
  expect(handlers.saveDraft({ projectId: 'p1', title: '标题', body: '' })).toMatchObject({ code: 'BAD_INPUT' })
  expect(runner.list()).toHaveLength(0)
})

test('saveDraft：创建 kind publish / executor main 任务，payload 携带批次快照', () => {
  const { handlers, runner } = makeHandlers()
  handlers.configSave({ appId: 'wx1234567890abcdef', secret: 's' })
  const result = handlers.saveDraft({
    projectId: 'p1',
    batchId: 'batch-1',
    title: '让灵感成为作品',
    body: '# 让灵感成为作品\n\n正文',
    assets: { m1: 'data:image/png;base64,QUJD' },
  })
  expect(result.ok).toBe(true)
  const task = runner.get(result.taskId!)!
  expect(task).toMatchObject({ kind: 'publish', executor: 'main', projectId: 'p1' })
  expect(task.detail).toContain('让灵感成为作品')
  expect(task.payload).toMatchObject({
    platform: 'wechat',
    title: '让灵感成为作品',
    batchId: 'batch-1',
    assets: { m1: 'data:image/png;base64,QUJD' },
  })
})

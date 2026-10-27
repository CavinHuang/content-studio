import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import { TaskRunner } from '../../packages/desktop/src/main/tasks/runner'
import { TaskStore } from '../../packages/desktop/src/main/storage/taskStore'
import { buildRedbookHandlers } from '../../packages/desktop/src/main/publish/redbook/handlers'
import type { RedbookService } from '../../packages/desktop/src/main/publish/redbook/service'

let db: DatabaseSync | undefined
afterEach(() => {
  db?.close()
  db = undefined
})

function makeHandlers(service: Partial<RedbookService> = {}) {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-redbook-')), 'studio.db'))
  migrate(db)
  const runner = new TaskRunner(new TaskStore(db), () => {})
  const handlers = buildRedbookHandlers({
    runner,
    service: {
      openSession: service.openSession ?? (async () => ({ ok: true, loginState: 'loggedIn' })),
      loginState: service.loginState ?? (async () => ({ ok: true, loginState: 'loggedIn' })),
    },
  })
  return { handlers, runner }
}

test('injectDraft：缺标题/缺正文如实拒绝，不创建任务', () => {
  const { handlers, runner } = makeHandlers()
  expect(handlers.injectDraft({ projectId: 'p1', title: '', body: '正文' })).toMatchObject({
    ok: false,
    code: 'BAD_INPUT',
  })
  expect(handlers.injectDraft({ projectId: 'p1', title: '标题', body: ' ' })).toMatchObject({
    ok: false,
    code: 'BAD_INPUT',
  })
  expect(runner.list()).toHaveLength(0)
})

test('injectDraft：创建 kind publish / executor main / platform redbook 任务，payload 携带批次快照与话题原始串', () => {
  const { handlers, runner } = makeHandlers()
  const result = handlers.injectDraft({
    projectId: 'p1',
    batchId: 'batch-1',
    title: '让灵感成为作品',
    body: '一直想开始创作，却总觉得还没准备好？',
    tags: '#个人创作 #创作习惯',
  })
  expect(result.ok).toBe(true)
  const task = runner.get(result.taskId!)!
  expect(task).toMatchObject({ kind: 'publish', executor: 'main', projectId: 'p1' })
  expect(task.payload).toMatchObject({
    platform: 'redbook',
    title: '让灵感成为作品',
    body: '一直想开始创作，却总觉得还没准备好？',
    tags: '#个人创作 #创作习惯',
    batchId: 'batch-1',
  })
})

test('openSession/loginState：委托服务层并原样返回视图', async () => {
  const seen: string[] = []
  const { handlers } = makeHandlers({
    openSession: async (visible) => {
      seen.push(`open:${visible}`)
      return { ok: true, loginState: 'notLoggedIn', message: '尚未登录小红书。' }
    },
    loginState: async () => {
      seen.push('login')
      return { ok: false, code: 'EDITOR_URL_BLOCKED', message: '不在白名单' }
    },
  })
  await expect(handlers.openSession()).resolves.toMatchObject({ ok: true, loginState: 'notLoggedIn' })
  await expect(handlers.loginState()).resolves.toMatchObject({ ok: false, code: 'EDITOR_URL_BLOCKED' })
  // openSession 以可见形态打开（供扫码登录/查看草稿）
  expect(seen).toEqual(['open:true', 'login'])
})

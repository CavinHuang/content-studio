import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, test } from 'vitest'
import type { TaskRecord } from '../../packages/desktop/src/shared/desktop'
import { migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import { TaskStore } from '../../packages/desktop/src/main/storage/taskStore'

let db: DatabaseSync | undefined
afterEach(() => {
  db?.close()
  db = undefined
})

function makeStore() {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-tasks-')), 'studio.db'))
  migrate(db)
  return new TaskStore(db)
}

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't1',
    title: '准备平台版本',
    detail: '正在适配…',
    projectId: 'p1',
    state: 'running',
    kind: 'agent',
    at: '2026-10-27T10:00:00.000Z',
    updated: '2026-10-27T10:00:00.000Z',
    payload: { platforms: ['wechat'] },
    extra: { version: 2 },
    ...overrides,
  }
}

test('insert 与 list 往返（JSON 列互转、按时间新→旧）', () => {
  const store = makeStore()
  store.insert(record({ id: 'a', at: '2026-10-27T10:00:00.000Z' }))
  store.insert(record({ id: 'b', at: '2026-10-27T11:00:00.000Z' }))
  expect(store.list().map((t) => t.id)).toEqual(['b', 'a'])
  expect(store.get('a')).toMatchObject({ payload: { platforms: ['wechat'] }, extra: { version: 2 } })
  expect(store.get('missing')).toBeNull()
})

test('patch 局部更新且未给字段保留原值', () => {
  const store = makeStore()
  store.insert(record())
  const updated = store.patch('t1', { state: 'stopped', detail: '已停止，之前的文稿与作品保持可用。' })
  expect(updated).toMatchObject({ state: 'stopped', kind: 'agent', extra: { version: 2 } })
  expect(store.patch('missing', { state: 'failed' })).toBeNull()
})

test('stopActive 只降级 queued/running，其余记录不动', () => {
  const store = makeStore()
  store.insert(record({ id: 'run', state: 'running' }))
  store.insert(record({ id: 'queue', state: 'queued' }))
  store.insert(record({ id: 'done', state: 'complete' }))
  const affected = store.stopActive('应用已重新打开。任务已停止，可重新运行。')
  expect(affected.map((t) => t.id).sort()).toEqual(['queue', 'run'])
  const states = Object.fromEntries(store.list().map((t) => [t.id, t]))
  expect(states.run).toMatchObject({ state: 'stopped', detail: '应用已重新打开。任务已停止，可重新运行。' })
  expect(states.done!.state).toBe('complete')
})

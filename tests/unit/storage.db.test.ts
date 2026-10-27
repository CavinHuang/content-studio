import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, test } from 'vitest'
import { DB_VERSION, migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'

let db: DatabaseSync | undefined
afterEach(() => {
  db?.close()
  db = undefined
})

test('openDatabase 启用 WAL 并建库', () => {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-db-')), 'studio.db'))
  expect(db.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' })
})

test('migrate 从 0 升到 DB_VERSION，重复执行不报错', () => {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-db-')), 'studio.db'))
  migrate(db)
  migrate(db)
  expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: DB_VERSION })
  expect(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('workspace', 'tasks') ORDER BY name").all(),
  ).toEqual([{ name: 'tasks' }, { name: 'workspace' }])
})

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

test('v3 → v4 迁移补齐 tasks.executor 与 discovery_sources.refreshMinutes，既有行取缺省值', () => {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-db-v4-')), 'studio.db'))
  // 手工铺一个 v3 库（tasks 无 executor 列、discovery_sources 无 refreshMinutes 列）
  db.exec(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, detail TEXT NOT NULL, projectId TEXT NOT NULL,
      kind TEXT NOT NULL, state TEXT NOT NULL, at TEXT NOT NULL, updated TEXT NOT NULL,
      progress TEXT, error TEXT, payloadJson TEXT, resultJson TEXT, extraJson TEXT
    );
    CREATE TABLE discovery_sources (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, category TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, updated TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '', builtin INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL
    );
    INSERT INTO tasks (id, title, detail, projectId, kind, state, at, updated)
      VALUES ('t1', '旧任务', '已停止', 'p1', 'agent', 'stopped', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z');
    INSERT INTO discovery_sources (id, name, type, category, enabled, status, updated, url, builtin, createdAt)
      VALUES ('s1', '旧来源', 'RSS', '综合', 1, 'ready', '2026-10-01T00:00:00Z', 'https://a.example/feed', 0, '0:s1');
    PRAGMA user_version = 3;
  `)
  migrate(db)
  expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: DB_VERSION })
  expect(db.prepare('SELECT executor FROM tasks WHERE id = ?').get('t1')).toEqual({ executor: null })
  expect(
    db.prepare('SELECT refreshMinutes FROM discovery_sources WHERE id = ?').get('s1'),
  ).toEqual({ refreshMinutes: 0 })
})

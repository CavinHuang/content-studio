import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, test } from 'vitest'
import { migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import { WorkspaceStore } from '../../packages/desktop/src/main/storage/workspace'

let db: DatabaseSync | undefined
afterEach(() => {
  db?.close()
  db = undefined
})

function makeStore() {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-ws-')), 'studio.db'))
  migrate(db)
  return new WorkspaceStore(db)
}

test('空库 load 返回 null', () => {
  expect(makeStore().load()).toBeNull()
})

test('save 后 load 往返一致，整行替换旧文档', () => {
  const store = makeStore()
  store.save(3, { hello: '世界' })
  store.save(3, { hello: '再次', extra: [1, 2] })
  expect(store.load()).toEqual({ schema: 3, doc: { hello: '再次', extra: [1, 2] } })
})

test('save 拒绝非对象文档', () => {
  const store = makeStore()
  expect(() => store.save(3, null)).toThrow()
  expect(() => store.save(3, 'text')).toThrow()
})

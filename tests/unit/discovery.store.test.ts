import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { DB_VERSION, migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import { DiscoveryStore, type UpsertEntry } from '../../packages/desktop/src/main/discovery/store'

let db: DatabaseSync | undefined
afterEach(() => {
  db?.close()
  db = undefined
})

function makeStore(): DiscoveryStore {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-discovery-')), 'studio.db'))
  migrate(db)
  return new DiscoveryStore(db)
}

const entry = (over: Partial<UpsertEntry> = {}): UpsertEntry => ({
  id: undefined,
  url: 'https://example.com/a',
  title: '标题',
  body: '',
  bodyState: 'link-only',
  published: '10/25 08:30',
  collectedAt: '2026-10-25T01:30:00Z',
  collectedDisplay: '10/25 09:30',
  metric: undefined,
  sortIndex: 0,
  group: undefined,
  ...over,
})

test('迁移升 v3：discovery_sources / discovery_articles 两表落地', () => {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-db-')), 'studio.db'))
  migrate(db)
  expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: DB_VERSION })
  expect(DB_VERSION).toBe(3)
  expect(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'discovery_%' ORDER BY name").all(),
  ).toEqual([{ name: 'discovery_articles' }, { name: 'discovery_sources' }])
})

test('内置来源 seed 幂等；用户新建与编辑走同一保存路径', () => {
  const store = makeStore()
  store.seedBuiltin([
    { id: 'demo', name: '示例', type: 'RSS', category: '综合', enabled: true, status: 'ready', updated: '2026-10-25T01:00:00Z', url: 'https://example.com/x', builtin: true },
  ])
  store.seedBuiltin([
    { id: 'demo', name: '被用户改名后的示例', type: 'RSS', category: '综合', enabled: true, status: 'ready', updated: '2026-10-25T01:00:00Z', url: 'https://example.com/x', builtin: true },
  ])
  expect(store.listSources()).toHaveLength(1)
  expect(store.listSources()[0]!.name).toBe('示例') // OR IGNORE：不覆盖用户改动

  const saved = store.saveSource({ name: '我的订阅', type: 'RSS', category: '生活', enabled: true, url: 'https://example.com/feed' })
  expect(saved).toMatchObject({ name: '我的订阅', status: 'unconfigured', url: 'https://example.com/feed' })
  const edited = store.saveSource({ id: saved.id, name: '我的订阅 2', type: 'RSS', category: '生活', enabled: false, url: 'https://example.com/feed' })
  expect(edited).toMatchObject({ name: '我的订阅 2', enabled: false, id: saved.id })
  // 改动地址 → 回到未配置；不动地址 → 保留原状态
  store.setSourceStatus(saved.id, 'ready', '2026-10-26T00:00:00Z')
  expect(store.saveSource({ id: saved.id, name: 'x', type: 'RSS', category: '生活', enabled: true, url: 'https://example.com/other' }).status).toBe('unconfigured')
})

test('保存校验：名称必填；地址须为 http(s)', () => {
  const store = makeStore()
  expect(() => store.saveSource({ name: '  ', type: 'RSS', category: '综合', enabled: true, url: 'https://a.com' })).toThrow(/名称/)
  expect(() => store.saveSource({ name: 'a', type: 'RSS', category: '综合', enabled: true, url: 'ftp://a.com' })).toThrow(/http/)
})

test('删除来源：清空其文章贡献，保留其他来源收录的原文', () => {
  const store = makeStore()
  const a = store.saveSource({ name: '甲', type: 'RSS', category: '综合', enabled: true, url: 'https://a.com/f' })
  const b = store.saveSource({ name: '乙', type: 'RSS', category: '综合', enabled: true, url: 'https://b.com/f' })
  store.upsertArticle(a.id, entry({}))
  store.upsertArticle(b.id, entry({ url: 'https://example.com/b-only', title: '乙独有' }))
  expect(store.listArticles()).toHaveLength(2)
  expect(store.deleteSource(a.id)).toBe(true)
  expect(store.listSources().some((s) => s.id === a.id)).toBe(false)
  expect(store.listArticles()).toHaveLength(1)
  expect(store.listArticles()[0]).toMatchObject({ url: 'https://example.com/b-only', sourceIds: [b.id] })
  expect(store.deleteSource('missing')).toBe(false)
})

test('文章合并：同一 URL 多源收录合并 sourceIds/metric；正文按质量升级；收录展示保留首次', () => {
  const store = makeStore()
  const a = store.saveSource({ name: '甲', type: 'RSS', category: '综合', enabled: true, url: 'https://a.com/f' })
  const b = store.saveSource({ name: '乙', type: '平台热榜', category: '综合', enabled: true, url: 'https://b.com/f' })
  store.upsertArticle(a.id, entry({ collectedDisplay: '10/25 09:30', sortIndex: 3 }))
  store.upsertArticle(b.id, entry({ body: '榜单摘要', bodyState: 'summary', metric: '第 5 位', sortIndex: 1 }))
  const merged = store.listArticles()
  expect(merged).toHaveLength(1)
  expect(merged[0]).toMatchObject({
    sourceIds: [a.id, b.id],
    collectedDisplay: '10/25 09:30',
    body: '榜单摘要',
    bodyState: 'summary',
    sortIndex: 3,
  })
  expect(merged[0]!.metrics).toEqual([{ sourceId: b.id, text: '第 5 位' }])
  // 正文质量升级：summary → full
  store.upsertArticle(a.id, entry({ body: '完整正文' + '内容充实。'.repeat(60), bodyState: 'full' }))
  expect(store.listArticles()[0]).toMatchObject({ bodyState: 'full' })
})

test('刷新修剪：来源本轮未再提供的条目移除其收录，条目清空则删除', () => {
  const store = makeStore()
  const a = store.saveSource({ name: '甲', type: 'RSS', category: '综合', enabled: true, url: 'https://a.com/f' })
  store.upsertArticle(a.id, entry({ url: 'https://example.com/keep' }))
  store.upsertArticle(a.id, entry({ url: 'https://example.com/stale' }))
  store.pruneSource(a.id, new Set(['https://example.com/keep']))
  const rows = store.listArticles()
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ url: 'https://example.com/keep', sourceIds: [a.id] })
})

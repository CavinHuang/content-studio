import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { DatabaseSync } from 'node:sqlite'
import { migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import { DiscoveryStore } from '../../packages/desktop/src/main/discovery/store'
import { DiscoveryService } from '../../packages/desktop/src/main/discovery/service'
import { TaskRunner } from '../../packages/desktop/src/main/tasks/runner'
import { TaskStore } from '../../packages/desktop/src/main/storage/taskStore'
import { DEMO_TOPICS } from '../../packages/desktop/src/shared/discovery-demo'
import type { DiscoveryEvent, DiscoveryTopic } from '../../packages/desktop/src/shared/desktop'

const LONG_TEXT = '这是一段足够长的正文内容，用来通过正文提取的最小长度判定。'.repeat(12)

let httpServer: Server
let base = ''
let db: DatabaseSync | undefined

beforeAll(async () => {
  httpServer = createServer((req, res) => {
    const url = req.url ?? ''
    if (url === '/feed.xml') {
      res.setHeader('content-type', 'application/rss+xml')
      res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>实时订阅</title>
      <item><title>真实条目一</title><link>https://real.example.com/posts/one?utm_source=feed</link><pubDate>Sun, 25 Oct 2026 02:00:00 GMT</pubDate><description>真实摘要一</description></item>
      <item><title>真实条目二</title><link>https://real.example.com/posts/two</link><description>真实摘要二</description></item>
      </channel></rss>`)
      return
    }
    if (url === '/broken.xml') {
      res.statusCode = 500
      res.end('boom')
      return
    }
    if (url === '/hot.json') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ data: { items: [{ title: '热榜真实条目', url: `${base}/page/1`, hot: 42 }] } }))
      return
    }
    if (url.startsWith('/page/')) {
      res.end(`<html><body><article><h1>热榜真实条目</h1><p>${LONG_TEXT}</p></article></body></html>`)
      return
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
  db?.close()
  db = undefined
})

function makeService() {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-service-')), 'studio.db'))
  migrate(db)
  const events: DiscoveryEvent[] = []
  const store = new DiscoveryStore(db)
  const service = new DiscoveryService({ store, emit: (e) => events.push(e) })
  return { store, service, events }
}

test('首次初始化：注册内置示例来源并落地演示缓存，聚合结果与演示 topics 完全一致', () => {
  const { service } = makeService()
  service.ensureSeeded()
  const snap = service.snapshot()
  expect(snap.sources.map((s) => s.id)).toEqual(['zhihu', 'sspai', 'rss', 'redbook', 'news', 'custom'])
  expect(snap.sources.every((s) => s.builtin)).toBe(true)
  expect(snap.lastSyncAt).toBe('2026-10-25T01:40:00Z')
  // e2e 断言「4 个来源 · 3 篇去重原文」依赖的聚合形状逐字段一致
  expect(snap.topics).toEqual(DEMO_TOPICS as unknown as DiscoveryTopic[])
  const first = snap.topics[0]!
  expect(new Set(first.articles.flatMap((a) => a.sourceIds)).size).toBe(4)
  expect(first.articles).toHaveLength(3)
})

test('内置来源刷新确定性：成功来源重放同一演示数据；演示失败来源保留缓存不伪装成功', async () => {
  const { service } = makeService()
  service.ensureSeeded()
  for (const id of ['zhihu', 'sspai', 'rss']) {
    const result = await service.refreshSource(id)
    expect(result).toMatchObject({ ok: true })
  }
  const failed = await service.refreshSource('redbook')
  expect(failed.ok).toBe(false)
  expect(failed.message).toContain('演示获取失败')
  const snap = service.snapshot()
  expect(snap.topics).toEqual(DEMO_TOPICS as unknown as DiscoveryTopic[])
  expect(snap.sources.find((s) => s.id === 'redbook')).toMatchObject({ status: 'failed' })
  expect(snap.sources.find((s) => s.id === 'rss')).toMatchObject({ status: 'ready' })
})

test('真实 RSS 刷新：入库、URL 去重、状态就绪、事件推送', async () => {
  const { store, service, events } = makeService()
  service.ensureSeeded()
  const created = store.saveSource({ name: '实时订阅', type: 'RSS', category: 'AI 科技', enabled: true, url: `${base}/feed.xml` })
  const result = await service.refreshSource(created.id)
  expect(result).toMatchObject({ ok: true, count: 2 })
  const snap = service.snapshot()
  // 保留来源提供的原始 URL（含跟踪参数），去重只发生在规范化键上
  const fresh = snap.topics.find((t) =>
    t.articles.some((a) => a.url === 'https://real.example.com/posts/one?utm_source=feed'),
  )
  expect(fresh).toBeTruthy()
  expect(fresh!.articles[0]).toMatchObject({ title: '真实条目一', body: '真实摘要一', sourceIds: [created.id] })
  expect(snap.sources.find((s) => s.id === created.id)).toMatchObject({ status: 'ready' })
  expect(events.at(-1)).toMatchObject({ type: 'snapshot' })
})

test('单源失败不影响其余来源：失败项保留旧数据与状态', async () => {
  const { store, service } = makeService()
  service.ensureSeeded()
  const good = store.saveSource({ name: '好来源', type: 'RSS', category: '综合', enabled: true, url: `${base}/feed.xml` })
  const bad = store.saveSource({ name: '坏来源', type: 'RSS', category: '综合', enabled: true, url: `${base}/broken.xml` })
  const goodResult = await service.refreshSource(good.id)
  const badResult = await service.refreshSource(bad.id)
  expect(goodResult).toMatchObject({ ok: true })
  expect(badResult.ok).toBe(false)
  const snap = service.snapshot()
  expect(snap.sources.find((s) => s.id === bad.id)).toMatchObject({ status: 'failed' })
  expect(snap.topics.some((t) => t.articles.some((a) => a.sourceIds.includes(good.id)))).toBe(true)
})

test('任务系统接线：refreshAll 走 kind source / executor main，进度与部分失败如实结算', async () => {
  const { store, service } = makeService()
  service.ensureSeeded()
  const good = store.saveSource({ name: '好来源', type: 'RSS', category: '综合', enabled: true, url: `${base}/feed.xml` })
  const bad = store.saveSource({ name: '坏来源', type: 'RSS', category: '综合', enabled: true, url: `${base}/broken.xml` })
  store.saveSource({ name: '未配置', type: '自定义来源', category: '综合', enabled: true, url: '' })
  const runner = new TaskRunner(new TaskStore(db!), () => {})
  runner.registerExecutor('source', service.createTaskExecutor())
  const task = runner.submit({
    kind: 'source',
    title: '刷新热点来源',
    detail: '正在刷新已启用的来源…',
    projectId: 'discovery',
    executor: 'main',
    payload: { all: true },
  })
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const current = runner.get(task.id)
      if (current && current.state !== 'running') {
        clearInterval(timer)
        resolve()
      }
    }, 25)
  })
  const settled = runner.get(task.id)!
  expect(settled.state).toBe('complete')
  expect(settled.detail).toContain('坏来源')
  expect(settled.detail).toContain('失败')
  const snap = service.snapshot()
  expect(snap.sources.find((s) => s.id === good.id)).toMatchObject({ status: 'ready' })
  expect(snap.sources.find((s) => s.id === bad.id)).toMatchObject({ status: 'failed' })
})

test('未配置地址的来源刷新被拒绝并如实说明', async () => {
  const { store, service } = makeService()
  service.ensureSeeded()
  const blank = store.saveSource({ name: '未配置', type: '自定义来源', category: '综合', enabled: true, url: '' })
  const result = await service.refreshSource(blank.id)
  expect(result.ok).toBe(false)
  expect(result.message).toContain('尚未配置')
  expect(service.snapshot().sources.find((s) => s.id === blank.id)).toMatchObject({ status: 'unconfigured' })
})

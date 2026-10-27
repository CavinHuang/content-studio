import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, test } from 'vitest'
import { migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import { DiscoveryStore } from '../../packages/desktop/src/main/discovery/store'
import { SourceScheduler } from '../../packages/desktop/src/main/discovery/scheduler'
import { TaskRunner } from '../../packages/desktop/src/main/tasks/runner'
import { TaskStore } from '../../packages/desktop/src/main/storage/taskStore'

let db: DatabaseSync | undefined
afterEach(() => {
  db?.close()
  db = undefined
})

const T0 = Date.parse('2026-10-27T12:00:00.000Z')

function makeHarness(options: { now?: () => Date } = {}) {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-sched-')), 'studio.db'))
  migrate(db)
  const store = new DiscoveryStore(db)
  const runner = new TaskRunner(new TaskStore(db), () => {})
  let current = T0
  const scheduler = new SourceScheduler({
    store,
    runner,
    now: options.now ?? (() => new Date(current)),
  })
  const advance = (ms: number) => {
    current += ms
  }
  return { store, runner, scheduler, advance }
}

function minutesAgo(minutes: number): string {
  return new Date(T0 - minutes * 60_000).toISOString()
}

test('到期来源被挑选并提交 kind source / executor main 的定时任务', () => {
  const { store, runner, scheduler } = makeHarness()
  const due = store.saveSource({
    name: '到期',
    type: 'RSS',
    category: '综合',
    enabled: true,
    url: 'https://a.example/feed.xml',
    refreshMinutes: 30,
  })
  const fresh = store.saveSource({
    name: '刚刷新过',
    type: 'RSS',
    category: '综合',
    enabled: true,
    url: 'https://b.example/feed.xml',
    refreshMinutes: 30,
  })
  store.setSourceStatus(due.id, 'ready', minutesAgo(45))
  store.setSourceStatus(fresh.id, 'ready', minutesAgo(5))
  const result = scheduler.tick()
  expect(result).toEqual({ submitted: true, due: [due.id] })
  const task = runner.list().find((t) => t.kind === 'source')!
  expect(task).toMatchObject({ executor: 'main', state: 'running', projectId: 'discovery' })
  expect(task.payload).toEqual({ sourceIds: [due.id], scheduled: true })
})

test('从未成功刷新过的定来源按创建即到期处理（updated 为空）', () => {
  const { store, runner, scheduler } = makeHarness()
  const never = store.saveSource({
    name: '从未刷新',
    type: 'RSS',
    category: '综合',
    enabled: true,
    url: 'https://a.example/feed.xml',
    refreshMinutes: 30,
  })
  expect(scheduler.tick()).toEqual({ submitted: true, due: [never.id] })
  expect(runner.list().find((t) => t.kind === 'source')!.payload).toEqual({
    sourceIds: [never.id],
    scheduled: true,
  })
})

test('未到期、手动（0）、停用、无地址的来源一律不触发', () => {
  const { store, scheduler } = makeHarness()
  const recent = store.saveSource({
    name: '刚刷新过',
    type: 'RSS',
    category: '综合',
    enabled: true,
    url: 'https://a.example/feed.xml',
    refreshMinutes: 30,
  })
  store.setSourceStatus(recent.id, 'ready', minutesAgo(5))
  store.saveSource({ name: '手动', type: 'RSS', category: '综合', enabled: true, url: 'https://b.example/feed.xml' })
  store.saveSource({ name: '停用', type: 'RSS', category: '综合', enabled: false, url: 'https://c.example/feed.xml', refreshMinutes: 30 })
  store.saveSource({ name: '无地址', type: 'RSS', category: '综合', enabled: true, url: '', refreshMinutes: 30 })
  expect(scheduler.tick()).toEqual({ submitted: false, due: [] })
})

test('已有来源刷新任务在跑时本轮让路，不堆积任务', () => {
  const { store, runner, scheduler } = makeHarness()
  const due = store.saveSource({
    name: '到期',
    type: 'RSS',
    category: '综合',
    enabled: true,
    url: 'https://a.example/feed.xml',
    refreshMinutes: 30,
  })
  store.setSourceStatus(due.id, 'ready', minutesAgo(60))
  // 手动刷新任务先行（未注册执行器 → 停在 running）：定时巡检必须让路
  runner.submit({ kind: 'source', title: '刷新来源：到期', detail: '正在获取…', projectId: 'discovery', executor: 'main', payload: { sourceId: due.id } })
  const blocked = scheduler.tick()
  expect(blocked).toEqual({ submitted: false, due: [due.id] })
  expect(runner.list().filter((t) => t.kind === 'source')).toHaveLength(1)
})

test('失败退避：批次失败后 updated 不回写，靠 lastAttempt 退避一个间隔再重试', async () => {
  const { store, runner, scheduler, advance } = makeHarness()
  const due = store.saveSource({
    name: '坏来源',
    type: 'RSS',
    category: '综合',
    enabled: true,
    url: 'https://broken.example/feed.xml',
    refreshMinutes: 30,
  })
  store.setSourceStatus(due.id, 'ready', minutesAgo(60))
  let attempts = 0
  runner.registerExecutor('source', async () => {
    attempts += 1
    return { state: 'failed', detail: '获取失败' }
  })
  expect(scheduler.tick().submitted).toBe(true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(runner.list().find((t) => t.kind === 'source')).toMatchObject({ state: 'failed' })
  // 紧接着的巡检：updated 仍是旧值，但 lastAttempt 已记录 → 不重复提交
  expect(scheduler.tick().submitted).toBe(false)
  // 过一个完整间隔后再次到期
  advance(31 * 60_000)
  expect(scheduler.tick().submitted).toBe(true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(attempts).toBe(2)
})

test('成功刷新后按新的 updated 时间起算下一轮', async () => {
  const { store, runner, scheduler, advance } = makeHarness()
  const due = store.saveSource({
    name: '好来源',
    type: 'RSS',
    category: '综合',
    enabled: true,
    url: 'https://a.example/feed.xml',
    refreshMinutes: 30,
  })
  store.setSourceStatus(due.id, 'ready', minutesAgo(60))
  runner.registerExecutor('source', async () => ({ state: 'complete' }))
  expect(scheduler.tick().submitted).toBe(true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  // 模拟执行器成功回写 updated（真实路径由 DiscoveryService.refreshSource 完成）
  store.setSourceStatus(due.id, 'ready', new Date(T0).toISOString())
  advance(10 * 60_000)
  expect(scheduler.tick().submitted).toBe(false)
  advance(21 * 60_000)
  expect(scheduler.tick().submitted).toBe(true)
})

test('start/stop 用注入定时器驱动巡检，stop 后不再触发', () => {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-sched2-')), 'studio.db'))
  migrate(db)
  const store = new DiscoveryStore(db)
  const runner = new TaskRunner(new TaskStore(db), () => {})
  const due = store.saveSource({
    name: '到期',
    type: 'RSS',
    category: '综合',
    enabled: true,
    url: 'https://a.example/feed.xml',
    refreshMinutes: 30,
  })
  store.setSourceStatus(due.id, 'ready', minutesAgo(60))
  const fired: number[] = []
  const scheduler = new SourceScheduler({
    store,
    runner,
    now: () => new Date(T0),
    intervalMs: 1000,
    timers: {
      setInterval: (fn) => {
        const handle = fired.length
        fired.push(handle)
        return handle
      },
      clearInterval: () => {
        fired.length = 0
      },
    },
  })
  scheduler.start()
  expect(fired).toHaveLength(1)
  scheduler.stop()
  expect(fired).toHaveLength(0)
  // start 幂等
  scheduler.start()
  scheduler.start()
  expect(fired).toHaveLength(1)
})

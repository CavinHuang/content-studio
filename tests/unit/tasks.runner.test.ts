import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, test } from 'vitest'
import type { TaskEvent } from '../../packages/desktop/src/shared/desktop'
import { migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import { TaskStore } from '../../packages/desktop/src/main/storage/taskStore'
import { TaskRunner } from '../../packages/desktop/src/main/tasks/runner'

let db: DatabaseSync | undefined
afterEach(() => {
  db?.close()
  db = undefined
})

function makeRunner() {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-runner-')), 'studio.db'))
  migrate(db)
  const events: TaskEvent[] = []
  const runner = new TaskRunner(new TaskStore(db), (event) => events.push(event))
  return { runner, events }
}

test('submit 直接进入 running 并发出 updated 事件', () => {
  const { runner, events } = makeRunner()
  const task = runner.submit({ kind: 'agent', title: '准备平台版本', detail: '正在适配…', projectId: 'p1' })
  expect(task.state).toBe('running')
  expect(events).toEqual([{ type: 'updated', task }])
})

test('settle 仅对 running 任务生效，完成后重复结算返回 null', () => {
  const { runner } = makeRunner()
  const task = runner.submit({ kind: 'export', title: '导出', detail: '', projectId: 'p1' })
  const settled = runner.settle(task.id, { state: 'complete' })
  expect(settled).toMatchObject({ state: 'complete', detail: '本地任务已完成；未调用外部服务。' })
  expect(runner.settle(task.id, { state: 'failed' })).toBeNull()
  expect(runner.settle('missing', { state: 'complete' })).toBeNull()
})

test('settle failed 记录 error 字段', () => {
  const { runner } = makeRunner()
  const task = runner.submit({ kind: 'source', title: '刷新来源', detail: '', projectId: 'p1' })
  expect(runner.settle(task.id, { state: 'failed', detail: '来源不可用', result: undefined })).toMatchObject({
    state: 'failed',
    error: '来源不可用',
  })
})

test('stop 把活动任务置为 stopped，之后迟到的 settle 被拒绝', () => {
  const { runner } = makeRunner()
  const task = runner.submit({ kind: 'agent', title: 't', detail: '', projectId: 'p1' })
  expect(runner.control(task.id, 'stop')).toEqual({ ok: true })
  expect(runner.get(task.id)).toMatchObject({ state: 'stopped', detail: '已停止，之前的文稿与作品保持可用。' })
  expect(runner.settle(task.id, { state: 'complete' })).toBeNull()
})

test('stop 已完结任务返回 ok:false', () => {
  const { runner } = makeRunner()
  const task = runner.submit({ kind: 'agent', title: 't', detail: '', projectId: 'p1' })
  runner.settle(task.id, { state: 'complete' })
  expect(runner.control(task.id, 'stop')).toEqual({ ok: false })
})

test('retry 克隆出新 running 任务，原记录保持不变', () => {
  const { runner } = makeRunner()
  const task = runner.submit({
    kind: 'export',
    title: '导出',
    detail: '',
    projectId: 'p1',
    extra: { videoId: 'v1', version: 3 },
  })
  const failed = runner.settle(task.id, { state: 'failed', detail: '模拟失败' })!
  const retried = runner.control(task.id, 'retry')
  expect(retried).toEqual({ ok: true })
  const all = runner.list()
  expect(all).toHaveLength(2)
  const clone = all.find((t) => t.id !== task.id)!
  expect(clone).toMatchObject({
    state: 'running',
    title: '导出',
    projectId: 'p1',
    detail: '正在重试当前任务…',
    extra: { videoId: 'v1', version: 3 },
  })
  expect(runner.get(task.id)!.state).toBe('failed')
  expect(failed.state).toBe('failed')
})

test('executor 落库后，submit 发出的 updated 事件与列表都携带 executor=main', () => {
  const { runner, events } = makeRunner()
  const task = runner.submit({
    kind: 'source',
    title: '刷新来源：真实源',
    detail: '正在获取…',
    projectId: 'discovery',
    executor: 'main',
    payload: { sourceId: 's1' },
  })
  // 事件里的 task 是 emit 前从 store 重读的：executor 必须仍在，否则渲染端兜底接管
  expect(events.at(-1)).toMatchObject({ type: 'updated', task: { id: task.id, executor: 'main' } })
  expect(runner.get(task.id)).toMatchObject({ executor: 'main' })
  expect(runner.list().find((t) => t.id === task.id)).toMatchObject({ executor: 'main' })
})

test('主进程执行器任务不会被渲染端兜底 settle 伪结算：真实失败如实保留', async () => {
  const { runner } = makeRunner()
  let release: (() => void) | undefined
  runner.registerExecutor('source', async () => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return { state: 'failed', detail: '真实抓取失败：来源返回 500。' }
  })
  const task = runner.submit({
    kind: 'source',
    title: '刷新来源：慢速真实源',
    detail: '正在获取…',
    projectId: 'discovery',
    executor: 'main',
    payload: { sourceId: 'slow' },
  })
  // 真实抓取进行中，渲染端 1 秒兜底尝试伪结算为「演示任务已完成」——必须被拒绝
  expect(
    runner.settle(task.id, { state: 'complete', detail: '演示任务已完成；未调用外部服务。' }),
  ).toBeNull()
  expect(runner.get(task.id)!.state).toBe('running')
  release!()
  await new Promise((resolve) => setTimeout(resolve, 0))
  const settled = runner.get(task.id)!
  expect(settled).toMatchObject({ state: 'failed', detail: '真实抓取失败：来源返回 500。' })
})

test('失败的主进程任务重试：克隆携带 executor 且执行器真实再跑一次', async () => {
  const { runner } = makeRunner()
  let runs = 0
  runner.registerExecutor('source', async () => {
    runs += 1
    return runs === 1
      ? { state: 'failed', detail: '第一次失败。' }
      : { state: 'complete', detail: '重试成功，已更新 1 个来源。' }
  })
  const task = runner.submit({
    kind: 'source',
    title: '刷新来源：真实源',
    detail: '正在获取…',
    projectId: 'discovery',
    executor: 'main',
    payload: { sourceId: 's1' },
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(runner.get(task.id)).toMatchObject({ state: 'failed' })
  expect(runner.control(task.id, 'retry')).toEqual({ ok: true })
  const clone = runner.list().find((t) => t.id !== task.id && t.kind === 'source')!
  expect(clone).toMatchObject({ executor: 'main', state: 'running' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(runs).toBe(2)
  expect(runner.get(clone.id)).toMatchObject({ state: 'complete', detail: '重试成功，已更新 1 个来源。' })
})

test('recover 把活动任务降级为 stopped 并发出 snapshot', () => {
  const { runner, events } = makeRunner()
  runner.submit({ kind: 'agent', title: 'a', detail: '', projectId: 'p1' })
  runner.submit({ kind: 'export', title: 'b', detail: '', projectId: 'p1' })
  events.length = 0
  const affected = runner.recover()
  expect(affected).toHaveLength(2)
  expect(affected.every((t) => t.state === 'stopped')).toBe(true)
  expect(events.at(-1)).toMatchObject({ type: 'snapshot' })
  // 再跑一次没有活动任务，不再发事件
  events.length = 0
  expect(runner.recover()).toEqual([])
  expect(events).toEqual([])
})

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { TaskEvent } from '../../packages/desktop/src/shared/desktop'
import { initServices } from '../../packages/desktop/src/main/services'

function makeServices() {
  const events: TaskEvent[] = []
  const services = initServices(join(mkdtempSync(join(tmpdir(), 'studio-services-')), 'studio.db'), (e) =>
    events.push(e),
  )
  return { services, events }
}

test('dbSave → dbLoad 往返一致；空库 exists:false', () => {
  const { services } = makeServices()
  expect(services.api.dbLoad()).toEqual({ exists: false, workspace: null })
  const doc = { schema: 3, projects: [{ id: 'p1' }], tasks: [] }
  expect(services.api.dbSave(doc)).toMatchObject({ ok: true })
  expect(services.api.dbLoad()).toEqual({ exists: true, workspace: doc })
})

test('dbSave 拒绝非对象时返回失败而不抛栈', () => {
  const { services } = makeServices()
  expect(services.api.dbSave('bad')).toMatchObject({ ok: false })
})

test('任务经 api 提交、结算、停止、重试全链路', () => {
  const { services, events } = makeServices()
  const task = services.api.taskSubmit({ kind: 'agent', title: 't', detail: '', projectId: 'p1' })
  expect(task.state).toBe('running')
  expect(events.at(-1)).toMatchObject({ type: 'updated' })
  expect(services.api.taskSettle(task.id, { state: 'complete' })).toMatchObject({ state: 'complete' })
  const failed = services.api.taskSubmit({ kind: 'source', title: 's', detail: '', projectId: 'p1' })
  services.api.taskControl(failed.id, 'stop')
  expect(services.api.taskList().find((t) => t.id === failed.id)).toMatchObject({ state: 'stopped' })
  services.api.taskControl(failed.id, 'retry')
  expect(services.api.taskList()).toHaveLength(3)
})

test('recover 降级活动任务（模拟重启）', () => {
  const { services } = makeServices()
  services.api.taskSubmit({ kind: 'agent', title: 'a', detail: '', projectId: 'p1' })
  expect(services.runner.recover()).toHaveLength(1)
  expect(services.api.taskList().every((t) => t.state !== 'running')).toBe(true)
})

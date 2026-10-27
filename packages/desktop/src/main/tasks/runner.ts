import { randomUUID } from 'node:crypto'
import type { TaskEvent, TaskRecord, TaskSettle, TaskSubmitPayload } from '../../shared/desktop'
import type { TaskStore } from '../storage/taskStore'

export type TaskSubmitInput = TaskSubmitPayload

/**
 * P1 语义：submit 直接落 running（queued 保留给 P2 主进程执行器的并发限制）；
 * 执行在渲染端本地完成，经 settle 回写。停止后迟到的 settle 一律拒绝，
 * 防止“已停止”被覆盖成“已完成”。
 */
export class TaskRunner {
  constructor(
    private readonly store: TaskStore,
    private readonly emit: (event: TaskEvent) => void,
  ) {}

  list(): TaskRecord[] {
    return this.store.list()
  }

  get(id: string): TaskRecord | null {
    return this.store.get(id)
  }

  submit(input: TaskSubmitInput): TaskRecord {
    const at = new Date().toISOString()
    const record: TaskRecord = {
      id: input.id ?? randomUUID(),
      title: input.title,
      detail: input.detail,
      projectId: input.projectId,
      state: 'running',
      kind: input.kind,
      at,
      updated: at,
    }
    if (input.payload !== undefined) record.payload = input.payload
    if (input.extra !== undefined) record.extra = input.extra
    this.store.insert(record)
    const saved = this.store.get(record.id)!
    this.emit({ type: 'updated', task: saved })
    return saved
  }

  settle(id: string, settle: TaskSettle): TaskRecord | null {
    const current = this.store.get(id)
    if (!current || current.state !== 'running') return null
    const fields: Partial<TaskRecord> = {
      state: settle.state,
      detail: settle.detail ?? (settle.state === 'complete' ? '本地任务已完成；未调用外部服务。' : current.detail),
    }
    if (settle.state === 'failed') fields.error = settle.detail ?? '任务失败'
    if (settle.result !== undefined) fields.result = settle.result
    const updated = this.store.patch(id, fields)!
    this.emit({ type: 'updated', task: updated })
    return updated
  }

  control(id: string, action: 'stop' | 'retry'): { ok: boolean } {
    const current = this.store.get(id)
    if (!current) return { ok: false }
    if (action === 'stop') {
      if (current.state !== 'running' && current.state !== 'queued') return { ok: false }
      const updated = this.store.patch(id, { state: 'stopped', detail: '已停止，之前的文稿与作品保持可用。' })!
      this.emit({ type: 'updated', task: updated })
      return { ok: true }
    }
    const clone = this.submit({
      kind: current.kind,
      title: current.title,
      detail: '正在重试当前任务…',
      projectId: current.projectId,
      payload: current.payload,
      extra: current.extra,
    })
    this.emit({ type: 'updated', task: clone })
    return { ok: true }
  }

  recover(): TaskRecord[] {
    const affected = this.store.stopActive('应用已重新打开。任务已停止，可重新运行。')
    if (affected.length) this.emit({ type: 'snapshot', tasks: this.store.list() })
    return affected
  }
}

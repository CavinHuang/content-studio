import { randomUUID } from 'node:crypto'
import type { TaskEvent, TaskRecord, TaskSettle, TaskSubmitPayload } from '../../shared/desktop'
import type { TaskStore } from '../storage/taskStore'

export type TaskSubmitInput = TaskSubmitPayload

/**
 * P1 语义：submit 直接落 running（queued 保留给 P2 主进程执行器的并发限制）；
 * 执行在渲染端本地完成，经 settle 回写。停止后迟到的 settle 一律拒绝，
 * 防止”已停止”被覆盖成”已完成”。
 * P2 扩展：executor='main' 且已注册执行器的任务由主进程驱动（进度/中止/结算）。
 */
export type MainExecutor = (
  task: TaskRecord,
  ctx: { progress: (step: string) => void; signal: AbortSignal },
) => Promise<{ state: 'complete' | 'failed'; detail?: string; result?: unknown }>

export class TaskRunner {
  private readonly executors = new Map<string, MainExecutor>()
  private readonly aborts = new Map<string, AbortController>()

  constructor(
    private readonly store: TaskStore,
    private readonly emit: (event: TaskEvent) => void,
  ) {}

  registerExecutor(kind: string, executor: MainExecutor): void {
    this.executors.set(kind, executor)
  }

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
    if (input.executor !== undefined) record.executor = input.executor
    this.store.insert(record)
    const saved = this.store.get(record.id)!
    this.emit({ type: 'updated', task: saved })
    if (input.executor === 'main' && this.executors.has(input.kind)) {
      void this.runMain(saved)
    }
    return saved
  }

  /** 主进程执行器驱动：进度上报、可中止（control stop 触发 AbortSignal）、完成/失败结算。 */
  private async runMain(task: TaskRecord): Promise<void> {
    const executor = this.executors.get(task.kind)!
    const controller = new AbortController()
    this.aborts.set(task.id, controller)
    const ctx = {
      progress: (step: string) => {
        const updated = this.store.patch(task.id, { progress: step, detail: step })
        if (updated) this.emit({ type: 'updated', task: updated })
      },
      signal: controller.signal,
    }
    try {
      const outcome = await executor(task, ctx)
      const current = this.store.get(task.id)
      if (!current || current.state !== 'running') return // 已被停止：迟到的结算拒绝
      const updated = this.store.patch(task.id, {
        state: outcome.state,
        detail: outcome.detail ?? current.detail,
        ...(outcome.result !== undefined ? { result: outcome.result } : {}),
      })!
      this.emit({ type: 'updated', task: updated })
    } catch (err) {
      const current = this.store.get(task.id)
      if (current && current.state === 'running') {
        const updated = this.store.patch(task.id, { state: 'failed', error: String((err as Error).message ?? err) })!
        this.emit({ type: 'updated', task: updated })
      }
    } finally {
      this.aborts.delete(task.id)
    }
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
      this.aborts.get(id)?.abort()
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

import type { TaskRunner } from '../tasks/runner'
import type { DiscoveryStore } from './store'

export interface SourceSchedulerOptions {
  store: DiscoveryStore
  runner: TaskRunner
  /** 巡检周期，默认 60 秒；只决定到期检查的粒度，实际间隔由来源 refreshMinutes 决定。 */
  intervalMs?: number
  now?: () => Date
  /** 注入定时器（测试用）；缺省用全局 setInterval/clearInterval。 */
  timers?: {
    setInterval: (fn: () => void, ms: number) => unknown
    clearInterval: (handle: unknown) => void
  }
}

export type TickResult = { submitted: boolean; due: string[] }

type TimerHooks = {
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (handle: unknown) => void
}

/**
 * 可配置定时刷新（总规格 P3 第 3 条）：按来源 refreshMinutes 挑出到期来源，
 * 经任务系统提交 kind 'source' / executor 'main' 的定时刷新任务，真实抓取走
 * 与手动刷新完全相同的执行器（进度、停止、失败如实回传）。
 *
 * 失败来源的 updated 不回写（UX-SPEC §20.4 保留原更新时间），调度侧以内存
 * lastAttempt 记录本次提交时间，让失败重试退避一个完整间隔，而不是每个巡检
 * 周期都重打同一个失败来源。进程重启后 lastAttempt 清空，回到按 updated 判定。
 */
export class SourceScheduler {
  private handle: unknown = null
  private readonly lastAttempt = new Map<string, number>()
  private readonly intervalMs: number
  private readonly now: () => Date
  private readonly timers: TimerHooks
  private readonly store: DiscoveryStore
  private readonly runner: TaskRunner

  constructor(deps: SourceSchedulerOptions) {
    this.store = deps.store
    this.runner = deps.runner
    this.intervalMs = deps.intervalMs ?? 60_000
    this.now = deps.now ?? (() => new Date())
    this.timers =
      deps.timers ??
      ({
        setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
        clearInterval: (handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>),
      } satisfies TimerHooks)
  }

  start(): void {
    if (this.handle !== null) return
    this.handle = this.timers.setInterval(() => this.tick(), this.intervalMs)
  }

  stop(): void {
    if (this.handle === null) return
    this.timers.clearInterval(this.handle)
    this.handle = null
  }

  /** 单次巡检（测试可直接调用）：返回本次挑出的到期来源与是否已提交任务。 */
  tick(): TickResult {
    const nowMs = this.now().getTime()
    const due = this.store.listSources().filter((source) => {
      if (!source.enabled || !source.url.trim()) return false
      const minutes = source.refreshMinutes ?? 0
      if (minutes <= 0) return false
      const updatedMs = source.updated ? Date.parse(source.updated) : 0
      const lastKnown = Math.max(this.lastAttempt.get(source.id) ?? 0, Number.isFinite(updatedMs) ? updatedMs : 0)
      return nowMs - lastKnown >= minutes * 60_000
    })
    if (!due.length) return { submitted: false, due: [] }
    // 已有来源刷新任务在跑（手动或定时）：本轮让路，下一巡检再查，避免任务堆积。
    const busy = this.runner.list().some(
      (task) => task.kind === 'source' && (task.state === 'running' || task.state === 'queued'),
    )
    if (busy) return { submitted: false, due: due.map((source) => source.id) }
    for (const source of due) this.lastAttempt.set(source.id, nowMs)
    this.runner.submit({
      kind: 'source',
      title: '定时刷新热点来源',
      detail: `正在按计划刷新 ${due.length} 个到期来源…`,
      projectId: 'discovery',
      executor: 'main',
      payload: { sourceIds: due.map((source) => source.id), scheduled: true },
    })
    return { submitted: true, due: due.map((source) => source.id) }
  }
}

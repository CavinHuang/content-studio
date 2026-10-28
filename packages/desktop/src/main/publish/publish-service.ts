/**
 * 发布编排 PublishService（spec P4 §4.4，移植自 ref/edf225b-publish-service.ts 自有历史资产）：
 * - 平台间串行互斥：所有发布任务共用一条链逐个执行；单任务失败不断链，不影响其他平台。
 * - 相邻执行最小间隔：默认 15 秒（env STUDIO_PUBLISH_MIN_INTERVAL_MS 可调）；首次执行不等待。
 * - 失败三分类：transient（网络/超时）按限速间隔自动重试（默认共 3 次尝试）；
 *   credential（未配置/未登录/凭证无效）立即停下要求配置，不重试；
 *   permanent（页面变化/防覆盖/业务错误等）一次如实上报，绝不静默当成功。
 * - usesSession 分流：页面会话平台（如小红书）由编排层先开平台会话再执行；
 *   API 平台（如公众号）绝不开页面会话，session 恒为 null。
 * 人机边界（铁律）：编排只驱动「草稿动作」（存草稿/注入草稿），没有任何发布动作；
 * 任务状态权威在 TaskRunner/TaskStore，本层只做执行策略。
 */
import type { TaskRecord } from '../../shared/desktop'
import type { MainExecutor } from '../tasks/runner'

export type PublishFailureCategory = 'transient' | 'credential' | 'permanent'

export type PublishRunContext = {
  progress: (step: string) => void
  signal: AbortSignal
}

export type PublishRunOutcome =
  | { ok: true; detail: string; result?: unknown }
  | { ok: false; category: PublishFailureCategory; code?: string; detail: string }

export type PublishFailureOutcome = Extract<PublishRunOutcome, { ok: false }>

export interface PublishAdapter {
  platform: string
  /** true＝页面会话平台（如小红书）：编排层执行前先开平台会话；false＝API 平台（如公众号）：绝不开页面会话。 */
  usesSession: boolean
  run(input: { task: TaskRecord; session: unknown }, ctx: PublishRunContext): Promise<PublishRunOutcome>
}

export type PublishServiceDeps = {
  /** 页面会话平台开平台页（API 平台不会被调用）。 */
  openSession(platform: string): Promise<unknown>
  /** 相邻两次平台动作的最小间隔；缺省 15s，env STUDIO_PUBLISH_MIN_INTERVAL_MS 可调。 */
  minIntervalMs?: number
  /** 瞬态失败的总尝试次数上限（含首次）；缺省 3。 */
  maxTransientAttempts?: number
  now?(): number
  sleep?(ms: number): Promise<void>
}

export const DEFAULT_PUBLISH_MIN_INTERVAL_MS = 15_000
export const PUBLISH_MIN_INTERVAL_ENV = 'STUDIO_PUBLISH_MIN_INTERVAL_MS'
const DEFAULT_MAX_TRANSIENT_ATTEMPTS = 3

/** 任务负载里的平台键；缺省视为公众号（历史兼容：payload 未标 platform 的存草稿任务）。 */
export function platformOfTask(task: TaskRecord): string {
  const platform = (task.payload as { platform?: unknown } | undefined)?.platform
  return typeof platform === 'string' && platform ? platform : 'wechat'
}

/**
 * 抛出错误的兜底三分类（适配器与开页会话的防御路径）：
 * NETWORK/TIMEOUT→瞬态；NO_CONFIG/NOT_LOGGED_IN→凭证；其余→永久（如实上报，绝不猜测成可重试）。
 */
export function publishOutcomeFromError(err: unknown): PublishFailureOutcome {
  const code = (err as { code?: unknown } | null | undefined)?.code
  const message = err instanceof Error ? err.message : String(err)
  if (code === 'NETWORK' || code === 'TIMEOUT')
    return { ok: false, category: 'transient', code: String(code), detail: message }
  if (code === 'NO_CONFIG' || code === 'NOT_LOGGED_IN')
    return { ok: false, category: 'credential', code: String(code), detail: message }
  return {
    ok: false,
    category: 'permanent',
    ...(typeof code === 'string' && code ? { code } : {}),
    detail: message,
  }
}

function resolveMinIntervalMs(): number {
  const raw = process.env[PUBLISH_MIN_INTERVAL_ENV]
  if (raw === undefined || raw === '') return DEFAULT_PUBLISH_MIN_INTERVAL_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_PUBLISH_MIN_INTERVAL_MS
}

export class PublishService {
  private readonly adapters = new Map<string, PublishAdapter>()
  private chain: Promise<unknown> = Promise.resolve()
  /** 上一次平台动作（含重试）的开始时刻；null 表示尚未执行过任何动作（首次不等待）。 */
  private lastRunAt: number | null = null
  private readonly openSession: (platform: string) => Promise<unknown>
  private readonly minIntervalMs: number
  private readonly maxTransientAttempts: number
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(deps: PublishServiceDeps) {
    this.openSession = deps.openSession
    this.minIntervalMs = deps.minIntervalMs ?? resolveMinIntervalMs()
    this.maxTransientAttempts = deps.maxTransientAttempts ?? DEFAULT_MAX_TRANSIENT_ATTEMPTS
    this.now = deps.now ?? Date.now
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  register(adapter: PublishAdapter): void {
    this.adapters.set(adapter.platform, adapter)
  }

  adapter(platform: string): PublishAdapter | undefined {
    return this.adapters.get(platform)
  }

  /** 任务系统集成：kind 'publish' / executor 'main' 的统一执行入口。 */
  createExecutor(): MainExecutor {
    return async (task, ctx) => {
      const platform = platformOfTask(task)
      const adapter = this.adapters.get(platform)
      if (!adapter) {
        return {
          state: 'failed',
          detail: `发布任务暂不支持平台「${platform}」。`,
          result: { category: 'permanent' as const, code: 'PUBLISH_PLATFORM_UNSUPPORTED' },
        }
      }
      const outcome = await this.enqueue(adapter, task, { progress: ctx.progress, signal: ctx.signal })
      if (outcome.ok) {
        return {
          state: 'complete',
          detail: outcome.detail,
          ...(outcome.result !== undefined ? { result: outcome.result } : {}),
        }
      }
      return {
        state: 'failed',
        detail:
          outcome.category === 'transient'
            ? `${outcome.detail}（网络问题已自动重试 ${this.maxTransientAttempts - 1} 次仍失败，请稍后在任务中心重试。）`
            : outcome.detail,
        result: {
          category: outcome.category,
          ...(outcome.code ? { code: outcome.code } : {}),
        },
      }
    }
  }

  /** 全局串行互斥链＋相邻最小间隔（spec P4：平台间限速串行执行）。 */
  private enqueue(
    adapter: PublishAdapter,
    task: TaskRecord,
    ctx: PublishRunContext,
  ): Promise<PublishRunOutcome> {
    const next = this.chain.then(async () => {
      const wait = this.lastRunAt === null ? 0 : this.lastRunAt + this.minIntervalMs - this.now()
      if (wait > 0) {
        ctx.progress(`按平台限速排队等待 ${Math.ceil(wait / 1000)} 秒…`)
        await this.sleep(wait)
      }
      return this.attempt(adapter, task, ctx)
    })
    // 链不断：单任务失败不影响其他平台/任务。
    this.chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  /** 单任务执行（含瞬态自动重试）：每次尝试（含重试）都更新 lastRunAt，重试间隔同样遵守限速。 */
  private async attempt(
    adapter: PublishAdapter,
    task: TaskRecord,
    ctx: PublishRunContext,
  ): Promise<PublishRunOutcome> {
    for (let tried = 1; ; tried += 1) {
      if (ctx.signal.aborted)
        return { ok: false, category: 'permanent', code: 'ABORTED', detail: '已停止；本次未完成平台动作。' }
      this.lastRunAt = this.now()
      let session: unknown = null
      if (adapter.usesSession) {
        try {
          ctx.progress('正在打开平台页…')
          session = await this.openSession(adapter.platform)
        } catch (err) {
          const outcome = publishOutcomeFromError(err)
          if (outcome.category === 'transient' && tried < this.maxTransientAttempts) {
            await this.waitToRetry(ctx, tried, outcome.detail)
            continue
          }
          return outcome
        }
      }
      if (ctx.signal.aborted)
        return { ok: false, category: 'permanent', code: 'ABORTED', detail: '已停止；本次未完成平台动作。' }
      let outcome: PublishRunOutcome
      try {
        outcome = await adapter.run({ task, session }, ctx)
      } catch (err) {
        outcome = publishOutcomeFromError(err)
      }
      if (outcome.ok) return outcome
      if (outcome.category === 'transient' && tried < this.maxTransientAttempts) {
        await this.waitToRetry(ctx, tried, outcome.detail)
        continue
      }
      return outcome
    }
  }

  private async waitToRetry(ctx: PublishRunContext, tried: number, reason: string): Promise<void> {
    ctx.progress(`网络波动（${reason}），按平台限速等待后自动重试（第 ${tried + 1} 次）…`)
    await this.sleep(this.minIntervalMs)
  }
}

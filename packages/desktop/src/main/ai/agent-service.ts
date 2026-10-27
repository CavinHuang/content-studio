import { randomBytes } from 'node:crypto'
import type { AiEvent, AiSendResult } from '../../shared/desktop'
import type { AskUserFn, CollectFn } from './domain-tools'

export type PiEventLike = { type: string } & Record<string, unknown>

export interface SessionLike {
  subscribe(listener: (ev: PiEventLike) => void): () => void
  prompt(text: string): Promise<void>
  abort(): Promise<void>
  waitForIdle(): Promise<void>
  dispose(): void
}
export type CreateSessionFn = (sessionKey: string, askUser: AskUserFn) => Promise<SessionLike>

export interface AgentServiceDeps {
  createSession: CreateSessionFn
  emit: (ev: AiEvent) => void
  hasModelConfig: () => boolean
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
function codeOf(err: unknown): string {
  const code = (err as { code?: unknown })?.code
  return typeof code === 'string' && code ? code : 'AGENT_ERROR'
}
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}

type CollectedItem =
  | { kind: 'suggestion'; payload: { platform: string; original: string; replacement: string; note?: string } }
  | { kind: 'draft'; payload: { title: string; body: string; note?: string } }

/**
 * 全局并发上限 = 1（M2 实证教训：忙检查与占用必须在 await（pi 冷加载数秒）之前同步置位，
 * 否则窗口内二次 send 绕过并发上限、对同一会话键双建会话）。
 * AI 产出经领域工具写入产出缓冲，随事件转发渲染端——服务本身不触碰工作区状态。
 */
export class AgentService {
  static readonly MAX_ACTIVE_RUNS = 1
  private readonly sessions = new Map<string, SessionLike>()
  private activeRun: { sessionKey: string; runId: string } | null = null
  private readonly asks = new Map<string, (answer: string) => void>()
  private readonly collected = new Map<string, CollectedItem[]>()

  constructor(private readonly deps: AgentServiceDeps) {}

  /** 领域工具 collect 回调：与当前 run 关联（工具只在 run 的 prompt 期间执行）。 */
  readonly collect: CollectFn = (item) => {
    const runId = this.activeRun?.runId
    if (!runId) return
    const list = this.collected.get(runId) ?? []
    list.push(item)
    this.collected.set(runId, list)
  }

  async send(sessionKey: string, text: string): Promise<AiSendResult> {
    if (!text.trim()) return { ok: false, code: 'EMPTY_INPUT', message: '指令为空。' }
    if (this.activeRun) return { ok: false, code: 'AGENT_BUSY', message: '已有对话在运行，请等待完成或先取消。' }
    if (!this.deps.hasModelConfig()) return { ok: false, code: 'NO_MODEL_CONFIG', message: '尚未配置模型，请先在「设置 → AI 服务」中配置。' }
    const runId = `r_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
    this.activeRun = { sessionKey, runId }
    let session: SessionLike
    try {
      session = await this.ensureSession(sessionKey)
    } catch (err) {
      this.activeRun = null // 建会话失败：释放占位，服务不永久 busy
      return { ok: false, code: codeOf(err), message: messageOf(err) }
    }
    this.deps.emit({ type: 'run_start', sessionKey, runId })
    void this.runPrompt(session, sessionKey, runId, text)
    return { ok: true, runId }
  }

  private async runPrompt(session: SessionLike, sessionKey: string, runId: string, text: string): Promise<void> {
    try {
      await session.prompt(text)
      await session.waitForIdle()
      this.flushCollected(sessionKey, runId)
      this.deps.emit({ type: 'run_end', sessionKey, runId, ok: true })
    } catch (err) {
      this.flushCollected(sessionKey, runId)
      this.deps.emit({ type: 'run_end', sessionKey, runId, ok: false, error: messageOf(err) })
    } finally {
      this.activeRun = null
      this.settleAsks('（任务已取消。）')
    }
  }

  /** run 结束时把产出缓冲转为事件（渲染端据此生成待采用的建议/候选）。 */
  private flushCollected(sessionKey: string, runId: string): void {
    const items = this.collected.get(runId) ?? []
    this.collected.delete(runId)
    for (const item of items) {
      if (item.kind === 'suggestion') this.deps.emit({ type: 'suggestion', sessionKey, runId, suggestion: item.payload })
      else this.deps.emit({ type: 'draft', sessionKey, runId, draft: item.payload })
    }
  }

  async cancel(sessionKey: string): Promise<void> {
    this.settleAsks('（任务已取消。）')
    const session = this.sessions.get(sessionKey)
    if (session) await session.abort()
  }

  answer(questionId: string, answer: string): void {
    const resolve = this.asks.get(questionId)
    if (resolve) {
      this.asks.delete(questionId)
      resolve(answer)
    }
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) session.dispose()
    this.sessions.clear()
    this.settleAsks('（应用退出。）')
  }

  private async ensureSession(sessionKey: string): Promise<SessionLike> {
    const cached = this.sessions.get(sessionKey)
    if (cached) return cached
    const askUser: AskUserFn = (question, options) =>
      new Promise<string>((resolve) => {
        const questionId = `q_${randomBytes(4).toString('hex')}`
        this.asks.set(questionId, resolve)
        this.deps.emit({
          type: 'ask',
          sessionKey,
          runId: this.activeRun?.runId ?? '',
          questionId,
          question,
          options,
        })
      })
    const session = await this.deps.createSession(sessionKey, askUser)
    this.wireEvents(session, sessionKey)
    this.sessions.set(sessionKey, session)
    return session
  }

  private wireEvents(session: SessionLike, sessionKey: string): void {
    session.subscribe((ev) => {
      const runId = this.activeRun?.sessionKey === sessionKey ? this.activeRun.runId : null
      if (!runId) return
      if (ev.type === 'message_update') {
        const ame = ev.assistantMessageEvent as { type?: string; delta?: string } | undefined
        if (ame?.type === 'text_delta' && ame.delta) this.deps.emit({ type: 'delta', sessionKey, runId, text: ame.delta })
        return
      }
      if (ev.type === 'tool_execution_start') {
        this.deps.emit({ type: 'tool_start', sessionKey, runId, tool: String(ev.toolName) })
        return
      }
      if (ev.type === 'tool_execution_end') {
        this.deps.emit({
          type: 'tool_end',
          sessionKey,
          runId,
          tool: String(ev.toolName),
          isError: Boolean(ev.isError),
        })
      }
    })
  }

  private settleAsks(fallback: string): void {
    for (const resolve of this.asks.values()) resolve(fallback)
    this.asks.clear()
  }
}

import { randomBytes } from 'node:crypto';
import type { AgentEventOut, AgentSendResult, AgentErrorCode } from '../../shared/types';
import type { AskUserFn } from './domain-tools';

export type PiEventLike = { type: string } & Record<string, unknown>;

export interface SessionLike {
  subscribe(listener: (ev: PiEventLike) => void): () => void;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  waitForIdle(): Promise<void>;
  dispose(): void;
}
export type CreateSessionFn = (contentId: string, askUser: AskUserFn) => Promise<SessionLike>;

export interface AgentServiceDeps {
  createSession: CreateSessionFn;
  emit: (ev: AgentEventOut) => void;
  hasModelConfig: () => boolean;
}

function msg(err: unknown): string { return err instanceof Error ? err.message : String(err); }
function codeOf(err: unknown): AgentErrorCode {
  const c = (err as { code?: unknown })?.code;
  return (typeof c === 'string' && c ? c : 'AGENT_ERROR') as AgentErrorCode;
}
function safeJson(v: unknown): string { try { return JSON.stringify(v) ?? ''; } catch { return String(v); } }
function firstText(v: unknown): string {
  const c = (v as { content?: Array<{ type?: string; text?: string }> } | undefined)?.content;
  const t = Array.isArray(c) ? c.find((x) => x?.type === 'text')?.text : undefined;
  return t ? t.slice(0, 120) : '';
}

export class AgentService {
  /** 全局并发上限=1（spec §5 前身项目实证教训）。 */
  static readonly MAX_ACTIVE_RUNS = 1;
  private readonly sessions = new Map<string, SessionLike>();
  private activeRun: { contentId: string; runId: string } | null = null;
  private readonly asks = new Map<string, (answer: string) => void>();

  constructor(private readonly deps: AgentServiceDeps) {}

  async send(contentId: string, text: string): Promise<AgentSendResult> {
    if (!text.trim()) return { ok: false, code: 'EMPTY_INPUT', message: '指令为空' };
    if (this.activeRun) return { ok: false, code: 'AGENT_BUSY', message: '已有任务在运行，请等待完成或先取消' };
    if (!this.deps.hasModelConfig()) return { ok: false, code: 'NO_MODEL_CONFIG', message: '尚未配置模型，请先在「AI 设置」中配置' };
    // 忙检查与占用必须原子：在 await ensureSession（pi 冷加载数秒）之前同步置位，
    // 否则窗口内二次 send 绕过并发上限、对同一 contentId 双建会话（spec §5 铁律）。
    const runId = `r_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`;
    this.activeRun = { contentId, runId };
    let session: SessionLike;
    try { session = await this.ensureSession(contentId); }
    catch (err) {
      this.activeRun = null; // 建会话失败：释放占位，服务不永久 busy
      return { ok: false, code: codeOf(err), message: msg(err) };
    }
    this.deps.emit({ kind: 'run_start', contentId, runId });
    void this.runPrompt(session, contentId, runId, text);
    return { ok: true, runId };
  }

  private async runPrompt(session: SessionLike, contentId: string, runId: string, text: string): Promise<void> {
    try {
      await session.prompt(text);
      await session.waitForIdle();
      this.deps.emit({ kind: 'run_end', contentId, runId, ok: true });
    } catch (err) {
      this.deps.emit({ kind: 'run_end', contentId, runId, ok: false, error: msg(err) });
    } finally {
      this.activeRun = null;
      this.settleAsks('（任务已取消）'); // 未决问询不悬空（TDZ/悬垂教训：finally 里统一收口）
    }
  }

  async cancel(contentId: string): Promise<void> {
    this.settleAsks('（任务已取消）');
    const session = this.sessions.get(contentId);
    if (session) await session.abort();
  }

  answer(contentId: string, questionId: string, answer: string): void {
    void contentId; // questionId 全局唯一即可；contentId 留作日志/校验扩展
    const resolve = this.asks.get(questionId);
    if (resolve) { this.asks.delete(questionId); resolve(answer); }
  }

  disposeAll(): void {
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
    this.settleAsks('（应用退出）');
  }

  private async ensureSession(contentId: string): Promise<SessionLike> {
    const cached = this.sessions.get(contentId);
    if (cached) return cached;
    const askUser: AskUserFn = (question, options) => new Promise<string>((resolve) => {
      const questionId = `q_${randomBytes(4).toString('hex')}`;
      this.asks.set(questionId, resolve);
      this.deps.emit({
        kind: 'ask', contentId,
        runId: this.activeRun?.runId ?? '',
        questionId, question, options,
      });
    });
    const session = await this.deps.createSession(contentId, askUser);
    this.wireEvents(session, contentId);
    this.sessions.set(contentId, session);
    return session;
  }

  private wireEvents(session: SessionLike, contentId: string): void {
    session.subscribe((ev) => {
      const runId = this.activeRun?.contentId === contentId ? this.activeRun.runId : null;
      if (!runId) return;
      if (ev.type === 'message_update') {
        const ame = ev.assistantMessageEvent as { type?: string; delta?: string } | undefined;
        if (ame?.type === 'text_delta' && ame.delta) this.deps.emit({ kind: 'delta', contentId, runId, text: ame.delta });
        return;
      }
      if (ev.type === 'tool_execution_start') {
        this.deps.emit({ kind: 'tool_start', contentId, runId, tool: String(ev.toolName), args: safeJson(ev.args) });
        return;
      }
      if (ev.type === 'tool_execution_end') {
        const tool = String(ev.toolName);
        this.deps.emit({ kind: 'tool_end', contentId, runId, tool, isError: Boolean(ev.isError), summary: firstText(ev.result) });
        if (tool === 'write_draft' || tool === 'save_variant') this.deps.emit({ kind: 'drafts_changed', contentId });
      }
    });
  }

  private settleAsks(fallback: string): void {
    for (const resolve of this.asks.values()) resolve(fallback);
    this.asks.clear();
  }
}

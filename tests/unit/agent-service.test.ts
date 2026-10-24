import { describe, it, expect, vi } from 'vitest';
import type { AgentEventOut } from '../../src/shared/types';
import { AgentService, type SessionLike, type PiEventLike, type CreateSessionFn } from '../../src/main/agent/agent-service';
import type { AskUserFn } from '../../src/main/agent/domain-tools';

class FakeSession implements SessionLike {
  listeners = new Set<(ev: PiEventLike) => void>();
  prompts: string[] = [];
  promptImpl: (text: string, self: FakeSession) => Promise<void> = async () => {};
  abort = vi.fn(async () => {});
  waitForIdle = async () => {};
  dispose = vi.fn();
  async prompt(text: string) { this.prompts.push(text); await this.promptImpl(text, this); }
  emit(ev: PiEventLike) { for (const l of this.listeners) l(ev); }
  subscribe(l: (ev: PiEventLike) => void) { this.listeners.add(l); return () => { this.listeners.delete(l); }; }
}

function harness(onSession?: (s: FakeSession) => void) {
  const events: AgentEventOut[] = [];
  const asks: AskUserFn[] = [];
  const sessions: FakeSession[] = [];
  const createSession: CreateSessionFn = async (_id, askUser) => {
    asks.push(askUser);
    const s = new FakeSession();
    onSession?.(s); // 在返回给 service 之前注入行为（prompt 尚未被调用，无竞态）
    sessions.push(s);
    return s;
  };
  const svc = new AgentService({ createSession, emit: (e) => events.push(e), hasModelConfig: () => true });
  return { svc, events, asks, sessions, createSession };
}
const waitFor = (p: () => boolean) => new Promise<void>((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => (p() ? resolve() : Date.now() - t0 > 2000 ? reject(new Error('等待超时')) : setTimeout(tick, 10));
  tick();
});

describe('AgentService', () => {
  it('send 走 run_start→delta→run_end(ok)，prompt 文本透传', async () => {
    const h = harness((s) => {
      s.promptImpl = async (_t, self) => {
        self.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '初稿好了' } });
      };
    });
    const r = await h.svc.send('c1', '/skill:longform-draft 写一篇');
    expect(r.ok).toBe(true);
    await waitFor(() => h.events.some((e) => e.kind === 'run_end'));
    expect(h.events.map((e) => e.kind)).toEqual(['run_start', 'delta', 'run_end']);
    expect(h.events[1]).toMatchObject({ kind: 'delta', text: '初稿好了', contentId: 'c1' });
    expect(h.events[2]).toMatchObject({ kind: 'run_end', ok: true });
    expect(h.sessions[0]!.prompts).toEqual(['/skill:longform-draft 写一篇']);
  });
  it('运行中 send 返回 AGENT_BUSY；结束后同内容复用会话（createSession 仅一次）', async () => {
    let release!: () => void;
    let hang = true;
    const h = harness((s) => {
      s.promptImpl = () => (hang
        ? new Promise<void>((r) => { release = r; hang = false; })
        : Promise.resolve());
    });
    expect((await h.svc.send('c1', '占用')).ok).toBe(true);
    await waitFor(() => h.events.some((e) => e.kind === 'run_start'));
    expect(await h.svc.send('c1', '第二条')).toMatchObject({ ok: false, code: 'AGENT_BUSY' });
    expect(await h.svc.send('c2', '别的内容')).toMatchObject({ ok: false, code: 'AGENT_BUSY' });
    release();
    await waitFor(() => h.events.some((e) => e.kind === 'run_end'));
    expect((await h.svc.send('c1', '复用')).ok).toBe(true);
    await waitFor(() => h.events.filter((e) => e.kind === 'run_end').length === 2);
    expect(h.sessions).toHaveLength(1); // c1 始终同一个 FakeSession
  });
  it('未配模型返回 NO_MODEL_CONFIG；空指令 EMPTY_INPUT；prompt 抛错→run_end(ok:false)', async () => {
    const h = harness();
    const svc2 = new AgentService({ createSession: h.createSession, emit: () => {}, hasModelConfig: () => false });
    expect(await svc2.send('c1', 'x')).toMatchObject({ ok: false, code: 'NO_MODEL_CONFIG' });
    expect(await h.svc.send('c1', '   ')).toMatchObject({ ok: false, code: 'EMPTY_INPUT' });
    const h2 = harness((s) => { s.promptImpl = async () => { throw new Error('模型超时'); }; });
    await h2.svc.send('c1', 'x');
    await waitFor(() => h2.events.some((e) => e.kind === 'run_end' && e.ok === false));
    expect(h2.events.find((e) => e.kind === 'run_end')).toMatchObject({ ok: false, error: '模型超时' });
  });
  it('ask_user：ask 事件外发，answer 唤醒回调；cancel 落 settles 文案并 abort', async () => {
    // asks 仅在 createSession（send→ensureSession 触发）时填充，必须先 send 建立会话。
    // promptImpl 挂起（同上例 release 模式）：run 不收尾，finally 的 settleAsks 才不会
    // 抢在 answer 之前把未决 ask 落成「（任务已取消）」；断言链完成后 releasePrompt 放行收尾。
    let releasePrompt!: () => void;
    const h = harness((s) => { s.promptImpl = () => new Promise<void>((r) => { releasePrompt = r; }); });
    await h.svc.send('c1', 'x');
    const askFn = h.asks[0]!;
    let settleAsk!: (v: string) => void;
    const asked = new Promise<string>((r) => (settleAsk = r));
    void askFn('目标读者是谁？', ['技术读者', '普通读者']).then(settleAsk);
    await waitFor(() => h.events.some((e) => e.kind === 'ask'));
    const askEv = h.events.find((e) => e.kind === 'ask') as Extract<AgentEventOut, { kind: 'ask' }>;
    expect(askEv).toMatchObject({ question: '目标读者是谁？', options: ['技术读者', '普通读者'] });
    h.svc.answer('c1', askEv.questionId, '技术读者');
    expect(await asked).toBe('技术读者');
    // cancel：新的未决 ask 被落 settles，会话被 abort
    const asked2 = askFn('再问一个？', undefined);
    await h.svc.cancel('c1');
    await expect(asked2).resolves.toContain('取消');
    expect(h.sessions[0]!.abort).toHaveBeenCalled();
    releasePrompt(); // 放行挂起的 prompt，run 才能发出 run_end
    await waitFor(() => h.events.some((e) => e.kind === 'run_end'));
  });
  it('write_draft 的 tool_end 触发 drafts_changed；tool_start/tool_end 透传', async () => {
    const h = harness((s) => {
      s.promptImpl = async (_t, self) => {
        self.emit({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'write_draft', args: { id: 'c1' } });
        self.emit({ type: 'tool_execution_end', toolCallId: 't1', toolName: 'write_draft', result: { content: [{ type: 'text', text: '草稿已保存：draft-x.md' }] }, isError: false });
      };
    });
    await h.svc.send('c1', '写');
    await waitFor(() => h.events.some((e) => e.kind === 'drafts_changed'));
    expect(h.events.find((e) => e.kind === 'tool_start')).toMatchObject({ tool: 'write_draft' });
    expect(h.events.find((e) => e.kind === 'tool_end')).toMatchObject({ tool: 'write_draft', summary: '草稿已保存：draft-x.md' });
  });
});

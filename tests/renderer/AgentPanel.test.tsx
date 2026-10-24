import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentPanel } from '../../src/renderer/components/AgentPanel';
import type { AgentSendResult, DraftSummary } from '../../src/shared/types';

const mocks = vi.hoisted(() => {
  const state: { onEvent: ((ev: never) => void) | null } = { onEvent: null };
  return {
    state,
    send: vi.fn(async (): Promise<AgentSendResult> => ({ ok: true, runId: 'r1' })),
    cancel: vi.fn(async () => ({ ok: true as const })),
    answer: vi.fn(async () => ({ ok: true as const })),
    listDrafts: vi.fn(async () => [] as DraftSummary[]),
    applyDraft: vi.fn(async () => ({ ok: true as const, savedAt: 't' })),
    discardDraft: vi.fn(async () => ({ ok: true as const })),
    getModelConfig: vi.fn(async () => ({ model: null })),
    setModelConfig: vi.fn(async () => ({ ok: true as const })),
  };
});
vi.mock('../../src/renderer/lib/agent-bridge', () => ({
  agentBridge: {
    ping: async () => ({ version: 'test' }),
    send: mocks.send, cancel: mocks.cancel, answer: mocks.answer,
    listDrafts: mocks.listDrafts, applyDraft: mocks.applyDraft, discardDraft: mocks.discardDraft,
    getModelConfig: mocks.getModelConfig, setModelConfig: mocks.setModelConfig,
    onEvent: (cb: (ev: never) => void) => { mocks.state.onEvent = cb; return () => { mocks.state.onEvent = null; }; },
  },
}));
const emit = (ev: unknown) => mocks.state.onEvent?.(ev as never);
const draft: DraftSummary = { name: 'draft-20261024-120000-ab12.md', created: '2026-10-24T12:00:00.000Z', note: '长文初稿', bytes: 100 };

beforeEach(() => { vi.clearAllMocks(); mocks.state.onEvent = null; mocks.listDrafts.mockResolvedValue([]); });

describe('AgentPanel', () => {
  it('技能按钮预填 /skill: 前缀，发送调用 send 并进入运行态', async () => {
    render(<AgentPanel contentId="c_1" onApplied={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '长文初稿' }));
    const input = screen.getByLabelText('AI 指令输入') as HTMLTextAreaElement;
    expect(input.value.startsWith('/skill:longform-draft')).toBe(true);
    fireEvent.change(input, { target: { value: '/skill:longform-draft 写一篇关于测试的文章' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(mocks.send).toHaveBeenCalledWith('c_1', '/skill:longform-draft 写一篇关于测试的文章'));
    emit({ kind: 'run_start', contentId: 'c_1', runId: 'r1' });
    await waitFor(() => expect(screen.getByRole('button', { name: '取消任务' })).toBeInTheDocument());
    emit({ kind: 'delta', contentId: 'c_1', runId: 'r1', text: '初稿完成' });
    emit({ kind: 'run_end', contentId: 'c_1', runId: 'r1', ok: true });
    await waitFor(() => expect(screen.queryByRole('button', { name: '取消任务' })).not.toBeInTheDocument());
    expect(screen.getByLabelText('AI 对话记录')).toHaveTextContent('初稿完成');
  });
  it('AGENTS_BUSY 拒绝时显示告警文案', async () => {
    mocks.send.mockResolvedValueOnce({ ok: false as const, code: 'AGENT_BUSY' as const, message: '已有任务在运行，请等待完成或先取消' });
    render(<AgentPanel contentId="c_1" onApplied={() => {}} />);
    fireEvent.change(screen.getByLabelText('AI 指令输入'), { target: { value: '再来一次' } });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('已有任务在运行'));
  });
  it('ask 事件弹问询框；点选项调用 answer 并关闭', async () => {
    render(<AgentPanel contentId="c_1" onApplied={() => {}} />);
    emit({ kind: 'ask', contentId: 'c_1', runId: 'r1', questionId: 'q1', question: '目标读者是谁？', options: ['技术读者', '普通读者'] });
    const dlg = await screen.findByRole('dialog', { name: 'AI 问询' });
    expect(dlg).toHaveTextContent('目标读者是谁？');
    fireEvent.click(screen.getByRole('button', { name: '技术读者' }));
    await waitFor(() => expect(mocks.answer).toHaveBeenCalledWith('c_1', 'q1', '技术读者'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'AI 问询' })).not.toBeInTheDocument());
  });
  it('草稿列表渲染，采纳入正文调用 applyDraft 并触发 onApplied', async () => {
    mocks.listDrafts.mockResolvedValue([draft]);
    const onApplied = vi.fn();
    render(<AgentPanel contentId="c_1" onApplied={onApplied} />);
    const list = await screen.findByRole('list', { name: '草稿区' });
    expect(list).toHaveTextContent('长文初稿');
    fireEvent.click(screen.getByRole('button', { name: `采纳入正文 ${draft.name}` }));
    await waitFor(() => expect(mocks.applyDraft).toHaveBeenCalledWith('c_1', draft.name));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
  });
  it('write_draft 完成后刷新草稿列表', async () => {
    mocks.listDrafts.mockResolvedValue([]);
    render(<AgentPanel contentId="c_1" onApplied={() => {}} />);
    emit({ kind: 'tool_end', contentId: 'c_1', runId: 'r1', tool: 'write_draft', isError: false, summary: '草稿已保存' });
    await waitFor(() => expect(mocks.listDrafts).toHaveBeenCalledTimes(2)); // 挂载 1 次 + 事件 1 次
  });
  it('变体草稿（带 platform）不进 AI 助手草稿区——唯一采纳路径是变体工作台', async () => {
    mocks.listDrafts.mockResolvedValue([
      { ...draft, name: 'draft-20261024-130000-cd34.md', note: '变体:xiaohongshu', platform: 'xiaohongshu' },
    ]);
    render(<AgentPanel contentId="c_1" onApplied={() => {}} />);
    await screen.findByRole('list', { name: '草稿区' });
    expect(screen.queryByRole('button', { name: /采纳入正文/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/变体:xiaohongshu/)).not.toBeInTheDocument();
  });
});

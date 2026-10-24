import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Editor } from '../../src/renderer/pages/Editor';

const mocks = vi.hoisted(() => ({
  read: vi.fn(async () => ({
    id: 'c_20261024_aaaa', title: '测试文', stage: 'draft', tags: [], created: '2026-10-24',
    media: 'article' as const, folder: 'f', body: '# 初始正文',
  })),
  save: vi.fn(async () => ({ savedAt: '2026-10-24T00:00:00Z' })),
  update: vi.fn(async (id: string, p: { title?: string }) => ({ id, title: p.title ?? 'x', stage: 'draft', tags: [], created: '2026-10-24', media: 'article' as const, folder: 'f' })),
}));
vi.mock('../../src/renderer/lib/bridge', () => ({ bridge: { readContent: mocks.read, saveBody: mocks.save, updateMeta: mocks.update } }));
// shouldAdvanceTime：让 testing-library waitFor 的轮询 setInterval 仍随真实时间推进，
// 否则 fake timers 下 waitFor 永不触发、findBy* 挂起（@testing-library/dom 只识别 jest 计时器）。
vi.useFakeTimers({ shouldAdvanceTime: true });

describe('Editor', () => {
  it('载入内容正文与标题', async () => {
    render(<Editor id="c_20261024_aaaa" onBack={() => {}} />);
    expect(await screen.findByDisplayValue('测试文')).toBeInTheDocument();
  });
  it('正文变更 800ms 防抖后调用 saveBody，指示器变已保存', async () => {
    render(<Editor id="c_20261024_aaaa" onBack={() => {}} />);
    const ta = await screen.findByRole('textbox', { name: '正文编辑区' });
    fireEvent.change(ta, { target: { value: '# 新内容' } });
    expect(mocks.save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(900);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('c_20261024_aaaa', '# 新内容'));
  });
  it('标题 blur 更新标题但不销毁重建 CodeMirror 视图（未保存正文编辑不丢失）', async () => {
    render(<Editor id="c_20261024_aaaa" onBack={() => {}} />);
    await screen.findByDisplayValue('测试文');
    const host = document.querySelector('.cm-host');
    expect(host).not.toBeNull();
    // 等待 CodeMirror 视图挂载（不依赖 effect flush 时机）
    await waitFor(() => expect(host!.querySelector('.cm-editor')).not.toBeNull());
    const viewEl = host!.querySelector('.cm-editor');
    const title = screen.getByLabelText('内容标题');
    fireEvent.change(title, { target: { value: '改名文' } });
    fireEvent.blur(title);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('c_20261024_aaaa', { title: '改名文' }));
    // 留出重渲染与 effect flush 的时机，再断言视图节点身份
    await act(async () => { await new Promise((r) => { setTimeout(r, 50); }); });
    // 同一 DOM 节点仍在：视图未被 cleanup 销毁后以旧正文重建
    expect(host!.querySelector('.cm-editor')).toBe(viewEl);
  });
});

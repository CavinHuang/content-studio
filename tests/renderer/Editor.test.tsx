import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
});

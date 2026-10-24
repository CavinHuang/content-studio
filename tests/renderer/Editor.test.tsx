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

// 回退 textarea 带 aria-hidden（读屏树只保留 CodeMirror 主编辑框）。
// ByRole+name 对 aria-hidden 元素算不出可访问名（dom-accessibility-api 对
// 隐藏元素返回空名），测试改走 getByLabelText 的 label 关联路径寻址它驱动输入。
const fallbackBox = () => screen.getByLabelText('正文编辑区（回退）');

describe('Editor', () => {
  it('载入内容正文与标题', async () => {
    render(<Editor id="c_20261024_aaaa" onBack={() => {}} />);
    expect(await screen.findByDisplayValue('测试文')).toBeInTheDocument();
  });
  it('正文变更 800ms 防抖后调用 saveBody，指示器 role=status 变「已保存」', async () => {
    render(<Editor id="c_20261024_aaaa" onBack={() => {}} />);
    fireEvent.change(await screen.findByLabelText('正文编辑区（回退）'), { target: { value: '# 新内容' } });
    expect(mocks.save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(900);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('c_20261024_aaaa', '# 新内容'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已保存'));
  });
  it('返回看板时未满防抖间隔立即 flush 保存', async () => {
    mocks.save.mockClear();
    render(<Editor id="c_20261024_aaaa" onBack={() => {}} />);
    fireEvent.change(await screen.findByLabelText('正文编辑区（回退）'), { target: { value: '# 返回即存' } });
    vi.advanceTimersByTime(100); // 未到 800ms
    fireEvent.click(screen.getByRole('button', { name: '← 返回看板' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('c_20261024_aaaa', '# 返回即存'));
  });
  it('卸载时清理防抖计时器，离开页面后不再触发保存', async () => {
    mocks.save.mockClear();
    const { unmount } = render(<Editor id="c_20261024_aaaa" onBack={() => {}} />);
    fireEvent.change(await screen.findByLabelText('正文编辑区（回退）'), { target: { value: '# 不应保存' } });
    unmount();
    vi.advanceTimersByTime(2000);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('保存失败时指示器变「保存失败」，点重试成功后变「已保存」', async () => {
    mocks.save.mockReset();
    mocks.save.mockRejectedValueOnce(new Error('disk boom')).mockResolvedValue({ savedAt: '2026-10-24T00:00:00Z' });
    render(<Editor id="c_20261024_aaaa" onBack={() => {}} />);
    fireEvent.change(await screen.findByLabelText('正文编辑区（回退）'), { target: { value: '# 失败路径' } });
    vi.advanceTimersByTime(900);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('保存失败'));
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('已保存'));
    expect(screen.queryByRole('button', { name: '重试保存' })).not.toBeInTheDocument();
  });
  it('读屏树只暴露一个「正文编辑区」textbox：主编辑框具名、回退框 aria-hidden 仅测试可寻址', async () => {
    render(<Editor id="c_20261024_aaaa" onBack={() => {}} />);
    await screen.findByDisplayValue('测试文');
    await waitFor(() => expect(document.querySelector('.cm-editor')).not.toBeNull());
    // CodeMirror 主编辑框：非隐藏查询可见且唯一
    expect(screen.getAllByRole('textbox', { name: '正文编辑区' })).toHaveLength(1);
    // 回退框：读屏（默认 role 查询）路径不可见，仅 label 关联路径可寻址
    expect(screen.queryByRole('textbox', { name: '正文编辑区（回退）' })).not.toBeInTheDocument();
    expect(fallbackBox()).toBeInTheDocument();
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

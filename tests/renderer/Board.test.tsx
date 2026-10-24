import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Board } from '../../src/renderer/pages/Board';
import type { ContentMeta } from '../../src/shared/types';

const items: ContentMeta[] = [
  { id: 'c_20261024_aaaa', title: '甲文章', stage: 'idea', tags: [], created: '2026-10-24', media: 'article', folder: 'f1' },
  { id: 'c_20261024_bbbb', title: '乙文章', stage: 'draft', tags: [], created: '2026-10-23', media: 'article', folder: 'f2' },
];
const mocks = vi.hoisted(() => ({
  list: vi.fn(async () => ({ items, warnings: [] })),
  create: vi.fn(async (input: { title: string }) => items[0]!),
  update: vi.fn(async (id: string, p: { stage?: string }) => ({ ...items[0]!, ...p })),
}));
vi.mock('../../src/renderer/lib/bridge', () => ({ bridge: {
  listContents: mocks.list, createContent: mocks.create, updateMeta: mocks.update,
} }));

beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue({ items, warnings: [] }); });

describe('Board', () => {
  it('按 stage 分列渲染七列，卡片落位正确', async () => {
    render(<Board onOpen={() => {}} />);
    expect(await screen.findByText('甲文章')).toBeInTheDocument();
    expect(screen.getByText('乙文章')).toBeInTheDocument();
    const ideaCol = screen.getByLabelText('阶段 idea');
    const draftCol = screen.getByLabelText('阶段 draft');
    expect(ideaCol).toContainElement(screen.getByText('甲文章'));
    expect(draftCol).toContainElement(screen.getByText('乙文章'));
  });
  it('新建弹窗提交后调用 createContent 并刷新', async () => {
    render(<Board onOpen={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '新建内容' }));
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '新文章' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith({ title: '新文章', tags: [] }));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
  });
  it('卡片移动 stage 调用 updateMeta', async () => {
    render(<Board onOpen={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: '移动 甲文章' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '移动到 draft' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith('c_20261024_aaaa', { stage: 'draft' }));
  });
});

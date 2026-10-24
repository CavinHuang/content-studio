import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { VariantsPage } from '../../src/renderer/pages/VariantsPage';
import type { ContentMeta, DraftSummary, VariantDoc } from '../../src/shared/types';

const mocks = vi.hoisted(() => ({
  listContents: vi.fn(async () => ({
    items: [{ id: 'c_1', title: '内容甲', stage: 'draft', tags: [], created: '2026-10-24', media: 'article', folder: 'f' } as ContentMeta],
    warnings: [],
  })),
  read: vi.fn(async (): Promise<VariantDoc | null> => null),
  save: vi.fn(async () => ({ ok: true as const, savedAt: 't' })),
  listDrafts: vi.fn(async () => [] as DraftSummary[]),
  applyDraft: vi.fn(async () => ({ ok: true as const, savedAt: 't' })),
}));
vi.mock('../../src/renderer/lib/bridge', () => ({ bridge: { listContents: mocks.listContents } }));
vi.mock('../../src/renderer/lib/agent-bridge', () => ({ agentBridge: { listDrafts: mocks.listDrafts, onEvent: () => () => {} } }));
vi.mock('../../src/renderer/lib/publish-bridge', () => ({
  variantBridge: { read: mocks.read, save: mocks.save, list: vi.fn(async () => []), applyDraft: mocks.applyDraft },
  publishBridge: { onEvent: () => () => {} },
}));
const draft: DraftSummary = { name: 'draft-20261024-120000-ab12.md', created: '2026-10-24T12:00:00Z', note: '变体:xiaohongshu', bytes: 10, platform: 'xiaohongshu' };

beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue(null); mocks.listDrafts.mockResolvedValue([]); });
// 四平台卡片同名字段并存（保存变体/标题输入等多实例）：一切查询 scope 在目标卡片内（within）
const xhsCard = async () => within(await screen.findByRole('region', { name: '变体 小红书' }));

describe('VariantsPage', () => {
  it('四平台卡片渲染；小红书卡实时校验：规则不过禁存，合规后可存', async () => {
    render(<VariantsPage initialContentId="c_1" onBack={() => {}} onGoPublish={() => {}} />);
    const c = await xhsCard();
    expect(screen.getByRole('region', { name: '变体 公众号文章' })).toBeInTheDocument();
    fireEvent.change(c.getByLabelText('变体标题输入'), { target: { value: '超过二十个字的标题一定超过二十个字的标题呀' } });
    fireEvent.change(c.getByLabelText('变体正文输入'), { target: { value: '短' } });
    expect(await c.findByText(/20 字上限/)).toBeInTheDocument();
    expect(c.getByRole('button', { name: '保存变体' })).toBeDisabled();
    fireEvent.change(c.getByLabelText('变体标题输入'), { target: { value: '合规标题' } });
    fireEvent.change(c.getByLabelText('变体正文输入'), { target: { value: '字'.repeat(650) } });
    await waitFor(() => expect(c.getByRole('button', { name: '保存变体' })).toBeEnabled());
  });
  it('已保存变体回显；保存调用 variantBridge.save（话题按顿号拆数组）', async () => {
    mocks.read.mockResolvedValue({ platform: 'xiaohongshu', title: '旧标题', topics: ['旧话题'], body: '旧正文' } as VariantDoc);
    render(<VariantsPage initialContentId="c_1" onBack={() => {}} onGoPublish={() => {}} />);
    const c = await xhsCard();
    await waitFor(() => expect(c.getByLabelText('变体标题输入')).toHaveValue('旧标题'));
    fireEvent.click(c.getByRole('button', { name: '保存变体' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith('c_1', 'xiaohongshu', expect.objectContaining({ title: '旧标题', topics: ['旧话题'] })));
  });
  it('AI 变体草稿按平台展示，采纳入变体调用 applyDraft', async () => {
    mocks.listDrafts.mockResolvedValue([draft]);
    render(<VariantsPage initialContentId="c_1" onBack={() => {}} onGoPublish={() => {}} />);
    const c = await xhsCard();
    fireEvent.click(await c.findByRole('button', { name: `采纳入变体 ${draft.name}` }));
    await waitFor(() => expect(mocks.applyDraft).toHaveBeenCalledWith('c_1', 'xiaohongshu', draft.name));
  });
  it('去发布按钮携带内容与平台回调', async () => {
    const go = vi.fn();
    render(<VariantsPage initialContentId="c_1" onBack={() => {}} onGoPublish={go} />);
    const c = await xhsCard();
    fireEvent.click(c.getByRole('button', { name: '去发布 小红书' }));
    expect(go).toHaveBeenCalledWith('c_1', 'xiaohongshu');
  });
});

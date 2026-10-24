import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { PublishCenter } from '../../src/renderer/pages/PublishCenter';
import type { ContentMeta, PublishTask, VariantDoc, WechatMpConfigView } from '../../src/shared/types';

const state = { onEvent: null as null | ((ev: never) => void) };
const mocks = vi.hoisted(() => ({
  listContents: vi.fn(async () => ({ items: [{ id: 'c_1', title: '内容甲', stage: 'variants', tags: [], created: '2026-10-24', media: 'article', folder: 'f' } as ContentMeta], warnings: [] })),
  read: vi.fn(async (): Promise<VariantDoc | null> => null),
  tasks: vi.fn(async () => [] as PublishTask[]),
  createTask: vi.fn(async () => ({ ok: true as const, task: { taskId: 't1', contentId: 'c_1', platform: 'xiaohongshu', phase: 'queued', updatedAt: 't' } })),
  run: vi.fn(async () => ({ ok: true as const })),
  retry: vi.fn(async () => ({ ok: true as const })),
  checkLogin: vi.fn(async () => ({ loggedIn: true })),
  showView: vi.fn(async () => ({ ok: true as const })),
  getWechatConfig: vi.fn(async (): Promise<{ config: WechatMpConfigView | null }> => ({ config: null })),
  setWechatConfig: vi.fn(async () => ({ ok: true as const })),
  onEvent: (cb: (ev: never) => void) => { state.onEvent = cb; return () => { state.onEvent = null; }; },
}));
vi.mock('../../src/renderer/lib/bridge', () => ({ bridge: { listContents: mocks.listContents } }));
vi.mock('../../src/renderer/lib/publish-bridge', () => ({
  variantBridge: { read: mocks.read, save: vi.fn(), list: vi.fn(async () => []), applyDraft: vi.fn() },
  publishBridge: {
    tasks: mocks.tasks, createTask: mocks.createTask, run: mocks.run, retry: mocks.retry,
    checkLogin: mocks.checkLogin, showView: mocks.showView,
    getWechatConfig: mocks.getWechatConfig, setWechatConfig: mocks.setWechatConfig, onEvent: mocks.onEvent,
  },
}));

beforeEach(() => { vi.clearAllMocks(); state.onEvent = null; mocks.tasks.mockResolvedValue([]); mocks.read.mockResolvedValue(null); mocks.checkLogin.mockResolvedValue({ loggedIn: true }); });

const emit = (ev: unknown) => state.onEvent?.(ev as never);
// 内容列表异步加载后才可选中；选中后触发登录探测与变体读取
const selectContent = async () => {
  await screen.findByRole('option', { name: '内容甲' });
  fireEvent.change(screen.getByLabelText('发布内容选择'), { target: { value: 'c_1' } });
};
const xhs = () => within(screen.getByRole('region', { name: '平台卡片 小红书' }));

describe('PublishCenter', () => {
  it('平台卡片与风控提示常驻；未选内容时注入禁用并提示先生成变体', async () => {
    render(<PublishCenter onBack={() => {}} />);
    expect(screen.getByText(/只注入草稿，最终发布由你在平台编辑器手动完成/)).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: '平台卡片 小红书' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '平台卡片 公众号文章' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '注入草稿' })).toBeDisabled();
    expect(screen.getByText(/先在变体工作台/)).toBeInTheDocument();
  });
  it('变体缺失时注入禁用；合法变体+已就绪 → 注入调用 createTask+run，事件驱动相位到 prepared 并回读可见', async () => {
    render(<PublishCenter onBack={() => {}} />);
    await selectContent();
    expect(screen.getByRole('button', { name: '注入草稿' })).toBeDisabled(); // read=null → 变体不存在
    mocks.read.mockResolvedValue({ platform: 'xiaohongshu', title: '标题', topics: [], body: '字'.repeat(650) } as VariantDoc);
    fireEvent.change(screen.getByLabelText('发布内容选择'), { target: { value: '' } }); // 重新触达变体读取
    await selectContent();
    await waitFor(() => expect(xhs().getByRole('button', { name: '注入草稿' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '注入草稿' }));
    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledWith('c_1', 'xiaohongshu'));
    await waitFor(() => expect(mocks.run).toHaveBeenCalledWith('t1'));
    emit({ kind: 'task_update', task: { taskId: 't1', contentId: 'c_1', platform: 'xiaohongshu', phase: 'injecting', updatedAt: 't' } });
    expect(await screen.findByText('注入中')).toBeInTheDocument();
    emit({ kind: 'task_update', task: { taskId: 't1', contentId: 'c_1', platform: 'xiaohongshu', phase: 'prepared', draftUrl: 'https://u', readBack: { title: '标题', bodyChars: 654, url: 'https://u' }, updatedAt: 't' } });
    expect(await screen.findByText('已停在草稿态')).toBeInTheDocument();
    expect(screen.getByText(/回读：标题「标题」/)).toBeInTheDocument();
  });
  it('失败三分类：not_logged_in 任务呈现未登录分类、可打开平台页登录引导、可重试', async () => {
    mocks.read.mockResolvedValue({ platform: 'xiaohongshu', title: '标题', topics: [], body: '字'.repeat(650) } as VariantDoc);
    render(<PublishCenter onBack={() => {}} />);
    await selectContent();
    await waitFor(() => expect(screen.getByRole('button', { name: '注入草稿' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '注入草稿' }));
    emit({ kind: 'task_update', task: { taskId: 't1', contentId: 'c_1', platform: 'xiaohongshu', phase: 'failed', category: 'not_logged_in', message: '请先登录小红书', updatedAt: 't' } });
    expect(await screen.findByText('未登录')).toBeInTheDocument();          // 任务行分类标签
    expect(screen.getByText('请先登录小红书')).toBeInTheDocument();          // 失败消息
    fireEvent.click(screen.getByRole('button', { name: '打开平台页' }));    // 任务 not_logged_in → 登录引导可见
    await waitFor(() => expect(mocks.showView).toHaveBeenCalledWith('xiaohongshu', true));
    fireEvent.click(screen.getByRole('button', { name: '重试注入' }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith('t1'));
  });
  it('公众号配置弹窗：回显脱敏、未改密钥用占位保存', async () => {
    mocks.getWechatConfig.mockResolvedValue({ config: { appid: 'wx1', hasSecret: true, secretTail: '1234', encrypted: false } });
    render(<PublishCenter onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '公众号文章' })); // 切换到公众号卡片（确认面板仅活动卡片渲染）
    fireEvent.click(await screen.findByRole('button', { name: '公众号配置' }));
    await waitFor(() => expect(screen.getByLabelText('AppID')).toHaveValue('wx1')); // 回显经异步 IPC——按回显用例同款 waitFor 等 microtask 落定
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));   // Secret 已预填 KEEP 占位（回显时）
    await waitFor(() => expect(mocks.setWechatConfig).toHaveBeenCalledWith({ appid: 'wx1', secret: '__KEEP_SAVED_SECRET__' }));
  });
});

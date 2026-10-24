import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ModelSettingsModal } from '../../src/renderer/components/ModelSettingsModal';
import { KEEP_API_KEY, type ModelConfigView } from '../../src/shared/types';

const mocks = vi.hoisted(() => ({
  get: vi.fn(async (): Promise<{ model: ModelConfigView | null }> => ({ model: null })),
  set: vi.fn(async (): Promise<{ ok: true } | { ok: false; code: string; message: string }> => ({ ok: true })),
}));
vi.mock('../../src/renderer/lib/agent-bridge', () => ({
  agentBridge: { getModelConfig: mocks.get, setModelConfig: mocks.set },
}));
beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue({ model: null }); });

describe('ModelSettingsModal', () => {
  it('填写并保存：setModelConfig 收到归一化输入后关闭', async () => {
    const onClose = vi.fn();
    render(<ModelSettingsModal onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: 'http://127.0.0.1:9/v1' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'k' } });
    fireEvent.change(screen.getByLabelText('模型 ID'), { target: { value: 'm' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith({ name: undefined, baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'k', modelId: 'm' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
  it('保存失败显示错误且不关闭', async () => {
    mocks.set.mockResolvedValueOnce({ ok: false as const, code: 'MODEL_CONFIG_INVALID' as const, message: 'API 地址必须以 http:// 或 https:// 开头' });
    const onClose = vi.fn();
    render(<ModelSettingsModal onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'k' } });
    fireEvent.change(screen.getByLabelText('模型 ID'), { target: { value: 'm' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('API 地址必须以 http://'));
    expect(onClose).not.toHaveBeenCalled();
  });
  it('打开时回显既有配置；API Key 不回显（输入框为空，placeholder 提示尾号）', async () => {
    mocks.get.mockResolvedValue({ model: { providerId: 'contentdeck', name: '本地', baseUrl: 'http://a/v1', modelId: 'm', hasKey: true, apiKeyTail: 'sk-9f' } });
    render(<ModelSettingsModal onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('API 地址')).toHaveValue('http://a/v1'));
    expect(screen.getByLabelText('模型 ID')).toHaveValue('m');
    expect(screen.getByLabelText('API Key')).toHaveValue(''); // 明文 key 不进渲染上下文
    expect(screen.getByLabelText('API Key')).toHaveAttribute('placeholder', '已保存（尾号 sk-9f），留空沿用原 Key');
  });
  it('已有配置且未改 Key 保存：apiKey 传占位值（主进程沿用旧 key）', async () => {
    mocks.get.mockResolvedValue({ model: { providerId: 'contentdeck', baseUrl: 'http://a/v1', modelId: 'm', hasKey: true, apiKeyTail: 'sk-9f' } });
    render(<ModelSettingsModal onClose={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText('API 地址')).toHaveValue('http://a/v1'));
    fireEvent.change(screen.getByLabelText('API 地址'), { target: { value: 'http://b/v1' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith({ name: undefined, baseUrl: 'http://b/v1', apiKey: KEEP_API_KEY, modelId: 'm' }));
  });
});

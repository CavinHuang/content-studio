import { useEffect, useState } from 'react';
import { agentBridge } from '../lib/agent-bridge';
import { KEEP_API_KEY } from '../../shared/types';

export function ModelSettingsModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [apiKeyTail, setApiKeyTail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 回显脱敏视图：明文 key 不进渲染进程，输入框留空、placeholder 提示尾号
  useEffect(() => {
    void agentBridge.getModelConfig().then(({ model: c }) => {
      if (c) {
        setName(c.name ?? ''); setBaseUrl(c.baseUrl); setModelId(c.modelId);
        setHasKey(c.hasKey); setApiKeyTail(c.apiKeyTail);
      }
    });
  }, []);

  const save = async () => {
    setBusy(true); setError(null);
    const r = await agentBridge.setModelConfig({
      name: name.trim() || undefined, baseUrl: baseUrl.trim(),
      apiKey: apiKey || (hasKey ? KEEP_API_KEY : ''), // 已有配置且未改 key：传占位，主进程沿用旧 key
      modelId: modelId.trim(),
    });
    setBusy(false);
    if (r.ok) onClose();
    else setError(r.message);
  };

  return (
    <div className="modal-mask" role="dialog" aria-label="AI 设置">
      <div className="modal">
        <h2>AI 设置</h2>
        <label>模型名称（可选）<input aria-label="模型名称" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>API 地址（OpenAI 兼容，如 https://api.openai.com/v1）<input aria-label="API 地址" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></label>
        <label>API Key<input aria-label="API Key" type="password" value={apiKey}
          placeholder={hasKey ? `已保存（尾号 ${apiKeyTail || '****'}），留空沿用原 Key` : ''}
          onChange={(e) => setApiKey(e.target.value)} /></label>
        <label>模型 ID<input aria-label="模型 ID" value={modelId} onChange={(e) => setModelId(e.target.value)} /></label>
        {error && <p role="alert">{error}</p>}
        <button onClick={() => void save()} disabled={busy}>保存设置</button>
        <button onClick={onClose}>取消</button>
        <p className="hint">配置只保存在本机用户数据目录，用于调用你指定的兼容接口；不进内容库。</p>
      </div>
    </div>
  );
}

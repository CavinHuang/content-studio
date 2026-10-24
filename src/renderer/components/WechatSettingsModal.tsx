import { useEffect, useState } from 'react';
import { publishBridge } from '../lib/publish-bridge';
import { KEEP_WECHAT_SECRET } from '../../shared/types';

export function WechatSettingsModal({ onClose }: { onClose: () => void }) {
  const [appid, setAppid] = useState('');
  const [secret, setSecret] = useState('');
  const [tail, setTail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void publishBridge.getWechatConfig().then(({ config }) => {
      if (!config) return;
      setAppid(config.appid);
      if (config.hasSecret) { setTail(config.secretTail); setSecret(KEEP_WECHAT_SECRET); }
    });
  }, []);
  const save = async () => {
    setBusy(true); setError(null);
    const r = await publishBridge.setWechatConfig({ appid, secret });
    setBusy(false);
    if (r.ok) onClose(); else setError(r.message);
  };
  return (
    <div className="modal-mask" role="dialog" aria-label="公众号配置">
      <div className="modal">
        <h2>公众号配置</h2>
        <label>AppID<input aria-label="AppID" value={appid} onChange={(e) => setAppid(e.target.value)} /></label>
        <label>AppSecret
          <input aria-label="AppSecret" type="password" value={secret} placeholder={tail ? `已保存（尾四位 ${tail}），留原值即沿用` : ''}
            onChange={(e) => setSecret(e.target.value)} />
        </label>
        {error && <p role="alert">{error}</p>}
        <button onClick={() => void save()} disabled={busy}>保存配置</button>
        <button onClick={onClose}>取消</button>
        <p className="hint">仅存本机用户数据目录（系统加密可用时加密存储）；正式调用需在公众号后台把本机出口 IP 加入白名单。</p>
      </div>
    </div>
  );
}

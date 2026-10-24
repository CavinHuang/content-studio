import { useState } from 'react';
import { bridge } from '../lib/bridge';
export function NewContentModal({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await bridge.createContent({ title: title.trim(), tags: tags.split(/[,，\s]+/).filter(Boolean) });
      onDone(); onClose();
    } finally { setBusy(false); }
  };
  return (
    <div className="modal-mask" role="dialog" aria-label="新建内容">
      <div className="modal">
        <label>标题<input aria-label="标题" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>标签（逗号分隔）<input aria-label="标签" value={tags} onChange={(e) => setTags(e.target.value)} /></label>
        <button onClick={submit} disabled={busy}>创建</button>
        <button onClick={onClose}>取消</button>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { bridge } from '../lib/bridge';
import { agentBridge } from '../lib/agent-bridge';
import { variantBridge } from '../lib/publish-bridge';
import { PLATFORM_RULES, platformKeys, validateVariant } from '../../shared/platform-rules';
import type { ContentMeta, DraftSummary, PlatformKey, VariantDoc } from '../../shared/types';

type Draft = { title: string; topics: string; body: string; digest: string; cover: string };
const splitTopics = (s: string): string[] => s.split(/[、,，]/).map((t) => t.trim()).filter(Boolean);
const toDraft = (doc: VariantDoc | null): Draft => ({
  title: doc?.title ?? '', topics: (doc?.topics ?? []).join('、'), body: doc?.body ?? '',
  digest: doc?.digest ?? '', cover: doc?.cover ?? '',
});

export function VariantsPage({ initialContentId, onBack, onGoPublish }: {
  initialContentId?: string; onBack: () => void; onGoPublish: (contentId: string, platform: PlatformKey) => void;
}) {
  const [items, setItems] = useState<ContentMeta[]>([]);
  const [contentId, setContentId] = useState(initialContentId ?? '');
  const [docs, setDocs] = useState<Partial<Record<PlatformKey, Draft>>>({});
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [savedAt, setSavedAt] = useState<Partial<Record<PlatformKey, string>>>({});

  useEffect(() => { void bridge.listContents().then((s) => setItems(s.items)); }, []);
  const refresh = useCallback(async (id: string) => {
    const next: Partial<Record<PlatformKey, Draft>> = {};
    for (const p of platformKeys()) next[p] = toDraft(await variantBridge.read(id, p));
    setDocs(next);
    setDrafts((await agentBridge.listDrafts(id)).filter((d) => d.platform));
  }, []);
  useEffect(() => { if (contentId) void refresh(contentId); }, [contentId, refresh]);
  useEffect(() => agentBridge.onEvent((ev) => {
    if (ev.kind === 'drafts_changed' && ev.contentId === contentId) void refresh(contentId);
  }), [contentId, refresh]);

  const set = (p: PlatformKey, patch: Partial<Draft>) => setDocs((d) => ({ ...d, [p]: { ...(d[p] ?? toDraft(null)), ...patch } }));

  return (
    <div className="variants-page">
      <header className="page-header">
        <button onClick={onBack}>← 返回看板</button>
        <h1>变体工作台</h1>
        <select aria-label="内容选择" value={contentId} onChange={(e) => setContentId(e.target.value)}>
          <option value="">选择内容…</option>
          {items.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
      </header>
      {!contentId
        ? <p className="hint">先选择一篇内容。AI 生成入口在编辑器右侧「AI 助手 → 一稿多态转化」。</p>
        : <div className="variants-grid">
          {platformKeys().map((p) => <VariantCard key={p} platform={p} contentId={contentId} d={docs[p] ?? toDraft(null)}
            onChange={(patch) => set(p, patch)} savedAt={savedAt[p]}
            drafts={drafts.filter((x) => x.platform === p)}
            onAdopted={() => void refresh(contentId)}
            onGoPublish={() => onGoPublish(contentId, p)} setSavedAt={(t) => setSavedAt((s) => ({ ...s, [p]: t }))} />)}
        </div>}
    </div>
  );
}

function VariantCard({ platform, contentId, d, onChange, savedAt, drafts, onAdopted, onGoPublish, setSavedAt }: {
  platform: PlatformKey; contentId: string; d: Draft; onChange: (patch: Partial<Draft>) => void;
  savedAt?: string; drafts: DraftSummary[]; onAdopted: () => void; onGoPublish: () => void; setSavedAt: (t: string) => void;
}) {
  const rules = PLATFORM_RULES[platform];
  const v = useMemo(() => validateVariant(platform, {
    platform, title: d.title, topics: splitTopics(d.topics), body: d.body,
    ...(d.digest ? { digest: d.digest } : {}), ...(d.cover ? { cover: d.cover } : {}),
  }), [platform, d]);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    const r = await variantBridge.save(contentId, platform, {
      title: d.title, topics: splitTopics(d.topics), body: d.body,
      ...(d.digest ? { digest: d.digest } : {}), ...(d.cover ? { cover: d.cover } : {}),
    });
    if (r.ok) { setSavedAt(r.savedAt); setMsg(null); } else setMsg(r.message);
  };
  const adopt = async (name: string) => {
    const r = await variantBridge.applyDraft(contentId, platform, name);
    if (!r.ok) setMsg(r.message); else onAdopted();
  };
  return (
    <section className="variant-card" role="region" aria-label={`变体 ${rules.label}`}>
      <h2>{rules.label}<span className="mode-tag">{rules.mode === 'api' ? '官方 API' : '浏览器注入'}</span></h2>
      <ul className="rule-notes">{rules.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      {platform !== 'x' && <label>标题<input aria-label="变体标题输入" value={d.title} onChange={(e) => onChange({ title: e.target.value })} /></label>}
      {(platform === 'xiaohongshu' || platform === 'jike') && (
        <label>话题（顿号分隔）<input aria-label="变体话题输入" value={d.topics} onChange={(e) => onChange({ topics: e.target.value })} /></label>
      )}
      {platform === 'wechat-article' && (
        <>
          <label>摘要（≤120 字，可空）<input aria-label="变体摘要输入" value={d.digest} onChange={(e) => onChange({ digest: e.target.value })} /></label>
          <label>封面（内容库内路径，如 assets/cover.png）<input aria-label="变体封面输入" value={d.cover} onChange={(e) => onChange({ cover: e.target.value })} /></label>
        </>
      )}
      <label>正文<textarea aria-label="变体正文输入" value={d.body} onChange={(e) => onChange({ body: e.target.value })} /></label>
      <div className="validation" aria-label="校验结果">
        {v.errors.map((e) => <p key={e} className="v-error" role="alert">{e}</p>)}
        {v.warnings.map((w) => <p key={w} className="v-warn">{w}</p>)}
        {!v.errors.length && !v.warnings.length && <p className="v-ok">已满足本地规则</p>}
      </div>
      {msg && <p role="alert">{msg}</p>}
      <div className="variant-actions">
        <button onClick={() => void save()} disabled={!v.ok}>保存变体</button>
        <button onClick={onGoPublish}>去发布 {rules.label}</button>
        {savedAt && <span className="hint">已保存 {savedAt.slice(0, 19).replace('T', ' ')}</span>}
      </div>
      {drafts.length > 0 && (
        <div className="variant-drafts">
          <h3>AI 变体草稿（确认后写入本卡）</h3>
          <ul>
            {drafts.map((x) => (
              <li key={x.name}>
                <span>{x.note || '草稿'} · {x.created.slice(0, 19).replace('T', ' ')}</span>
                <button onClick={() => void adopt(x.name)}>采纳入变体 {x.name}</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

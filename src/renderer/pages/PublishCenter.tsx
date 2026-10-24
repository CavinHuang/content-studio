import { useCallback, useEffect, useState } from 'react';
import { bridge } from '../lib/bridge';
import { variantBridge, publishBridge } from '../lib/publish-bridge';
import { validateVariant, PLATFORM_RULES } from '../../shared/platform-rules';
import { WechatSettingsModal } from '../components/WechatSettingsModal';
import type { ContentMeta, PlatformKey, PublishEventOut, PublishTask, VariantDoc } from '../../shared/types';

const PUBLISHABLE: PlatformKey[] = ['xiaohongshu', 'wechat-article'];
const PHASE_LABEL: Record<string, string> = {
  queued: '待运行', validating: '校验变体', login_check: '检查登录', injecting: '注入中',
  reading_back: '回读状态', prepared: '已停在草稿态', failed: '失败',
};
const CATEGORY_LABEL: Record<string, string> = {
  not_logged_in: '未登录', page_changed: '页面结构变更（适配器需更新）', network: '网络（可重试）',
  already_has_content: '编辑器已有内容（防覆盖停止）', api_error: '平台 API 错误', validation: '变体未过校验', unknown: '未知错误',
};

export function PublishCenter({ initial, onBack }: {
  initial?: { contentId: string; platform: PlatformKey }; onBack: () => void;
}) {
  const [items, setItems] = useState<ContentMeta[]>([]);
  const [contentId, setContentId] = useState(initial?.contentId ?? '');
  const [platform, setPlatform] = useState<PlatformKey>(initial?.platform ?? 'xiaohongshu');
  const [login, setLogin] = useState<Partial<Record<PlatformKey, { status: 'unknown' | 'ok' | 'failed'; message?: string }>>>({});
  const [doc, setDoc] = useState<VariantDoc | null>(null);
  const [tasks, setTasks] = useState<PublishTask[]>([]);
  const [showView, setShowView] = useState(false);
  const [wechatOpen, setWechatOpen] = useState(false);

  useEffect(() => { void bridge.listContents().then((s) => setItems(s.items)); }, []);
  const refreshTasks = useCallback(async () => setTasks(await publishBridge.tasks()), []);
  useEffect(() => { void refreshTasks(); }, [refreshTasks]);
  useEffect(() => publishBridge.onEvent((ev: PublishEventOut) => {
    setTasks((ts) => { const i = ts.findIndex((t) => t.taskId === ev.task.taskId); const next = [...ts]; if (i >= 0) next[i] = ev.task; else next.unshift(ev.task); return next; });
  }), []);

  const checkLogin = useCallback(async (p: PlatformKey) => {
    setLogin((s) => ({ ...s, [p]: { status: 'unknown' } }));
    const r = await publishBridge.checkLogin(p);
    setLogin((s) => ({ ...s, [p]: r.loggedIn ? { status: 'ok' } : { status: 'failed', message: r.message } }));
  }, []);
  useEffect(() => { if (contentId) void checkLogin(platform); }, [contentId, platform, checkLogin]);

  useEffect(() => { setDoc(null); if (contentId) void variantBridge.read(contentId, platform).then(setDoc); }, [contentId, platform]);
  const validation = doc ? validateVariant(platform, doc) : null;

  useEffect(() => () => { void publishBridge.showView('xiaohongshu', false).catch(() => {}); }, []);

  const myTasks = tasks.filter((t) => t.contentId === contentId && t.platform === platform);
  const latest = myTasks[0];

  const inject = async () => {
    const r = await publishBridge.createTask(contentId, platform);
    if (!r.ok) return;
    const run = await publishBridge.run(r.task.taskId);
    if (!run.ok) void refreshTasks();
  };
  const toggleView = async () => {
    const next = !showView;
    setShowView(next);
    await publishBridge.showView('xiaohongshu', next);
  };
  const canInject = Boolean(contentId && doc && validation?.ok && login[platform]?.status !== 'unknown');

  return (
    <div className="publish-page">
      <header className="page-header">
        <button onClick={onBack}>← 返回看板</button>
        <h1>发布中心</h1>
        <select aria-label="发布内容选择" value={contentId} onChange={(e) => setContentId(e.target.value)}>
          <option value="">选择内容…</option>
          {items.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
        </select>
      </header>
      <p className="risk-note" role="note">风控边界：只注入草稿，最终发布由你在平台编辑器手动完成；平台间串行限速；注入前检查已有内容防覆盖。</p>
      <div className="publish-main">
        <div className="publish-left">
          {PUBLISHABLE.map((p) => {
            const rules = PLATFORM_RULES[p];
            const l = login[p];
            return (
              <section key={p} role="region" aria-label={`平台卡片 ${rules.label}`}
                className={`platform-card ${platform === p ? 'active' : ''}`}>
                <button className="platform-pick" aria-label={rules.label} onClick={() => setPlatform(p)}>
                  <h2>{rules.label}</h2><span className="mode-tag">{rules.mode === 'api' ? '官方 API（草稿箱）' : '浏览器注入'}</span>
                </button>
                {platform === p && <>
                  <div className="login-line">
                    {p === 'wechat-article' && <button onClick={() => setWechatOpen(true)}>公众号配置</button>}
                    <button onClick={() => void checkLogin(p)}>检查登录</button>
                    {l?.status === 'ok' && <span className="ok">已就绪{l.message ? `：${l.message}` : ''}</span>}
                    {l?.status === 'failed' && <span className="bad" role="alert">未登录或未就绪：{l.message ?? ''}</span>}
                    {l?.status === 'unknown' && <span className="hint">探测中…</span>}
                    {(p === 'xiaohongshu' && (l?.status === 'failed' || latest?.category === 'not_logged_in')) && (
                      <button onClick={() => void toggleView()}>{showView ? '隐藏平台页' : '打开平台页'}</button>
                    )}
                  </div>
                  <div className="variant-confirm">
                    <h3>变体确认（本地规则校验先行）</h3>
                    {doc
                      ? <>
                          <p className="hint">{doc.title || '（无标题）'} · 正文 {Array.from(doc.body.replace(/\s+/g, '')).length} 字 {doc.topics.length ? `· 话题 ${doc.topics.join('、')}` : ''}</p>
                          {validation?.errors.map((e) => <p key={e} className="v-error" role="alert">{e}</p>)}
                          {validation?.warnings.map((w) => <p key={w} className="v-warn">{w}</p>)}
                        </>
                      : <p className="hint">变体不存在：先在变体工作台生成并保存{rules.label}变体。</p>}
                    <button onClick={() => void inject()} disabled={!canInject}>注入草稿</button>
                  </div>
                </>}
              </section>
            );
          })}
          <section className="publish-tasks" aria-label="发布任务列表">
            <h3>发布任务（本机内存态，重启清空；发布记录持久化随 M4 运营域交付）</h3>
            {myTasks.length === 0 && <p className="hint">暂无任务</p>}
            {myTasks.map((t) => (
              <div key={t.taskId} className={`task phase-${t.phase}`}>
                <span>{PHASE_LABEL[t.phase] ?? t.phase}</span>
                {t.category && <span className="bad">{CATEGORY_LABEL[t.category] ?? t.category}</span>}
                {t.message && <span className="hint">{t.message}</span>}
                {t.draftUrl && <span className="hint">草稿页：{t.draftUrl}</span>}
                {t.mediaId && <span className="hint">草稿 media_id：{t.mediaId}</span>}
                {t.readBack && <span className="hint">回读：标题「{t.readBack.title}」正文 {t.readBack.bodyChars} 字</span>}
                {t.phase === 'failed' && t.category !== 'validation' && <button onClick={() => void publishBridge.retry(t.taskId)}>重试注入</button>}
              </div>
            ))}
          </section>
        </div>
        <div className="publish-view-host" aria-hidden={!showView}>
          {showView && <p className="hint">平台编辑器显示在此区域右侧（登录/核对草稿用；发布按钮由你手动点击）</p>}
        </div>
      </div>
      {wechatOpen && <WechatSettingsModal onClose={() => { setWechatOpen(false); void checkLogin('wechat-article'); }} />}
    </div>
  );
}

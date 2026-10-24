import { useCallback, useEffect, useRef, useState } from 'react';
import { agentBridge } from '../lib/agent-bridge';
import type { AgentEventOut, DraftSummary } from '../../shared/types';
import { ModelSettingsModal } from './ModelSettingsModal';

const SKILLS = [
  { label: '长文初稿', command: '/skill:longform-draft' },
  { label: '审稿改稿', command: '/skill:review-revise' },
] as const;

type Line = { role: 'user' | 'assistant' | 'tool' | 'alert'; text: string };

export function AgentPanel({ contentId, onApplied }: { contentId: string; onApplied: () => void }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [ask, setAsk] = useState<{ questionId: string; question: string; options?: string[] } | null>(null);
  const [freeAnswer, setFreeAnswer] = useState('');
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const runningRef = useRef(false);

  const refreshDrafts = useCallback(async () => {
    setDrafts(await agentBridge.listDrafts(contentId));
  }, [contentId]);
  useEffect(() => { void refreshDrafts(); }, [refreshDrafts]);

  useEffect(() => {
    const off = agentBridge.onEvent((ev: AgentEventOut) => {
      if (ev.contentId !== contentId) return;
      switch (ev.kind) {
        case 'run_start':
          runningRef.current = true; setRunning(true); break;
        case 'delta':
          setLines((ls) => {
            const last = ls[ls.length - 1];
            if (last && last.role === 'assistant') return [...ls.slice(0, -1), { ...last, text: last.text + ev.text }];
            return [...ls, { role: 'assistant', text: ev.text }];
          });
          break;
        case 'tool_start':
          setLines((ls) => [...ls, { role: 'tool', text: `调用工具 ${ev.tool}` }]);
          break;
        case 'tool_end':
          if (ev.tool === 'write_draft') void refreshDrafts();
          break;
        case 'ask':
          setAsk({ questionId: ev.questionId, question: ev.question, options: ev.options });
          break;
        case 'run_end':
          runningRef.current = false; setRunning(false);
          if (!ev.ok) setLines((ls) => [...ls, { role: 'alert', text: `任务失败：${ev.error ?? '未知错误'}` }]);
          void refreshDrafts();
          break;
        case 'drafts_changed':
          void refreshDrafts();
          break;
      }
    });
    return off;
  }, [contentId, refreshDrafts]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || runningRef.current) return;
    setLines((ls) => [...ls, { role: 'user', text: t }]);
    setInput('');
    const r = await agentBridge.send(contentId, t);
    if (!r.ok) setLines((ls) => [...ls, { role: 'alert', text: r.message }]);
  };

  const answer = async (a: string) => {
    if (!ask || !a.trim()) return;
    await agentBridge.answer(contentId, ask.questionId, a.trim());
    setLines((ls) => [...ls, { role: 'user', text: `（回答）${a.trim()}` }]);
    setAsk(null); setFreeAnswer('');
  };

  const apply = async (name: string) => {
    const r = await agentBridge.applyDraft(contentId, name);
    if (r.ok) { onApplied(); void refreshDrafts(); }
    else setLines((ls) => [...ls, { role: 'alert', text: `采纳失败：${r.message}` }]);
  };
  const discard = async (name: string) => {
    const r = await agentBridge.discardDraft(contentId, name);
    if (!r.ok) setLines((ls) => [...ls, { role: 'alert', text: `丢弃失败：${r.message}` }]);
    void refreshDrafts();
  };

  return (
    <section className="agent-panel" aria-label="AI 助手">
      <header className="agent-header">
        <h2>AI 助手</h2>
        <button onClick={() => setShowSettings(true)}>AI 设置</button>
      </header>
      <div className="agent-skills">
        {SKILLS.map((s) => (
          <button key={s.command} onClick={() => setInput(`${s.command} `)}>{s.label}</button>
        ))}
      </div>
      <div className="agent-transcript" aria-label="AI 对话记录" role="log">
        {lines.map((l, i) => (
          <div key={i} className={`line line-${l.role}`} role={l.role === 'alert' ? 'alert' : undefined}>{l.text}</div>
        ))}
      </div>
      <div className="agent-input">
        <textarea aria-label="AI 指令输入" value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
          placeholder="输入指令，或点技能按钮后补充要求（Enter 发送）" />
        {running
          ? <button onClick={() => void agentBridge.cancel(contentId)}>取消任务</button>
          : <button onClick={() => void send(input)} disabled={!input.trim()}>发送</button>}
      </div>
      <div className="agent-drafts">
        <h3>草稿区（AI 产出，确认后进正文）</h3>
        {drafts.length === 0 && <p className="hint">暂无草稿。AI 的产出只会出现在这里。</p>}
        <ul aria-label="草稿区">
          {drafts.map((d) => (
            <li key={d.name}>
              <div className="draft-meta">{d.note || '草稿'} · {d.created.slice(0, 19).replace('T', ' ')} · {d.bytes}B</div>
              <div className="draft-actions">
                <button onClick={() => void apply(d.name)}>采纳入正文 {d.name}</button>
                <button onClick={() => void discard(d.name)}>丢弃 {d.name}</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
      {ask && (
        <div className="modal-mask" role="dialog" aria-label="AI 问询">
          <div className="modal ask-modal">
            <h3>AI 问询</h3>
            <p>{ask.question}</p>
            {(ask.options ?? []).map((o) => (
              <button key={o} onClick={() => void answer(o)}>{o}</button>
            ))}
            <div className="ask-free">
              <input aria-label="自由回答" value={freeAnswer} onChange={(e) => setFreeAnswer(e.target.value)} />
              <button onClick={() => void answer(freeAnswer)}>提交回答</button>
            </div>
          </div>
        </div>
      )}
      {showSettings && <ModelSettingsModal onClose={() => setShowSettings(false)} />}
    </section>
  );
}

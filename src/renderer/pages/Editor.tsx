import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap } from '@codemirror/commands';
import { bridge } from '../lib/bridge';
import type { Content } from '../../shared/types';

export function Editor({ id, onBack }: { id: string; onBack: () => void }) {
  const [content, setContent] = useState<Content | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle');
  const bodyRef = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void bridge.readContent(id).then((c) => {
    setContent(c); bodyRef.current = c.body;
  }); }, [id]);

  const doSave = useCallback(async () => {
    setSaveState('saving');
    await bridge.saveBody(id, bodyRef.current);
    setSaveState('saved');
  }, [id]);

  const onInput = useCallback((body: string) => {
    bodyRef.current = body;
    setSaveState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void doSave(); }, 800);
  }, [doSave]);

  useEffect(() => {
    if (!content || !hostRef.current || viewRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: content.body,
        extensions: [
          markdown(), keymap.of(defaultKeymap),
          EditorView.updateListener.of((u) => { if (u.docChanged) onInput(u.state.doc.toString()); }),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, [content, onInput]);

  if (!content) return <div className="editor">载入中…</div>;
  const label = { idle: '', dirty: '未保存', saving: '保存中…', saved: '已保存' }[saveState];
  return (
    <div className="editor">
      <header className="editor-header">
        <button onClick={() => { if (timer.current) clearTimeout(timer.current); if (saveState === 'dirty') void doSave(); onBack(); }}>← 返回看板</button>
        <input aria-label="内容标题" defaultValue={content.title} onBlur={async (e) => {
          const t = e.target.value.trim();
          if (t && t !== content.title) { await bridge.updateMeta(id, { title: t }); setContent({ ...content, title: t }); }
        }} />
        <span className="save-state" role="status">{label}</span>
      </header>
      <div ref={hostRef} className="cm-host" aria-label="正文编辑区" />
      <textarea className="a11y-fallback" aria-label="正文编辑区" value={bodyRef.current}
        onChange={(e) => onInput(e.target.value)} tabIndex={-1} />
    </div>
  );
}

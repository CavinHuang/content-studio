import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap } from '@codemirror/commands';
import { bridge } from '../lib/bridge';
import type { Content } from '../../shared/types';

export function Editor({ id, onBack }: { id: string; onBack: () => void }) {
  const [content, setContent] = useState<Content | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const bodyRef = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void bridge.readContent(id).then((c) => {
    setContent(c); bodyRef.current = c.body;
  }); }, [id]);

  // 卸载时清掉挂起的防抖计时器，避免离开页面后仍触发保存/状态更新
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const doSave = useCallback(async () => {
    setSaveState('saving');
    setSaveError(null);
    try {
      await bridge.saveBody(id, bodyRef.current);
      setSaveState('saved');
    } catch (err) {
      // 保存失败落到指示器文案，重试按钮/再次输入（回到 dirty 自动保存）均可重试
      setSaveState('error');
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);

  const onInput = useCallback((body: string) => {
    bodyRef.current = body;
    setSaveState('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void doSave(); }, 800);
  }, [doSave]);

  // 视图按内容 id 只创建一次：初始 doc 取 bodyRef.current（载入处理器已写入）。
  // 依赖不含 content 对象——标题 blur 会 setContent({...content, title}) 替换对象身份，
  // 若视图随之销毁重建，会用载入时的旧正文顶掉编辑器里未保存的输入（数据丢失路径）。
  useEffect(() => {
    if (!content || !hostRef.current || viewRef.current) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: bodyRef.current,
        extensions: [
          markdown(), keymap.of(defaultKeymap),
          // 真正可编辑的 contenteditable 由 CodeMirror 渲染为 role=textbox，
          // 可访问名在这里给它（宿主 div 上的 aria-label 不会下传，反而制造同名重复）。
          EditorView.contentAttributes.of({ 'aria-label': '正文编辑区' }),
          EditorView.updateListener.of((u) => { if (u.docChanged) onInput(u.state.doc.toString()); }),
        ],
      }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, [content?.id, onInput]);

  if (!content) return <div className="editor">载入中…</div>;
  const label = { idle: '', dirty: '未保存', saving: '保存中…', saved: '已保存', error: '保存失败' }[saveState];
  return (
    <div className="editor">
      <header className="editor-header">
        <button onClick={() => { if (timer.current) clearTimeout(timer.current); if (saveState === 'dirty' || saveState === 'error') void doSave(); onBack(); }}>← 返回看板</button>
        <input aria-label="内容标题" defaultValue={content.title} onBlur={async (e) => {
          const t = e.target.value.trim();
          if (t && t !== content.title) { await bridge.updateMeta(id, { title: t }); setContent({ ...content, title: t }); }
        }} />
        <span className="save-state" role="status" title={saveError ?? undefined}>{label}</span>
        {saveState === 'error' && <button className="save-retry" onClick={() => { void doSave(); }}>重试保存</button>}
      </header>
      <div ref={hostRef} className="cm-host" />
      <textarea className="a11y-fallback" aria-label="正文编辑区（回退）" aria-hidden="true" value={bodyRef.current}
        onChange={(e) => onInput(e.target.value)} tabIndex={-1} />
    </div>
  );
}

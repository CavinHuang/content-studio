import { useCallback, useEffect, useState } from 'react';
import { STAGES, type ContentMeta, type LibraryScan, type Stage } from '../../shared/types';
import { bridge } from '../lib/bridge';
import { NewContentModal } from '../components/NewContentModal';

function MoveMenu({ id, title, onMove }: { id: string; title: string; onMove: (id: string, stage: Stage) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card-move">
      <button aria-label={`移动 ${title}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>移动…</button>
      {open && (
        <div role="menu" aria-label={`移动 ${title} 到其他阶段`}>
          {STAGES.map((stage) => (
            <button
              key={stage}
              role="menuitem"
              onClick={() => { setOpen(false); onMove(id, stage); }}
            >
              移动到 {stage}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Board({ onOpen }: { onOpen: (id: string) => void }) {
  const [scan, setScan] = useState<LibraryScan>({ items: [], warnings: [] });
  const [showNew, setShowNew] = useState(false);
  const refresh = useCallback(async () => setScan(await bridge.listContents()), []);
  useEffect(() => { void refresh(); }, [refresh]);
  const move = async (id: string, stage: Stage) => {
    await bridge.updateMeta(id, { stage }); await refresh();
  };
  return (
    <div className="board">
      <header className="board-header">
        <h1>内容管线</h1>
        <button onClick={() => setShowNew(true)}>新建内容</button>
      </header>
      <div className="board-columns">
        {STAGES.map((stage) => (
          <section key={stage} className="board-col" aria-label={`阶段 ${stage}`}>
            <h2>{stage}</h2>
            {scan.items.filter((m) => m.stage === stage).map((m) => (
              <article key={m.id} className="card">
                <button className="card-title" onClick={() => onOpen(m.id)}>{m.title}</button>
                <div className="card-meta">{m.created} · {m.tags.join(' / ')}</div>
                <MoveMenu id={m.id} title={m.title} onMove={move} />
              </article>
            ))}
          </section>
        ))}
      </div>
      {scan.warnings.length > 0 && <footer className="board-warnings">{scan.warnings.join('；')}</footer>}
      {showNew && <NewContentModal onDone={refresh} onClose={() => setShowNew(false)} />}
    </div>
  );
}

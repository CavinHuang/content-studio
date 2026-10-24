import { useEffect, useState } from 'react';
import { Board } from './pages/Board';
import { Editor } from './pages/Editor';
import { bridge } from './lib/bridge';

type View = { view: 'setup' } | { view: 'board' } | { view: 'editor'; id: string };
export function App() {
  const [v, setV] = useState<View>({ view: 'setup' });
  useEffect(() => {
    void bridge.getSettings().then((s) => setV(s.libraryRoot ? { view: 'board' } : { view: 'setup' }));
  }, []);
  if (v.view === 'setup') return (
    <div className="setup">
      <h1>ContentDeck</h1>
      <p>选择一个文件夹作为你的内容库（内容始终是你的文件）。</p>
      <button onClick={async () => {
        const r = await bridge.chooseLibrary();
        if ('libraryRoot' in r) setV({ view: 'board' });
      }}>选择内容库文件夹</button>
    </div>
  );
  if (v.view === 'editor') return <Editor id={v.id} onBack={() => setV({ view: 'board' })} />;
  return <Board onOpen={(id) => setV({ view: 'editor', id })} />;
}

import { useEffect, useState } from 'react';
import { Board } from './pages/Board';
import { Editor } from './pages/Editor';
import { VariantsPage } from './pages/VariantsPage';
import { PublishCenter } from './pages/PublishCenter';
import { bridge } from './lib/bridge';
import type { PlatformKey } from '../shared/types';

type View =
  | { view: 'setup' }
  | { view: 'board' }
  | { view: 'editor'; id: string }
  | { view: 'variants'; id?: string }
  | { view: 'publish'; initial?: { contentId: string; platform: PlatformKey } };
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
  if (v.view === 'editor') return <Editor id={v.id} onBack={() => setV({ view: 'board' })} onVariants={(id) => setV({ view: 'variants', id })} />;
  if (v.view === 'variants') return <VariantsPage initialContentId={v.id} onBack={() => setV({ view: 'board' })}
    onGoPublish={(contentId, platform) => setV({ view: 'publish', initial: { contentId, platform } })} />;
  if (v.view === 'publish') return <PublishCenter initial={v.initial} onBack={() => setV({ view: 'board' })} />;
  return <Board onOpen={(id) => setV({ view: 'editor', id })} onPublish={() => setV({ view: 'publish' })} />;
}

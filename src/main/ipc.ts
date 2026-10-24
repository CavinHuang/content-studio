import { ipcMain, dialog } from 'electron';
import { listContents, createContent, readContent, writeBody, updateMeta } from './content-library';
import { loadSettings, saveSettings, detectSyncDir } from './settings';
import type { Stage } from '../shared/types';

export function currentRoot(): string | null {
  if (process.env.CONTENTDECK_LIBRARY) return process.env.CONTENTDECK_LIBRARY;
  return loadSettings().libraryRoot;
}

export function registerIpc(): void {
  ipcMain.handle('studio:getSettings', () => ({ libraryRoot: currentRoot() }));

  ipcMain.handle('studio:chooseLibrary', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { cancelled: true as const };
    const picked = r.filePaths[0]!;
    if (detectSyncDir(picked)) {
      const m = await dialog.showMessageBox({
        type: 'warning',
        message: '所选目录疑似网盘同步目录',
        detail: 'SQLite 状态库（后续里程碑）在同步目录下可能损坏。仍要使用吗？',
        buttons: ['仍要使用', '重新选择'], defaultId: 1, cancelId: 1,
      });
      if (m.response === 1) return { cancelled: true as const };
    }
    saveSettings({ libraryRoot: picked });
    return { libraryRoot: picked };
  });

  const root = () => {
    const r = currentRoot();
    if (!r) throw new Error('尚未选择内容库');
    return r;
  };
  ipcMain.handle('studio:listContents', () => listContents(root()));
  ipcMain.handle('studio:createContent', (_e, input: { title: string; tags?: string[] }) => createContent(root(), input));
  ipcMain.handle('studio:readContent', (_e, id: string) => readContent(root(), id));
  ipcMain.handle('studio:saveBody', (_e, id: string, body: string) => writeBody(root(), id, body));
  ipcMain.handle('studio:updateMeta', (_e, id: string, patch: { stage?: Stage; tags?: string[]; title?: string }) => updateMeta(root(), id, patch));
}

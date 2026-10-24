import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import path from 'node:path';
import { listContents, createContent, readContent, writeBody, updateMeta } from './content-library';
import { loadSettings, saveSettings, detectSyncDir } from './settings';
import { listDrafts, applyDraft, discardDraft } from './drafts';
import { AgentService } from './agent/agent-service';
import { createRealSessionFactory } from './agent/real-session';
import { getModelConfig, setModelConfig } from './agent/model-config';
import { loadPi } from './agent/pi-loader';
import type { Stage } from '../shared/types';

export function currentRoot(): string | null {
  if (process.env.CONTENTDECK_LIBRARY) return process.env.CONTENTDECK_LIBRARY;
  return loadSettings().libraryRoot;
}

let agent: AgentService | null = null;
function agentService(): AgentService {
  if (!agent) {
    agent = new AgentService({
      createSession: createRealSessionFactory({
        root: currentRoot,
        // dev=仓库 skills/；打包=process.resourcesPath/skills（forge extraResource，Task 8）
        skillsDir: () => (app.isPackaged
          ? path.join(process.resourcesPath, 'skills')
          : path.join(app.getAppPath(), 'skills')),
      }),
      emit: (ev) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('studio:agent:event', ev); },
      hasModelConfig: () => getModelConfig() !== null,
    });
  }
  return agent;
}
export function disposeAgent(): void { agent?.disposeAll(); agent = null; }

type Fail = { ok: false; code: string; message: string };
function fail(err: unknown): Fail {
  const code = (err as { code?: unknown })?.code;
  return { ok: false, code: typeof code === 'string' && code ? code : 'ERROR', message: err instanceof Error ? err.message : String(err) };
}

export function registerIpc(): void {
  ipcMain.handle('studio:getSettings', () => ({ libraryRoot: currentRoot(), model: getModelConfig() }));

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
    saveSettings({ ...loadSettings(), libraryRoot: picked });
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

  // ---- agent 域（spec §5 人机边界：写路径只有草稿区；采纳是显式人工动作）----
  ipcMain.handle('studio:agent:ping', async () => ({ version: (await loadPi()).VERSION }));
  ipcMain.handle('studio:agent:send', (_e, contentId: string, text: string) => agentService().send(contentId, text));
  ipcMain.handle('studio:agent:cancel', async (_e, contentId: string) => { await agentService().cancel(contentId); return { ok: true as const }; });
  ipcMain.handle('studio:agent:answer', (_e, contentId: string, questionId: string, answer: string) => { agentService().answer(contentId, questionId, answer); return { ok: true as const }; });
  ipcMain.handle('studio:agent:listDrafts', (_e, contentId: string) => listDrafts(root(), contentId));
  ipcMain.handle('studio:agent:applyDraft', async (_e, contentId: string, name: string) => {
    try { return { ok: true as const, ...(await applyDraft(root(), contentId, name)) }; }
    catch (err) { return fail(err); }
  });
  ipcMain.handle('studio:agent:discardDraft', async (_e, contentId: string, name: string) => {
    try { await discardDraft(root(), contentId, name); return { ok: true as const }; }
    catch (err) { return fail(err); }
  });
  ipcMain.handle('studio:agent:getModelConfig', () => ({ model: getModelConfig() }));
  ipcMain.handle('studio:agent:setModelConfig', (_e, input: { name?: string; baseUrl: string; apiKey: string; modelId: string }) => {
    try { setModelConfig(input); return { ok: true as const }; }
    catch (err) { return fail(err); }
  });
}

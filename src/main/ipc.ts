import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import path from 'node:path';
import { listContents, createContent, readContent, writeBody, updateMeta } from './content-library';
import { loadSettings, saveSettings, detectSyncDir } from './settings';
import { listDrafts, applyDraft, discardDraft } from './drafts';
import { AgentService } from './agent/agent-service';
import { createRealSessionFactory } from './agent/real-session';
import { getModelConfig, setModelConfig, modelConfigView } from './agent/model-config';
import { loadPi } from './agent/pi-loader';
import { readVariant, saveVariant, listVariants, applyVariantDraft, assertPlatform } from './variants';
import { PublishService, type PublishRuntime } from './publish/publish-service';
import { PlatformSession } from './publish/platform-session';
import { xiaohongshuAdapter, createWechatArticleAdapter } from './publish/adapter';
import { WechatMpClient } from './publish/wechat-mp';
import {
  makeSafeStorageCodec, setSecretCodec, getWechatCredentials, setWechatCredentials, wechatCredentialsView,
} from './publish/wechat-credentials';
import { safeStorage } from 'electron';
import { PLATFORM_RULES } from '../shared/platform-rules';
import type { PlatformKey, PublishEventOut, Stage } from '../shared/types';

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
        // CreateTaskResult 原样回传给领域工具（失败如实 isError，不吞返回值）
        createPublishTask: (contentId, platform) => publishService().createTask(contentId, platform as PlatformKey),
      }),
      emit: (ev) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('studio:agent:event', ev); },
      hasModelConfig: () => getModelConfig() !== null,
    });
  }
  return agent;
}
export function disposeAgent(): void { agent?.disposeAll(); agent = null; }

// —— 发布运行时装配（electron 专属层；单测不 import 本段）——
class ElectronPublishRuntime implements PublishRuntime {
  private readonly sessions = new Map<string, PlatformSession>();
  private readonly wechatAdapter = createWechatArticleAdapter({ client: () => wechatClient() });
  adapter(platform: PlatformKey) {
    if (platform === 'xiaohongshu') return xiaohongshuAdapter;
    if (platform === 'wechat-article') return this.wechatAdapter;
    return undefined; // x/jike 适配器 M4；变体规则本地已可用
  }
  private editorUrl(platform: PlatformKey): string {
    if (platform !== 'xiaohongshu') throw new Error('该平台无内嵌编辑器');
    return process.env.CONTENTDECK_XHS_EDITOR_URL
      ?? loadSettings().platforms?.xiaohongshuEditorUrl
      ?? PLATFORM_RULES.xiaohongshu.editorUrl!;
  }
  private allowedHosts(platform: PlatformKey): string[] {
    const hosts = new Set(['creator.xiaohongshu.com']);
    try { hosts.add(new URL(this.editorUrl(platform)).hostname); } catch { /* 非法覆盖地址会在 open 报错 */ }
    return [...hosts];
  }
  private session(platform: PlatformKey): PlatformSession {
    let s = this.sessions.get(platform);
    if (!s) { s = new PlatformSession(platform); this.sessions.set(platform, s); }
    return s;
  }
  async open(platform: PlatformKey) { // 仅 dom 平台（usesSession=true）会被调用：PublishService 按 usesSession 分流，api 平台（公众号文章）无页面不经此处
    const s = this.session(platform);
    await s.open(this.editorUrl(platform), this.allowedHosts(platform));
    return { evaluate: <T>(fn: string, payload: unknown) => s.evaluate<T>(fn, payload), currentUrl: () => s.currentUrl() };
  }
  async show(platform: PlatformKey, visible: boolean) {
    const s = this.session(platform);
    await s.open(this.editorUrl(platform), this.allowedHosts(platform));
    s.attach(visible);
  }
  dispose() { for (const s of this.sessions.values()) s.dispose(); this.sessions.clear(); }
}

function wechatClient(): WechatMpClient | null {
  const cred = getWechatCredentials();
  if (!cred) return null;
  return new WechatMpClient(
    { getAppid: () => getWechatCredentials()?.appid ?? '', getSecret: () => getWechatCredentials()?.secret ?? '' },
    { baseUrl: process.env.CONTENTDECK_WECHAT_API_BASE || undefined },
  );
}

const runtime = new ElectronPublishRuntime();
let publish: PublishService | null = null;
function publishService(): PublishService {
  if (!publish) {
    publish = new PublishService({
      root: currentRoot,
      runtime,
      emit: (ev: PublishEventOut) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('studio:publish:event', ev); },
    });
  }
  return publish;
}
export function disposePublish(): void { runtime.dispose(); publish = null; }

type Fail = { ok: false; code: string; message: string };
function fail(err: unknown): Fail {
  const code = (err as { code?: unknown })?.code;
  return { ok: false, code: typeof code === 'string' && code ? code : 'ERROR', message: err instanceof Error ? err.message : String(err) };
}

export function registerIpc(): void {
  // 凭证编解码装配（spec §3/§6）：safeStorage 加密优先，不可用回退 plain: 前缀并在视图标记
  const { codec, encrypted } = makeSafeStorageCodec(safeStorage);
  setSecretCodec(codec, encrypted);

  // IPC 最小信任（spec §3）：密钥不出主进程——getSettings 只回 libraryRoot（渲染端启动仅需此字段），
  // 模型配置经 studio:agent:getModelConfig 回脱敏视图（hasKey/尾四位）。
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
  ipcMain.handle('studio:agent:getModelConfig', () => ({ model: modelConfigView(getModelConfig()) }));
  ipcMain.handle('studio:agent:setModelConfig', (_e, input: { name?: string; baseUrl: string; apiKey: string; modelId: string }) => {
    try { setModelConfig(input); return { ok: true as const }; }
    catch (err) { return fail(err); }
  });

  // ---- variant 域（读写只在用户动作路径；AI 走 save_variant 草稿区）----
  ipcMain.handle('studio:variant:read', (_e, contentId: string, platform: string) => { assertPlatform(platform); return readVariant(root(), contentId, platform); });
  ipcMain.handle('studio:variant:save', async (_e, contentId: string, platform: string, input: { title: string; topics: string[]; body: string; digest?: string; cover?: string }) => {
    try { assertPlatform(platform); return { ok: true as const, ...(await saveVariant(root(), contentId, platform, input)) }; }
    catch (err) { return fail(err); }
  });
  ipcMain.handle('studio:variant:list', (_e, contentId: string) => listVariants(root(), contentId));
  ipcMain.handle('studio:variant:applyDraft', async (_e, contentId: string, platform: string, name: string) => {
    try { assertPlatform(platform); return { ok: true as const, ...(await applyVariantDraft(root(), contentId, platform, name)) }; }
    catch (err) { return fail(err); }
  });

  // ---- publish 域（spec §5/§6：注入只由人发起；凭证脱敏）----
  ipcMain.handle('studio:publish:tasks', () => publishService().list());
  ipcMain.handle('studio:publish:createTask', (_e, contentId: string, platform: string) => {
    try { assertPlatform(platform); return publishService().createTask(contentId, platform); }
    catch (err) { return fail(err); }
  });
  ipcMain.handle('studio:publish:run', async (_e, taskId: string) => {
    try { await publishService().run(taskId); return { ok: true as const }; }
    catch (err) { return fail(err); }
  });
  ipcMain.handle('studio:publish:retry', (_e, taskId: string) => { publishService().retry(taskId); return { ok: true as const }; });
  ipcMain.handle('studio:publish:checkLogin', (_e, platform: string) => {
    try { assertPlatform(platform); return publishService().checkLogin(platform); }
    catch (err) { return fail(err); }
  });
  ipcMain.handle('studio:publish:showView', async (_e, platform: string, visible: boolean) => {
    try { assertPlatform(platform); await publishService().showView(platform, visible); return { ok: true as const }; }
    catch (err) { return fail(err); }
  });
  ipcMain.handle('studio:publish:getWechatConfig', () => ({ config: wechatCredentialsView() }));
  ipcMain.handle('studio:publish:setWechatConfig', (_e, input: { appid: string; secret: string }) => {
    try { setWechatCredentials(input); return { ok: true as const }; }
    catch (err) { return fail(err); }
  });
}

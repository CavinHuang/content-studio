import type { PlatformKey, PublishEventOut, PublishTask, VariantDoc, WechatMpConfigView } from '../../shared/types';

export type VariantBridge = {
  read(contentId: string, platform: PlatformKey): Promise<VariantDoc | null>;
  save(contentId: string, platform: PlatformKey, input: { title: string; topics: string[]; body: string; digest?: string; cover?: string }): Promise<{ ok: true; savedAt: string } | { ok: false; code: string; message: string }>;
  list(contentId: string): Promise<PlatformKey[]>;
  applyDraft(contentId: string, platform: PlatformKey, name: string): Promise<{ ok: true; savedAt: string } | { ok: false; code: string; message: string }>;
};
export type PublishBridge = {
  tasks(): Promise<PublishTask[]>;
  createTask(contentId: string, platform: PlatformKey): Promise<{ ok: true; task: PublishTask } | { ok: false; code: string; message: string }>;
  run(taskId: string): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  retry(taskId: string): Promise<{ ok: true }>;
  checkLogin(platform: PlatformKey): Promise<{ loggedIn: boolean; message?: string }>;
  showView(platform: PlatformKey, visible: boolean): Promise<{ ok: true }>;
  getWechatConfig(): Promise<{ config: WechatMpConfigView | null }>;
  setWechatConfig(input: { appid: string; secret: string }): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  onEvent(cb: (ev: PublishEventOut) => void): () => void;
};

/** 惰性访问（同 agent-bridge 模式）：jsdom 测试未注入 window.studio.variant/publish 时 import 本模块不炸。 */
function api() {
  const v = window.studio.variant; const p = window.studio.publish;
  if (!v || !p) throw new Error('window.studio.variant/publish 不可用（preload 桥未注入）');
  return { v, p };
}
export const variantBridge: VariantBridge = {
  read: (id, p) => api().v.read(id, p),
  save: (id, p, input) => api().v.save(id, p, input),
  list: (id) => api().v.list(id),
  applyDraft: (id, p, n) => api().v.applyDraft(id, p, n),
};
export const publishBridge: PublishBridge = {
  tasks: () => api().p.tasks(),
  createTask: (id, p) => api().p.createTask(id, p),
  run: (t) => api().p.run(t),
  retry: (t) => api().p.retry(t),
  checkLogin: (p) => api().p.checkLogin(p),
  showView: (p, v) => api().p.showView(p, v),
  getWechatConfig: () => api().p.getWechatConfig(),
  setWechatConfig: (i) => api().p.setWechatConfig(i),
  onEvent: (cb) => api().p.onEvent(cb),
};

import type { AgentEventOut, AgentSendResult, DraftSummary, ModelConfigView } from '../../shared/types';

export type AgentBridge = {
  ping(): Promise<{ version: string }>;
  send(contentId: string, text: string): Promise<AgentSendResult>;
  cancel(contentId: string): Promise<{ ok: true }>;
  answer(contentId: string, questionId: string, answer: string): Promise<{ ok: true }>;
  listDrafts(contentId: string): Promise<DraftSummary[]>;
  applyDraft(contentId: string, name: string): Promise<{ ok: true; savedAt: string } | { ok: false; code: string; message: string }>;
  discardDraft(contentId: string, name: string): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  /** 脱敏视图：明文 apiKey 不出主进程（apiKey 仅有 hasKey/尾四位）。 */
  getModelConfig(): Promise<{ model: ModelConfigView | null }>;
  setModelConfig(input: { name?: string; baseUrl: string; apiKey: string; modelId: string }): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  onEvent(cb: (ev: AgentEventOut) => void): () => void;
};

/**
 * 惰性访问：jsdom 测试未注入 window.studio.agent 时 import 本模块不炸（组件挂载路径在测试中另行 mock）。
 * bridge.ts 的 StudioBridge.agent 是可选字段，此处在调用期才解引用；缺失说明 preload 桥未就绪。
 */
function api(): AgentBridge {
  const a = window.studio.agent;
  if (!a) throw new Error('window.studio.agent 不可用（preload 桥未注入）');
  return a;
}

export const agentBridge: AgentBridge = {
  ping: () => api().ping(),
  send: (contentId, text) => api().send(contentId, text),
  cancel: (contentId) => api().cancel(contentId),
  answer: (contentId, questionId, answer) => api().answer(contentId, questionId, answer),
  listDrafts: (contentId) => api().listDrafts(contentId),
  applyDraft: (contentId, name) => api().applyDraft(contentId, name),
  discardDraft: (contentId, name) => api().discardDraft(contentId, name),
  getModelConfig: () => api().getModelConfig(),
  setModelConfig: (input) => api().setModelConfig(input),
  onEvent: (cb) => api().onEvent(cb),
};

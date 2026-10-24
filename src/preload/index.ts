import { contextBridge, ipcRenderer } from 'electron';
import type { AgentEventOut } from '../shared/types';

contextBridge.exposeInMainWorld('studio', {
  getSettings: () => ipcRenderer.invoke('studio:getSettings'),
  chooseLibrary: () => ipcRenderer.invoke('studio:chooseLibrary'),
  listContents: () => ipcRenderer.invoke('studio:listContents'),
  createContent: (input: { title: string; tags?: string[] }) => ipcRenderer.invoke('studio:createContent', input),
  readContent: (id: string) => ipcRenderer.invoke('studio:readContent', id),
  saveBody: (id: string, body: string) => ipcRenderer.invoke('studio:saveBody', id, body),
  updateMeta: (id: string, patch: Record<string, unknown>) => ipcRenderer.invoke('studio:updateMeta', id, patch),
  agent: {
    ping: () => ipcRenderer.invoke('studio:agent:ping'),
    send: (contentId: string, text: string) => ipcRenderer.invoke('studio:agent:send', contentId, text),
    cancel: (contentId: string) => ipcRenderer.invoke('studio:agent:cancel', contentId),
    answer: (contentId: string, questionId: string, answer: string) => ipcRenderer.invoke('studio:agent:answer', contentId, questionId, answer),
    listDrafts: (contentId: string) => ipcRenderer.invoke('studio:agent:listDrafts', contentId),
    applyDraft: (contentId: string, name: string) => ipcRenderer.invoke('studio:agent:applyDraft', contentId, name),
    discardDraft: (contentId: string, name: string) => ipcRenderer.invoke('studio:agent:discardDraft', contentId, name),
    getModelConfig: () => ipcRenderer.invoke('studio:agent:getModelConfig'),
    setModelConfig: (input: { name?: string; baseUrl: string; apiKey: string; modelId: string }) => ipcRenderer.invoke('studio:agent:setModelConfig', input),
    onEvent: (cb: (ev: AgentEventOut) => void) => {
      const listener = (_e: unknown, ev: AgentEventOut) => cb(ev);
      ipcRenderer.on('studio:agent:event', listener);
      return () => { ipcRenderer.removeListener('studio:agent:event', listener); };
    },
  },
});

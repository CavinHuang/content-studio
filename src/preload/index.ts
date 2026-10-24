import { contextBridge, ipcRenderer } from 'electron';
import type { AgentEventOut, PublishEventOut, VariantDoc, WechatMpConfigView } from '../shared/types';

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
  variant: {
    read: (contentId: string, platform: string) => ipcRenderer.invoke('studio:variant:read', contentId, platform),
    save: (contentId: string, platform: string, input: { title: string; topics: string[]; body: string; digest?: string; cover?: string }) => ipcRenderer.invoke('studio:variant:save', contentId, platform, input),
    list: (contentId: string) => ipcRenderer.invoke('studio:variant:list', contentId),
    applyDraft: (contentId: string, platform: string, name: string) => ipcRenderer.invoke('studio:variant:applyDraft', contentId, platform, name),
  },
  publish: {
    tasks: () => ipcRenderer.invoke('studio:publish:tasks'),
    createTask: (contentId: string, platform: string) => ipcRenderer.invoke('studio:publish:createTask', contentId, platform),
    run: (taskId: string) => ipcRenderer.invoke('studio:publish:run', taskId),
    retry: (taskId: string) => ipcRenderer.invoke('studio:publish:retry', taskId),
    checkLogin: (platform: string) => ipcRenderer.invoke('studio:publish:checkLogin', platform),
    showView: (platform: string, visible: boolean) => ipcRenderer.invoke('studio:publish:showView', platform, visible),
    getWechatConfig: () => ipcRenderer.invoke('studio:publish:getWechatConfig'),
    setWechatConfig: (input: { appid: string; secret: string }) => ipcRenderer.invoke('studio:publish:setWechatConfig', input),
    onEvent: (cb: (ev: PublishEventOut) => void) => {
      const listener = (_e: unknown, ev: PublishEventOut) => cb(ev);
      ipcRenderer.on('studio:publish:event', listener);
      return () => { ipcRenderer.removeListener('studio:publish:event', listener); };
    },
  },
});

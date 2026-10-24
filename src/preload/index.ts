import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('studio', {
  getSettings: () => ipcRenderer.invoke('studio:getSettings'),
  chooseLibrary: () => ipcRenderer.invoke('studio:chooseLibrary'),
  listContents: () => ipcRenderer.invoke('studio:listContents'),
  createContent: (input: { title: string; tags?: string[] }) => ipcRenderer.invoke('studio:createContent', input),
  readContent: (id: string) => ipcRenderer.invoke('studio:readContent', id),
  saveBody: (id: string, body: string) => ipcRenderer.invoke('studio:saveBody', id, body),
  updateMeta: (id: string, patch: Record<string, unknown>) => ipcRenderer.invoke('studio:updateMeta', id, patch),
});

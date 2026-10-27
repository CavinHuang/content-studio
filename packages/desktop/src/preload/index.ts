import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_CHANNELS, type DesktopAPI, type TaskEvent } from '../shared/desktop'

const desktop: DesktopAPI = {
  getAppInfo: () => ipcRenderer.invoke(DESKTOP_CHANNELS.appInfo),
  openDesigns: () => ipcRenderer.invoke(DESKTOP_CHANNELS.openDesigns),
  dbLoad: () => ipcRenderer.invoke(DESKTOP_CHANNELS.dbLoad),
  dbSave: (workspace) => ipcRenderer.invoke(DESKTOP_CHANNELS.dbSave, workspace),
  taskList: () => ipcRenderer.invoke(DESKTOP_CHANNELS.taskList),
  taskSubmit: (input) => ipcRenderer.invoke(DESKTOP_CHANNELS.taskSubmit, input),
  taskSettle: (id, settle) => ipcRenderer.invoke(DESKTOP_CHANNELS.taskSettle, id, settle),
  taskControl: (id, action) => ipcRenderer.invoke(DESKTOP_CHANNELS.taskControl, id, action),
  onTaskEvent: (listener) => {
    const handler = (_event: unknown, payload: TaskEvent) => listener(payload)
    ipcRenderer.on(DESKTOP_CHANNELS.taskEvent, handler)
    return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.taskEvent, handler)
  },
}

contextBridge.exposeInMainWorld('desktop', desktop)

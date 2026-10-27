import { contextBridge, ipcRenderer } from 'electron'
import {
  AI_CHANNELS,
  DESKTOP_CHANNELS,
  DISCOVERY_CHANNELS,
  type AiConfigInput,
  type AiConfigView,
  type AiEvent,
  type AiSendResult,
  type AiTestResult,
  type DesktopAPI,
  type DiscoveryEvent,
  type DiscoverySourceInput,
  type TaskEvent,
} from '../shared/desktop'

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
  aiConfigGet: () => ipcRenderer.invoke(AI_CHANNELS.configGet),
  aiConfigSet: (input: AiConfigInput) => ipcRenderer.invoke(AI_CHANNELS.configSet, input),
  aiConfigClear: () => ipcRenderer.invoke(AI_CHANNELS.configClear),
  aiTest: (baseUrl, apiKey, modelId) => ipcRenderer.invoke(AI_CHANNELS.test, baseUrl, apiKey, modelId),
  aiSend: (sessionKey, text) => ipcRenderer.invoke(AI_CHANNELS.send, sessionKey, text),
  aiCancel: (sessionKey) => ipcRenderer.invoke(AI_CHANNELS.cancel, sessionKey),
  aiAnswer: (questionId, answer) => ipcRenderer.invoke(AI_CHANNELS.answer, questionId, answer),
  onAiEvent: (listener: (event: AiEvent) => void) => {
    const handler = (_event: unknown, payload: AiEvent) => listener(payload)
    ipcRenderer.on(AI_CHANNELS.event, handler)
    return () => ipcRenderer.removeListener(AI_CHANNELS.event, handler)
  },
  discoverySnapshot: () => ipcRenderer.invoke(DISCOVERY_CHANNELS.snapshot),
  discoverySourceList: () => ipcRenderer.invoke(DISCOVERY_CHANNELS.sourceList),
  discoverySourceSave: (input: DiscoverySourceInput) => ipcRenderer.invoke(DISCOVERY_CHANNELS.sourceSave, input),
  discoverySourceDelete: (id: string) => ipcRenderer.invoke(DISCOVERY_CHANNELS.sourceDelete, id),
  discoverySourceRefresh: (id: string) => ipcRenderer.invoke(DISCOVERY_CHANNELS.sourceRefresh, id),
  discoveryRefreshAll: () => ipcRenderer.invoke(DISCOVERY_CHANNELS.refreshAll),
  onDiscoveryEvent: (listener: (event: DiscoveryEvent) => void) => {
    const handler = (_event: unknown, payload: DiscoveryEvent) => listener(payload)
    ipcRenderer.on(DISCOVERY_CHANNELS.event, handler)
    return () => ipcRenderer.removeListener(DISCOVERY_CHANNELS.event, handler)
  },
}

contextBridge.exposeInMainWorld('desktop', desktop)

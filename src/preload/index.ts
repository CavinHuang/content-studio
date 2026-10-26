import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_CHANNELS, type DesktopAPI } from '../shared/desktop'

const desktop: DesktopAPI = {
  getAppInfo: () => ipcRenderer.invoke(DESKTOP_CHANNELS.appInfo),
  openDesigns: () => ipcRenderer.invoke(DESKTOP_CHANNELS.openDesigns),
}

contextBridge.exposeInMainWorld('desktop', desktop)

export const DESKTOP_CHANNELS = {
  appInfo: 'studio:app-info',
  openDesigns: 'studio:open-designs',
} as const

export interface AppInfo {
  name: string
  version: string
  platform: string
  electron: string
}

export interface DesktopAPI {
  getAppInfo(): Promise<AppInfo>
  openDesigns(): Promise<{ ok: boolean; message?: string }>
}

export const DESKTOP_CHANNELS = {
  appInfo: 'studio:app-info',
  openDesigns: 'studio:open-designs',
  dbLoad: 'studio:db:load',
  dbSave: 'studio:db:save',
  taskList: 'studio:task:list',
  taskSubmit: 'studio:task:submit',
  taskSettle: 'studio:task:settle',
  taskControl: 'studio:task:control',
  taskEvent: 'studio:task:event',
} as const

export interface AppInfo {
  name: string
  version: string
  platform: string
  electron: string
  smoke: boolean
}

export type TaskState = 'queued' | 'running' | 'failed' | 'stopped' | 'complete'
export type TaskExtra = { version?: number; videoId?: string; snapshot?: unknown }
export type TaskRecord = {
  id: string
  title: string
  detail: string
  projectId: string
  state: TaskState
  kind: string
  at: string
  updated: string
  progress?: string
  error?: string
  payload?: unknown
  result?: unknown
  extra?: TaskExtra
}
export type TaskSettle = { state: 'complete' | 'failed' | 'stopped'; detail?: string; result?: unknown }
export type TaskEvent = { type: 'snapshot'; tasks: TaskRecord[] } | { type: 'updated'; task: TaskRecord }
export type DbLoadResult = { exists: boolean; workspace: unknown }
export type DbSaveResult = { ok: boolean; at?: string; message?: string }

export interface DesktopAPI {
  getAppInfo(): Promise<AppInfo>
  openDesigns(): Promise<{ ok: boolean; message?: string }>
  dbLoad(): Promise<DbLoadResult>
  dbSave(workspace: unknown): Promise<DbSaveResult>
  taskList(): Promise<TaskRecord[]>
  taskSubmit(input: {
    kind: string
    title: string
    detail: string
    projectId: string
    payload?: unknown
    extra?: TaskExtra
  }): Promise<TaskRecord>
  taskSettle(id: string, settle: TaskSettle): Promise<TaskRecord | null>
  taskControl(id: string, action: 'stop' | 'retry'): Promise<{ ok: boolean }>
  onTaskEvent(listener: (event: TaskEvent) => void): () => void
}

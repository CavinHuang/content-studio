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
  executor?: 'main' | 'renderer'
}
export type TaskSettle = { state: 'complete' | 'failed' | 'stopped'; detail?: string; result?: unknown }
export type TaskSubmitPayload = {
  id?: string
  kind: string
  title: string
  detail: string
  projectId: string
  payload?: unknown
  extra?: TaskExtra
  /** 'main' = 主进程执行器驱动（P2 生成任务）；缺省 'renderer' = 渲染端执行器。 */
  executor?: 'main' | 'renderer'
}
export type TaskEvent = { type: 'snapshot'; tasks: TaskRecord[] } | { type: 'updated'; task: TaskRecord }
export type DbLoadResult = { exists: boolean; workspace: unknown }
export type DbSaveResult = { ok: boolean; at?: string; message?: string }

export const AI_CHANNELS = {
  configGet: 'studio:ai:config:get',
  configSet: 'studio:ai:config:set',
  configClear: 'studio:ai:config:clear',
  test: 'studio:ai:test',
  send: 'studio:ai:send',
  cancel: 'studio:ai:cancel',
  answer: 'studio:ai:answer',
  event: 'studio:ai:event',
} as const

export const KEEP_API_KEY = '__KEEP__'

export type AiConfigInput = { name?: string; baseUrl: string; apiKey: string; modelId: string }
export type ModelConfig = { providerId: string; name?: string; baseUrl: string; apiKey: string; modelId: string }
export type AiConfigView = {
  providerId: string
  name?: string
  baseUrl: string
  modelId: string
  hasKey: boolean
  apiKeyTail: string
  /** safeStorage 不可用时的明文降级警示（Linux 常见）。 */
  plain?: boolean
}
export type AiTestResult = { ok: boolean; message: string; latencyMs?: number }
export type AiSuggestionPayload = { platform: string; original: string; replacement: string; note?: string }
export type AiDraftPayload = { title: string; body: string; note?: string }
export type AiEvent =
  | { type: 'run_start'; sessionKey: string; runId: string }
  | { type: 'delta'; sessionKey: string; runId: string; text: string }
  | {
      type: 'tool_start' | 'tool_end'
      sessionKey: string
      runId: string
      tool: string
      summary?: string
      isError?: boolean
    }
  | { type: 'suggestion'; sessionKey: string; runId: string; suggestion: AiSuggestionPayload }
  | { type: 'draft'; sessionKey: string; runId: string; draft: AiDraftPayload }
  | { type: 'ask'; sessionKey: string; runId: string; questionId: string; question: string; options?: string[] }
  | { type: 'run_end'; sessionKey: string; runId: string; ok: boolean; error?: string }
export type AiSendResult = { ok: boolean; runId?: string; code?: string; message?: string }

export const DISCOVERY_CHANNELS = {
  sourceList: 'studio:discovery:source-list',
  sourceSave: 'studio:discovery:source-save',
  sourceDelete: 'studio:discovery:source-delete',
  sourceRefresh: 'studio:discovery:source-refresh',
  refreshAll: 'studio:discovery:refresh-all',
  snapshot: 'studio:discovery:snapshot',
  event: 'studio:discovery:event',
} as const

/** 来源四类型（UX-SPEC §20.6）；与目标发布平台分别配置。 */
export type DiscoverySourceType = '平台热榜' | '新闻资讯' | 'RSS' | '自定义来源'
/** 持久化状态；「更新中」由渲染端按运行中的刷新任务派生，不落库。 */
export type DiscoverySourceStatus = 'ready' | 'failed' | 'unconfigured' | 'stale'
export type DiscoverySource = {
  id: string
  name: string
  type: DiscoverySourceType
  category: string
  enabled: boolean
  status: DiscoverySourceStatus
  updated: string
  url: string
  /** 内置示例来源：确定性演示数据；未配置真实来源时承担热点域演示（演示保留策略）。 */
  builtin?: boolean
}
export type DiscoverySourceInput = {
  id?: string
  name: string
  type: DiscoverySourceType
  category: string
  enabled: boolean
  url: string
}
/** 聚合后的原文：同一规范化 URL 多源收录合并，sourceIds 保留全部收录方。 */
export type DiscoveryArticle = {
  id: string
  title: string
  sourceIds: string[]
  url: string
  body: string
  published: string
  collected: string
  metric?: string
}
export type DiscoveryTopic = {
  id: string
  title: string
  summary: string
  category: string
  tags: string[]
  image: string
  articles: DiscoveryArticle[]
  angles: string[]
  ageHours: number
  updated: string
}
export type DiscoverySnapshot = {
  sources: DiscoverySource[]
  topics: DiscoveryTopic[]
  /** 最近一次任一来源成功刷新的时间；空串表示从未成功过。 */
  lastSyncAt: string
}
export type DiscoveryEvent = { type: 'snapshot'; snapshot: DiscoverySnapshot }
export type DiscoveryRefreshResult = { ok: boolean; taskId?: string; message?: string }

export interface DesktopAPI {
  getAppInfo(): Promise<AppInfo>
  openDesigns(): Promise<{ ok: boolean; message?: string }>
  dbLoad(): Promise<DbLoadResult>
  dbSave(workspace: unknown): Promise<DbSaveResult>
  taskList(): Promise<TaskRecord[]>
  taskSubmit(input: TaskSubmitPayload): Promise<TaskRecord>
  taskSettle(id: string, settle: TaskSettle): Promise<TaskRecord | null>
  taskControl(id: string, action: 'stop' | 'retry'): Promise<{ ok: boolean }>
  onTaskEvent(listener: (event: TaskEvent) => void): () => void
  aiConfigGet(): Promise<AiConfigView | null>
  aiConfigSet(input: AiConfigInput): Promise<AiConfigView>
  aiConfigClear(): Promise<{ ok: boolean }>
  aiTest(baseUrl: string, apiKey: string, modelId: string): Promise<AiTestResult>
  aiSend(sessionKey: string, text: string): Promise<AiSendResult>
  aiCancel(sessionKey: string): Promise<{ ok: boolean }>
  aiAnswer(questionId: string, answer: string): Promise<{ ok: boolean }>
  onAiEvent(listener: (event: AiEvent) => void): () => void
  discoverySnapshot(): Promise<DiscoverySnapshot>
  discoverySourceList(): Promise<DiscoverySource[]>
  discoverySourceSave(input: DiscoverySourceInput): Promise<DiscoverySource>
  discoverySourceDelete(id: string): Promise<{ ok: boolean; message?: string }>
  discoverySourceRefresh(id: string): Promise<DiscoveryRefreshResult>
  discoveryRefreshAll(): Promise<DiscoveryRefreshResult>
  onDiscoveryEvent(listener: (event: DiscoveryEvent) => void): () => void
}

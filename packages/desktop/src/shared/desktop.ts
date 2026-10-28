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

/** UX-SPEC §12 六态：排队/运行/部分完成/失败/已停止/完成。partial＝已完成产物可用；可重试失败项。 */
export type TaskState = 'queued' | 'running' | 'partial' | 'failed' | 'stopped' | 'complete'
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
export type TaskSettle = { state: 'complete' | 'partial' | 'failed' | 'stopped'; detail?: string; result?: unknown }
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
  /** 自动刷新间隔（分钟）；0 或缺省 = 仅手动刷新。主进程调度器按此到期提交刷新任务。 */
  refreshMinutes?: number
}
export type DiscoverySourceInput = {
  id?: string
  name: string
  type: DiscoverySourceType
  category: string
  enabled: boolean
  url: string
  /** 自动刷新间隔（分钟）；0 = 仅手动。编辑时缺省表示沿用原值。 */
  refreshMinutes?: number
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

export const PUBLISH_CHANNELS = {
  configGet: 'studio:publish:config:get',
  configSave: 'studio:publish:config:save',
  configClear: 'studio:publish:config:clear',
  canInject: 'studio:publish:can-inject',
  renderHtml: 'studio:publish:render-html',
  saveDraft: 'studio:publish:save-draft',
  redbookOpenSession: 'studio:publish:redbook:open-session',
  redbookLoginState: 'studio:publish:redbook:login-state',
  redbookInjectDraft: 'studio:publish:redbook:inject-draft',
} as const

/** 渲染端回显不出密钥：未改 secret 就保存时传该占位，沿用已存值。 */
export const KEEP_WECHAT_SECRET = '__KEEP_WECHAT_SECRET__'

export type WechatConfigInput = { appId: string; secret: string }
export type WechatConfigView = {
  appId: string
  hasSecret: boolean
  secretTail: string
  /** safeStorage 不可用时的明文降级警示（Linux 常见）。 */
  plain?: boolean
}
export type WechatProbeResult = { ok: boolean; code?: string; message: string }
export type WechatHtmlResult = { ok: boolean; html?: string; message?: string }
/** 存草稿任务入参：assets 为正文 asset: 图片快照（素材 id → data URL），随批次冻结。 */
export type WechatDraftInput = {
  projectId: string
  batchId?: string
  title: string
  body: string
  digest?: string
  author?: string
  assets?: Record<string, string>
}
export type WechatDraftResult = { ok: boolean; taskId?: string; code?: string; message?: string }

/** 小红书登录态（探测结果）。 */
export type RedbookLoginState = 'loggedIn' | 'notLoggedIn'
/**
 * 小红书平台会话视图：openSession/loginState 的统一返回。
 * ok=true 时 loginState 给出探测结论；ok=false 时 code/message 说明原因（地址不合法/白名单拦截/网络等）。
 */
export type RedbookSessionView = {
  ok: boolean
  loginState?: RedbookLoginState
  code?: string
  message?: string
}
/** 小红书注入任务入参：tags 为批次快照的话题标签原始串（如「#个人创作 #创作习惯」或逗号分隔）。 */
export type RedbookDraftInput = {
  projectId: string
  batchId?: string
  title: string
  body: string
  tags?: string
}
export type RedbookDraftResult = { ok: boolean; taskId?: string; code?: string; message?: string }

export const VIDEO_CHANNELS = {
  exportOpenFolder: 'studio:video:export:open-folder',
  ttsConfigGet: 'studio:video:tts:config:get',
  ttsConfigSet: 'studio:video:tts:config:set',
  ttsConfigClear: 'studio:video:tts:config:clear',
  mediaRead: 'studio:video:media:read',
} as const

/** P5 视频导出任务入参：分镜按已采用版本与素材快照冻结后随任务提交（§12 快照语义）。 */
export type VideoExportShot = {
  id: string
  title: string
  subtitle?: string
  /** 图片 data URL（内置插画或素材图）；缺省为纯文字分镜。 */
  image?: string
  /** 分镜时长（毫秒）。 */
  durationMs: number
}
export type VideoExportPayload = {
  videoId: string
  version: number
  title: string
  fps: number
  width: number
  height: number
  shots: VideoExportShot[]
}
/** 语音服务配置（OpenAI 兼容 /audio/speech）：可与模型服务同 provider，也可独立。 */
export type TtsConfigInput = { baseUrl: string; apiKey: string; modelId: string; voice: string }
export type TtsConfigView = {
  baseUrl: string
  modelId: string
  voice: string
  hasKey: boolean
  apiKeyTail: string
  /** safeStorage 不可用时的明文降级警示（Linux 常见）。 */
  plain?: boolean
}
export type ExportFolderResult = { ok: boolean; message?: string }
/** 配音音频读取：data 为音频字节（mp3），渲染端用 Blob 播放并用 Audio 解码测时长。 */
export type VideoMediaView = { ok: true; mime: string; data: Uint8Array } | { ok: false; message: string }


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
  publishConfigGet(): Promise<WechatConfigView | null>
  publishConfigSave(input: WechatConfigInput): Promise<WechatConfigView>
  publishConfigClear(): Promise<{ ok: boolean }>
  publishCanInject(): Promise<WechatProbeResult>
  publishRenderHtml(body: string): Promise<WechatHtmlResult>
  publishSaveDraft(input: WechatDraftInput): Promise<WechatDraftResult>
  publishRedbookOpenSession(): Promise<RedbookSessionView>
  publishRedbookLoginState(): Promise<RedbookSessionView>
  publishRedbookInjectDraft(input: RedbookDraftInput): Promise<RedbookDraftResult>
  videoExportOpenFolder(): Promise<ExportFolderResult>
  ttsConfigGet(): Promise<TtsConfigView | null>
  ttsConfigSet(input: TtsConfigInput): Promise<TtsConfigView>
  ttsConfigClear(): Promise<{ ok: boolean }>
  videoMediaRead(mediaId: string): Promise<VideoMediaView>
}

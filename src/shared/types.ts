export const STAGES = ['idea', 'draft', 'review', 'variants', 'publishing', 'published', 'retro'] as const;
export type Stage = (typeof STAGES)[number];
export type ContentMeta = {
  id: string; title: string; stage: Stage; tags: string[];
  created: string; media: 'article' | 'video'; folder: string;
};
export type LibraryScan = { items: ContentMeta[]; warnings: string[] };
export type Content = ContentMeta & { body: string };
export type DraftSummary = { name: string; created: string; note: string; bytes: number; platform?: string };
export type ModelConfig = {
  providerId: 'contentdeck';
  name?: string;
  baseUrl: string; // OpenAI 兼容端点，如 https://api.openai.com/v1
  apiKey: string;
  modelId: string;
};
export type Settings = {
  libraryRoot: string | null; model?: ModelConfig | null;
  wechatMp?: { appid: string; secretStore: string } | null;
  platforms?: { xiaohongshuEditorUrl?: string } | null;
};
/** 一稿多态平台键（M3：小红书/X/即刻 DOM 注入 + 公众号文章 API；知乎等 M4）。 */
export type PlatformKey = 'xiaohongshu' | 'x' | 'jike' | 'wechat-article';
export type VariantDoc = {
  platform: PlatformKey;
  title: string;        // X 动态恒为空
  topics: string[];     // 即刻必填；小红书可选；其余平台忽略
  body: string;
  digest?: string;      // 仅 wechat-article（公众号摘要，≤120 字）
  cover?: string;       // 仅 wechat-article（内容库内相对路径，如 assets/cover.png）
  updatedAt?: string;
};
export type VariantValidation = { ok: boolean; errors: string[]; warnings: string[] };
/** 渲染端可见的设置视图：getSettings 只回 libraryRoot——model 含明文 apiKey，不出主进程（spec §3 IPC 最小信任）。 */
export type SettingsView = { libraryRoot: string | null };
export type ChooseLibraryResult = { libraryRoot: string } | { cancelled: true };
/** 渲染端可见的模型配置视图（apiKey 不出主进程；尾四位仅供回显确认）。 */
export type ModelConfigView = {
  providerId: 'contentdeck';
  name?: string;
  baseUrl: string;
  modelId: string;
  hasKey: boolean;
  apiKeyTail: string;
};
/** setModelConfig 的 apiKey 占位值：渲染端拿不到已存 key，用户留空保存时传此值，主进程沿用旧 key。 */
export const KEEP_API_KEY = '__KEEP_SAVED_KEY__';

/** 渲染端可见的公众号配置视图：secret 不出主进程，只有「是否已存/尾四位/是否加密」。 */
export type WechatMpConfigView = { appid: string; hasSecret: boolean; secretTail: string; encrypted: boolean };
/** setWechatCredentials 的 secret 占位值：用户未改密钥保存时传此值，主进程沿用旧 secret。 */
export const KEEP_WECHAT_SECRET = '__KEEP_SAVED_SECRET__';

/** 主进程→渲染进程的 agent 事件（webContents.send('studio:agent:event', ev)）。 */
export type AgentEventOut =
  | { kind: 'run_start'; contentId: string; runId: string }
  | { kind: 'delta'; contentId: string; runId: string; text: string }
  | { kind: 'tool_start'; contentId: string; runId: string; tool: string; args: string }
  | { kind: 'tool_end'; contentId: string; runId: string; tool: string; isError: boolean; summary: string }
  | { kind: 'ask'; contentId: string; runId: string; questionId: string; question: string; options?: string[] }
  | { kind: 'run_end'; contentId: string; runId: string; ok: boolean; error?: string }
  | { kind: 'drafts_changed'; contentId: string };

export type AgentErrorCode =
  | 'EMPTY_INPUT' | 'AGENT_BUSY' | 'NO_MODEL_CONFIG'
  | 'NO_LIBRARY' | 'CONTENT_NOT_FOUND' | 'MODEL_NOT_FOUND' | 'AGENT_ERROR';
export type AgentSendResult =
  | { ok: true; runId: string }
  | { ok: false; code: AgentErrorCode; message: string };

/** 发布任务（M3：任务态在内存，publishes/SQLite 持久化随 M4 交付）。 */
export type PublishPhase = 'queued' | 'validating' | 'login_check' | 'injecting' | 'reading_back' | 'prepared' | 'failed';
export type PublishFailureCategory = 'not_logged_in' | 'page_changed' | 'network' | 'already_has_content' | 'api_error' | 'validation' | 'unknown';
export type PublishTask = {
  taskId: string; contentId: string; platform: PlatformKey; phase: PublishPhase;
  category?: PublishFailureCategory; message?: string;
  draftUrl?: string; mediaId?: string; variantPath?: string;
  readBack?: { title: string; bodyChars: number; url: string }; updatedAt: string;
};
export type PublishEventOut = { kind: 'task_update'; task: PublishTask };

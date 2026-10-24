export const STAGES = ['idea', 'draft', 'review', 'variants', 'publishing', 'published', 'retro'] as const;
export type Stage = (typeof STAGES)[number];
export type ContentMeta = {
  id: string; title: string; stage: Stage; tags: string[];
  created: string; media: 'article' | 'video'; folder: string;
};
export type LibraryScan = { items: ContentMeta[]; warnings: string[] };
export type Content = ContentMeta & { body: string };
export type DraftSummary = { name: string; created: string; note: string; bytes: number };
export type ModelConfig = {
  providerId: 'contentdeck';
  name?: string;
  baseUrl: string; // OpenAI 兼容端点，如 https://api.openai.com/v1
  apiKey: string;
  modelId: string;
};
export type Settings = { libraryRoot: string | null; model?: ModelConfig | null };
export type ChooseLibraryResult = { libraryRoot: string } | { cancelled: true };

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

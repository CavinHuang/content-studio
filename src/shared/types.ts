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

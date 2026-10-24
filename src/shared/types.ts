export const STAGES = ['idea', 'draft', 'review', 'variants', 'publishing', 'published', 'retro'] as const;
export type Stage = (typeof STAGES)[number];
export type ContentMeta = {
  id: string; title: string; stage: Stage; tags: string[];
  created: string; media: 'article' | 'video'; folder: string;
};
export type LibraryScan = { items: ContentMeta[]; warnings: string[] };
export type Content = ContentMeta & { body: string };
export type DraftSummary = { name: string; created: string; note: string; bytes: number };
export type Settings = { libraryRoot: string | null };
export type ChooseLibraryResult = { libraryRoot: string } | { cancelled: true };

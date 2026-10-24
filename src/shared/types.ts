export const STAGES = ['idea', 'draft', 'review', 'variants', 'publishing', 'published', 'retro'] as const;
export type Stage = (typeof STAGES)[number];
export type ContentMeta = {
  id: string; title: string; stage: Stage; tags: string[];
  created: string; media: 'article' | 'video'; folder: string;
};
export type LibraryScan = { items: ContentMeta[]; warnings: string[] };
export type Content = ContentMeta & { body: string };

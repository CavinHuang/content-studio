export const STAGES = ['idea', 'draft', 'review', 'variants', 'publishing', 'published', 'retro'] as const;
export type Stage = (typeof STAGES)[number];

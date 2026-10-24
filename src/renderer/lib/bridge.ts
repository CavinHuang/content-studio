import type {
  ChooseLibraryResult, Content, ContentMeta, LibraryScan, Settings, Stage,
} from '../../shared/types';

export type StudioBridge = {
  getSettings(): Promise<Settings>;
  chooseLibrary(): Promise<ChooseLibraryResult>;
  listContents(): Promise<LibraryScan>;
  createContent(input: { title: string; tags?: string[] }): Promise<ContentMeta>;
  readContent(id: string): Promise<Content>;
  saveBody(id: string, body: string): Promise<{ savedAt: string }>;
  updateMeta(id: string, patch: { stage?: Stage; tags?: string[]; title?: string }): Promise<ContentMeta>;
};

declare global {
  interface Window { studio: StudioBridge }
}

export const bridge: StudioBridge = window.studio;

import type {
  ChooseLibraryResult, Content, ContentMeta, LibraryScan, SettingsView, Stage,
} from '../../shared/types';
import type { AgentBridge } from './agent-bridge';

export type StudioBridge = {
  getSettings(): Promise<SettingsView>;
  chooseLibrary(): Promise<ChooseLibraryResult>;
  listContents(): Promise<LibraryScan>;
  createContent(input: { title: string; tags?: string[] }): Promise<ContentMeta>;
  readContent(id: string): Promise<Content>;
  saveBody(id: string, body: string): Promise<{ savedAt: string }>;
  updateMeta(id: string, patch: { stage?: Stage; tags?: string[]; title?: string }): Promise<ContentMeta>;
  /** agent 桥经 preload 注入；渲染端统一经 lib/agent-bridge 使用（可选以兼容未注入的测试环境）。 */
  agent?: AgentBridge;
};

declare global {
  interface Window { studio: StudioBridge }
}

export const bridge: StudioBridge = window.studio;

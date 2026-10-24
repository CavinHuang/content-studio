import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Settings } from '../shared/types';

export type { Settings };

/** 为可测性依赖注入：main 里 whenReady 后设 CONTENTDECK_USER_DATA，测试可指向临时目录。 */
export function settingsFile(): string {
  return path.join(process.env.CONTENTDECK_USER_DATA ?? '', 'settings.json');
}

export function loadSettings(): Settings {
  try { return JSON.parse(readFileSync(settingsFile(), 'utf8')) as Settings; }
  catch { return { libraryRoot: null }; }
}

export function saveSettings(s: Settings): void {
  mkdirSync(path.dirname(settingsFile()), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(s, null, 2), 'utf8');
}

export function detectSyncDir(p: string): boolean {
  return /onedrive|dropbox|坚果云|百度网盘|google drive/i.test(p);
}

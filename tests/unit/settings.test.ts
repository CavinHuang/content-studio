import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { detectSyncDir, loadSettings, saveSettings, settingsFile } from '../../src/main/settings';

describe('detectSyncDir', () => {
  it('识别常见网盘同步目录', () => {
    expect(detectSyncDir('C:/Users/leo/OneDrive/docs')).toBe(true);
    expect(detectSyncDir('D:/坚果云/内容库')).toBe(true);
    expect(detectSyncDir('D:/workspace/my-library')).toBe(false);
  });
});

describe('loadSettings / saveSettings（CONTENTDECK_USER_DATA 注入）', () => {
  const prev = process.env.CONTENTDECK_USER_DATA;
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'deck-settings-'));
    process.env.CONTENTDECK_USER_DATA = dir;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.CONTENTDECK_USER_DATA;
    else process.env.CONTENTDECK_USER_DATA = prev;
    rmSync(dir, { recursive: true, force: true });
  });
  it('无 settings.json 时返回默认 libraryRoot=null', () => {
    expect(loadSettings()).toEqual({ libraryRoot: null });
  });
  it('saveSettings 落盘 userData/settings.json 且可回读', () => {
    saveSettings({ libraryRoot: 'D:/我的内容库' });
    expect(settingsFile()).toBe(path.join(dir, 'settings.json'));
    expect(JSON.parse(readFileSync(settingsFile(), 'utf8'))).toEqual({ libraryRoot: 'D:/我的内容库' });
    expect(loadSettings()).toEqual({ libraryRoot: 'D:/我的内容库' });
  });
});

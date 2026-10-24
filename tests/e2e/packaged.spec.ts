import { test, expect, _electron } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// electron-packager 用 productName（package.json 的 ContentDeck，而非 name 的 contentdeck）
// 命名输出目录与可执行文件，且未在 forge.config 覆写——macOS 产物在 .app 包内。
// Linux 文件系统大小写敏感：路径写错 → existsSync 恒 false → CI 上唯一打包冒烟静默 skip。
const exe = path.join('out', process.platform === 'win32'
  ? 'ContentDeck-win32-x64/ContentDeck.exe'
  : process.platform === 'darwin'
    ? 'ContentDeck-darwin-x64/ContentDeck.app/Contents/MacOS/ContentDeck'
    : 'ContentDeck-linux-x64/ContentDeck');

test.skip(!existsSync(exe), `打包产物不存在（先 npm run package）: ${exe}`);

test('打包产物内 pi 可加载、技能资源可解析（agent ping + 无会话启动）', async () => {
  // executablePath 直接启动打包产物自身的 Electron（args 会被 dev electron.exe 误当入口脚本加载）
  const app = await _electron.launch({
    executablePath: exe,
    env: { ...process.env, CONTENTDECK_LIBRARY: mkdtempSync(path.join(tmpdir(), 'deck-pkg-')) },
  });
  const page = await app.firstWindow();
  const ping = await page.evaluate(() => window.studio.agent!.ping());
  expect(ping.version).toBe('1.4.0');
  await app.close();
});

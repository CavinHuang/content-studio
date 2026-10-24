import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function launch(): Promise<{ app: ElectronApplication; page: Page; lib: string }> {
  const lib = mkdtempSync(path.join(tmpdir(), 'deck-e2e-'));
  const app = await _electron.launch({
    args: ['.'],
    env: { ...process.env, CONTENTDECK_LIBRARY: lib },
  });
  const page = await app.firstWindow();
  return { app, page, lib };
}

test('建内容→编辑→自动保存→重启后持久存在→移动 stage', async () => {
  const { app, page, lib } = await launch();
  await page.getByRole('button', { name: '新建内容' }).click();
  await page.getByLabel('标题').fill('e2e 第一篇');
  await page.getByRole('button', { name: '创建' }).click();
  await expect(page.getByText('e2e 第一篇')).toBeVisible();
  await page.getByRole('button', { name: 'e2e 第一篇', exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.type('# e2e 正文\n\n自动保存验证');
  await expect(page.getByRole('status')).toHaveText(/已保存|保存中…/, { timeout: 5_000 });
  await expect(page.getByRole('status')).toHaveText('已保存', { timeout: 5_000 });
  await app.close();

  const relaunch = await _electron.launch({ args: ['.'], env: { ...process.env, CONTENTDECK_LIBRARY: lib } });
  const p2 = await relaunch.firstWindow();
  await expect(p2.getByRole('button', { name: 'e2e 第一篇', exact: true })).toBeVisible();
  await p2.getByRole('button', { name: 'e2e 第一篇', exact: true }).click();
  await expect(p2.locator('.cm-content')).toContainText('自动保存验证');
  await p2.getByRole('button', { name: '← 返回看板' }).click();
  await p2.getByRole('button', { name: '移动 e2e 第一篇' }).click();
  await p2.getByRole('menuitem', { name: '移动到 draft' }).click();
  const draftCol = p2.getByLabel('阶段 draft');
  await expect(draftCol).toContainText('e2e 第一篇');
  await relaunch.close();

  // 直接断言磁盘文件（folder 名含日期，扫描确认）：
  const folder = readdirSync(lib).find((f) => f.endsWith('e2e-第一篇'))!;
  const raw = readFileSync(path.join(lib, folder, 'content.md'), 'utf8');
  expect(raw).toContain('stage: draft');
  expect(raw).toContain('自动保存验证');
  expect(existsSync(path.join(lib, folder, 'assets'))).toBe(true);
});

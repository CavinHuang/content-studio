import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MockOpenai, type MockScript } from '../helpers/mock-openai';

async function launch(lib: string, userData?: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await _electron.launch({
    args: ['.'],
    env: { ...process.env, CONTENTDECK_LIBRARY: lib, ...(userData ? { CONTENTDECK_USER_DATA: userData } : {}) },
  });
  return { app, page: await app.firstWindow() };
}
function makeLib(): string { return mkdtempSync(path.join(tmpdir(), 'deck-m2-')); }
function makeUserData(mockUrl?: string, libraryRoot?: string): string {
  const ud = mkdtempSync(path.join(tmpdir(), 'deck-m2-ud-'));
  writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(mockUrl
    ? { libraryRoot: libraryRoot ?? null, model: { providerId: 'contentdeck', name: 'E2E Mock', baseUrl: mockUrl, apiKey: 'test-key', modelId: 'mock-writer' } }
    : { libraryRoot: libraryRoot ?? null }), 'utf8');
  return ud;
}
function findContentFolder(lib: string): string {
  return readdirSync(lib).find((f) => /^\d{4}-\d{2}-\d{2}-/.test(f))!;
}
function contentIdOf(lib: string): string {
  const folder = findContentFolder(lib);
  return readFileSync(path.join(lib, folder, 'content.md'), 'utf8').match(/id: (c_\d{8}_[0-9a-f]{4})/)![1]!;
}

test('创作流：技能→工具写草稿→人工采纳入正文→会话持久化并续聊', async () => {
  const mock = new MockOpenai((({ messages }) => {
    const toolMsgs = JSON.stringify(messages.filter((m) => m.role === 'tool'));
    if (!messages.some((m) => m.role === 'tool')) return [{ type: 'tool', name: 'list_contents', args: {} }];
    const id = toolMsgs.match(/c_\d{8}_[0-9a-f]{4}/)?.[0];
    if (id && !toolMsgs.includes('草稿已保存')) {
      return [{ type: 'tool', name: 'write_draft', args: { id, markdown: '# AI 初稿\n\n这是按「长文初稿」技能产出的草稿正文。', note: '长文初稿' } }];
    }
    return [{ type: 'text', text: '初稿已存入草稿区，请在草稿区确认采纳。' }];
  }) as MockScript);
  const url = await mock.start();
  const lib = makeLib();
  const ud = makeUserData(url, lib);

  const first = await launch(lib, ud);
  // Electron 内 pi 加载实证（探针要求的 Electron 内验证）
  const ping = await first.page.evaluate(() => window.studio.agent!.ping());
  expect(ping.version).toBe('1.4.0');

  await first.page.getByRole('button', { name: '新建内容' }).click();
  await first.page.getByLabel('标题').fill('AI 协作第一篇');
  await first.page.getByRole('button', { name: '创建' }).click();
  await first.page.getByRole('button', { name: 'AI 协作第一篇', exact: true }).click();
  await first.page.getByRole('button', { name: '长文初稿' }).click();
  await first.page.getByLabel('AI 指令输入').fill('/skill:longform-draft 主题：本地优先的创作工具');
  await first.page.getByRole('button', { name: '发送' }).click();

  await expect(first.page.getByLabel('AI 对话记录')).toContainText('初稿已存入草稿区', { timeout: 30_000 });
  await expect(first.page.getByRole('list', { name: '草稿区' })).toContainText('长文初稿');
  await first.page.getByRole('button', { name: /采纳入正文/ }).click();
  await expect(first.page.locator('.cm-content')).toContainText('# AI 初稿', { timeout: 10_000 });
  await first.app.close();

  // 磁盘断言：正文含草稿全文；草稿被消费；会话 JSONL 落库
  const id = contentIdOf(lib);
  const folder = findContentFolder(lib);
  expect(readFileSync(path.join(lib, folder, 'content.md'), 'utf8')).toContain('# AI 初稿');
  expect(readdirSync(path.join(lib, '.studio', 'drafts', id))).toEqual([]);
  expect(readdirSync(path.join(lib, '.studio', 'pi-sessions', id)).some((f) => f.endsWith('.jsonl'))).toBe(true);

  // 重启续聊：同一内容同一会话，历史进入模型请求
  const second = await launch(lib, ud);
  await second.page.getByRole('button', { name: 'AI 协作第一篇', exact: true }).click();
  await second.page.getByLabel('AI 指令输入').fill('继续写一段');
  await second.page.getByRole('button', { name: '发送' }).click();
  // 等模型实际回复（run 完成）再查 mock：只等「继续」会被用户输入行立即满足，产生竞态
  await expect(second.page.getByLabel('AI 对话记录')).toContainText('初稿已存入草稿区', { timeout: 30_000 });
  const last = mock.lastRequest();
  expect(JSON.stringify(last?.messages)).toContain('继续写一段');
  expect((last?.messages?.length ?? 0)).toBeGreaterThanOrEqual(4); // 历史随会话恢复
  await second.app.close();
  await mock.close();
});

test('ask_user：运行中问询，用户点选项后回答进入模型上下文（UI 配置模型全流程）', async () => {
  const mock = new MockOpenai((({ messages }) => {
    const asked = JSON.stringify(messages.filter((m) => m.role === 'tool')).includes('用户回答');
    if (!asked) {
      return [{ type: 'tool', name: 'ask_user', args: { question: '这篇内容的目标读者是谁？', options: ['技术读者', '普通读者'] } }];
    }
    return [{ type: 'text', text: '好，将面向所选读者继续。' }];
  }) as MockScript);
  const url = await mock.start();
  const lib = makeLib();
  const ud = makeUserData(undefined, lib); // 无模型配置——走 UI 配置路径

  const { app, page } = await launch(lib, ud);
  await page.getByRole('button', { name: '新建内容' }).click();
  await page.getByLabel('标题').fill('问询流程');
  await page.getByRole('button', { name: '创建' }).click();
  await page.getByRole('button', { name: '问询流程', exact: true }).click();

  // UI 配置模型
  await page.getByRole('button', { name: 'AI 设置' }).click();
  await page.getByLabel('API 地址').fill(url);
  await page.getByLabel('API Key').fill('test-key');
  await page.getByLabel('模型 ID').fill('mock-writer');
  await page.getByRole('button', { name: '保存设置' }).click();

  await page.getByLabel('AI 指令输入').fill('帮我定方向');
  await page.getByRole('button', { name: '发送' }).click();
  const dlg = page.getByRole('dialog', { name: 'AI 问询' });
  await expect(dlg).toBeVisible({ timeout: 30_000 });
  await expect(dlg).toContainText('这篇内容的目标读者是谁？');
  await dlg.getByRole('button', { name: '技术读者' }).click();
  await expect(page.getByLabel('AI 对话记录')).toContainText('面向所选读者', { timeout: 30_000 });
  // 回答确实回到了模型（tool result 消息中）
  expect(JSON.stringify(mock.lastRequest()?.messages)).toContain('技术读者');
  await app.close();
  await mock.close();
});

import { test, expect, _electron as electron } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

test('desktop boots with its isolated preload bridge and editable React workspace', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'content-studio-smoke-'))
  const environment: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  delete environment.ELECTRON_RUN_AS_NODE
  environment.STUDIO_SMOKE = '1'
  environment.STUDIO_USER_DATA = userData
  const executablePath = process.env.STUDIO_TEST_EXECUTABLE
  const application = await electron.launch({
    executablePath,
    args: executablePath ? [] : ['.'],
    env: environment,
  })
  try {
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page).toHaveTitle('Content Studio')
    await expect(page.getByRole('complementary', { name: '内容导航' })).toBeVisible()
    const info = await page.evaluate(() => window.desktop!.getAppInfo())
    expect(info.name).toBe('Content Studio')
    expect(info.electron).toBe('45.0.0')
    expect(await application.evaluate(({ app }) => app.isPackaged)).toBe(Boolean(executablePath))
    if (executablePath) {
      expect(existsSync(join(dirname(executablePath), 'resources/ux/index.html'))).toBe(true)
      expect(existsSync(join(dirname(executablePath), 'resources/icon.png'))).toBe(true)
    }
    expect(await page.evaluate(() => typeof (window as unknown as Record<string, unknown>).require)).toBe(
      'undefined',
    )
    await page.getByRole('tab', { name: '编辑', exact: true }).click()
    await page.getByLabel('文稿标题', { exact: true }).fill('桌面应用初始化验证')
    await page.getByLabel('文稿正文', { exact: true }).fill('第一篇文稿可以编辑，并保存在当前设备。')
    await page.reload()
    await page.getByRole('tab', { name: '编辑', exact: true }).click()
    await expect(page.getByLabel('文稿标题', { exact: true })).toHaveValue('桌面应用初始化验证')
    await expect(page.getByLabel('文稿正文', { exact: true })).toHaveValue(
      '第一篇文稿可以编辑，并保存在当前设备。',
    )
    await page.getByRole('tab', { name: '预览', exact: true }).click()
    await expect(page.locator('.document-preview')).toContainText('第一篇文稿可以编辑')
    await page.getByRole('button', { name: '新建内容', exact: false }).first().click()
    await expect(page.getByLabel('文稿标题', { exact: true })).toHaveValue('')
    expect(errors).toEqual([])
  } finally {
    await application.close()
  }
})

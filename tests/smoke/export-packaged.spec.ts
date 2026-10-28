import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 打包形态真实视频导出（P5）：只在 STUDIO_TEST_EXECUTABLE 指向打包产物时运行。
 * 打包形态必须随包带齐渲染组件（remotion 入口 + 生产依赖 + Chrome Headless Shell），
 * 本用例端到端实证：导出任务真实渲染出 MP4，产物落在用户数据目录 exports/。
 * 开发形态跑不过这里（入口/浏览器按开发环境另行解析），故整体跳过。
 */
const packagedExe = process.env.STUDIO_TEST_EXECUTABLE
test.skip(!packagedExe, '仅打包形态（STUDIO_TEST_EXECUTABLE）运行真实视频导出')

let app: ElectronApplication, page: Page
let errors: string[]
let userData: string
let mainLogs: string[]
test.setTimeout(240_000)

test.beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'studio-export-'))
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  delete env.ELECTRON_RUN_AS_NODE
  env.STUDIO_SMOKE = '1'
  env.STUDIO_USER_DATA = userData
  // 打包形态排障：渲染失败时主进程完整错误进 stderr，随失败断言一起输出。
  env.STUDIO_RENDER_DEBUG = '1'
  app = await electron.launch({ executablePath: packagedExe, args: [], env })
  mainLogs = []
  app.process().stdout?.on('data', (chunk) => mainLogs.push(String(chunk)))
  app.process().stderr?.on('data', (chunk) => mainLogs.push(String(chunk)))
  page = await app.firstWindow()
  errors = []
  page.on('pageerror', (err) => errors.push(String(err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  await page.setViewportSize({ width: 1480, height: 960 })
})

test.afterEach(async ({}, info) => {
  try {
    // 诊断截图 best-effort（打包形态隐藏窗口偶发挂起，见 workflows.spec 同注）；断言保持严格。
    await page.screenshot({ path: info.outputPath('workspace.png'), timeout: 10_000 }).catch(() => {})
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('真实导出：随包渲染组件产出 MP4（帧级进度 → 导出完成 → 文件落盘）', async () => {
  await expect(page.getByLabel('文稿标题', { exact: true })).toHaveValue('让灵感成为作品')
  const artifacts = () => page.getByRole('tablist', { name: '内容产物' })
  await artifacts().getByRole('tab', { name: '视频', exact: true }).click()
  await page.getByRole('button', { name: /Agent 代码创作.*把碎片时间/ }).click()
  await page.getByRole('button', { name: '所有视频', exact: true }).click()
  await page.getByRole('button', { name: /素材分镜.*让创作回到日常/ }).click()
  await page.getByRole('tab', { name: '成片预览', exact: true }).click()
  await page.getByRole('button', { name: '导出视频', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '开始导出', exact: true }).click()
  const result = page.getByRole('region', { name: '视频导出状态', exact: true })
  // 真实渲染耗时（bundle + 浏览器 + 编码），不设固定进度文案断言，只看终态。
  const done = result.getByText('导出完成', { exact: true })
  try {
    await expect(done).toBeVisible({ timeout: 200_000 })
  } catch (error) {
    // 失败时先打出主进程排障日志（STUDIO_RENDER_DEBUG 捕获），再让断言失败原样抛出。
    console.error('---- main process logs ----\n' + mainLogs.join(''))
    throw error
  }
  await expect(result.getByText('编码完成', { exact: true })).toBeVisible()
  // 产物真实落盘：exports/ 下出现 MP4 且非空、非零字节占位。
  const exportsDir = join(userData, 'exports')
  await expect
    .poll(() => readdirSync(exportsDir).filter((name) => name.endsWith('.mp4')).length, { timeout: 10_000 })
    .toBeGreaterThan(0)
  const mp4 = readdirSync(exportsDir)
    .filter((name) => name.endsWith('.mp4'))
    .map((name) => join(exportsDir, name))[0]!
  expect(existsSync(mp4)).toBe(true)
  expect(statSync(mp4).size).toBeGreaterThan(50_000)
})

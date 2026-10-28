import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

// 小红书平台会话本地夹具服务器：
// - /login：未登录页（文案命中登录检测关键词）→ 未登录态路径（canInject=false）
// - /editor：编辑器夹具页（标题/正文/发布按钮）→ 已登录注入路径
// - POST /__publish-click：发布按钮点击上报专用端点——铁律断言收到的点击数为 0。
//   （Playwright 的 ElectronApplication 无法窥视 WebContentsView 内容，断言走 UI 状态 + 夹具请求日志。）
// 根 package.json 为 "type": "module"，Playwright 以 ESM 加载本文件：
// 夹具路径必须走 import.meta.url + fileURLToPath（__dirname 在 ESM 下是 ReferenceError）。
const editorHtml = readFileSync(
  fileURLToPath(new URL('../fixtures/redbook-editor.html', import.meta.url)),
  'utf8',
)
const loginHtml = readFileSync(
  fileURLToPath(new URL('../fixtures/redbook-login.html', import.meta.url)),
  'utf8',
)

type FixtureState = { editorLoads: number; loginLoads: number; publishClicks: number }

function startFixtureServer() {
  const state: FixtureState = { editorLoads: 0, loginLoads: 0, publishClicks: 0 }
  const server = createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0]!
    if (url === '/editor') {
      state.editorLoads += 1
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(editorHtml)
      return
    }
    if (url === '/login') {
      state.loginLoads += 1
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(loginHtml)
      return
    }
    if (url === '/__publish-click') {
      state.publishClicks += 1
      res.statusCode = 204
      res.end()
      return
    }
    res.statusCode = 404
    res.end('not found')
  })
  return { server, state }
}

async function launchStudio(editorUrl: string) {
  const userData = mkdtempSync(join(tmpdir(), 'content-studio-redbook-'))
  const environment: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  delete environment.ELECTRON_RUN_AS_NODE
  environment.STUDIO_SMOKE = '1'
  environment.STUDIO_USER_DATA = userData
  environment.STUDIO_REDBOOK_EDITOR_URL = editorUrl
  const executablePath = process.env.STUDIO_TEST_EXECUTABLE
  const application = await electron.launch({
    executablePath,
    args: executablePath ? [] : ['packages/desktop'],
    env: environment,
  })
  const page = await application.firstWindow()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return { application, page, errors }
}

async function openRedbookBatchView(page: Awaited<ReturnType<typeof launchStudio>>['page']) {
  await page.getByRole('button', { name: '发布准备', exact: true }).click()
  await page.getByRole('checkbox', { name: /小红书/ }).check()
  await page.getByRole('button', { name: '继续，预览所选平台', exact: true }).click()
  await expect(page.getByText('等待手动交付', { exact: true })).toBeVisible()
}

test('小红书未登录态：检测登录→未登录→打开登录入口；注入被如实拒绝且绝不点发布', async () => {
  const { server, state } = startFixtureServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const { application, page, errors } = await launchStudio(`${base}/login`)
  try {
    await openRedbookBatchView(page)
    const section = page.locator('[aria-label="小红书草稿注入"]')

    // 登录态显示：初始未检测 → 检测登录（隐藏会话加载夹具登录页）→ 未登录
    await expect(section.getByText('未检测登录', { exact: true })).toBeVisible()
    await section.getByRole('button', { name: '检测登录', exact: true }).click()
    await expect(section.getByText('未登录', { exact: true })).toBeVisible({ timeout: 10_000 })
    // 未登录 → 「打开登录」入口
    await expect(section.getByRole('button', { name: '打开登录', exact: true })).toBeVisible()

    // 注入前二次确认：明确写「不会自动点击发布」（确认项本身携带该文案）
    await section.getByRole('button', { name: '打开并注入草稿', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const confirmBox = dialog.getByRole('checkbox', { name: /不会自动点击发布/ })
    await expect(confirmBox).toBeVisible()
    await confirmBox.check()
    await dialog.getByRole('button', { name: '确认注入草稿', exact: true }).click()

    // canInject=false 路径：任务如实失败并引导登录（绝不伪装成功）
    await expect(section.getByText(/尚未登录小红书/).first()).toBeVisible({ timeout: 20_000 })

    // 夹具侧：登录页确被平台会话加载；发布按钮从未被点击
    expect(state.loginLoads).toBeGreaterThan(0)
    expect(state.publishClicks).toBe(0)
    expect(errors).toEqual([])
  } finally {
    await application.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('小红书已登录注入：二次确认后注入成功，夹具发布按钮点击数为 0', async () => {
  const { server, state } = startFixtureServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const { application, page, errors } = await launchStudio(`${base}/editor`)
  try {
    await openRedbookBatchView(page)
    const section = page.locator('[aria-label="小红书草稿注入"]')

    await section.getByRole('button', { name: '检测登录', exact: true }).click()
    await expect(section.getByText('已登录', { exact: true })).toBeVisible()

    await section.getByRole('button', { name: '打开并注入草稿', exact: true }).click()
    const dialog = page.getByRole('dialog')
    const confirmBox = dialog.getByRole('checkbox', { name: /不会自动点击发布/ })
    await expect(confirmBox).toBeVisible()
    await confirmBox.check()
    await dialog.getByRole('button', { name: '确认注入草稿', exact: true }).click()

    // 任务完成：停在草稿态，文案再次明确不会自动点击发布
    await expect(section.getByText(/已注入小红书草稿；不会自动点击发布/)).toBeVisible({
      timeout: 20_000,
    })

    // 夹具侧：编辑器页被平台会话加载；发布按钮点击数为 0（绝不点发布的可执行验证）
    expect(state.editorLoads).toBeGreaterThan(0)
    expect(state.publishClicks).toBe(0)
    expect(errors).toEqual([])
  } finally {
    await application.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

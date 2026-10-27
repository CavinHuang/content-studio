import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MockOpenai } from '../helpers/mock-openai'

let app: ElectronApplication, page: Page
let errors: string[]
test.setTimeout(90_000)

test.beforeEach(async () => {
  const userData = mkdtempSync(join(tmpdir(), 'studio-agent-'))
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  delete env.ELECTRON_RUN_AS_NODE
  env.STUDIO_SMOKE = '1'
  env.STUDIO_USER_DATA = userData
  app = await electron.launch({
    executablePath: process.env.STUDIO_TEST_EXECUTABLE,
    args: process.env.STUDIO_TEST_EXECUTABLE ? [] : ['packages/desktop'],
    env,
  })
  page = await app.firstWindow()
  errors = []
  page.on('pageerror', (err) => errors.push(String(err)))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
})

test.afterEach(async () => {
  await app.close()
})

test('pi 真实链路：流式回复进入对话，上下文随请求进入模型', async () => {
  const mock = new MockOpenai(({ messages }) => {
    void messages
    return [{ type: 'text', text: '已收到你的想法。可以从一个具体问题出发，先把观点落在第一段。' }]
  })
  const url = await mock.start()
  // 经 IPC 配置模型（渲染端全程不见明文 key）。
  const configured = await page.evaluate(
    ({ baseUrl }) => window.desktop!.aiConfigSet({ baseUrl, apiKey: 'e2e-key', modelId: 'mock-writer' }),
    { baseUrl: url },
  )
  expect(configured).toMatchObject({ hasKey: true })

  await page.getByRole('button', { name: '展开 Agent', exact: true }).click()
  await page.getByLabel('Agent 消息', { exact: true }).fill('帮我把这篇内容的方向理清楚。')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByLabel('Agent 对话记录')).toContainText('先把观点落在第一段', { timeout: 60_000 })

  const request = mock.lastRequest()!
  expect(JSON.stringify(request.messages)).toContain('帮我把这篇内容的方向理清楚。')
  expect(JSON.stringify(request.messages)).toContain('当前文稿')
  expect(errors).toEqual([])
  await mock.close()
})

test('ask_user：运行中问询卡片点选回答后进入模型上下文', async () => {
  const mock = new MockOpenai(({ messages }) => {
    const answered = JSON.stringify(messages.filter((m) => m.role === 'tool')).includes('用户回答')
    if (!answered) {
      return [
        {
          type: 'tool',
          name: 'ask_user',
          args: { question: '这篇内容更想打动谁？', options: ['技术读者', '普通读者'] },
        },
      ]
    }
    return [{ type: 'text', text: '好，将面向所选读者继续梳理。' }]
  })
  const url = await mock.start()
  await page.evaluate(
    ({ baseUrl }) => window.desktop!.aiConfigSet({ baseUrl, apiKey: 'e2e-key', modelId: 'mock-writer' }),
    { baseUrl: url },
  )
  await page.getByRole('button', { name: '展开 Agent', exact: true }).click()
  await page.getByLabel('Agent 消息', { exact: true }).fill('继续整理。')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Agent 问询' })).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: '回答：技术读者' }).click()
  await expect(page.getByLabel('Agent 对话记录')).toContainText('面向所选读者', { timeout: 60_000 })
  expect(JSON.stringify(mock.lastRequest()!.messages)).toContain('技术读者')
  expect(errors).toEqual([])
  await mock.close()
})

test('未配置模型时保留本地演示路径，配置入口提示可见', async () => {
  await page.getByRole('button', { name: '展开 Agent', exact: true }).click()
  await page.getByLabel('Agent 消息', { exact: true }).fill('帮我看看方案。')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  // 本地演示回复（确定性文案）仍可用。
  await expect(page.getByLabel('Agent 对话记录')).toContainText('（演示）', { timeout: 20_000 })
  const view = await page.evaluate(() => window.desktop!.aiConfigGet())
  expect(view).toBeNull()
  expect(errors).toEqual([])
})

import { test, expect, _electron as electron, type ElectronApplication, type Page, type Locator } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

let app: ElectronApplication, page: Page
let errors: string[]
const directory = 'docs/ux/research/creation'
const idea = '少收集一点，给每周回顾留出时间'
const note = '周五原始记录：我存了 12 个链接，只重读了 2 条。下周先重读，再决定要不要继续收藏。'
const body = () => page.getByLabel('文稿正文', { exact: true })
const flow = () => page.getByRole('region', { name: '从想法到母稿', exact: true })
const input = () => page.getByLabel('想法与原始记录', { exact: true })

test.setTimeout(60_000)
test.beforeEach(async () => {
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  delete env.ELECTRON_RUN_AS_NODE
  env.STUDIO_SMOKE = '1'
  env.STUDIO_USER_DATA = mkdtempSync(join(tmpdir(), 'studio-creation-'))
  app = await electron.launch({ executablePath: process.env.STUDIO_TEST_EXECUTABLE, args: process.env.STUDIO_TEST_EXECUTABLE ? [] : ['.'], env })
  page = await app.firstWindow()
  errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.setViewportSize({ width: 1480, height: 960 })
  await expect(page.getByLabel('文稿标题', { exact: true })).toHaveValue('让灵感成为作品')
})
test.afterEach(async ({}, info) => {
  try { await page.screenshot({ path: info.outputPath('creation.png') }); expect(errors).toEqual([]) }
  finally { await app.close() }
})

test('prototype: same raw task, editable master and exact Markdown export with fewer explicit actions', async () => {
  mkdirSync(directory, { recursive: true })
  const started = Date.now()
  const steps: { action: string; target: string }[] = []
  const click = async (target: Locator, label: string) => { steps.push({ action: 'click', target: label }); await target.click() }
  const fill = async (target: Locator, value: string, label: string) => { steps.push({ action: 'fill', target: label }); await target.fill(value) }
  await click(page.getByRole('button', { name: '新建内容', exact: true }), '新建内容')
  await fill(input(), `${idea}\n${note}`, '一次放入主题和原始记录')
  await click(flow().getByRole('button', { name: '整理成初稿', exact: true }), '整理成初稿')
  await expect(flow().getByRole('button', { name: '调整方向与素材' })).toBeVisible()
  const generated = await body().inputValue()
  expect(generated).toContain(note)
  expect(generated).toContain('待作者补充')
  await fill(body(), generated + '\n\n作者校订：先完成一次回顾。', '校订正文')
  const destination = resolve(directory, 'prototype.md')
  await app.evaluate(({ session }, destination) => {
    const scope = globalThis as unknown as { creationDownload: string }
    scope.creationDownload = 'waiting'
    session.defaultSession.once('will-download', (_event, item) => {
      item.setSavePath(destination)
      item.once('done', (_event, result) => { scope.creationDownload = result })
    })
  }, destination)
  await click(flow().getByRole('button', { name: '导出母稿 Markdown' }), '直接导出 Markdown')
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { creationDownload: string }).creationDownload)).toBe('completed')
  expect(readFileSync(destination, 'utf8')).toBe(`# ${idea}\n\n${await body().inputValue()}`)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('content-studio.mock-workspace.v2')!))
  expect(saved.projects.find((p: { id: string }) => p.id === saved.selectedProject).batches).toEqual([])
  const clicks = steps.filter(s => s.action === 'click').length
  const inputOperations = steps.filter(s => s.action === 'fill').length
  const baseline = JSON.parse(readFileSync(join(directory, 'baseline.json'), 'utf8'))
  expect(clicks + inputOperations).toBeLessThanOrEqual((baseline.clicks + baseline.inputOperations) * 0.7)
  writeFileSync(join(directory, 'prototype.json'), JSON.stringify({
    evidence: 'scripted Electron mock; synthetic fixture; not human usability data', idea, note,
    steps, clicks, inputOperations, keyboardShortcuts: 0, userKeystrokes: null,
    elapsedAutomationMs: Date.now() - started, taskWaits: 1, workspaceTransitions: 0,
    repeatedIntentEntries: 0, rawNoteInGeneratedBody: generated.includes(note), exportMatchesEditedBody: true,
    humanSuccessRate: null, humanWorkload: null, blindQualityScore: null,
  }, null, 2))
  await page.screenshot({ path: join(directory, 'prototype.png') })
  await page.getByRole('tab', { name: '预览', exact: true }).click()
  await page.screenshot({ path: join(directory, 'prototype-preview.png') })
})

test('only a missing topic interrupts; links and notes survive the correction', async () => {
  await page.getByRole('button', { name: '新建内容', exact: true }).click()
  await input().fill('https://example.org/unread')
  await flow().getByRole('button', { name: '整理成初稿', exact: true }).click()
  await expect(flow().getByRole('alert')).toContainText('这次想写什么')
  await expect(input()).toHaveValue('https://example.org/unread')
  await input().fill('我想核对这条来源\nhttps://example.org/unread')
  await flow().getByRole('button', { name: '整理成初稿', exact: true }).click()
  await expect(body()).toHaveValue(/https:\/\/example.org\/unread/)
  await expect(body()).toHaveValue(/尚未生成论证或核实事实/)
})

test('direction changes produce reviewed candidates; manual edits block stale adoption and undo', async () => {
  await page.getByRole('button', { name: '新建内容', exact: true }).click()
  await input().fill(`${idea}\n${note}`)
  await flow().getByRole('button', { name: '整理成初稿', exact: true }).click()
  await expect(flow().getByRole('button', { name: '调整方向与素材' })).toBeVisible()
  const original = await body().inputValue()
  await flow().getByRole('button', { name: '调整方向与素材' }).click()
  await input().fill('换个问题：重读比收藏重要吗？\n' + note)
  await flow().getByRole('button', { name: '按新方向准备候选' }).click()
  await flow().getByRole('button', { name: '比较原稿与候选' }).click()
  await expect(body()).toHaveValue(original)
  await body().fill(original + '\n作者不想丢失的修改')
  await expect(flow().getByRole('button', { name: '采用候选，保留原稿版本' })).toBeDisabled()
  await expect(flow().getByRole('button', { name: '撤销这次整理' })).toHaveCount(0)
  await flow().getByRole('button', { name: '按新方向准备候选' }).click()
  await flow().getByRole('button', { name: '比较原稿与候选' }).click()
  await flow().getByRole('button', { name: '采用候选，保留原稿版本' }).click()
  await expect(body()).toHaveValue(/换个问题/)
  await flow().getByRole('button', { name: '撤销这次整理' }).click()
  await expect(body()).toHaveValue(original + '\n作者不想丢失的修改')
  await flow().getByRole('button', { name: '按新方向准备候选' }).click()
  await flow().getByRole('button', { name: '放弃候选，保留母稿' }).click()
  await expect(body()).toHaveValue(original + '\n作者不想丢失的修改')
})

test('stop, modify direction and reload keep raw inputs without accepting late results', async () => {
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  await page.getByRole('button', { name: '新建内容', exact: true }).click()
  await input().fill(`${idea}\n${note}`)
  await flow().getByRole('button', { name: '整理成初稿', exact: true }).click()
  await flow().getByRole('button', { name: '停止整理' }).click()
  await page.clock.runFor(1200)
  await expect(body()).toHaveValue('')
  await expect(input()).toHaveValue(`${idea}\n${note}`)
  await flow().getByRole('button', { name: '继续整理', exact: true }).click()
  await input().fill('新的方向\n' + note)
  await page.clock.runFor(1200)
  await expect(body()).toHaveValue('')
  await flow().getByRole('button', { name: '整理成初稿', exact: true }).click()
  await page.clock.runFor(200)
  await page.reload()
  await expect(flow()).toContainText('上次整理被中断')
  await expect(input()).toHaveValue('新的方向\n' + note)
  await expect(body()).toHaveValue('')
  await flow().getByRole('button', { name: '继续整理', exact: true }).click()
  await page.clock.runFor(1200)
  await expect(body()).toHaveValue(/新的方向/)
})

test('small viewport keeps a keyboard accessible creation and export path', async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.keyboard.press('Control+n')
  await expect(input()).toBeVisible()
  await input().focus()
  await page.keyboard.insertText(`${idea}\n${note}`)
  await page.keyboard.press('Tab')
  await expect(flow().getByRole('button', { name: '整理成初稿', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(flow().getByRole('button', { name: '导出母稿 Markdown' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: join(directory, 'prototype-mobile.png') })
})

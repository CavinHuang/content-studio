import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { textDiff } from '../../src/renderer/src/studio/text-diff'

let app: ElectronApplication, page: Page
let errors: string[]
const directory = 'docs/ux/research/layout-fixed-2026-10-26'
const raw = '每周回顾：少收集一点\n原始记录：存了 12 条，只重读 2 条。'
const input = () => page.getByLabel('想法与原始记录', { exact: true })
const body = () => page.getByLabel('文稿正文', { exact: true })
async function tool(name: string) {
  await page.getByRole('button', { name: '作品工具', exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}
test.setTimeout(90_000)
test.beforeEach(async () => {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  )
  delete env.ELECTRON_RUN_AS_NODE
  env.STUDIO_SMOKE = '1'
  env.STUDIO_USER_DATA = mkdtempSync(join(tmpdir(), 'studio-layout-fixed-'))
  app = await electron.launch({ args: ['.'], env })
  page = await app.firstWindow()
  errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1480, height: 960 })
  await expect(page.getByLabel('文稿标题', { exact: true })).toHaveValue('让灵感成为作品')
  mkdirSync(directory, { recursive: true })
})
test.afterEach(async ({}, info) => {
  try {
    await page.screenshot({ path: info.outputPath('layout.png') })
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('tablet widths keep a visible editable workspace after resizing, reload and sidebar toggle', async () => {
  for (const width of [1099, 1000, 768]) {
    await page.setViewportSize({ width, height: 960 })
    await page.reload()
    await expect
      .poll(() => page.locator('main').evaluate((e) => e.getBoundingClientRect().width))
      .toBeGreaterThan(400)
    await page.getByRole('tab', { name: '编辑', exact: true }).click()
    await expect(body()).toBeInViewport()
    await body().fill(`在 ${width}px 下实际编辑正文`)
    await expect(body()).toHaveValue(`在 ${width}px 下实际编辑正文`)
    expect(
      await page.locator('[aria-label="内容导航"]').evaluate((e) => e.getBoundingClientRect().width),
    ).toBe(256)
    await page.screenshot({ path: `${directory}/tablet-${width}.png` })
  }
  await page.getByRole('button', { name: '收起内容库', exact: true }).click()
  await expect.poll(() => page.locator('main').evaluate((e) => e.getBoundingClientRect().width)).toBe(768)
  await page.getByRole('button', { name: '展开内容库', exact: true }).click()
  await expect(body()).toHaveValue('在 768px 下实际编辑正文')
})

test('new creation has one input and no premature publish; agent resumes the same raw context', async () => {
  await page.getByRole('button', { name: '新建内容', exact: true }).click()
  await expect(page.locator('textarea:visible')).toHaveCount(1)
  await expect(body()).toHaveCount(0)
  await expect(page.getByRole('button', { name: '发布准备', exact: true })).toHaveCount(0)
  await input().fill(raw)
  await page.screenshot({ path: `${directory}/start.png` })
  await page.getByRole('button', { name: '展开 Agent', exact: true }).click()
  await expect(page.getByText('已带入原始记录与 0 份本篇素材', { exact: true })).toBeVisible()
  await page.getByLabel('Agent 消息', { exact: true }).fill('请根据已有记录继续创作。')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(body()).toHaveValue(/存了 12 条，只重读 2 条/)
  await expect(page.locator('.chat-artifact').last()).toContainText('当前文稿')
  const snapshot = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('content-studio.mock-workspace.v2')!)
    const p = s.projects.find((p: { id: string }) => p.id === s.selectedProject)
    return p.conversations[0].messages.find((m: { role: string }) => m.role === 'user')?.context
  })
  expect(snapshot.input).toBe(raw)
  await page.getByRole('button', { name: '收起 Agent', exact: true }).click()
  await page.getByRole('tab', { name: '预览', exact: true }).click()
  await expect(page.getByLabel('文稿标题', { exact: true })).not.toBeEditable()
  await expect(page.getByRole('button', { name: '导出当前文稿', exact: true })).toBeVisible()
  await page.screenshot({ path: `${directory}/ready.png` })
})

test('candidate occupies the workspace with one scroll area and reachable actions at desktop and mobile', async () => {
  await page.getByRole('button', { name: '新建内容', exact: true }).click()
  await input().fill(raw)
  await page.getByRole('button', { name: '整理成初稿', exact: true }).click()
  await expect(body()).toHaveValue(/原始记录/)
  const original = await body().inputValue()
  await page.getByRole('button', { name: '调整方向与素材', exact: true }).click()
  await input().fill(
    '新的方向：先回顾再收藏\n' +
      Array.from({ length: 100 }, (_, i) => `新的原始记录 ${i}：先重读，再收藏。`).join('\n'),
  )
  await expect(page.getByRole('button', { name: '按新方向准备候选', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: '按新方向准备候选', exact: true }).click()
  const comparison = page.getByRole('region', { name: '原稿与候选对照', exact: true })
  await expect(comparison).toBeVisible()
  await expect(body()).toHaveCount(0)
  for (const width of [1480, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    await expect(comparison.getByRole('button', { name: '采用候选，保留原稿版本' })).toBeInViewport()
    expect(
      await comparison.evaluate(
        (e) =>
          [...e.querySelectorAll('*')].filter((el) => {
            const style = getComputedStyle(el)
            return /auto|scroll/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1
          }).length,
      ),
    ).toBe(1)
    await page.screenshot({ path: `${directory}/comparison-${width}.png` })
  }
  await comparison.getByRole('button', { name: '返回正文继续编辑' }).click()
  await expect(body()).toHaveValue(original)
  await body().fill(original + '\n保留这次手改')
  await page.getByRole('button', { name: '比较原稿与候选', exact: true }).click()
  await expect(comparison.getByRole('button', { name: '采用候选，保留原稿版本' })).toBeDisabled()
  await comparison.getByRole('button', { name: '放弃候选，保留母稿' }).click()
  await expect(body()).toHaveValue(original + '\n保留这次手改')
})

test('one project navigation, contextual tools preserve editing, global pages hide the project agent', async () => {
  await expect(page.getByRole('tablist', { name: '内容产物' }).getByRole('tab')).toHaveCount(2)
  await expect(page.locator('[data-slot="sidebar-menu-sub"]')).toHaveCount(0)
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await body().fill('辅助工具打开时也应保留这段正文。')
  await tool('创作方案')
  await expect(body()).toHaveValue('辅助工具打开时也应保留这段正文。')
  await expect(page.getByLabel('核心观点')).toBeVisible()
  await page.screenshot({ path: `${directory}/plan-panel.png` })
  await page.getByRole('button', { name: '关闭作品工具', exact: true }).click()
  await tool('参考素材')
  await expect(body()).toHaveValue('辅助工具打开时也应保留这段正文。')
  await expect(page.getByRole('textbox', { name: '搜索素材', exact: true })).toBeInViewport()
  expect(
    (await page.getByRole('textbox', { name: '搜索素材', exact: true }).boundingBox())!.width,
  ).toBeGreaterThan(200)
  expect(
    await page
      .getByRole('complementary', { name: '作品辅助工具' })
      .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
  ).toBe(true)
  await page.screenshot({ path: `${directory}/materials-panel.png` })
  await page.getByRole('button', { name: '关闭作品工具', exact: true }).click()
  await page.getByRole('button', { name: '素材库', exact: true }).click()
  await expect(page.getByLabel('素材目标作品')).toBeVisible()
  await expect(page.getByRole('complementary', { name: '创作 Agent', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '展开 Agent', exact: true })).toHaveCount(0)
  await page.getByLabel('素材目标作品').selectOption({ label: '把碎片时间，变成创作的起点' })
  await page
    .locator('.material-card')
    .first()
    .getByRole('button', { name: '用于这篇内容', exact: true })
    .click()
  await expect(
    page.locator('.material-card').first().getByRole('button', { name: '已用于本篇', exact: true }),
  ).toBeDisabled()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('content-studio.mock-workspace.v2')!)
        return s.projects.find((p: { id: string }) => p.id === s.selectedProject)?.materialIds
      }),
    )
    .toContain('m1')
  const targets = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('content-studio.mock-workspace.v2')!)
    return {
      selected: s.projects.find((p: { id: string }) => p.id === s.selectedProject),
      first: s.projects[0],
    }
  })
  expect(targets.selected.title).toBe('把碎片时间，变成创作的起点')
  expect(targets.selected.materialIds).toContain('m1')
  expect(targets.first.drafts.master.body).toBe('辅助工具打开时也应保留这段正文。')
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await expect(page.getByRole('button', { name: '展开 Agent', exact: true })).toHaveCount(0)
})

test('mobile tasks are visible and all platform preview fields are read only', async () => {
  await page.getByRole('tab', { name: '小红书', exact: true }).click()
  await expect(page.getByLabel('文稿标题', { exact: true })).not.toBeEditable()
  await expect(page.getByLabel('平台话题', { exact: true })).not.toBeEditable()
  await page.setViewportSize({ width: 390, height: 844 })
  for (const name of ['文稿', '视频'])
    await expect(
      page.getByRole('tablist', { name: '内容产物' }).getByRole('tab', { name, exact: true }),
    ).toBeInViewport()
  await expect(page.getByRole('combobox', { name: '当前文稿平台' })).toBeInViewport()
  await expect(page.getByRole('button', { name: '作品工具', exact: true })).toBeInViewport()
  await page.getByRole('button', { name: '发布准备', exact: true }).click()
  await expect(page.getByRole('button', { name: '发布准备', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '返回文稿', exact: true })).toBeVisible()
  await page.screenshot({ path: `${directory}/mobile-delivery.png` })
})

test('diff reconstructs both documents including large fallback and empty paragraphs', () => {
  for (const [before, after] of [
    ['', '一段正文'],
    ['旧句\n\n共同段落', '新句\n\n共同段落'],
    ['a\n尾部\n', 'a\n'],
    ['重复\n重复', '重复'],
    ['a\n'.repeat(400), 'b\n'.repeat(400)],
  ]) {
    const changes = textDiff(before!, after!)
    expect(
      changes
        .filter((c) => c.kind !== 'added')
        .map((c) => c.text)
        .join('\n'),
    ).toBe(before)
    expect(
      changes
        .filter((c) => c.kind !== 'removed')
        .map((c) => c.text)
        .join('\n'),
    ).toBe(after)
  }
})

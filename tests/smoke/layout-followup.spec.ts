import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let app: ElectronApplication, page: Page
let errors: string[]
const directory = 'docs/ux/research/layout-followup-fixed-2026-10-26'
const raw = '每周回顾\n独有原始记录：本周存了 12 条，只重读了 2 条。'
const body = () => page.getByLabel('文稿正文', { exact: true })
async function tool(name: string) {
  await page.getByRole('button', { name: '作品工具', exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}
async function create() {
  await page.getByRole('button', { name: '新建内容', exact: true }).click()
  await page.getByLabel('想法与原始记录', { exact: true }).fill(raw)
  await page.getByRole('button', { name: '整理成初稿', exact: true }).click()
  await expect(body()).toHaveValue(/独有原始记录/)
}
test.setTimeout(90_000)
test.beforeEach(async () => {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  )
  delete env.ELECTRON_RUN_AS_NODE
  env.STUDIO_SMOKE = '1'
  env.STUDIO_USER_DATA = mkdtempSync(join(tmpdir(), 'studio-followup-fixed-'))
  app = await electron.launch({ args: ['packages/desktop'], env })
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
    await page.screenshot({ path: info.outputPath('workspace.png') })
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('plan entry shares raw context and stages a candidate before replacing an authored master', async () => {
  await create()
  await body().fill((await body().inputValue()) + '\n作者手改：保持自己的结论。')
  const original = await body().inputValue()
  await tool('参考素材')
  await page.getByRole('tab', { name: /全部素材/ }).click()
  await page
    .locator('.material-card')
    .first()
    .getByRole('button', { name: '用于这篇内容', exact: true })
    .click()
  await page
    .getByRole('tablist', { name: '作品辅助内容' })
    .getByRole('tab', { name: '创作方案', exact: true })
    .click()
  await page.getByLabel('方案选题', { exact: true }).fill('先回顾再收集')
  await page.getByLabel('核心观点', { exact: true }).fill('先看已有材料，再选择要收集什么。')
  await page.getByRole('button', { name: '按方案准备候选', exact: true }).click()
  const comparison = page.getByRole('region', { name: '原稿与候选对照', exact: true })
  await expect(comparison).toBeVisible()
  await expect(comparison).toContainText('先回顾再收集')
  await comparison
    .locator('details')
    .evaluateAll((nodes) => nodes.forEach((n) => ((n as HTMLDetailsElement).open = true)))
  await expect(comparison).toContainText('独有原始记录')
  await expect(comparison).toContainText('创作，从一个小念头开始')
  await comparison.getByRole('button', { name: '返回正文继续编辑' }).click()
  await expect(body()).toHaveValue(original)
  await page.getByRole('button', { name: '比较原稿与候选', exact: true }).click()
  await page.screenshot({ path: `${directory}/01-plan-candidate.png` })
  await comparison.getByRole('button', { name: '采用候选，保留原稿版本' }).click()
  await expect(body()).toHaveValue(/独有原始记录/)
  await expect(page.getByLabel('文稿标题', { exact: true })).toHaveValue('先回顾再收集')
  await expect
    .poll(() =>
      page.evaluate((original) => {
        const s = JSON.parse(localStorage.getItem('content-studio.mock-workspace.v2')!)
        const p = s.projects.find((p: { id: string }) => p.id === s.selectedProject)
        return p.drafts.master.versions.some((v: { body: string }) => v.body === original)
      }, original),
    )
    .toBe(true)
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await expect(page.locator('.task-card').filter({ hasText: '按方案整理母稿' }).first()).toContainText(
    '原始材料已整理到母稿',
  )
})

test('capacity errors remain visible after closing direction dialog and can be corrected without retyping records', async () => {
  await create()
  const original = await body().inputValue()
  await page.getByRole('button', { name: '调整方向与素材', exact: true }).click()
  const large = '每周回顾\n' + '原始记录'.repeat(8000)
  await page.getByLabel('想法与原始记录', { exact: true }).fill(large)
  await page.getByRole('button', { name: '按新方向准备候选', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('容量')
  await page.getByRole('button', { name: '返回正文', exact: true }).click()
  const toolbar = page.getByRole('region', { name: '从想法到母稿', exact: true })
  await expect(toolbar.getByRole('alert')).toContainText('容量')
  await expect(body()).toHaveValue(original)
  await page.screenshot({ path: `${directory}/02-visible-blocked-recovery.png` })
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  const blockedTask = page.locator('.task-card').filter({ hasText: '超过本地演示的整理容量' })
  await expect(blockedTask.getByRole('button', { name: '修正输入', exact: true })).toBeVisible()
  await expect(blockedTask.getByRole('button', { name: '继续整理', exact: true })).toHaveCount(0)
  await blockedTask.getByRole('button', { name: '修正输入', exact: true }).click()
  await expect(toolbar.getByRole('alert')).toContainText('容量')
  await page.getByRole('button', { name: '调整方向与素材', exact: true }).click()
  await expect(page.getByLabel('想法与原始记录', { exact: true })).toHaveValue(large)
  await page.getByLabel('想法与原始记录', { exact: true }).fill(raw)
  await page.getByRole('button', { name: '按新方向准备候选', exact: true }).click()
  await expect(page.getByRole('region', { name: '原稿与候选对照', exact: true })).toBeVisible()
})

test('video tools preserve the active video, local editor state and mobile return focus', async () => {
  await page.getByRole('tab', { name: '视频', exact: true }).click()
  await page.getByRole('button', { name: /素材分镜.*让创作回到日常/ }).click()
  const narration = page.getByRole('textbox', { name: '口播文案', exact: true }).first()
  await narration.fill('打开辅助工具前的视频口播。')
  await tool('参考素材')
  await expect(page.getByRole('tab', { name: '视频', exact: true })).toHaveAttribute('data-state', 'active')
  await expect(narration).toHaveValue('打开辅助工具前的视频口播。')
  await page.screenshot({ path: `${directory}/03-video-with-materials.png` })
  await page.getByRole('button', { name: '关闭作品工具', exact: true }).click()
  await expect(narration).toHaveValue('打开辅助工具前的视频口播。')
  await page.setViewportSize({ width: 390, height: 844 })
  await tool('创作方案')
  await page.getByRole('button', { name: '关闭作品工具', exact: true }).click()
  await expect(page.getByRole('button', { name: '作品工具', exact: true })).toBeFocused()
  await expect(narration).toHaveValue('打开辅助工具前的视频口播。')
  await tool('参考素材')
  await page
    .locator('.material-card')
    .first()
    .getByRole('button', { name: '和助手讨论', exact: true })
    .click()
  await expect(page.getByRole('complementary', { name: '创作 Agent', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '收起 Agent', exact: true }).click()
  await expect(page.getByRole('tab', { name: '视频', exact: true })).toHaveAttribute('data-state', 'active')
  await expect(narration).toHaveValue('打开辅助工具前的视频口播。')
})

test('mobile platform picker creates a new version and returns to its current draft on cancel', async () => {
  await create()
  await page.setViewportSize({ width: 390, height: 844 })
  const picker = page.getByRole('combobox', { name: '当前文稿平台', exact: true })
  await picker.selectOption('add')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  await expect(picker).toHaveValue('master')
  await picker.selectOption('add')
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '清空', exact: true }).click()
  await dialog.getByRole('checkbox', { name: '选择', exact: true }).nth(1).check()
  await dialog.getByRole('button', { name: '创建所选版本', exact: true }).click()
  await expect(picker.getByRole('option', { name: '小红书', exact: true })).toBeAttached()
  await picker.selectOption('redbook')
  await expect(picker).toHaveValue('redbook')
  await page.screenshot({ path: `${directory}/04-mobile-platform-created.png` })
})

test('task center stops and resumes the actual creation across reload and project switches', async () => {
  await page.clock.install()
  await page.clock.pauseAt(new Date())
  await page.getByRole('button', { name: '新建内容', exact: true }).click()
  await page.getByLabel('想法与原始记录', { exact: true }).fill(raw)
  await page.getByRole('button', { name: '整理成初稿', exact: true }).click()
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  const task = page.locator('.task-card').filter({ hasText: '整理原始材料' }).first()
  await expect(task).toContainText('《未命名内容》')
  await expect(task.getByText('运行中', { exact: true })).toBeVisible()
  await task.getByRole('button', { name: '停止', exact: true }).click()
  await page.clock.runFor(1500)
  await expect(task.getByText('已停止', { exact: true })).toBeVisible()
  await task.getByRole('button', { name: '继续整理', exact: true }).click()
  await page.clock.runFor(250)
  await page.reload()
  await expect(task.getByText('已停止', { exact: true })).toBeVisible()
  await task.getByRole('button', { name: '继续整理', exact: true }).click()
  await page.getByRole('button', { name: '让灵感成为作品', exact: true }).click()
  await page.clock.runFor(1500)
  await expect(page.getByLabel('文稿标题', { exact: true })).toHaveValue('让灵感成为作品')
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await expect(task.getByText('已完成', { exact: true })).toBeVisible()
  await expect(task).toContainText('《每周回顾》')
  await page.screenshot({ path: `${directory}/05-creation-task-recovery.png` })
  await task.getByRole('button', { name: '查看内容', exact: true }).click()
  await expect(page.getByLabel('文稿标题', { exact: true })).toHaveValue('每周回顾')
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await expect(body()).toHaveValue(/独有原始记录/)
})

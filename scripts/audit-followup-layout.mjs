import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Post-fix observation. Frozen pre-fix evidence remains in layout-followup-2026-10-26.
const directory = 'docs/ux/research/layout-followup-fixed-2026-10-26/audit'
await mkdir(directory, { recursive: true })
const env = {
  ...process.env,
  STUDIO_SMOKE: '1',
  STUDIO_USER_DATA: await mkdtemp(join(tmpdir(), 'studio-followup-')),
}
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env })
const observations = [],
  errors = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1480, height: 960 })
  await expect(page.getByLabel('文稿标题', { exact: true })).toHaveValue('让灵感成为作品')
  const tool = async (name) => {
    await page.getByRole('button', { name: '作品工具', exact: true }).click()
    await page.getByRole('menuitem', { name, exact: true }).click()
  }
  const saved = async () => {
    await page.waitForTimeout(300)
    return page.evaluate(() => JSON.parse(localStorage.getItem('content-studio.mock-workspace.v2')))
  }
  const capture = (name) => page.screenshot({ path: `${directory}/${name}.png`, animations: 'disabled' })

  await page.getByRole('tab', { name: '视频', exact: true }).click()
  await expect(page.getByRole('tab', { name: '视频', exact: true })).toHaveAttribute('data-state', 'active')
  await tool('参考素材')
  observations.push({
    case: 'video-tool-switch',
    activeMainTab: await page
      .getByRole('tablist', { name: '内容产物' })
      .locator('[data-state="active"]')
      .innerText(),
    articleVisible: await page.getByLabel('文稿标题', { exact: true }).isVisible(),
  })
  await expect(page.getByRole('tab', { name: '视频', exact: true })).toHaveAttribute('data-state', 'active')
  await capture('01-video-with-tools')
  await page.getByRole('button', { name: '关闭作品工具', exact: true }).click()
  await page.getByRole('tab', { name: '文稿', exact: true }).click()

  await page.setViewportSize({ width: 390, height: 844 })
  observations.push({
    case: 'mobile-add-platform',
    addPlatformVisible: await page.getByRole('button', { name: '添加平台版本', exact: true }).isVisible(),
    platformSelectVisible: await page
      .getByRole('combobox', { name: '当前文稿平台', exact: true })
      .isVisible(),
    addPlatformOptionAvailable:
      (await page.locator('[aria-label="当前文稿平台"] option[value="add"]').count()) === 1,
  })
  await tool('参考素材')
  await page.getByRole('button', { name: '关闭作品工具', exact: true }).click()
  await expect(page.getByRole('button', { name: '作品工具', exact: true })).toBeFocused()
  observations.push({
    case: 'mobile-tools-close-focus',
    focusedControl: await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
  })
  await capture('02-mobile-platform-controls')

  await page.setViewportSize({ width: 1480, height: 960 })
  await page.getByRole('button', { name: '新建内容', exact: true }).click()
  const raw = '每周回顾\n独有原始记录：本周存了 12 条，只重读了 2 条。'
  await page.getByLabel('想法与原始记录', { exact: true }).fill(raw)
  await page.getByRole('button', { name: '整理成初稿', exact: true }).click()
  await expect(page.getByLabel('文稿正文', { exact: true })).toHaveValue(/独有原始记录/)
  const generatedState = await saved()
  const id = generatedState.selectedProject
  observations.push({
    case: 'creation-and-task-center',
    creationStatus: generatedState.projects.find((p) => p.id === id).creation.status,
    tasksForNewProject: generatedState.tasks.filter((t) => t.projectId === id).length,
  })

  await page.getByRole('button', { name: '调整方向与素材', exact: true }).click()
  await page.getByLabel('想法与原始记录', { exact: true }).fill('每周回顾\n' + '原始记录'.repeat(8000))
  await page.getByRole('button', { name: '按新方向准备候选', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('超过本地演示')
  await page.getByRole('button', { name: '返回正文', exact: true }).click()
  const blockedState = await saved()
  observations.push({
    case: 'blocked-status-after-modal-close',
    storedStatus: blockedState.projects.find((p) => p.id === id).creation.status,
    toolbarText: await page.getByRole('region', { name: '从想法到母稿', exact: true }).innerText(),
    visibleCapacityError: await page
      .getByText('这批文字超过本地演示的整理容量。请拆成较小的一批，原文和母稿会保留。', { exact: true })
      .isVisible(),
  })
  await expect(
    page.getByRole('region', { name: '从想法到母稿', exact: true }).getByRole('alert'),
  ).toContainText('容量')
  await capture('03-blocked-status-visible')

  await page.getByRole('button', { name: '调整方向与素材', exact: true }).click()
  await page.getByLabel('想法与原始记录', { exact: true }).fill(raw)
  await page.getByRole('button', { name: '返回正文', exact: true }).click()
  const before = await page.getByLabel('文稿正文', { exact: true }).inputValue()
  await tool('创作方案')
  await page.getByLabel('方案选题', { exact: true }).fill('从少收集开始')
  await page.getByLabel('核心观点', { exact: true }).fill('先回顾已有记录，再决定收集什么。')
  await page.getByRole('button', { name: '按方案准备候选', exact: true }).click()
  await expect(page.getByRole('region', { name: '原稿与候选对照', exact: true })).toBeVisible()
  const legacyState = await saved()
  const project = legacyState.projects.find((p) => p.id === id)
  observations.push({
    case: 'plan-stages-candidate',
    bodyChanged: project.drafts.master.body !== before,
    candidateReviewVisible: await page
      .getByRole('region', { name: '原稿与候选对照', exact: true })
      .isVisible(),
    uniqueOriginalNoteRetainedInCurrentBody: project.drafts.master.body.includes('独有原始记录'),
    uniqueOriginalNoteRetainedInCandidate: project.creation.candidate.body.includes('独有原始记录'),
    beforeRetainedInVersions: project.drafts.master.versions.some((v) => v.body === before),
    creationStatus: project.creation.status,
  })
  await capture('04-plan-candidate')
} finally {
  await writeFile(
    `${directory}/observations.json`,
    JSON.stringify(
      {
        evidence:
          'isolated Electron; synthetic fixture; reproducible interaction audit; no human participant study',
        observations,
        errors,
      },
      null,
      2,
    ),
  )
  await app.close()
}

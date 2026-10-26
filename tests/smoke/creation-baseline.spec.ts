import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Synthetic raw fixture, not a real user's interview or production record.
const idea = '少收集一点，给每周回顾留出时间'
const note = '周五原始记录：我存了 12 个链接，只重读了 2 条。下周先重读，再决定要不要继续收藏。'
test('baseline: existing material and brief route to an editable exported master', async () => {
  const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, STUDIO_SMOKE: '1', STUDIO_USER_DATA: mkdtempSync(join(tmpdir(), 'studio-baseline-')) }).filter((entry): entry is [string, string] => entry[1] !== undefined))
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: ['.'], env })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1480, height: 960 })
  const started = Date.now()
  const steps: { action: string; target: string }[] = []
  const click = async (target: ReturnType<typeof page.getByRole>, label: string) => {
    steps.push({ action: 'click', target: label }); await target.click()
  }
  const fill = async (target: ReturnType<typeof page.getByRole>, value: string, label: string) => {
    steps.push({ action: 'fill', target: label }); await target.fill(value)
  }
  try {
    await click(page.getByRole('button', { name: '新建内容', exact: true }), '新建内容')
    const tabs = page.getByRole('tablist', { name: '内容产物' })
    await click(tabs.getByRole('tab', { name: '素材', exact: true }), '素材页')
    await click(page.getByRole('button', { name: '收集素材', exact: true }), '收集素材')
    await fill(page.getByLabel('写下你的想法', { exact: true }), note, '保存原始记录')
    await click(page.getByRole('button', { name: '保存并引用', exact: true }), '保存并引用')
    await click(tabs.getByRole('tab', { name: '方案', exact: true }), '方案页')
    await fill(page.getByLabel('方案选题'), idea, '选题')
    await fill(page.getByLabel('核心观点'), idea, '重复填写观点')
    await click(page.getByRole('button', { name: '确认方案，生成母稿', exact: true }), '确认并生成')
    await expect(page.getByLabel('文稿标题', { exact: true })).toHaveValue(idea)
    const body = page.getByLabel('文稿正文', { exact: true })
    await expect(body).not.toHaveValue('')
    const generated = await body.inputValue()
    await fill(body, generated + '\n\n作者校订：先完成一次回顾。', '校订正文')
    await click(page.getByRole('button', { name: '更多工作区操作' }), '更多操作')
    const downloading = page.waitForEvent('download')
    await click(page.getByRole('menuitem', { name: '导出当前文稿' }), '导出 Markdown')
    const download = await downloading
    const exported = readFileSync((await download.path())!, 'utf8')
    expect(exported).toContain('作者校订：先完成一次回顾。')
    const directory = 'docs/ux/research/creation'
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'baseline.json'), JSON.stringify({
      evidence: 'scripted Electron mock; synthetic fixture; not human usability data',
      idea, note, steps, clicks: steps.filter(s => s.action === 'click').length,
      inputOperations: steps.filter(s => s.action === 'fill').length,
      keyboardShortcuts: 0, userKeystrokes: null,
      elapsedAutomationMs: Date.now() - started, taskWaits: 1,
      workspaceTransitions: 3, repeatedIntentEntries: 1,
      rawNoteInGeneratedBody: generated.includes(note), exportMatchesEditedBody: true,
      humanSuccessRate: null, humanWorkload: null, blindQualityScore: null,
    }, null, 2))
    writeFileSync(join(directory, 'baseline.md'), exported)
    await page.screenshot({ path: join(directory, 'baseline.png') })
  } finally { await app.close() }
})

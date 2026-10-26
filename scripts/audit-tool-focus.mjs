import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const env = {
  ...process.env,
  STUDIO_SMOKE: '1',
  STUDIO_USER_DATA: await mkdtemp(join(tmpdir(), 'studio-focus-')),
}
delete env.ELECTRON_RUN_AS_NODE
const directory = 'docs/ux/research/layout-followup-fixed-2026-10-26'
await mkdir(directory, { recursive: true })
const app = await electron.launch({ args: ['.'], env })
const evidence = []
try {
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1480, height: 960 })
  await expect(page.getByLabel('文稿标题', { exact: true })).toHaveValue('让灵感成为作品')
  await page.getByRole('button', { name: '展开 Agent', exact: true }).click()
  await page.evaluate(() => {
    window.toolFocusEvents = []
    for (const type of ['focusin', 'focusout'])
      document.addEventListener(type, (e) => {
        const el = e.target
        window.toolFocusEvents.push({
          type,
          tag: el.tagName,
          id: el.id,
          label: el.getAttribute('aria-label'),
        })
      })
  })
  await page.getByRole('button', { name: '作品工具', exact: true }).click()
  await page.getByRole('menuitem', { name: '创作方案', exact: true }).click()
  const label = page.locator('[data-slot="field-label"]').filter({ hasText: /^选题$/ })
  await label.click()
  const read = async (stage) => {
    const data = await label.evaluate((label) => {
      const input = document.querySelector('[aria-label="方案选题"]')
      const active = document.activeElement
      return {
        htmlFor: label.htmlFor,
        control: label.control?.outerHTML.slice(0, 180),
        inputId: input?.id,
        matches: [...document.querySelectorAll('[id]')].filter((e) => e.id === label.htmlFor).length,
        active: { tag: active?.tagName, id: active?.id, label: active?.getAttribute('aria-label') },
        inputIsActive: input === active,
        documentHasFocus: document.hasFocus(),
        events: window.toolFocusEvents,
      }
    })
    evidence.push({ stage, ...data })
  }
  await read('after-label-click')
  await page.waitForTimeout(700)
  await read('settled')
  await page.getByLabel('方案选题', { exact: true }).click()
  await read('after-direct-input-click')
} finally {
  await writeFile(`${directory}/tool-focus.json`, JSON.stringify(evidence, null, 2))
  await app.close()
}

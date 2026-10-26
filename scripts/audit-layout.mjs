import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const directory = 'docs/ux/research/layout-2026-10-26'
await mkdir(directory, { recursive: true })
const env = { ...process.env, STUDIO_SMOKE: '1', STUDIO_USER_DATA: await mkdtemp(join(tmpdir(), 'studio-layout-audit-')) }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env })
const screens = [], observations = [], errors = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', e => errors.push(e.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1480, height: 960 })
  await expect(page.getByLabel('文稿标题', { exact: true })).toHaveValue('让灵感成为作品')
  const capture = async id => {
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `${directory}/${id}.png`, animations: 'disabled' })
    const metrics = await page.evaluate(() => {
      const visible = e => !!e?.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'
      const rect = e => {
        if (!visible(e)) return null
        const r = e.getBoundingClientRect()
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), bottom: Math.round(r.bottom) }
      }
      const nav = document.querySelector('.artifact-nav')
      const navRect = nav?.getBoundingClientRect()
      return {
        viewport: { width: innerWidth, height: innerHeight },
        sidebar: rect(document.querySelector('[aria-label="内容导航"]')),
        main: rect(document.querySelector('main')),
        agent: rect(document.querySelector('.desktop-panels .agent-panel')),
        creation: rect(document.querySelector('[aria-label="从想法到母稿"]')),
        title: rect(document.querySelector('[aria-label="文稿标题"]')),
        body: rect(document.querySelector('[aria-label="文稿正文"]')),
        inputAreas: [...document.querySelectorAll('textarea')].filter(visible).map(e => ({ label: e.getAttribute('aria-label'), ...rect(e) })),
        activeArtifactTabs: [...document.querySelectorAll('[aria-label="内容产物"] [role="tab"][data-state="active"]')].map(e => e.textContent),
        artifactTabs: [...document.querySelectorAll('[aria-label="内容产物"] [role="tab"]')].map(e => {
          const r = e.getBoundingClientRect()
          return { label: e.textContent, fullyInsideNav: !!navRect && r.left >= navRect.left - 1 && r.right <= navRect.right + 1 }
        }),
        nav: nav ? { width: nav.clientWidth, contentWidth: nav.scrollWidth, scrollLeft: nav.scrollLeft } : null,
        scrollAreas: [...document.querySelectorAll('main *, .agent-panel *')].filter(e => visible(e) && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4).map(e => ({ tag: e.tagName, class: String(e.className).slice(0, 100), ...rect(e) })),
        context: document.querySelector('.context-chip')?.textContent,
        primaryActions: [...document.querySelectorAll('main [data-slot="button"][data-variant="default"]')].filter(visible).map(e => e.textContent || e.getAttribute('aria-label')),
      }
    })
    screens.push({ id, ...metrics })
    console.log(id, JSON.stringify(metrics))
  }
  if (process.argv.includes('--tablet-only')) {
    for (const width of [1099, 1000, 768]) {
      await page.setViewportSize({ width, height: 960 })
      await page.reload()
      await expect(page.getByRole('button', { name: '收起内容库', exact: true })).toBeVisible()
      await page.waitForTimeout(500)
      await capture(`13-tablet-fresh-${width}`)
    }
    await page.getByRole('button', { name: '收起内容库', exact: true }).click()
    await capture('14-tablet-sidebar-collapsed')
  } else {
  await capture('01-existing-writing')
  await page.getByRole('button', { name: '新建内容', exact: true }).click()
  await capture('02-new-content')
  const raw = '每周回顾：少收集一点\n周五记录：存了 12 条，只重读 2 条。'
  await page.getByLabel('想法与原始记录', { exact: true }).fill(raw)
  await page.getByLabel('Agent 消息', { exact: true }).fill('请使用刚才输入的记录，帮我继续创作。')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.chat-artifact').last()).toBeVisible()
  observations.push(await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('content-studio.mock-workspace.v2'))
    const p = s.projects.find(p => p.id === s.selectedProject)
    const messages = p.conversations.flatMap(c => c.messages)
    return { case: 'creation-input-and-agent-context', creationInput: p.creation.input, lastUserMessage: messages.filter(m => m.role === 'user').at(-1)?.text, lastReply: messages.filter(m => m.role === 'assistant').at(-1)?.text, bodyEmpty: !p.drafts.master.body }
  }))
  await capture('03-agent-separate-context')
  await page.getByRole('button', { name: '整理成初稿', exact: true }).click()
  await expect(page.getByRole('button', { name: '调整方向与素材' })).toBeVisible()
  await capture('04-ready-content')
  await page.getByRole('button', { name: '调整方向与素材' }).click()
  await page.getByLabel('想法与原始记录', { exact: true }).fill('改变角度：先重读再收藏\n这是新方向下的记录。')
  await page.getByRole('button', { name: '按新方向准备候选' }).click()
  await page.getByRole('button', { name: '比较原稿与候选' }).click()
  await capture('05-candidate-comparison')
  for (const width of [1280, 1100, 1099, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    await capture(`06-candidate-${width}`)
  }
  await page.setViewportSize({ width: 1480, height: 960 })
  await page.getByRole('button', { name: '新建内容', exact: true }).click()
  await page.getByRole('button', { name: '发布准备', exact: true }).click()
  await capture('07-empty-publish')
  await page.getByRole('button', { name: '素材库', exact: true }).click()
  await capture('08-global-materials')
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await capture('09-global-tasks')
  await page.getByRole('button', { name: '让灵感成为作品', exact: true }).click()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('tab', { name: '小红书', exact: true }).click()
  await page.getByRole('tab', { name: '预览', exact: true }).click()
  await capture('10-platform-preview')
  observations.push({ case: 'preview-editability', previewTabSelected: await page.getByRole('tab', { name: '预览', exact: true }).getAttribute('data-state'), titleEditable: await page.getByLabel('文稿标题', { exact: true }).isEditable(), tagsEditable: await page.getByLabel('平台话题', { exact: true }).isEditable() })
  await page.setViewportSize({ width: 390, height: 844 })
  await capture('11-mobile-writing')
  await page.getByRole('button', { name: '展开 Agent', exact: true }).click()
  await capture('12-mobile-agent')
  }
} finally {
  await writeFile(`${directory}/observations${process.argv.includes('--tablet-only') ? '-tablet' : ''}.json`, JSON.stringify({ evidence: 'local Electron cognitive walkthrough; synthetic seed; no human participant study', screens, observations, errors }, null, 2))
  await app.close()
}

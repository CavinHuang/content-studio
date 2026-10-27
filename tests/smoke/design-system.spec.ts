import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StudioState } from '../../packages/ui/src/studio/types'

let app: ElectronApplication, page: Page
let errors: string[]
test.setTimeout(60_000)
test.beforeEach(async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({
    executablePath: process.env.STUDIO_TEST_EXECUTABLE,
    args: process.env.STUDIO_TEST_EXECUTABLE ? [] : ['packages/desktop'],
    env: { ...env, STUDIO_SMOKE: '1', STUDIO_USER_DATA: mkdtempSync(join(tmpdir(), 'studio-design-')) },
  })
  page = await app.firstWindow()
  errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.setViewportSize({ width: 1480, height: 960 })
  await expect(page.getByLabel('文稿标题', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '展开 Agent', exact: true }).click()
})
test.afterEach(async ({}, info) => {
  try {
    await page.screenshot({ path: info.outputPath('workspace.png') })
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

async function tool(name: string) {
  const local = page.getByRole('tablist', { name: '作品辅助内容' }).getByRole('tab', { name, exact: true })
  if (await local.isVisible()) {
    await local.click()
    return
  }
  await page.getByRole('button', { name: '作品工具', exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}

test('tokens, keyboard tabs, typography sliders, dialog focus and resize persistence', async () => {
  await expect(page.locator('.title-input')).toHaveCSS('font-size', '30px')
  await expect(page.locator('.document-status')).toBeVisible()
  await expect(page.getByRole('button', { name: /新建内容/ }).first()).toHaveCSS('height', '36px')
  await expect(page.locator('.sidebar-actions [data-slot="input-group"]')).toHaveCSS('height', '36px')
  await expect(page.locator('[data-slot="message-scroller-content"]')).toHaveCSS('gap', '16px')
  await expect(page.locator('.agent-panel [data-slot="bubble-content"]').first()).toHaveCSS(
    'font-family',
    await page.locator('body').evaluate((element) => getComputedStyle(element).fontFamily),
  )
  const alignment = await page.evaluate(() => ({
    headers: ['.sidebar-brand', '.work-header', '.agent-header'].map(
      (selector) => document.querySelector(selector)!.getBoundingClientRect().height,
    ),
    icons: [...document.querySelectorAll('.project-file')].map(
      (element) => element.getBoundingClientRect().x,
    ),
  }))
  expect(Math.max(...alignment.headers) - Math.min(...alignment.headers)).toBeLessThan(1)
  expect(Math.max(...alignment.icons) - Math.min(...alignment.icons)).toBeLessThan(1)
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
    ),
  ).toBe('#34583b')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 252, 247)')
  await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(242, 238, 229)')
  await expect(page.locator('.agent-panel')).toHaveCSS('background-color', 'rgb(246, 245, 237)')
  await expect(page.locator('.new-content')).toHaveCSS('background-color', 'rgb(52, 88, 59)')
  const platforms = page.getByRole('tablist', { name: '文稿平台' })
  await platforms.getByRole('tab', { name: '母稿', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(platforms.getByRole('tab', { name: '公众号', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.getByRole('button', { name: '排版', exact: true }).click()
  const slider = page.getByRole('slider', { name: '正文字号' })
  const size = Number(await slider.getAttribute('aria-valuenow'))
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuenow', String(size + 1))
  await expect(page.locator('.document-preview > .markdown')).toHaveCSS('font-size', `${size + 1}px`)
  await page.keyboard.press('Escape')
  await expect(slider).toHaveCount(0)
  const trigger = page.getByRole('button', { name: '添加平台版本' })
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  expect(
    await page
      .getByRole('main', { includeHidden: true })
      .evaluate((el) => Boolean(el.closest('[aria-hidden="true"]'))),
  ).toBe(true)
  await page.keyboard.press('Tab')
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.click()
  await expect(dialog).toBeVisible()
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  const handle = page.getByRole('separator', { name: '调整内容库宽度' })
  const before = await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width)
  await handle.focus()
  await page.keyboard.press('ArrowRight')
  await expect
    .poll(() => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width))
    .toBeGreaterThan(before)
  const after = await page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width)
  await expect
    .poll(() => page.evaluate(() => window.__studio!.get().layout.left))
    .toBeCloseTo(after, 0)
  await page.reload()
  await expect
    .poll(() => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width))
    .toBeCloseTo(after, 0)
})

test('artifact tabs keep mouse selection clean and keyboard focus visible', async () => {
  const tabs = page.getByRole('tablist', { name: '内容产物' })
  const brief = tabs.getByRole('tab', { name: '文稿', exact: true })
  const article = tabs.getByRole('tab', { name: '视频', exact: true })
  await brief.click()
  await expect(brief).toBeFocused()
  await expect(brief).toHaveAttribute('aria-selected', 'true')
  await expect(brief).toHaveCSS('outline-style', 'none')
  await expect(brief).toHaveCSS('border-color', 'rgba(0, 0, 0, 0)')
  await expect.poll(() => brief.evaluate((element) => getComputedStyle(element, '::after').opacity)).toBe('1')

  await page.keyboard.press('ArrowRight')
  await expect(article).toBeFocused()
  await expect(article).toHaveAttribute('aria-selected', 'true')
  await expect(article).toHaveCSS('outline-style', 'solid')
  await expect
    .poll(() => article.evaluate((element) => parseFloat(getComputedStyle(element).outlineOffset)))
    .toBeLessThan(0)
  await page.keyboard.press('Tab')
  await expect(article).not.toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(article).toBeFocused()
  await expect(article).toHaveCSS('outline-style', 'solid')

  await brief.click()
  await tool('创作方案')
  await page.getByRole('textbox', { name: '方案选题', exact: true }).fill('整理我的创作方向')
  await page.getByRole('button', { name: '关闭作品工具', exact: true }).click()
  await article.click()
  await expect(article).toBeFocused()
  await expect(article).toHaveCSS('outline-style', 'none')
  await page.keyboard.press('Home')
  await expect(brief).toBeFocused()
  await expect(brief).toHaveCSS('outline-style', 'solid')
})

test('form controls retain upstream typography and borders across business layouts', async () => {
  await expect(page.locator('.sidebar')).toHaveCSS('border-right-width', '0px')
  await expect(page.locator('.agent-panel')).toHaveCSS('border-left-width', '0px')
  const views = page.getByRole('tablist', { name: '文稿视图' })
  await views.getByRole('tab', { name: '编辑', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '文稿正文', exact: true })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(views.getByRole('tab', { name: '预览', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.document-preview')).toBeVisible()

  await tool('创作方案')
  const point = page.getByRole('textbox', { name: '核心观点', exact: true })
  await expect(point).toHaveCSS('font-weight', '400')
  await expect(point).toHaveAccessibleDescription('不是信息的堆砌，而是你想说的一句话。')
  await page
    .locator('[data-slot="field-label"]')
    .filter({ hasText: /^核心观点$/ })
    .click()
  await expect(point).toBeFocused()
  await expect(page.getByRole('textbox', { name: '写给谁', exact: true })).toHaveCSS('font-weight', '400')

  const differences = await page
    .locator('.brief-page [data-slot="input"], .brief-page [data-slot="textarea"]')
    .evaluateAll((elements) => {
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;left:-10000px;top:0;width:600px;visibility:hidden'
      document.body.append(host)
      const properties = [
        'fontFamily',
        'fontSize',
        'fontWeight',
        'lineHeight',
        'borderTopWidth',
        'borderRadius',
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
      ] as const
      try {
        return elements.flatMap((element) => {
          const clone = element.cloneNode(true) as HTMLElement
          clone.removeAttribute('id')
          host.append(clone)
          const actual = getComputedStyle(element),
            reference = getComputedStyle(clone)
          const differences = properties.filter((property) => actual[property] !== reference[property])
          if (element.matches('[data-slot="input"]') && actual.height !== reference.height)
            differences.push('height' as (typeof properties)[number])
          return differences.length
            ? [{ control: element.getAttribute('aria-label') ?? element.id, differences }]
            : []
        })
      } finally {
        host.remove()
      }
    })
  expect(differences).toEqual([])

  await page.locator('.global-nav').getByRole('button', { name: '热点', exact: true }).click()
  const search = page.getByRole('textbox', { name: /^搜索热点/ })
  await search.focus()
  await expect(page.locator('.search-field')).toHaveCSS('outline-style', 'none')
  await expect(page.getByRole('tab', { name: '综合', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'AI 科技', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'AI 科技', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('tab', { name: '综合', exact: true })).toHaveAttribute('aria-selected', 'false')
})

test('conversation menus handle long labels, keyboard selection and focus recovery', async ({}, info) => {
  await expect
    .poll(() => page.evaluate(() => window.__studio?.get().selectedProject))
    .toBeTruthy()
  await page.evaluate(() => {
    const state = JSON.parse(JSON.stringify(window.__studio!.get())) as StudioState
    const project = state.projects.find((p) => p.id === state.selectedProject)!
    project.conversations[0]!.title = '这是一段用于验证长会话标题不会撑破菜单的文字'.repeat(5)
    project.conversations = [
      project.conversations[0]!,
      { id: 'keyboard-conversation', title: '键盘切换测试', messages: [] },
    ]
    const material = state.materials.find((m) => project.materialIds.includes(m.id))!
    material.title = '这是一份用于验证素材选择器宽度与省略显示的长标题'.repeat(5)
    window.__studio!.replace(state)
  })
  await page.evaluate(() => window.__studio!.save())
  await page.reload()
  await page.getByRole('button', { name: '展开 Agent', exact: true }).click()
  const trigger = page.getByRole('button', { name: /^切换对话：/ })
  await trigger.click()
  const menu = page.getByRole('menu', { name: /^切换对话：/ })
  const options = menu.getByRole('menuitemradio')
  await expect(options.first()).toHaveAttribute('aria-checked', 'true')
  const layout = await options.evaluateAll((items) =>
    items.map((item) => ({
      clipped: item.scrollHeight > item.clientHeight + 1,
      overflow: item.scrollWidth > item.clientWidth + 1,
    })),
  )
  expect(layout.every((item) => !item.clipped && !item.overflow)).toBe(true)
  const menuBounds = await menu.boundingBox(),
    panelBounds = await page.locator('.agent-panel').boundingBox()
  expect(menuBounds!.x).toBeGreaterThanOrEqual(panelBounds!.x)
  expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(panelBounds!.x + panelBounds!.width)
  await page.screenshot({ path: info.outputPath('conversation-menu.png') })
  await options.first().focus()
  await page.keyboard.press('ArrowDown')
  await expect(options.nth(1)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Agent 消息' })).toBeFocused()
  await expect(trigger).toHaveAccessibleName('切换对话：键盘切换测试')
  await trigger.click()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await trigger.click()
  await page.getByRole('menuitem', { name: '开始新的对话' }).click()
  await expect(page.getByRole('textbox', { name: 'Agent 消息' })).toBeFocused()

  await page.getByRole('button', { name: '引用素材到对话' }).click()
  const picker = page.getByRole('dialog', { name: '引用素材列表' })
  const material = picker.getByRole('button', { name: /^这是一份用于验证/ })
  await expect(material).toBeVisible()
  await expect(material).toBeFocused()
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0)
  expect(await material.evaluate((item) => item.scrollWidth <= item.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: info.outputPath('material-picker.png') })
  await material.click()
  await expect(picker).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Agent 消息' })).toBeFocused()
})

test('filters recover from empty results and keep search and expansion accessible', async () => {
  await tool('创作方案')
  await page
    .locator('[data-slot="field-label"]')
    .filter({ hasText: /^选题$/ })
    .click()
  await expect(page.getByRole('textbox', { name: '方案选题' })).toBeFocused()
  await page
    .locator('.global-nav')
    .getByRole('button', { name: /素材库/ })
    .click()
  const expand = page.getByRole('button', { name: /^收起素材原文：/ }).first()
  const id = await expand.getAttribute('aria-controls')
  await expect(expand).toHaveAttribute('aria-expanded', 'true')
  await expand.click()
  await expect(page.locator(`[id="${id}"]`)).toBeHidden()
  await expect(page.getByRole('button', { name: /^展开素材原文：/ }).first()).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  const search = page.getByRole('textbox', { name: '搜索素材', exact: true })
  await search.fill('不会匹配任何素材的关键词')
  await expect(page.getByRole('heading', { name: '没有找到相关素材' })).toBeVisible()
  await expect(page.getByRole('button', { name: '收集第一份素材', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '清除搜索', exact: true }).click()
  await expect(search).toBeFocused()
  await expect(page.locator('.material-card').first()).toBeVisible()
  await search.fill('不会匹配任何素材的关键词')
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await expect(search).toBeFocused()
  await expect(search).toHaveValue('')
  await expect(page.locator('.material-card').first()).toBeVisible()
  await search.fill('  ')
  await expect(page.locator('.material-card').first()).toBeVisible()

  await page
    .getByRole('button', { name: /新建内容/ })
    .first()
    .click()
  await tool('参考素材')
  await page.getByRole('button', { name: '查看全部素材', exact: true }).click()
  const allMaterials = page.getByRole('tablist', { name: '素材范围' }).getByRole('tab', { name: /^全部素材/ })
  await expect(allMaterials).toHaveAttribute('aria-selected', 'true')
  await expect(allMaterials).toBeFocused()
  await expect(page.locator('.material-card').first()).toBeVisible()

  await page
    .locator('.sidebar-bottom')
    .getByRole('button', { name: /任务中心/ })
    .click()
  const filter = page.getByRole('button', { name: '进行中', exact: true })
  await filter.click()
  await expect(filter).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { name: '没有符合筛选的任务' })).toBeVisible()
  await page.getByRole('button', { name: '查看全部任务', exact: true }).click()
  await expect(page.getByRole('button', { name: '全部任务', exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: '全部任务', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.locator('.task-card').first()).toBeVisible()
})

test('save failures offer a retry while successful saves remain a status', async () => {
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  const status = page.getByRole('status', { name: '保存文稿状态' })
  await expect(status).toContainText('已保存')
  await expect(page.getByRole('button', { name: '保存文稿状态' })).toHaveCount(0)
  await page.evaluate(() => window.__studio!.__failNextSave())
  await page.getByRole('textbox', { name: '文稿标题', exact: true }).fill('保存恢复验证')
  await page.getByRole('button', { name: '保存失败，重试保存', exact: true }).click()
  await expect(status).toContainText('已保存')
  expect(
    await page.evaluate(() => window.__studio!.get().projects[0]!.drafts.master!.title),
  ).toBe('保存恢复验证')
})

test('AI Elements input respects composition, newline, context and independent conversation', async () => {
  const input = page.getByRole('textbox', { name: 'Agent 消息' })
  const before = await page.locator('[data-slot="message"]').count()
  await input.fill('整理一下我的写作方向')
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true })
  await expect(page.locator('[data-slot="message"]')).toHaveCount(before)
  await expect(input).toHaveValue('整理一下我的写作方向')
  await input.press('Shift+Enter')
  await expect(input).toHaveValue('整理一下我的写作方向\n')
  await input.press('Enter')
  await expect(page.locator('[data-slot="message"]')).toHaveCount(before + 2)
  await expect(input).toHaveValue('')
  await page.getByRole('button', { name: '引用素材到对话' }).click()
  const materials = page.getByRole('dialog', { name: '引用素材列表' })
  const material = materials
    .getByRole('button')
    .filter({ has: page.locator('span') })
    .first()
  const materialName = await material.locator('span').innerText()
  await material.click()
  await expect(page.locator('.context-chip')).toContainText(materialName)
  await expect(input).toBeFocused()
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  await expect(page.locator('[data-slot="message"]')).toHaveCount(0)
  await expect(page.getByText('这次想创作什么？', { exact: true })).toBeVisible()
})

test('unsent Agent drafts stay with their conversation and references preserve typed instructions', async () => {
  const input = page.getByRole('textbox', { name: 'Agent 消息', exact: true })
  const sidebar = page.locator('.sidebar')
  await input.fill('这篇内容的要求还没有写完，请保留这段输入')
  await page.getByRole('button', { name: '引用素材到对话', exact: true }).click()
  const material = page
    .getByRole('dialog', { name: '引用素材列表' })
    .getByRole('button')
    .filter({ has: page.locator('span') })
    .first()
  const reference = await material.locator('span').innerText()
  await material.click()
  await expect(input).toHaveValue('这篇内容的要求还没有写完，请保留这段输入')
  await tool('创作方案')
  await expect(page.getByLabel('核心观点', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭作品工具', exact: true }).click()
  await page.getByRole('button', { name: '展开 Agent', exact: true }).click()
  await expect(input).toHaveValue('这篇内容的要求还没有写完，请保留这段输入')
  await expect(page.locator('.context-chip')).toContainText(reference)
  await page.getByRole('button', { name: '新建对话', exact: true }).click()
  await expect(input).toHaveValue('')
  await expect(page.getByRole('button', { name: '移除对话上下文引用' })).toHaveCount(0)
  await input.fill('第二个会话独立的草稿')
  await page.getByRole('button', { name: /^切换对话：/ }).click()
  await page.getByRole('menuitemradio').first().click()
  await expect(input).toHaveValue('这篇内容的要求还没有写完，请保留这段输入')
  await expect(page.locator('.context-chip')).toContainText(reference)
  await page.locator('.global-nav').getByRole('button', { name: '热点', exact: true }).click()
  await expect(input).toHaveValue('')
  await expect(page.getByRole('button', { name: '移除对话上下文引用' })).toHaveCount(0)
  await input.fill('发现对话的独立草稿')
  await page.getByRole('button', { name: '来源管理', exact: true }).click()
  await expect(input).toHaveValue('发现对话的独立草稿')
  await sidebar.locator('.project-item').first().click()
  await expect(input).toHaveValue('这篇内容的要求还没有写完，请保留这段输入')
  await sidebar.locator('.project-item').nth(1).click()
  await expect(input).toHaveValue('')
  await input.fill('另一篇内容的输入')
  await sidebar.locator('.project-item').first().click()
  await expect(input).toHaveValue('这篇内容的要求还没有写完，请保留这段输入')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(input).toHaveValue('')
  await page.getByRole('button', { name: /^切换对话：/ }).click()
  await page.getByRole('menuitemradio', { name: /新的创作对话/ }).click()
  await expect(input).toHaveValue('第二个会话独立的草稿')
  await page.locator('.global-nav').getByRole('button', { name: '热点', exact: true }).click()
  await expect(input).toHaveValue('发现对话的独立草稿')
})

test('workspace survives responsive layout changes and long material dialogs stay usable', async ({}, info) => {
  await tool('参考素材')
  await page.locator('.work-area').evaluate((el) => el.setAttribute('data-review-identity', 'retained'))
  await page
    .locator('.material-card')
    .first()
    .getByRole('button', { name: /^查看素材：/ })
    .click()
  const detail = page.locator('[data-slot="dialog-content"]')
  const identity = await detail.getAttribute('id')
  const longTitle = '这是需要完整保留的素材标题_AssetWithoutAnyWhitespace'.repeat(18)
  await detail.getByRole('textbox', { name: '标题', exact: true }).fill(longTitle)
  for (const width of [1099, 767, 390, 1480, 390]) {
    await page.setViewportSize({ width, height: 600 })
    await expect(page.getByRole('dialog')).toHaveCount(1)
    await expect(detail).toHaveAttribute('id', identity!)
    await expect(detail).not.toHaveAttribute('aria-hidden', 'true')
    await expect(page.locator('.work-area')).toHaveAttribute('data-review-identity', 'retained')
    await expect(detail.getByRole('button', { name: '插入正文', exact: true })).toBeInViewport({ ratio: 1 })
    expect(await detail.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  }
  const title = detail.getByRole('textbox', { name: '标题', exact: true })
  await title.focus()
  await expect(title).toBeInViewport({ ratio: 1 })
  await expect(detail.getByRole('button', { name: '关闭弹窗', exact: true })).toBeInViewport({ ratio: 1 })
  const scroll = detail.locator('.modal-scroll')
  expect(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight && el.clientHeight > 0)).toBe(true)
  await page.screenshot({ path: info.outputPath('long-material-dialog.png') })
  await detail.getByRole('button', { name: '删除原素材', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: '将原素材移入回收站？', exact: true })
  await expect(confirm).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(confirm).toHaveCount(0)
  await expect(detail.getByRole('button', { name: '删除原素材', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(detail).toHaveCount(0)
  await expect(
    page
      .locator('.material-card')
      .first()
      .getByRole('button', { name: /^查看素材：/ }),
  ).toBeFocused()
  await tool('创作方案')
  const point = page.getByRole('textbox', { name: '核心观点', exact: true })
  await point.fill('窗口缩放时仍在编辑的核心观点')
  await point.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 5))
  await page.setViewportSize({ width: 1480, height: 960 })
  await expect(point).toBeFocused()
  await expect(point).toHaveValue('窗口缩放时仍在编辑的核心观点')
  expect(await point.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([
    2, 5,
  ])
})

test('responsive sheets, sources switch and local assets remain usable', async () => {
  await page.locator('.global-nav').getByRole('button', { name: /热点/ }).click()
  await expect(page.locator('.topic-card').first()).toHaveCSS('flex-direction', 'row')
  await page.getByRole('button', { name: '来源管理', exact: true }).click()
  const source = page.getByRole('switch').first()
  const enabled = await source.isChecked()
  await source.click()
  await expect(source).toBeChecked({ checked: !enabled })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('navigation', { name: '手机主要导航' })).toBeVisible()
  await page.getByRole('button', { name: '展开内容库', exact: true }).click()
  const navigation = page.getByRole('dialog', { name: '内容导航', exact: true })
  await expect(navigation).toBeVisible()
  await expect(navigation.getByRole('textbox', { name: '搜索内容' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(navigation).toHaveCount(0)
  await expect(page.getByRole('button', { name: '展开内容库', exact: true })).toBeFocused()
  await page
    .getByRole('navigation', { name: '手机主要导航' })
    .getByRole('button', { name: '内容', exact: true })
    .click()
  await expect(page.locator('.header-actions')).toBeInViewport({ ratio: 1 })
  for (const name of ['发布准备', '更多工作区操作（含设置）', '展开 Agent'])
    await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 })
  await page.getByRole('button', { name: '展开 Agent', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '创作 Agent', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Agent 消息' })).toBeVisible()
  const sheetWidth = await page
    .locator('.agent-sheet')
    .evaluate((element) => element.getBoundingClientRect().width)
  expect(sheetWidth).toBeGreaterThanOrEqual(389)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('sidebar project navigation, project actions and desktop/mobile shortcuts', async () => {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  const sidebar = page.getByRole('complementary', { name: '内容导航', exact: true })
  const search = page.getByRole('textbox', { name: '搜索内容', exact: true })
  await expect(
    sidebar.getByRole('list', { name: '工作区导航' }).getByRole('button', { name: '热点' }),
  ).toHaveCSS('height', '32px')
  expect(await sidebar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  const submenus = sidebar.locator('[data-slot="sidebar-menu-sub-button"]')
  await expect(submenus).toHaveCount(0)
  await expect(page.getByRole('tablist', { name: '内容产物' }).getByRole('tab')).toHaveCount(2)

  await page.keyboard.press(`${modifier}+b`)
  await expect(sidebar).toHaveCount(0)
  await page.keyboard.press(`${modifier}+k`)
  await expect(search).toBeFocused()
  await search.fill('阅读')
  await expect(sidebar.locator('.project-item')).toHaveCount(1)
  await expect(sidebar.locator('.project-item')).toContainText('我的阅读手记')
  await search.fill('不存在的内容')
  await expect(sidebar.getByRole('status')).toContainText('没有找到相关内容')
  await sidebar.getByRole('button', { name: '清除搜索', exact: true }).click()
  await expect(sidebar.locator('.project-item')).toHaveCount(3)

  await sidebar.locator('.project-item').first().focus()
  await sidebar.getByRole('button', { name: '管理内容：让灵感成为作品', exact: true }).click()
  const name = '一篇包含很多具体观察与个人思考、需要完整保存的长标题内容'
  const dialog = page.getByRole('dialog', { name: '管理这篇内容', exact: true })
  await dialog.getByRole('textbox', { name: '内容名称', exact: true }).fill(name)
  await dialog.getByRole('button', { name: '保存名称', exact: true }).click()
  await expect(sidebar.locator('.project-item').first()).toHaveAttribute('title', name)
  await expect(page.getByLabel('文稿标题', { exact: true })).toHaveValue('让灵感成为作品')
  expect(await sidebar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await tool('创作方案')
  await expect(page.getByLabel('核心观点', { exact: true })).toBeVisible()
  await expect(page.locator('.workspace-page')).toHaveCSS('padding', '16px')
  await expect(page.locator('.form-grid')).toHaveCSS('gap', '12px')
  await expect(page.locator('.form-grid > .field').first()).toHaveCSS('margin-bottom', '0px')

  await page.getByRole('button', { name: '关闭作品工具', exact: true }).click()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '展开内容库', exact: true }).click()
  const navigation = page.getByRole('dialog', { name: '内容导航', exact: true })
  await expect(search).toBeFocused()
  expect(await sidebar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.keyboard.press(`${modifier}+b`)
  await expect(navigation).toHaveCount(0)
  await page.keyboard.press(`${modifier}+k`)
  await expect(search).toBeFocused()
  await sidebar.getByRole('button', { name: '热点', exact: true }).click()
  await expect(navigation).toHaveCount(0)
  await expect(page.getByRole('button', { name: '来源管理', exact: true })).toBeVisible()
})

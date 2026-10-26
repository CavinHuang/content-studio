import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const directory = process.env.STUDIO_UX_DIRECTORY || 'docs/ux/implementation/aligned'
await mkdir(directory, { recursive: true })
const env = {
  ...process.env,
  STUDIO_SMOKE: '1',
  STUDIO_USER_DATA: await mkdtemp(join(tmpdir(), 'studio-ux-')),
}
delete env.ELECTRON_RUN_AS_NODE
if (process.argv.includes('--dev')) env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173/'
const app = await electron.launch({ args: ['.'], env })
const errors = [],
  screens = []
try {
  const page = await app.firstWindow()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.setViewportSize({ width: 1480, height: 992 })
  const tabs = () => page.getByRole('tablist', { name: '内容产物' })
  const capture = async (id, reference, name, basis = '页面设计稿') => {
    await page.evaluate(async () => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      await document.fonts.ready
    })
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10_000 })
    await page.mouse.move(-10, -10)
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0)
    await page.waitForTimeout(350)
    await page.screenshot({ path: `${directory}/${id}.png`, animations: 'disabled' })
    const bounds = await page.evaluate(() => {
      const main = document.querySelector('main')?.getBoundingClientRect()
      const sidebar = document.querySelector('.desktop-panels .sidebar')?.getBoundingClientRect()
      const agent = document.querySelector('.desktop-panels .agent-panel')?.getBoundingClientRect()
      const header = document.querySelector('.agent-header h2')?.getBoundingClientRect()
      const thread = document.querySelector('.agent-thread-bar')?.getBoundingClientRect()
      const actions = document.querySelector('.header-actions')?.getBoundingClientRect()
      const workHeader = document.querySelector('.work-header')?.getBoundingClientRect()
      const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(
        (element) => element.getClientRects().length,
      )
      const spacingOf = (selector) => {
        const element = [...document.querySelectorAll(selector)].find((item) => item.getClientRects().length)
        if (!element) return null
        const style = getComputedStyle(element)
        return { padding: style.padding, gap: style.gap, margin: style.margin }
      }
      return {
        width: innerWidth,
        height: innerHeight,
        sidebar: sidebar?.width,
        editor: main?.width,
        agent: agent?.width,
        appearance: {
          uiFontFamily: getComputedStyle(document.body).fontFamily,
          fieldControlWeights: [
            ...new Set(
              [...document.querySelectorAll('.field input, .field textarea, .field select')]
                .filter((item) => item.getClientRects().length)
                .map((item) => getComputedStyle(item).fontWeight),
            ),
          ],
          sidebarEdge: document.querySelector('.desktop-panels .sidebar')
            ? getComputedStyle(document.querySelector('.desktop-panels .sidebar')).borderRightWidth
            : null,
          agentEdge: document.querySelector('.desktop-panels .agent-panel')
            ? getComputedStyle(document.querySelector('.desktop-panels .agent-panel')).borderLeftWidth
            : null,
        },
        spacing: {
          page: spacingOf('.workspace-page'),
          card: spacingOf('.topic-card, .material-card, .service-card, .task-card, .source-card'),
          messages: spacingOf('[data-slot="message-scroller-content"]'),
          agent: spacingOf('.agent-transcript'),
          form: spacingOf('.form-grid'),
          fieldMargins: [...document.querySelectorAll('.form-grid > .field')]
            .filter((item) => item.getClientRects().length)
            .map((item) => getComputedStyle(item).marginBottom),
        },
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        headerActionClipping: Boolean(workHeader?.width && actions && main && actions.right > main.right + 1),
        workspaceHorizontalOverflow: [...document.querySelectorAll('.workspace-page')].some(
          (element) => element.scrollWidth > element.clientWidth + 1,
        ),
        agentHeaderOverlap: Boolean(header && thread && header.right > thread.left),
        dialogOverflow: dialogs.some((element) => {
          const rect = element.getBoundingClientRect()
          return (
            rect.left < -1 || rect.top < -1 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1
          )
        }),
        cardOverflow: [
          ...document.querySelectorAll(
            '.source-card, .subtitle-row, .service-card, .task-card, .platform-draft-summary, .export-result-card, .platform-option',
          ),
        ].some((element) => element.scrollWidth > element.clientWidth + 1),
      }
    })
    screens.push({ id, reference, name, basis, ...bounds })
    console.log(id, JSON.stringify(bounds))
    expect(bounds.horizontalOverflow).toBe(false)
    expect(bounds.headerActionClipping).toBe(false)
    expect(bounds.workspaceHorizontalOverflow).toBe(false)
    expect(bounds.agentHeaderOverlap).toBe(false)
    expect(bounds.dialogOverflow).toBe(false)
    expect(bounds.cardOverflow).toBe(false)
    for (const weight of bounds.appearance.fieldControlWeights) expect(weight).toBe('400')
    if (bounds.appearance.sidebarEdge !== null) expect(bounds.appearance.sidebarEdge).toBe('0px')
    if (bounds.appearance.agentEdge !== null) expect(bounds.appearance.agentEdge).toBe('0px')
    if (bounds.spacing.page) expect(bounds.spacing.page.padding).toBe('16px')
    if (bounds.spacing.messages) expect(bounds.spacing.messages.gap).toBe('16px')
    for (const margin of bounds.spacing.fieldMargins) expect(margin).toBe('0px')
  }
  await expect(page.getByLabel('文稿标题', { exact: true })).toHaveValue('让灵感成为作品')
  await capture('01-writing', '03-writing-review.png')
  await page.locator('.chat-artifact').filter({ hasText: '段落修改建议' }).click()
  await expect(page.getByRole('button', { name: '展开或收起修改建议' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await capture(
    '56-suggestion-expanded',
    '03-writing-review.png',
    '文稿 · 展开修改建议',
    '收起默认状态与按需对照交互',
  )
  await page.getByRole('button', { name: '展开或收起修改建议' }).click()
  await page.locator('.document-scroll').evaluate((element) => (element.scrollTop = 0))
  await page.getByRole('button', { name: '排版', exact: true }).click()
  await capture('02-typography', '05-typography.png')
  await page.keyboard.press('Escape')
  await tabs().getByRole('tab', { name: '创作方案', exact: true }).click()
  await capture('03-brief', '02-creative-plan.png')
  await tabs().getByRole('tab', { name: '素材', exact: true }).click()
  await capture('04-materials', '06-material-library.png')
  await page.getByRole('button', { name: '收集素材', exact: true }).click()
  await capture('05-capture', '07-material-capture.png')
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await page.locator('.global-nav').getByRole('button', { name: /热点/ }).click()
  await capture('06-hotspots', '17-hotspot-discovery-v2.png')
  await page.getByRole('button', { name: '来源管理', exact: true }).click()
  await capture('07-sources', '19-hotspot-source-management.png')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: '查看与创作', exact: true }).first().click()
  await capture('08-topic', '18-hotspot-to-create.png')
  await page.getByRole('button', { name: '让灵感成为作品', exact: true }).click()
  await page.getByRole('button', { name: '发布准备', exact: true }).click()
  await page.getByRole('checkbox', { name: /公众号/ }).check()
  await page.getByRole('checkbox', { name: /小红书/ }).check()
  await capture('09-publish', '14-publish-selection.png')
  await page.getByRole('button', { name: '继续，预览所选平台', exact: true }).click()
  await capture('10-handoff', '15-publish-handoff.png')
  await tabs().getByRole('tab', { name: '视频', exact: true }).click()
  await capture('11-video-entry', '08-video-entry.png')
  await page.getByRole('button', { name: /素材分镜.*让创作回到日常/ }).click()
  await capture('12-storyboard', '09-material-video.png')
  await page.getByRole('tab', { name: '配音与字幕', exact: true }).click()
  await capture('13-subtitles', '10-voice-subtitles.png')
  await page.getByRole('button', { name: '所有视频', exact: true }).click()
  await page.getByRole('button', { name: /Agent 代码创作.*把碎片时间/ }).click()
  await capture('14-animation', '11-agent-code-video.png')
  await page.getByRole('tab', { name: '创作说明', exact: true }).click()
  await capture('19-animation-brief', '11-agent-code-video.png', '代码动画 · 创作说明')
  await page.getByRole('tab', { name: '版本', exact: true }).click()
  await capture(
    '20-animation-versions',
    '13-version-restore.png',
    '代码动画 · 版本',
    '参照版本交互与通用视觉系统',
  )
  await page.getByRole('tab', { name: '作品预览', exact: true }).click()
  await page.getByRole('button', { name: '调整文案与颜色', exact: true }).click()
  await capture('21-animation-parameters', '11-agent-code-video.png', '代码动画 · 参数调整')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '查看代码', exact: true }).click()
  await capture('22-animation-code', '11-agent-code-video.png', '代码动画 · 代码示意')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '导出视频', exact: true }).click()
  await capture('23-export-dialog', '12-export-recovery.png', '导出设置确认')
  await page.getByRole('button', { name: '演练一次失败与恢复', exact: true }).click()
  await expect(page.getByText('演示导出未完成', { exact: true })).toBeVisible()
  await capture('24-export-recovery', '12-export-recovery.png', '导出失败与保留作品')
  await page.getByRole('button', { name: '返回作品预览', exact: true }).click()
  await page.getByRole('button', { name: '所有视频', exact: true }).click()
  await page.getByRole('button', { name: '新建视频', exact: true }).click()
  await capture('25-new-video', '08-video-entry.png', '新建独立视频作品')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /素材分镜.*让创作回到日常/ }).click()
  await page.getByRole('button', { name: '视频全局设置', exact: true }).click()
  await capture('26-video-settings', '09-material-video.png', '素材视频 · 输出设置')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '分镜版本历史', exact: true }).click()
  await capture(
    '27-storyboard-versions',
    '13-version-restore.png',
    '素材分镜 · 版本记录',
    '参照版本交互与通用视觉系统',
  )
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: '成片预览', exact: true }).click()
  await capture('28-storyboard-preview', '09-material-video.png', '素材分镜 · 画面预览')
  await tabs().getByRole('tab', { name: '文稿', exact: true }).click()
  await page.getByRole('tab', { name: '小红书', exact: true }).click()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  const platformBody = await page.getByRole('textbox', { name: '文稿正文', exact: true }).inputValue()
  await page
    .getByRole('textbox', { name: '文稿正文', exact: true })
    .fill(
      platformBody.replace(
        platformBody.split(/\n\s*\n/)[0],
        '先从今天记下的一个小念头开始，不急着把它写成完整的文章。',
      ),
    )
  await page.getByRole('tab', { name: '预览', exact: true }).click()
  await capture('29-platform-draft', '04-platform-drafts.png', '独立平台稿')
  await page.getByRole('button', { name: '版本历史', exact: true }).click()
  await capture('30-article-versions', '13-version-restore.png', '文稿版本比较与恢复')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '添加平台版本', exact: true }).click()
  await capture('31-platform-picker', '04-platform-drafts.png', '平台版本选择')
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: '母稿', exact: true }).click()
  await page.getByRole('button', { name: '发布准备', exact: true }).click()
  await page.getByRole('button', { name: /发布记录 1/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /批次/ }).first().click()
  await page.getByRole('button', { name: '标记已手动发布', exact: true }).click()
  await capture('32-publish-record', '15-publish-handoff.png', '人工发布结果记录')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /发布记录 1/ }).click()
  await capture('33-publish-history', '15-publish-handoff.png', '历史发布批次')
  await page.keyboard.press('Escape')
  await page.locator('.global-nav').getByRole('button', { name: '素材库', exact: false }).click()
  await capture('34-global-materials', '06-material-library.png', '全局素材库')
  await page.getByRole('button', { name: '收集素材', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '链接', exact: true }).click()
  await capture('35-capture-link', '07-material-capture.png', '收集链接')
  await page.getByRole('dialog').getByRole('button', { name: '图片', exact: true }).click()
  await capture('36-capture-image', '07-material-capture.png', '收集图片')
  await page.getByRole('dialog').getByRole('button', { name: '文件', exact: true }).click()
  await capture('37-capture-file', '07-material-capture.png', '收集文件')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '查看素材：创作，从一个小念头开始', exact: true }).click()
  await capture('38-material-detail', '06-material-library.png', '素材原文与引用详情')
  await page.keyboard.press('Escape')
  await page.getByRole('textbox', { name: '搜索素材', exact: true }).fill('没有匹配的素材-ux')
  await capture('39-material-empty', '06-material-library.png', '素材搜索空态', '沿用素材页与通用空态规范')
  await page.getByRole('textbox', { name: '搜索素材', exact: true }).fill('')
  await page.locator('.global-nav').getByRole('button', { name: /热点/ }).click()
  await page.getByRole('button', { name: '返回热点发现', exact: true }).click()
  await page.getByRole('button', { name: '来源管理', exact: true }).click()
  await page.getByRole('button', { name: '添加来源', exact: true }).click()
  await capture('40-source-settings', '19-hotspot-source-management.png', '添加信息源')
  await page.keyboard.press('Escape')
  await page
    .locator('.sidebar-bottom')
    .getByRole('button', { name: /任务中心/ })
    .click()
  await capture(
    '41-tasks',
    '00-visual-direction.png',
    '任务中心',
    '依据交互规范，沿用通用视觉系统；无独立效果图',
  )
  await page.getByRole('button', { name: '进行中', exact: true }).click()
  await capture(
    '42-task-empty',
    '00-visual-direction.png',
    '任务筛选空态',
    '依据交互规范，沿用通用视觉系统；无独立效果图',
  )
  await page.locator('.sidebar-bottom').getByRole('button', { name: /设置/ }).click()
  await capture(
    '43-settings-services',
    '00-visual-direction.png',
    '设置 · AI 服务',
    '依据交互规范，沿用通用视觉系统；无独立效果图',
  )
  await page.getByRole('tab', { name: '创作偏好', exact: true }).click()
  await capture(
    '44-settings-preferences',
    '00-visual-direction.png',
    '设置 · 创作偏好',
    '依据交互规范，沿用通用视觉系统；无独立效果图',
  )
  await page.getByRole('tab', { name: '数据与导出', exact: true }).click()
  await capture(
    '45-settings-data',
    '00-visual-direction.png',
    '设置 · 数据与导出',
    '依据交互规范，沿用通用视觉系统；无独立效果图',
  )
  await page.getByRole('button', { name: '重新载入示例', exact: true }).click()
  await capture(
    '46-reset-confirmation',
    '00-visual-direction.png',
    '数据替换确认',
    '依据交互规范，沿用通用视觉系统；无独立效果图',
  )
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '新建内容', exact: true }).click()
  await capture('47-new-content', '01-new-content.png', '新建内容 · 直接开写')
  await page.getByRole('button', { name: '添加素材', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '让灵感成为作品', exact: true }).click()
  await tabs().getByRole('tab', { name: '文稿', exact: true }).click()
  await page.setViewportSize({ width: 1100, height: 820 })
  await capture('15-compact-desktop', '03-writing-review.png')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await capture('16-mobile-writing', '16-mobile-companion.png')
  await page.getByRole('button', { name: '展开 Agent', exact: true }).click()
  await capture('17-mobile-agent', '16-mobile-companion.png')
  await page.getByRole('button', { name: '收起 Agent', exact: true }).click()
  await page.getByRole('button', { name: '展开内容库', exact: true }).click()
  await page.getByRole('button', { name: /热点/ }).click()
  await capture('18-mobile-hotspots', '16-mobile-companion.png')
  await page.getByRole('button', { name: '来源管理', exact: true }).click()
  await capture(
    '48-mobile-sources',
    '19-hotspot-source-management.png',
    '手机 · 来源管理',
    '沿用信息源结构与手机单列规范',
  )
  await page.getByRole('button', { name: '添加来源', exact: true }).click()
  await capture('49-mobile-source-dialog', '19-hotspot-source-management.png', '手机 · 信息源设置')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '展开内容库', exact: true }).click()
  await page
    .getByRole('dialog', { name: '内容导航', exact: true })
    .getByRole('button', { name: /设置/ })
    .click()
  await capture(
    '50-mobile-settings',
    '16-mobile-companion.png',
    '手机 · 服务设置',
    '依据交互规范，沿用通用视觉系统；无独立效果图',
  )
  await page.getByRole('tab', { name: '创作偏好', exact: true }).click()
  await capture(
    '51-mobile-preferences',
    '16-mobile-companion.png',
    '手机 · 创作偏好',
    '依据交互规范，沿用通用视觉系统；无独立效果图',
  )
  await page
    .getByRole('navigation', { name: '手机主要导航' })
    .getByRole('button', { name: '任务', exact: true })
    .click()
  await capture(
    '52-mobile-tasks',
    '16-mobile-companion.png',
    '手机 · 任务中心',
    '依据交互规范，沿用通用视觉系统；无独立效果图',
  )
  await page.getByRole('button', { name: '展开内容库', exact: true }).click()
  await page
    .getByRole('dialog', { name: '内容导航', exact: true })
    .getByRole('button', { name: '让灵感成为作品', exact: true })
    .click()
  await tabs().getByRole('tab', { name: '视频', exact: true }).click()
  await page.getByRole('button', { name: '所有视频', exact: true }).click()
  await page.getByRole('button', { name: /素材分镜.*让创作回到日常/ }).click()
  await page.getByRole('tab', { name: '配音与字幕', exact: true }).click()
  await capture(
    '53-mobile-subtitles',
    '10-voice-subtitles.png',
    '手机 · 字幕轻量校对',
    '沿用字幕校对结构与手机单列规范',
  )
  await tabs().getByRole('tab', { name: '文稿', exact: true }).click()
  await page.getByRole('button', { name: '版本历史', exact: true }).click()
  await capture(
    '54-mobile-history',
    '13-version-restore.png',
    '手机 · 版本对比',
    '沿用版本交互与手机单列规范',
  )
  await page.keyboard.press('Escape')
  await page
    .getByRole('navigation', { name: '手机主要导航' })
    .getByRole('button', { name: '收集', exact: true })
    .click()
  await capture(
    '55-mobile-capture',
    '07-material-capture.png',
    '手机 · 随手收集',
    '沿用素材收集与手机单列规范',
  )
  await page.keyboard.press('Escape')
  await writeFile(
    `${directory}/checks.json`,
    JSON.stringify(
      {
        date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()),
        mode: process.argv.includes('--dev') ? 'Vite development' : 'production',
        errors,
        screens: screens.sort((a, b) => a.id.localeCompare(b.id)),
      },
      null,
      2,
    ) + '\n',
  )
  expect(errors).toEqual([])
} finally {
  if (errors.length) console.log(JSON.stringify({ errors }))
  await app.close()
}

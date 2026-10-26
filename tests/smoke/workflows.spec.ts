import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let app: ElectronApplication, page: Page
let errors: string[]
test.setTimeout(60_000)
test.beforeEach(async () => {
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  delete env.ELECTRON_RUN_AS_NODE
  env.STUDIO_SMOKE = '1'
  env.STUDIO_USER_DATA = mkdtempSync(join(tmpdir(), 'studio-workflow-'))
  app = await electron.launch({
    executablePath: process.env.STUDIO_TEST_EXECUTABLE,
    args: process.env.STUDIO_TEST_EXECUTABLE ? [] : ['.'],
    env,
  })
  page = await app.firstWindow()
  errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.setViewportSize({ width: 1480, height: 960 })
  await expect(page.getByLabel('文稿标题', { exact: true })).toHaveValue('让灵感成为作品')
})
test.afterEach(async ({}, info) => {
  try {
    await page.screenshot({ path: info.outputPath('workspace.png') })
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
const artifacts = () => page.getByRole('tablist', { name: '内容产物' })

test('suggestions, independent platform editing, stale-source notice and version restore', async () => {
  const suggestion = page.getByRole('region', { name: 'Agent 修改建议' })
  await expect(suggestion).toHaveCount(1)
  expect(
    await suggestion.evaluate((element) => {
      const section = element.previousElementSibling
      const paragraph = element.nextElementSibling
      return (
        section?.tagName === 'H2' &&
        paragraph?.tagName === 'P' &&
        paragraph.textContent?.includes('形成自己的观点')
      )
    }),
  ).toBe(true)
  await expect(page.getByRole('button', { name: '采用修改', exact: true })).toBeHidden()
  await page.locator('.chat-artifact').filter({ hasText: '段落修改建议' }).click()
  await expect(suggestion.getByRole('button', { name: '展开或收起修改建议' })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await page.getByRole('button', { name: '采用修改', exact: true }).click()
  await expect(
    page.getByRole('region', { name: 'Agent 修改建议' }).getByText('已采用', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: '撤销这次修改' }).click()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  const original = await page.getByLabel('文稿正文', { exact: true }).inputValue()
  await page.getByRole('tab', { name: '小红书', exact: true }).click()
  await page.getByLabel('文稿正文', { exact: true }).fill('这是我手动修改的小红书独立版本。')
  await page.getByRole('button', { name: '保存当前版本', exact: true }).click()
  await page.getByRole('tab', { name: '母稿', exact: true }).click()
  await expect(page.getByLabel('文稿正文', { exact: true })).toHaveValue(original)
  await page.getByLabel('文稿正文', { exact: true }).fill(`${original}\n\n母稿增加了一条新的观察。`)
  await page.getByRole('tab', { name: '小红书', exact: true }).click()
  await expect(page.getByLabel('文稿正文', { exact: true })).toHaveValue('这是我手动修改的小红书独立版本。')
  await expect(page.getByText('母稿有更新，当前小红书版本保持独立。')).toBeVisible()
  await page.getByRole('button', { name: '版本历史', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button').filter({ hasText: '从母稿适配' }).click()
  await dialog.getByRole('button', { name: /恢复为新版本/ }).click()
  await expect(page.getByLabel('文稿正文', { exact: true })).not.toHaveValue(
    '这是我手动修改的小红书独立版本。',
  )
  await page.reload()
  await page.getByRole('tab', { name: '母稿', exact: true }).click()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await expect(page.getByLabel('文稿正文', { exact: true })).toHaveValue(
    `${original}\n\n母稿增加了一条新的观察。`,
  )
})

test('multi-source discovery becomes a new project without mixing its conversation with the original', async () => {
  await page.getByRole('button', { name: '热点发现', exact: true }).count()
  await page.locator('.global-nav').getByRole('button', { name: /热点/ }).click()
  await expect(page.getByText('示例话题 · 非实时', { exact: true })).toBeVisible()
  await expect(
    page.getByText('把「形成观点」这段改得更自然一点，保留我的意思。', { exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '查看与创作', exact: true }).first().click()
  await expect(page.getByText('4 个来源 · 3 篇去重原文', { exact: true })).toBeVisible()
  await page.getByRole('checkbox').nth(2).uncheck()
  await page.getByLabel('创作切入点').fill('把 AI 当作整理工具，保留自己的判断。')
  await page.getByRole('button', { name: '返回热点发现', exact: true }).click()
  await page.getByRole('button', { name: '查看与创作', exact: true }).first().click()
  await expect(page.getByLabel('创作切入点')).toHaveValue('把 AI 当作整理工具，保留自己的判断。')
  await expect(page.getByRole('checkbox').nth(2)).not.toBeChecked()
  await page.getByRole('button', { name: '用这个角度开始创作', exact: true }).click()
  await expect(page.getByLabel('核心观点')).toHaveValue('把 AI 当作整理工具，保留自己的判断。')
  await expect(page.getByText('已带入', { exact: false })).toBeVisible()
  await page.getByLabel('核心观点').fill('先形成问题，再使用工具整理信息，最后用自己的话表达。')
  await page.getByRole('button', { name: '确认方案，生成母稿', exact: true }).click()
  await expect(page.getByLabel('文稿标题', { exact: true })).toHaveValue('AI 工具，能帮普通人持续创作吗？')
  await artifacts().getByRole('tab', { name: '素材', exact: true }).click()
  await expect(page.getByText('工具替我们省下的时间，去了哪里？', { exact: true })).toBeVisible()
  await expect(page.getByText('一人创作工作流，正在变轻', { exact: true })).toHaveCount(0)
})

test('publish targets are explicit, snapshots are frozen, and copy does not mark published', async () => {
  await page.getByRole('button', { name: '发布准备', exact: true }).click()
  const checks = page.getByRole('checkbox')
  for (let index = 0; index < (await checks.count()); index++)
    await expect(checks.nth(index)).not.toBeChecked()
  await page.getByRole('checkbox', { name: /公众号/ }).check()
  await page.getByRole('checkbox', { name: /小红书/ }).check()
  await page.getByRole('button', { name: '继续，预览所选平台', exact: true }).click()
  await expect(page.locator('.publish-targets button')).toHaveCount(2)
  await page.getByRole('button', { name: '小红书', exact: true }).click()
  await page.getByRole('button', { name: '复制正文', exact: true }).click()
  await expect(page.getByText('等待手动交付', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '记录发布', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: '保存发布记录' })).toBeDisabled()
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('button', { name: '保存发布记录' }).click()
  await expect(page.getByText('已记录发布', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '改回未发布', exact: true }).click()
  await expect(page.getByText('等待手动交付', { exact: true })).toBeVisible()
  await artifacts().getByRole('tab', { name: '文稿', exact: true }).click()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByLabel('文稿标题', { exact: true }).fill('批次建立之后的新标题')
  await page.getByRole('button', { name: '发布准备', exact: true }).click()
  await page.getByRole('button', { name: /发布记录 1/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /批次/ }).first().click()
  await expect(page.locator('.publish-document h1')).toHaveText('让灵感成为作品')
})

test('material capture, reference removal and recycle restore preserve original and inserted text', async () => {
  await artifacts().getByRole('tab', { name: '素材', exact: true }).click()
  await page.getByRole('button', { name: '收集素材', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: '标题（可选）' }).fill('新的观察笔记')
  await dialog.getByRole('textbox', { name: '写下你的想法' }).fill('先观察具体场景，再做出自己的判断。')
  await dialog.getByRole('button', { name: '保存并引用', exact: true }).click()
  await page.getByRole('button', { name: '查看素材：新的观察笔记', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '插入文稿', exact: true }).click()
  await expect(page.locator('.document-preview')).toContainText('先观察具体场景，再做出自己的判断。')
  await artifacts().getByRole('tab', { name: '素材', exact: true }).click()
  await page.getByRole('button', { name: '查看素材：新的观察笔记', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '移除本篇引用', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除原素材', exact: true }).click()
  await page
    .getByRole('dialog', { name: '将原素材移入回收站？' })
    .getByRole('button', { name: '移入回收站', exact: true })
    .click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('tab', { name: '数据与导出', exact: true }).click()
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await artifacts().getByRole('tab', { name: '文稿', exact: true }).click()
  await expect(page.locator('.document-preview')).toContainText('先观察具体场景，再做出自己的判断。')
})

test('video routes stay independent and animation parameters become adoptable candidates', async () => {
  await artifacts().getByRole('tab', { name: '视频', exact: true }).click()
  await page.getByRole('button', { name: /Agent 代码创作.*把碎片时间/ }).click()
  await expect(page.getByText('当前已采用 v2 · 正在预览 v3', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '播放预览', exact: true }).click()
  await expect
    .poll(async () =>
      Number(await page.getByRole('slider', { name: '视频预览进度' }).getAttribute('aria-valuenow')),
    )
    .toBeGreaterThan(0)
  await page.getByRole('button', { name: '调整文案与颜色', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: '画面主标题' }).fill('每天一点，慢慢成形')
  await dialog.getByRole('button', { name: '保存为候选版本', exact: true }).click()
  await expect(page.getByText('当前已采用 v2 · 正在预览 v4', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '采用此版', exact: true }).click()
  await expect(page.getByText('当前已采用 v5 · 可继续创建候选', { exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: '动画预览版本' })).toHaveValue('5')
  await expect(page.getByRole('option', { name: '历史 / 候选 v4', exact: true })).toBeAttached()
  await page.getByRole('button', { name: '所有视频', exact: true }).click()
  await page.getByRole('button', { name: /素材分镜.*让创作回到日常/ }).click()
  await page.getByRole('textbox', { name: '口播文案' }).first().fill('只修改素材路线的这一段口播。')
  await page.getByRole('tab', { name: '配音与字幕', exact: true }).click()
  await expect(page.getByText('配音待更新', { exact: true })).toHaveCount(1)
  await page.getByRole('tab', { name: '成片预览', exact: true }).click()
  await page.getByRole('button', { name: '导出视频', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '演练一次失败与恢复', exact: true }).click()
  const result = page.getByRole('region', { name: '视频导出状态', exact: true })
  await expect(result.getByText('演示导出未完成', { exact: true })).toBeVisible()
  await expect(
    result.getByText('当前作品与已采用版本保留，可以返回继续修改。', { exact: true }),
  ).toBeVisible()
  await result.getByRole('button', { name: '返回作品预览', exact: true }).click()
  await page.getByRole('tab', { name: '配音与字幕', exact: true }).click()
  await expect(
    page.locator('.subtitle-narration').first().getByText('编辑口播', { exact: false }),
  ).toBeVisible()
  await page.locator('.subtitle-narration').first().locator('summary').click()
  await expect(page.getByRole('textbox', { name: '口播', exact: true }).first()).toHaveValue(
    '只修改素材路线的这一段口播。',
  )
  await page.getByRole('button', { name: /任务中心/ }).click()
  await expect(
    page.getByText('模拟失败：配乐资源不可用。作品与之前的输出快照均已保留。', { exact: true }),
  ).toBeVisible()
})

test('mobile layout stays single-column with usable navigation, capture and agent', async () => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await expect(page.getByRole('navigation', { name: '手机主要导航' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page
    .getByRole('navigation', { name: '手机主要导航' })
    .getByRole('button', { name: '收集', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '关闭弹窗', exact: true }).click()
  await page.getByRole('button', { name: '展开 Agent', exact: true }).click()
  await expect(page.getByRole('complementary', { name: '创作 Agent' })).toBeVisible()
  await page.getByRole('button', { name: '收起 Agent', exact: true }).click()
  await page.getByRole('button', { name: '展开内容库', exact: true }).click()
  await page.getByRole('complementary', { name: '内容导航' }).getByRole('button', { name: /热点/ }).click()
  await expect(page.getByRole('heading', { name: '从热点，找到你的表达。', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('real downloads contain the fixed draft, current subtitles and a restorable backup', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'studio-downloads-'))
  async function captureDownload(path: string) {
    await app.evaluate(({ session }, destination) => {
      const scope = globalThis as unknown as { studioDownload?: string }
      scope.studioDownload = 'waiting'
      session.defaultSession.once('will-download', (_event, item) => {
        item.setSavePath(destination)
        item.once('done', (_event, result) => {
          scope.studioDownload = result
        })
      })
    }, path)
  }
  const markdown = join(directory, 'draft.md')
  await captureDownload(markdown)
  await page.getByRole('button', { name: '更多工作区操作' }).click()
  await page.getByRole('menuitem', { name: '导出当前文稿', exact: true }).click()
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { studioDownload: string }).studioDownload))
    .toBe('completed')
  expect(readFileSync(markdown, 'utf8')).toContain('# 让灵感成为作品')
  const subtitles = join(directory, 'captions.srt')
  await artifacts().getByRole('tab', { name: '视频', exact: true }).click()
  await page.getByRole('button', { name: /素材分镜.*让创作回到日常/ }).click()
  await page.getByRole('tab', { name: '配音与字幕', exact: true }).click()
  await page
    .getByRole('textbox', { name: '字幕文字（可独立校对）', exact: true })
    .first()
    .fill('手动校对的字幕会进入导出文件')
  await captureDownload(subtitles)
  await page.getByRole('button', { name: '导出 SRT', exact: true }).click()
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { studioDownload: string }).studioDownload))
    .toBe('completed')
  expect(readFileSync(subtitles, 'utf8')).toContain('00:00:00,000 --> 00:00:06,000')
  expect(readFileSync(subtitles, 'utf8')).toContain('手动校对的字幕会进入导出文件')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('tab', { name: '数据与导出', exact: true }).click()
  const backup = join(directory, 'backup.json')
  await captureDownload(backup)
  await page.getByRole('button', { name: '导出全部备份', exact: true }).click()
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { studioDownload: string }).studioDownload))
    .toBe('completed')
  const data = JSON.parse(readFileSync(backup, 'utf8'))
  expect(data.schema).toBe(2)
  expect(data.projects).toHaveLength(3)
  expect(data.projects[0].drafts.master.body).toContain('先留住那些不起眼的念头')
  expect(data.discoveryConversations).toHaveLength(1)
})

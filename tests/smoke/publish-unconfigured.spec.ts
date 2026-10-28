import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 发布准备页「未配置路径」（spec P4 / UX-SPEC §14、§16）：
// - 公众号未配置：不出现「存入草稿箱」动作，就地配置入口与人工交付兜底如实展示（缺失项不静默当成功）；
// - 知乎、X 维持人工复制（P4 合法终态）：复制／下载／手动记录齐全，复制不改变发布状态；
// - 抖音无内容：如实「缺少内容」，不提供复制动作，其余平台照常交付（§14）；
// - 历史批次入口保留（发布记录绑定批次与内容快照）。
// 全程零网络：不配置任何凭证，不触碰小红书会话。
test('未配置公众号：草稿箱如实降级为人工交付，知乎与 X 维持人工复制', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'content-studio-publish-unconf-'))
  const environment: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  delete environment.ELECTRON_RUN_AS_NODE
  environment.STUDIO_SMOKE = '1'
  environment.STUDIO_USER_DATA = userData
  const executablePath = process.env.STUDIO_TEST_EXECUTABLE
  const application = await electron.launch({
    executablePath,
    args: executablePath ? [] : ['packages/desktop'],
    env: environment,
  })
  try {
    const page = await application.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.getByRole('button', { name: '发布准备', exact: true }).click()
    await page.getByRole('checkbox', { name: /公众号/ }).check()
    await page.getByRole('checkbox', { name: /知乎/ }).check()
    await page.getByRole('checkbox', { name: /^X/ }).check()
    await page.getByRole('checkbox', { name: /抖音/ }).check()
    // 抖音无内容：选择阶段如实提示未就绪，可继续单独交付已就绪平台（§14）
    await expect(page.getByText(/抖音尚未就绪/)).toBeVisible()
    await expect(page.getByText('已选 4 个平台 · 3 个已就绪')).toBeVisible()
    await page.getByRole('button', { name: '继续，预览所选平台', exact: true }).click()
    await expect(page.getByText('等待手动交付', { exact: true })).toBeVisible()

    // 公众号未配置：徽标如实「未配置」；只有就地配置入口与人工兜底，绝不出现存草稿动作
    const wechatSection = page.locator('[aria-label="公众号草稿箱"]')
    await expect(wechatSection.getByText('未配置', { exact: true })).toBeVisible()
    await expect(
      wechatSection.getByRole('button', { name: '配置公众号，启用草稿箱' }),
    ).toBeVisible()
    await expect(
      wechatSection.getByText('不配置也可以用复制富文本与下载文稿交付。'),
    ).toBeVisible()
    await expect(wechatSection.getByRole('button', { name: '存入草稿箱' })).toHaveCount(0)
    // 通用人工交付动作保留（富文本复制走本地渲染兜底）
    await expect(page.getByRole('button', { name: '复制富文本', exact: true })).toBeVisible()

    // 知乎：维持人工复制（无平台专属动作区），复制不改变发布状态（§14）
    await page.getByRole('button', { name: '知乎', exact: true }).click()
    await expect(page.locator('[aria-label="公众号草稿箱"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '复制正文', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '下载文稿', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '标记知乎已发布', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '复制正文', exact: true }).click()
    await expect(page.getByText('等待手动交付', { exact: true })).toBeVisible()

    // X：串文逐段复制路径保留
    await page.getByRole('button', { name: 'X', exact: true }).click()
    await expect(page.getByRole('button', { name: '复制本段', exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: '复制正文', exact: true })).toBeVisible()

    // 抖音无内容：如实「缺少内容」，不提供复制动作（缺失项不静默当成功）
    await page.getByRole('button', { name: '抖音', exact: true }).click()
    await expect(page.getByText('抖音还缺少内容')).toBeVisible()
    await expect(page.getByRole('button', { name: '复制正文', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '下载文稿', exact: true })).toHaveCount(0)
    // 批次交付清单只统计就绪平台，抖音被如实排除
    await expect(page.getByText(/实际包含：/)).toContainText('公众号、知乎、X')
    await expect(page.getByRole('button', { name: /导出已就绪 3 项清单/ })).toBeVisible()

    // 历史批次：发布记录入口与批次内容绑定
    await expect(page.getByRole('button', { name: /发布记录 1/ })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await application.close()
  }
})

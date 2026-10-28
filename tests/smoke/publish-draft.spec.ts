import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

type DraftArticle = Record<string, unknown>

// 公众号官方 API 本地 stub：stable_token / add_material / uploadimg / draft/add。
// 铁律断言：整条链路只允许出现这四个端点，绝不出现任何「群发/发布」端点。
test('公众号草稿箱全链路：就地配置 → 检测连接 → 存草稿任务 → stub 收到 draft/add', async () => {
  const requested: string[] = []
  const drafts: DraftArticle[] = []
  const server = createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0]!
    requested.push(url)
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk as Buffer))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      const body = Buffer.concat(chunks).toString('utf8')
      if (url === '/cgi-bin/stable_token') {
        res.end(JSON.stringify({ access_token: 'E2E-TOKEN', expires_in: 7200 }))
        return
      }
      if (url === '/cgi-bin/material/add_material') {
        res.end(JSON.stringify({ media_id: 'COVER-STUB', url: 'https://mmbiz.qpic.cn/cover.png' }))
        return
      }
      if (url === '/cgi-bin/media/uploadimg') {
        res.end(JSON.stringify({ url: 'https://mmbiz.qpic.cn/content.png' }))
        return
      }
      if (url === '/cgi-bin/draft/add') {
        drafts.push(...((JSON.parse(body).articles ?? []) as DraftArticle[]))
        res.end(JSON.stringify({ media_id: 'DRAFT-STUB-MEDIA' }))
        return
      }
      res.statusCode = 404
      res.end(JSON.stringify({ errcode: -1, errmsg: `unexpected endpoint ${url}` }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const userData = mkdtempSync(join(tmpdir(), 'content-studio-publish-'))
  const environment: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  delete environment.ELECTRON_RUN_AS_NODE
  environment.STUDIO_SMOKE = '1'
  environment.STUDIO_USER_DATA = userData
  environment.STUDIO_WECHAT_API_BASE = base
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
    await page.getByRole('button', { name: '继续，预览所选平台', exact: true }).click()
    await expect(page.getByText('等待手动交付', { exact: true })).toBeVisible()

    // 未配置：就地配置入口（不跳设置页）
    await page.getByRole('button', { name: /配置公众号/ }).click()
    await expect(
      page.getByText(/本机出口 IP 加入公众号后台的 IP 白名单/),
    ).toBeVisible()
    await page.getByLabel('公众号 AppID').fill('wx1234567890abcdef')
    await page.getByLabel('公众号 AppSecret').fill('stub-secret-0000')
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    await expect(page.getByText('已配置', { exact: true })).toBeVisible()

    // canInject 探测走真实 token 请求（stub）
    await page.getByRole('button', { name: '检测连接', exact: true }).click()
    await expect(page.getByText('连接成功，可以存入草稿箱。')).toBeVisible()

    // 存入草稿箱：任务系统驱动，完成后卡片如实展示（不改变发布状态）
    await page.getByRole('button', { name: '存入草稿箱', exact: true }).click()
    await expect(page.getByText('已存入草稿箱；正式发布请在公众号后台完成。')).toBeVisible({
      timeout: 20_000,
    })
    // 发布状态不被草稿动作改变（§14：复制/导出/存草稿不改发布状态）
    await expect(page.getByText('等待手动交付', { exact: true })).toBeVisible()

    // stub 侧：draft/add 收到完整文章字段；整条链路只命中四个允许端点
    // （canInject 探测一次 token；存草稿执行器用独立客户端再取一次 token）
    expect(requested).toEqual([
      '/cgi-bin/stable_token',
      '/cgi-bin/stable_token',
      '/cgi-bin/material/add_material',
      '/cgi-bin/draft/add',
    ])
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({
      thumb_media_id: 'COVER-STUB',
      need_open_comment: 0,
      only_fans_can_comment: 0,
    })
    expect(String((drafts[0] as { title: string }).title).trim().length).toBeGreaterThan(0)
    const content = String((drafts[0] as { content: string }).content)
    // 种子公众号稿为「##」子标题结构 → 转换后 h3；转义在前、不产脚本
    expect(content).toContain('<h3>')
    expect(content).toContain('</p>')
    expect(content).not.toContain('<script')
    expect(errors).toEqual([])
  } finally {
    await application.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

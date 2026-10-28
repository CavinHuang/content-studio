import { afterAll, beforeAll, expect, test } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  extractReadableBody,
  fetchSourceEntries,
  parseFeedXml,
  parseHotListJson,
} from '../../packages/desktop/src/main/discovery/feed'

const LONG_TEXT = '这是一段足够长的正文内容，用来通过正文提取的最小长度判定。'.repeat(12)

let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? ''
    if (url === '/feed.xml') {
      res.setHeader('content-type', 'application/rss+xml')
      res.end(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>示例订阅</title>
<item>
  <title><![CDATA[带跟踪参数的条目]]></title>
  <link>https://example.com/posts/dedupe?utm_source=feed</link>
  <pubDate>Sat, 25 Oct 2026 00:30:00 GMT</pubDate>
  <description><![CDATA[<p>订阅摘要：关于正文提取的说明。</p>]]></description>
</item>
<item>
  <title>没有链接的条目</title>
  <description>这一条缺少链接，应当被如实丢弃。</description>
</item>
<item>
  <title>Atom 风格之外的最简条目</title>
  <link>https://example.com/posts/minimal</link>
</item>
</channel></rss>`)
      return
    }
    if (url === '/atom.xml') {
      res.setHeader('content-type', 'application/atom+xml')
      res.end(`<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom 订阅</title>
<entry>
  <title>Atom 条目标题</title>
  <link rel="alternate" type="text/html" href="https://example.com/posts/atom-1"/>
  <link rel="self" href="https://example.com/feed"/>
  <published>2026-10-24T18:00:00Z</published>
  <content type="html">&lt;p&gt;Atom 正文摘要。&lt;/p&gt;</content>
</entry>
</feed>`)
      return
    }
    if (url === '/hot.json') {
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({
          code: 0,
          data: {
            list: [
              { title: '热榜条目一', url: `${base}/article/1` },
              { title: '没有链接的热榜条目', hot: 123 },
              { title: '热榜条目二', url: `${base}/article/2`, hot: 4567 },
            ],
          },
        }),
      )
      return
    }
    if (url === '/flat.json') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ items: [{ name: '扁平字段条目', link: 'https://example.com/hot/flat', score: 88 }] }))
      return
    }
    if (url === '/bad.json') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ code: 0, data: { message: '没有列表' } }))
      return
    }
    if (url === '/article/1') {
      res.end(`<html><head><title>完整正文页</title></head><body><article><h1>完整正文页</h1><p>${LONG_TEXT}</p></article></body></html>`)
      return
    }
    if (url === '/article/2') {
      res.end(
        `<html><head><meta property="og:description" content="og 摘要：这条热榜只有链接页的描述。"></head><body><div>登录后查看更多</div></body></html>`,
      )
      return
    }
    if (url === '/500') {
      res.statusCode = 500
      res.end('boom')
      return
    }
    res.statusCode = 404
    res.end('not found')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

test('RSS 2.0 解析：CDATA 与 pubDate；无链接条目如实丢弃；URL 规范化', () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
  <item><title>条目甲</title><link>https://Example.com/a/?utm_source=x</link><pubDate>Sat, 25 Oct 2026 00:30:00 GMT</pubDate><description><![CDATA[摘要甲]]></description></item>
  <item><title>条目乙无链接</title><description>应当丢弃</description></item>
  </channel></rss>`
  const entries = parseFeedXml(xml)
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({
    title: '条目甲',
    // 保留来源提供的原始 URL；规范化只用于去重键
    url: 'https://Example.com/a/?utm_source=x',
    body: '摘要甲',
    bodyState: 'summary',
  })
  expect(entries[0]!.published).toBe('10/25 08:30')
  expect(entries[0]!.publishedAt).toBe('2026-10-25T00:30:00.000Z')
})

test('Atom 解析：取 rel=alternate 链接；published 解析为展示时间', () => {
  const entries = parseFeedXml(
    `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>Atom 甲</title><link rel="self" href="https://example.com/feed"/><link rel="alternate" href="https://example.com/posts/atom-1"/><published>2026-10-24T18:00:00Z</published><content type="html">&lt;p&gt;Atom 正文。&lt;/p&gt;</content></entry>
    </feed>`,
  )
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ title: 'Atom 甲', url: 'https://example.com/posts/atom-1', body: 'Atom 正文。' })
  expect(entries[0]!.published).toBe('10/25 02:00')
})

test('无法识别的 XML 形状抛出可读错误', () => {
  expect(() => parseFeedXml('<html><body>not a feed</body></html>')).toThrow(/不支持的订阅格式/)
})

test('热榜 JSON：字段名逐源兜底、排名按来源保留、无链接条目丢弃、无法识别报错', () => {
  const entries = parseHotListJson(
    JSON.stringify({ data: { list: [{ title: '甲', url: 'https://e.com/1', hot: 99 }, { title: '无链接' }, { title: '乙', url: 'https://e.com/2' }] } }),
  )
  expect(entries).toHaveLength(2)
  expect(entries[0]).toMatchObject({ title: '甲', url: 'https://e.com/1', metric: '第 1 位 · 热度 99' })
  expect(entries[1]).toMatchObject({ title: '乙', metric: '第 2 位' })

  const flat = parseHotListJson(JSON.stringify({ items: [{ name: '扁平', link: 'https://e.com/3', score: 88 }] }))
  expect(flat[0]).toMatchObject({ title: '扁平', url: 'https://e.com/3', metric: '第 1 位 · 热度 88' })

  expect(() => parseHotListJson(JSON.stringify({ data: { message: 'nope' } }))).toThrow(/无法识别/)
})

test('正文提取：可读正文 → full；og 摘要 → summary；两者皆无 → link-only', () => {
  const full = extractReadableBody(`<html><body><article><h1>标题</h1><p>${LONG_TEXT}</p></article></body></html>`)
  expect(full.bodyState).toBe('full')
  expect(full.body).toContain('正文提取的最小长度判定')
  const summary = extractReadableBody(
    '<html><head><meta property="og:description" content="og 摘要内容"></head><body><p>太短</p></body></html>',
  )
  expect(summary).toMatchObject({ bodyState: 'summary', body: 'og 摘要内容' })
  const linkOnly = extractReadableBody('<html><body><a href="#">登录</a></body></html>')
  expect(linkOnly).toMatchObject({ bodyState: 'link-only', body: '' })
})

test('fetchSourceEntries：RSS 源经本地 http 抓取并解析', async () => {
  const entries = await fetchSourceEntries({ name: '本地订阅', url: `${base}/feed.xml` })
  expect(entries).toHaveLength(2)
  // 保留来源提供的原始 URL（去重只发生在规范化键上）
  const dedupe = entries.find((e) => e.url === 'https://example.com/posts/dedupe?utm_source=feed')!
  expect(dedupe).toMatchObject({ title: '带跟踪参数的条目', body: '订阅摘要：关于正文提取的说明。' })
  expect(entries.some((e) => e.title === '没有链接的条目')).toBe(false)
})

test('fetchSourceEntries：热榜 JSON 自动嗅探并逐条提取正文（可读 → full，og → summary）', async () => {
  const entries = await fetchSourceEntries({ name: '本地热榜', url: `${base}/hot.json` })
  expect(entries).toHaveLength(2)
  expect(entries[0]).toMatchObject({ title: '热榜条目一', bodyState: 'full' })
  expect(entries[0]!.body).toContain('足够长的正文内容')
  expect(entries[1]).toMatchObject({ title: '热榜条目二', bodyState: 'summary', body: 'og 摘要：这条热榜只有链接页的描述。', metric: '第 2 位 · 热度 4567' })
})

test('fetchSourceEntries：非 2xx 与未知格式如实报错', async () => {
  await expect(fetchSourceEntries({ name: '坏状态', url: `${base}/500` })).rejects.toThrow(/500/)
  await expect(fetchSourceEntries({ name: '坏 JSON', url: `${base}/bad.json` })).rejects.toThrow(/无法识别/)
  await expect(fetchSourceEntries({ name: '空地址', url: '' })).rejects.toThrow(/地址/)
})

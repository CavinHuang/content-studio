import { XMLParser } from 'fast-xml-parser'
import { parseHTML } from 'linkedom'
import { Readability } from '@mozilla/readability'
import { normalizeUrl } from './url-key'

export type FeedBodyState = 'full' | 'summary' | 'link-only'

/** 抓取层条目：真实来源不携带 group（聚合层只按规范化 URL 去重）。 */
export type FeedEntry = {
  title: string
  url: string
  body: string
  bodyState: FeedBodyState
  published: string
  publishedAt: string
  metric?: string
}

/** 正文展示时间统一为东八区（产品语言 zh-CN），保证跨机器确定性。 */
export function formatStamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function asText(value: unknown): string {
  // isArray 配置下 link 等字段恒为数组（RSS item.link 为字符串元素）
  if (Array.isArray(value)) return value.length ? asText(value[0]) : ''
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object') {
    const holder = value as { '#text'?: unknown; '@_href'?: unknown }
    if (typeof holder['#text'] === 'string') return holder['#text'].trim()
    if (typeof holder['@_href'] === 'string') return holder['@_href'].trim()
  }
  return ''
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function stampOf(value: unknown): { published: string; publishedAt: string } {
  const raw = asText(value)
  if (!raw) return { published: '', publishedAt: '' }
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return { published: '', publishedAt: '' } // 无法解析的时间不伪造
  const iso = date.toISOString()
  return { published: formatStamp(iso), publishedAt: iso }
}

function entryOf(title: string, url: string): FeedEntry | null {
  const cleanTitle = title.trim()
  if (!cleanTitle) return null
  // 无链接条目如实丢弃（§20.6：缺少可识别原始 URL 的条目不能算作证据）
  const normalized = normalizeUrl(url)
  if (!normalized) return null
  return {
    title: cleanTitle.slice(0, 300),
    url: url.trim(),
    body: '',
    bodyState: 'link-only',
    published: '',
    publishedAt: '',
  }
}

/** RSS 2.0 / Atom 解析（fast-xml-parser，纯 JS）。不支持的形状抛可读错误。 */
export function parseFeedXml(xml: string): FeedEntry[] {
  let doc: Record<string, unknown>
  try {
    doc = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      isArray: (name) => name === 'item' || name === 'entry' || name === 'link',
    }).parse(xml) as Record<string, unknown>
  } catch {
    throw new Error('订阅内容不是有效的 XML。')
  }
  const rss = doc['rss'] as { channel?: { item?: unknown[] } } | undefined
  const items = (rss?.channel?.item ?? []) as unknown[]
  if (items.length) {
    const entries: FeedEntry[] = []
    for (const raw of items) {
      const item = raw as Record<string, unknown>
      const entry = entryOf(asText(item['title']), asText(item['link']) || asText(item['guid']))
      if (!entry) continue
      const body = stripHtml(asText(item['content:encoded']) || asText(item['description']) || asText(item['summary']))
      if (body) {
        entry.body = body.slice(0, 1200)
        entry.bodyState = 'summary'
      }
      Object.assign(entry, stampOf(item['pubDate'] || item['published'] || item['updated']))
      entries.push(entry)
    }
    return entries
  }
  const feed = doc['feed'] as { entry?: unknown[] } | undefined
  const atomEntries = (feed?.entry ?? []) as unknown[]
  if (atomEntries.length) {
    const entries: FeedEntry[] = []
    for (const raw of atomEntries) {
      const item = raw as Record<string, unknown>
      const links = (item['link'] ?? []) as Array<{ '@_rel'?: string; '@_href'?: string }>
      // rel=alternate（或未标注 rel）是原文链接；rel=self 是订阅自身，跳过
      const href =
        links.find((link) => !link['@_rel'] || link['@_rel'] === 'alternate')?.['@_href'] ??
        links.map((link) => link['@_href'] ?? '').find(Boolean) ??
        ''
      const entry = entryOf(asText(item['title']), href)
      if (!entry) continue
      const body = stripHtml(asText(item['content']) || asText(item['summary']))
      if (body) {
        entry.body = body.slice(0, 1200)
        entry.bodyState = 'summary'
      }
      Object.assign(entry, stampOf(item['published'] || item['updated']))
      entries.push(entry)
    }
    return entries
  }
  throw new Error('不支持的订阅格式：未找到 RSS item 或 Atom entry。')
}

/** 热榜 JSON 候选数组路径：逐源兜底；找不到对象数组即报错，绝不伪造条目。 */
const LIST_PATHS = [
  ['data', 'list'],
  ['data', 'items'],
  ['data', 'data'],
  ['data', 'stories'],
  ['data'],
  ['items'],
  ['list'],
  ['result', 'list'],
  ['result', 'items'],
  ['result'],
]

function findItemList(doc: unknown): Record<string, unknown>[] | null {
  for (const path of LIST_PATHS) {
    let node: unknown = doc
    for (const key of path) {
      if (!node || typeof node !== 'object') {
        node = undefined
        break
      }
      node = (node as Record<string, unknown>)[key]
    }
    if (Array.isArray(node) && node.length && node.every((item) => item && typeof item === 'object')) {
      return node as Record<string, unknown>[]
    }
  }
  return null
}

const TITLE_FIELDS = ['title', 'name', 'word', 'query', 'keyword']
const URL_FIELDS = ['url', 'link', 'originalUrl', 'uri', 'schema']
const HEAT_FIELDS = ['hot', 'heat', 'score', 'popularity', 'hot_value']

/** 热榜 JSON 适配器：字段名不一，逐源兜底；排名按来源内顺序保留，热度原样展示。 */
export function parseHotListJson(text: string): FeedEntry[] {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    throw new Error('热榜内容不是有效的 JSON。')
  }
  const list = findItemList(doc)
  if (!list) throw new Error('热榜数据格式无法识别：没有找到条目列表。')
  const entries: FeedEntry[] = []
  let rank = 0
  for (const item of list) {
    const url = URL_FIELDS.map((field) => asText(item[field])).find((value) => value.length > 0) ?? ''
    const title = TITLE_FIELDS.map((field) => asText(item[field])).find((value) => value.length > 0) ?? ''
    const entry = entryOf(title, url)
    if (!entry) continue
    rank += 1
    const heat = HEAT_FIELDS.map((field) => {
      const value = item[field]
      return typeof value === 'number' && Number.isFinite(value) ? value : Number(asText(value)) || 0
    }).find((value) => value > 0)
    entry.metric = heat ? `第 ${rank} 位 · 热度 ${heat}` : `第 ${rank} 位`
    Object.assign(
      entry,
      stampOf(item['published_at'] ?? item['publish_time'] ?? item['create_time'] ?? item['created_at']),
    )
    entries.push(entry)
  }
  return entries
}

/** 正文提取：readability + linkedom；失败降级 og/meta 摘要；再失败如实标注仅链接。 */
export function extractReadableBody(html: string): { body: string; bodyState: FeedBodyState } {
  try {
    const document = parseHTML(html).document
    const article = new Readability(document).parse()
    const text = (article?.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text.length >= 200) return { body: text.slice(0, 2000), bodyState: 'full' }
  } catch {
    // 降级：继续尝试 og/meta 摘要
  }
  const meta = /<meta[^>]+(?:property|name)\s*=\s*["'](?:og:description|description)["'][^>]*content\s*=\s*["']([^"']{4,600})["']/i.exec(
    html,
  )
  const summary = meta ? stripHtml(meta[1]!) : ''
  if (summary) return { body: summary.slice(0, 600), bodyState: 'summary' }
  return { body: '', bodyState: 'link-only' }
}

const FETCH_TIMEOUT_MS = 15_000
const MAX_BYTES = 3 * 1024 * 1024
/** 热榜逐条补抓正文的条数上限：控制单次刷新的请求总量。 */
const EXTRACT_LIMIT = 10

async function fetchText(
  url: string,
  opts: { fetchImpl: typeof fetch; signal?: AbortSignal; timeoutMs: number },
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
  const onOuterAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true })
  try {
    const response = await opts.fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 ContentStudio/0.1 (creator hotspot fetcher)', accept: '*/*' },
    })
    if (!response.ok) throw new Error(`来源返回 ${response.status}。`)
    const text = (await response.text()).slice(0, MAX_BYTES)
    return text
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error('请求超时或已中止。')
    throw err
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onOuterAbort)
  }
}

/**
 * 抓取单个来源：按内容嗅探（JSON 热榜 / XML 订阅），全部网络请求都在主进程发出。
 * 热榜条目逐条补抓正文（可读正文优先，og 摘要次之，均失败标注仅链接）。
 */
export async function fetchSourceEntries(
  source: { name: string; url: string },
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<FeedEntry[]> {
  const url = source.url.trim()
  if (!/^https?:\/\/.+/i.test(url)) throw new Error('来源地址无效：需要 http 或 https 开头。')
  const fetchImpl = opts.fetchImpl ?? fetch
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS
  const text = (await fetchText(url, { fetchImpl, signal: opts.signal, timeoutMs })).trim()
  const isJson = text.startsWith('{') || text.startsWith('[')
  const entries = isJson
    ? parseHotListJson(text)
    : text.startsWith('<')
      ? parseFeedXml(text)
      : (() => {
          throw new Error('无法识别的响应格式：既不是 JSON 也不是 XML。')
        })()
  // 正文补抓只针对热榜条目（榜单本身不带正文）；RSS/Atom 以订阅自带的 content/description 为准，
  // 不逐篇抓原文页，避免一次刷新放大成整站抓取。
  if (!isJson) return entries
  let extracted = 0
  for (const entry of entries) {
    if (extracted >= EXTRACT_LIMIT) break
    if (entry.bodyState !== 'link-only') continue
    extracted += 1
    try {
      const html = await fetchText(entry.url, { fetchImpl, signal: opts.signal, timeoutMs })
      Object.assign(entry, extractReadableBody(html))
    } catch {
      // 单条正文补抓失败如实保留仅链接状态
    }
  }
  return entries
}

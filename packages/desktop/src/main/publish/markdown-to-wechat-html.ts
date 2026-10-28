/**
 * 极小 Markdown → 公众号正文 HTML 转换器（服务 draft/add API 链）。
 * 历史资产移植：docs/superpowers/ref/code/19f5778-markdown-to-wechat-html.ts（自有 MIT 代码），
 * 适配扩展：列表与连续引用合并、asset:/data: 正文图解析、外链图如实计数。
 * 铁律：转义在前、不产 JS（draft/add 硬约束）；与排版预览链（好看）是两条互补路径，勿混用。
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export function safeJoin(base: string, rel: string): string {
  const p = path.resolve(base, rel)
  if (p !== path.resolve(base) && !p.startsWith(path.resolve(base) + path.sep)) {
    const err = new Error(`路径越出内容目录：${rel}`) as Error & { code: string }
    err.code = 'ASSET_OUT_OF_FOLDER'
    throw err
  }
  return p
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * 行内元素替换：输入必须是**已转义**文本——图片/链接的 src/alt/href 已随之转义，
 * 这里不再二次转义（URL 中的 & 保持单次 &amp;，浏览器解码后即原链接）。
 */
function inline(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => `<img src="${src}" alt="${alt}" />`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, href: string) => `<a href="${href}">${text}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

/** Markdown → 公众号正文 HTML：标题/段落/加粗/斜体/链接/图片/引用/列表/分隔线。 */
export function markdownToWechatHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let para: string[] = []
  let quote: string[] = []
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(esc(para.join(' ')))}</p>`)
    para = []
  }
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${inline(esc(quote.join(' ')))}</blockquote>`)
    quote = []
  }
  const flushList = () => {
    if (list) {
      out.push(`<${list.kind}>\n${list.items.map((item) => `<li>${item}</li>`).join('\n')}\n</${list.kind}>`)
      list = null
    }
  }
  const flushAll = () => {
    flushPara()
    flushQuote()
    flushList()
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flushAll()
      continue
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      flushAll()
      const level = heading[1]!.length + 1
      out.push(`<h${level}>${inline(esc(heading[2]!))}</h${level}>`)
      continue
    }
    if (/^(---|\*\*\*)\s*$/.test(line)) {
      flushAll()
      out.push('<hr />')
      continue
    }
    if (line.startsWith('> ')) {
      flushPara()
      flushList()
      quote.push(line.slice(2).trim())
      continue
    }
    const bullet = line.match(/^[-*]\s+(.*)$/)
    if (bullet) {
      flushPara()
      flushQuote()
      if (list?.kind !== 'ul') {
        flushList()
        list = { kind: 'ul', items: [] }
      }
      list.items.push(inline(esc(bullet[1]!)))
      continue
    }
    const ordered = line.match(/^\d+\.\s+(.*)$/)
    if (ordered) {
      flushPara()
      flushQuote()
      if (list?.kind !== 'ol') {
        flushList()
        list = { kind: 'ol', items: [] }
      }
      list.items.push(inline(esc(ordered[1]!)))
      continue
    }
    flushQuote()
    flushList()
    para.push(line.trim())
  }
  flushAll()
  return out.join('\n')
}

const EXT_OF_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/** data: URL（仅图片）→ 字节 + 扩展名；非法或非图片返回 null。 */
export function parseDataUrl(src: string): { bytes: Uint8Array; mimeType: string; ext: string } | null {
  const match = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(src)
  if (!match) return null
  const mimeType = match[1]!
  const ext = EXT_OF_MIME[mimeType]
  if (!ext) return null
  const bytes = new Uint8Array(Buffer.from(match[2]!, 'base64'))
  if (!bytes.length) return null
  return { bytes, mimeType, ext }
}

const MIME_OF_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

export type ContentImageSource = { bytes: Uint8Array; filename: string; mimeType: string }
export type ContentImageUpload = (source: ContentImageSource) => Promise<string>

export type ReplaceImagesOptions = {
  /** 上传回调（主进程接 uploadimg；测试注入桩）。 */
  upload: ContentImageUpload
  /** 本地相对路径图片的基准目录（历史 19f5778 行为：safeJoin 防越界）。 */
  baseDir?: string
  /** asset:<素材 id> → data URL 快照（随发布批次冻结，主进程不回读渲染端状态）。 */
  assets?: Record<string, string>
}

export type ReplaceImagesResult = { html: string; uploaded: number; external: number; unresolved: string[] }

/**
 * 正文图片 → uploadimg URL（draft/add 硬约束：图片必须来自该接口，外链会被屏蔽）。
 * http(s) 外链保留原样并计数；无法解析的引用保留原样并记入 unresolved，绝不静默丢图。
 */
export async function replaceUploadImages(
  html: string,
  opts: ReplaceImagesOptions,
): Promise<ReplaceImagesResult> {
  const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]!)
  let out = html
  let uploaded = 0
  let external = 0
  const unresolved: string[] = []
  for (const src of [...new Set(srcs)]) {
    if (/^(https?:)?\/\//.test(src)) {
      external += 1
      continue
    }
    let source: ContentImageSource | null = null
    if (src.startsWith('data:')) {
      const parsed = parseDataUrl(src)
      if (!parsed) {
        unresolved.push(src)
        continue
      }
      source = { ...parsed, filename: `image-${hashOf(parsed.bytes)}.${parsed.ext}` }
    } else if (src.startsWith('asset:')) {
      const dataUrl = opts.assets?.[src.slice('asset:'.length)]
      const parsed = dataUrl ? parseDataUrl(dataUrl) : null
      if (!parsed) {
        unresolved.push(src)
        continue
      }
      source = { ...parsed, filename: `image-${hashOf(parsed.bytes)}.${parsed.ext}` }
    } else {
      if (!opts.baseDir) {
        unresolved.push(src)
        continue
      }
      const file = safeJoin(opts.baseDir, src)
      const ext = path.extname(file).toLowerCase()
      const mimeType = MIME_OF_EXT[ext]
      if (!mimeType) {
        unresolved.push(src)
        continue
      }
      source = { bytes: new Uint8Array(await readFile(file)), filename: path.basename(file), mimeType }
    }
    const url = await opts.upload(source)
    if (!url) {
      unresolved.push(src)
      continue
    }
    uploaded += 1
    out = out.split(`src="${src}"`).join(`src="${url}"`)
  }
  return { html: out, uploaded, external, unresolved }
}

function hashOf(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex').slice(0, 8)
}

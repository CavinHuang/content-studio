import { createHash } from 'node:crypto'

/** 已知跟踪参数：去重时剔除，其余查询参数保留（不做过度合并）。 */
const TRACKING_PARAMS = /^(?:utm_\w+|spm|from|ref|ref_src|share_source|share_medium|tt_from|is_from_webapp|vd_source)$/i

/**
 * 原始 URL 规范化（§20.6 聚合去重键的基础）：
 * 小写主机、去 www./默认端口、去 hash、去尾斜杠、剔除跟踪参数。
 * 保守合并：http 与 https 视为不同键，避免误合；无法解析返回 null。
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!/^https?:\/\//i.test(trimmed)) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  let path = url.pathname
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  if (path === '/') path = ''
  const params = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAMS.test(key))
  const query = params.length
    ? `?${params.map(([key, value]) => `${key}=${value}`).join('&')}`
    : ''
  return `${url.protocol.toLowerCase()}//${host}${path}${query}`
}

/** 规范化 URL 的稳定短键（文章行主键/合并键）。 */
export function urlKeyOf(raw: string): string | null {
  const normalized = normalizeUrl(raw)
  if (!normalized) return null
  return `a_${createHash('sha1').update(normalized).digest('hex').slice(0, 16)}`
}

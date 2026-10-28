/**
 * 小红书平台会话的纯策略层（不依赖 Electron，node 单测直测）：
 * 编辑器地址白名单校验、显式覆盖解析与 UA 常规化。
 * 移植自 ref/cc0f351-platform-session.ts（本仓库自有历史资产），按当前架构拆为独立纯模块。
 */

export const REDBOOK_DEFAULT_EDITOR_URL = 'https://creator.xiaohongshu.com/publish/publish?source=official'
export const REDBOOK_DEFAULT_ALLOWED_HOSTS = ['creator.xiaohongshu.com'] as const

export type RedbookUrlCheck =
  | { ok: true; url: string; host: string }
  | { ok: false; code: 'EDITOR_URL_INVALID' | 'EDITOR_URL_BLOCKED'; message: string }

/** 编辑器地址校验：不合法/不在白名单即拒绝（绝不静默放行任意域名）。 */
export function checkEditorUrl(url: string, allowedHosts: readonly string[]): RedbookUrlCheck {
  let host: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol')
    host = parsed.hostname
  } catch {
    return { ok: false, code: 'EDITOR_URL_INVALID', message: `小红书编辑器地址不合法：${url}` }
  }
  if (!allowedHosts.includes(host)) {
    return {
      ok: false,
      code: 'EDITOR_URL_BLOCKED',
      message: `小红书编辑器地址不在平台白名单内（${allowedHosts.join('、')}）。`,
    }
  }
  return { ok: true, url, host }
}

/**
 * 解析编辑器配置：缺省官方地址；显式覆盖（env STUDIO_REDBOOK_EDITOR_URL，e2e/本地联调用）
 * 时把覆盖地址的 hostname 追加进白名单——覆盖必须是显式动作，不追加任意通配。
 */
export function resolveRedbookEditorConfig(overrideUrl?: string): {
  editorUrl: string
  allowedHosts: string[]
} {
  if (!overrideUrl) {
    return { editorUrl: REDBOOK_DEFAULT_EDITOR_URL, allowedHosts: [...REDBOOK_DEFAULT_ALLOWED_HOSTS] }
  }
  let host: string
  try {
    const parsed = new URL(overrideUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol')
    host = parsed.hostname
  } catch {
    // 覆盖地址不合法：回退官方地址（校验错误在打开时如实暴露，而不是带病放行）。
    return { editorUrl: REDBOOK_DEFAULT_EDITOR_URL, allowedHosts: [...REDBOOK_DEFAULT_ALLOWED_HOSTS] }
  }
  return { editorUrl: overrideUrl, allowedHosts: [...REDBOOK_DEFAULT_ALLOWED_HOSTS, host] }
}

/** UA 常规化（窗口特征与常规浏览器一致）：剥离 Electron 与应用名 token。 */
export function normalizeUserAgent(ua: string, appName: string): string {
  const escaped = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return ua
    .replace(/\s*Electron\/[\d.]+/i, '')
    .replace(new RegExp(`\\s*${escaped}/[\\d.]+`), '')
    .trim()
}

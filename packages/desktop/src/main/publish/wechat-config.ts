/**
 * 公众号凭证存取：照 ai_config 模式（model-config.ts），secret 经注入式 Crypto
 * （生产 safeStorage / 不可用时明文降级 plain=1）加密存 SQLite wechat_config 表（v5）。
 * 历史参考：docs/superpowers/ref/code/19f5778-wechat-credentials.ts（自有 MIT 代码）。
 */
import type { DatabaseSync } from 'node:sqlite'
import type { WechatConfigInput, WechatConfigView } from '../../shared/desktop'
import { KEEP_WECHAT_SECRET } from '../../shared/desktop'
import type { Crypto } from '../ai/model-config'

type Row = { appId: string; secretEnc: Buffer | null; plain: number }

function invalid(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string }
  err.code = 'WECHAT_CONFIG_INVALID'
  return err
}

function rowOf(db: DatabaseSync): Row | null {
  return (db.prepare('SELECT appId, secretEnc, plain FROM wechat_config WHERE id = 1').get() as Row | undefined) ?? null
}

export type WechatCredentials = { appId: string; secret: string }

/** 主进程内部视图：明文 secret 只在主进程内流转，绝不进渲染端。 */
export function getWechatConfig(db: DatabaseSync, crypto: Crypto): WechatCredentials | null {
  const row = rowOf(db)
  if (!row || !row.appId.trim() || !row.secretEnc || !row.secretEnc.length) return null
  try {
    const secret = crypto.decrypt(row.secretEnc, row.plain === 1)
    if (!secret) return null
    return { appId: row.appId.trim(), secret }
  } catch {
    // 解密失败（换机/系统凭据变化）视同未配置，引导重填。
    return null
  }
}

export function setWechatConfig(db: DatabaseSync, crypto: Crypto, input: WechatConfigInput): void {
  const appId = String(input.appId ?? '').trim()
  if (!appId) throw invalid('AppID 不能为空。')
  // 渲染端回显不出密钥：未改 secret 就保存时传 KEEP_WECHAT_SECRET，沿用旧值。
  const secret =
    input.secret === KEEP_WECHAT_SECRET
      ? getWechatConfig(db, crypto)?.secret ?? ''
      : String(input.secret ?? '')
  if (!secret) throw invalid('AppSecret 不能为空。')
  const enc = crypto.encrypt(secret)
  db.prepare(
    'INSERT INTO wechat_config (id, appId, secretEnc, plain, updated) VALUES (1, ?, ?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET appId = excluded.appId, secretEnc = excluded.secretEnc, ' +
      'plain = excluded.plain, updated = excluded.updated',
  ).run(appId, enc.data, enc.plain ? 1 : 0, new Date().toISOString())
}

export function clearWechatConfig(db: DatabaseSync): void {
  db.prepare('DELETE FROM wechat_config WHERE id = 1').run()
}

/** 渲染端可见的脱敏视图：secret 全程不出主进程，只出尾四位。 */
export function wechatConfigView(db: DatabaseSync, crypto: Crypto): WechatConfigView | null {
  const row = rowOf(db)
  if (!row) return null
  let tail = ''
  if (row.secretEnc?.length) {
    try {
      tail = crypto.decrypt(row.secretEnc, row.plain === 1).slice(-4)
    } catch {
      tail = ''
    }
  }
  const view: WechatConfigView = {
    appId: row.appId,
    hasSecret: Boolean(row.secretEnc?.length),
    secretTail: tail,
    ...(row.plain === 1 ? { plain: true } : {}),
  }
  return view
}

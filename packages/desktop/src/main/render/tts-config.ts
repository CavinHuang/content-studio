/**
 * 语音服务配置（P5）：照 ai/model-config 模式——SQLite 单行 + safeStorage 加密 key。
 * 与模型服务可同 provider 也可独立（baseUrl/key/模型/音色四项独立配置）。
 */
import type { DatabaseSync } from 'node:sqlite'
import type { TtsConfigInput, TtsConfigView } from '../../shared/desktop'
import { KEEP_API_KEY } from '../../shared/desktop'
import type { Crypto } from '../ai/model-config'

export type TtsConfig = { baseUrl: string; apiKey: string; modelId: string; voice: string }

type Row = { baseUrl: string; modelId: string; voice: string; apiKeyEnc: Buffer | null; plain: number }

function invalid(message: string): Error {
  return new Error(message)
}

export function validateTtsConfig(input: TtsConfigInput): TtsConfig {
  const baseUrl = String(input.baseUrl ?? '').trim()
  const apiKey = String(input.apiKey ?? '')
  const modelId = String(input.modelId ?? '').trim()
  const voice = String(input.voice ?? '').trim()
  if (!/^https?:\/\/.+/i.test(baseUrl)) throw invalid('API 地址必须以 http:// 或 https:// 开头。')
  if (!apiKey) throw invalid('API Key 不能为空；本地无鉴权端点可填任意占位值。')
  if (!modelId) throw invalid('模型 ID 不能为空。')
  if (!voice) throw invalid('音色不能为空，请填写服务方提供的音色名。')
  return { baseUrl, apiKey, modelId, voice }
}

function rowOf(db: DatabaseSync): Row | null {
  return (
    (db.prepare('SELECT baseUrl, modelId, voice, apiKeyEnc, plain FROM tts_config WHERE id = 1').get() as
      | Row
      | undefined) ?? null
  )
}

export function getTtsConfig(db: DatabaseSync, crypto: Crypto): TtsConfig | null {
  const row = rowOf(db)
  if (!row) return null
  let apiKey = ''
  if (row.apiKeyEnc && row.apiKeyEnc.length) apiKey = crypto.decrypt(row.apiKeyEnc, row.plain === 1)
  if (!apiKey) return null
  return { baseUrl: row.baseUrl, apiKey, modelId: row.modelId, voice: row.voice }
}
export function setTtsConfig(db: DatabaseSync, crypto: Crypto, input: TtsConfigInput): TtsConfig {
  // 渲染端回显不出明文 key：未改 key 就保存时传 KEEP_API_KEY，沿用旧 key。
  const apiKey = input.apiKey === KEEP_API_KEY ? getTtsConfig(db, crypto)?.apiKey ?? '' : input.apiKey
  const config = validateTtsConfig({ ...input, apiKey })
  const enc = crypto.encrypt(config.apiKey)
  const at = new Date().toISOString()
  db.prepare(
    'INSERT INTO tts_config (id, baseUrl, modelId, voice, apiKeyEnc, plain, updated) ' +
      "VALUES (1, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET baseUrl = excluded.baseUrl, " +
      'modelId = excluded.modelId, voice = excluded.voice, apiKeyEnc = excluded.apiKeyEnc, ' +
      'plain = excluded.plain, updated = excluded.updated',
  ).run(config.baseUrl, config.modelId, config.voice, enc.data, enc.plain ? 1 : 0, at)
  return config
}

export function clearTtsConfig(db: DatabaseSync): void {
  db.prepare('DELETE FROM tts_config WHERE id = 1').run()
}

/** 渲染端可见的脱敏视图：apiKey 全程不出主进程；plain 表示 safeStorage 不可用时的明文降级。 */
export function ttsConfigView(db: DatabaseSync, crypto: Crypto): TtsConfigView | null {
  const config = getTtsConfig(db, crypto)
  const row = rowOf(db)
  if (!config || !row) return null
  return {
    baseUrl: config.baseUrl,
    modelId: config.modelId,
    voice: config.voice,
    hasKey: true,
    apiKeyTail: config.apiKey.slice(-4),
    ...(row.plain === 1 ? { plain: true } : {}),
  }
}

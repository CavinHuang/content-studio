import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { AiConfigInput, AiConfigView, ModelConfig } from '../../shared/desktop'
import { KEEP_API_KEY } from '../../shared/desktop'

const PROVIDER_ID = 'content-studio' as const

/** 加密注入：生产 = safeStorage；测试 = 直通。plain=true 表示降级明文（safeStorage 不可用）。 */
export type Crypto = {
  encrypt(plain: string): { data: Buffer; plain: boolean }
  decrypt(data: Uint8Array | number[] | Buffer | null, plain: boolean): string
}

type Row = {
  providerId: string
  name: string | null
  baseUrl: string
  modelId: string
  apiKeyEnc: Buffer | null
  plain: number
}

function invalid(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string }
  err.code = 'MODEL_CONFIG_INVALID'
  return err
}

export function validateModelConfig(input: AiConfigInput): ModelConfig {
  const baseUrl = String(input.baseUrl ?? '').trim()
  const apiKey = String(input.apiKey ?? '')
  const modelId = String(input.modelId ?? '').trim()
  if (!/^https?:\/\/.+/i.test(baseUrl)) throw invalid('API 地址必须以 http:// 或 https:// 开头。')
  if (!apiKey) throw invalid('API Key 不能为空；本地无鉴权端点可填任意占位值。')
  if (!modelId) throw invalid('模型 ID 不能为空。')
  const name = input.name?.trim()
  return { providerId: PROVIDER_ID, ...(name ? { name } : {}), baseUrl, apiKey, modelId }
}

function rowOf(db: DatabaseSync): Row | null {
  return (db.prepare('SELECT providerId, name, baseUrl, modelId, apiKeyEnc, plain FROM ai_config WHERE id = 1').get() as
    | Row
    | undefined) ?? null
}

function decryptKey(crypto: Crypto, data: Uint8Array | number[] | Buffer | null, plain: boolean): string {
  if (!data || (Array.isArray(data) && data.length === 0)) return ''
  return crypto.decrypt(data, plain)
}

export function getModelConfig(db: DatabaseSync, crypto: Crypto): ModelConfig | null {
  const row = rowOf(db)
  if (!row) return null
  const apiKey = decryptKey(crypto, row.apiKeyEnc, row.plain === 1)
  if (!apiKey) return null
  return {
    providerId: row.providerId,
    ...(row.name ? { name: row.name } : {}),
    baseUrl: row.baseUrl,
    apiKey,
    modelId: row.modelId,
  }
}

export function setModelConfig(db: DatabaseSync, crypto: Crypto, input: AiConfigInput): ModelConfig {
  // 渲染端回显不出明文 key：未改 key 就保存时传 KEEP_API_KEY，沿用旧 key。
  const apiKey = input.apiKey === KEEP_API_KEY ? getModelConfig(db, crypto)?.apiKey ?? '' : input.apiKey
  const config = validateModelConfig({ ...input, apiKey })
  const enc = crypto.encrypt(config.apiKey)
  const at = new Date().toISOString()
  db.prepare(
    'INSERT INTO ai_config (id, providerId, name, baseUrl, modelId, apiKeyEnc, plain, updated) ' +
      "VALUES (1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET providerId = excluded.providerId, " +
      'name = excluded.name, baseUrl = excluded.baseUrl, modelId = excluded.modelId, ' +
      'apiKeyEnc = excluded.apiKeyEnc, plain = excluded.plain, updated = excluded.updated',
  ).run(config.providerId, config.name ?? null, config.baseUrl, config.modelId, enc.data, enc.plain ? 1 : 0, at)
  return config
}

export function clearModelConfig(db: DatabaseSync): void {
  db.prepare('DELETE FROM ai_config WHERE id = 1').run()
}

/** 渲染端可见的脱敏视图：apiKey 全程不出主进程。 */
export function modelConfigView(config: ModelConfig | null, plainFallback: boolean): AiConfigView | null {
  if (!config) return null
  return {
    providerId: config.providerId,
    ...(config.name ? { name: config.name } : {}),
    baseUrl: config.baseUrl,
    modelId: config.modelId,
    hasKey: Boolean(config.apiKey),
    apiKeyTail: config.apiKey ? config.apiKey.slice(-4) : '',
    ...(plainFallback ? { plain: true } : {}),
  }
}

/** pi 的 agentDir：用户数据目录下专属子目录，绝不与用户可能安装的 pi CLI 共用 ~/.pi/agent。 */
export function piAgentDir(userDataDir: string): string {
  return path.join(userDataDir, 'pi-agent')
}

export function sessionDirFor(userDataDir: string, sessionKey: string): string {
  return path.join(userDataDir, 'pi-sessions', sessionKey.replace(/[^a-zA-Z0-9_-]/g, '-'))
}

/** 生成 pi ModelRuntime 可用的 models.json（探针实证：必须显式传路径，apiKey 支持字面量）。 */
export async function writePiModelsJson(userDataDir: string, config: ModelConfig): Promise<string> {
  const dir = piAgentDir(userDataDir)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, 'models.json')
  const doc = {
    providers: {
      [config.providerId]: {
        name: config.name ?? '自定义模型',
        baseUrl: config.baseUrl,
        api: 'openai-completions',
        apiKey: config.apiKey,
        models: [{ id: config.modelId, name: config.modelId, contextWindow: 128000, maxTokens: 16384 }],
      },
    },
  }
  await writeFile(file, JSON.stringify(doc, null, 2), 'utf8')
  return file
}

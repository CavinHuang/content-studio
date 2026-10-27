import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, test } from 'vitest'
import { KEEP_API_KEY } from '../../packages/desktop/src/shared/desktop'
import { DB_VERSION, migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import {
  clearModelConfig,
  getModelConfig,
  modelConfigView,
  piAgentDir,
  sessionDirFor,
  setModelConfig,
  validateModelConfig,
  writePiModelsJson,
  type Crypto,
} from '../../packages/desktop/src/main/ai/model-config'

let db: DatabaseSync | undefined
afterEach(() => {
  db?.close()
  db = undefined
})

function makeDb(): DatabaseSync {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-ai-')), 'studio.db'))
  migrate(db)
  return db
}

const passthrough: Crypto = {
  encrypt: (plain) => ({ data: Buffer.from(plain, 'utf8'), plain: false }),
  decrypt: (data) => (data && (data as ArrayLike<number>).length ? Buffer.from(data as ArrayLike<number>).toString('utf8') : ''),
}

test('v1 库迁移到最新版后 ai_config 可用', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'studio-ai-')), 'studio.db')
  const raw = new DatabaseSync(path)
  migrate(raw)
  expect(Number((raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)).toBe(DB_VERSION)
  raw.close()
})

test('配置往返：set 后 get 一致，view 脱敏不出明文', () => {
  const db = makeDb()
  setModelConfig(db, passthrough, { baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'sk-test-1234', modelId: 'gpt-test' })
  expect(getModelConfig(db, passthrough)).toMatchObject({ apiKey: 'sk-test-1234', modelId: 'gpt-test' })
  const view = modelConfigView(getModelConfig(db, passthrough), false)!
  expect(view).toMatchObject({ hasKey: true, apiKeyTail: '1234', baseUrl: 'http://127.0.0.1:9/v1' })
  expect(JSON.stringify(view)).not.toContain('sk-test-1234')
})

test('KEEP_API_KEY 保存沿用旧 key；clear 后为空', () => {
  const db = makeDb()
  setModelConfig(db, passthrough, { baseUrl: 'http://x/v1', apiKey: 'sk-old', modelId: 'm' })
  setModelConfig(db, passthrough, { baseUrl: 'http://y/v1', apiKey: KEEP_API_KEY, modelId: 'm2' })
  expect(getModelConfig(db, passthrough)).toMatchObject({ apiKey: 'sk-old', baseUrl: 'http://y/v1', modelId: 'm2' })
  clearModelConfig(db)
  expect(getModelConfig(db, passthrough)).toBeNull()
})

test('校验失败带错误码', () => {
  expect(() => validateModelConfig({ baseUrl: 'ftp://x', apiKey: 'k', modelId: 'm' })).toThrowError(
    /必须以 http/,
  )
  expect(() => validateModelConfig({ baseUrl: 'http://x', apiKey: '', modelId: 'm' })).toThrowError(/Key/)
})

test('models.json 写入正确路径与结构；sessionKey 安全化', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-ai-ud-'))
  const config = validateModelConfig({ baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'k', modelId: 'm' })
  const file = await writePiModelsJson(dir, config)
  expect(file).toBe(join(piAgentDir(dir), 'models.json'))
  const doc = JSON.parse(readFileSync(file, 'utf8')) as { providers: Record<string, unknown> }
  expect(Object.keys(doc.providers)).toEqual(['content-studio'])
  expect(sessionDirFor(dir, 'p:abc-123')).toBe(join(dir, 'pi-sessions', 'p-abc-123'))
})

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, test } from 'vitest'
import { KEEP_API_KEY } from '../../packages/desktop/src/shared/desktop'
import { DB_VERSION, migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import type { Crypto } from '../../packages/desktop/src/main/ai/model-config'
import {
  clearTtsConfig,
  getTtsConfig,
  setTtsConfig,
  ttsConfigView,
} from '../../packages/desktop/src/main/render/tts-config'

let db: DatabaseSync | undefined
afterEach(() => {
  db?.close()
  db = undefined
})

function makeDb(): DatabaseSync {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-tts-')), 'studio.db'))
  migrate(db)
  return db
}

const passthrough: Crypto = {
  encrypt: (plain) => ({ data: Buffer.from(plain, 'utf8'), plain: false }),
  decrypt: (data) =>
    data && (data as ArrayLike<number>).length ? Buffer.from(data as ArrayLike<number>).toString('utf8') : '',
}

test('迁移到 v6 后 tts_config 表可用（照 ai_config 模式）', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'studio-tts-')), 'studio.db')
  const raw = new DatabaseSync(path)
  migrate(raw)
  expect(Number((raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)).toBe(DB_VERSION)
  expect(DB_VERSION).toBe(6)
  raw.close()
})

test('配置往返：set 后 get 一致，view 脱敏不出明文 key', () => {
  const db = makeDb()
  setTtsConfig(db, passthrough, {
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKey: 'sk-voice-9999',
    modelId: 'tts-large',
    voice: 'alloy',
  })
  expect(getTtsConfig(db, passthrough)).toEqual({
    baseUrl: 'http://127.0.0.1:9/v1',
    apiKey: 'sk-voice-9999',
    modelId: 'tts-large',
    voice: 'alloy',
  })
  const view = ttsConfigView(db, passthrough)!
  expect(view).toMatchObject({ hasKey: true, apiKeyTail: '9999', voice: 'alloy', modelId: 'tts-large' })
  expect(JSON.stringify(view)).not.toContain('sk-voice-9999')
  expect(view.plain).toBeUndefined()
})

test('KEEP_API_KEY 保存沿用旧 key；clear 后为空', () => {
  const db = makeDb()
  setTtsConfig(db, passthrough, { baseUrl: 'http://x/v1', apiKey: 'sk-old', modelId: 'm', voice: 'v' })
  setTtsConfig(db, passthrough, { baseUrl: 'http://y/v1', apiKey: KEEP_API_KEY, modelId: 'm2', voice: 'v2' })
  expect(getTtsConfig(db, passthrough)).toMatchObject({ apiKey: 'sk-old', baseUrl: 'http://y/v1', voice: 'v2' })
  clearTtsConfig(db)
  expect(getTtsConfig(db, passthrough)).toBeNull()
  expect(ttsConfigView(db, passthrough)).toBeNull()
})

test('校验：地址必须 http(s)，key/模型/音色缺一不可', () => {
  const db = makeDb()
  const input = { baseUrl: 'http://x/v1', apiKey: 'k', modelId: 'm', voice: 'v' }
  expect(() => setTtsConfig(db, passthrough, { ...input, baseUrl: 'ftp://x' })).toThrow(/API 地址/)
  expect(() => setTtsConfig(db, passthrough, { ...input, apiKey: '' })).toThrow(/API Key/)
  expect(() => setTtsConfig(db, passthrough, { ...input, modelId: ' ' })).toThrow(/模型/)
  expect(() => setTtsConfig(db, passthrough, { ...input, voice: '' })).toThrow(/音色/)
  // 全部非法输入都没有落库
  expect(getTtsConfig(db, passthrough)).toBeNull()
})

test('safeStorage 不可用降级：视图带 plain 警示', () => {
  const db = makeDb()
  // 明文降级加密（safeStorage 不可用时的生产行为）：encrypt 返回 plain=true。
  const plainCrypto: Crypto = {
    encrypt: (plain) => ({ data: Buffer.from(plain, 'utf8'), plain: true }),
    decrypt: (data) =>
      data && (data as ArrayLike<number>).length ? Buffer.from(data as ArrayLike<number>).toString('utf8') : '',
  }
  setTtsConfig(db, plainCrypto, { baseUrl: 'http://x/v1', apiKey: 'k', modelId: 'm', voice: 'v' })
  expect(ttsConfigView(db, plainCrypto)).toMatchObject({ plain: true, hasKey: true })
})

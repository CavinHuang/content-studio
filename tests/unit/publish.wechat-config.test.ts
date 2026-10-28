import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { KEEP_WECHAT_SECRET } from '../../packages/desktop/src/shared/desktop'
import { DB_VERSION, migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import {
  clearWechatConfig,
  getWechatConfig,
  setWechatConfig,
  wechatConfigView,
} from '../../packages/desktop/src/main/publish/wechat-config'
import type { Crypto } from '../../packages/desktop/src/main/ai/model-config'

let db: DatabaseSync | undefined
afterEach(() => {
  db?.close()
  db = undefined
})

function makeDb(): DatabaseSync {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), 'studio-wx-')), 'studio.db'))
  migrate(db)
  return db
}

/** 直通加密（记录最后一次写入便于断言）；解密可切换为抛错以模拟换机场景。 */
function makeCrypto(): Crypto & { failDecrypt: (on: boolean) => void } {
  let fail = false
  const crypto: Crypto = {
    encrypt: (plain) => ({ data: Buffer.from(`enc:${plain}`, 'utf8'), plain: false }),
    decrypt: (data) => {
      if (fail) throw new Error('cannot decrypt')
      return Buffer.from(data as ArrayLike<number>).toString('utf8').replace(/^enc:/, '')
    },
  }
  return Object.assign(crypto, { failDecrypt: (on: boolean) => (fail = on) })
}

const plainCrypto: Crypto = {
  encrypt: (plain) => ({ data: Buffer.from(plain, 'utf8'), plain: true }),
  decrypt: (data) => Buffer.from(data as ArrayLike<number>).toString('utf8'),
}

test('迁移阶梯升到 v5：wechat_config 表可用', () => {
  const db = makeDb()
  expect(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'wechat_config'").get(),
  ).toMatchObject({ name: 'wechat_config' })
  expect(Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)).toBe(DB_VERSION)
})

test('配置往返：set 后 get 还原，view 脱敏不出明文', () => {
  const db = makeDb()
  const crypto = makeCrypto()
  setWechatConfig(db, crypto, { appId: 'wx1234567890abcdef', secret: 'secret-ABCD8888' })
  expect(getWechatConfig(db, crypto)).toEqual({ appId: 'wx1234567890abcdef', secret: 'secret-ABCD8888' })
  const view = wechatConfigView(db, crypto)!
  expect(view).toMatchObject({ appId: 'wx1234567890abcdef', hasSecret: true, secretTail: '8888' })
  expect(view.plain).toBeUndefined()
  expect(JSON.stringify(view)).not.toContain('secret-ABCD8888')
})

test('KEEP 占位沿用旧 secret；clear 后未配置', () => {
  const db = makeDb()
  const crypto = makeCrypto()
  setWechatConfig(db, crypto, { appId: 'wx1111111111111111', secret: 'old-secret-0000' })
  setWechatConfig(db, crypto, { appId: 'wx2222222222222222', secret: KEEP_WECHAT_SECRET })
  expect(getWechatConfig(db, crypto)).toEqual({ appId: 'wx2222222222222222', secret: 'old-secret-0000' })
  clearWechatConfig(db)
  expect(getWechatConfig(db, crypto)).toBeNull()
  expect(wechatConfigView(db, crypto)).toBeNull()
})

test('校验：AppID 与 Secret 不能为空（占位除外）', () => {
  const db = makeDb()
  const crypto = makeCrypto()
  expect(() => setWechatConfig(db, crypto, { appId: '  ', secret: 's' })).toThrowError(/AppID/)
  expect(() => setWechatConfig(db, crypto, { appId: 'wx1234567890abcdef', secret: '' })).toThrowError(/Secret/)
})

test('解密失败（换机/系统凭据变化）视同未配置，不抛错', () => {
  const db = makeDb()
  const crypto = makeCrypto()
  setWechatConfig(db, crypto, { appId: 'wx1234567890abcdef', secret: 's3cret' })
  crypto.failDecrypt(true)
  expect(getWechatConfig(db, crypto)).toBeNull()
  expect(wechatConfigView(db, crypto)).toMatchObject({ appId: 'wx1234567890abcdef', hasSecret: true, secretTail: '' })
})

test('safeStorage 不可用的明文降级：view 标记 plain 提醒', () => {
  const db = makeDb()
  setWechatConfig(db, plainCrypto, { appId: 'wx1234567890abcdef', secret: 'plain-secret' })
  expect(getWechatConfig(db, plainCrypto)).toMatchObject({ secret: 'plain-secret' })
  expect(wechatConfigView(db, plainCrypto)).toMatchObject({ plain: true, secretTail: 'cret' })
})

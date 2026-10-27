import { safeStorage } from 'electron'
import type { Crypto } from './model-config'

/** 生产加密：safeStorage（需 app ready 后使用）；不可用时降级明文并在视图上警示。 */
export function safeStorageCrypto(): Crypto {
  return {
    encrypt(plain) {
      if (safeStorage.isEncryptionAvailable()) return { data: safeStorage.encryptString(plain), plain: false }
      return { data: Buffer.from(plain, 'utf8'), plain: true }
    },
    decrypt(data, plain) {
      if (!data || (Array.isArray(data) && data.length === 0)) return ''
      const buffer = Buffer.from(data as ArrayLike<number>)
      if (plain) return buffer.toString('utf8')
      try {
        return safeStorage.decryptString(buffer)
      } catch {
        return ''
      }
    },
  }
}

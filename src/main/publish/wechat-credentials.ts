import { loadSettings, saveSettings } from '../settings';
import { KEEP_WECHAT_SECRET, type WechatMpConfigView } from '../../shared/types';

export type SecretCodec = { encrypt(plain: string): string; decrypt(stored: string): string };
/** 明文回退编解码：带 plain: 前缀，视图层标记 encrypted:false 提醒用户。 */
export const plainCodec: SecretCodec = {
  encrypt: (s) => `plain:${s}`,
  decrypt: (s) => (s.startsWith('plain:') ? s.slice(6) : s),
};

/** safeStorage 注入式适配（单测用仿造 safeStorage；主进程在 ipc 装配时注入真实现）。 */
export function makeSafeStorageCodec(safeStorage: {
  isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string;
}): { codec: SecretCodec; encrypted: boolean } {
  if (!safeStorage.isEncryptionAvailable()) return { codec: plainCodec, encrypted: false };
  return {
    codec: {
      encrypt: (s) => safeStorage.encryptString(s).toString('base64'),
      decrypt: (s) => safeStorage.decryptString(Buffer.from(s, 'base64')),
    },
    encrypted: true,
  };
}

let active: { codec: SecretCodec; encrypted: boolean } = { codec: plainCodec, encrypted: false };
export function setSecretCodec(codec: SecretCodec, encrypted: boolean): void { active = { codec, encrypted }; }

function invalid(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = 'WECHAT_CONFIG_INVALID'; return err;
}

export function getWechatCredentials(): { appid: string; secret: string } | null {
  const w = loadSettings().wechatMp;
  if (!w?.appid || !w.secretStore) return null;
  // plain: 前缀分流在前（不进 safeStorage 解密——其对垃圾输入行为不定；
  // e2e 预置明文凭证在打包环境 safeStorage 可用时也确定性生效）
  if (w.secretStore.startsWith('plain:')) return { appid: w.appid, secret: plainCodec.decrypt(w.secretStore) };
  try { return { appid: w.appid, secret: active.codec.decrypt(w.secretStore) }; }
  catch { return null; } // 解密失败（换了机器/系统凭据）视同未配置，引导重填
}

export function setWechatCredentials(input: { appid: string; secret: string }): void {
  const prev = loadSettings().wechatMp;
  const appid = input.appid.trim();
  if (!appid) throw invalid('AppID 不能为空');
  const secretStore = input.secret === KEEP_WECHAT_SECRET ? prev?.secretStore ?? '' : input.secret ? active.codec.encrypt(input.secret) : '';
  if (!secretStore) throw invalid('AppSecret 不能为空');
  saveSettings({ ...loadSettings(), wechatMp: { appid, secretStore } });
}

export function wechatCredentialsView(): WechatMpConfigView | null {
  const w = loadSettings().wechatMp;
  if (!w) return null;
  let tail = '';
  try { tail = w.secretStore ? active.codec.decrypt(w.secretStore).slice(-4) : ''; } catch { tail = ''; }
  return { appid: w.appid, hasSecret: Boolean(w.secretStore), secretTail: tail, encrypted: active.encrypted };
}

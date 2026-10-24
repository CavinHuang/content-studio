import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  plainCodec, makeSafeStorageCodec, setSecretCodec, getWechatCredentials, setWechatCredentials, wechatCredentialsView,
} from '../../src/main/publish/wechat-credentials';
import { KEEP_WECHAT_SECRET } from '../../src/shared/types';

describe('公众号凭证（settings.json + 注入式编解码）', () => {
  const prev = process.env.CONTENTDECK_USER_DATA;
  beforeEach(() => {
    process.env.CONTENTDECK_USER_DATA = mkdtempSync(path.join(tmpdir(), 'ud-'));
    setSecretCodec(plainCodec, false);
  });
  afterEach(() => { process.env.CONTENTDECK_USER_DATA = prev; setSecretCodec(plainCodec, false); });

  it('set/get 往返（plainCodec）：settings.json 以 plain: 前缀存，可解回明文', () => {
    setWechatCredentials({ appid: 'wx1', secret: 's3cret' });
    const raw = readFileSync(path.join(process.env.CONTENTDECK_USER_DATA!, 'settings.json'), 'utf8');
    expect(raw).toContain('"plain:s3cret"'); // 明文回退编解码的可识别形态（视图层标 encrypted:false）
    expect(getWechatCredentials()).toEqual({ appid: 'wx1', secret: 's3cret' });
  });
  it('makeSafeStorageCodec：可用时 base64 加解密往返；不可用回退 plainCodec', () => {
    const store = new Map<string, string>();
    const fake = makeSafeStorageCodec({
      isEncryptionAvailable: () => true,
      encryptString: (s) => { const v = `enc(${s})`; store.set(v, s); return Buffer.from(v); },
      decryptString: (b) => store.get(b.toString()) ?? '',
    });
    setSecretCodec(fake.codec, fake.encrypted);
    setWechatCredentials({ appid: 'wx2', secret: 'topsecret' });
    const raw = readFileSync(path.join(process.env.CONTENTDECK_USER_DATA!, 'settings.json'), 'utf8');
    expect(raw).not.toContain('topsecret');
    expect(getWechatCredentials()).toEqual({ appid: 'wx2', secret: 'topsecret' });
    const fallback = makeSafeStorageCodec({ isEncryptionAvailable: () => false, encryptString: () => Buffer.of(), decryptString: () => '' });
    expect(fallback.encrypted).toBe(false);
    expect(fallback.codec).toBe(plainCodec);
  });
  it('KEEP_WECHAT_SECRET 沿用旧值；脱敏视图只回 appid/hasSecret/尾四位', () => {
    setWechatCredentials({ appid: 'wx1', secret: 'abcdef1234' });
    setWechatCredentials({ appid: 'wx1', secret: KEEP_WECHAT_SECRET });
    expect(getWechatCredentials()).toEqual({ appid: 'wx1', secret: 'abcdef1234' });
    expect(wechatCredentialsView()).toMatchObject({ appid: 'wx1', hasSecret: true, secretTail: '1234', encrypted: false });
    expect(JSON.stringify(wechatCredentialsView())).not.toContain('abcdef1234'); // 全量密钥不出视图
  });
  it('加密编解码激活时，plain: 前缀旧值仍可读（跨机器/回退兼容；e2e 预置凭证依赖此路径）', () => {
    setSecretCodec(plainCodec, false);
    setWechatCredentials({ appid: 'wx3', secret: 'legacy' });
    // 切到加密编解码后读取：plain: 值按前缀分流、不进 safeStorage 解密
    // （decryptString 对垃圾输入行为不定——分流保证 e2e 打包环境 safeStorage 可用时预置明文凭证确定性生效）
    const store = new Map<string, string>();
    const fake = makeSafeStorageCodec({
      isEncryptionAvailable: () => true,
      encryptString: (s) => { const v = `enc(${s})`; store.set(v, s); return Buffer.from(v); },
      decryptString: (b) => { const v = b.toString(); if (!store.has(v)) throw new Error('解密失败'); return store.get(v)!; },
    });
    setSecretCodec(fake.codec, true);
    expect(getWechatCredentials()).toEqual({ appid: 'wx3', secret: 'legacy' });
  });
});

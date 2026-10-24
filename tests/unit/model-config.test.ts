import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  validateModelConfig, getModelConfig, setModelConfig, writePiModelsJson, piAgentDir, modelConfigView,
} from '../../src/main/agent/model-config';
import { KEEP_API_KEY } from '../../src/shared/types';

describe('模型配置', () => {
  const prev = process.env.CONTENTDECK_USER_DATA;
  beforeEach(() => { process.env.CONTENTDECK_USER_DATA = mkdtempSync(path.join(tmpdir(), 'ud-')); });
  afterEach(() => { process.env.CONTENTDECK_USER_DATA = prev; });

  it('validateModelConfig：合法输入归一化，非法输入抛 MODEL_CONFIG_INVALID', () => {
    const ok = validateModelConfig({ name: ' 我的模型 ', baseUrl: ' https://api.x.com/v1 ', apiKey: 'k', modelId: ' gpt-x ' });
    expect(ok).toEqual({ providerId: 'contentdeck', name: '我的模型', baseUrl: 'https://api.x.com/v1', apiKey: 'k', modelId: 'gpt-x' });
    for (const bad of [
      { baseUrl: 'ftp://x', apiKey: 'k', modelId: 'm' },
      { baseUrl: 'https://x', apiKey: '', modelId: 'm' },
      { baseUrl: 'https://x', apiKey: 'k', modelId: '' },
    ]) {
      expect(() => validateModelConfig(bad)).toThrowError(expect.objectContaining({ code: 'MODEL_CONFIG_INVALID' }));
    }
  });
  it('setModelConfig/getModelConfig 经 settings.json 往返', () => {
    expect(getModelConfig()).toBeNull();
    setModelConfig({ name: '本地', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'k', modelId: 'm' });
    expect(getModelConfig()).toMatchObject({ providerId: 'contentdeck', modelId: 'm' });
  });
  it('apiKey 传占位值：沿用已存 key（其余字段照常更新）；无旧配置时报 MODEL_CONFIG_INVALID', () => {
    expect(getModelConfig()).toBeNull();
    expect(() => setModelConfig({ baseUrl: 'https://x', apiKey: KEEP_API_KEY, modelId: 'm' }))
      .toThrowError(expect.objectContaining({ code: 'MODEL_CONFIG_INVALID' })); // 占位但无旧 key=空 key
    setModelConfig({ baseUrl: 'https://x', apiKey: 'sk-secret-0000', modelId: 'm1' });
    const c = setModelConfig({ baseUrl: 'https://y', apiKey: KEEP_API_KEY, modelId: 'm2' });
    expect(c).toMatchObject({ baseUrl: 'https://y', modelId: 'm2', apiKey: 'sk-secret-0000' }); // key 沿用，字段更新
    expect(getModelConfig()).toMatchObject({ apiKey: 'sk-secret-0000', modelId: 'm2' });
  });
  it('modelConfigView 脱敏：不含 apiKey，只暴露 hasKey/尾四位', () => {
    expect(modelConfigView(null)).toBeNull();
    const v = modelConfigView({ providerId: 'contentdeck', name: '本地', baseUrl: 'https://x', apiKey: 'sk-abcd1234', modelId: 'm' });
    expect(v).toEqual({ providerId: 'contentdeck', name: '本地', baseUrl: 'https://x', modelId: 'm', hasKey: true, apiKeyTail: '1234' });
    expect(JSON.stringify(v)).not.toContain('sk-abcd1234');
  });
  it('writePiModelsJson 生成 pi 可用的 models.json（openai-completions + apiKey 字面量）', async () => {
    const c = setModelConfig({ name: '本地', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'k', modelId: 'm' });
    const file = await writePiModelsJson(c);
    expect(file).toBe(path.join(piAgentDir(), 'models.json'));
    expect(existsSync(file)).toBe(true);
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    expect(doc.providers.contentdeck).toMatchObject({
      baseUrl: 'http://127.0.0.1:9/v1', api: 'openai-completions', apiKey: 'k',
    });
    expect(doc.providers.contentdeck.models[0]).toMatchObject({ id: 'm', name: 'm' });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  validateModelConfig, getModelConfig, setModelConfig, writePiModelsJson, piAgentDir,
} from '../../src/main/agent/model-config';

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

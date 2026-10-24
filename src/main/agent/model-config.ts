import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ModelConfig } from '../../shared/types';
import { loadSettings, saveSettings } from '../settings';

const PROVIDER_ID = 'contentdeck' as const;

function invalid(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = 'MODEL_CONFIG_INVALID';
  return err;
}

export function validateModelConfig(input: { name?: string; baseUrl: string; apiKey: string; modelId: string }): ModelConfig {
  const baseUrl = String(input.baseUrl ?? '').trim();
  const apiKey = String(input.apiKey ?? '');
  const modelId = String(input.modelId ?? '').trim();
  if (!/^https?:\/\/.+/i.test(baseUrl)) throw invalid('API 地址必须以 http:// 或 https:// 开头');
  if (!apiKey) throw invalid('API Key 不能为空（本地无鉴权端点可填任意占位值）');
  if (!modelId) throw invalid('模型 ID 不能为空');
  const name = input.name?.trim();
  return { providerId: PROVIDER_ID, ...(name ? { name } : {}), baseUrl, apiKey, modelId };
}

export function getModelConfig(): ModelConfig | null {
  return loadSettings().model ?? null;
}

export function setModelConfig(input: { name?: string; baseUrl: string; apiKey: string; modelId: string }): ModelConfig {
  const c = validateModelConfig(input);
  saveSettings({ ...loadSettings(), model: c });
  return c;
}

/** pi 的 agentDir：用户数据目录下专属子目录。绝不与用户可能安装的 pi CLI 共用 ~/.pi/agent（探针风险：会话迁移与版本串扰）。 */
export function piAgentDir(): string {
  return path.join(process.env.CONTENTDECK_USER_DATA ?? '', 'pi-agent');
}

/** 生成 pi ModelRuntime 可用的 models.json（探针实证：provider apiKey 支持字面量，模型即可用）。 */
export async function writePiModelsJson(c: ModelConfig): Promise<string> {
  const dir = piAgentDir();
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'models.json');
  const doc = {
    providers: {
      [c.providerId]: {
        name: c.name ?? '自定义模型',
        baseUrl: c.baseUrl,
        api: 'openai-completions',
        apiKey: c.apiKey, // 本地优先：随 userData 存放，不进内容库/git
        models: [{ id: c.modelId, name: c.modelId, contextWindow: 128000, maxTokens: 16384 }],
      },
    },
  };
  await writeFile(file, JSON.stringify(doc, null, 2), 'utf8');
  return file;
}

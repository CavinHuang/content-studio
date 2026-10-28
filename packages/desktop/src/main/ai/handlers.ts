import type { DatabaseSync } from 'node:sqlite'
import { KEEP_API_KEY } from '../../shared/desktop'
import type { AiConfigInput, AiConfigView, AiSendResult, AiTestResult } from '../../shared/desktop'
import { AgentService } from './agent-service'
import { clearModelConfig, getModelConfig, getModelConfigPlain, modelConfigView, setModelConfig, type Crypto } from './model-config'

/** 真实连接测试：GET <baseUrl>/models（OpenAI 兼容），10 秒超时。 */
export async function testOpenAiEndpoint(
  baseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<AiTestResult> {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\/.+/i.test(trimmed)) return { ok: false, message: 'API 地址必须以 http:// 或 https:// 开头。' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()
  try {
    const response = await fetchImpl(`${trimmed}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    const latencyMs = Date.now() - started
    if (!response.ok) {
      const hint = response.status === 401 ? '（Key 无效或未授权）' : ''
      return { ok: false, message: `服务返回 ${response.status}${hint}。` }
    }
    return { ok: true, message: '连接成功。', latencyMs }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return { ok: false, message: '连接超时（10 秒）。' }
    return { ok: false, message: `无法连接：${(err as Error).message}` }
  } finally {
    clearTimeout(timer)
  }
}

// F07：项目会话键为 p:<项目>:<对话>（两段冒号）；d/gen 键与旧的 p:<项目> 保持兼容。
const SESSION_KEY_PATTERN = /^(p|d|gen):[A-Za-z0-9_-]{1,64}(?::[A-Za-z0-9_-]{1,64})?$/

export interface AiHandlerDeps {
  db: DatabaseSync
  crypto: Crypto
  agent: Pick<AgentService, 'send' | 'cancel' | 'answer'>
}

export function buildAiHandlers(deps: AiHandlerDeps) {
  return {
    configGet(): AiConfigView | null {
      return modelConfigView(getModelConfig(deps.db, deps.crypto), getModelConfigPlain(deps.db))
    },
    configSet(input: AiConfigInput): AiConfigView {
      setModelConfig(deps.db, deps.crypto, input)
      return modelConfigView(getModelConfig(deps.db, deps.crypto), getModelConfigPlain(deps.db))!
    },
    configClear(): { ok: boolean } {
      clearModelConfig(deps.db)
      return { ok: true }
    },
    async test(baseUrl: string, apiKey: string, modelId: string): Promise<AiTestResult> {
      // 已保存的 key 未改动时用占位回传——测试连接用库里的真实 key。
      const key = apiKey === KEEP_API_KEY ? getModelConfig(deps.db, deps.crypto)?.apiKey ?? '' : apiKey
      if (!key && !apiKey) return { ok: false, message: 'API Key 不能为空。' }
      void modelId
      return testOpenAiEndpoint(baseUrl, key)
    },
    async send(sessionKey: string, text: string): Promise<AiSendResult> {
      if (!SESSION_KEY_PATTERN.test(sessionKey)) return { ok: false, code: 'BAD_SESSION', message: '会话标识不合法。' }
      return deps.agent.send(sessionKey, text)
    },
    async cancel(sessionKey: string): Promise<{ ok: boolean }> {
      await deps.agent.cancel(sessionKey)
      return { ok: true }
    },
    answer(questionId: string, answer: string): { ok: boolean } {
      deps.agent.answer(questionId, answer)
      return { ok: true }
    },
  }
}

export type AiHandlers = ReturnType<typeof buildAiHandlers>

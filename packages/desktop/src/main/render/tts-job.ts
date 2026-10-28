/**
 * P5 配音执行器（kind 'voice' / executor 'main'）：
 * OpenAI 兼容 POST /audio/speech 生成配音 → 音频存 userData/media → 结果带 mediaId。
 * 未配置语音服务时如实失败（渲染端保留本地演示路径）；任务停止通过 AbortSignal 中断 fetch。
 */
import type { MainExecutor } from '../tasks/runner'
import type { TtsConfig } from './tts-config'
import { saveAudio } from './media-store'

export type VoicePayload = {
  job: 'shot-voice'
  shotId: string
  text: string
  /** 语速（0.8/1.0/1.2）；1.0 或缺省不传，交给服务端默认值。 */
  speed?: number
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function errorSummary(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return (message.split('\n')[0] ?? '').trim().slice(0, 120) || '未知错误'
}

export function createVoiceExecutor(deps: {
  getConfig(): TtsConfig | null
  mediaDir(): string
  /** 测试/本地 stub 注入；缺省用配置里的服务地址与全局 fetch。 */
  baseUrl?: string
  fetchImpl?: typeof fetch
}): MainExecutor {
  const doFetch = deps.fetchImpl ?? fetch
  return async (task, ctx) => {
    const payload = task.payload as Partial<VoicePayload> | undefined
    const text = String(payload?.text ?? '').trim()
    if (!text) {
      return { state: 'failed', detail: '缺少口播文案，请先在分镜中填写口播再生成配音。' }
    }
    const config = deps.getConfig()
    if (!config) {
      return { state: 'failed', detail: '尚未配置语音服务，请先在「设置 → AI 服务」中配置语音服务。' }
    }
    if (ctx.signal.aborted) return { state: 'failed', detail: '配音已停止。' }
    ctx.progress('正在生成配音…')
    const base = (deps.baseUrl ?? config.baseUrl).replace(/\/+$/, '')
    const speed = typeof payload?.speed === 'number' && Number.isFinite(payload.speed) ? payload.speed : 1
    let response: Response
    try {
      response = await doFetch(`${base}/audio/speech`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: config.modelId,
          input: text,
          voice: config.voice,
          ...(speed !== 1 ? { speed } : {}),
          response_format: 'mp3',
        }),
        signal: ctx.signal,
      })
    } catch (err) {
      if (ctx.signal.aborted) return { state: 'failed', detail: '配音已停止。' }
      return { state: 'failed', detail: `无法连接语音服务：${errorSummary(err)}。请检查网络与服务地址。` }
    }
    if (!response.ok) {
      const snippet = (await response.text().catch(() => '')).slice(0, 160)
      return {
        state: 'failed',
        detail: `语音服务返回错误 ${response.status}${snippet ? `：${snippet}` : ''}。请检查模型与音色配置。`,
      }
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!bytes.byteLength) {
      return { state: 'failed', detail: '语音服务未返回音频内容，请检查模型与音色配置。' }
    }
    const stored = await saveAudio(deps.mediaDir(), bytes)
    return {
      state: 'complete',
      detail: `配音已生成（${sizeLabel(stored.bytes)}），已保存到本机媒体目录；可在分镜中试听。`,
      result: stored,
    }
  }
}

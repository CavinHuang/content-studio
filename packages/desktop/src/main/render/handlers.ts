/**
 * P5 视频域 IPC handlers：导出文件夹（shell 打开 userData/exports）、语音服务配置
 * （safeStorage 脱敏视图）、配音媒体读取（渲染端试听/测时长）。
 * 视频导出与配音生成本身走任务系统（kind 'export'/'voice'，executor 'main'），
 * 这里只有配置读取与结果查看，不含任何发布类动作。
 */
import { mkdir } from 'node:fs/promises'
import type { DatabaseSync } from 'node:sqlite'
import type { ExportFolderResult, TtsConfigInput, TtsConfigView, VideoMediaView } from '../../shared/desktop'
import type { Crypto } from '../ai/model-config'
import { readAudio } from './media-store'
import { clearTtsConfig, getTtsConfig, setTtsConfig, ttsConfigView } from './tts-config'

export interface VideoHandlerDeps {
  db: DatabaseSync
  crypto: Crypto
  exportsDir(): string
  mediaDir(): string
  /** shell.openPath 注入（生产）；测试可替换。 */
  openPath(path: string): Promise<string>
}

export function buildVideoHandlers(deps: VideoHandlerDeps) {
  return {
    async exportOpenFolder(): Promise<ExportFolderResult> {
      const dir = deps.exportsDir()
      try {
        await mkdir(dir, { recursive: true })
      } catch {
        return { ok: false, message: '无法创建导出文件夹，请检查本机磁盘权限。' }
      }
      const error = await deps.openPath(dir)
      return error ? { ok: false, message: '无法打开导出文件夹，请稍后重试。' } : { ok: true }
    },
    ttsConfigGet(): TtsConfigView | null {
      return ttsConfigView(deps.db, deps.crypto)
    },
    ttsConfigSet(input: TtsConfigInput): TtsConfigView {
      setTtsConfig(deps.db, deps.crypto, input)
      return ttsConfigView(deps.db, deps.crypto)!
    },
    configClear(): { ok: boolean } {
      clearTtsConfig(deps.db)
      return { ok: true }
    },
    mediaRead(mediaId: string): VideoMediaView {
      const media = readAudio(deps.mediaDir(), String(mediaId ?? ''))
      if (!media) return { ok: false, message: '没有找到这段配音音频；可重新生成后再试。' }
      return { ok: true, mime: media.mime, data: new Uint8Array(media.data) }
    },
  }
}

export type VideoHandlers = ReturnType<typeof buildVideoHandlers>

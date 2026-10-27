/**
 * 配音媒体存储（P5）：userData/media 下的音频文件仓。
 * mediaId 为 UUID（严格校验后拼接路径，防目录穿越）；渲染端按 mediaId 读取字节做试听与时长解码。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MEDIA_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type StoredMedia = { mediaId: string; fileName: string; bytes: number; mime: string }

/** 保存音频字节，返回 mediaId（UUID）与文件名；目录不存在则递归创建。 */
export async function saveAudio(dir: string, data: Uint8Array): Promise<StoredMedia> {
  const mediaId = randomUUID()
  const fileName = `${mediaId}.mp3`
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, fileName), data)
  return { mediaId, fileName, bytes: data.byteLength, mime: 'audio/mpeg' }
}

/** 读取音频：mediaId 必须是合法 UUID，其余（含目录穿越）一律返回 null。 */
export function readAudio(dir: string, mediaId: string): { data: Buffer; mime: string } | null {
  if (typeof mediaId !== 'string' || !MEDIA_ID_RE.test(mediaId)) return null
  try {
    return { data: readFileSync(join(dir, `${mediaId}.mp3`)), mime: 'audio/mpeg' }
  } catch {
    return null
  }
}

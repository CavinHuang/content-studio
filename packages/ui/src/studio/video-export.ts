/**
 * P5 视频导出数据映射（纯函数）：作品 + 已采用版本 → Remotion 组合 inputProps。
 * 快照语义（§12）：分镜取已采用版本的冻结快照（storyboard）或当前分镜叠加采用版本
 * 的场景标题（code）；图片冻结为 data URL——内置插画内联，素材图取素材库快照，
 * 未知引用退化为纯文字分镜，绝不伪造图片。
 */
import type { VideoExportPayload } from '../../../desktop/src/shared/desktop'
import { imageDataUrls } from './images'
import type { Material, Shot, Video, VideoVersion } from './types'

/** 分辨率串（如「1080 × 1920」）→ 像素；解析失败按比例回退。 */
export function resolveExportDimensions(
  resolution: string,
  ratio: Video['ratio'],
): { width: number; height: number } {
  const parsed = /(\d+)\s*[×x]\s*(\d+)/.exec(String(resolution ?? ''))
  if (parsed) {
    const width = Number(parsed[1])
    const height = Number(parsed[2])
    if (width > 0 && height > 0) return { width, height }
  }
  if (ratio === '16:9') return { width: 1920, height: 1080 }
  if (ratio === '1:1') return { width: 1080, height: 1080 }
  return { width: 1080, height: 1920 }
}

/**
 * 分镜配图 → data URL：内置插画 key 内联编码；素材 id 取素材库图片快照；
 * 其余（未知 key / 素材已删除）返回 undefined，组合按纯文字分镜渲染。
 */
export function resolveShotImage(image: string | undefined, materials: Material[]): string | undefined {
  if (!image) return undefined
  if (imageDataUrls[image]) return imageDataUrls[image]
  const material = materials.find((m) => m.id === image && !m.trashed)
  if (material?.data) return material.data
  return undefined
}

function toExportShot(
  shot: Shot,
  index: number,
  video: Video,
  version: VideoVersion | undefined,
  materials: Material[],
): VideoExportPayload['shots'][number] {
  return {
    id: shot.id,
    // code 模式：预览由采用版本的场景标题驱动，导出与预览一致。
    title: (video.mode === 'code' ? version?.sceneTitles?.[index] : undefined) || shot.title,
    ...(shot.subtitle ? { subtitle: shot.subtitle } : {}),
    ...(resolveShotImage(shot.image, materials) ? { image: resolveShotImage(shot.image, materials) } : {}),
    durationMs: Math.round(shot.seconds * 1000),
  }
}

/** 作品 → 导出任务 payload：分镜按已采用版本冻结，尺寸/帧率按作品设置。 */
export function buildExportPayload(video: Video, materials: Material[]): VideoExportPayload {
  const version = video.versions.find((v) => v.number === video.adopted)
  const { width, height } = resolveExportDimensions(video.resolution, video.ratio)
  const base =
    video.mode === 'storyboard' && version?.shots?.length
      ? version.shots
      : video.shots
  return {
    videoId: video.id,
    version: video.adopted,
    title: video.title,
    fps: video.fps,
    width,
    height,
    shots: base.map((shot, index) => toExportShot(shot, index, video, version, materials)),
  }
}

/**
 * P5 视频组合的纯数据契约：渲染端（分镜数据 → inputProps）、主进程执行器（校验/文件名）
 * 与 Remotion 组合入口（calculateMetadata/Sequence 编排）三方共享。
 * 本模块不 import remotion/electron，保证可单测、可被打包进 webpack 组合 bundle。
 */
import type { VideoExportShot } from '../../shared/desktop'

/** 组合 ID：执行器 selectComposition 与组合入口 <Composition id> 必须一致。 */
export const COMPOSITION_ID = 'studio-video'

/**
 * 组合输入分镜：由渲染端按已采用版本与素材快照冻结后随任务传入（§12 快照语义）。
 * 类型基于 IPC 契约（shared/desktop.ts VideoExportShot）；主进程唯一改写是 F02 的
 * 配音解析：把冻结的 voiceAudio.mediaId 解析成 voiceSrc（渲染资源相对路径）后传给组合。
 */
export type CompositionShot = VideoExportShot & {
  /** 主进程解析出的配音资源（bundle 内 public 相对路径，组合用 staticFile 引用）；无配音缺省。 */
  voiceSrc?: string
}

/** bundle 内 public 目录下的配音资源目录：执行器拷贝目标 = <bundle>/public/<VOICE_PUBLIC_DIR>。 */
export const VOICE_PUBLIC_DIR = 'studio-voice'

/** mediaId → 组合内 staticFile 引用的 public 相对路径（执行器与组合共享的映射契约）。 */
export function voicePublicPath(mediaId: string): string {
  return `${VOICE_PUBLIC_DIR}/${mediaId}.mp3`
}

/** 组合 inputProps：尺寸/帧率/时长全部由数据决定（spike §5 实证）。 */
export type StudioVideoProps = {
  fps: number
  width: number
  height: number
  shots: CompositionShot[]
}

/**
 * durationMs → 帧数：四舍五入，最短 1 帧（spike §5 第 5 条取整策略）；
 * 非法输入一律退化为 1 帧，绝不让 NaN 流进渲染器。
 */
export function shotFrames(durationMs: number, fps: number): number {
  if (!Number.isFinite(durationMs) || !Number.isFinite(fps) || fps <= 0 || durationMs <= 0) return 1
  return Math.max(1, Math.round((durationMs / 1000) * fps))
}

/** 总帧数 = 各分镜帧数之和；空分镜返回 0，由导出执行器在入队时拒绝。 */
export function totalFrames(shots: CompositionShot[], fps: number): number {
  return shots.reduce((sum, shot) => sum + shotFrames(shot.durationMs, fps), 0)
}

const FILE_NAME_SAFE = /[\p{L}\p{N} -]/gu

/** 导出文件名：只留文字/数字/空格/连字符（含中文），压缩空白、截断 40 字符；空则回退 video。 */
export function sanitizeFileName(title: string): string {
  const cleaned = (title ?? '')
    .match(FILE_NAME_SAFE)
    ?.join('')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned ? cleaned.slice(0, 40) : 'video'
}

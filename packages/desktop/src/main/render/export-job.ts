/**
 * P5 视频导出执行器（kind 'export' / executor 'main'）：
 * Remotion bundle → 配音资源拷入 bundle public（F02）→ selectComposition → renderMedia
 * （真实帧级进度 → ctx.progress、任务停止 → cancelSignal）→ 产物写入 userData/exports。
 * 渲染链事实全部来自本机 spike 验证（docs/superpowers/ref/p5-spike-report.md）：
 * - bundle() 产物必须由调用方清理（坑 4）；取消以 'got cancelled' 文案判定（坑 3）；
 * - ESM 具名导入不可靠，统一 namespace + default 解包（坑 2）；
 * - 渲染环境缺失（组合入口/依赖不存在，如精简安装包）时如实失败，绝不伪成功。
 */
import { existsSync } from 'node:fs'
import { copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskRecord, VideoExportPayload, VideoExportShot } from '../../shared/desktop'
import type { MainExecutor } from '../tasks/runner'
import { COMPOSITION_ID, sanitizeFileName, voicePublicPath, VOICE_PUBLIC_DIR, type CompositionShot } from './composition'
import { audioFilePath } from './media-store'

/** IPC 契约里的导出任务入参在执行器侧同源使用。 */
export type { VideoExportPayload }

/** 渲染 API 面：与 @remotion/bundler + @remotion/renderer 的程序化调用契约一致。 */
export type RenderComposition = {
  id: string
  durationInFrames: number
  width: number
  height: number
  fps: number
}
export type RenderMediaProgress = {
  renderedFrames: number
  encodedFrames: number
  stitchStage: 'encoding' | 'muxing'
}
export type RenderApi = {
  bundle(options: { entryPoint: string; rootDir?: string | null }): Promise<string>
  selectComposition(options: {
    serveUrl: string
    id: string
    inputProps: unknown
    browserExecutable?: string | null
    binariesDirectory?: string | null
  }): Promise<RenderComposition>
  renderMedia(options: {
    composition: RenderComposition
    serveUrl: string
    codec: 'h264'
    outputLocation: string
    inputProps: unknown
    cancelSignal?: unknown
    browserExecutable?: string | null
    binariesDirectory?: string | null
    onProgress?: (progress: RenderMediaProgress) => void
  }): Promise<unknown>
  makeCancelSignal(): { cancelSignal: unknown; cancel: () => void }
}

/** 配音资源解析产物：absolutePath 用于拷入 bundle，publicPath 是组合内 staticFile 引用。 */
export type VoiceAssetFile = { mediaId: string; absolutePath: string; publicPath: string }
export type VoiceAssetResolution =
  | { ok: true; shots: CompositionShot[]; files: VoiceAssetFile[] }
  | { ok: false; error: string }

/**
 * mediaId → 渲染资源（纯函数，F02 修复）：
 * - 携带 voiceAudio 的分镜解析出 voiceSrc（public 相对路径）传给组合；
 * - 非法引用（非 UUID / 音频文件缺失）如实失败——成片以「有配音」为已采用快照的承诺，
 *   静默丢弃会复刻 F02 的无声交付；错误文案不落盘面路径；
 * - 无配音分镜原样透传（组合与历史行为完全一致），mediaId 去重避免重复拷贝。
 * Windows 绝对路径不能直接进 <Audio src>：@remotion/renderer 的资源下载器只接受
 * http(s)（dist/assets/read-file.js 明确拒绝 file://），staticFile 也拒绝盘符路径——
 * 因此执行器把 mp3 拷入 <bundle>/public/，组合用 staticFile 经渲染器本地 HTTP 服务取用
 * （serve-handler 逐请求从磁盘读 bundle 目录，bundle 后拷入的文件可被 renderMedia 命中）。
 */
export function resolveVoiceAssets(
  shots: VideoExportShot[],
  mediaDir: string,
  fileExists: (path: string) => boolean = existsSync,
): VoiceAssetResolution {
  const files: VoiceAssetFile[] = []
  const seen = new Set<string>()
  const resolved: CompositionShot[] = []
  for (const shot of shots) {
    const mediaId = shot.voiceAudio?.mediaId
    if (!mediaId) {
      resolved.push(shot)
      continue
    }
    const absolutePath = audioFilePath(mediaDir, mediaId)
    if (!absolutePath) {
      return {
        ok: false,
        error: `分镜「${shot.title}」的配音引用无效，无法合成音轨；请在该镜头重新生成配音后再导出。`,
      }
    }
    if (!fileExists(absolutePath)) {
      return {
        ok: false,
        error: `分镜「${shot.title}」的配音音频在本机已不存在（可能被清理），请重新生成配音后再导出。`,
      }
    }
    resolved.push({ ...shot, voiceSrc: voicePublicPath(mediaId) })
    if (!seen.has(mediaId)) {
      seen.add(mediaId)
      files.push({ mediaId, absolutePath, publicPath: voicePublicPath(mediaId) })
    }
  }
  return { ok: true, shots: resolved, files }
}

/**
 * 真实装配：动态加载 Remotion（主进程 bundle 已 externalize，运行时从 node_modules 解析）。
 * - browserExecutable 由执行器随每次调用显式传入（随包预置的 Chrome Headless Shell），
 *   跳过 Remotion 的按 cwd 自动下载（spike §7.1：cwd 不可控，自动下载在安装目录不可写时失败）。
 * - rootDir 同理传入：@remotion/bundler 会 process.chdir(remotion root) 并把 webpack 缓存写到
 *   rootDir/.cache/webpack——入口在 asar 内时该目录无法 chdir（实测 ENOENT），必须指到真实可写目录。
 */
export async function loadRemotionApi(): Promise<RenderApi> {
  const [bundlerMod, rendererMod] = await Promise.all([
    import('@remotion/bundler'),
    import('@remotion/renderer'),
  ])
  // ESM/CJS 互操作（spike 坑 2）：统一解包 .default，具名导入在部分环境会 SyntaxError。
  const unwrap = <T,>(mod: T): T => ((mod as unknown as { default?: T }).default ?? mod)
  const bundler = unwrap(bundlerMod)
  const renderer = unwrap(rendererMod)
  const api: RenderApi = {
    bundle: (options) => bundler.bundle({ entryPoint: options.entryPoint, rootDir: options.rootDir ?? undefined }),
    selectComposition: (options) =>
      renderer.selectComposition({
        serveUrl: options.serveUrl,
        id: options.id,
        inputProps: options.inputProps as Record<string, unknown>,
        browserExecutable: options.browserExecutable ?? null,
        binariesDirectory: options.binariesDirectory ?? undefined,
      }),
    renderMedia: (options) =>
      renderer.renderMedia({
        composition: options.composition as unknown as Parameters<typeof renderer.renderMedia>[0]['composition'],
        serveUrl: options.serveUrl,
        codec: options.codec,
        outputLocation: options.outputLocation,
        inputProps: options.inputProps as Record<string, unknown>,
        cancelSignal: options.cancelSignal as never,
        browserExecutable: options.browserExecutable ?? null,
        binariesDirectory: options.binariesDirectory ?? undefined,
        onProgress: options.onProgress as never,
      }),
    makeCancelSignal: () =>
      renderer.makeCancelSignal() as unknown as ReturnType<RenderApi['makeCancelSignal']>,
  }
  for (const fn of [api.bundle, api.selectComposition, api.renderMedia, api.makeCancelSignal]) {
    if (typeof fn !== 'function') throw new Error('Remotion API incomplete')
  }
  return api
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** 错误摘要：首行 + 本机路径脱敏，不让仓库/系统路径流进用户可见的任务详情。 */
function summarizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const firstLine = (message.split('\n')[0] ?? '').trim()
  const safe = firstLine.replace(/(?:[A-Za-z]:)?[\\/][^\s'"()，。；]+/g, '…')
  return (safe.trim() || '未知错误').slice(0, 120)
}

export function createExportExecutor(deps: {
  entryPoint(): string
  exportsDir(): string
  /** 配音媒体目录（userData/media，与 voice 执行器同源）：payload 的 mediaId 在这里解析为 mp3。 */
  mediaDir(): string
  /** 测试注入假渲染器；缺省动态加载 Remotion。 */
  loadApi?: () => Promise<RenderApi>
  /** 打包形态传入随包浏览器；缺省让 Remotion 自行定位/下载（开发形态行为不变）。 */
  browserExecutable?: () => string | null
  /** 打包形态传入真实可写的渲染根目录（bundler chdir/缓存落点）；缺省沿用 Remotion 自行探测。 */
  bundleRootDir?: () => string | null
  /** 打包形态传入解包出的原生合成器目录（asar 虚拟路径无法 spawn）；缺省用 Remotion 自带解析。 */
  binariesDirectory?: () => string | null
}): MainExecutor {
  const loadApi = deps.loadApi ?? loadRemotionApi
  const resolveBrowser = () => deps.browserExecutable?.() ?? null
  const resolveRootDir = () => deps.bundleRootDir?.() ?? null
  const resolveBinaries = () => deps.binariesDirectory?.() ?? null
  return async (task: TaskRecord, ctx) => {
    const payload = task.payload as VideoExportPayload | undefined
    if (!payload || !Array.isArray(payload.shots) || payload.shots.length === 0) {
      return { state: 'failed', detail: '导出数据不完整（没有可渲染的分镜），请回到分镜编辑补充分镜后重试。' }
    }
    const entry = deps.entryPoint()
    if (!existsSync(entry)) {
      return {
        state: 'failed',
        detail: '当前应用缺少视频渲染组件，无法导出 MP4。请重新安装应用后再试；下载制作清单不受影响。',
      }
    }
    // F02：先把已采用快照的配音引用解析成渲染资源（在打包前如实失败，不做无用渲染）。
    const voice = resolveVoiceAssets(payload.shots, deps.mediaDir())
    if (!voice.ok) return { state: 'failed', detail: voice.error }
    const inputProps = {
      fps: payload.fps,
      width: payload.width,
      height: payload.height,
      shots: voice.shots,
    }
    let api: RenderApi
    try {
      api = await loadApi()
    } catch {
      return { state: 'failed', detail: '视频渲染组件加载失败，无法导出 MP4。请重新安装应用后再试。' }
    }
    const { cancelSignal, cancel } = api.makeCancelSignal()
    ctx.signal.addEventListener('abort', cancel)
    const stoppedDetail = '导出已停止，未生成视频文件；作品与已采用版本保留。'
    let serveUrl: string | undefined
    try {
      await mkdir(deps.exportsDir(), { recursive: true })
      if (ctx.signal.aborted) {
        cancel()
        return { state: 'failed', detail: stoppedDetail }
      }
      ctx.progress('正在打包视频组合…')
      serveUrl = await api.bundle({ entryPoint: entry, rootDir: resolveRootDir() })
      if (voice.files.length > 0) {
        // F02：配音 mp3 拷入 bundle 的 public/<VOICE_PUBLIC_DIR>/（serve-handler 逐请求读盘，
        // bundle 后拷入的文件 renderMedia 可命中）；组合用 staticFile 经本地 HTTP 取用。
        // 临时目录随 finally 的 bundle 清理一起删除，无需单独回收。
        const voiceDir = join(serveUrl, 'public', VOICE_PUBLIC_DIR)
        await mkdir(voiceDir, { recursive: true })
        await Promise.all(
          voice.files.map((file) => copyFile(file.absolutePath, join(voiceDir, `${file.mediaId}.mp3`))),
        )
      }
      const composition = await api.selectComposition({
        serveUrl,
        id: COMPOSITION_ID,
        inputProps,
        browserExecutable: resolveBrowser(),
        binariesDirectory: resolveBinaries(),
      })
      if (ctx.signal.aborted) {
        cancel()
        return { state: 'failed', detail: stoppedDetail }
      }
      const fileName = `${sanitizeFileName(payload.title)}-v${payload.version}-${task.id.slice(0, 8)}.mp4`
      const outputLocation = join(deps.exportsDir(), fileName)
      let lastStep = ''
      const report = (step: string) => {
        if (step === lastStep) return
        lastStep = step
        ctx.progress(step)
      }
      await api.renderMedia({
        composition,
        serveUrl,
        codec: 'h264',
        outputLocation,
        inputProps,
        cancelSignal,
        browserExecutable: resolveBrowser(),
        binariesDirectory: resolveBinaries(),
        onProgress: (progress) => {
          const base = `已渲染 ${progress.renderedFrames}/${composition.durationInFrames} 帧`
          report(progress.stitchStage === 'muxing' ? `${base}，正在封装…` : base)
        },
      })
      const bytes = (await stat(outputLocation)).size
      return {
        state: 'complete',
        detail: `视频已导出：${fileName}（${sizeLabel(bytes)}）。可在任务详情打开导出文件夹。`,
        result: { fileName, bytes, version: payload.version },
      }
    } catch (err) {
      if (process.env.STUDIO_RENDER_DEBUG === '1') {
        // 联调/打包形态排障开关：完整错误只进主进程 stderr，不进用户可见文案。
        console.error('[export-job] render failed:', err)
      }
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('got cancelled') || ctx.signal.aborted) {
        return { state: 'failed', detail: stoppedDetail }
      }
      return { state: 'failed', detail: `视频渲染失败：${summarizeError(err)}。作品与设置保留，可重试。` }
    } finally {
      ctx.signal.removeEventListener('abort', cancel)
      if (serveUrl !== undefined) await rm(serveUrl, { recursive: true, force: true }).catch(() => {})
    }
  }
}

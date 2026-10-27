/**
 * P5 视频导出执行器（kind 'export' / executor 'main'）：
 * Remotion bundle → selectComposition → renderMedia（真实帧级进度 → ctx.progress、
 * 任务停止 → cancelSignal）→ 产物写入 userData/exports。
 * 渲染链事实全部来自本机 spike 验证（docs/superpowers/ref/p5-spike-report.md）：
 * - bundle() 产物必须由调用方清理（坑 4）；取消以 'got cancelled' 文案判定（坑 3）；
 * - ESM 具名导入不可靠，统一 namespace + default 解包（坑 2）；
 * - 渲染环境缺失（组合入口/依赖不存在，如精简安装包）时如实失败，绝不伪成功。
 */
import { existsSync } from 'node:fs'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskRecord, VideoExportPayload } from '../../shared/desktop'
import type { MainExecutor } from '../tasks/runner'
import { COMPOSITION_ID, sanitizeFileName } from './composition'

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
  bundle(options: { entryPoint: string }): Promise<string>
  selectComposition(options: {
    serveUrl: string
    id: string
    inputProps: unknown
  }): Promise<RenderComposition>
  renderMedia(options: {
    composition: RenderComposition
    serveUrl: string
    codec: 'h264'
    outputLocation: string
    inputProps: unknown
    cancelSignal?: unknown
    onProgress?: (progress: RenderMediaProgress) => void
  }): Promise<unknown>
  makeCancelSignal(): { cancelSignal: unknown; cancel: () => void }
}

/** 真实装配：动态加载 Remotion（主进程 bundle 已 externalize，运行时从 node_modules 解析）。 */
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
    bundle: (options) => bundler.bundle(options),
    selectComposition: (options) =>
      renderer.selectComposition({
        serveUrl: options.serveUrl,
        id: options.id,
        inputProps: options.inputProps as Record<string, unknown>,
      }),
    renderMedia: (options) =>
      renderer.renderMedia({
        composition: options.composition as unknown as Parameters<typeof renderer.renderMedia>[0]['composition'],
        serveUrl: options.serveUrl,
        codec: options.codec,
        outputLocation: options.outputLocation,
        inputProps: options.inputProps as Record<string, unknown>,
        cancelSignal: options.cancelSignal as never,
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
  /** 测试注入假渲染器；缺省动态加载 Remotion。 */
  loadApi?: () => Promise<RenderApi>
}): MainExecutor {
  const loadApi = deps.loadApi ?? loadRemotionApi
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
    let api: RenderApi
    try {
      api = await loadApi()
    } catch {
      return { state: 'failed', detail: '视频渲染组件加载失败，无法导出 MP4。请重新安装应用后再试。' }
    }
    const { cancelSignal, cancel } = api.makeCancelSignal()
    ctx.signal.addEventListener('abort', cancel)
    const stoppedDetail = '导出已停止，未生成视频文件；作品与已采用版本保留。'
    const inputProps = {
      fps: payload.fps,
      width: payload.width,
      height: payload.height,
      shots: payload.shots,
    }
    let serveUrl: string | undefined
    try {
      await mkdir(deps.exportsDir(), { recursive: true })
      if (ctx.signal.aborted) {
        cancel()
        return { state: 'failed', detail: stoppedDetail }
      }
      ctx.progress('正在打包视频组合…')
      serveUrl = await api.bundle({ entryPoint: entry })
      const composition = await api.selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps })
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

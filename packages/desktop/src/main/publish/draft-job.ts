/**
 * 公众号「存入草稿箱」主进程执行器（kind 'publish' / executor 'main'）。
 * 人机边界：只创建草稿（draft/add 停在草稿态），绝不发布；
 * 进度经 TaskRunner 如实推进，失败如实结算，绝不伪装成功。
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { MainExecutor } from '../tasks/runner'
import type { TaskRecord } from '../../shared/desktop'
import { makePlaceholderCoverPng } from './cover'
import { markdownToWechatHtml, replaceUploadImages } from './markdown-to-wechat-html'
import {
  WECHAT_CREDENTIAL_HINT,
  WECHAT_CREDENTIAL_HINT_ERRCODES,
  WechatApiError,
  WechatMpClient,
  WechatNetworkError,
  validateWechatDraftFields,
  type WechatFetch,
} from './wechat-mp'

export type WechatDraftJobPayload = {
  platform: 'wechat'
  title: string
  body: string
  digest?: string
  author?: string
  /** asset:<素材 id> → data URL 的正文图快照（随发布批次冻结）。 */
  assets?: Record<string, string>
  /** 可选本地封面文件（绝对路径）；缺省生成占位封面。 */
  coverPath?: string
}

export type WechatDraftJobResult = {
  mediaId: string
  contentChars: number
  cover: 'placeholder' | 'file'
  images: { uploaded: number; external: number; unresolved: string[] }
}

export type WechatDraftExecutorDeps = {
  getConfig(): { appId: string; secret: string } | null
  baseUrl?: string
  /** 测试注入；缺省走全局 fetch（全部网络请求都在主进程）。 */
  fetchImpl?: WechatFetch
}

const COVER_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

async function loadCover(coverPath?: string): Promise<{
  bytes: Uint8Array
  filename: string
  mimeType: string
  source: 'placeholder' | 'file'
}> {
  if (coverPath) {
    const mimeType = COVER_MIME[path.extname(coverPath).toLowerCase()]
    if (!mimeType) throw new WechatApiError(-3, '封面文件仅支持 PNG 或 JPG。')
    const bytes = new Uint8Array(await readFile(coverPath))
    if (!bytes.length) throw new WechatApiError(-3, '封面文件为空。')
    return { bytes, filename: path.basename(coverPath), mimeType, source: 'file' }
  }
  const placeholder = makePlaceholderCoverPng()
  return { ...placeholder, source: 'placeholder' }
}

export function createWechatDraftExecutor(deps: WechatDraftExecutorDeps): MainExecutor {
  return async (task: TaskRecord, ctx) => {
    const payload = (task.payload ?? {}) as Partial<WechatDraftJobPayload>
    if (payload.platform !== 'wechat')
      return { state: 'failed', detail: '发布任务暂只支持公众号草稿。' }
    const config = deps.getConfig()
    if (!config)
      return { state: 'failed', detail: '尚未配置公众号 AppID 与 AppSecret，请先在发布准备页完成配置。' }
    // 字段限制在上传前就地校验（title≤32 等），失败零请求。
    ctx.progress('正在转换正文为公众号 HTML…')
    const content = markdownToWechatHtml(String(payload.body ?? ''))
    try {
      validateWechatDraftFields({
        title: String(payload.title ?? ''),
        author: payload.author,
        digest: payload.digest,
        content,
      })
    } catch (err) {
      return { state: 'failed', detail: err instanceof WechatApiError ? err.message : String(err) }
    }
    const client = new WechatMpClient(
      { getAppId: () => config.appId, getSecret: () => config.secret },
      { ...(deps.baseUrl ? { baseUrl: deps.baseUrl } : {}), ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) },
    )
    try {
      ctx.progress('正在把正文图片替换为公众号图片链接…')
      const images = await replaceUploadImages(content, {
        upload: (source) => client.uploadContentImage(source.bytes, source.filename, source.mimeType),
        ...(payload.assets ? { assets: payload.assets } : {}),
      })
      if (ctx.signal.aborted) return { state: 'failed', detail: '已停止；本次未存入草稿箱。' }
      ctx.progress('正在上传封面素材…')
      const cover = await loadCover(payload.coverPath)
      const material = await client.uploadImageMaterial(cover.bytes, cover.filename, cover.mimeType)
      if (!material.mediaId) throw new WechatApiError(-3, '封面素材上传未返回 media_id。')
      if (ctx.signal.aborted) return { state: 'failed', detail: '已停止；本次未存入草稿箱。' }
      ctx.progress('正在存入公众号草稿箱…')
      const mediaId = await client.createDraft({
        title: String(payload.title ?? ''),
        author: payload.author,
        digest: payload.digest,
        content: images.html,
        thumbMediaId: material.mediaId,
      })
      const result: WechatDraftJobResult = {
        mediaId,
        contentChars: images.html.length,
        cover: cover.source,
        images: { uploaded: images.uploaded, external: images.external, unresolved: images.unresolved },
      }
      const notes: string[] = []
      if (images.external) notes.push(`正文含 ${images.external} 张外链图片（公众号可能不显示，建议换用素材图片）`)
      if (images.unresolved.length) notes.push(`${images.unresolved.length} 张图片缺少素材数据，已保留原引用`)
      if (cover.source === 'placeholder') notes.push('封面为占位图，可在公众号后台替换')
      return {
        state: 'complete',
        detail: `已存入公众号草稿箱；正式发布请在公众号后台完成。${notes.map((note) => `（${note}）`).join('')}`,
        result,
      }
    } catch (err) {
      if (err instanceof WechatApiError) {
        const hint = WECHAT_CREDENTIAL_HINT_ERRCODES.has(err.errcode) ? WECHAT_CREDENTIAL_HINT : ''
        return { state: 'failed', detail: `公众号接口错误 ${err.errcode}：${err.errmsg}。${hint}` }
      }
      if (err instanceof WechatNetworkError) {
        return { state: 'failed', detail: `无法连接公众号接口：${err.message}。请检查网络与本机出口 IP 白名单。` }
      }
      return { state: 'failed', detail: err instanceof Error ? err.message : String(err) }
    }
  }
}

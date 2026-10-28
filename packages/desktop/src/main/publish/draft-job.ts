/**
 * 公众号「存入草稿箱」平台适配器（PublishAdapter：platform 'wechat' / usesSession false）。
 * 人机边界：只创建草稿（draft/add 停在草稿态），绝不发布；
 * 失败按三分类如实上报（凭证/瞬态网络/永久），绝不伪装成功。
 * 编排（平台间串行限速、瞬态自动重试）由 PublishService 负责；本层只关心单次执行。
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { TaskRecord } from '../../shared/desktop'
import {
  publishOutcomeFromError,
  type PublishAdapter,
  type PublishRunContext,
  type PublishRunOutcome,
} from './publish-service'
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

export type WechatPublishAdapterDeps = {
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

/** WechatApiError → 三分类：凭证类 errcode（密钥/IP 白名单）停下要求配置，其余 API 错误如实上报。 */
function wechatApiOutcome(err: WechatApiError): PublishRunOutcome {
  const credential = WECHAT_CREDENTIAL_HINT_ERRCODES.has(err.errcode)
  const hint = credential ? WECHAT_CREDENTIAL_HINT : ''
  return {
    ok: false,
    ...(credential
      ? { category: 'credential' as const, code: 'WECHAT_CREDENTIAL' }
      : { category: 'permanent' as const }),
    detail: `公众号接口错误 ${err.errcode}：${err.errmsg}。${hint}`,
  }
}

export function createWechatPublishAdapter(deps: WechatPublishAdapterDeps): PublishAdapter {
  return {
    platform: 'wechat',
    // 公众号为 API 平台：无页面会话，编排层不会调用 openSession（误传即显式报错）。
    usesSession: false,
    async run({ task, session }, ctx): Promise<PublishRunOutcome> {
      if (session !== null)
        return { ok: false, category: 'permanent', detail: '公众号为 API 平台，不应持有页面会话。' }
      const payload = (task.payload ?? {}) as Partial<WechatDraftJobPayload>
      if (payload.platform !== undefined && payload.platform !== 'wechat')
        return { ok: false, category: 'permanent', detail: '发布任务暂只支持公众号草稿与小红书注入。' }
      const config = deps.getConfig()
      if (!config)
        return {
          ok: false,
          category: 'credential',
          code: 'NO_CONFIG',
          detail: '尚未配置公众号 AppID 与 AppSecret，请先在发布准备页完成配置。',
        }
      return runDraftJob(payload, config, deps, ctx)
    },
  }
}

async function runDraftJob(
  payload: Partial<WechatDraftJobPayload>,
  config: { appId: string; secret: string },
  deps: WechatPublishAdapterDeps,
  ctx: PublishRunContext,
): Promise<PublishRunOutcome> {
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
    if (err instanceof WechatApiError) return { ok: false, category: 'permanent', detail: err.message }
    return publishOutcomeFromError(err)
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
    if (ctx.signal.aborted) return { ok: false, category: 'permanent', detail: '已停止；本次未存入草稿箱。' }
    ctx.progress('正在上传封面素材…')
    const cover = await loadCover(payload.coverPath)
    const material = await client.uploadImageMaterial(cover.bytes, cover.filename, cover.mimeType)
    if (!material.mediaId) throw new WechatApiError(-3, '封面素材上传未返回 media_id。')
    if (ctx.signal.aborted) return { ok: false, category: 'permanent', detail: '已停止；本次未存入草稿箱。' }
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
      ok: true,
      detail: `已存入公众号草稿箱；正式发布请在公众号后台完成。${notes.map((note) => `（${note}）`).join('')}`,
      result,
    }
  } catch (err) {
    if (err instanceof WechatApiError) return wechatApiOutcome(err)
    if (err instanceof WechatNetworkError)
      return {
        ok: false,
        category: 'transient',
        code: 'NETWORK',
        detail: `无法连接公众号接口：${err.message}。请检查网络与本机出口 IP 白名单。`,
      }
    return publishOutcomeFromError(err)
  }
}

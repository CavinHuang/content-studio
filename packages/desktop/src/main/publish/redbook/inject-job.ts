/**
 * 小红书「注入草稿」平台适配器（PublishAdapter：platform 'redbook' / usesSession true）。
 * 人机边界：只把标题、正文与话题填进平台编辑器并停在草稿态，绝不点击发布；
 * 未登录/防覆盖/页面结构变化一律如实结算，绝不伪装成功。
 * 平台页会话由编排层（PublishService.openSession）打开后经 session 传入——适配器自身不开会话；
 * 瞬态自动重试与串行限速由编排层负责。
 */
import type { TaskRecord } from '../../../shared/desktop'
import {
  publishOutcomeFromError,
  type PublishAdapter,
  type PublishRunOutcome,
} from '../publish-service'
import type { RedbookDriver } from './driver'

export type RedbookInjectPayload = {
  platform: 'redbook'
  title: string
  body: string
  /** 批次快照的话题标签原始串（如「#个人创作 #创作习惯」或逗号分隔）；执行时解析为话题列表。 */
  tags?: string
  batchId?: string
}

export type RedbookInjectResult = {
  draftUrl: string
  title: string
  bodyChars: number
  topics: string[]
  warnings: string[]
}

/**
 * 解析批次快照的话题标签原始串 → 话题列表：
 * 空白与中英文逗号/顿号/分号分隔，剥掉首尾 #，去重去空（注入脚本以「#话题」追加在正文尾）。
 */
export function parseRedbookTopics(tags?: string): string[] {
  const raw = String(tags ?? '').trim()
  if (!raw) return []
  const seen = new Set<string>()
  const topics: string[] = []
  for (const part of raw.split(/[\s,，、;；]+/)) {
    const topic = part.replace(/^#+/, '').replace(/#+$/, '').trim()
    if (!topic || seen.has(topic)) continue
    seen.add(topic)
    topics.push(topic)
  }
  return topics
}

function failureDetail(message: string): string {
  return `注入未完成：${message}。`
}

/** 脚本失败码 → 三分类：未登录＝凭证类（停下引导登录）；其余（页面变化/防覆盖/填充失败）＝永久类。 */
function redbookOutcomeOf(result: { code?: string; message: string }): PublishRunOutcome {
  if (result.code === 'NOT_LOGGED_IN')
    return { ok: false, category: 'credential', code: 'NOT_LOGGED_IN', detail: failureDetail(result.message) }
  return {
    ok: false,
    category: 'permanent',
    ...(result.code ? { code: result.code } : {}),
    detail: failureDetail(result.message),
  }
}

export function createRedbookPublishAdapter(): PublishAdapter {
  return {
    platform: 'redbook',
    // 页面会话平台：编排层执行前先 openSession（可见挂载，供扫码与查看草稿）。
    usesSession: true,
    async run({ task, session }, ctx): Promise<PublishRunOutcome> {
      const payload = (task.payload ?? {}) as Partial<RedbookInjectPayload>
      if (payload.platform !== 'redbook')
        return { ok: false, category: 'permanent', detail: '发布任务暂只支持公众号草稿与小红书注入。' }
      const driver = session as RedbookDriver | null
      if (!driver)
        return {
          ok: false,
          category: 'permanent',
          code: 'SESSION_NOT_OPEN',
          detail: '小红书平台会话未打开，无法注入草稿。',
        }
      const title = String(payload.title ?? '').trim()
      const body = String(payload.body ?? '')
      if (!title) return { ok: false, category: 'permanent', detail: '缺少标题，无法注入小红书草稿。' }
      if (!body.trim()) return { ok: false, category: 'permanent', detail: '缺少正文，无法注入小红书草稿。' }
      const topics = parseRedbookTopics(payload.tags)
      try {
        if (ctx.signal.aborted) return { ok: false, category: 'permanent', detail: '已停止；本次未注入草稿。' }
        ctx.progress('正在检测小红书登录状态…')
        const login = await driver.evaluate({ kind: 'loginCheck' })
        if (!login.ok) {
          if (login.code === 'NOT_LOGGED_IN')
            return {
              ok: false,
              category: 'credential',
              code: 'NOT_LOGGED_IN',
              detail: '尚未登录小红书：请在发布准备页点「打开登录」，扫码完成后重试。',
            }
          return redbookOutcomeOf(login)
        }
        if (ctx.signal.aborted) return { ok: false, category: 'permanent', detail: '已停止；本次未注入草稿。' }
        ctx.progress('正在填写标题、正文与话题（只注入草稿，不点发布）…')
        const inject = await driver.evaluate({ kind: 'inject', title, body, topics })
        if (!inject.ok || inject.kind !== 'inject') {
          return inject.ok
            ? { ok: false, category: 'permanent', detail: failureDetail('注入结果异常，请重试。') }
            : redbookOutcomeOf(inject)
        }
        const result: RedbookInjectResult = {
          draftUrl: inject.draftUrl,
          title,
          bodyChars: Array.from(body).length,
          topics,
          warnings: [...inject.warnings],
        }
        // 回读核对：失败不推翻注入结论（注入脚本自身已校验前缀落位），只附说明。
        ctx.progress('正在回读草稿内容核对…')
        let readBackNote = ''
        try {
          const readBack = await driver.evaluate({ kind: 'readBack' })
          if (readBack.ok && readBack.kind === 'readBack') {
            result.title = readBack.title
            result.bodyChars = readBack.bodyChars
          } else {
            readBackNote = '（回读未成功，注入结果以填充校验为准）'
          }
        } catch {
          readBackNote = '（回读未成功，注入结果以填充校验为准）'
        }
        const notes = [...result.warnings.map((warning) => `（${warning}）`), readBackNote].join('')
        return {
          ok: true,
          detail: `已注入小红书草稿；不会自动点击发布，请在平台页检查后手动发布。${notes}`,
          result,
        }
      } catch (err) {
        // TIMEOUT 等抛出错误经 code 三分类（瞬态交编排层重试，其余如实上报）。
        return publishOutcomeFromError(err)
      }
    },
  }
}

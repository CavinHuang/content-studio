/**
 * 小红书「注入草稿」主进程执行器（kind 'publish' / executor 'main' / payload.platform 'redbook'）。
 * 人机边界：只把标题、正文与话题填进平台编辑器并停在草稿态，绝不点击发布；
 * 未登录/防覆盖/页面结构变化一律如实结算，绝不伪装成功。注入走任务系统，可停止、可重试。
 */
import type { TaskRecord } from '../../../shared/desktop'
import type { MainExecutor } from '../../tasks/runner'
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

export function createRedbookInjectExecutor(driver: RedbookDriver): MainExecutor {
  return async (task: TaskRecord, ctx) => {
    const payload = (task.payload ?? {}) as Partial<RedbookInjectPayload>
    if (payload.platform !== 'redbook')
      return { state: 'failed', detail: '发布任务暂只支持公众号草稿与小红书注入。' }
    const title = String(payload.title ?? '').trim()
    const body = String(payload.body ?? '')
    if (!title) return { state: 'failed', detail: '缺少标题，无法注入小红书草稿。' }
    if (!body.trim()) return { state: 'failed', detail: '缺少正文，无法注入小红书草稿。' }
    const topics = parseRedbookTopics(payload.tags)
    try {
      ctx.progress('正在打开小红书平台页…')
      await driver.open(true)
      if (ctx.signal.aborted) return { state: 'failed', detail: '已停止；本次未注入草稿。' }
      ctx.progress('正在检测小红书登录状态…')
      const login = await driver.evaluate({ kind: 'loginCheck' })
      if (!login.ok) {
        if (login.code === 'NOT_LOGGED_IN')
          return {
            state: 'failed',
            detail: '尚未登录小红书：请在发布准备页点「打开登录」，扫码完成后重试。',
          }
        return { state: 'failed', detail: failureDetail(login.message) }
      }
      if (ctx.signal.aborted) return { state: 'failed', detail: '已停止；本次未注入草稿。' }
      ctx.progress('正在填写标题、正文与话题（只注入草稿，不点发布）…')
      const inject = await driver.evaluate({ kind: 'inject', title, body, topics })
      if (!inject.ok || inject.kind !== 'inject') {
        return {
          state: 'failed',
          detail: inject.ok ? failureDetail('注入结果异常，请重试。') : failureDetail(inject.message),
        }
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
        state: 'complete',
        detail: `已注入小红书草稿；不会自动点击发布，请在平台页检查后手动发布。${notes}`,
        result,
      }
    } catch (err) {
      return { state: 'failed', detail: err instanceof Error ? err.message : String(err) }
    }
  }
}

/**
 * 小红书发布域 IPC handlers：打开会话（openSession）、登录态（loginState）、
 * 「注入草稿」任务创建（kind 'publish' / executor 'main' / payload.platform 'redbook'）。
 * 人机边界：这里没有任何「发布」动作——注入只填草稿，发布由用户在平台手动完成。
 */
import type { RedbookDraftInput, RedbookDraftResult, RedbookSessionView } from '../../../shared/desktop'
import type { TaskRunner } from '../../tasks/runner'
import type { RedbookService } from './service'

export interface RedbookHandlerDeps {
  runner: TaskRunner
  service: RedbookService
}

export function buildRedbookHandlers(deps: RedbookHandlerDeps) {
  return {
    /** 打开平台页（可见，供扫码登录/查看草稿）并探测登录态。 */
    openSession(): Promise<RedbookSessionView> {
      return deps.service.openSession(true)
    },
    /** 登录态探测：会话未打开时以隐藏形态打开（零尺寸）。 */
    loginState(): Promise<RedbookSessionView> {
      return deps.service.loginState()
    },
    /** 注入草稿：只建任务（executor 'main'），由 inject-job 执行器驱动；缺字段如实拒绝。 */
    injectDraft(input: RedbookDraftInput): RedbookDraftResult {
      const title = String(input?.title ?? '').trim()
      const body = String(input?.body ?? '')
      if (!title) return { ok: false, code: 'BAD_INPUT', message: '缺少标题，无法注入小红书草稿。' }
      if (!body.trim()) return { ok: false, code: 'BAD_INPUT', message: '缺少正文，无法注入小红书草稿。' }
      const tags = String(input?.tags ?? '').trim()
      const task = deps.runner.submit({
        kind: 'publish',
        executor: 'main',
        title: '注入小红书草稿',
        detail: `正在把《${title}》注入小红书草稿…`,
        projectId: input.projectId || 'publish',
        payload: {
          platform: 'redbook' as const,
          title,
          body,
          ...(tags ? { tags } : {}),
          ...(input.batchId ? { batchId: input.batchId } : {}),
        },
      })
      return { ok: true, taskId: task.id, message: '已创建注入任务；进度与结果见任务中心。' }
    },
  }
}

export type RedbookHandlers = ReturnType<typeof buildRedbookHandlers>

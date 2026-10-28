import type {
  DiscoveryRefreshResult,
  DiscoverySnapshot,
  DiscoverySource,
  DiscoverySourceInput,
} from '../../shared/desktop'
import type { TaskRunner } from '../tasks/runner'
import type { DiscoveryStore } from './store'
import type { DiscoveryService } from './service'

/** 内置示例来源不可移除（演示保留策略的落点）；用户可停用。 */
const BUILTIN_DELETE_MESSAGE = '内置示例来源不可移除；可以停用它，已保存的内容仍会保留。'

export interface DiscoveryHandlerDeps {
  store: DiscoveryStore
  service: DiscoveryService
  runner: TaskRunner
}

export function buildDiscoveryHandlers(deps: DiscoveryHandlerDeps) {
  return {
    snapshot(): DiscoverySnapshot {
      return deps.service.snapshot()
    },
    sourceList(): DiscoverySource[] {
      return deps.service.snapshot().sources
    },
    sourceSave(input: DiscoverySourceInput): DiscoverySource {
      return deps.store.saveSource(input)
    },
    sourceDelete(id: string): { ok: boolean; message?: string } {
      const existing = deps.store.getSource(id)
      if (!existing) return { ok: false, message: '来源不存在。' }
      if (existing.builtin) return { ok: false, message: BUILTIN_DELETE_MESSAGE }
      deps.store.deleteSource(id)
      deps.service.emitAfterChange()
      return { ok: true }
    },
    async sourceRefresh(id: string): Promise<DiscoveryRefreshResult> {
      const existing = deps.store.getSource(id)
      if (!existing) return { ok: false, message: '来源不存在。' }
      const task = deps.runner.submit({
        kind: 'source',
        title: `刷新来源：${existing.name}`,
        detail: `正在获取「${existing.name}」…`,
        projectId: 'discovery',
        executor: 'main',
        payload: { sourceId: id },
      })
      return { ok: true, taskId: task.id }
    },
    async refreshAll(): Promise<DiscoveryRefreshResult> {
      const task = deps.runner.submit({
        kind: 'source',
        title: '刷新热点来源',
        detail: '正在刷新已启用的来源…',
        projectId: 'discovery',
        executor: 'main',
        payload: { all: true },
      })
      return { ok: true, taskId: task.id }
    },
  }
}

export type DiscoveryHandlers = ReturnType<typeof buildDiscoveryHandlers>

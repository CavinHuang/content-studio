import type {
  DiscoveryEvent,
  DiscoveryRefreshResult,
  DiscoverySnapshot,
  DiscoverySource,
  TaskRecord,
} from '../../shared/desktop'
import type { MainExecutor } from '../tasks/runner'
import { aggregateTopics } from './aggregate'
import { fetchSourceEntries, formatStamp } from './feed'
import { DEMO_FETCH_FAILURES, DEMO_SOURCES, demoFeedForSource } from '../../shared/discovery-demo'
import type { DiscoveryStore, UpsertEntry } from './store'

export interface DiscoveryServiceDeps {
  store: DiscoveryStore
  emit: (event: DiscoveryEvent) => void
  /** 测试注入；缺省走全局 fetch（全部网络请求都在主进程）。 */
  fetchImpl?: typeof fetch
  now?: () => Date
}

export type RefreshOutcome = { ok: boolean; message?: string; count: number }

/**
 * 热点域编排：内置示例来源注册（演示保留策略）+ 真实抓取 + 聚合快照。
 * 刷新一律经任务系统驱动（kind 'source' / executor 'main'），进度、停止与失败如实回传。
 */
export class DiscoveryService {
  private refreshing = false

  constructor(private readonly deps: DiscoveryServiceDeps) {}

  /** 幂等初始化：注册内置示例来源并落地演示缓存（冻结快照，不随墙钟漂移）。 */
  ensureSeeded(): void {
    const { store } = this.deps
    store.seedBuiltin(DEMO_SOURCES)
    for (const source of DEMO_SOURCES) {
      for (const entry of demoFeedForSource(source.id)) {
        store.upsertArticle(source.id, {
          id: entry.id,
          url: entry.url,
          title: entry.title,
          body: entry.body,
          bodyState: entry.bodyState,
          published: entry.published,
          collectedAt: entry.collectedAt,
          collectedDisplay: entry.collected,
          ...(entry.metric ? { metric: entry.metric } : {}),
          sortIndex: entry.sortIndex,
          group: entry.group,
        })
      }
    }
  }

  snapshot(): DiscoverySnapshot {
    const sources = this.deps.store.listSources()
    const byId = new Map(sources.map((source) => [source.id, { name: source.name, category: source.category }]))
    const nowIso = (this.deps.now ?? (() => new Date()))().toISOString()
    const lastSyncAt = sources
      .filter((source) => source.status === 'ready' && source.updated)
      .map((source) => source.updated)
      .sort()
      .at(-1) ?? ''
    return {
      sources,
      topics: aggregateTopics(this.deps.store.listArticles(), byId, nowIso),
      lastSyncAt,
    }
  }

  private emitSnapshot(): void {
    this.deps.emit({ type: 'snapshot', snapshot: this.snapshot() })
  }

  /** 存取层直接变更（保存/删除来源）后的快照外发。 */
  emitAfterChange(): void {
    this.emitSnapshot()
  }

  /** 刷新单个来源；失败保留旧缓存与原更新时间，不伪装成功。 */
  async refreshSource(id: string, signal?: AbortSignal): Promise<RefreshOutcome> {
    const { store } = this.deps
    const source = store.getSource(id)
    if (!source) return { ok: false, message: '来源不存在。', count: 0 }
    if (!source.url.trim()) return { ok: false, message: '该来源尚未配置地址，无法刷新。', count: 0 }
    try {
      const entries = await this.collectEntries(source, signal)
      const keepUrls = new Set<string>()
      for (const entry of entries) {
        keepUrls.add(entry.url)
        store.upsertArticle(source.id, entry)
      }
      store.pruneSource(source.id, keepUrls)
      store.setSourceStatus(source.id, 'ready', (this.deps.now ?? (() => new Date()))().toISOString())
      this.emitSnapshot()
      return { ok: true, count: entries.length }
    } catch (err) {
      // 获取失败：保留缓存与原更新时间（UX-SPEC §20.4），只标记状态
      store.setSourceStatus(source.id, 'failed', source.updated)
      this.emitSnapshot()
      return { ok: false, message: err instanceof Error ? err.message : String(err), count: 0 }
    }
  }

  private async collectEntries(source: DiscoverySource, signal?: AbortSignal): Promise<UpsertEntry[]> {
    if (source.builtin) {
      const failure = DEMO_FETCH_FAILURES[source.id]
      if (failure) throw new Error(failure)
      // 内置示例来源：确定性返回演示数据（时间与计数为冻结演示快照）
      return demoFeedForSource(source.id).map((entry) => ({
        id: entry.id,
        url: entry.url,
        title: entry.title,
        body: entry.body,
        bodyState: entry.bodyState,
        published: entry.published,
        collectedAt: entry.collectedAt,
        collectedDisplay: entry.collected,
        ...(entry.metric ? { metric: entry.metric } : {}),
        sortIndex: entry.sortIndex,
        group: entry.group,
      }))
    }
    const now = (this.deps.now ?? (() => new Date()))()
    const iso = now.toISOString()
    const fetched = await fetchSourceEntries(source, {
      ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
      signal,
    })
    return fetched.map((entry) => ({
      id: undefined,
      url: entry.url,
      title: entry.title,
      body: entry.body,
      bodyState: entry.bodyState,
      published: entry.published,
      collectedAt: iso,
      collectedDisplay: formatStamp(iso),
      ...(entry.metric ? { metric: entry.metric } : {}),
      sortIndex: 0,
      group: null,
    }))
  }

  /** 任务系统执行器（kind 'source' / executor 'main'）：进度按来源推进，停止经 AbortSignal。 */
  createTaskExecutor(): MainExecutor {
    return async (task: TaskRecord, ctx) => {
      if (this.refreshing) return { state: 'failed', detail: '已有来源刷新任务在运行，请等待完成后再试。' }
      this.refreshing = true
      try {
        const payload = (task.payload ?? {}) as {
          sourceId?: string
          sourceIds?: string[]
          scheduled?: boolean
        }
        const listed = this.deps.store.listSources()
        const targets = payload.sourceId
          ? [this.deps.store.getSource(payload.sourceId)].filter((s): s is DiscoverySource => Boolean(s))
          : payload.sourceIds?.length
            ? listed.filter(
                (source) =>
                  payload.sourceIds!.includes(source.id) && source.enabled && source.url.trim(),
              )
            : listed.filter((source) => source.enabled && source.url.trim())
        if (!targets.length) {
          // 定时批次目标在提交后全部被停用/删除：无事可做，不是失败，不伪装成刷新成功。
          if (payload.scheduled)
            return { state: 'complete', detail: '没有需要定时刷新的来源（已停用或移除）。', result: { updated: 0, failed: [] } }
          return { state: 'failed', detail: '没有可刷新的来源：请先启用并配置来源地址。' }
        }
        const failed: string[] = []
        let updated = 0
        for (const source of targets) {
          if (ctx.signal.aborted) return { state: 'failed', detail: '已停止，已完成来源的刷新结果保留。' }
          ctx.progress(`正在更新来源（${source.name}）…`)
          const outcome = await this.refreshSource(source.id, ctx.signal)
          if (outcome.ok) updated += 1
          else failed.push(source.name)
        }
        const result = { updated, failed }
        if (failed.length === targets.length)
          return { state: 'failed', detail: `全部来源刷新失败（${failed.join('、')}）；已保留旧缓存。`, result }
        return {
          state: 'complete',
          detail: failed.length
            ? `已更新 ${updated} 个来源；失败：${failed.join('、')}（已保留缓存）。`
            : `已更新 ${updated} 个来源。`,
          result,
        }
      } finally {
        this.refreshing = false
      }
    }
  }
}

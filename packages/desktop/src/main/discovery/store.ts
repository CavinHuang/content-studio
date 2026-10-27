import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { DiscoverySource, DiscoverySourceInput } from '../../shared/desktop'
import { normalizeUrl, urlKeyOf } from './url-key'

/** 聚合分组元数据（演示组携带完整话题快照；真实抓取恒为 null）。 */
export type ArticleGroup = {
  key: string
  title: string
  summary: string
  category: string
  tags: string[]
  image: string
  angles: string[]
  ageHours: number
  updated: string
} | null

export type UpsertEntry = {
  /** 条目稳定 id（演示组提供；真实条目按规范化键派生）。 */
  id?: string
  url: string
  title: string
  body: string
  bodyState: 'full' | 'summary' | 'link-only'
  published: string
  collectedAt: string
  collectedDisplay: string
  metric?: string
  sortIndex: number
  group?: ArticleGroup
}

export type StoredArticle = {
  id: string
  urlKey: string
  title: string
  url: string
  body: string
  bodyState: string
  published: string
  collectedAt: string
  collectedDisplay: string
  metrics: { sourceId: string; text: string }[]
  sourceIds: string[]
  sortIndex: number
  group: ArticleGroup
  updatedAt: string
}

type SourceRow = {
  id: string
  name: string
  type: string
  category: string
  enabled: number
  status: string
  updated: string
  url: string
  builtin: number
}

type ArticleRow = {
  id: string
  urlKey: string
  title: string
  url: string
  body: string
  bodyState: string
  published: string
  collectedAt: string
  collectedDisplay: string
  metricsJson: string
  sourceIdsJson: string
  sortIndex: number
  groupJson: string | null
  updatedAt: string
}

const SOURCE_COLUMNS = 'id, name, type, category, enabled, status, updated, url, builtin'

function toSource(row: SourceRow): DiscoverySource {
  const source: DiscoverySource = {
    id: row.id,
    name: row.name,
    type: row.type as DiscoverySource['type'],
    category: row.category,
    enabled: row.enabled === 1,
    status: row.status as DiscoverySource['status'],
    updated: row.updated,
    url: row.url,
  }
  if (row.builtin === 1) source.builtin = true
  return source
}

function toArticle(row: ArticleRow): StoredArticle {
  return {
    id: row.id,
    urlKey: row.urlKey,
    title: row.title,
    url: row.url,
    body: row.body,
    bodyState: row.bodyState,
    published: row.published,
    collectedAt: row.collectedAt,
    collectedDisplay: row.collectedDisplay,
    metrics: JSON.parse(row.metricsJson) as StoredArticle['metrics'],
    sourceIds: JSON.parse(row.sourceIdsJson) as string[],
    sortIndex: row.sortIndex,
    group: row.groupJson ? (JSON.parse(row.groupJson) as NonNullable<ArticleGroup>) : null,
    updatedAt: row.updatedAt,
  }
}

const BODY_RANK: Record<string, number> = { 'link-only': 0, summary: 1, full: 2 }

/** 来源与文章的归一化存取（v3 表）。合并只按规范化 URL，不跨源加总任何数值。 */
export class DiscoveryStore {
  constructor(private readonly db: DatabaseSync) {}

  listSources(): DiscoverySource[] {
    const rows = this.db.prepare(`SELECT ${SOURCE_COLUMNS} FROM discovery_sources ORDER BY createdAt, id`).all() as SourceRow[]
    return rows.map(toSource)
  }

  getSource(id: string): DiscoverySource | null {
    const row = this.db.prepare(`SELECT ${SOURCE_COLUMNS} FROM discovery_sources WHERE id = ?`).get(id) as
      | SourceRow
      | undefined
    return row ? toSource(row) : null
  }

  /** 内置示例来源注册：OR IGNORE，不覆盖用户改名/启停等改动；按传入顺序稳定排列。 */
  seedBuiltin(sources: DiscoverySource[]): void {
    const statement = this.db.prepare(
      `INSERT INTO discovery_sources (${SOURCE_COLUMNS}, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ` +
        'ON CONFLICT(id) DO NOTHING',
    )
    sources.forEach((source, index) => {
      statement.run(
        source.id,
        source.name,
        source.type,
        source.category,
        source.enabled ? 1 : 0,
        source.status,
        source.updated,
        source.url,
        source.builtin ? 1 : 0,
        `0:${String(index).padStart(4, '0')}`,
      )
    })
  }

  saveSource(input: DiscoverySourceInput): DiscoverySource {
    const name = input.name.trim()
    if (!name) throw new Error('来源名称不能为空。')
    const url = input.url.trim()
    if (url && !/^https?:\/\//i.test(url)) throw new Error('来源地址必须以 http:// 或 https:// 开头。')
    const existing = input.id ? this.getSource(input.id) : null
    const id = existing?.id ?? randomUUID()
    // 状态推演：无地址 → 未配置；地址未变 → 保留原状态；地址已变 → 从未抓取过，回到未配置。
    const status = !url ? 'unconfigured' : existing && existing.url === url ? existing.status : 'unconfigured'
    this.db
      .prepare(
        `INSERT INTO discovery_sources (${SOURCE_COLUMNS}, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ` +
          'ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, category = excluded.category, ' +
          'enabled = excluded.enabled, url = excluded.url, status = excluded.status',
      )
      .run(
        id,
        name,
        input.type,
        input.category,
        input.enabled ? 1 : 0,
        status,
        existing?.updated ?? '',
        url,
        existing?.builtin ? 1 : 0,
        existing ? `0:${id}` : `1:${id}`,
      )
    return this.getSource(id)!
  }

  deleteSource(id: string): boolean {
    const existing = this.getSource(id)
    if (!existing) return false
    for (const article of this.listArticles()) {
      if (!article.sourceIds.includes(id)) continue
      this.removeSourceFromArticle(article, id)
    }
    this.db.prepare('DELETE FROM discovery_sources WHERE id = ?').run(id)
    return true
  }

  setSourceStatus(id: string, status: DiscoverySource['status'], updated: string): void {
    this.db
      .prepare('UPDATE discovery_sources SET status = ?, updated = ? WHERE id = ?')
      .run(status, updated, id)
  }

  listArticles(): StoredArticle[] {
    const rows = this.db
      .prepare(
        'SELECT id, urlKey, title, url, body, bodyState, published, collectedAt, collectedDisplay, ' +
          'metricsJson, sourceIdsJson, sortIndex, groupJson, updatedAt FROM discovery_articles',
      )
      .all() as ArticleRow[]
    return rows.map(toArticle)
  }

  /** 收录合并：同一规范化 URL 多源收录时 sourceIds 追加、metric 分别保留、正文按质量升级。 */
  upsertArticle(sourceId: string, entry: UpsertEntry): void {
    const key = urlKeyOf(entry.url)
    if (!key) return // 无规范化键的条目无法归一化，跳过（抓取层已过滤，这里兜底）
    const now = new Date().toISOString()
    const row = this.db.prepare('SELECT * FROM discovery_articles WHERE urlKey = ?').get(key) as
      | ArticleRow
      | undefined
    if (!row) {
      this.db
        .prepare(
          'INSERT INTO discovery_articles (id, urlKey, title, url, body, bodyState, published, collectedAt, ' +
            'collectedDisplay, metricsJson, sourceIdsJson, sortIndex, groupJson, updatedAt) ' +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(urlKey) DO NOTHING",
        )
        .run(
          entry.id ?? key,
          key,
          entry.title,
          entry.url,
          entry.body,
          entry.bodyState,
          entry.published,
          entry.collectedAt,
          entry.collectedDisplay,
          JSON.stringify(entry.metric ? [{ sourceId, text: entry.metric }] : []),
          JSON.stringify([sourceId]),
          entry.sortIndex,
          entry.group ? JSON.stringify(entry.group) : null,
          now,
        )
      return
    }
    const article = toArticle(row)
    const sourceIds = article.sourceIds.includes(sourceId) ? article.sourceIds : [...article.sourceIds, sourceId]
    const metrics = article.metrics.filter((item) => item.sourceId !== sourceId)
    if (entry.metric) metrics.push({ sourceId, text: entry.metric })
    const bodyUpgrade = (BODY_RANK[entry.bodyState] ?? 0) > (BODY_RANK[article.bodyState] ?? 0)
    this.db
      .prepare(
        'UPDATE discovery_articles SET title = ?, body = ?, bodyState = ?, published = ?, metricsJson = ?, ' +
          'sourceIdsJson = ?, sortIndex = ?, groupJson = ?, updatedAt = ? WHERE urlKey = ?',
      )
      .run(
        entry.title || article.title,
        bodyUpgrade ? entry.body : article.body,
        bodyUpgrade ? entry.bodyState : article.bodyState,
        entry.published || article.published,
        JSON.stringify(metrics),
        JSON.stringify(sourceIds),
        Math.max(article.sortIndex, entry.sortIndex),
        article.group ? JSON.stringify(article.group) : entry.group ? JSON.stringify(entry.group) : null,
        now,
        key,
      )
  }

  /** 刷新修剪：该来源本轮未再提供的条目移除其收录；无任何来源收录的条目删除。 */
  pruneSource(sourceId: string, keepUrls: Set<string>): number {
    const keepKeys = new Set(
      [...keepUrls].map((url) => urlKeyOf(url)).filter((key): key is string => key !== null),
    )
    let removed = 0
    for (const article of this.listArticles()) {
      if (!article.sourceIds.includes(sourceId)) continue
      if (keepKeys.has(article.urlKey)) continue
      this.removeSourceFromArticle(article, sourceId)
      removed += 1
    }
    return removed
  }

  private removeSourceFromArticle(article: StoredArticle, sourceId: string): void {
    const sourceIds = article.sourceIds.filter((id) => id !== sourceId)
    if (!sourceIds.length) {
      this.db.prepare('DELETE FROM discovery_articles WHERE urlKey = ?').run(article.urlKey)
      return
    }
    this.db
      .prepare('UPDATE discovery_articles SET sourceIdsJson = ?, metricsJson = ?, updatedAt = ? WHERE urlKey = ?')
      .run(
        JSON.stringify(sourceIds),
        JSON.stringify(article.metrics.filter((item) => item.sourceId !== sourceId)),
        new Date().toISOString(),
        article.urlKey,
      )
  }
}

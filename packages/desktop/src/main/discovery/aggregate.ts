import type { DiscoveryTopic } from '../../shared/desktop'
import type { StoredArticle } from './store'

/** 本地示意插画（与渲染端 images 键一致）：真实来源按 urlKey 稳定轮转。 */
const FALLBACK_IMAGES = ['room', 'notebook', 'city', 'garden']

function excerpt(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

function fallbackImage(article: StoredArticle): string {
  let hash = 0
  for (const char of article.urlKey) hash = (hash * 31 + char.charCodeAt(0)) % 997
  return FALLBACK_IMAGES[hash % FALLBACK_IMAGES.length]!
}

function ageHoursOf(iso: string, nowIso: string): number {
  const then = Date.parse(iso)
  const now = Date.parse(nowIso)
  if (Number.isNaN(then) || Number.isNaN(now)) return 0
  return Math.max(0, Math.round((now - then) / 3_600_000))
}

/**
 * 文章 → 话题聚合（§20.6）：
 * - 携带分组元数据的文章（内置示例来源）按 group.key 合成一个话题，字段取分组快照；
 * - 真实文章一文一话题（只按规范化 URL 去重合并，不做标题相似聚类，不虚构话题）；
 * - 排名/热度按来源分别保留在 metric 文案里，绝不跨源加总。
 */
export function aggregateTopics(
  articles: StoredArticle[],
  sources: Map<string, { name: string; category: string }>,
  nowIso: string,
): DiscoveryTopic[] {
  const groups = new Map<string, { topic: DiscoveryTopic; updated: string }>()
  for (const article of articles) {
    const group = article.group
    const articleView = {
      id: article.id,
      title: article.title,
      sourceIds: article.sourceIds,
      url: article.url,
      body: article.body,
      published: article.published,
      collected: article.collectedDisplay,
      ...(article.metrics.length
        ? { metric: article.metrics.map((item) => item.text).join('；') }
        : {}),
    }
    if (group) {
      const existing = groups.get(group.key)
      if (existing) {
        existing.topic.articles.push(articleView)
        continue
      }
      groups.set(group.key, {
        topic: {
          id: group.key,
          title: group.title,
          summary: group.summary,
          category: group.category,
          tags: group.tags,
          image: group.image,
          articles: [articleView],
          angles: group.angles,
          ageHours: group.ageHours,
          updated: group.updated,
        },
        updated: group.updated,
      })
      continue
    }
    const owner = sources.get(article.sourceIds[0] ?? '')
    groups.set(`t:${article.id}`, {
      topic: {
        id: `t_${article.id}`,
        title: article.title,
        summary: excerpt(article.body, 120),
        category: owner?.category ?? '综合',
        tags: [owner?.category ?? '综合'],
        image: fallbackImage(article),
        articles: [articleView],
        angles: [],
        ageHours: ageHoursOf(article.collectedAt, nowIso),
        updated: article.collectedAt,
      },
      updated: article.collectedAt,
    })
  }
  const topics = [...groups.values()]
  for (const entry of topics) {
    entry.topic.articles.sort((a, b) => {
      const left = articles.find((item) => item.id === a.id)
      const right = articles.find((item) => item.id === b.id)
      if (left && right && left.sortIndex !== right.sortIndex) return left.sortIndex - right.sortIndex
      return (right?.collectedAt ?? '').localeCompare(left?.collectedAt ?? '')
    })
  }
  return topics.sort((a, b) => b.updated.localeCompare(a.updated)).map((entry) => entry.topic)
}

import { expect, test } from 'vitest'
import { aggregateTopics } from '../../packages/desktop/src/main/discovery/aggregate'
import type { StoredArticle } from '../../packages/desktop/src/main/discovery/store'
import type { DiscoverySource } from '../../packages/desktop/src/shared/desktop'

const source = (id: string, category: string): DiscoverySource => ({
  id,
  name: `来源${id}`,
  type: 'RSS',
  category,
  enabled: true,
  status: 'ready',
  updated: '2026-10-25T01:00:00Z',
  url: 'https://example.com/feed',
})

const article = (over: Partial<StoredArticle> & { urlKey: string }): StoredArticle => ({
  id: 'a_x',
  title: '标题',
  url: 'https://example.com/a',
  body: '',
  bodyState: 'link-only',
  published: '10/25 08:00',
  collectedAt: '2026-10-25T01:00:00Z',
  collectedDisplay: '10/25 09:00',
  metrics: [],
  sourceIds: ['s1'],
  sortIndex: 0,
  group: null,
  updatedAt: '2026-10-25T01:00:00Z',
  ...over,
})

test('无分组的真实文章：一文一话题，领域取来源领域、角度留空、年龄按收录时间计算', () => {
  const topics = aggregateTopics(
    [article({ id: 'a_1', urlKey: 'k1', url: 'https://example.com/1', title: '真实条目' })],
    new Map([['s1', source('s1', 'AI 科技')]]),
    '2026-10-25T05:00:00Z',
  )
  expect(topics).toHaveLength(1)
  const topic = topics[0]!
  expect(topic).toMatchObject({
    id: 't_a_1',
    title: '真实条目',
    category: 'AI 科技',
    angles: [],
    ageHours: 4,
    updated: '2026-10-25T01:00:00Z',
  })
  expect(topic.articles).toHaveLength(1)
  expect(topic.image).toBeTruthy()
})

test('多源 metric 分别保留、不跨源加总：合并条目的指标按来源拼接展示', () => {
  const topics = aggregateTopics(
    [
      article({
        id: 'a_2',
        urlKey: 'k2',
        sourceIds: ['s1', 's2'],
        metrics: [
          { sourceId: 's1', text: '第 1 位' },
          { sourceId: 's2', text: '热度 4567' },
        ],
      }),
    ],
    new Map([
      ['s1', source('s1', '综合')],
      ['s2', source('s2', '综合')],
    ]),
    '2026-10-25T01:00:00Z',
  )
  expect(topics[0]!.articles[0]!.metric).toBe('第 1 位；热度 4567')
})

test('分组文章合成一个话题：字段取分组元数据，文章按 sortIndex 排序', () => {
  const group = {
    key: 'g1',
    title: '话题标题',
    summary: '话题摘要',
    category: '生活',
    tags: ['甲', '乙'],
    image: 'city',
    angles: ['角度一', '角度二'],
    ageHours: 3,
    updated: '2026-10-25T00:00:00Z',
  }
  const topics = aggregateTopics(
    [
      article({ id: 'a_3', urlKey: 'k3', sortIndex: 1, group, title: '第二篇' }),
      article({ id: 'a_4', urlKey: 'k4', sortIndex: 0, group, title: '第一篇' }),
      article({ id: 'a_5', urlKey: 'k5', sortIndex: 2, group, title: '第三篇' }),
    ],
    new Map([['s1', source('s1', '生活')]]),
    '2026-10-25T01:00:00Z',
  )
  expect(topics).toHaveLength(1)
  expect(topics[0]).toMatchObject({ id: 'g1', title: '话题标题', ageHours: 3, angles: ['角度一', '角度二'], image: 'city' })
  expect(topics[0]!.articles.map((a) => a.title)).toEqual(['第一篇', '第二篇', '第三篇'])
})

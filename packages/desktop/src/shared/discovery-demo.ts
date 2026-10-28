/**
 * 内置示例来源（演示保留策略）：演示 sources/topics 的唯一权威副本。
 * 主进程 discovery 模块以其注册内置示例来源并确定性“抓取”；
 * 渲染端 mock.ts 原样转出，保证未配置真实来源时热点页/来源页/e2e/capture
 * 内容与既有演示完全一致。类型为结构化定义，不依赖 UI 层类型。
 */

export type DemoSource = {
  id: string
  name: string
  type: '平台热榜' | '新闻资讯' | 'RSS' | '自定义来源'
  category: string
  enabled: boolean
  status: 'ready' | 'failed' | 'unconfigured' | 'stale'
  updated: string
  url: string
  builtin: boolean
}

export type DemoArticle = {
  id: string
  title: string
  sourceIds: string[]
  url: string
  body: string
  published: string
  collected: string
  metric?: string
}

export type DemoTopic = {
  id: string
  title: string
  summary: string
  category: string
  tags: string[]
  image: string
  articles: DemoArticle[]
  angles: string[]
  ageHours: number
  updated: string
}

export const DEMO_SOURCES: DemoSource[] = [
  {
    id: 'zhihu',
    name: '知乎热榜',
    type: '平台热榜',
    category: '综合',
    enabled: true,
    status: 'ready',
    updated: '2026-10-25T01:40:00Z',
    url: 'https://example.com/zhihu',
    builtin: true,
  },
  {
    id: 'sspai',
    name: '少数派',
    type: '新闻资讯',
    category: 'AI 科技',
    enabled: true,
    status: 'ready',
    updated: '2026-10-25T01:35:00Z',
    url: 'https://example.com/sspai',
    builtin: true,
  },
  {
    id: 'rss',
    name: '我的数字花园',
    type: 'RSS',
    category: '生活',
    enabled: true,
    status: 'ready',
    updated: '2026-10-25T01:30:00Z',
    url: 'https://example.com/garden.xml',
    builtin: true,
  },
  {
    id: 'redbook',
    name: '小红书话题',
    type: '平台热榜',
    category: '生活',
    enabled: true,
    status: 'failed',
    updated: '2026-10-24T06:00:00Z',
    url: 'https://example.com/redbook',
    builtin: true,
  },
  {
    id: 'news',
    name: '创作观察',
    type: '新闻资讯',
    category: '文化',
    enabled: false,
    status: 'stale',
    updated: '2026-10-23T08:00:00Z',
    url: 'https://example.com/news',
    builtin: true,
  },
  {
    id: 'custom',
    name: '我的自定义来源',
    type: '自定义来源',
    category: '综合',
    enabled: false,
    status: 'unconfigured',
    updated: '',
    url: '',
    builtin: true,
  },
]

export const DEMO_TOPICS: DemoTopic[] = [
  {
    id: 'ai-creation',
    title: 'AI 工具，能帮普通人持续创作吗？',
    summary: '工具越来越多，但从一个想法到一篇作品，仍然需要自己的判断。',
    category: 'AI 科技',
    tags: ['个人创作', '工具与方法', '创作习惯'],
    image: 'room',
    ageHours: 2,
    updated: '2026-10-25T00:30:00Z',
    angles: [
      '从「收集很多、输出很少」的困境，讨论 AI 应该帮创作者做什么。',
      '不追工具清单，整理一套从记录、形成观点到发布的创作方法。',
      '观点分析：当每个人都能生成内容，个人经验与判断为什么更重要？',
    ],
    articles: [
      {
        id: 'ai-1',
        title: '工具替我们省下的时间，去了哪里？',
        sourceIds: ['sspai', 'rss'],
        url: 'https://example.com/articles/creative-tools',
        body: '【演示原文】工具可以帮助整理记录、比较结构和发现遗漏。持续创作的关键，仍是创作者选择什么问题、作出什么判断。不同工具的价值应结合具体流程评估。',
        published: '10/25 08:30',
        collected: '10/25 09:35',
      },
      {
        id: 'ai-2',
        title: '如何在 AI 时代保留自己的表达？',
        sourceIds: ['zhihu'],
        url: 'https://example.com/articles/own-voice',
        body: '【演示原文】讨论者提出两种看法：一种强调效率，另一种担心表达趋同。两种观点都认为，直接发布未经审阅的生成内容并不能替代创作者的判断。',
        published: '10/25 07:50',
        collected: '10/25 09:40',
        metric: '热榜第 12 位（示例）',
      },
      {
        id: 'ai-3',
        title: '一人创作工作流，正在变轻',
        sourceIds: ['redbook'],
        url: 'https://example.com/articles/solo-creator',
        body: '',
        published: '10/25 08:10',
        collected: '10/24 14:00',
        metric: '话题讨论 · 已保留缓存',
      },
    ],
  },
  {
    id: 'paper-notes',
    title: '越来越多人，用纸质笔记找回专注',
    summary: '在数字记录之外，重新理解书写、留白和注意力。',
    category: '生活',
    tags: ['专注力', '生活方式', '数字与纸质'],
    image: 'notebook',
    ageHours: 5,
    updated: '2026-10-24T22:00:00Z',
    angles: [
      '不比较工具优劣，讨论什么样的记录方式能让思考继续。',
      '整理一个低负担的每周笔记回顾方法。',
      '从注意力出发，分析「写下来」和「存起来」的区别。',
    ],
    articles: [
      {
        id: 'paper-1',
        title: '在纸上重新建立思考的节奏',
        sourceIds: ['sspai'],
        url: 'https://example.com/articles/paper',
        body: '【演示原文】手写的速度让人有机会筛选信息。纸质和数字笔记可以互补：前者承载思考的过程，后者帮助检索和整理。',
        published: '10/25 06:00',
        collected: '10/25 09:35',
      },
      {
        id: 'paper-2',
        title: '我的每周回顾：少记录一点，多想一步',
        sourceIds: ['rss'],
        url: 'https://example.com/articles/review',
        body: '【演示原文】每周挑出三条仍想继续讨论的记录，为每条写下一个问题，再选一条整理成短文。',
        published: '10/24 22:00',
        collected: '10/25 09:30',
      },
    ],
  },
  {
    id: 'commute',
    title: '通勤时间，怎样变成自己的时间？',
    summary: '不必填满每一分钟，也可以为观察和思考留一个小角落。',
    category: '职场',
    tags: ['时间管理', '通勤生活', '轻量创作'],
    image: 'city',
    ageHours: 8,
    updated: '2026-10-24T21:30:00Z',
    angles: [
      '把通勤当成观察生活的窗口，给创作留下十分钟。',
      '从时间碎片到观点积累：设计一套可持续的轻创作流程。',
      '不把所有空闲都变成生产力，讨论休息和创作的边界。',
    ],
    articles: [
      {
        id: 'commute-1',
        title: '如何安排每天的通勤？',
        sourceIds: ['zhihu'],
        url: 'https://example.com/articles/commute',
        body: '【演示原文】有人听书，有人放空，也有人记录沿途观察。没有适合所有人的安排，重要的是让这段时间服务自己的需要。',
        published: '10/25 05:30',
        collected: '10/25 09:40',
        metric: '热榜第 28 位（示例）',
      },
      {
        id: 'commute-2',
        title: '碎片时间里的一点创造',
        sourceIds: ['rss'],
        url: 'https://example.com/articles/small-moments',
        body: '【演示原文】短时间适合收集和追问，连续时间适合搭建结构。把两种时间分开安排，可以减轻创作的负担。',
        published: '10/24 19:00',
        collected: '10/25 09:30',
      },
    ],
  },
  {
    id: 'small-work',
    title: '普通人的小作品，为什么值得被看见',
    summary: '从真实的问题开始，让表达成为人与人之间的连接。',
    category: '文化',
    tags: ['个人成长', '创作者故事', '内容价值'],
    image: 'garden',
    ageHours: 30,
    updated: '2026-10-24T00:00:00Z',
    angles: [
      '讨论「有用」之外，个人表达如何带来共鸣。',
      '为刚开始创作的人，整理一份不追逐数字的作品清单。',
      '从读者的一个具体问题出发，找到一篇小作品的价值。',
    ],
    articles: [
      {
        id: 'work-1',
        title: '给创作者的一个小提醒',
        sourceIds: ['rss', 'news'],
        url: 'https://example.com/articles/small-work',
        body: '【演示原文】一份观察、一段方法、一个讲清楚的故事，都可能帮助某个具体的人。作品的价值不只来自浏览量。',
        published: '10/24 08:00',
        collected: '10/24 09:30',
      },
      {
        id: 'work-2',
        title: '从一个很小的问题开始',
        sourceIds: ['redbook'],
        url: 'https://example.com/articles/first-work',
        body: '',
        published: '10/24 09:00',
        collected: '10/24 14:00',
      },
    ],
  },
]

/** 内置示例来源的确定性失败：演示「获取失败 · 已保留缓存」状态，不伪装成功。 */
export const DEMO_FETCH_FAILURES: Record<string, string> = {
  redbook: '示例来源：该来源演示获取失败，已保留缓存。',
}

export type DemoFeedEntry = {
  /** 演示条目稳定 id（与 DEMO_TOPICS 文章 id 一致；收藏/选题快照依赖它）。 */
  id: string
  title: string
  url: string
  body: string
  bodyState: 'full' | 'summary' | 'link-only'
  published: string
  collected: string
  collectedAt: string
  metric?: string
  sortIndex: number
  group: {
    key: string
    title: string
    summary: string
    category: string
    tags: string[]
    image: string
    angles: string[]
    ageHours: number
    updated: string
  }
}

/** 演示时间戳（'MM/DD HH:mm'）→ 固定 ISO；演示快照固定为 2026 年、东八区。 */
function demoStampToIso(display: string): string {
  const match = /^(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/.exec(display.trim())
  if (!match) return '2026-10-25T01:40:00Z'
  const [, month, day, hour, minute] = match
  const utcHour = String(Number(hour) - 8).padStart(2, '0')
  return `2026-${month}-${day}T${utcHour}:${minute}:00Z`
}

/**
 * 从演示 topics 派生某来源的确定性 feed：同一 URL 的多源收录在聚合层合并。
 * 输出为冻结快照（时间与 ageHours 均为演示数据，不随墙钟漂移）。
 */
export function demoFeedForSource(sourceId: string): DemoFeedEntry[] {
  const entries: DemoFeedEntry[] = []
  for (const topic of DEMO_TOPICS) {
    let index = 0
    for (const article of topic.articles) {
      const order = index++
      if (!article.sourceIds.includes(sourceId)) continue
      entries.push({
        id: article.id,
        title: article.title,
        url: article.url,
        body: article.body,
        bodyState: article.body ? 'summary' : 'link-only',
        published: article.published,
        collected: article.collected,
        collectedAt: demoStampToIso(article.collected),
        ...(article.metric ? { metric: article.metric } : {}),
        sortIndex: order,
        group: {
          key: topic.id,
          title: topic.title,
          summary: topic.summary,
          category: topic.category,
          tags: [...topic.tags],
          image: topic.image,
          angles: [...topic.angles],
          ageHours: topic.ageHours,
          updated: topic.updated,
        },
      })
    }
  }
  return entries
}

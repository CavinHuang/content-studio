import {
  makeDraft,
  now,
  uid,
  type Brief,
  type Platform,
  type Project,
  type Source,
  type StudioState,
  type Topic,
  type Video,
} from './types'

export const SAMPLE_BODY = `> 创作不是等待灵感，而是给日常的念头，一个慢慢生长的地方。

## 一、先留住那些不起眼的念头

一次散步、一本书、一段对话，甚至是一闪而过的念头，都可能成为一篇内容的起点。灵感并不稀缺，稀缺的是我们愿意为它停留的片刻。

不必一开始就判断它有没有价值。先记下一句话、一个问题，或是一张让你多看了一眼的照片。那些看似零散的记录，日后会慢慢连成线。

## 二、从收集，走向自己的观点

有了素材之后，更重要的是形成自己的观点。把零散的想法放在一起，想清楚自己到底要说什么。

试着追问自己三个问题：这件事为什么让我在意？它和我已有的认识有什么不同？如果只向朋友解释一句话，我会怎么说？

记录是起点，表达还需要再向前一步。当你找到材料背后共同指向的问题，一篇作品的骨架也就慢慢浮现。

## 三、把作品写给一个具体的人

与其试图说服所有人，不如想象一个具体的读者。也许是和你一样刚刚开始创作的朋友，也许是被信息淹没、希望找回一点专注的同伴。

先写一个能够回答他的问题的段落，再补上例子、整理结构、删掉不必要的话。作品不需要一次就完整，修改本身就是思考的一部分。

## 四、让创作回到日常

每天留一点，周末写成一篇。让记录、整理和表达成为一个轻盈的循环，而不是一项让人疲惫的任务。

你不需要等到准备好一切才开始。今天记下的那个念头，也许就是下一篇作品的第一句话。`

export const sources: Source[] = [
  {
    id: 'zhihu',
    name: '知乎热榜',
    type: '平台热榜',
    category: '综合',
    enabled: true,
    status: 'ready',
    updated: '2026-10-25T01:40:00Z',
    url: 'https://example.com/zhihu',
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
  },
]
export const topics: Topic[] = [
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

export function makeBrief(title = ''): Brief {
  return {
    topic: title,
    point: '',
    audience: '希望找到自己创作节奏的个人创作者',
    tone: '真诚、具体，像和朋友聊天',
    length: '1000–1500 字，可按内容调整',
    outline: ['从一个具体问题开始', '提出核心观点与例子', '给出可实践的方法'],
    confirmed: false,
  }
}
export function generateBody(title: string, brief: Brief): string {
  return `> ${brief.point || '从一个具体的问题开始，让零散的想法慢慢成为自己的表达。'}\n\n${brief.outline.map((heading, index) => `## ${index + 1}. ${heading}\n\n${index === 0 ? `谈到「${title}」，我们很容易先寻找一个标准答案。但更值得问的是：它和自己的日常有什么关系？` : index === 1 ? '先观察具体的场景，再比较不同的解释。把收集到的信息与自己的判断分开，保留那些尚未得到回答的问题。' : '试着从一个小行动开始：记下一条观察，为它补充一个问题，然后用自己的话解释它。'}\n\n${index === 0 ? '这是一份可以继续修改的初稿。你可以在这里补上自己的经历或证据，让观点更具体。' : '不必一次完成所有内容，先把最想说清楚的部分写下来，再逐步补齐结构。'}`).join('\n\n')}\n\n每天留一点，慢慢做成一篇作品。`
}
export function platformContent(
  platform: Platform,
  title: string,
  body: string,
): { title: string; body: string; tags: string; question: string } {
  if (platform === 'redbook')
    return {
      title: `${title.replace(/[，。！？]/g, '').slice(0, 17)}｜我的创作笔记`,
      body: '一直想开始创作，却总觉得还没准备好？\n\n试着把创作拆成三个轻一点的动作：\n\n🌿 先记录：留下一个有意思的念头，不急着判断。\n📖 再整理：找到记录背后真正想讨论的问题。\n✍️ 最后表达：先写给一个具体的人，再慢慢修改。\n\n不用每天交一份漂亮答卷。每天留一点，周末写成一篇，就很好。\n\n你最近记下的一个小念头是什么？',
      tags: '#个人创作 #创作习惯 #表达与记录',
      question: '',
    }
  if (platform === 'zhihu')
    return {
      title,
      question: '怎样从零散的记录中，形成自己的创作观点？',
      body: `我会把这个过程拆成「记录、追问、表达」三个阶段。\n\n${body}\n\n以上是一种可尝试的方法，而非适用于所有人的标准答案。`,
      tags: '个人创作，写作，思考方法',
    }
  if (platform === 'douyin')
    return {
      title: '每天留一点，慢慢做成作品',
      body: '【开场 · 0–6 秒】\n你有没有存了很多素材，却一直没写出一篇内容？\n\n【观点 · 6–18 秒】\n问题也许不是没有灵感，而是记录之后，还少了一步思考。\n\n【方法 · 18–36 秒】\n先记下一个念头，再问一句「为什么让我在意」，最后用自己的话讲给一个具体的人听。\n\n【结尾 · 36–45 秒】\n每天留一点，周末写成一篇。让创作，先回到日常。',
      tags: '#个人创作 #碎片时间',
      question: '',
    }
  if (platform === 'x')
    return {
      title,
      body: '1/4\n创作不是等待灵感，而是给日常的念头，一个慢慢生长的地方。\n\n---\n\n2/4\n先记录，再追问。\n这件事为什么让我在意？如果只解释一句话，我会怎么说？\n\n---\n\n3/4\n把作品写给一个具体的人。先回答他的问题，再补例子、改结构。\n\n---\n\n4/4\n每天留一点，周末写成一篇。今天记下的那个念头，也许就是下一篇作品的第一句话。',
      tags: '#创作 #Writing',
      question: '',
    }
  return { title, body, tags: '', question: '' }
}
export function makeVideo(mode: Video['mode'], title: string): Video {
  const shots = ['留住灵感', '形成观点', '开始表达'].map((name, i) => ({
    id: uid(),
    title: name,
    visual: [
      '窗边书桌，打开笔记本，温暖的晨光。',
      '用卡片整理三个关键词，纸张缓缓展开。',
      '把想法写成一篇作品，镜头停留在完成的文稿。',
    ][i]!,
    narration: [
      '灵感可能只是一闪而过的念头，先把它留下来。',
      '从零散的记录中，找到自己真正想讨论的问题。',
      '每天留一点，慢慢做成一篇作品。',
    ][i]!,
    subtitle: ['先留住灵感', '再形成自己的观点', '最后，把想法变成作品'][i]!,
    seconds: [6, 12, 8][i]!,
    start: [0, 6, 18][i]!,
    end: [6, 18, 26][i]!,
    image: ['room', 'notebook', 'garden'][i]!,
    voiceDirty: false,
  }))
  return {
    id: uid(),
    title: mode === 'code' ? '把碎片时间，变成作品' : '让创作回到日常 · 口播',
    mode,
    source: title || '新想法',
    ratio: '9:16',
    resolution: '1080 × 1920',
    fps: 30,
    music: '轻柔钢琴（示例）',
    voice: '自然叙述（Mock）',
    speed: '1.0',
    shots,
    brief:
      '米白背景、墨绿文字。开场提出一个问题，中间依次呈现「记录 → 整理 → 表达」，最后回到每天留一点的创作习惯。整体轻盈、自然，不使用夸张的转场。',
    adopted: 2,
    candidate: mode === 'code' ? 3 : undefined,
    selectedShot: shots[1]!.id,
    selectedScene: 1,
    confirmed: true,
    versions: [
      {
        number: 1,
        label: '初始视觉方案',
        title: mode === 'code' ? '让灵感成为作品' : '让创作回到日常 · 口播',
        color: '#34583b',
        interval: 0.9,
        sceneTitles: ['一个念头', '慢慢整理', '开始表达'],
        at: '2026-10-24T08:20:00Z',
        shots: mode === 'storyboard' ? structuredClone(shots) : undefined,
      },
      {
        number: 2,
        label: '采用 · 调整标题与结构',
        title: mode === 'code' ? '把碎片时间，变成作品' : '让创作回到日常 · 口播',
        color: '#34583b',
        interval: 0.8,
        sceneTitles: ['开场字卡', '三步方法', '结尾收束'],
        at: '2026-10-25T01:20:00Z',
        shots: mode === 'storyboard' ? structuredClone(shots) : undefined,
      },
      {
        number: 3,
        label: '候选 · 三个步骤依次出现',
        title: '把碎片时间，变成作品',
        color: '#ad623a',
        interval: 0.6,
        sceneTitles: ['开场字卡', '三步方法', '结尾收束'],
        at: '2026-10-25T01:30:00Z',
      },
    ].filter((version) => mode === 'code' || version.number <= 2),
  }
}
export function makeProject(title = ''): Project {
  const conversationId = uid()
  return {
    id: uid(),
    title,
    brief: makeBrief(title),
    drafts: { master: makeDraft(title) },
    activePlatform: 'master',
    activeTab: 'article',
    materialIds: [],
    videos: [],
    conversations: [{ id: conversationId, title: '新的创作对话', messages: [] }],
    activeConversation: conversationId,
    batches: [],
    updated: now(),
  }
}
export function seedState(): StudioState {
  const first = makeProject('让灵感成为作品')
  first.brief = {
    ...makeBrief(first.title),
    point: '创作不是等待灵感，而是通过记录、整理和表达，把日常变成自己的作品。',
    outline: ['先留住那些不起眼的念头', '从收集，走向自己的观点', '把作品写给一个具体的人', '让创作回到日常'],
    confirmed: true,
  }
  first.drafts.master = makeDraft(first.title, SAMPLE_BODY, '整理素材，生成母稿（示例）')
  for (const platform of ['wechat', 'redbook', 'zhihu', 'x'] as Platform[]) {
    const content = platformContent(platform, first.title, SAMPLE_BODY)
    first.drafts[platform] = {
      ...makeDraft(content.title, content.body, '从母稿适配（示例）'),
      ...content,
      sourceBody: SAMPLE_BODY,
      sourceVersion: 1,
    }
  }
  const original = '有了素材之后，更重要的是形成自己的观点。把零散的想法放在一起，想清楚自己到底要说什么。'
  first.conversations[0]!.title = '梳理观点与表达'
  first.conversations[0]!.messages = [
    {
      id: uid(),
      role: 'user',
      text: '把「形成观点」这段改得更自然一点，保留我的意思。',
      at: '2026-10-25T02:22:00Z',
    },
    {
      id: uid(),
      role: 'assistant',
      text: '我调整了句子的节奏，保留「从零散记录中形成自己的判断」这个核心观点。建议已放在文稿中，你可以先对照，再决定是否采用。',
      at: '2026-10-25T02:23:00Z',
      action: 'article',
      suggestion: {
        id: uid(),
        platform: 'master',
        original,
        replacement:
          '记录是起点，表达还需要再向前一步。把零散的念头放在一起，找到它们共同指向的问题，再说出你自己的判断。',
        baseBody: SAMPLE_BODY,
        status: 'pending',
      },
    },
  ]
  const secondThread = uid()
  first.conversations.push({
    id: secondThread,
    title: '封面与视觉方向',
    messages: [
      {
        id: uid(),
        role: 'assistant',
        text: '可以从温暖的书桌、手写笔记和留白出发，保持墨绿与米白的视觉方向。这里的配图是本地制作的示意插画。',
        at: '2026-10-25T01:10:00Z',
      },
    ],
  })
  first.materialIds = ['m1', 'm2', 'm3', 'm4']
  first.videos = [makeVideo('storyboard', first.title), makeVideo('code', first.title)]
  first.activeVideo = undefined
  const second = makeProject('把碎片时间，变成创作的起点')
  second.brief = {
    ...makeBrief(second.title),
    point: '让短时间承担观察和记录，把完整的时间留给整理与表达。',
    confirmed: false,
  }
  second.drafts.master = makeDraft(second.title, generateBody(second.title, second.brief))
  second.activeTab = 'plan'
  second.source = {
    topicId: 'commute',
    title: topics[2]!.title,
    angle: topics[2]!.angles[0]!,
    articleIds: ['commute-1', 'commute-2'],
    at: '2026-10-25T01:00:00Z',
  }
  const third = makeProject('我的阅读手记')
  third.brief = { ...makeBrief(third.title), point: '不追求读得更多，而是让一本书留下一个可以实践的想法。' }
  const discoveryId = uid()
  return {
    schema: 3,
    projects: [first, second, third],
    selectedProject: first.id,
    page: 'article',
    discoveryConversations: [
      {
        id: discoveryId,
        title: '发现下一次创作',
        messages: [
          {
            id: uid(),
            role: 'assistant',
            text: '热榜、新闻和你的订阅，可以放在一起找选题。同一个话题会聚合展示，但每条原文与观点差异都会保留。\n\n选一个话题，我们再一起找一个值得展开的角度。（话题与来源均为示例）',
            at: now(),
          },
        ],
      },
    ],
    activeDiscovery: discoveryId,
    materials: [
      {
        id: 'm1',
        title: '创作，从一个小念头开始',
        type: 'text',
        body: '不必一开始就知道要写什么。先记下让你在意的那一刻，再追问它为什么重要。\n\n记录是积累，回顾是把积累变成自己的认识。',
        url: '',
        tags: ['个人创作', '观点'],
        at: '2026-10-25T01:00:00Z',
      },
      {
        id: 'm2',
        title: '窗边的创作时光',
        type: 'image',
        body: '温暖的晨光、书桌与植物。适合作为写作与生活方式内容的视觉参考。',
        url: '',
        image: 'room',
        tags: ['配图', '创作日常'],
        at: '2026-10-24T08:00:00Z',
      },
      {
        id: 'm3',
        title: '每周回顾的三个问题',
        type: 'link',
        body: '【演示摘录】这周哪条记录仍让我在意？我能提出一个什么问题？如果写给朋友，我会怎么解释？',
        url: 'https://example.com/weekly-review',
        readState: 'ready',
        tags: ['方法', '阅读'],
        at: '2026-10-24T04:00:00Z',
      },
      {
        id: 'm4',
        title: '把想法写在纸上',
        type: 'image',
        body: '纸笔、咖啡与桌面，轻盈的记录方式。',
        url: '',
        image: 'notebook',
        tags: ['配图', '记录'],
        at: '2026-10-23T08:00:00Z',
      },
      {
        id: 'm5',
        title: '创作选题备忘',
        type: 'file',
        body: '1. 灵感和持续创作的关系\n2. 工具与自己的判断\n3. 记录为什么需要回顾',
        fileName: '创作选题备忘（示例）.txt',
        url: '',
        tags: ['选题'],
        at: '2026-10-23T03:00:00Z',
      },
      {
        id: 'm6',
        title: '沿途的城市',
        type: 'image',
        body: '透过车窗看到的城市。留一点时间给观察。',
        url: '',
        image: 'city',
        tags: ['配图', '通勤'],
        at: '2026-10-22T09:00:00Z',
      },
      {
        id: 'm7',
        title: '等待整理的一篇文章',
        type: 'link',
        body: '',
        url: 'https://example.com/reading-list',
        tags: ['待读'],
        readState: 'link-only',
        at: '2026-10-22T02:00:00Z',
      },
    ],
    sources: structuredClone(sources),
    bookmarks: ['paper-notes'],
    topicDrafts: {},
    hotspotFilters: {
      query: '',
      category: '综合',
      type: '全部类型',
      source: 'all',
      time: '24',
      sort: 'latest',
      saved: false,
    },
    tasks: [
      {
        id: 'task-failed',
        title: '观点动画 · 导出演练',
        detail: '模拟失败：配乐资源不可用。已采用版本 v2 和之前的预览都已保留。',
        projectId: first.id,
        state: 'failed',
        kind: 'export',
        at: '2026-10-25T01:40:00Z',
        videoId: first.videos[1]!.id,
        version: 2,
        snapshot: {
          ...structuredClone(first.videos[1]!),
          candidate: undefined,
          versions: first.videos[1]!.versions.filter((v) => v.number === 2),
        },
      },
      {
        id: 'task-complete',
        title: '母稿与平台版本',
        detail: '已准备公众号、小红书、知乎和 X 的示例版本。',
        projectId: first.id,
        state: 'complete',
        kind: 'agent',
        at: '2026-10-25T01:20:00Z',
      },
    ],
    preferences: {
      platforms: ['wechat', 'redbook'],
      language: '简体中文',
      tone: '真诚、自然，有自己的观点',
      ratio: '9:16',
      enterToSend: true,
      services: { text: '创作助手（Mock）', image: '视觉助手（Mock）', voice: '自然叙述（Mock）' },
      connection: { text: true, image: true, voice: true },
    },
    layout: { left: 256, right: 384 },
    seeded: true,
  }
}

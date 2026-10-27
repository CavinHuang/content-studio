export type Platform = 'master' | 'wechat' | 'redbook' | 'zhihu' | 'douyin' | 'x'
export type Artifact = 'plan' | 'article' | 'video' | 'materials'
export type Page = Artifact | 'library' | 'hotspots' | 'sources' | 'settings' | 'publish' | 'tasks'
export type Typography = {
  theme: 'forest' | 'ink' | 'sunset'
  font: 'serif' | 'sans'
  size: number
  lineHeight: number
  spacing: number
  padding: number
}
export type Version = { id: string; number: number; title: string; body: string; label: string; at: string }
export type Draft = {
  title: string
  body: string
  tags: string
  question: string
  typography: Typography
  versions: Version[]
  sourceBody?: string
  sourceVersion?: number
  updated: string
}
export type Brief = {
  topic: string
  point: string
  audience: string
  tone: string
  length: string
  outline: string[]
  confirmed: boolean
}
export type Suggestion = {
  id: string
  platform: Platform
  original: string
  replacement: string
  baseBody: string
  status: 'pending' | 'accepted' | 'rejected' | 'undone'
  resultBody?: string
}
export type Message = {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: string
  suggestion?: Suggestion
  action?: 'plan' | 'article' | 'video' | 'platforms'
  context?: CreationSnapshot
}
export type Conversation = { id: string; title: string; messages: Message[] }
export type Shot = {
  id: string
  title: string
  visual: string
  narration: string
  subtitle: string
  seconds: number
  start: number
  end: number
  image: string
  voiceDirty: boolean
}
export type VideoVersion = {
  number: number
  label: string
  title: string
  color: string
  interval: number
  sceneTitles: string[]
  at: string
  shots?: Shot[]
  settings?: {
    ratio: '9:16' | '16:9' | '1:1'
    resolution: string
    fps: number
    music: string
    voice: string
    speed: string
  }
}
export type Video = {
  id: string
  title: string
  mode: 'storyboard' | 'code'
  source: string
  ratio: '9:16' | '16:9' | '1:1'
  resolution: string
  fps: number
  music: string
  voice: string
  speed: string
  shots: Shot[]
  brief: string
  versions: VideoVersion[]
  adopted: number
  candidate?: number
  selectedShot: string
  selectedScene: number
  lastExport?: { version: number; at: string }
  confirmed: boolean
}
export type PublishItem = {
  platform: Platform
  snapshot: { title: string; body: string; tags: string; version: number }
  videoId?: string
  videoVersion?: number
  videoSnapshot?: Video
  status: 'preparing' | 'exported' | 'published'
  link: string
}
export type Batch = { id: string; at: string; items: PublishItem[] }
export type CreationSnapshot = {
  input: string
  title: string
  point: string
  tone: string
  language: string
  materials: Pick<Material, 'id' | 'title' | 'body' | 'url' | 'type'>[]
  plan?: Pick<Brief, 'topic' | 'audience' | 'length' | 'outline'>
}
export type CreationFlow = {
  mode?: 'guided' | 'manual'
  source?: 'input' | 'plan'
  input: string
  status: 'idle' | 'blocked' | 'running' | 'stopped' | 'failed' | 'ready' | 'candidate'
  message?: string
  runId?: string
  snapshot?: CreationSnapshot
  candidate?: { title: string; body: string; baseTitle: string; baseBody: string }
  applied?: { title: string; body: string; previousTitle: string; previousBody: string }
}
export type Project = {
  id: string
  title: string
  brief: Brief
  drafts: Partial<Record<Platform, Draft>>
  activePlatform: Platform
  activeTab: Artifact
  materialIds: string[]
  videos: Video[]
  activeVideo?: string
  conversations: Conversation[]
  activeConversation: string
  batches: Batch[]
  creation?: CreationFlow
  source?: { topicId: string; title: string; angle: string; articleIds: string[]; at: string }
  trashed?: boolean
  updated: string
}
export type Material = {
  id: string
  title: string
  type: 'text' | 'link' | 'image' | 'file'
  body: string
  url: string
  tags: string[]
  image?: string
  fileName?: string
  data?: string
  at: string
  readState?: 'ready' | 'link-only'
  trashed?: boolean
}
export type SourceType = '平台热榜' | '新闻资讯' | 'RSS' | '自定义来源'
export type Source = {
  id: string
  name: string
  type: SourceType
  category: string
  enabled: boolean
  status: 'ready' | 'failed' | 'unconfigured' | 'stale'
  updated: string
  url: string
}
export type SourceArticle = {
  id: string
  title: string
  sourceIds: string[]
  url: string
  body: string
  published: string
  collected: string
  metric?: string
}
export type Topic = {
  id: string
  title: string
  summary: string
  category: string
  tags: string[]
  image: string
  articles: SourceArticle[]
  angles: string[]
  ageHours: number
  updated: string
}
export type Task = {
  id: string
  title: string
  detail: string
  projectId: string
  state: 'queued' | 'running' | 'failed' | 'stopped' | 'complete'
  kind: 'agent' | 'export' | 'source' | 'creation'
  at: string
  version?: number
  videoId?: string
  snapshot?: Video
}
export type Preferences = {
  platforms: Platform[]
  language: string
  tone: string
  ratio: Video['ratio']
  enterToSend: boolean
  services: { text: string; image: string; voice: string }
  connection: Record<string, boolean>
}
export type StudioState = {
  schema: 2
  projects: Project[]
  selectedProject: string
  page: Page
  materials: Material[]
  sources: Source[]
  bookmarks: string[]
  discoveryConversations: Conversation[]
  activeDiscovery: string
  selectedTopic?: string
  topicDrafts: Record<string, { angle: string; articleIds: string[]; requirements: string }>
  hotspotFilters: {
    query: string
    category: string
    type: string
    source: string
    time: string
    sort: string
    saved: boolean
  }
  tasks: Task[]
  preferences: Preferences
  layout: { left: number; right: number }
  seeded: boolean
}
export const PLATFORMS: { id: Platform; name: string; short: string; color: string; description: string }[] =
  [
    { id: 'wechat', name: '公众号', short: '公', color: '#3a7650', description: '深度长文 · 富文本排版' },
    { id: 'redbook', name: '小红书', short: '红', color: '#c45c53', description: '图文笔记 · 标题与话题' },
    { id: 'zhihu', name: '知乎', short: '知', color: '#5480af', description: '问题回答 · 观点与论据' },
    { id: 'douyin', name: '抖音', short: '抖', color: '#504c50', description: '口播脚本 · 独立视频作品' },
    { id: 'x', name: 'X', short: '𝕏', color: '#3d4941', description: '简短表达 · 多段串文' },
  ]
export const platformName = (id: Platform) =>
  id === 'master' ? '母稿' : (PLATFORMS.find((p) => p.id === id)?.name ?? id)
export const now = () => new Date().toISOString()
export const uid = () => crypto.randomUUID()
export const dateLabel = (date: string) =>
  new Date(date).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
export const defaultTypography = (): Typography => ({
  theme: 'forest',
  font: 'sans',
  size: 16,
  lineHeight: 1.75,
  spacing: 16,
  padding: 24,
})
export function makeDraft(title: string, body = '', label = '创建文稿'): Draft {
  const at = now()
  return {
    title,
    body,
    tags: '',
    question: '',
    typography: defaultTypography(),
    updated: at,
    versions: [{ id: uid(), number: 1, title, body, label, at }],
  }
}
export function versioned(draft: Draft, patch: Partial<Draft>, label: string): Draft {
  const next = { ...draft, ...patch, updated: now() }
  // Capture unsnapshotted manual edits before applying an AI change or a restore.
  const latest = draft.versions.at(-1)
  const versions = [...draft.versions]
  if (latest && (latest.title !== draft.title || latest.body !== draft.body))
    versions.push({
      id: uid(),
      number: latest.number + 1,
      title: draft.title,
      body: draft.body,
      label: '手动修改',
      at: now(),
    })
  versions.push({
    id: uid(),
    number: (versions.at(-1)?.number ?? 0) + 1,
    title: next.title,
    body: next.body,
    label,
    at: now(),
  })
  return { ...next, versions }
}

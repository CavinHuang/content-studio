import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  BookOpen,
  Check,
  ChevronRight,
  Flame,
  Layers,
  Link2,
  ListFilter,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Settings2,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import {
  Badge,
  CheckOption,
  Empty,
  Field,
  Modal,
  PageTitle,
  SearchBox,
  SegmentedControl,
} from '../components/ui'
import { useStudio } from '../studio/store'
import { topics } from '../studio/mock'
import { images } from '../studio/images'
import {
  dateLabel,
  now,
  uid,
  type Source,
  type SourceArticle,
  type SourceType,
  type Topic,
} from '../studio/types'
const sourceIcon = (type: string) =>
  type === 'RSS' ? <Rss size={14} /> : type === '平台热榜' ? <Flame size={14} /> : <BookOpen size={14} />
const stateLabels = {
  ready: '可用 · 示例缓存',
  failed: '获取失败 · 保留缓存',
  unconfigured: '未配置',
  stale: '缓存过期',
}
export function HotspotsPage() {
  const { state, setState, navigate, project, createFromTopic, notify, task, reference } = useStudio()
  const [original, setOriginal] = useState<SourceArticle | null>(null)
  const [showRelated, setShowRelated] = useState<string | null>(null)
  const filters = state.hotspotFilters
  const selected = topics.find((t) => t.id === state.selectedTopic)
  const enabled = state.sources.filter((s) => s.enabled)
  function filter(patch: Partial<typeof filters>) {
    setState((s) => ({
      ...s,
      hotspotFilters: {
        ...s.hotspotFilters,
        ...patch,
      },
    }))
  }
  function bookmark(id: string) {
    setState((s) => ({
      ...s,
      bookmarks: s.bookmarks.includes(id) ? s.bookmarks.filter((x) => x !== id) : [...s.bookmarks, id],
    }))
  }
  function openTopic(topic: Topic) {
    setState((s) => ({
      ...s,
      selectedTopic: topic.id,
      topicDrafts: {
        ...s.topicDrafts,
        [topic.id]: s.topicDrafts[topic.id] ?? {
          angle: topic.angles[0]!,
          articleIds: topic.articles.map((a) => a.id),
          requirements: '',
        },
      },
    }))
  }
  const visible = topics
    .filter(
      (t) =>
        (!filters.saved || state.bookmarks.includes(t.id)) &&
        (filters.category === '综合' || t.category === filters.category) &&
        (filters.time === 'all' || t.ageHours <= Number(filters.time)) &&
        (!filters.query ||
          `${t.title}${t.summary}${t.tags.join('')}`.toLowerCase().includes(filters.query.toLowerCase())) &&
        t.articles.some((a) =>
          a.sourceIds.some(
            (id) =>
              (filters.source === 'all' || id === filters.source) &&
              (filters.type === '全部类型' || state.sources.find((s) => s.id === id)?.type === filters.type),
          ),
        ),
    )
    .sort((a, b) =>
      filters.sort === 'coverage'
        ? new Set(b.articles.flatMap((a) => a.sourceIds)).size -
          new Set(a.articles.flatMap((a) => a.sourceIds)).size
        : a.ageHours - b.ageHours,
    )
  function refresh() {
    task('刷新热点来源', '演示获取已启用来源；失败项保留旧缓存…', 'source')
    notify('正在演示刷新。话题均为示例，未请求实时榜单；失败来源保留缓存。')
  }
  return (
    <section className="workspace-page hotspot-page">
      {selected ? (
        <TopicDetail
          topic={selected}
          onBack={() =>
            setState((s) => ({
              ...s,
              selectedTopic: undefined,
            }))
          }
          onOriginal={setOriginal}
          onCreate={() => createFromTopic(selected)}
        />
      ) : (
        <>
          <PageTitle
            eyebrow="A GOOD STORY STARTS WITH CURIOSITY"
            title="从热点，找到你的表达。"
            description="汇集多个来源，再找到属于你的创作角度。"
            actions={
              <div className="discovery-header-actions">
                <Badge tone="orange">示例话题 · 非实时</Badge>
                <div className="discovery-actions">
                  <Button
                    className="button secondary"
                    onClick={() => navigate('sources')}
                    variant="outline"
                    size="default"
                  >
                    <Settings2 size={15} />
                    来源管理
                  </Button>
                  <Button
                    className={`button ${filters.saved ? 'peach-button' : 'secondary'}`}
                    onClick={() =>
                      filter({
                        saved: !filters.saved,
                      })
                    }
                    variant="outline"
                    size="default"
                  >
                    <Bookmark size={15} fill={filters.saved ? 'currentColor' : 'none'} />
                    收藏 {state.bookmarks.length}
                  </Button>
                  <Button
                    className="button secondary"
                    disabled={state.tasks.some((t) => t.kind === 'source' && t.state === 'running')}
                    onClick={refresh}
                    variant="outline"
                    size="default"
                  >
                    <RefreshCw size={15} />
                    刷新
                  </Button>
                </div>
              </div>
            }
          />
          {state.sources.some((s) => s.enabled && s.status === 'failed') && (
            <div className="source-warning">
              <TriangleAlert size={15} />
              <span>小红书话题更新失败，正在显示已有示例缓存。</span>
              <Button
                onClick={() => navigate('sources')}
                variant="ghost"
                size="default"
                className="h-auto justify-start whitespace-normal text-left"
              >
                查看来源
              </Button>
            </div>
          )}
          <SearchBox
            value={filters.query}
            onChange={(query) =>
              filter({
                query,
              })
            }
            placeholder="搜索热点、关键词，或一个你在意的问题…"
            label="搜索热点"
          />
          <div className="discovery-filters flex-wrap">
            <div className="category-tabs min-w-0 max-w-full basis-full md:basis-auto">
              <SegmentedControl
                label="热点分类"
                value={filters.category}
                onValueChange={(category) =>
                  filter({
                    category,
                  })
                }
                options={['综合', 'AI 科技', '职场', '生活', '文化'].map((category) => ({
                  value: category,
                  label: category,
                }))}
              />
            </div>
            <NativeSelect
              aria-label="具体来源"
              value={filters.source}
              onChange={(e) =>
                filter({
                  source: e.target.value,
                })
              }
            >
              <option value="all">全部来源</option>
              {state.sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="热点时间范围"
              value={filters.time}
              onChange={(e) =>
                filter({
                  time: e.target.value,
                })
              }
            >
              <option value="24">近 24 小时</option>
              <option value="72">近 3 天</option>
              <option value="all">全部时间</option>
            </NativeSelect>
          </div>
          <div className="source-type-row flex-wrap">
            <div className="filter-chips min-w-0 flex-1">
              {['全部类型', '平台热榜', '新闻资讯', 'RSS', '自定义来源'].map((type) => (
                <Button
                  aria-pressed={filters.type === type}
                  key={type}
                  onClick={() =>
                    filter({
                      type,
                    })
                  }
                  variant={filters.type === type ? 'secondary' : 'ghost'}
                  size="sm"
                >
                  {type === 'RSS' && <Rss size={13} />}
                  {type}
                </Button>
              ))}
            </div>
            <div className="shrink-0">
              <NativeSelect
                aria-label="热点排序"
                value={filters.sort}
                onChange={(e) =>
                  filter({
                    sort: e.target.value,
                  })
                }
              >
                <option value="latest">最新收录</option>
                <option value="coverage">来源覆盖</option>
              </NativeSelect>
            </div>
          </div>
          <div className="feed-summary">
            <span>{visible.length} 个聚合话题</span>
            <span>{enabled.length} 个来源已启用 · 示例日期 10 月 25 日</span>
          </div>
          <div className="topic-list">
            {visible.map((topic) => {
              const ids = [...new Set(topic.articles.flatMap((a) => a.sourceIds))]
              const related = state.projects.filter((p) => !p.trashed && p.source?.topicId === topic.id)
              return (
                <Card className="topic-card gap-3 p-3 flex-row" key={topic.id} role="article">
                  <Button
                    className="topic-image h-auto justify-start overflow-hidden p-0 whitespace-normal text-left"
                    onClick={() => openTopic(topic)}
                    aria-label={`查看热点：${topic.title}`}
                    variant="ghost"
                    size="default"
                  >
                    <img src={images[topic.image]} alt="本地制作的创作场景插画" />
                  </Button>
                  <div className="topic-content">
                    <div className="topic-category">
                      {topic.category}
                      <span>·</span>
                      示例收录 {dateLabel(topic.updated)}
                    </div>
                    <Button
                      className="topic-title h-auto justify-start p-0 text-left text-lg font-semibold whitespace-normal"
                      onClick={() => openTopic(topic)}
                      variant="ghost"
                      size="default"
                    >
                      {topic.title}
                    </Button>
                    <div className="topic-sources">
                      <Layers size={13} />
                      <span>
                        {ids.length} 个来源 · {topic.articles.length} 篇原文
                      </span>
                      {ids.slice(0, 2).map((id) => (
                        <span key={id} className="source-name">
                          {state.sources.find((s) => s.id === id)?.name}
                        </span>
                      ))}
                    </div>
                    <p>{topic.summary}</p>
                    <div className="tag-row">
                      {topic.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                    <div className="topic-card-footer">
                      {related.length > 0 ? (
                        <Button
                          className="text-button green-text text-primary"
                          onClick={() => setShowRelated(topic.id)}
                          variant="ghost"
                          size="sm"
                        >
                          已创作 {related.length} 篇<ChevronRight size={13} />
                        </Button>
                      ) : (
                        <span className="small-meta">选一个角度，慢慢展开</span>
                      )}
                      <div>
                        <Button
                          className={`icon-button ${state.bookmarks.includes(topic.id) ? 'bookmarked' : ''}`}
                          aria-label={`${state.bookmarks.includes(topic.id) ? '取消收藏' : '收藏'}热点：${topic.title}`}
                          onClick={() => bookmark(topic.id)}
                          variant="ghost"
                          size="icon"
                        >
                          <Bookmark
                            size={17}
                            fill={state.bookmarks.includes(topic.id) ? 'currentColor' : 'none'}
                          />
                        </Button>
                        <Button
                          className="button primary small"
                          onClick={() => openTopic(topic)}
                          variant="default"
                          size="sm"
                        >
                          查看与创作
                          <ArrowRight size={14} />
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
          {!visible.length && (
            <Empty
              title={filters.saved ? '还没有符合筛选的收藏' : '没有找到相关话题'}
              description="换个关键词，或放宽领域、来源与时间条件。"
            >
              <Button
                className="button secondary"
                onClick={() =>
                  filter({
                    query: '',
                    category: '综合',
                    type: '全部类型',
                    source: 'all',
                    time: 'all',
                    saved: false,
                  })
                }
                variant="outline"
                size="default"
              >
                清除筛选
              </Button>
            </Empty>
          )}
          <p className="feed-footnote">
            <Layers size={14} />
            同一话题汇总展示，排名和原文按来源分别保留。
            <Button
              className="text-button text-muted-foreground"
              onClick={() =>
                notify('「最新」按示例收录时间排序；「来源覆盖」按不同来源数量排序，不加总各平台热度。')
              }
              variant="ghost"
              size="sm"
            >
              排序依据
            </Button>
          </p>
        </>
      )}
      {original && (
        <Modal
          title="来源原文 · 示例快照"
          description="以下为本地演示内容，链接和标题不代表真实新闻。"
          onClose={() => setOriginal(null)}
        >
          <Badge tone={original.body ? 'green' : 'orange'}>
            {original.body ? '有原文片段' : '仅链接 · 未读取正文'}
          </Badge>
          <h3 className="original-title">{original.title}</h3>
          <div className="original-meta">
            <span>发布时间：{original.published}</span>
            <span>收录时间：{original.collected}</span>
          </div>
          <p className="source-url">{original.url}</p>
          <p className="source-body">
            {original.body || '暂时无法读取正文。你可以保留此链接，或在素材库中粘贴原文后再讨论。'}
          </p>
          <div className="button-row">
            <Button
              className="button secondary"
              onClick={() => {
                const material = {
                  id: uid(),
                  title: original.title,
                  type: 'link' as const,
                  body: original.body,
                  url: original.url,
                  tags: ['热点来源'],
                  at: now(),
                  readState: original.body ? ('ready' as const) : ('link-only' as const),
                }
                setState((s) =>
                  s.materials.some((m) => !m.trashed && m.url === original.url)
                    ? s
                    : {
                        ...s,
                        materials: [material, ...s.materials],
                      },
                )
                notify('已保存到全局素材库；同一链接不会重复添加。')
              }}
              variant="outline"
              size="default"
            >
              <Plus size={15} />
              保存为素材
            </Button>
            <Button
              className="button primary"
              onClick={() => {
                reference(original.title, original.body || original.url)
                setOriginal(null)
              }}
              variant="default"
              size="default"
            >
              引用到对话
            </Button>
          </div>
        </Modal>
      )}
      {showRelated && (
        <Modal title="这个热点下的创作" onClose={() => setShowRelated(null)}>
          {state.projects
            .filter((p) => p.source?.topicId === showRelated && !p.trashed)
            .map((p) => (
              <Button
                key={p.id}
                className="related-project h-auto justify-start whitespace-normal text-left"
                onClick={() => {
                  setState((s) => ({
                    ...s,
                    selectedProject: p.id,
                    page: p.activeTab,
                  }))
                  setShowRelated(null)
                }}
                variant="ghost"
                size="default"
              >
                <FileIcon />
                <span>{p.title}</span>
                <ArrowRight size={16} />
              </Button>
            ))}
        </Modal>
      )}
    </section>
  )
}
function FileIcon() {
  return <BookOpen size={19} />
}
function TopicDetail({
  topic,
  onBack,
  onOriginal,
  onCreate,
}: {
  topic: Topic
  onBack: () => void
  onOriginal: (a: SourceArticle) => void
  onCreate: () => void
}) {
  const { state, setState, reference } = useStudio()
  const draft = state.topicDrafts[topic.id] ?? {
    angle: topic.angles[0]!,
    articleIds: topic.articles.map((a) => a.id),
    requirements: '',
  }
  const [sourceFilter, setSourceFilter] = useState('all')
  function patch(value: Partial<typeof draft>) {
    setState((s) => ({
      ...s,
      topicDrafts: {
        ...s.topicDrafts,
        [topic.id]: {
          ...draft,
          ...value,
        },
      },
    }))
  }
  const allSources = [...new Set(topic.articles.flatMap((a) => a.sourceIds))]
  const chosen = topic.articles.filter((a) => draft.articleIds.includes(a.id))
  return (
    <>
      <Button
        className="text-button back-link text-muted-foreground"
        onClick={onBack}
        variant="ghost"
        size="sm"
      >
        <ArrowLeft size={15} />
        返回热点发现
      </Button>
      <div className="topic-detail-cover">
        <img src={images[topic.image]} alt="话题示意插画" />
        <div>
          <Badge tone="orange">示例话题 · {topic.category}</Badge>
          <h1>{topic.title}</h1>
          <p>{topic.summary}</p>
        </div>
      </div>
      <div className="section-heading">
        <h2>先看看，大家在讨论什么</h2>
        <span>
          {allSources.length} 个来源 · {topic.articles.length} 篇去重原文
        </span>
      </div>
      <div className="filter-chips source-detail-filter">
        <Button
          aria-pressed={sourceFilter === 'all'}
          onClick={() => setSourceFilter('all')}
          variant={sourceFilter === 'all' ? 'secondary' : 'ghost'}
          size="sm"
        >
          全部原文
        </Button>
        {allSources.map((id) => (
          <Button
            key={id}
            aria-pressed={sourceFilter === id}
            onClick={() => setSourceFilter(id)}
            variant={sourceFilter === id ? 'secondary' : 'ghost'}
            size="sm"
          >
            {state.sources.find((s) => s.id === id)?.name}
          </Button>
        ))}
      </div>
      <div className="topic-article-list">
        {topic.articles
          .filter((a) => sourceFilter === 'all' || a.sourceIds.includes(sourceFilter))
          .map((article) => (
            <div className="source-article" key={article.id}>
              <CheckOption
                checked={draft.articleIds.includes(article.id)}
                onChange={(checked) =>
                  patch({
                    articleIds: checked
                      ? [...draft.articleIds, article.id]
                      : draft.articleIds.filter((id) => id !== article.id),
                  })
                }
              >
                <span className="article-source-label">
                  {article.sourceIds.map((id) => state.sources.find((s) => s.id === id)?.name).join(' / ')}
                  {article.sourceIds.length > 1 && ' · 同一原文多源收录'}
                </span>
                <strong>{article.title}</strong>
                <span className="small-meta">
                  发布 {article.published} · 收录 {article.collected}
                  {article.metric && ` · ${article.metric}`}
                </span>
              </CheckOption>
              <Button
                className="text-button text-muted-foreground"
                onClick={() => onOriginal(article)}
                variant="ghost"
                size="sm"
              >
                {article.body ? '查看片段' : '仅链接'}
                <ArrowUpRight size={13} />
              </Button>
            </div>
          ))}
      </div>
      <div className="section-heading angle-heading">
        <h2>找到属于你的切入点</h2>
        <Badge tone="green">
          <Sparkles size={12} />
          Agent 提议 · 可修改
        </Badge>
      </div>
      <div className="angle-options">
        {topic.angles.map((angle, i) => (
          <Button
            key={angle}
            className={cn(
              'h-auto justify-start whitespace-normal text-left',
              draft.angle === angle && 'bg-[var(--selected-row)] hover:bg-[var(--selected-row)]',
            )}
            onClick={() =>
              patch({
                angle,
              })
            }
            variant="ghost"
            size="default"
          >
            <span>0{i + 1}</span>
            <p>{angle}</p>
            {draft.angle === angle && <Check size={17} />}
          </Button>
        ))}
      </div>
      <Field label="用你自己的话，再说得具体一点">
        <Textarea
          aria-label="创作切入点"
          value={draft.angle}
          rows={3}
          onChange={(e) =>
            patch({
              angle: e.target.value,
            })
          }
        />
      </Field>
      <Field label="补充要求（可选）">
        <Input
          value={draft.requirements}
          placeholder="例如：以方法整理为主，不替我虚构个人经历"
          onChange={(e) =>
            patch({
              requirements: e.target.value,
            })
          }
        />
      </Field>
      <div className="topic-create-footer">
        <p>
          <Layers size={15} />
          带入 {chosen.length} 篇原文，来自 {new Set(chosen.flatMap((a) => a.sourceIds)).size} 个来源
          {chosen.some((a) => !a.body) && ' · 包含仅链接来源'}
        </p>
        <div>
          <Button
            className="button secondary"
            onClick={() =>
              reference(
                `热点角度：${topic.title}`,
                `${draft.angle}\n来源：${chosen.map((a) => a.title).join('、')}`,
              )
            }
            variant="outline"
            size="default"
          >
            和 Agent 讨论
          </Button>
          <Button
            className="button primary"
            disabled={!draft.angle.trim() || !chosen.length}
            onClick={onCreate}
            variant="default"
            size="default"
          >
            用这个角度开始创作
            <ArrowRight size={16} />
          </Button>
        </div>
        <small>新建独立内容，先进入可编辑方案；不会覆盖已有稿件。</small>
      </div>
    </>
  )
}
export function SourcesPage() {
  const { state, setState, navigate, notify, task } = useStudio()
  const [type, setType] = useState('全部类型')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Source | null>(null)
  const [error, setError] = useState('')
  const busy = state.tasks.some((t) => t.kind === 'source' && t.state === 'running')
  const canSaveSource = !!editing?.name.trim() && !!editing?.url.trim()
  function refresh(source: Source) {
    task(`刷新 ${source.name}`, '演示更新此来源…', 'source', (s) => ({
      ...s,
      sources: s.sources.map((item) =>
        item.id === source.id
          ? {
              ...item,
              status: 'ready',
              updated: now(),
            }
          : item,
      ),
    }))
    notify('正在演示来源恢复；话题原文仍为本地示例内容。')
  }
  function save() {
    if (!editing?.name.trim() || !editing.url.trim()) {
      setError('请填写来源名称与 URL。')
      return
    }
    try {
      if (!['https:', 'http:'].includes(new URL(editing.url).protocol)) throw new Error()
    } catch {
      setError('请输入 http 或 https 开头的有效地址。')
      return
    }
    setState((s) => ({
      ...s,
      sources: s.sources.some((source) => source.id === editing.id)
        ? s.sources.map((source) =>
            source.id === editing.id
              ? {
                  ...editing,
                  status: 'unconfigured',
                }
              : source,
          )
        : [
            ...s.sources,
            {
              ...editing,
              status: 'unconfigured',
            },
          ],
    }))
    setEditing(null)
    notify('来源已保存。连接仍未配置，不会自动抓取数据。')
  }
  return (
    <section className="workspace-page sources-page">
      <PageTitle
        back={() => navigate('hotspots')}
        eyebrow="YOUR INFORMATION, YOUR PERSPECTIVE"
        title="热点来源"
        description="管理热榜、新闻与订阅。来源与最终发布平台，分别设置。"
        actions={
          <Button
            className="button primary"
            onClick={() => {
              setError('')
              setEditing({
                id: uid(),
                name: '',
                type: 'RSS',
                category: '综合',
                enabled: true,
                status: 'unconfigured',
                updated: '',
                url: '',
              })
            }}
            variant="default"
            size="default"
          >
            <Plus size={15} />
            添加来源
          </Button>
        }
      />
      <div className="source-stats">
        <div>
          <strong>{state.sources.filter((s) => s.enabled).length}</strong>
          <span>已启用</span>
        </div>
        <div>
          <strong>{state.sources.filter((s) => s.status === 'ready').length}</strong>
          <span>可用缓存</span>
        </div>
        <div>
          <strong>{state.sources.filter((s) => s.status === 'failed').length}</strong>
          <span>需要留意</span>
        </div>
        <Badge tone="orange">Mock · 来源管理</Badge>
      </div>
      <SearchBox value={query} onChange={setQuery} placeholder="搜索来源名称…" />
      <Tabs
        value={type}
        onValueChange={setType}
        className="mb-3 max-w-full overflow-x-auto overflow-y-hidden"
      >
        <TabsList aria-label="来源类型">
          {['全部类型', '平台热榜', '新闻资讯', 'RSS', '自定义来源'].map((item) => (
            <TabsTrigger key={item} value={item}>
              {item}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="sources-list">
        <div className="sources-table-heading" aria-hidden="true">
          <span>来源</span>
          <span>类型</span>
          <span>状态</span>
          <span>启用与管理</span>
        </div>
        {state.sources
          .filter((s) => (type === '全部类型' || s.type === type) && s.name.includes(query))
          .map((source) => (
            <div className="source-card gap-3 p-3 grid" key={source.id} role="article">
              <div className={`source-type-icon ${source.type === 'RSS' ? 'rss' : ''}`}>
                {sourceIcon(source.type)}
              </div>
              <div className="source-card-content">
                <div>
                  <h3>{source.name}</h3>
                </div>
                <p>
                  {source.category} ·{' '}
                  {source.updated ? `最近成功：${dateLabel(source.updated)}` : '还没有成功更新'}
                </p>
              </div>
              <Badge className="source-kind">{source.type}</Badge>
              <div className="source-state">
                <Badge
                  tone={
                    !source.enabled
                      ? 'neutral'
                      : source.status === 'failed'
                        ? 'red'
                        : source.status === 'ready'
                          ? 'green'
                          : 'orange'
                  }
                >
                  {!source.enabled ? '已停用 · 保留旧内容' : stateLabels[source.status]}
                </Badge>
              </div>
              <div className="source-card-controls">
                <Switch
                  checked={source.enabled}
                  aria-label={`启用${source.name}`}
                  onCheckedChange={() =>
                    setState((s) => ({
                      ...s,
                      sources: s.sources.map((item) =>
                        item.id === source.id
                          ? {
                              ...item,
                              enabled: !item.enabled,
                            }
                          : item,
                      ),
                    }))
                  }
                />
                <Button
                  className="text-button text-muted-foreground"
                  disabled={!source.enabled || busy || source.status === 'unconfigured'}
                  onClick={() => refresh(source)}
                  variant="ghost"
                  size="sm"
                >
                  {source.status === 'failed' ? '重试' : '刷新'}
                </Button>
                <Button
                  className="text-button text-muted-foreground"
                  onClick={() => {
                    setError('')
                    setEditing({
                      ...source,
                    })
                  }}
                  variant="ghost"
                  size="sm"
                >
                  设置
                </Button>
              </div>
            </div>
          ))}
      </div>
      {!state.sources.some((s) => (type === '全部类型' || s.type === type) && s.name.includes(query)) && (
        <Empty title="没有找到来源" description="试试其他分类或名称，也可以添加自己的订阅。" />
      )}
      <div className="inline-note">
        <Link2 size={15} />
        停用只停止后续获取，已保存的原文、引用和创作快照继续保留。
      </div>
      {editing && (
        <Modal
          title={state.sources.some((s) => s.id === editing.id) ? '来源设置' : '添加来源'}
          description="当前为演示配置界面，保存地址不会发起网络请求。"
          onClose={() => setEditing(null)}
          footer={
            <>
              {!canSaveSource && <span className="muted sm:mr-auto">还缺：来源名称与来源地址</span>}
              <Button
                className="button secondary"
                onClick={() => setEditing(null)}
                variant="outline"
                size="default"
              >
                取消
              </Button>
              <Button
                className="button primary"
                disabled={!canSaveSource}
                onClick={save}
                variant="default"
                size="default"
              >
                保存来源
              </Button>
            </>
          }
        >
          <Field label="来源名称">
            <Input
              value={editing.name}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  name: e.target.value,
                })
              }
            />
          </Field>
          <div className="form-grid">
            <Field label="来源类型">
              <NativeSelect
                value={editing.type}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    type: e.target.value as SourceType,
                  })
                }
              >
                {['平台热榜', '新闻资讯', 'RSS', '自定义来源'].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="关注领域">
              <NativeSelect
                value={editing.category}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    category: e.target.value,
                  })
                }
              >
                {['综合', 'AI 科技', '职场', '生活', '文化'].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field
            label={editing.type === 'RSS' ? 'RSS 地址' : '来源 URL'}
            hint={editing.type === 'RSS' ? '填写 RSS 或 Atom 订阅地址。' : undefined}
          >
            <Input
              type="url"
              placeholder="https://example.com/feed.xml"
              value={editing.url}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  url: e.target.value,
                })
              }
            />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <p className="muted">保存后显示「未配置」，后续接入实际来源服务后才会获取内容。</p>
        </Modal>
      )}
    </section>
  )
}

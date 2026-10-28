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
import { topicNewArticles } from '../studio/hotspot-followup'
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
  ready: '可用 · 缓存可用',
  failed: '获取失败 · 已保留缓存',
  unconfigured: '未配置 · 待接入',
  stale: '缓存过期',
  updating: '更新中…',
}
export function HotspotsPage() {
  const {
    state,
    setState,
    navigate,
    project,
    createFromTopic,
    notify,
    reference,
    refreshAllSources,
    angleBusy,
    suggestAngles,
    aiReady,
  } = useStudio()
  const [original, setOriginal] = useState<SourceArticle | null>(null)
  const [showRelated, setShowRelated] = useState<string | null>(null)
  const filters = state.hotspotFilters
  const topics = state.topics
  const selected = topics.find((t) => t.id === state.selectedTopic)
  const enabled = state.sources.filter((s) => s.enabled)
  // 仅内置示例来源在跑时保持演示徽标；接入真实来源后如实切换
  const demoOnly = enabled.length > 0 && enabled.every((s) => s.builtin)
  const failedEnabled = state.sources.filter((s) => s.enabled && s.status === 'failed')
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
          angle: topic.angles[0] ?? '',
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
    refreshAllSources()
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
            title="从热点，找到你的表达。"
            description="汇集多个来源，再找到属于你的创作角度。"
            actions={
              <div className="discovery-header-actions">
                {demoOnly && <Badge tone="orange">示例话题 · 非实时</Badge>}
                <div className="discovery-actions">
                  <Button onClick={() => navigate('sources')} variant="outline" size="default">
                    <Settings2 size={15} />
                    来源管理
                  </Button>
                  <Button
                    aria-pressed={filters.saved}
                    onClick={() =>
                      filter({
                        saved: !filters.saved,
                      })
                    }
                    variant={filters.saved ? 'secondary' : 'outline'}
                    size="default"
                  >
                    <Bookmark size={15} fill={filters.saved ? 'currentColor' : 'none'} />
                    收藏 {state.bookmarks.length}
                  </Button>
                  <Button
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
          {failedEnabled.length > 0 && (
            <div className="source-warning">
              <TriangleAlert size={15} />
              <span>{failedEnabled.map((s) => s.name).join('、')}获取失败 · 已保留缓存，正在显示已有内容。</span>
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
              <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
                排序：
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
              </label>
            </div>
          </div>
          <div className="feed-summary">
            <span>{visible.length} 个聚合话题</span>
            <span>
              {enabled.length} 个来源已启用 ·{' '}
              {state.discoverySyncAt ? `最近刷新 ${dateLabel(state.discoverySyncAt)}` : '尚未刷新'}
            </span>
          </div>
          <div className="topic-list">
            {visible.map((topic) => {
              const ids = [...new Set(topic.articles.flatMap((a) => a.sourceIds))]
              const related = state.projects.filter((p) => !p.trashed && p.source?.topicId === topic.id)
              return (
                <Card className="topic-card gap-3 p-3 flex-row" key={topic.id} role="article">
                  <Button
                    className="topic-image h-auto justify-start whitespace-normal text-left"
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
                      {demoOnly ? '示例收录' : '收录'} {dateLabel(topic.updated)}
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
                      {related.length > 0 && (
                        <Button
                          className="text-primary"
                          onClick={() => setShowRelated(topic.id)}
                          variant="ghost"
                          size="sm"
                        >
                          已创作 {related.length} 篇<ChevronRight size={13} />
                        </Button>
                      )}
                      <div>
                        <Button
                          aria-pressed={state.bookmarks.includes(topic.id)}
                          className={state.bookmarks.includes(topic.id) ? 'text-primary' : undefined}
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
                        <Button onClick={() => openTopic(topic)} variant="default" size="sm">
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
            <span>
              同一话题汇总展示，排名和原文按来源分别保留。排序依据：「最新收录」按示例收录时间排序，「来源覆盖」按不同来源数量排序，不加总各平台热度。
            </span>
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
  const {
    state,
    setState,
    reference,
    suggestAngles,
    angleBusy,
    aiReady,
    supplementTopicArticles,
    generateTopicOverview,
    overviewBusy,
  } = useStudio()
  const suggestions = state.topicAngleSuggestions[topic.id] ?? []
  const busy = Boolean(angleBusy[topic.id])
  const draft = state.topicDrafts[topic.id] ?? {
    angle: topic.angles[0] ?? '',
    articleIds: topic.articles.map((a) => a.id),
    requirements: '',
  }
  const [sourceFilter, setSourceFilter] = useState('all')
  // §20.4：按项目记录勾选的新文章（projectId → articleIds）
  const [updatePicks, setUpdatePicks] = useState<Record<string, string[]>>({})
  const updates = state.projects
    .filter((p) => !p.trashed && p.source?.topicId === topic.id)
    .map((project) => ({ project, fresh: topicNewArticles(topic, project) }))
    .filter((row) => row.fresh.length > 0)
  const overview = state.topicOverviews[topic.id]
  const overviewRunning = Boolean(overviewBusy[topic.id])
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
      <Button className=" back-link text-muted-foreground" onClick={onBack} variant="ghost" size="sm">
        <ArrowLeft size={15} />
        返回热点发现
      </Button>
      <div className="topic-detail-cover">
        <img src={images[topic.image]} alt="话题示意插画" />
        <div>
          <Badge tone="orange">热点话题 · {topic.category}</Badge>
          <h1>{topic.title}</h1>
          <p>{topic.summary}</p>
        </div>
      </div>
      {updates.length > 0 && (
        <section aria-label="热点后续变化" className="topic-update-panel">
          <div className="section-heading">
            <h2>热点有后续变化</h2>
            <span>补充新文章为素材，不静默改写旧稿</span>
          </div>
          {updates.map(({ project, fresh }) => {
            const picks = updatePicks[project.id] ?? []
            return (
              <div className="topic-update-project" key={project.id}>
                <p className="topic-update-lead">
                  「{project.title}」创建后，本热点有 {fresh.length} 篇新文章
                </p>
                <div className="topic-article-list">
                  {fresh.map((article) => (
                    <div className="source-article" key={article.id}>
                      <CheckOption
                        checked={picks.includes(article.id)}
                        onChange={(checked) =>
                          setUpdatePicks((current) => ({
                            ...current,
                            [project.id]: checked
                              ? [...(current[project.id] ?? []), article.id]
                              : (current[project.id] ?? []).filter((id) => id !== article.id),
                          }))
                        }
                      >
                        <strong>{article.title}</strong>
                        <span className="small-meta">
                          发布 {article.published} · 收录 {article.collected}
                          {article.body ? '' : ' · 仅链接，未读正文'}
                        </span>
                      </CheckOption>
                      <Button
                        className=" text-muted-foreground"
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
                <div className="topic-update-footer">
                  <small>保存为素材并引用到该项目；母稿正文不会被改动，改稿仍经修改建议采用。</small>
                  <Button
                    disabled={!picks.length}
                    onClick={() => {
                      supplementTopicArticles(topic.id, project.id, picks)
                      setUpdatePicks((current) => ({ ...current, [project.id]: [] }))
                    }}
                    variant="default"
                    size="sm"
                  >
                    补充所选（{picks.length}）
                  </Button>
                </div>
              </div>
            )
          })}
        </section>
      )}
      <div className="section-heading">
        <h2>先看看，大家在讨论什么</h2>
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {allSources.length} 个来源 · {topic.articles.length} 篇去重原文
          </span>
          {aiReady && (
            <Button
              disabled={overviewRunning}
              onClick={() => generateTopicOverview(topic)}
              variant="outline"
              size="sm"
            >
              <Sparkles size={13} />
              {overviewRunning ? '正在归纳…' : overview ? '重新归纳' : 'AI 概览'}
            </Button>
          )}
        </div>
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
      <div className={cn('topic-sources-layout', overview && 'has-overview')}>
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
                  className=" text-muted-foreground"
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
        {overview && (
          <aside aria-label="AI 概览，与原文分开" className="topic-overview">
            <div className="topic-overview-heading">
              <Badge tone="green">
                <Sparkles size={12} />
                AI 概览
              </Badge>
              <span className="small-meta">归纳于 {dateLabel(overview.at)}</span>
            </div>
            <p className="topic-overview-body">{overview.text}</p>
            <p className="topic-overview-note">AI 归纳，与原文分开；只依据所给来源正文，未读正文的来源不生成确定口吻摘要。</p>
          </aside>
        )}
      </div>
      <div className="section-heading angle-heading">
        <h2>找到属于你的切入点</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="green">
            <Sparkles size={12} />
            Agent 提议 · 可修改
          </Badge>
          <Button
            disabled={!aiReady || busy}
            onClick={() => suggestAngles(topic)}
            variant="outline"
            size="sm"
          >
            <Sparkles size={13} />
            {busy ? '正在生成角度…' : 'AI 建议角度'}
          </Button>
        </div>
      </div>
      {!aiReady && (
        <p className="feed-footnote" aria-live="polite">
          <span>尚未配置模型：可到「设置 → AI 服务」配置后用 AI 建议角度；也可以直接在下方手动输入。</span>
        </p>
      )}
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
        {suggestions.map((angle, i) => (
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
            <span>AI</span>
            <p>
              <Badge tone="green">建议 {i + 1} · 可改写</Badge>
              <span className="block">{angle}</span>
            </p>
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
/** 自动刷新间隔选项（分钟）；0 = 仅手动刷新（默认，演示路径不受影响）。 */
const REFRESH_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: '手动刷新' },
  { value: 15, label: '每 15 分钟' },
  { value: 30, label: '每 30 分钟' },
  { value: 60, label: '每小时' },
  { value: 180, label: '每 3 小时' },
  { value: 1440, label: '每天' },
]
function refreshLabel(minutes: number): string {
  return REFRESH_OPTIONS.find((option) => option.value === minutes)?.label ?? `每 ${minutes} 分钟`
}
export function SourcesPage() {
  const { state, navigate, notify, saveSource, deleteSource, refreshSource } = useStudio()
  const [type, setType] = useState('全部类型')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Source | null>(null)
  const [removing, setRemoving] = useState<Source | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = state.tasks.some((t) => t.kind === 'source' && t.state === 'running')
  const canSaveSource = !!editing?.name.trim() && !!editing.url.trim()
  const demoOnly = state.sources.length > 0 && state.sources.every((s) => s.builtin)
  function updatingOf(source: Source): boolean {
    return state.tasks.some((t) => {
      if (t.kind !== 'source' || t.state !== 'running') return false
      const payload = (t.payload ?? {}) as { sourceId?: string; sourceIds?: string[]; all?: boolean }
      return (
        payload.all === true ||
        payload.sourceId === source.id ||
        (payload.sourceIds ?? []).includes(source.id)
      )
    })
  }
  function refresh(source: Source) {
    refreshSource(source)
  }
  async function save() {
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
    setSaving(true)
    const ok = await saveSource({
      id: editing.id,
      name: editing.name,
      type: editing.type,
      category: editing.category,
      enabled: editing.enabled,
      url: editing.url,
      refreshMinutes: editing.refreshMinutes ?? 0,
    })
    setSaving(false)
    if (ok) setEditing(null)
  }
  return (
    <section className="workspace-page sources-page">
      <Button
        className=" back-link text-muted-foreground"
        onClick={() => navigate('hotspots')}
        variant="ghost"
        size="sm"
      >
        <ArrowLeft size={15} />
        返回热点发现
      </Button>
      <PageTitle
        title="热点来源"
        description="管理热榜、新闻与订阅。来源与最终发布平台，分别设置。"
        actions={
          <Button
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
                refreshMinutes: 0,
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
        <Badge tone="orange">{demoOnly ? '示例来源 · 演示数据' : '真实来源 · 已接入'}</Badge>
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
          .map((source) => {
            const updating = updatingOf(source)
            return (
            <div className="source-card gap-3 p-3 grid" key={source.id} role="article">
              <div className={`source-type-icon ${source.type === 'RSS' ? 'rss' : ''}`}>
                {sourceIcon(source.type)}
              </div>
              <div className="source-card-content">
                <div>
                  <h3>{source.name}</h3>
                </div>
                <p>
                  {source.category}
                  {source.refreshMinutes ? ` · ${refreshLabel(source.refreshMinutes)}` : ''} ·{' '}
                  {source.updated ? `最近成功：${dateLabel(source.updated)}` : '还没有成功更新'}
                </p>
              </div>
              <Badge className="source-kind">{source.type}</Badge>
              <div className="source-state">
                <Badge
                  className="whitespace-normal"
                  tone={
                    !source.enabled
                      ? 'neutral'
                      : updating
                        ? 'orange'
                        : source.status === 'failed'
                          ? 'red'
                          : source.status === 'ready'
                            ? 'green'
                            : 'orange'
                  }
                >
                  {!source.enabled ? '已停用 · 保留旧内容' : updating ? stateLabels.updating : stateLabels[source.status]}
                </Badge>
              </div>
              <div className="source-card-controls">
                <Switch
                  checked={source.enabled}
                  aria-label={`启用${source.name}`}
                  onCheckedChange={() =>
                    void saveSource({
                      id: source.id,
                      name: source.name,
                      type: source.type,
                      category: source.category,
                      enabled: !source.enabled,
                      url: source.url,
                    })
                  }
                />
                <Button
                  className=" text-muted-foreground"
                  disabled={!source.enabled || busy || updating || !source.url.trim()}
                  onClick={() => refresh(source)}
                  variant="ghost"
                  size="sm"
                >
                  {source.status === 'failed' ? '重试' : '刷新'}
                </Button>
                <Button
                  className=" text-muted-foreground"
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
                <Button
                  className=" text-muted-foreground"
                  onClick={() => setRemoving(source)}
                  variant="ghost"
                  size="sm"
                >
                  删除
                </Button>
              </div>
            </div>
            )
          })}
      </div>
      {!state.sources.some((s) => (type === '全部类型' || s.type === type) && s.name.includes(query)) && (
        <Empty title="没有找到来源" description="试试其他分类或名称，也可以添加自己的订阅。" />
      )}
      <div className="inline-note">
        <Link2 size={15} />
        停用只停止后续获取，已保存的原文、引用和创作快照继续保留。
      </div>
      {removing && (
        <Modal
          title="移除这个来源？"
          description="移除后不再获取它的更新；它贡献的原文缓存会一并清理，已创建内容的选题与来源快照不受影响。"
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button onClick={() => setRemoving(null)} variant="outline" size="default">
                取消
              </Button>
              <Button
                onClick={() => {
                  void deleteSource(removing.id)
                  setRemoving(null)
                }}
                variant="default"
                size="default"
              >
                确认移除
              </Button>
            </>
          }
        >
          <p className="text-muted-foreground">
            内置示例来源不可移除；如不再需要演示内容，可以停用它。
          </p>
        </Modal>
      )}
      {editing && (
        <Modal
          title={state.sources.some((s) => s.id === editing.id) ? '来源设置' : '添加来源'}
          description="地址以 http 或 https 开头；来源与发布平台分别配置。"
          onClose={() => setEditing(null)}
          footer={
            <>
              {!canSaveSource && (
                <span className="text-muted-foreground sm:mr-auto">还缺：来源名称与来源地址</span>
              )}
              <Button onClick={() => setEditing(null)} variant="outline" size="default">
                取消
              </Button>
              <Button disabled={!canSaveSource || saving} onClick={() => void save()} variant="default" size="default">
                {saving ? '正在保存…' : '保存来源'}
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
          <Field
            label="更新频率"
            hint={editing.refreshMinutes ? '应用打开时，由本机按计划自动发起刷新。' : undefined}
          >
            <NativeSelect
              value={String(editing.refreshMinutes ?? 0)}
              onChange={(e) =>
                setEditing({
                  ...editing,
                  refreshMinutes: Number(e.target.value),
                })
              }
            >
              {REFRESH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <p className="text-muted-foreground">
            保存后来源状态为「未配置 · 待接入」，首次刷新成功后转为可用；刷新由本机应用发起请求。
          </p>
        </Modal>
      )}
    </section>
  )
}

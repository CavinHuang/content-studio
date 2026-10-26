import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { NativeSelect } from '@/components/ui/native-select'
import { Button } from '@/components/ui/button'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  AlignLeft,
  Bold,
  Check,
  ChevronDown,
  Clock3,
  Eye,
  FileText,
  Heading2,
  History,
  Italic,
  List,
  MessageCircle,
  Paperclip,
  Plus,
  Quote,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  X,
  Download,
} from 'lucide-react'
import {
  Badge,
  CheckOption,
  download,
  Field,
  IconButton,
  Markdown,
  Modal,
  PlatformMark,
} from '../components/ui'
import { useStudio } from '../studio/store'
import {
  defaultTypography,
  makeDraft,
  platformName,
  PLATFORMS,
  type Draft,
  type Platform,
  type Typography,
  type Suggestion,
} from '../studio/types'
import { platformContent } from '../studio/mock'
import { images } from '../studio/images'
import { watchSuggestionReview } from '../studio/suggestion-review'
import { CreationFlow } from '../components/CreationFlow'
import { CreationComparison } from '../components/CreationComparison'
export function PlatformDialog() {
  const { project, platformsOpen, setPlatformsOpen, generatePlatforms } = useStudio()
  const [chosen, setChosen] = useState<Platform[]>([])
  useEffect(() => {
    if (platformsOpen) setChosen(PLATFORMS.filter((p) => !project.drafts[p.id]).map((p) => p.id))
  }, [platformsOpen, project.id])
  if (!platformsOpen) return null
  return (
    <Modal
      title="让同一个观点，有不同的表达"
      description="选择要创建的平台版本。每一版都能独立修改，已存在的版本会保留。"
      onClose={() => setPlatformsOpen(false)}
      footer={
        <>
          <span className="muted sm:mr-auto">已选 {chosen.length} 个平台 · 演示适配</span>
          <Button
            className="button secondary"
            onClick={() => setPlatformsOpen(false)}
            variant="outline"
            size="default"
          >
            取消
          </Button>
          <Button
            className="button primary"
            disabled={!chosen.length || !project.drafts.master?.body.trim()}
            onClick={() => generatePlatforms(chosen)}
            variant="default"
            size="default"
          >
            <Sparkles size={16} />
            创建所选版本
          </Button>
        </>
      }
    >
      <div className="section-heading">
        <span>独立版本，各自保存</span>
        <div className="button-row">
          <Button
            className="text-button text-muted-foreground"
            onClick={() => setChosen(PLATFORMS.filter((p) => !project.drafts[p.id]).map((p) => p.id))}
            variant="ghost"
            size="sm"
          >
            全选
          </Button>
          <Button
            className="text-button text-muted-foreground"
            onClick={() => setChosen([])}
            variant="ghost"
            size="sm"
          >
            清空
          </Button>
        </div>
      </div>
      <div className="platform-options">
        {PLATFORMS.map((item) => (
          <div className={`platform-option ${chosen.includes(item.id) ? 'chosen' : ''}`} key={item.id}>
            <PlatformMark platform={item.id} />
            <div>
              <strong>{item.name}</strong>
              <p>{item.description}</p>
            </div>
            <CheckOption
              disabled={!!project.drafts[item.id]}
              checked={chosen.includes(item.id) || !!project.drafts[item.id]}
              onChange={(value) =>
                setChosen((list) => (value ? [...list, item.id] : list.filter((p) => p !== item.id)))
              }
            >
              {project.drafts[item.id] ? '已创建' : '选择'}
            </CheckOption>
          </div>
        ))}
      </div>
      {!project.drafts.master?.body.trim() && (
        <div className="inline-alert orange">先在母稿写一些内容，再进行平台适配。</div>
      )}
    </Modal>
  )
}
export function ArticlePage() {
  const {
    state,
    project,
    patchProject,
    patchDraft,
    reference,
    resolveSuggestion,
    setPlatformsOpen,
    notify,
    saveState,
    retrySave,
    navigate,
    setCaptureOpen,
    stopCreation,
  } = useStudio()
  const platform = project.activePlatform
  const draft = project.drafts[platform] ?? project.drafts.master ?? makeDraft(project.title)
  const [preview, setPreview] = useState(!!draft.body)
  const [expandedSuggestions, setExpandedSuggestions] = useState<Set<string>>(new Set())
  useEffect(
    () =>
      watchSuggestionReview(project.id, platform, (id) => {
        setPreview(true)
        setExpandedSuggestions((current) => new Set(current).add(id))
        requestAnimationFrame(() =>
          document
            .getElementById(`suggestion-${id}`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
        )
      }),
    [project.id, platform],
  )
  const [typography, setTypography] = useState(false)
  const [history, setHistory] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState(draft.versions[0]?.id)
  const [selection, setSelection] = useState('')
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const starting =
    platform === 'master' && !!project.creation && !draft.body.trim() && project.creation.mode !== 'manual'
  const comparing = platform === 'master' && comparisonOpen && project.creation?.status === 'candidate'
  const documentScroll = useRef<HTMLDivElement>(null)
  const previousScroll = useRef(0)
  function openComparison() {
    previousScroll.current = documentScroll.current?.scrollTop ?? previousScroll.current
    setComparisonOpen(true)
  }
  function closeComparison() {
    setComparisonOpen(false)
    requestAnimationFrame(() => {
      if (documentScroll.current) documentScroll.current.scrollTop = previousScroll.current
    })
  }
  useEffect(() => {
    if (project.creation?.status === 'candidate')
      previousScroll.current = documentScroll.current?.scrollTop ?? previousScroll.current
    setComparisonOpen(project.creation?.status === 'candidate')
  }, [project.id, project.creation?.status, project.creation?.runId])
  const [candidate, setCandidate] = useState<{
    content: ReturnType<typeof platformContent>
    base: string
    master: string
    version: number
  } | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const lastProject = useRef(project.id)
  useEffect(() => {
    if (lastProject.current !== project.id) {
      setPreview(!!draft.body)
      lastProject.current = project.id
    }
    setSelection('')
    setTypography(false)
    setCandidate(null)
  }, [project.id, platform])
  const latest = draft.versions.at(-1)
  const parentChanged = platform !== 'master' && draft.sourceBody !== project.drafts.master?.body
  const suggestions = project.conversations
    .flatMap((c) => c.messages)
    .flatMap((m) =>
      m.suggestion &&
      m.suggestion.platform === platform &&
      m.suggestion.status !== 'rejected' &&
      m.suggestion.status !== 'undone'
        ? [m.suggestion]
        : [],
    )
  const selectedHistory = draft.versions.find((v) => v.id === selectedVersion) ?? latest
  const style = {
    '--article-size': `${draft.typography.size}px`,
    '--article-leading': draft.typography.lineHeight,
    '--article-spacing': `${draft.typography.spacing}px`,
    '--article-padding': `${draft.typography.padding}px`,
    '--article-font': draft.typography.font === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)',
  } as CSSProperties
  function format(before: string, after = '') {
    const input = bodyRef.current
    if (!input) {
      setPreview(false)
      return
    }
    const start = input.selectionStart,
      end = input.selectionEnd
    const body =
      draft.body.slice(0, start) +
      before +
      (draft.body.slice(start, end) || '文字') +
      after +
      draft.body.slice(end)
    patchDraft({
      body,
    })
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(start + before.length, end + before.length)
    })
  }
  function updateTypography(patch: Partial<Typography>) {
    patchDraft({
      typography: {
        ...draft.typography,
        ...patch,
      },
    })
  }
  function startCandidate() {
    const master = project.drafts.master!
    setCandidate({
      content: platformContent(platform, master.title, master.body),
      base: draft.body,
      master: master.body,
      version: master.versions.at(-1)?.number ?? 1,
    })
  }
  const renderSuggestion = (suggestion: Suggestion) => (
    <section
      className="suggestion-card"
      id={`suggestion-${suggestion.id}`}
      key={suggestion.id}
      aria-label="Agent 修改建议"
    >
      <Button
        className="suggestion-summary h-auto justify-start whitespace-normal text-left w-full justify-start"
        variant="ghost"
        size="default"
        aria-label="展开或收起修改建议"
        aria-expanded={expandedSuggestions.has(suggestion.id)}
        aria-controls={`suggestion-body-${suggestion.id}`}
        onClick={() =>
          setExpandedSuggestions((current) => {
            const next = new Set(current)
            if (next.has(suggestion.id)) next.delete(suggestion.id)
            else next.add(suggestion.id)
            return next
          })
        }
      >
        <Sparkles size={15} />
        <strong>1 处修改建议</strong>
        <Badge
          tone={
            suggestion.status === 'accepted' ? 'green' : draft.body !== suggestion.baseBody ? 'red' : 'orange'
          }
        >
          {suggestion.status === 'accepted'
            ? '已采用'
            : draft.body !== suggestion.baseBody
              ? '原文已变化 · 建议过期'
              : '待你确认'}
        </Badge>
        <ChevronDown size={15} className={expandedSuggestions.has(suggestion.id) ? 'expanded' : ''} />
      </Button>
      <div
        id={`suggestion-body-${suggestion.id}`}
        className="suggestion-body"
        hidden={!expandedSuggestions.has(suggestion.id)}
      >
        <span className="small-meta">范围：{platformName(platform)} · 所选段落 · 演示</span>
        <div className="diff-block original">
          <label>原文</label>
          <p>{suggestion.original}</p>
        </div>
        <div className="diff-block replacement">
          <label>建议</label>
          <p>{suggestion.replacement}</p>
        </div>
        <div className="button-row">
          {suggestion.status === 'pending' ? (
            <>
              <Button
                className="button primary"
                disabled={draft.body !== suggestion.baseBody}
                onClick={() => resolveSuggestion(suggestion.id, 'accept')}
                variant="default"
                size="default"
              >
                <Check size={15} />
                采用修改
              </Button>
              <Button
                className="button secondary"
                onClick={() => resolveSuggestion(suggestion.id, 'reject')}
                variant="outline"
                size="default"
              >
                保留原文
              </Button>
            </>
          ) : (
            <Button
              className="text-button text-muted-foreground"
              onClick={() => resolveSuggestion(suggestion.id, 'undo')}
              variant="ghost"
              size="sm"
            >
              <RotateCcw size={14} />
              撤销这次修改
            </Button>
          )}
        </div>
      </div>
    </section>
  )
  const viewSwitch = (
    <Tabs value={preview ? 'preview' : 'edit'} onValueChange={(value) => setPreview(value === 'preview')}>
      <TabsList className="editor-view-switch" aria-label="文稿视图">
        <TabsTrigger value="edit">编辑</TabsTrigger>
        <TabsTrigger value="preview">预览</TabsTrigger>
      </TabsList>
    </Tabs>
  )
  const blocks = draft.body.split(/\n\s*\n/)
  const suggestionAnchors = new Map(
    suggestions.map((suggestion) => [
      suggestion.id,
      blocks.findIndex((block) =>
        block.includes(suggestion.status === 'accepted' ? suggestion.replacement : suggestion.original),
      ),
    ]),
  )
  return (
    <Tabs
      className="gap-0"
      value={platform}
      onValueChange={(value) =>
        patchProject(project.id, (p) => ({
          ...p,
          activePlatform: value as Platform,
        }))
      }
      asChild
    >
      <div className="article-shell gap-0">
        {!starting && (
          <div className="document-toolbar">
            <TabsList className="platform-tabs hidden min-w-0 md:flex" aria-label="文稿平台">
              {(['master', ...PLATFORMS.map((p) => p.id)] as Platform[])
                .filter((id) => project.drafts[id])
                .map((id) => (
                  <TabsTrigger
                    key={id}
                    aria-label={platformName(id)}
                    className={cn(
                      'platform-tab data-[state=active]:bg-accent data-[state=active]:text-accent-foreground',
                      platform === id && 'active',
                    )}
                    value={id}
                  >
                    {platformName(id)}
                    {id !== 'master' && project.drafts[id]?.sourceBody !== project.drafts.master?.body && (
                      <i className="update-dot" title="母稿已更新" />
                    )}
                  </TabsTrigger>
                ))}
              <Button
                className="add-platform"
                aria-label="添加平台版本"
                onClick={() => setPlatformsOpen(true)}
                variant="ghost"
                size="icon-sm"
              >
                <Plus size={14} />
              </Button>
            </TabsList>
            <NativeSelect
              className="w-auto md:hidden"
              aria-label="当前文稿平台"
              value={platform}
              onChange={(e) => {
                if (e.target.value === 'add') {
                  setPlatformsOpen(true)
                  return
                }
                patchProject(project.id, (p) => ({ ...p, activePlatform: e.target.value as Platform }))
              }}
            >
              {(['master', ...PLATFORMS.map((p) => p.id)] as Platform[])
                .filter((id) => project.drafts[id])
                .map((id) => (
                  <option key={id} value={id}>
                    {platformName(id)}
                  </option>
                ))}
              <option value="add">＋ 新增平台版本…</option>
            </NativeSelect>
            {!comparing && viewSwitch}
            <div className="editor-control-actions">
              <Button
                variant="outline"
                size="sm"
                disabled={!draft.body.trim()}
                aria-label="导出当前文稿"
                onClick={() => {
                  download(
                    `${draft.title || '文稿'}-${platformName(platform)}.md`,
                    `# ${draft.title}\n\n${draft.body}`,
                  )
                  notify(`已导出当前${platformName(platform)}，未执行发布。`)
                }}
              >
                <Download size={15} />
                导出{platformName(platform)}
              </Button>
              <Popover
                open={typography}
                onOpenChange={(open) => {
                  setTypography(open)
                  if (open) setPreview(true)
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    className={cn(`text-button ${typography ? 'active' : ''}`, 'text-muted-foreground')}
                    variant="ghost"
                    size="sm"
                  >
                    <SlidersHorizontal size={15} />
                    排版
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="typography-popover" align="end" sideOffset={12}>
                  <div className="section-heading">
                    <h3>当前{platformName(platform)}排版</h3>
                    <IconButton icon={X} label="关闭排版" onClick={() => setTypography(false)} />
                  </div>
                  <div className="theme-options">
                    {(
                      [
                        {
                          id: 'forest',
                          name: '林间',
                          color: '#34583b',
                        },
                        {
                          id: 'ink',
                          name: '墨迹',
                          color: '#3c454a',
                        },
                        {
                          id: 'sunset',
                          name: '日落',
                          color: '#b46e45',
                        },
                      ] as const
                    ).map((theme) => (
                      <Button
                        className={cn(
                          draft.typography.theme === theme.id ? 'selected' : '',
                          'h-auto justify-start whitespace-normal text-left',
                        )}
                        key={theme.id}
                        onClick={() =>
                          updateTypography({
                            theme: theme.id,
                          })
                        }
                        variant="ghost"
                        size="default"
                      >
                        <i
                          style={{
                            background: theme.color,
                          }}
                        />
                        <span className="theme-sample" style={{ color: theme.color }}>
                          Aa
                        </span>
                        <span>{theme.name}</span>
                        {draft.typography.theme === theme.id && <Check size={13} />}
                      </Button>
                    ))}
                  </div>
                  <div className="typography-fields">
                    <Field label="字体">
                      <NativeSelect
                        value={draft.typography.font}
                        onChange={(e) =>
                          updateTypography({
                            font: e.target.value as Typography['font'],
                          })
                        }
                      >
                        <option value="serif">宋体 · 书卷气</option>
                        <option value="sans">黑体 · 清晰自然</option>
                      </NativeSelect>
                    </Field>
                    <Field label={`字号 ${draft.typography.size}px`}>
                      <Slider
                        aria-label="正文字号"
                        min={14}
                        max={22}
                        value={[draft.typography.size]}
                        onValueChange={(e) =>
                          updateTypography({
                            size: +e[0]!,
                          })
                        }
                      />
                    </Field>
                    <Field label={`行高 ${draft.typography.lineHeight}`}>
                      <Slider
                        aria-label="正文行高"
                        min={1.4}
                        max={2.4}
                        step={0.05}
                        value={[draft.typography.lineHeight]}
                        onValueChange={(e) =>
                          updateTypography({
                            lineHeight: +e[0]!,
                          })
                        }
                      />
                    </Field>
                    <Field label={`段间距 ${draft.typography.spacing}px`}>
                      <Slider
                        aria-label="段落间距"
                        min={8}
                        max={40}
                        value={[draft.typography.spacing]}
                        onValueChange={(e) =>
                          updateTypography({
                            spacing: +e[0]!,
                          })
                        }
                      />
                    </Field>
                    <Field label={`页边距 ${draft.typography.padding}px`}>
                      <Slider
                        aria-label="文稿页边距"
                        min={16}
                        max={64}
                        value={[draft.typography.padding]}
                        onValueChange={(e) =>
                          updateTypography({
                            padding: +e[0]!,
                          })
                        }
                      />
                    </Field>
                  </div>
                  <div className="popover-footer">
                    <Button
                      className="text-button text-muted-foreground"
                      onClick={() =>
                        patchDraft({
                          typography: defaultTypography(),
                        })
                      }
                      variant="ghost"
                      size="sm"
                    >
                      <RotateCcw size={14} />
                      恢复本版默认
                    </Button>
                    <Button
                      className="button primary small"
                      onClick={() => {
                        setTypography(false)
                        notify('排版已保存到当前平台版本。')
                      }}
                      variant="default"
                      size="sm"
                    >
                      完成
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              <IconButton
                icon={History}
                label="版本历史"
                onClick={() => {
                  setHistory(true)
                  setSelectedVersion(latest?.id)
                }}
              />
              <IconButton
                icon={Save}
                label="保存当前版本"
                onClick={() => {
                  patchDraft({}, '手动保存版本')
                  notify('已保存一个可恢复的版本快照。')
                }}
              />
            </div>
            {/* A4：动作按钮与保存状态之间加视觉分区，避免软盘被读成重复的保存指示（仅桌面档显示） */}
            <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border max-md:hidden" />
            {saveState === '保存失败' ? (
              <Button
                className="document-save save-error"
                variant="ghost"
                size="sm"
                onClick={retrySave}
                aria-label="保存失败，重试保存"
              >
                <Clock3 className="text-destructive" />
                保存失败 · 重试
              </Button>
            ) : preview ? (
              <span className="document-save" role="status" aria-label="只读预览">
                <Eye size={15} className="text-muted-foreground" />
                只读预览
              </span>
            ) : (
              <span className="document-save" role="status" aria-label="保存文稿状态">
                {saveState === '已保存' ? (
                  <Check size={15} className="text-success" />
                ) : (
                  <Clock3 size={15} className="text-muted-foreground" />
                )}
                {saveState}
              </span>
            )}
          </div>
        )}
        <TabsContent value={platform} className="article-platform-pane">
          {comparing ? (
            <CreationComparison onClose={closeComparison} />
          ) : (
            <>
              {platform === 'master' && project.creation && !starting && (
                <CreationFlow variant="toolbar" onCompare={openComparison} />
              )}
              {platform !== 'master' && (
                <div className="platform-draft-summary">
                  <div>
                    <PlatformMark platform={platform} />
                    <strong>
                      {platformName(platform)} ·{' '}
                      {PLATFORMS.find((item) => item.id === platform)?.description.split(' · ')[0]}
                    </strong>
                    <Badge>
                      {latest && (draft.body !== latest.body || draft.title !== latest.title)
                        ? '有手动修改'
                        : '独立版本'}
                    </Badge>
                  </div>
                  <div>
                    <span>基于母稿 v{draft.sourceVersion ?? 1} · 仅修改当前平台</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-button text-muted-foreground"
                      onClick={() => patchProject(project.id, (p) => ({ ...p, activePlatform: 'master' }))}
                    >
                      查看母稿 <ChevronDown size={13} />
                    </Button>
                  </div>
                </div>
              )}
              {parentChanged && (
                <div className="source-update">
                  <span>母稿有更新，当前{platformName(platform)}版本保持独立。</span>
                  <Button
                    className="text-button text-muted-foreground"
                    onClick={startCandidate}
                    variant="ghost"
                    size="sm"
                  >
                    预览重新适配
                    <Sparkles size={13} />
                  </Button>
                </div>
              )}

              {!preview && !starting && (
                <div className="format-toolbar" aria-label="Markdown 格式">
                  <IconButton icon={Heading2} label="二级标题" onClick={() => format('## ')} />
                  <IconButton icon={Bold} label="加粗" onClick={() => format('**', '**')} />
                  <IconButton icon={Italic} label="强调" onClick={() => format('*', '*')} />
                  <span />
                  <IconButton icon={Quote} label="引用段落" onClick={() => format('> ')} />
                  <IconButton icon={List} label="无序列表" onClick={() => format('- ')} />
                  <div className="format-label">Markdown</div>
                </div>
              )}
              <div
                ref={documentScroll}
                className="document-scroll"
                onMouseUp={() => {
                  if (preview) {
                    const text = window.getSelection()?.toString().trim() ?? ''
                    setSelection(text.slice(0, 2000))
                  }
                }}
              >
                <article
                  className={`document article-document theme-${draft.typography.theme} ${!draft.body ? 'empty-document' : ''}`}
                  style={style}
                >
                  {starting ? (
                    <CreationFlow
                      key={project.id}
                      onCompare={openComparison}
                      onManual={() => {
                        stopCreation()
                        patchProject(project.id, (p) => ({
                          ...p,
                          creation: { ...p.creation!, mode: 'manual' },
                        }))
                        setPreview(false)
                        requestAnimationFrame(() => bodyRef.current?.focus())
                      }}
                    />
                  ) : (
                    <>
                      <Input
                        className="title-input h-auto rounded-none border-0 bg-transparent px-0 py-1 font-sans text-3xl font-semibold tracking-tight shadow-none placeholder:opacity-60 focus-visible:ring-0 md:text-3xl"
                        aria-label="文稿标题"
                        placeholder="未命名内容"
                        value={draft.title}
                        readOnly={preview}
                        onChange={(e) =>
                          patchDraft({
                            title: e.target.value,
                          })
                        }
                      />
                      <div className="document-kicker">
                        <span>
                          {platformName(platform)}
                          {platform !== 'master'
                            ? ` · 基于母稿 v${draft.sourceVersion ?? 1}`
                            : ' · 一点想法，慢慢成形'}
                        </span>
                        <span>{Math.ceil(draft.body.replace(/\s/g, '').length / 400)} 分钟阅读</span>
                      </div>
                      {platform === 'zhihu' && (
                        <Field label="回答的问题">
                          <Input
                            aria-label="知乎问题"
                            value={draft.question}
                            readOnly={preview}
                            placeholder="你想回答什么问题？"
                            onChange={(e) =>
                              patchDraft({
                                question: e.target.value,
                              })
                            }
                          />
                        </Field>
                      )}
                      {preview ? (
                        <div className="document-preview">
                          <Markdown
                            className="[font-size:var(--article-size)] [line-height:var(--article-leading)] [font-family:var(--article-font)]"
                            body={draft.body || '写下第一句话，预览就会出现在这里。'}
                            beforeBlock={(_block, index) =>
                              suggestions
                                .filter((suggestion) => suggestionAnchors.get(suggestion.id) === index)
                                .map(renderSuggestion)
                            }
                            media={Object.fromEntries(
                              state.materials
                                .filter((m) => m.type === 'image')
                                .map((m) => [m.id, m.data ?? images[m.image ?? 'room']!]),
                            )}
                          />
                        </div>
                      ) : (
                        <Textarea
                          ref={bodyRef}
                          className="body-input rounded-none border-0 p-0 shadow-none focus-visible:ring-0 [font-size:var(--article-size)] [line-height:var(--article-leading)] [font-family:var(--article-font)]"
                          aria-label="文稿正文"
                          placeholder="开始写作，或先在右侧聊聊你的想法…"
                          value={draft.body}
                          onChange={(e) =>
                            patchDraft({
                              body: e.target.value,
                            })
                          }
                          onSelect={(e) => {
                            const el = e.currentTarget
                            setSelection(el.value.slice(el.selectionStart, el.selectionEnd))
                          }}
                        />
                      )}
                      {platform !== 'master' && (
                        <Field label={platform === 'redbook' ? '话题标签' : '标签 / 补充说明'}>
                          <Input
                            aria-label="平台话题"
                            value={draft.tags}
                            readOnly={preview}
                            placeholder="添加适合这一平台的话题…"
                            onChange={(e) =>
                              patchDraft({
                                tags: e.target.value,
                              })
                            }
                          />
                        </Field>
                      )}
                      {!draft.body && !project.creation && (
                        <div className="empty-editor-actions">
                          <Button variant="outline" onClick={() => setCaptureOpen(true)}>
                            <Paperclip size={16} />
                            添加素材
                          </Button>
                          <Button
                            className="button secondary"
                            onClick={() => reference('当前空白文稿', draft.title || '帮我梳理这次创作方向')}
                            variant="outline"
                            size="default"
                          >
                            <Sparkles size={15} />
                            从一个想法开始
                          </Button>
                          <Button
                            className="text-button text-muted-foreground"
                            onClick={() => navigate('hotspots')}
                            variant="ghost"
                            size="sm"
                          >
                            从热点找选题 →
                          </Button>
                          <p>不必准备好一切，从一句话开始就好。</p>
                        </div>
                      )}
                      {suggestions
                        .filter((suggestion) => !preview || suggestionAnchors.get(suggestion.id) === -1)
                        .map(renderSuggestion)}
                      <div className="document-end">
                        <span />
                        留一点空白，让想法继续生长。
                        <span />
                      </div>
                    </>
                  )}
                </article>
              </div>
              {selection && (
                <div className="selection-action">
                  <span>已选择 {selection.length} 字</span>
                  <Button
                    className="button primary small"
                    onClick={() => {
                      reference('所选段落', selection)
                      setSelection('')
                    }}
                    variant="default"
                    size="sm"
                  >
                    <MessageCircle size={14} />
                    交给 Agent
                  </Button>
                  <IconButton icon={X} label="清除段落选择" onClick={() => setSelection('')} />
                </div>
              )}
            </>
          )}
          <footer className="document-status">
            <span>
              {draft.body.replace(/\s/g, '').length.toLocaleString()} 字 <span className="status-divider" />v
              {latest?.number ?? 1}
            </span>
          </footer>
          {history && (
            <Modal
              wide
              title={`${platformName(platform)} · 版本历史`}
              description="恢复会创建一个新版本，当前内容和其他平台版本都会保留。"
              onClose={() => setHistory(false)}
              footer={
                <>
                  <span className="muted sm:mr-auto">共 {draft.versions.length} 个修订版本</span>
                  <Button
                    className="button secondary"
                    onClick={() => setHistory(false)}
                    variant="outline"
                    size="default"
                  >
                    取消
                  </Button>
                  <Button
                    className="button primary"
                    disabled={!selectedHistory}
                    onClick={() => {
                      if (selectedHistory) {
                        patchDraft(
                          {
                            title: selectedHistory.title,
                            body: selectedHistory.body,
                          },
                          `从 v${selectedHistory.number} 恢复`,
                        )
                        notify('已恢复为新版本，恢复前的内容也已保存。')
                        setHistory(false)
                      }
                    }}
                    variant="default"
                    size="default"
                  >
                    <RotateCcw size={15} />从 v{selectedHistory?.number} 恢复为新版本
                  </Button>
                </>
              }
            >
              <div className="history-layout">
                <div className="version-list">
                  {[...draft.versions].reverse().map((version) => (
                    <Button
                      className={cn(
                        selectedHistory?.id === version.id ? 'selected' : '',
                        'h-auto justify-start whitespace-normal text-left',
                      )}
                      key={version.id}
                      onClick={() => setSelectedVersion(version.id)}
                      variant="ghost"
                      size="default"
                    >
                      <strong>
                        v{version.number}
                        <span>{version === latest ? '最近快照' : ''}</span>
                      </strong>
                      <span>{version.label}</span>
                      <small>{new Date(version.at).toLocaleString('zh-CN')}</small>
                    </Button>
                  ))}
                </div>
                <div className="version-comparison">
                  <div>
                    <Badge tone="green">当前文稿</Badge>
                    <h3>{draft.title}</h3>
                    <VersionText body={draft.body} other={selectedHistory?.body ?? ''} kind="added" />
                  </div>
                  <div>
                    <Badge tone="orange">历史 v{selectedHistory?.number}</Badge>
                    <h3>{selectedHistory?.title}</h3>
                    <VersionText body={selectedHistory?.body ?? ''} other={draft.body} kind="removed" />
                  </div>
                </div>
              </div>
            </Modal>
          )}
          {candidate && (
            <Modal
              wide
              title={`重新适配 · ${platformName(platform)}`}
              description="当前平台稿会一直保留，采用前请对照。以下是示例候选内容。"
              onClose={() => setCandidate(null)}
              footer={
                <>
                  <Button
                    className="button secondary"
                    onClick={() => setCandidate(null)}
                    variant="outline"
                    size="default"
                  >
                    保留当前稿
                  </Button>
                  <Button
                    className="button primary"
                    disabled={draft.body !== candidate.base}
                    onClick={() => {
                      patchDraft(
                        {
                          ...candidate.content,
                          sourceBody: candidate.master,
                          sourceVersion: candidate.version,
                        },
                        '采用重新适配候选（示例）',
                      )
                      setCandidate(null)
                      notify('已采用候选，手改内容保存在历史版本中。')
                    }}
                    variant="default"
                    size="default"
                  >
                    采用候选版本
                  </Button>
                </>
              }
            >
              <div className="candidate-comparison">
                <div>
                  <Badge>当前手稿</Badge>
                  <Markdown body={draft.body} />
                </div>
                <div>
                  <Badge tone="green">候选版本</Badge>
                  <Markdown body={candidate.content.body} />
                </div>
              </div>
              {draft.body !== candidate.base && (
                <div className="inline-alert red">当前稿已变化，请关闭后重新生成候选。</div>
              )}
            </Modal>
          )}
        </TabsContent>
      </div>
    </Tabs>
  )
}

function VersionText({ body, other, kind }: { body: string; other: string; kind: 'added' | 'removed' }) {
  const otherBlocks = new Set(other.split(/\n\s*\n/).map((block) => block.trim()))
  return (
    <div className="version-copy">
      {(body || '这一版本还没有正文。').split(/\n\s*\n/).map((block, index) => (
        <div
          key={index}
          className={`version-diff-block ${otherBlocks.has(block.trim()) ? 'unchanged' : kind}`}
        >
          <span className="sr-only">
            {otherBlocks.has(block.trim()) ? '' : kind === 'added' ? '当前新增或修改：' : '历史内容：'}
          </span>
          <Markdown body={block} />
        </div>
      ))}
    </div>
  )
}

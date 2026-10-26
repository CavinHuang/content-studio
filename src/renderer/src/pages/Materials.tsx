import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/native-select'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  FileText,
  FolderOpen,
  Image,
  Link2,
  List,
  MessageCircle,
  Paperclip,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
  ChevronDown,
} from 'lucide-react'
import {
  Badge,
  CheckOption,
  download,
  Empty,
  Field,
  Modal,
  PageTitle,
  SearchBox,
  IconButton,
} from '../components/ui'
import { useStudio } from '../studio/store'
import { images } from '../studio/images'
import { dateLabel, now, uid, type Material } from '../studio/types'
const typeInfo = {
  text: {
    name: '文字',
    icon: FileText,
  },
  link: {
    name: '链接',
    icon: Link2,
  },
  image: {
    name: '图片',
    icon: Image,
  },
  file: {
    name: '文件',
    icon: Paperclip,
  },
}
export function MaterialsPage({ global = false }: { global?: boolean }) {
  const { state, setState, project, patchProject, patchDraft, navigate, reference, notify, setCaptureOpen } =
    useStudio()
  const [scope, setScope] = useState(global ? 'all' : 'project')
  const [query, setQuery] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const allMaterialsTab = useRef<HTMLButtonElement>(null)
  const [type, setType] = useState('all')
  const [tag, setTag] = useState('all')
  const [detail, setDetail] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(
    () =>
      state.materials.find(
        (m) => !m.trashed && m.type === 'text' && (global || project.materialIds.includes(m.id)),
      )?.id ?? null,
  )
  useEffect(() => {
    setScope(global ? 'all' : 'project')
  }, [global, project.id])
  const active = state.materials.find((m) => m.id === detail)
  const deleting = state.materials.find((m) => m.id === deleteId)
  const all = state.materials.filter((m) => !m.trashed)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filtered = Boolean(normalizedQuery || type !== 'all' || tag !== 'all')
  function clearFilters() {
    setQuery('')
    setType('all')
    setTag('all')
    searchInput.current?.focus()
  }
  const visible = all.filter(
    (m) =>
      (scope === 'all' || project.materialIds.includes(m.id)) &&
      (type === 'all' || m.type === type) &&
      (tag === 'all' || m.tags.includes(tag)) &&
      `${m.title} ${m.body} ${m.url ?? ''} ${m.fileName ?? ''} ${m.tags.join(' ')}`
        .toLocaleLowerCase()
        .includes(normalizedQuery),
  )
  function toggleReference(material: Material) {
    const exists = project.materialIds.includes(material.id)
    patchProject(project.id, (p) => ({
      ...p,
      materialIds: exists
        ? p.materialIds.filter((id) => id !== material.id)
        : [...p.materialIds, material.id],
    }))
    notify(exists ? '已移除本篇引用，原素材与已插入正文的内容均保留。' : '已引用到本篇，尚未插入正文。')
  }
  function insert(material: Material) {
    const draft = project.drafts[project.activePlatform] ?? project.drafts.master!
    const snippet =
      material.type === 'image'
        ? `![${material.title}](asset:${material.id})`
        : `${material.body || material.url}${material.url ? `\n\n来源：${material.url}` : ''}`
    patchDraft(
      {
        body: `${draft.body}\n\n${snippet}`.trim(),
      },
      `插入素材：${material.title}`,
    )
    patchProject(project.id, (p) => ({
      ...p,
      materialIds: [...new Set([...p.materialIds, material.id])],
    }))
    setDetail(null)
    navigate('article')
    notify('已插入当前平台稿末尾，并保存一个可恢复版本。')
  }
  return (
    <section className="workspace-page materials-page">
      <PageTitle
        eyebrow={global ? 'YOUR GROWING COLLECTION' : 'A FEW THINGS TO BUILD ON'}
        title={global ? '给灵感，一个落脚的地方。' : '给这篇内容找素材'}
        description={
          global
            ? '随手记录、慢慢整理。让每一份积累，都能被下一次创作找到。'
            : `当前内容：${project.title || '未命名内容'}`
        }
        actions={
          <Button
            className="button primary"
            onClick={() => setCaptureOpen(true)}
            variant="default"
            size="default"
          >
            <Plus size={15} />
            收集素材
          </Button>
        }
      />
      <div className="material-topline">
        <Tabs value={scope} onValueChange={(value) => setScope(value as 'project' | 'all')}>
          <TabsList aria-label="素材范围">
            <TabsTrigger value="project">
              本篇引用 <span>{all.filter((m) => project.materialIds.includes(m.id)).length}</span>
            </TabsTrigger>
            <TabsTrigger value="all" ref={allMaterialsTab}>
              全部素材 <span>{all.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="small-meta">
          {scope === 'project' ? project.title || '未命名内容' : '跨项目复用'}
        </span>
      </div>
      <div className="material-search-row">
        <SearchBox
          inputRef={searchInput}
          value={query}
          onChange={setQuery}
          placeholder="搜索素材标题、正文或标签…"
          label="搜索素材"
        />
        <div className="material-filters">
          <NativeSelect
            aria-label="素材类型筛选"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="all">全部类型</option>
            {Object.entries(typeInfo).map(([id, item]) => (
              <option key={id} value={id}>
                {item.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label="素材标签筛选" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="all">全部标签</option>
            {[...new Set(all.flatMap((m) => m.tags))].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="material-grid">
        {visible.map((material) => {
          const info = typeInfo[material.type],
            related = state.projects.filter((p) => !p.trashed && p.materialIds.includes(material.id))
          return (
            <Card
              className={cn(`material-card ${expanded === material.id ? 'expanded' : ''}`, 'gap-3 p-3 grid')}
              key={material.id}
              role="article"
            >
              <Button
                className="material-thumbnail overflow-hidden"
                aria-label={`查看素材：${material.title}`}
                onClick={() => setDetail(material.id)}
                variant="ghost"
                size="icon"
              >
                {material.type === 'image' ? (
                  <img
                    className="size-full object-cover"
                    src={material.data ?? images[material.image ?? 'room']}
                    alt={material.title}
                  />
                ) : (
                  <info.icon />
                )}
              </Button>
              <div className="material-card-body">
                <Button
                  className="material-title h-auto p-0 justify-start whitespace-normal text-left"
                  onClick={() => setDetail(material.id)}
                  variant="ghost"
                  size="default"
                >
                  {material.title}
                </Button>
                <div className="tag-row">
                  {material.tags.map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
                <div className="material-row-meta">
                  {info.name} ·{' '}
                  {material.type === 'link'
                    ? new URL(material.url || 'https://example.com').hostname
                    : '手动收集'}
                  {related.length ? ` · 被 ${related.length} 篇内容引用` : ''}
                </div>
                <div className="material-card-footer">
                  <span>
                    {material.readState === 'link-only' ? '仅链接' : dateLabel(material.at)}
                    {related.length ? ` · ${related.length} 篇引用` : ''}
                  </span>
                  <Button
                    className={cn(
                      `text-button ${project.materialIds.includes(material.id) ? 'green-text' : ''}`,
                      'text-muted-foreground',
                    )}
                    onClick={() => toggleReference(material)}
                    variant="ghost"
                    size="sm"
                  >
                    {project.materialIds.includes(material.id) ? (
                      <>
                        <Check size={13} />
                        已引用
                      </>
                    ) : (
                      <>
                        <Plus size={13} />
                        引用
                      </>
                    )}
                  </Button>
                </div>
              </div>
              <IconButton
                icon={ChevronDown}
                label={`${expanded === material.id ? '收起' : '展开'}素材原文：${material.title}`}
                className={expanded === material.id ? 'material-expand expanded' : 'material-expand'}
                aria-expanded={expanded === material.id}
                aria-controls={`material-content-${material.id}`}
                onClick={() => setExpanded(expanded === material.id ? null : material.id)}
              />
              <div
                className="material-inline-detail"
                id={`material-content-${material.id}`}
                hidden={expanded !== material.id}
              >
                <p>{material.body || material.url || '这份素材保留了原始文件，可打开详情查看。'}</p>
                <div className="tag-row">
                  {material.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <div className="material-inline-actions">
                  <Button
                    variant="outline"
                    onClick={() => reference(material.title, material.body || material.url || material.title)}
                  >
                    <MessageCircle size={16} />
                    引用到对话
                  </Button>
                  <Button variant="outline" onClick={() => insert(material)}>
                    <FileText size={16} />
                    插入文稿
                  </Button>
                  <Button variant="ghost" onClick={() => toggleReference(material)}>
                    {project.materialIds.includes(material.id) ? '移除本篇引用' : '引用到本篇'}
                  </Button>
                </div>
              </div>
            </Card>
          )
        })}
      </div>
      {!visible.length && (
        <Empty
          icon={FolderOpen}
          title={
            filtered ? '没有找到相关素材' : scope === 'project' ? '给这篇内容，添一点积累' : '素材库还是空的'
          }
          description={
            filtered
              ? '试试其他关键词、类型或标签，也可以清除筛选。'
              : '文字、链接、图片或文件，都可以成为创作的起点。'
          }
        >
          {filtered ? (
            <Button variant="outline" onClick={clearFilters}>
              清除筛选
            </Button>
          ) : (
            <div className="flex flex-wrap justify-center gap-2">
              {scope === 'project' && all.length > 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setScope('all')
                    allMaterialsTab.current?.focus()
                  }}
                >
                  查看全部素材
                </Button>
              )}
              <Button
                className="button secondary"
                onClick={() => setCaptureOpen(true)}
                variant="outline"
                size="default"
              >
                <Plus size={15} />
                收集第一份素材
              </Button>
            </div>
          )}
        </Empty>
      )}
      {active && (
        <Modal
          wide
          title={active.title}
          description={`${typeInfo[active.type].name} · 保存于 ${dateLabel(active.at)}`}
          onClose={() => setDetail(null)}
          footer={
            <>
              <Button
                className="text-button danger-text text-destructive"
                onClick={() => setDeleteId(active.id)}
                variant="ghost"
                size="sm"
              >
                <Trash2 size={15} />
                删除原素材
              </Button>
              <div className="button-row">
                <Button
                  className="button secondary"
                  onClick={() => toggleReference(active)}
                  variant="outline"
                  size="default"
                >
                  {project.materialIds.includes(active.id) ? '移除本篇引用' : '引用到本篇'}
                </Button>
                <Button
                  className="button secondary"
                  onClick={() => {
                    reference(active.title, active.body || active.url || active.title)
                    setDetail(null)
                  }}
                  variant="outline"
                  size="default"
                >
                  <MessageCircle size={15} />
                  引用到对话
                </Button>
                <Button
                  className="button primary"
                  onClick={() => insert(active)}
                  variant="default"
                  size="default"
                >
                  插入文稿
                  <ArrowRight size={15} />
                </Button>
              </div>
            </>
          }
        >
          {active.type === 'image' && (
            <img
              className="material-detail-image"
              src={active.data ?? images[active.image ?? 'room']}
              alt={active.title}
            />
          )}
          {active.url && (
            <div className="material-source">
              <Link2 size={15} />
              <span>{active.url}</span>
              <Badge tone={active.readState === 'link-only' ? 'orange' : 'green'}>
                {active.readState === 'link-only' ? '仅链接 · 未读取正文' : '示例摘录'}
              </Badge>
            </div>
          )}
          <Field label="标题">
            <Input
              value={active.title}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  materials: s.materials.map((m) =>
                    m.id === active.id
                      ? {
                          ...m,
                          title: e.target.value,
                        }
                      : m,
                  ),
                }))
              }
            />
          </Field>
          <Field label={active.type === 'link' ? '原文片段 / 你的摘录' : '正文与备注'}>
            <Textarea
              rows={6}
              value={active.body}
              placeholder="可以粘贴原文片段，或记下你的理解…"
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  materials: s.materials.map((m) =>
                    m.id === active.id
                      ? {
                          ...m,
                          body: e.target.value,
                          readState: e.target.value ? 'ready' : 'link-only',
                        }
                      : m,
                  ),
                }))
              }
            />
          </Field>
          <div className="tag-row">
            {active.tags.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <p className="small-meta">
            引用此素材：
            {state.projects
              .filter((p) => !p.trashed && p.materialIds.includes(active.id))
              .map((p) => p.title || '未命名内容')
              .join('、') || '暂无项目引用'}
          </p>
          {active.type === 'file' && (
            <Button
              className="button secondary"
              onClick={() => {
                if (active.data) {
                  const a = document.createElement('a')
                  a.href = active.data
                  a.download = active.fileName ?? '素材'
                  a.click()
                } else download(active.fileName ?? `${active.title}.txt`, active.body)
              }}
              variant="outline"
              size="default"
            >
              <ArrowDownToLine size={15} />
              下载文件
            </Button>
          )}
        </Modal>
      )}
      {deleting && (
        <Modal
          title="将原素材移入回收站？"
          description={`「${deleting.title}」被 ${state.projects.filter((p) => p.materialIds.includes(deleting.id) && !p.trashed).length} 篇内容引用。恢复前将无法从素材库继续引用，已经写进正文的文字会保留。`}
          onClose={() => setDeleteId(null)}
          footer={
            <>
              <Button
                className="button secondary"
                onClick={() => setDeleteId(null)}
                variant="outline"
                size="default"
              >
                取消
              </Button>
              <Button
                className="button danger"
                onClick={() => {
                  setState((s) => ({
                    ...s,
                    materials: s.materials.map((m) =>
                      m.id === deleting.id
                        ? {
                            ...m,
                            trashed: true,
                          }
                        : m,
                    ),
                  }))
                  setDeleteId(null)
                  setDetail(null)
                  notify('已移入回收站，可在设置的数据与导出中恢复。')
                }}
                variant="destructive"
                size="default"
              >
                移入回收站
              </Button>
            </>
          }
        >
          已插入文稿的内容与其他素材不会被删除。
        </Modal>
      )}
    </section>
  )
}
export function MaterialCapture() {
  const { captureOpen, setCaptureOpen, state, setState, project, notify } = useStudio()
  const [type, setType] = useState<Material['type']>('text')
  const [title, setTitle] = useState(''),
    [body, setBody] = useState(''),
    [url, setUrl] = useState(''),
    [tags, setTags] = useState('')
  const [file, setFile] = useState<{
    name: string
    data: string
  } | null>(null)
  const [linkProject, setLinkProject] = useState(false),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (captureOpen) {
      setType('text')
      setTitle('')
      setBody('')
      setUrl('')
      setTags('')
      setFile(null)
      setError('')
      setLinkProject(state.page !== 'library')
      setLoading(false)
    }
  }, [captureOpen])
  if (!captureOpen) return null
  const valid = type === 'text' ? !!body.trim() : type === 'link' ? !!url.trim() : !!file
  function save() {
    if (!valid || loading) return
    if (type === 'link') {
      try {
        if (!['https:', 'http:'].includes(new URL(url).protocol)) throw new Error()
      } catch {
        setError('请输入有效的 http 或 https 链接。')
        return
      }
    }
    const material: Material = {
      id: uid(),
      title:
        title.trim() ||
        (type === 'text' ? body.trim().slice(0, 26) : type === 'link' ? new URL(url).hostname : file!.name),
      type,
      body,
      url: type === 'link' ? url : '',
      tags: tags
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
      data: file?.data,
      fileName: file?.name,
      at: now(),
      readState: type === 'link' ? (body ? 'ready' : 'link-only') : undefined,
    }
    const next = {
      ...state,
      materials: [material, ...state.materials],
      projects: linkProject
        ? state.projects.map((p) =>
            p.id === project.id
              ? {
                  ...p,
                  materialIds: [...p.materialIds, material.id],
                }
              : p,
          )
        : state.projects,
    }
    try {
      localStorage.setItem('content-studio.mock-workspace.v2', JSON.stringify(next))
    } catch {
      setError('本机存储空间不足。请使用小于 1 MB 的文件，或先备份并整理素材。')
      return
    }
    setState(next)
    setCaptureOpen(false)
    notify(linkProject ? '素材已保存，并引用到当前内容。' : '素材已保存到全局素材库。')
  }
  async function readFile(picked?: File) {
    if (!picked) return
    if (picked.size > 1024 * 1024) {
      setError('演示本地存储支持 1 MB 以内的文件。')
      return
    }
    if (type === 'image' && !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(picked.type)) {
      setError('请选择 PNG、JPG、WebP 或 GIF 图片。')
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = reject
        reader.readAsDataURL(picked)
      })
      setFile({
        name: picked.name,
        data,
      })
      if (!title) setTitle(picked.name.replace(/\.[^.]+$/, ''))
    } catch {
      setError('文件读取失败，请重新选择。')
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal
      title="把这一刻，先留下来。"
      description="不必立即整理，标题和标签可以以后再补。"
      onClose={() => setCaptureOpen(false)}
      footer={
        <>
          <span className="muted">保存在本机 · 演示存储</span>
          <Button
            className="button primary"
            disabled={!valid || loading}
            onClick={save}
            variant="default"
            size="default"
          >
            <Check size={15} />
            {linkProject ? '保存并引用' : '保存素材'}
          </Button>
        </>
      }
    >
      <div className="capture-types mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Object.entries(typeInfo).map(([id, item]) => (
          <Button
            aria-pressed={type === id}
            key={id}
            onClick={() => {
              setType(id as Material['type'])
              setError('')
              setFile(null)
            }}
            variant={type === id ? 'secondary' : 'outline'}
            size="default"
          >
            <item.icon size={19} />
            {item.name}
          </Button>
        ))}
      </div>
      <Field label="标题（可选）">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="给它起一个容易找到的名字"
        />
      </Field>
      {type === 'link' && (
        <Field label="原始链接" hint="演示模式只保存链接，不自动抓取网页；可以在下方粘贴原文。">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </Field>
      )}
      {(type === 'image' || type === 'file') && (
        <div
          className="file-drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            void readFile(e.dataTransfer.files[0])
          }}
        >
          <input
            ref={inputRef}
            type="file"
            hidden
            accept={type === 'image' ? 'image/png,image/jpeg,image/webp,image/gif' : undefined}
            onChange={(e) => void readFile(e.target.files?.[0])}
          />
          {file && type === 'image' ? <img src={file.data} alt="待保存图片预览" /> : <Upload size={29} />}
          <Button
            className="text-button text-muted-foreground"
            onClick={() => inputRef.current?.click()}
            variant="ghost"
            size="sm"
          >
            {loading ? '正在读取…' : file ? file.name : '点击选择，或把文件拖到这里'}
          </Button>
          <small>单个文件不超过 1 MB，保存在当前设备</small>
        </div>
      )}
      <Field label={type === 'text' ? '写下你的想法' : '摘录与备注（可选）'}>
        <Textarea
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="一句话、一个问题、一段摘录，都可以。"
        />
      </Field>
      <Field label="标签（可选）">
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="用逗号分隔，例如：选题，阅读，个人创作"
        />
      </Field>
      <CheckOption checked={linkProject} onChange={setLinkProject}>
        同时引用到「{project.title || '未命名内容'}」
      </CheckOption>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}

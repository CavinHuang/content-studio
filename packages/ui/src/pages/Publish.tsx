import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Button } from '@/components/ui/button'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FileCheck2,
  History,
  Info,
  KeyRound,
  Link2,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react'
import {
  Badge,
  CheckOption,
  copyText,
  download,
  Empty,
  Field,
  Markdown,
  Modal,
  PageTitle,
  PlatformMark,
} from '../components/ui'
import { useStudio } from '../studio/store'
import { KEEP_WECHAT_SECRET } from '../studio/persistence'
import {
  dateLabel,
  now,
  platformName,
  PLATFORMS,
  uid,
  type Batch,
  type Material,
  type Platform,
  type PublishItem,
} from '../studio/types'

/** 收集正文 asset: 图片引用对应的素材数据快照（data URL），随批次冻结进任务 payload。 */
function collectAssetImages(body: string, materials: Material[]): Record<string, string> {
  const assets: Record<string, string> = {}
  for (const match of body.matchAll(/!\[[^\]]*\]\(asset:([^)]+)\)/g)) {
    const id = match[1]!
    if (assets[id]) continue
    const material = materials.find((m) => m.id === id && !m.trashed)
    const dataUrl = material?.type === 'image' ? material.data : undefined
    if (dataUrl?.startsWith('data:image/')) assets[id] = dataUrl
  }
  return assets
}
export function PublishPage() {
  const pageRef = useRef<HTMLElement>(null)
  const {
    project,
    patchProject,
    state,
    notify,
    navigate,
    setPlatformsOpen,
    publishAvailable,
    wechatConfig,
    wechatReady,
    saveWechatConfig,
    clearWechatConfig,
    probeWechat,
    renderWechatHtml,
    saveWechatDraft,
  } = useStudio()
  const [selected, setSelected] = useState<Platform[]>([])
  const [videoId, setVideoId] = useState('')
  const [batchId, setBatchId] = useState<string | null>(null)
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('wechat')
  const [marking, setMarking] = useState<Platform | null>(null)
  const [link, setLink] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [wechatFormOpen, setWechatFormOpen] = useState(false)
  const [appIdInput, setAppIdInput] = useState('')
  const [secretInput, setSecretInput] = useState('')
  const [savingConfig, setSavingConfig] = useState(false)
  const [probing, setProbing] = useState(false)
  const [probeMessage, setProbeMessage] = useState('')
  const settledNoticeRef = useRef('')
  useEffect(() => {
    pageRef.current?.scrollTo({ top: 0 })
  }, [batchId])
  const batch = project.batches.find((b) => b.id === batchId)
  const current = batch?.items.find((item) => item.platform === currentPlatform) ?? batch?.items[0]
  const adoptedVideos = project.videos.filter((v) => v.confirmed && v.adopted)
  const video = project.videos.find((v) => v.id === videoId)
  // 本批次公众号存草稿任务（kind 'publish' / executor 'main'）：进度与结果如实展示。
  const draftTask =
    current?.platform === 'wechat'
      ? state.tasks.find(
          (task) =>
            task.kind === 'publish' &&
            task.executor === 'main' &&
            (task.payload as { batchId?: string } | undefined)?.batchId === batch?.id,
        )
      : undefined
  useEffect(() => {
    if (!draftTask || draftTask.state === 'running' || settledNoticeRef.current === draftTask.id) return
    settledNoticeRef.current = draftTask.id
    if (draftTask.state === 'complete') notify('已存入公众号草稿箱；正式发布请在公众号后台完成。')
    else if (draftTask.state === 'failed')
      notify(`存入草稿箱失败：${draftTask.error ?? draftTask.detail}`)
  }, [draftTask, notify])
  useEffect(() => {
    if (!wechatFormOpen) return
    setAppIdInput(wechatConfig?.appId ?? appIdInput)
    setSecretInput('')
    setProbeMessage('')
  }, [wechatFormOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  const ready = (platform: Platform) =>
    platform === 'douyin'
      ? !!project.drafts[platform]?.body.trim() || !!video?.adopted
      : !!project.drafts[platform]?.body.trim()
  function start() {
    const next: Batch = {
      id: uid(),
      at: now(),
      items: selected.map((platform) => {
        const draft = project.drafts[platform]
        return {
          platform,
          snapshot: {
            title: draft?.title ?? project.title,
            body: draft?.body ?? '',
            tags: draft?.tags ?? '',
            version: draft?.versions.at(-1)?.number ?? 0,
          },
          videoId: platform === 'douyin' ? videoId || undefined : undefined,
          videoVersion: platform === 'douyin' ? video?.adopted : undefined,
          videoSnapshot:
            platform === 'douyin' && video
              ? {
                  ...structuredClone(video),
                  candidate: undefined,
                  versions: video.versions.filter((v) => v.number === video.adopted),
                }
              : undefined,
          status: 'preparing',
          link: '',
        }
      }),
    }
    patchProject(project.id, (p) => ({
      ...p,
      batches: [next, ...p.batches],
    }))
    setBatchId(next.id)
    setCurrentPlatform(selected[0]!)
    notify('已固定本批次的平台与内容快照。后续编辑不会改写此批次。')
  }
  function patchItem(platform: Platform, value: Partial<PublishItem>) {
    patchProject(project.id, (p) => ({
      ...p,
      batches: p.batches.map((b) =>
        b.id === batchId
          ? {
              ...b,
              items: b.items.map((item) =>
                item.platform === platform
                  ? {
                      ...item,
                      ...value,
                    }
                  : item,
              ),
            }
          : b,
      ),
    }))
  }
  function isItemReady(item: PublishItem) {
    return !!item.snapshot.body.trim() || (!!item.videoId && !!item.videoVersion)
  }
  function exportBatch() {
    if (!batch) return
    const included = batch.items.filter(isItemReady),
      omitted = batch.items.filter((item) => !isItemReady(item))
    download(
      `${project.title || '内容'}-发布批次-${batch.id.slice(0, 6)}.json`,
      JSON.stringify(
        {
          mock: true,
          note: '人工发布交付清单；未调用任何平台发布接口。视频包含制作元数据，不包含 MP4。',
          batchId: batch.id,
          preparedAt: batch.at,
          exportedAt: now(),
          items: included,
          omittedPlatforms: omitted.map((item) => ({
            platform: platformName(item.platform),
            reason: '缺少文稿或已采用视频',
          })),
        },
        null,
        2,
      ),
      'application/json',
    )
    patchProject(project.id, (p) => ({
      ...p,
      batches: p.batches.map((b) =>
        b.id === batchId
          ? {
              ...b,
              items: b.items.map((item) =>
                isItemReady(item) && item.status !== 'published'
                  ? {
                      ...item,
                      status: 'exported',
                    }
                  : item,
              ),
            }
          : b,
      ),
    }))
    notify(
      `已导出 ${included.length} 项内容清单${omitted.length ? `，${omitted.length} 个未就绪平台已在清单中说明` : ''}。发布状态不会自动变更。`,
    )
  }
  async function copy(rich = false) {
    if (!current?.snapshot.body) return
    if (rich) {
      // 公众号富文本：优先用主进程 md→公众号 HTML 的转换结果（干净无脚本）；
      // 本地降级（无桌面桥）回退到预览区 DOM，演示复制路径保留。
      const wechatHtml = await renderWechatHtml(current.snapshot.body)
      try {
        const element = document.querySelector('.publish-document')
        const html = wechatHtml ?? element?.innerHTML
        if (!html || typeof ClipboardItem === 'undefined') throw new Error()
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], {
              type: 'text/html',
            }),
            'text/plain': new Blob([`${current.snapshot.title}\n\n${current.snapshot.body}`], {
              type: 'text/plain',
            }),
          }),
        ])
        notify(
          wechatHtml
            ? '已复制公众号格式富文本，请到公众号编辑器粘贴并检查排版。'
            : '富文本已复制，请到公众号编辑器粘贴并检查实际排版。',
        )
        return
      } catch {
        notify(
          (await copyText(current.snapshot.body))
            ? '已复制纯文本；当前环境未能写入富文本。'
            : '剪贴板暂不可用，请下载文稿后复制。',
        )
        return
      }
    }
    notify(
      (await copyText(`${current.snapshot.title}\n\n${current.snapshot.body}\n\n${current.snapshot.tags}`))
        ? '已复制。请到对应平台手动发布，完成后再记录。'
        : '复制失败，请下载文稿后复制。',
    )
  }
  async function saveWechat() {
    setSavingConfig(true)
    const result = await saveWechatConfig({
      appId: appIdInput,
      secret: secretInput.trim() ? secretInput : KEEP_WECHAT_SECRET,
    })
    setSavingConfig(false)
    notify(result.message)
    if (result.ok) {
      setWechatFormOpen(false)
      setSecretInput('')
    }
  }
  async function probeConnection() {
    setProbing(true)
    setProbeMessage('')
    const result = await probeWechat()
    setProbing(false)
    if (result) setProbeMessage(result.message)
  }
  async function submitWechatDraft() {
    if (!batch || !current?.snapshot.body) return
    const assets = collectAssetImages(current.snapshot.body, state.materials)
    await saveWechatDraft({
      batchId: batch.id,
      title: current.snapshot.title,
      body: current.snapshot.body,
      assets,
    })
  }
  function markPublished() {
    if (!marking || !confirmed) return
    if (link.trim()) {
      try {
        if (!['http:', 'https:'].includes(new URL(link).protocol)) throw new Error()
      } catch {
        setError('请输入有效的 http 或 https 发布链接，或留空。')
        return
      }
    }
    patchItem(marking, {
      status: 'published',
      link: link.trim(),
    })
    setMarking(null)
    notify('已记录发布状态。')
  }
  return (
    <section ref={pageRef} className={`workspace-page publish-page ${batch ? 'has-batch' : ''}`}>
      <div className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>文稿</span>
        <span aria-hidden>·</span>
        <span className="font-medium text-foreground">发布准备</span>
      </div>
      {/* B13：返回统一「返回 + 目的地」格式（批次视图回步骤一，选择视图回文稿页） */}
      <Button
        className=" back-link text-muted-foreground"
        onClick={() => (batch ? setBatchId(null) : navigate('article'))}
        variant="ghost"
        size="sm"
      >
        <ArrowLeft size={15} />
        {batch ? '返回选择平台' : '返回文稿'}
      </Button>
      <PageTitle
        title={batch ? '最后看一眼，再分享。' : '这次发布到哪里？'}
        description={
          batch
            ? '预览的是本批次固定快照。复制、下载、手动发布，再分别记录结果。'
            : '只选这次需要的平台。已准备的其他版本会一直留着。'
        }
        actions={
          <Button onClick={() => setShowHistory(true)} variant="outline" size="default">
            <History size={15} />
            发布记录 {project.batches.length}
          </Button>
        }
      />
      <div className="publish-stepper">
        <span className={cn(!batch ? 'text-foreground' : 'done text-muted-foreground')}>
          <i className={cn(!batch && 'bg-primary text-primary-foreground', batch && 'text-primary')}>
            {batch ? <Check size={13} /> : '1'}
          </i>
          选择平台
        </span>
        <div className={batch ? 'border-primary' : ''} />
        <span className={cn(batch ? 'text-foreground' : 'text-muted-foreground')}>
          <i className={cn(batch && 'bg-primary text-primary-foreground')}>2</i>
          预览与交付
        </span>
        <div />
        <span className="text-muted-foreground">
          <i>3</i>手动记录发布
        </span>
      </div>
      {!batch ? (
        <>
          <div className="section-heading">
            <h2>本次发布的平台</h2>
            <div className="button-row">
              <Button
                className=" text-muted-foreground"
                onClick={() => setSelected(PLATFORMS.map((p) => p.id))}
                variant="ghost"
                size="sm"
              >
                全选
              </Button>
              {/* C9：成对操作的统一分隔样式（muted 间隔点，读屏跳过） */}
              <span aria-hidden className="text-muted-foreground">
                ·
              </span>
              <Button
                className=" text-muted-foreground"
                onClick={() => setSelected([])}
                variant="ghost"
                size="sm"
              >
                清空
              </Button>
            </div>
          </div>
          <div className="publish-platform-grid">
            {PLATFORMS.map((platform) => (
              <div
                key={platform.id}
                className={`publish-platform-card ${selected.includes(platform.id) ? 'selected' : ''}`}
              >
                <CheckOption
                  checked={selected.includes(platform.id)}
                  onChange={(checked) =>
                    setSelected((p) => (checked ? [...p, platform.id] : p.filter((id) => id !== platform.id)))
                  }
                >
                  <PlatformMark platform={platform.id} />
                  <span className="grid min-w-0 gap-1">
                    <strong>{platform.name}</strong>
                    <small className="text-xs font-normal text-muted-foreground">
                      {project.drafts[platform.id]?.title || platform.description}
                    </small>
                  </span>
                </CheckOption>
                <Badge tone={ready(platform.id) ? 'green' : 'orange'}>
                  {ready(platform.id) ? '内容已就绪' : '需要准备内容'}
                </Badge>
                {!ready(platform.id) && (
                  // C7：「准备版本」右对齐到徽标列下方，保持各卡行结构一致
                  <Button
                    className=" text-muted-foreground col-start-2 justify-self-end"
                    onClick={() => setPlatformsOpen(true)}
                    variant="ghost"
                    size="sm"
                  >
                    准备版本
                    <ArrowRight size={13} />
                  </Button>
                )}
              </div>
            ))}
          </div>
          {selected.includes('douyin') && (
            <div className="douyin-output">
              <h3>抖音 · 选择这次的视频作品</h3>
              <Field label="独立作品与已采用版本">
                <NativeSelect
                  aria-label="抖音视频作品"
                  value={videoId}
                  onChange={(e) => setVideoId(e.target.value)}
                >
                  <option value="">仅交付口播脚本 / 暂不关联视频</option>
                  {adoptedVideos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.title} · {v.mode === 'code' ? '代码动画' : '素材分镜'} · 已采用 v{v.adopted}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <p className="small-meta">关联作品仅交付制作清单，本演示未生成 MP4。可以前往视频工作区查看。</p>
            </div>
          )}
          {selected.some((p) => !ready(p)) && (
            <div className="inline-alert orange">
              <TriangleAlert size={16} />
              {selected
                .filter((p) => !ready(p))
                .map(platformName)
                .join('、')}
              尚未就绪。可以继续查看，并单独交付已准备的平台。
            </div>
          )}
          <div className="publish-selection-footer">
            <span>
              {/* C10：与平台选择弹窗统一摘要句式「已选 N 个平台 · M 个已就绪」 */}
              已选 <strong>{selected.length}</strong> 个平台 · {selected.filter(ready).length} 个已就绪
            </span>
            <Button disabled={!selected.length} onClick={start} variant="default" size="default">
              继续，预览所选平台
              <ArrowRight size={16} />
            </Button>
          </div>
          <div className="quiet-note">
            {/* C8：中性说明用 info 图标，对勾只留给完成/选中语义 */}
            <Info size={15} />
            常用平台只是偏好，每次发布范围由你决定。
          </div>
        </>
      ) : (
        <>
          <div className="batch-summary">
            <span>
              批次 {batch.id.slice(0, 6)} · {dateLabel(batch.at)}
            </span>
            <Button
              className=" text-muted-foreground"
              onClick={() => {
                setBatchId(null)
                setSelected([])
              }}
              variant="ghost"
              size="sm"
            >
              <Plus size={14} />
              准备新批次
            </Button>
          </div>
          <div className="publish-targets">
            {batch.items.map((item) => (
              <Button
                key={item.platform}
                aria-pressed={current?.platform === item.platform}
                onClick={() => setCurrentPlatform(item.platform)}
                variant="outline"
                size="default"
                className={cn(
                  current?.platform === item.platform
                    ? 'bg-[var(--selected-platform)] text-foreground hover:bg-[var(--selected-platform)]'
                    : 'bg-card hover:bg-secondary/60',
                )}
              >
                <PlatformMark platform={item.platform} />
                <span>{platformName(item.platform)}</span>
                <i
                  aria-hidden
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    item.status === 'published'
                      ? 'bg-success'
                      : isItemReady(item)
                        ? 'bg-muted-foreground/50'
                        : 'bg-warning',
                  )}
                />
                {item.status === 'published' && <Check size={13} />}
              </Button>
            ))}
          </div>
          {current && (
            <>
              <div className="handoff-status">
                <Badge
                  tone={
                    current.status === 'published' ? 'green' : isItemReady(current) ? 'neutral' : 'orange'
                  }
                >
                  {current.status === 'published'
                    ? '已记录发布'
                    : current.status === 'exported'
                      ? '已导出 · 未记录'
                      : isItemReady(current)
                        ? '等待手动交付'
                        : '缺少内容'}
                </Badge>
                <span>
                  固定快照 v{current.snapshot.version}
                  {project.drafts[current.platform]?.body !== current.snapshot.body && current.snapshot.body
                    ? ' · 当前文稿已有新修改'
                    : ''}
                </span>
              </div>
              {isItemReady(current) ? (
                <>
                  <div className="publish-preview">
                    <div className="preview-paper-label">{platformName(current.platform)} · 内容预览</div>
                    <div className="publish-document">
                      <h1>{current.snapshot.title}</h1>
                      {current.platform === 'x' ? (
                        current.snapshot.body.split(/\n---\n/).map((post, index) => (
                          <div className="thread-post" key={index}>
                            <span>串文 {index + 1}</span>
                            <Markdown body={post} />
                            <Button
                              className=" text-muted-foreground"
                              onClick={() =>
                                void copyText(post).then((ok) =>
                                  notify(ok ? `已复制第 ${index + 1} 段。` : '复制失败，请下载串文。'),
                                )
                              }
                              variant="ghost"
                              size="sm"
                            >
                              <Copy size={13} />
                              复制本段
                            </Button>
                          </div>
                        ))
                      ) : (
                        <Markdown body={current.snapshot.body || '本次交付以下视频作品的制作清单。'} />
                      )}
                      {current.snapshot.tags && <p className="publish-tags">{current.snapshot.tags}</p>}
                    </div>
                    {current.videoId && (
                      <div className="publish-video-reference">
                        <FileCheck2 size={22} />
                        <div>
                          <strong>
                            {current.videoSnapshot?.title ??
                              project.videos.find((v) => v.id === current.videoId)?.title ??
                              '关联视频'}
                          </strong>
                          <p>已采用 v{current.videoVersion} · 制作清单 · 未渲染 MP4</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="handoff-actions">
                    <Button
                      disabled={!current.snapshot.body}
                      onClick={() => void copy(current.platform === 'wechat')}
                      variant="outline"
                      size="default"
                    >
                      <Copy size={15} />
                      {current.platform === 'wechat' ? '复制富文本' : '复制正文'}
                    </Button>
                    <Button
                      onClick={() => {
                        download(
                          `${current.snapshot.title}-${platformName(current.platform)}.md`,
                          `# ${current.snapshot.title}\n\n${current.snapshot.body}\n\n${current.snapshot.tags}`,
                        )
                        if (current.status !== 'published')
                          patchItem(current.platform, {
                            status: 'exported',
                          })
                        notify('已下载本批次的文稿快照，发布状态保持独立。')
                      }}
                      variant="outline"
                      size="default"
                    >
                      <Download size={15} />
                      下载文稿
                    </Button>
                    {current.status === 'published' ? (
                      <Button
                        className=" text-muted-foreground"
                        onClick={() => {
                          patchItem(current.platform, {
                            status: 'preparing',
                            link: '',
                          })
                          notify('已撤销记录，内容快照保留。')
                        }}
                        variant="ghost"
                        size="sm"
                      >
                        <RotateIcon />
                        改回未发布
                      </Button>
                    ) : (
                      <Button
                        onClick={() => {
                          setMarking(current.platform)
                          setLink('')
                          setConfirmed(false)
                          setError('')
                        }}
                        variant="default"
                        size="default"
                      >
                        <Check size={15} />
                        标记{platformName(current.platform)}已发布
                      </Button>
                    )}
                  </div>
                  {current.platform === 'wechat' && (
                    <section
                      aria-label="公众号草稿箱"
                      className="mt-3 grid gap-2 rounded-xl border bg-card p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <Send size={15} />
                          公众号 · 官方草稿箱
                        </span>
                        <Badge tone={wechatReady ? 'green' : 'orange'}>
                          {wechatReady ? '已配置' : publishAvailable ? '未配置' : '浏览器预览'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        只存入草稿箱，不会替你发布；正式发布请在公众号后台完成。凭证只保存在本机。
                      </p>
                      {!publishAvailable ? (
                        <p className="small-meta">
                          浏览器预览不支持草稿箱；可继续使用复制富文本与下载文稿完成人工交付。
                        </p>
                      ) : wechatFormOpen ? (
                        <div className="grid gap-3">
                          <div className="inline-alert orange">
                            <TriangleAlert size={16} />
                            调用公众号接口需要先把本机出口 IP 加入公众号后台的 IP 白名单，请在保存前确认。
                          </div>
                          <Field label="AppID">
                            <Input
                              aria-label="公众号 AppID"
                              value={appIdInput}
                              onChange={(event) => setAppIdInput(event.target.value)}
                              placeholder="wx 开头的公众号 AppID"
                            />
                          </Field>
                          <Field label="AppSecret">
                            <Input
                              aria-label="公众号 AppSecret"
                              type="password"
                              value={secretInput}
                              onChange={(event) => setSecretInput(event.target.value)}
                              placeholder={
                                wechatConfig?.hasSecret ? '未修改时留空，沿用已保存密钥' : '在公众号后台的开发设置中获取'
                              }
                            />
                          </Field>
                          {wechatConfig?.plain && (
                            <p className="form-error">本机未启用加密存储，密钥将以明文保存在本机。</p>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              disabled={savingConfig || !appIdInput.trim()}
                              onClick={() => void saveWechat()}
                              variant="default"
                              size="sm"
                            >
                              <KeyRound size={14} />
                              {savingConfig ? '正在保存…' : '保存配置'}
                            </Button>
                            <Button
                              disabled={probing || !wechatReady}
                              onClick={() => void probeConnection()}
                              variant="outline"
                              size="sm"
                            >
                              <ShieldCheck size={14} />
                              {probing ? '正在检测…' : '检测连接'}
                            </Button>
                            <Button
                              className=" text-muted-foreground"
                              onClick={() => setWechatFormOpen(false)}
                              variant="ghost"
                              size="sm"
                            >
                              收起
                            </Button>
                            {wechatConfig?.hasSecret && (
                              <Button
                                className=" text-muted-foreground"
                                onClick={() => {
                                  setWechatFormOpen(false)
                                  void clearWechatConfig()
                                }}
                                variant="ghost"
                                size="sm"
                              >
                                清除本机凭证
                              </Button>
                            )}
                          </div>
                          {probeMessage && <p className="small-meta">{probeMessage}</p>}
                        </div>
                      ) : wechatReady ? (
                        <div className="grid gap-2">
                          <p className="small-meta">
                            已配置 {wechatConfig?.appId}
                            {wechatConfig?.secretTail ? `（密钥尾号 ${wechatConfig.secretTail}）` : ''}
                            {wechatConfig?.plain ? ' · 本机未启用加密存储' : ''}
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              disabled={!current.snapshot.body || draftTask?.state === 'running'}
                              onClick={() => void submitWechatDraft()}
                              variant="default"
                              size="sm"
                            >
                              <Send size={14} />
                              {draftTask?.state === 'running' ? '正在存入草稿箱…' : '存入草稿箱'}
                            </Button>
                            <Button
                              disabled={probing}
                              onClick={() => void probeConnection()}
                              variant="outline"
                              size="sm"
                            >
                              <ShieldCheck size={14} />
                              {probing ? '正在检测…' : '检测连接'}
                            </Button>
                            <Button
                              className=" text-muted-foreground"
                              onClick={() => setWechatFormOpen(true)}
                              variant="ghost"
                              size="sm"
                            >
                              <Settings2 size={14} />
                              修改配置
                            </Button>
                          </div>
                          {draftTask && (
                            <p
                              className={cn(
                                'small-meta',
                                draftTask.state === 'failed' && 'text-destructive',
                              )}
                            >
                              {draftTask.state === 'complete'
                                ? '已存入草稿箱；正式发布请在公众号后台完成。'
                                : draftTask.state === 'failed'
                                  ? `存入失败：${draftTask.error ?? draftTask.detail}`
                                  : draftTask.detail}
                            </p>
                          )}
                          {probeMessage && <p className="small-meta">{probeMessage}</p>}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button onClick={() => setWechatFormOpen(true)} variant="outline" size="sm">
                            <Settings2 size={14} />
                            配置公众号，启用草稿箱
                          </Button>
                          <span className="small-meta">不配置也可以用复制富文本与下载文稿交付。</span>
                        </div>
                      )}
                    </section>
                  )}
                  {current.link && (
                    <div className="published-link">
                      <Link2 size={14} />
                      <span>{current.link}</span>
                    </div>
                  )}
                </>
              ) : (
                <Empty
                  icon={FileCheck2}
                  title={`${platformName(current.platform)}还缺少内容`}
                  description="其他已就绪平台可以继续交付。补齐此平台内容后，再创建新批次以固定新快照。"
                >
                  <Button onClick={() => setPlatformsOpen(true)} variant="outline" size="default">
                    准备平台版本
                  </Button>
                </Empty>
              )}
            </>
          )}
          <div className="batch-export-footer">
            <span>
              实际包含：
              {batch.items
                .filter(isItemReady)
                .map((item) => platformName(item.platform))
                .join('、') || '暂无可交付内容'}
            </span>
            <Button
              disabled={!batch.items.some(isItemReady)}
              onClick={exportBatch}
              variant="outline"
              size="default"
            >
              <Download size={15} />
              导出已就绪 {batch.items.filter(isItemReady).length} 项清单
            </Button>
          </div>
          <p className="quiet-note">交付清单为 JSON，包含文稿与视频元数据。没有执行外部发布操作。</p>
        </>
      )}
      {marking && (
        <Modal
          title={`${platformName(marking)} · 记录发布结果`}
          description="系统不会替你发布。请在完成手动发布后记录状态。"
          onClose={() => setMarking(null)}
          footer={
            <>
              <span className="text-muted-foreground sm:mr-auto">
                {confirmed ? '已确认手动完成发布，可以保存记录。' : '勾选确认后可保存'}
              </span>
              <Button onClick={() => setMarking(null)} variant="outline" size="default">
                取消
              </Button>
              <Button disabled={!confirmed} onClick={markPublished} variant="default" size="default">
                保存发布记录
              </Button>
            </>
          }
        >
          <Field label="发布链接（可选）">
            <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" />
          </Field>
          <CheckOption checked={confirmed} onChange={setConfirmed}>
            我已在对应平台手动完成发布
          </CheckOption>
          {error && <p className="form-error">{error}</p>}
        </Modal>
      )}
      {showHistory && (
        <Modal
          wide
          title="发布批次与记录"
          description="每一批次绑定自己的平台与内容快照。"
          onClose={() => setShowHistory(false)}
        >
          {project.batches.length ? (
            project.batches.map((item) => (
              <Button
                className="publish-history-item h-auto justify-start whitespace-normal"
                key={item.id}
                onClick={() => {
                  setBatchId(item.id)
                  setCurrentPlatform(item.items[0]!.platform)
                  setShowHistory(false)
                }}
                variant="ghost"
                size="default"
              >
                <div>
                  <strong>批次 {item.id.slice(0, 6)}</strong>
                  <span>
                    {dateLabel(item.at)} · {item.items.map((i) => platformName(i.platform)).join(' / ')}
                  </span>
                </div>
                <Badge tone={item.items.every((i) => i.status === 'published') ? 'green' : 'neutral'}>
                  已记录 {item.items.filter((i) => i.status === 'published').length} / {item.items.length}
                </Badge>
                <ArrowRight size={16} />
              </Button>
            ))
          ) : (
            <Empty
              title="第一批内容，还在路上"
              description="选择本次平台并继续预览后，就会建立一份独立批次记录。"
            />
          )}
        </Modal>
      )}
    </section>
  )
}
function RotateIcon() {
  return <History size={14} />
}

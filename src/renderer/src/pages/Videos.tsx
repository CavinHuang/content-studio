import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Slider } from '@/components/ui/slider'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect } from '@/components/ui/native-select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useEffect, useState, type CSSProperties } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Clapperboard,
  Code2,
  Download,
  Film,
  FileText,
  History,
  Save,
  Maximize2,
  Mic,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RefreshCw,
  Settings2,
  Sparkles,
  Subtitles,
  Trash2,
  TriangleAlert,
  Volume2,
  X,
} from 'lucide-react'
import { Badge, CheckOption, download, Empty, Field, IconButton, Modal, PageTitle } from '../components/ui'
import { useStudio } from '../studio/store'
import { makeVideo } from '../studio/mock'
import { images } from '../studio/images'
import { dateLabel, now, uid, type Shot, type Video, type VideoVersion } from '../studio/types'
function timeLabel(seconds: number) {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`
}
function recalculate(shots: Shot[]) {
  let time = 0
  return shots.map((shot) => {
    const next = {
      ...shot,
      start: time,
      end: time + shot.seconds,
    }
    time += shot.seconds
    return next
  })
}
export function VideosPage() {
  const { project, patchProject, state } = useStudio()
  const [create, setCreate] = useState(false)
  const [mode, setMode] = useState<Video['mode']>('storyboard')
  const [source, setSource] = useState('master')
  const [name, setName] = useState('')
  const selected = project.videos.find((v) => v.id === project.activeVideo)
  function add() {
    const video = makeVideo(
      mode,
      source === 'new' ? '新的创作想法' : project.drafts[source as 'master']?.title || project.title,
    )
    video.title = name.trim() || video.title
    video.ratio = state.preferences.ratio
    if (mode === 'code') {
      video.versions = []
      video.adopted = 0
      video.candidate = undefined
      video.confirmed = false
    }
    patchProject(project.id, (p) => ({
      ...p,
      videos: [...p.videos, video],
      activeVideo: video.id,
    }))
    setCreate(false)
    setName('')
  }
  return (
    <>
      {!selected ? (
        <section className="workspace-page video-library">
          <PageTitle
            eyebrow="FROM WORDS TO SOMETHING YOU CAN SEE"
            title="这次想怎样制作视频？"
            description="每种方式都会创建独立的视频作品。"
            actions={
              <Button
                className="button primary"
                onClick={() => setCreate(true)}
                variant="default"
                size="default"
              >
                <Plus size={15} />
                新建视频作品
              </Button>
            }
          />
          <div className="video-route-grid">
            <Button
              className="video-route h-auto justify-start whitespace-normal text-left grid h-auto gap-3 rounded-xl border p-3"
              onClick={() => {
                setMode('storyboard')
                setCreate(true)
              }}
              variant="ghost"
              size="default"
            >
              <div className="route-art storyboard">
                <img src={images.room} alt="素材分镜示意" />
                <img src={images.notebook} alt="素材卡片示意" />
                <Clapperboard size={24} />
              </div>
              <span className="page-eyebrow">STORYBOARD</span>
              <h2>素材分镜</h2>
              <p>脚本、图片与声音，逐个镜头编排。</p>
              <span className="inline-flex items-center gap-2 text-sm font-medium">
                素材分镜
                <ArrowRight size={15} />
              </span>
            </Button>
            <Button
              className="video-route h-auto justify-start whitespace-normal text-left grid h-auto gap-3 rounded-xl border p-3"
              onClick={() => {
                setMode('code')
                setCreate(true)
              }}
              variant="ghost"
              size="default"
            >
              <div className="route-art animation">
                <span>Aa</span>
                <i />
                <Sparkles size={26} />
                <div>记录 → 整理 → 表达</div>
              </div>
              <span className="page-eyebrow">AGENT CREATIVE</span>
              <h2>Agent 代码创作</h2>
              <p>描述动画意图，通过预览与对话调整。</p>
              <span className="inline-flex items-center gap-2 text-sm font-medium">
                Agent 代码创作
                <ArrowRight size={15} />
              </span>
            </Button>
          </div>
          <div className="section-heading">
            <h2>本篇视频作品</h2>
            <span>{project.videos.length} 个独立作品</span>
          </div>
          <div className="video-work-list">
            {project.videos.map((video) => (
              <Button
                className="video-work-card h-auto justify-start whitespace-normal text-left flex h-auto w-full gap-3 rounded-xl border p-3"
                key={video.id}
                onClick={() =>
                  patchProject(project.id, (p) => ({
                    ...p,
                    activeVideo: video.id,
                  }))
                }
                variant="ghost"
                size="default"
              >
                <div className={`video-work-cover ${video.mode}`}>
                  <span>{video.mode === 'code' ? 'Aa' : <Play size={24} />}</span>
                  {video.mode === 'storyboard' && <img src={images.room} alt="视频示意封面" />}
                </div>
                <div>
                  <Badge tone={video.mode === 'code' ? 'green' : 'neutral'}>
                    {video.mode === 'code' ? 'Agent 代码创作' : '素材分镜'}
                  </Badge>
                  <h3>{video.title}</h3>
                  <p>
                    {video.ratio} · {video.shots.reduce((s, shot) => s + shot.seconds, 0)} 秒 ·{' '}
                    {video.adopted ? `已采用 v${video.adopted}` : '准备中'}
                  </p>
                </div>
                <ArrowRight size={18} />
              </Button>
            ))}
          </div>
          {!project.videos.length && (
            <Empty
              icon={Film}
              title="第一个视频，从这里开始"
              description="两种制作方式彼此独立，可以复用同一篇内容与素材。"
            />
          )}
        </section>
      ) : (
        <VideoWorkspace
          key={selected.id}
          video={selected}
          onBack={() =>
            patchProject(project.id, (p) => ({
              ...p,
              activeVideo: undefined,
            }))
          }
          onNew={() => setCreate(true)}
        />
      )}
      {create && (
        <Modal
          title="这次，想怎样讲述？"
          description="选择制作方式后创建独立作品，两条路线不会互相覆盖。"
          onClose={() => setCreate(false)}
          footer={
            <>
              <span className="small-meta">Mock · 视频工作台</span>
              <Button className="button primary" onClick={add} variant="default" size="default">
                新建视频作品
                <ArrowRight size={15} />
              </Button>
            </>
          }
        >
          <div className="mode-picker">
            <Button
              className={cn(
                mode === 'storyboard' ? 'selected' : '',
                'h-auto justify-start whitespace-normal text-left',
              )}
              onClick={() => setMode('storyboard')}
              variant="ghost"
              size="default"
            >
              <Clapperboard size={28} />
              <strong>素材分镜</strong>
              <p>脚本 · 配图 · 配音与字幕</p>
            </Button>
            <Button
              className={cn(
                mode === 'code' ? 'selected' : '',
                'h-auto justify-start whitespace-normal text-left',
              )}
              onClick={() => setMode('code')}
              variant="ghost"
              size="default"
            >
              <Code2 size={28} />
              <strong>Agent 代码创作</strong>
              <p>视觉说明 · 动画预览 · 候选版本</p>
            </Button>
          </div>
          <Field label="作品名称（可选）">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="给这个视频起个名字" />
          </Field>
          <Field label="从哪里开始">
            <NativeSelect value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="master">当前母稿</option>
              {Object.entries(project.drafts)
                .filter(([key]) => key !== 'master')
                .map(([key, draft]) => (
                  <option key={key} value={key}>
                    {draft.title}
                  </option>
                ))}
              <option value="new">一个新的想法</option>
            </NativeSelect>
          </Field>
        </Modal>
      )}
    </>
  )
}
function VideoWorkspace({ video, onBack, onNew }: { video: Video; onBack: () => void; onNew: () => void }) {
  const { project, patchProject, reference, state, task, notify, controlTask } = useStudio()
  const [tab, setTab] = useState(video.mode === 'code' ? 'preview' : 'shots')
  const [previewNumber, setPreviewNumber] = useState(video.candidate ?? video.adopted)
  const [settings, setSettings] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState(false)
  const [code, setCode] = useState(false)
  const [parameters, setParameters] = useState(false)
  const [shotHistory, setShotHistory] = useState(false)
  const previewVersion = video.versions.find((v) => v.number === previewNumber) ?? video.versions.at(-1)
  const shot = video.shots.find((s) => s.id === video.selectedShot) ?? video.shots[0]!
  const total = video.shots.reduce((s, shot) => s + shot.seconds, 0)
  const running = state.tasks.some((t) => t.state === 'running' && t.videoId === video.id)
  const exportTask = state.tasks.find((t) => t.kind === 'export' && t.videoId === video.id)
  const isCandidate = previewVersion?.number !== video.adopted
  function patch(value: Partial<Video>) {
    patchProject(project.id, (p) => ({
      ...p,
      videos: p.videos.map((v) =>
        v.id === video.id
          ? {
              ...v,
              ...value,
            }
          : v,
      ),
    }))
  }
  function snapshot(number: number, label: string): VideoVersion {
    return {
      number,
      label,
      title: video.title,
      color: '#34583b',
      interval: 0.7,
      sceneTitles: video.shots.map((s) => s.title),
      shots: structuredClone(video.shots),
      settings: {
        ratio: video.ratio,
        resolution: video.resolution,
        fps: video.fps,
        music: video.music,
        voice: video.voice,
        speed: video.speed,
      },
      at: now(),
    }
  }
  function saveShotVersion(label = '手动保存分镜与口播') {
    const next = snapshot(Math.max(0, ...video.versions.map((v) => v.number)) + 1, label)
    patch({
      versions: [...video.versions, next],
      adopted: next.number,
    })
    notify(`已保存视频 v${next.number}，可从版本历史恢复。`)
  }
  function restoreShots(version: VideoVersion) {
    if (!version.shots) return
    const previous = snapshot(Math.max(...video.versions.map((v) => v.number)) + 1, '恢复前的当前编辑')
    const restored = {
      ...version,
      number: previous.number + 1,
      label: `从 v${version.number} 恢复`,
      at: now(),
    }
    patch({
      ...version.settings,
      title: version.title,
      shots: structuredClone(version.shots),
      selectedShot: version.shots[0]?.id ?? '',
      versions: [...video.versions, previous, restored],
      adopted: restored.number,
    })
    setShotHistory(false)
    notify(`已从 v${version.number} 恢复为新版本，恢复前的内容也已保存。`)
  }
  function adoptVersion(version: VideoVersion) {
    if (!version || version.number === video.adopted) return
    // Adopting records a new snapshot (mock seed models adoption the same way), so the
    // candidate itself stays in history and the adopted pointer never mutates a version.
    const next: VideoVersion = {
      ...version,
      number: Math.max(0, ...video.versions.map((v) => v.number)) + 1,
      label: `采用 · v${version.number}`,
      at: now(),
    }
    patch({
      versions: [...video.versions, next],
      adopted: next.number,
      candidate: undefined,
    })
    setPreviewNumber(next.number)
    notify(`已采用 v${version.number}，保存为快照 v${next.number}；此前版本仍可回查。`)
  }
  function saveCodeVersion() {
    if (!previewVersion) return
    // Freeze what the preview shows (animation parameters) together with the live
    // shots and export settings, mirroring the storyboard side's manual save.
    const next: VideoVersion = {
      ...snapshot(Math.max(0, ...video.versions.map((v) => v.number)) + 1, '手动保存当前版本'),
      title: previewVersion.title,
      color: previewVersion.color,
      interval: previewVersion.interval,
      sceneTitles: previewVersion.sceneTitles,
    }
    patch({
      versions: [...video.versions, next],
      adopted: next.number,
      candidate: undefined,
    })
    setPreviewNumber(next.number)
    notify(`已保存当前版本 v${next.number}，可从版本历史回查。`)
  }
  function patchShot(id: string, value: Partial<Shot>) {
    const shots = video.shots.map((s) =>
      s.id === id
        ? {
            ...s,
            ...value,
          }
        : s,
    )
    patch({
      shots: value.seconds !== undefined ? recalculate(shots) : shots,
    })
  }
  function reorder(from: number, to: number) {
    if (to < 0 || to >= video.shots.length) return
    const shots = [...video.shots],
      [item] = shots.splice(from, 1)
    shots.splice(to, 0, item!)
    patch({
      shots: recalculate(shots),
      selectedScene: Math.max(
        0,
        shots.findIndex((s) => s.id === video.selectedShot),
      ),
    })
  }
  function addShot() {
    const next = {
      id: uid(),
      title: '新的镜头',
      visual: '',
      narration: '',
      subtitle: '',
      seconds: 5,
      start: total,
      end: total + 5,
      image: 'garden',
      voiceDirty: true,
    }
    patch({
      shots: [...video.shots, next],
      selectedShot: next.id,
      selectedScene: video.shots.length,
    })
  }
  function generatePreview() {
    const projectId = project.id,
      videoId = video.id
    const number = Math.max(0, ...video.versions.map((v) => v.number)) + 1
    task(
      '生成动画预览',
      '根据创作说明准备一份本地动画示例…',
      'agent',
      (s) => ({
        ...s,
        projects: s.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                videos: p.videos.map((v) =>
                  v.id === videoId
                    ? {
                        ...v,
                        confirmed: true,
                        adopted: v.adopted || number,
                        candidate: v.adopted ? number : undefined,
                        versions: [
                          ...v.versions,
                          {
                            number,
                            title: v.title,
                            color: '#34583b',
                            interval: 0.7,
                            sceneTitles: ['开场字卡', '三步方法', '结尾收束'],
                            label: '按创作说明创建（示例）',
                            at: now(),
                          },
                        ],
                      }
                    : v,
                ),
              }
            : p,
        ),
      }),
      {
        videoId,
      },
    )
    setPreviewNumber(number)
    setTab('preview')
  }
  function candidateVersion() {
    const base = video.versions.find((v) => v.number === video.adopted) ?? previewVersion
    if (!base) return
    const next = {
      ...base,
      number: Math.max(...video.versions.map((v) => v.number)) + 1,
      interval: Math.max(0.3, base.interval - 0.1),
      color: base.color === '#34583b' ? '#b5663f' : '#34583b',
      label: '场景节奏候选（示例）',
      at: now(),
    }
    patch({
      versions: [...video.versions, next],
      candidate: next.number,
    })
    setPreviewNumber(next.number)
    notify('已创建候选，当前采用版本保持不变。')
  }
  function exportManifest() {
    download(
      `${video.title}-v${video.adopted}-演示导出清单-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(
        {
          mock: true,
          note: '这是视频制作清单，未渲染 MP4 文件。',
          snapshot: video,
          exportedAt: now(),
        },
        null,
        2,
      ),
      'application/json',
    )
    notify('已下载制作清单 JSON。演示界面不会生成 MP4。')
  }
  function simulateExport(fail = false) {
    const projectId = project.id,
      videoId = video.id,
      version = video.adopted
    const snapshot = {
      ...structuredClone(video),
      versions: video.versions.filter((v) => v.number === version),
      candidate: undefined,
    }
    const id = task(
      `视频导出 · ${video.title}`,
      '正在演示视频导出队列，不会执行真实编码…',
      'export',
      (s) => ({
        ...s,
        projects: fail
          ? s.projects
          : s.projects.map((p) =>
              p.id === projectId
                ? {
                    ...p,
                    videos: p.videos.map((v) =>
                      v.id === videoId
                        ? {
                            ...v,
                            lastExport: {
                              version,
                              at: now(),
                            },
                          }
                        : v,
                    ),
                  }
                : p,
            ),
      }),
      {
        videoId,
        version,
        snapshot,
      },
    )
    if (fail) {
      // Failure is a deliberately selectable demo outcome; a stopped task cannot be completed later.
      setTimeout(() => {
        // Only update this explicit task, preserving all other tasks and existing video output.
        patchFailure(id)
      }, 450)
    }
    setExporting(false)
    setExportStatus(true)
    notify('演示任务已加入任务中心，可在那里停止或检查结果。')
  }
  const { setState } = useStudio()
  function patchFailure(id: string) {
    setState((s) => ({
      ...s,
      tasks: s.tasks.map((t) =>
        t.id === id && t.state === 'running'
          ? {
              ...t,
              state: 'failed',
              detail: '模拟失败：配乐资源不可用。作品与之前的输出快照均已保留。',
            }
          : t,
      ),
    }))
  }
  const labels =
    video.mode === 'code'
      ? [
          {
            id: 'preview',
            label: '作品预览',
          },
          {
            id: 'brief',
            label: '创作说明',
          },
          {
            id: 'versions',
            label: '版本',
          },
        ]
      : [
          {
            id: 'shots',
            label: '分镜编辑',
          },
          {
            id: 'voice',
            label: '配音与字幕',
          },
          {
            id: 'preview',
            label: '成片预览',
          },
        ]
  return (
    <Tabs
      className="gap-0"
      value={tab}
      onValueChange={(value) => {
        setTab(value)
        setExportStatus(false)
      }}
      asChild
    >
      <section className={`workspace-page video-workspace ${exportStatus ? 'export-status-open' : ''}`}>
        <div className="video-breadcrumb">
          <Button className="text-button text-muted-foreground" onClick={onBack} variant="ghost" size="sm">
            <ArrowLeft size={14} />
            所有视频
          </Button>
          <Button className="text-button text-muted-foreground" onClick={onNew} variant="ghost" size="sm">
            <Plus size={14} />
            新建视频作品
          </Button>
        </div>
        <div className="video-title-row">
          <div>
            <Input
              aria-label="视频作品名称"
              value={video.title}
              onChange={(e) =>
                patch({
                  title: e.target.value,
                })
              }
            />
            <p>
              {video.ratio} · 约 {total} 秒 · 来自「{video.source || '新想法'}」
            </p>
          </div>
          <Badge tone={video.mode === 'code' ? 'green' : 'neutral'}>
            {video.mode === 'code' ? <Code2 size={12} /> : <Clapperboard size={12} />}
            {video.mode === 'code' ? 'Agent 代码创作' : '素材分镜'}
          </Badge>
        </div>
        <div className="video-tabs min-w-0 flex-wrap gap-2">
          <TabsList className="category-tabs max-w-full" variant="line" aria-label="视频制作步骤">
            {labels.map((label) => (
              <TabsTrigger key={label.id} className={tab === label.id ? 'active' : ''} value={label.id}>
                {label.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="video-tools">
            {video.mode === 'storyboard' && (
              <>
                <IconButton icon={History} label="分镜版本历史" onClick={() => setShotHistory(true)} />
                <IconButton icon={Save} label="保存视频版本" onClick={() => saveShotVersion()} />
              </>
            )}
            {video.mode === 'code' && (
              <IconButton
                icon={Save}
                label="保存当前版本"
                disabled={!previewVersion}
                onClick={saveCodeVersion}
              />
            )}
            <IconButton icon={Settings2} label="视频全局设置" onClick={() => setSettings(true)} />
          </div>
        </div>
        {exportStatus && (
          <section className="export-recovery-panel" aria-label="视频导出状态">
            <Button
              className="text-button text-muted-foreground"
              variant="ghost"
              size="sm"
              onClick={() => setExportStatus(false)}
            >
              <ArrowLeft size={15} />
              返回作品预览
            </Button>
            <div className="section-heading">
              <h2>视频导出</h2>
              <Badge
                tone={
                  exportTask?.state === 'failed'
                    ? 'red'
                    : exportTask?.state === 'complete'
                      ? 'green'
                      : 'orange'
                }
              >
                {exportTask?.state === 'failed'
                  ? '演示导出未完成'
                  : exportTask?.state === 'complete'
                    ? '演示流程已完成'
                    : exportTask?.state === 'stopped'
                      ? '演示已停止'
                      : '演示任务进行中'}
              </Badge>
            </div>
            <div className={`export-result-card ${exportTask?.state === 'failed' ? 'failed' : ''}`}>
              <div className="export-result-title">
                <Film size={24} />
                <strong>本次固定快照 v{exportTask?.version ?? video.adopted}</strong>
                <Badge>演示 · 未生成 MP4</Badge>
              </div>
              <ol className="export-phases">
                <li className="done">
                  <Check size={18} />
                  <span>
                    保留作品快照<small>文稿与修改均已保留</small>
                  </span>
                </li>
                <li className={exportTask?.state === 'failed' ? 'failed' : ''}>
                  {exportTask?.state === 'failed' ? <TriangleAlert size={18} /> : <RefreshCw size={18} />}
                  <span>
                    演示导出流程
                    <small>
                      {exportTask?.state === 'failed'
                        ? '配乐资源不可用'
                        : exportTask?.state === 'complete'
                          ? '状态演示完成'
                          : exportTask?.state === 'stopped'
                            ? '已停止'
                            : '等待任务结果'}
                    </small>
                  </span>
                </li>
                <li>
                  <Film size={18} />
                  <span>
                    真实文件编码<small>尚未接入编码器</small>
                  </span>
                </li>
              </ol>
              <p role="status">{exportTask?.detail ?? '作品已保留，可返回继续编辑。'}</p>
              <div className="button-row">
                {exportTask && ['failed', 'stopped'].includes(exportTask.state) && (
                  <Button variant="default" onClick={() => controlTask(exportTask.id, 'retry')}>
                    <RefreshCw size={15} />
                    重试演示
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    setExportStatus(false)
                    setSettings(true)
                  }}
                >
                  调整导出设置
                </Button>
                <Button variant="outline" onClick={exportManifest}>
                  <Download size={15} />
                  下载制作清单
                </Button>
              </div>
            </div>
            <div className="export-preserved">
              <Check size={18} />
              <span>当前作品与已采用版本保留，可以返回继续修改。</span>
            </div>
            {video.lastExport && (
              <div className="previous-export">
                <FileText size={28} />
                <div>
                  <h3>上次演示快照 v{video.lastExport.version}</h3>
                  <p>{dateLabel(video.lastExport.at)} · 仅记录任务演示，不是可播放的成片</p>
                </div>
              </div>
            )}
          </section>
        )}
        <TabsContent value={tab} className="video-content">
          {video.mode === 'code' && (!video.confirmed || tab === 'brief') ? (
            <div className="code-brief">
              <div className="section-heading">
                <h2>你希望观众看到什么？</h2>
                <Badge>可直接修改</Badge>
              </div>
              <Field label="视觉与动画说明">
                <Textarea
                  rows={8}
                  value={video.brief}
                  onChange={(e) =>
                    patch({
                      brief: e.target.value,
                    })
                  }
                  placeholder="描述画面、情绪、节奏和关键文案…"
                />
              </Field>
              <div className="visual-plan">
                <span>视觉方案（示例）</span>
                <h3>米白留白 · 自然生长 · 三步叙事</h3>
                <div>
                  {['开场提出问题', '记录 → 整理 → 表达', '每天留一点，周末写成一篇'].map((scene, i) => (
                    <p key={scene}>
                      <span>0{i + 1}</span>
                      {scene}
                    </p>
                  ))}
                </div>
              </div>
              <div className="button-row">
                <Button
                  className="button secondary"
                  onClick={() => reference('视频创作说明', video.brief)}
                  variant="outline"
                  size="default"
                >
                  和 Agent 调整
                </Button>
                <Button
                  className="button primary"
                  disabled={running || !video.brief.trim()}
                  onClick={generatePreview}
                  variant="default"
                  size="default"
                >
                  <Sparkles size={15} />
                  {running
                    ? '准备预览中…'
                    : video.confirmed
                      ? '按说明新建预览'
                      : '确认说明，生成示例预览'}
                </Button>
              </div>
              {video.confirmed && (
                <p className="small-meta">
                  重新准备预览前，请先用上方工具条的「保存当前版本」保存。本演示复用三场景模板。
                </p>
              )}
            </div>
          ) : (
            <>
              {video.mode === 'code' && tab === 'versions' ? (
                <div className="video-version-list">
                  {[...video.versions].reverse().map((version) => {
                    const isCurrent = video.adopted === version.number
                    return (
                      <Card key={version.number} role="article" className="flex-wrap gap-3 p-3">
                        <div className="version-art">Aa</div>
                        <div>
                          <h3>
                            v{version.number} · {version.label}
                          </h3>
                          <p>
                            {dateLabel(version.at)} · {version.interval.toFixed(1)} 秒间隔
                          </p>
                          <Badge tone={isCurrent ? 'green' : 'orange'}>
                            {isCurrent ? '当前已采用' : '历史 / 候选'}
                          </Badge>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            className="button secondary small"
                            onClick={() => {
                              setPreviewNumber(version.number)
                              setTab('preview')
                            }}
                            variant="outline"
                            size="sm"
                          >
                            预览此版
                          </Button>
                          {!isCurrent && (
                            <Button
                              className="button primary small"
                              onClick={() => adoptVersion(version)}
                              variant="default"
                              size="sm"
                            >
                              采用此版
                            </Button>
                          )}
                        </div>
                      </Card>
                    )
                  })}
                </div>
              ) : video.mode === 'storyboard' && tab === 'shots' ? (
                <>
                  <div className="section-heading">
                    <span>{video.shots.length} 个镜头 · 拖动排序</span>
                    <Button
                      className="text-button text-muted-foreground"
                      onClick={addShot}
                      variant="ghost"
                      size="sm"
                    >
                      <Plus size={15} />
                      添加镜头
                    </Button>
                  </div>
                  <div className="shot-list">
                    {video.shots.map((item, index) => (
                      <Card
                        className={cn(
                          `shot-card ${video.selectedShot === item.id ? 'selected' : ''}`,
                          'gap-0 p-0 grid',
                        )}
                        key={item.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', String(index))}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault()
                          const from = +e.dataTransfer.getData('text/plain')
                          if (Number.isInteger(from)) reorder(from, index)
                        }}
                        role="article"
                      >
                        <header>
                          <Button
                            className="shot-select h-auto justify-start whitespace-normal p-0 text-left"
                            onClick={() =>
                              patch({
                                selectedShot: item.id,
                                selectedScene: index,
                              })
                            }
                            variant="ghost"
                            size="default"
                          >
                            <span>{String(index + 1).padStart(2, '0')}</span>
                            <strong>{item.title}</strong>
                          </Button>
                          <span className="small-meta">
                            {timeLabel(item.start)} — {timeLabel(item.end)}
                          </span>
                          <IconButton
                            icon={ArrowUp}
                            label={`上移镜头 ${index + 1}`}
                            disabled={!index}
                            onClick={() => reorder(index, index - 1)}
                          />
                          <IconButton
                            icon={ArrowDown}
                            label={`下移镜头 ${index + 1}`}
                            disabled={index === video.shots.length - 1}
                            onClick={() => reorder(index, index + 1)}
                          />
                          <IconButton
                            icon={Trash2}
                            label={`删除镜头 ${index + 1}`}
                            disabled={video.shots.length <= 1}
                            onClick={() =>
                              patch({
                                shots: recalculate(video.shots.filter((s) => s.id !== item.id)),
                                selectedShot: video.shots.find((s) => s.id !== item.id)?.id ?? '',
                                selectedScene: 0,
                              })
                            }
                          />
                        </header>
                        <div className="shot-card-content">
                          <div className="shot-visual [&>[data-slot=native-select-wrapper]]:w-full">
                            <img
                              src={
                                images[item.image] ??
                                state.materials.find((m) => m.id === item.image)?.data ??
                                images.room
                              }
                              alt={item.visual || '镜头示例插画'}
                            />
                            <NativeSelect
                              aria-label={`镜头 ${index + 1} 配图`}
                              value={item.image}
                              onChange={(e) =>
                                patchShot(item.id, {
                                  image: e.target.value,
                                })
                              }
                            >
                              {Object.entries({
                                room: '晨光书桌',
                                notebook: '纸上记录',
                                city: '沿途城市',
                                garden: '日常留白',
                              }).map(([key, text]) => (
                                <option value={key} key={key}>
                                  {text}
                                </option>
                              ))}
                              {state.materials
                                .filter((m) => m.type === 'image' && !m.trashed && m.data)
                                .map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.title}
                                  </option>
                                ))}
                            </NativeSelect>
                          </div>
                          <div className="shot-fields">
                            <Field label="画面描述">
                              <Input
                                value={item.visual}
                                onChange={(e) =>
                                  patchShot(item.id, {
                                    visual: e.target.value,
                                  })
                                }
                              />
                            </Field>
                            <Field label="口播文案">
                              <Textarea
                                rows={2}
                                value={item.narration}
                                onChange={(e) =>
                                  patchShot(item.id, {
                                    narration: e.target.value,
                                    voiceDirty: true,
                                  })
                                }
                              />
                            </Field>
                            <div className="shot-bottom">
                              <label className="whitespace-nowrap">
                                时长{' '}
                                <Input
                                  aria-label={`镜头 ${index + 1} 时长`}
                                  className="w-16"
                                  type="number"
                                  min="1"
                                  max="60"
                                  value={item.seconds}
                                  onChange={(e) =>
                                    patchShot(item.id, {
                                      seconds: Math.min(60, Math.max(1, Number(e.target.value) || 1)),
                                      voiceDirty: true,
                                    })
                                  }
                                />{' '}
                                秒
                              </label>
                              <Button
                                className="text-button text-muted-foreground"
                                onClick={() =>
                                  reference(
                                    `视频「${video.title}」· 镜头 ${index + 1}`,
                                    `${item.visual}\n${item.narration}`,
                                  )
                                }
                                variant="ghost"
                                size="sm"
                              >
                                <Sparkles size={14} />
                                交给 Agent
                              </Button>
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                  <Button
                    className="button secondary wide-button"
                    onClick={addShot}
                    variant="outline"
                    size="default"
                  >
                    <Plus size={16} />
                    再加一个镜头
                  </Button>
                </>
              ) : video.mode === 'storyboard' && tab === 'voice' ? (
                <>
                  <div className="voice-settings">
                    <Field label="声音（示例）">
                      <NativeSelect
                        value={video.voice}
                        onChange={(e) =>
                          patch({
                            voice: e.target.value,
                            shots: video.shots.map((s) => ({
                              ...s,
                              voiceDirty: true,
                            })),
                          })
                        }
                      >
                        <option>自然叙述（Mock）</option>
                        <option>温暖分享（示例）</option>
                        <option>清晰讲解（示例）</option>
                      </NativeSelect>
                    </Field>
                    <Field label="语速">
                      <NativeSelect
                        value={video.speed}
                        onChange={(e) =>
                          patch({
                            speed: e.target.value,
                            shots: video.shots.map((s) => ({
                              ...s,
                              voiceDirty: true,
                            })),
                          })
                        }
                      >
                        {['0.8', '1.0', '1.2'].map((speed) => (
                          <option key={speed}>{speed}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <Button
                      className="button secondary"
                      onClick={() => notify('试听交互演示：尚未连接语音服务，本次不会播放真实配音。')}
                      variant="outline"
                      size="default"
                    >
                      <Volume2 size={15} />
                      试听示例
                    </Button>
                  </div>
                  <p className="inline-note">口播变化后，配音标记为待更新；你修改的字幕文字会保留。</p>
                  <div className="section-heading subtitle-section-heading">
                    <h2>字幕校对</h2>
                    <span className="small-meta">{video.shots.length} 条字幕 · 文字与时间可独立修改</span>
                  </div>
                  <div className="subtitle-list">
                    <div className="subtitle-table-heading" aria-hidden="true">
                      <span>镜头</span>
                      <span>字幕文字</span>
                      <span>显示时间（秒）</span>
                      <span>预览</span>
                    </div>
                    {video.shots.map((item, index) => (
                      <div
                        key={item.id}
                        role="article"
                        className={cn(
                          `subtitle-row ${video.selectedShot === item.id ? 'selected' : ''}`,
                          'gap-3 p-3 grid',
                        )}
                      >
                        <header>
                          <CheckOption
                            checked={video.selectedShot === item.id}
                            onChange={() =>
                              patch({
                                selectedShot: item.id,
                                selectedScene: index,
                              })
                            }
                          >
                            <span className="subtitle-index">{String(index + 1).padStart(2, '0')}</span>
                            <span className="subtitle-shot-title">{item.title}</span>
                          </CheckOption>
                          <Badge tone={item.voiceDirty ? 'orange' : 'green'}>
                            {item.voiceDirty ? '配音待更新' : '示例已就绪'}
                          </Badge>
                        </header>
                        <details className="subtitle-narration">
                          <summary>编辑口播 · {item.title}</summary>
                          <Field label="口播">
                            <Textarea
                              value={item.narration}
                              rows={2}
                              onChange={(e) =>
                                patchShot(item.id, {
                                  narration: e.target.value,
                                  voiceDirty: true,
                                })
                              }
                            />
                          </Field>
                        </details>
                        <Field label="字幕文字（可独立校对）">
                          <Input
                            value={item.subtitle}
                            onChange={(e) =>
                              patchShot(item.id, {
                                subtitle: e.target.value,
                              })
                            }
                          />
                        </Field>
                        <div className="subtitle-time">
                          <span>显示时间</span>
                          <Input
                            aria-label={`字幕 ${index + 1} 开始时间`}
                            type="number"
                            min="0"
                            max={item.end - 0.1}
                            step=".1"
                            value={item.start}
                            onChange={(e) =>
                              patch({
                                shots: video.shots.map((s) =>
                                  s.id === item.id
                                    ? {
                                        ...s,
                                        start: Math.max(
                                          0,
                                          Math.min(Number(e.target.value) || 0, s.end - 0.1),
                                        ),
                                      }
                                    : s,
                                ),
                              })
                            }
                          />
                          <span>—</span>
                          <Input
                            aria-label={`字幕 ${index + 1} 结束时间`}
                            type="number"
                            min={item.start + 0.1}
                            max={total}
                            step=".1"
                            value={item.end}
                            onChange={(e) =>
                              patch({
                                shots: video.shots.map((s) =>
                                  s.id === item.id
                                    ? {
                                        ...s,
                                        end: Math.min(
                                          total,
                                          Math.max(Number(e.target.value) || 0, s.start + 0.1),
                                        ),
                                      }
                                    : s,
                                ),
                              })
                            }
                          />
                          <span>秒</span>
                        </div>
                        <IconButton
                          icon={Play}
                          label={`预览字幕片段 ${index + 1}`}
                          onClick={() => {
                            patch({ selectedShot: item.id, selectedScene: index })
                            notify(`已选中镜头 ${index + 1}，成片预览可查看对应画面；配音尚未生成。`)
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="button-row">
                    <Button
                      className="button secondary"
                      onClick={() => {
                        const srt = video.shots
                          .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.subtitle}`)
                          .join('\n\n')
                        download(`${video.title}.srt`, srt)
                        notify('SRT 已导出，包含当前字幕与时间戳。')
                      }}
                      variant="outline"
                      size="default"
                    >
                      <Download size={15} />
                      导出 SRT
                    </Button>
                    <Button
                      className="button primary"
                      disabled={running}
                      onClick={() => {
                        const projectId = project.id,
                          shotId = video.selectedShot,
                          videoId = video.id
                        task(
                          '更新所选镜头配音',
                          '演示配音更新，字幕文本保持原样…',
                          'agent',
                          (s) => ({
                            ...s,
                            projects: s.projects.map((p) =>
                              p.id === projectId
                                ? {
                                    ...p,
                                    videos: p.videos.map((v) =>
                                      v.id === videoId
                                        ? {
                                            ...v,
                                            shots: v.shots.map((s) =>
                                              s.id === shotId
                                                ? {
                                                    ...s,
                                                    voiceDirty: false,
                                                  }
                                                : s,
                                            ),
                                          }
                                        : v,
                                    ),
                                  }
                                : p,
                            ),
                          }),
                          {
                            videoId,
                          },
                        )
                        notify('正在演示所选镜头的更新，请保留手改字幕并校对时间。')
                      }}
                      variant="default"
                      size="default"
                    >
                      <Mic size={15} />
                      更新所选镜头配音
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="preview-topline">
                    {video.mode === 'code' && (
                      <>
                        <NativeSelect
                          aria-label="动画预览版本"
                          value={previewVersion?.number}
                          onChange={(e) => setPreviewNumber(Number(e.target.value))}
                        >
                          {[...video.versions].reverse().map((v) => (
                            <option value={v.number} key={v.number}>
                              {v.number === video.adopted ? '已采用' : '历史 / 候选'} v{v.number}
                            </option>
                          ))}
                        </NativeSelect>
                        <Badge tone={isCandidate ? 'orange' : 'green'}>
                          {isCandidate ? '正在预览，尚未采用' : '当前已采用'}
                        </Badge>
                        {isCandidate && previewVersion && (
                          <Button
                            className="button primary small"
                            onClick={() => adoptVersion(previewVersion)}
                            variant="default"
                            size="sm"
                          >
                            采用此版
                          </Button>
                        )}
                        <Button
                          className="text-button text-muted-foreground"
                          onClick={() => setCode(true)}
                          variant="ghost"
                          size="sm"
                        >
                          <Code2 size={14} />
                          查看代码
                        </Button>
                      </>
                    )}
                    <span className="small-meta">本地界面预览 · 无音轨</span>
                  </div>
                  <VideoPlayer video={video} version={previewVersion} />
                  <div className="scene-strip">
                    {video.shots.map((s, i) => (
                      <Button
                        key={s.id}
                        className={cn(
                          (video.mode === 'code' ? video.selectedScene === i : video.selectedShot === s.id)
                            ? 'selected'
                            : '',
                          'h-auto justify-start whitespace-normal text-left',
                        )}
                        onClick={() =>
                          patch({
                            selectedShot: s.id,
                            selectedScene: i,
                          })
                        }
                        variant="ghost"
                        size="default"
                      >
                        <span>0{i + 1}</span>
                        <div>
                          <strong>{video.mode === 'code' ? previewVersion?.sceneTitles[i] : s.title}</strong>
                          <small>
                            {timeLabel(video.shots.slice(0, i).reduce((n, s) => n + s.seconds, 0))} —{' '}
                            {timeLabel(video.shots.slice(0, i + 1).reduce((n, s) => n + s.seconds, 0))}
                          </small>
                        </div>
                      </Button>
                    ))}
                  </div>
                  {video.mode === 'code' ? (
                    <div className="scene-parameters">
                      <div>
                        <Sparkles size={17} />
                        <strong>场景 0{video.selectedScene + 1} · 声明的可调参数</strong>
                      </div>
                      <Button
                        className="button secondary small"
                        onClick={() => setParameters(true)}
                        variant="outline"
                        size="sm"
                      >
                        调整文案与颜色
                      </Button>
                      <Button
                        className="text-button text-muted-foreground"
                        onClick={() =>
                          reference(
                            `动画「${video.title}」· 场景 ${video.selectedScene + 1}`,
                            previewVersion?.sceneTitles[video.selectedScene] ?? video.brief,
                          )
                        }
                        variant="ghost"
                        size="sm"
                      >
                        和 Agent 调整
                      </Button>
                    </div>
                  ) : (
                    <div className="scene-parameters">
                      <Field label={`当前镜头 · ${shot.title}`}>
                        <Input
                          value={shot.subtitle}
                          onChange={(e) =>
                            patchShot(shot.id, {
                              subtitle: e.target.value,
                            })
                          }
                        />
                      </Field>
                      <Button
                        className="button secondary small"
                        onClick={() => setTab('shots')}
                        variant="outline"
                        size="sm"
                      >
                        编辑镜头
                      </Button>
                    </div>
                  )}
                  {video.mode === 'code' && (
                    <div className={`candidate-bar ${isCandidate ? 'pending' : ''}`}>
                      <span>
                        当前已采用 v{video.adopted}
                        {isCandidate ? ` · 正在预览 v${previewVersion?.number}` : ' · 可继续创建候选'}
                      </span>
                      {isCandidate ? (
                        <div className="button-row">
                          <Button
                            className="button secondary small"
                            onClick={() => {
                              patch({
                                candidate: undefined,
                              })
                              setPreviewNumber(video.adopted)
                            }}
                            variant="outline"
                            size="sm"
                          >
                            保留已采用版
                          </Button>
                        </div>
                      ) : (
                        <Button
                          className="button secondary small"
                          onClick={candidateVersion}
                          variant="outline"
                          size="sm"
                        >
                          <Sparkles size={14} />
                          演示生成候选
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
          <div className="video-bottom-bar">
            <span className="small-meta">
              {video.lastExport
                ? `上次演示快照 v${video.lastExport.version}${video.lastExport.version !== video.adopted ? ' · 未包含最新修改' : ''}`
                : '预览不等于已导出文件'}
            </span>
            <Button className="button secondary" onClick={exportManifest} variant="outline" size="default">
              <Download size={15} />
              制作清单
            </Button>
            <Button
              className="button primary"
              disabled={!video.confirmed || running}
              onClick={() => {
                if (video.mode === 'storyboard') saveShotVersion('导出前分镜快照')
                setExporting(true)
              }}
              variant="default"
              size="default"
            >
              <Film size={15} />
              导出视频
            </Button>
          </div>
          {settings && (
            <Modal
              title="视频设置 · 全片范围"
              description="仅影响当前视频作品，与文章主题独立。"
              onClose={() => setSettings(false)}
              footer={
                <Button
                  className="button primary"
                  onClick={() => {
                    setSettings(false)
                    notify('设置已保存到当前视频作品。')
                  }}
                  variant="default"
                  size="default"
                >
                  完成
                </Button>
              }
            >
              <div className="form-grid">
                <Field label="画面比例">
                  <NativeSelect
                    value={video.ratio}
                    onChange={(e) =>
                      patch({
                        ratio: e.target.value as Video['ratio'],
                      })
                    }
                  >
                    {['9:16', '16:9', '1:1'].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field label="分辨率">
                  <NativeSelect
                    value={video.resolution}
                    onChange={(e) =>
                      patch({
                        resolution: e.target.value,
                      })
                    }
                  >
                    <option>1080 × 1920</option>
                    <option>1920 × 1080</option>
                    <option>1080 × 1080</option>
                  </NativeSelect>
                </Field>
                <Field label="帧率">
                  <NativeSelect
                    value={video.fps}
                    onChange={(e) =>
                      patch({
                        fps: Number(e.target.value),
                      })
                    }
                  >
                    <option>24</option>
                    <option>30</option>
                    <option>60</option>
                  </NativeSelect>
                </Field>
                <Field label="背景音乐">
                  <NativeSelect
                    value={video.music}
                    onChange={(e) =>
                      patch({
                        music: e.target.value,
                      })
                    }
                  >
                    <option>轻柔钢琴（示例）</option>
                    <option>环境氛围（示例）</option>
                    <option>无配乐</option>
                  </NativeSelect>
                </Field>
              </div>
              <div className="inline-alert">这些是导出参数的演示选项，尚未连接真实编码器或音乐资源。</div>
            </Modal>
          )}
          {exporting && (
            <Modal
              title="准备导出当前作品"
              description={`固定当前已采用 v${video.adopted} 的快照；候选内容不会混入本次输出。`}
              onClose={() => setExporting(false)}
              footer={
                <>
                  <Button
                    className="button secondary"
                    onClick={exportManifest}
                    variant="outline"
                    size="default"
                  >
                    下载制作清单
                  </Button>
                  <Button
                    className="button primary"
                    onClick={() => simulateExport()}
                    variant="default"
                    size="default"
                  >
                    演示成功流程
                  </Button>
                </>
              }
            >
              <div className="export-spec">
                <Film size={32} />
                <div>
                  <h3>{video.title}</h3>
                  <p>
                    {video.ratio} · {video.resolution} · {video.fps} fps · MP4（目标格式）
                  </p>
                </div>
              </div>
              <div className="inline-alert orange">
                演示只运行任务状态，不生成 MP4。可以下载包含脚本、镜头和设置的制作清单，SRT
                从字幕页单独导出。
              </div>
              <Button
                className="text-button danger-text text-destructive"
                onClick={() => simulateExport(true)}
                variant="ghost"
                size="sm"
              >
                演练一次失败与恢复
              </Button>
            </Modal>
          )}
          {shotHistory && (
            <Modal
              title="分镜作品 · 版本历史"
              description="恢复会创建新版本，并保留恢复前的编辑。"
              onClose={() => setShotHistory(false)}
            >
              <Button
                className="button secondary"
                onClick={() => saveShotVersion()}
                variant="outline"
                size="default"
              >
                <Save size={15} />
                先保存当前版本
              </Button>
              <div className="video-version-list">
                {[...video.versions].reverse().map((version) => {
                  const isCurrent = video.adopted === version.number
                  return (
                    <Card key={version.number} role="article" className="gap-3 p-3">
                      <div>
                        <h3>
                          v{version.number} · {version.label}
                        </h3>
                        <p>
                          {dateLabel(version.at)} · {version.shots?.length ?? video.shots.length} 个镜头
                        </p>
                        <span className="small-meta">
                          {version.shots
                            ? version.shots.map((s) => s.title).join(' / ')
                            : '初始示例记录，无恢复快照'}
                        </span>
                        {isCurrent && <Badge tone="green">当前版本</Badge>}
                      </div>
                      {!isCurrent && (
                        <Button
                          className="button secondary small"
                          disabled={!version.shots}
                          onClick={() => restoreShots(version)}
                          variant="outline"
                          size="sm"
                        >
                          恢复为新版本
                        </Button>
                      )}
                    </Card>
                  )
                })}
              </div>
            </Modal>
          )}
          {parameters && previewVersion && (
            <ParameterDialog
              version={previewVersion}
              video={video}
              onClose={() => setParameters(false)}
              onSave={(value) => {
                const next = {
                  ...previewVersion,
                  ...value,
                  number: Math.max(...video.versions.map((v) => v.number)) + 1,
                  label: '手动调整参数',
                  at: now(),
                }
                patch({
                  versions: [...video.versions, next],
                  candidate: next.number,
                })
                setPreviewNumber(next.number)
                setParameters(false)
                notify('参数已保存为候选版本，采用前不改变当前作品。')
              }}
            />
          )}
          {code && (
            <Modal
              wide
              title="动画代码 · 高级只读视图"
              description="以下是示例模板，界面未执行用户输入的代码；动画预览由本地组件呈现。"
              onClose={() => setCode(false)}
            >
              <pre className="code-view">{`// Mock composition — read-only illustration\nconst composition = {\n  title: ${JSON.stringify(previewVersion?.title)},\n  aspectRatio: ${JSON.stringify(video.ratio)},\n  accent: ${JSON.stringify(previewVersion?.color)},\n  interval: ${previewVersion?.interval},\n  scenes: ${JSON.stringify(previewVersion?.sceneTitles, null, 2)}\n};\n\n// The rendering engine will be integrated separately.\n// No external compilation or encoding is performed.`}</pre>
            </Modal>
          )}
        </TabsContent>
      </section>
    </Tabs>
  )
}
function ParameterDialog({
  version,
  video,
  onSave,
  onClose,
}: {
  version: VideoVersion
  video: Video
  onSave: (value: Partial<VideoVersion>) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(version.title),
    [color, setColor] = useState(version.color),
    [interval, setIntervalValue] = useState(version.interval)
  const [scene, setScene] = useState(version.sceneTitles[video.selectedScene] ?? '')
  return (
    <Modal
      title={`场景 0${video.selectedScene + 1} · 可调参数`}
      description="模板只开放这些参数；保存后形成候选版本。"
      onClose={onClose}
      footer={
        <Button
          className="button primary"
          disabled={!title.trim() || !scene.trim()}
          onClick={() =>
            onSave({
              title,
              color,
              interval,
              sceneTitles: version.sceneTitles.map((s, i) => (i === video.selectedScene ? scene : s)),
            })
          }
          variant="default"
          size="default"
        >
          保存为候选版本
        </Button>
      }
    >
      <Field label="画面主标题">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="场景名称">
        <Input value={scene} onChange={(e) => setScene(e.target.value)} />
      </Field>
      <div className="form-grid">
        <Field label="强调色">
          <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </Field>
        <Field label={`步骤间隔 ${interval.toFixed(1)} 秒`}>
          <Slider
            min={0.3}
            max={1.5}
            step={0.1}
            value={[interval]}
            onValueChange={(e) => setIntervalValue(Number(e[0]))}
            aria-label="步骤间隔"
          />
        </Field>
      </div>
    </Modal>
  )
}
function VideoPlayer({ video, version }: { video: Video; version?: VideoVersion }) {
  const { state, notify } = useStudio()
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0)
  const total = video.shots.reduce((sum, s) => sum + s.seconds, 0)
  useEffect(() => {
    let elapsed = 0
    for (let i = 0; i < video.selectedScene; i++) elapsed += video.shots[i]?.seconds ?? 0
    setTime(elapsed)
    setPlaying(false)
  }, [video.selectedScene, version?.number])
  useEffect(() => {
    if (!playing) return
    const timer = setInterval(
      () =>
        setTime((t) => {
          if (t >= total) {
            setPlaying(false)
            return 0
          }
          return Math.min(total, t + 0.1)
        }),
      100,
    )
    return () => clearInterval(timer)
  }, [playing, total])
  let runningTime = 0
  const index = Math.max(
    0,
    video.shots.findIndex((s) => {
      runningTime += s.seconds
      return time < runningTime
    }),
  )
  const shot = video.shots[index] ?? video.shots[0]!
  return (
    <div className="video-player">
      <div
        className={`video-stage ${video.ratio === '16:9' ? 'landscape' : video.ratio === '1:1' ? 'square' : ''}`}
      >
        <div
          className={`video-canvas ${video.mode} ${playing ? 'playing' : ''} scene-${index}`}
          style={
            {
              '--accent-video': version?.color ?? '#34583b',
              '--animation-interval': `${version?.interval ?? 0.6}s`,
            } as CSSProperties
          }
        >
          {video.mode === 'storyboard' ? (
            <>
              <img
                src={
                  images[shot.image] ?? state.materials.find((m) => m.id === shot.image)?.data ?? images.room
                }
                alt={shot.visual || '镜头画面示意'}
              />
              <div className="video-picture-title">{shot.title}</div>
              <div className="video-caption">{shot.subtitle}</div>
            </>
          ) : (
            <>
              <div className="canvas-circle one" />
              <div className="canvas-circle two" />
              <span className="canvas-eyebrow">A LITTLE EVERY DAY</span>
              <h2>{index === 2 ? '每天留一点，\n周末写成一篇。' : version?.title || '让灵感成为作品'}</h2>
              {index === 0 ? (
                <div className="canvas-opening">
                  <Sparkles size={40} />
                  <p>一个念头，也值得被记住。</p>
                </div>
              ) : index === 1 ? (
                <div className="canvas-steps">
                  {['记录', '整理', '表达'].map((step, i) => (
                    <div
                      key={step}
                      style={{
                        animationDelay: `${i * (version?.interval ?? 0.6)}s`,
                      }}
                    >
                      <span>{['01', '02', '03'][i]}</span>
                      <strong>{step}</strong>
                      {i < 2 && <ArrowDown size={19} />}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="canvas-ending">
                  <span>慢慢来，作品会生长。</span>
                  <i />
                </div>
              )}
              <div className="canvas-signature">CONTENT STUDIO · DEMO</div>
            </>
          )}
        </div>
      </div>
      <div className="video-playback">
        <IconButton
          icon={playing ? Pause : Play}
          label={playing ? '暂停预览' : '播放预览'}
          onClick={() => setPlaying((value) => !value)}
        />
        <span>
          {timeLabel(time)} / {timeLabel(total)}
        </span>
        <Slider
          aria-label="视频预览进度"
          min={0}
          max={total}
          step={0.1}
          value={[time]}
          onValueChange={(e) => {
            setTime(Number(e[0]))
            setPlaying(false)
          }}
        />
        <IconButton
          icon={Maximize2}
          label="全屏预览"
          onClick={() => {
            void document
              .querySelector('.video-stage')
              ?.requestFullscreen()
              .catch(() => notify('当前运行环境暂不支持全屏。'))
          }}
        />
      </div>
    </div>
  )
}
function srtTime(seconds: number) {
  const milliseconds = Math.round(seconds * 1000)
  return `${Math.floor(milliseconds / 3600000)
    .toString()
    .padStart(2, '0')}:${Math.floor((milliseconds / 60000) % 60)
    .toString()
    .padStart(2, '0')}:${Math.floor((milliseconds / 1000) % 60)
    .toString()
    .padStart(2, '0')},${(milliseconds % 1000).toString().padStart(3, '0')}`
}

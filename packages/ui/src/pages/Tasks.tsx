import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  Clock3,
  Download,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Badge, download, Empty, PageTitle } from '../components/ui'
import { useStudio } from '../studio/store'
import { dateLabel, type Task } from '../studio/types'
const labels = {
  queued: '排队中',
  running: '运行中',
  failed: '失败',
  stopped: '已停止',
  complete: '已完成',
}
export function TasksPage() {
  const { state, controlTask, selectProject, patchProject, notify, navigate } = useStudio()
  const [filter, setFilter] = useState('all')
  const allTasksFilter = useRef<HTMLButtonElement>(null)
  function viewTask(task: Task) {
    if (task.kind === 'source') {
      navigate('sources')
      return
    }
    if (task.kind === 'creation') patchProject(task.projectId, (p) => ({ ...p, activePlatform: 'master' }))
    selectProject(task.projectId, task.videoId ? 'video' : 'article')
  }
  function needsInput(task: Task) {
    const flow = state.projects.find((p) => p.id === task.projectId)?.creation
    return task.kind === 'creation' && flow?.status === 'blocked' && flow.runId === task.id
  }
  const visibleTasks = state.tasks.filter(
    (task) =>
      filter === 'all' ||
      (filter === 'running' && ['queued', 'running'].includes(task.state)) ||
      (filter === 'failed' && ['failed', 'stopped'].includes(task.state)) ||
      task.state === filter,
  )
  return (
    <section className="workspace-page">
      <PageTitle
        title="作品，正在慢慢成形。"
        description="查看本机演示任务。失败或已停止，都不会抹掉已经完成的内容。"
        actions={<Badge tone="orange">Mock · 任务中心</Badge>}
      />
      {/* F3 页首统计统一版式：复用热点页 40 的行内式 source-stats 块，
          替换原先居中分栏带竖分隔线的卡片式，两域共用同一 CSS 版式。 */}
      <div className="source-stats">
        <div>
          <strong>{state.tasks.filter((t) => ['queued', 'running'].includes(t.state)).length}</strong>
          <span>进行中</span>
        </div>
        <div>
          <strong>{state.tasks.filter((t) => t.state === 'complete').length}</strong>
          <span>已完成</span>
        </div>
        <div>
          <strong>{state.tasks.filter((t) => ['failed', 'stopped'].includes(t.state)).length}</strong>
          <span>需要留意</span>
        </div>
      </div>
      <div className="filter-chips task-filter">
        {[
          {
            id: 'all',
            name: '全部任务',
          },
          {
            id: 'running',
            name: '进行中',
          },
          {
            id: 'complete',
            name: '已完成',
          },
          {
            id: 'failed',
            name: '失败或已停止',
          },
        ].map((item) => (
          <Button
            key={item.id}
            ref={item.id === 'all' ? allTasksFilter : undefined}
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
            variant={filter === item.id ? 'secondary' : 'ghost'}
            size="sm"
          >
            {item.name}
          </Button>
        ))}
      </div>
      <div className="task-list">
        {visibleTasks.map((task) => (
          <Card
            className={cn(`task-card ${task.state}`, 'flex-row items-start gap-3 p-3')}
            key={task.id}
            role="article"
          >
            <div className={`task-symbol ${task.state}`}>
              {task.state === 'running' ? (
                <RefreshCw className="spin" size={20} />
              ) : task.state === 'failed' ? (
                <TriangleAlert size={20} />
              ) : task.state === 'complete' ? (
                <Check size={20} />
              ) : (
                <Pause size={20} />
              )}
            </div>
            <div className="task-content">
              <div className="flex flex-nowrap items-center justify-between gap-2.5">
                <h3 className="min-w-0">{task.title}</h3>
                <Badge
                  className="shrink-0"
                  tone={task.state === 'failed' ? 'red' : task.state === 'complete' ? 'green' : 'neutral'}
                >
                  {labels[task.state]}
                </Badge>
              </div>
              <p>{task.detail}</p>
              <span className="small-meta">
                {task.kind === 'source'
                  ? '热点来源 · '
                  : task.kind === 'publish'
                    ? '公众号草稿箱 · '
                    : `《${state.projects.find((p) => p.id === task.projectId)?.title || '未命名内容'}》 · `}
                {dateLabel(task.at)}
                {task.version ? ` · 固定采用 v${task.version}` : ''}
                {task.kind === 'source'
                  ? ' · 来源刷新'
                  : task.kind === 'publish'
                    ? ' · 官方草稿箱'
                    : ' · 本机演示'}
              </span>
              {task.error && task.state === 'failed' && task.error !== task.detail && (
                <p className="small-meta text-destructive">{task.error}</p>
              )}
              {task.state === 'running' && (
                <div
                  className="mt-4 h-[3px] overflow-hidden rounded-full bg-success-background"
                  role="progressbar"
                  aria-label="任务进行中"
                >
                  <div className="h-full w-2/5 rounded-full bg-input [animation:progress-slide_1.4s_ease-in-out_infinite]" />
                </div>
              )}
              <div className="task-actions">
                {task.state === 'running' ? (
                  <Button
                    className=" text-muted-foreground"
                    onClick={() => controlTask(task.id, 'stop')}
                    variant="ghost"
                    size="sm"
                  >
                    <Pause size={14} />
                    停止
                  </Button>
                ) : ['failed', 'stopped'].includes(task.state) && !needsInput(task) ? (
                  <Button
                    className=" text-muted-foreground"
                    onClick={() => controlTask(task.id, 'retry')}
                    disabled={
                      task.kind === 'creation' &&
                      (!state.projects.some((p) => p.id === task.projectId && !p.trashed) ||
                        state.projects.find((p) => p.id === task.projectId)?.creation?.status === 'running')
                    }
                    variant="ghost"
                    size="sm"
                  >
                    <RefreshCw size={14} />
                    {task.kind === 'creation'
                      ? '继续整理'
                      : task.kind === 'source' || task.kind === 'publish'
                        ? '重试'
                        : '重试演示'}
                    </Button>
                ) : (
                  task.kind === 'export' && (
                    <Button
                      className=" text-muted-foreground"
                      onClick={() => {
                        const video = task.snapshot
                        if (!video) {
                          notify('这条历史演示没有完整快照，请从视频工作区重新导出制作清单。')
                          return
                        }
                        download(
                          `${video.title}-演示任务-${new Date().toISOString().slice(0, 10)}.json`,
                          JSON.stringify(
                            {
                              mock: true,
                              note: '制作清单，未生成 MP4。',
                              task,
                              video,
                            },
                            null,
                            2,
                          ),
                          'application/json',
                        )
                      }}
                      variant="ghost"
                      size="sm"
                    >
                      <Download size={14} />
                      制作清单
                    </Button>
                  )
                )}
                <Button
                  className=" text-muted-foreground"
                  disabled={!state.projects.some((p) => p.id === task.projectId && !p.trashed)}
                  onClick={() => viewTask(task)}
                  variant="ghost"
                  size="sm"
                >
                  {needsInput(task) ? '修正输入' : '查看内容'}
                  <ArrowRight size={14} />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {!visibleTasks.length && (
        <Empty
          icon={Clock3}
          title={filter === 'all' ? '这里暂时很安静' : '没有符合筛选的任务'}
          description={
            filter === 'all'
              ? '开始生成内容、刷新来源或演示视频导出后，任务会出现在这里。'
              : '可以切换其他状态，或查看全部任务。'
          }
        >
          {filter !== 'all' && (
            <Button
              variant="outline"
              onClick={() => {
                setFilter('all')
                allTasksFilter.current?.focus()
              }}
            >
              查看全部任务
            </Button>
          )}
        </Empty>
      )}
    </section>
  )
}

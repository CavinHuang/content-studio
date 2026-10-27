import { useEffect, useState } from 'react'
import { RotateCcw, Sparkles, Square } from 'lucide-react'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { Badge, Field, Modal, PageTitle } from './ui'
import { creationSnapshot } from '../studio/creation'
import { useStudio } from '../studio/store'

export function CreationFlow({
  variant = 'start',
  onManual,
  onCompare,
}: {
  variant?: 'start' | 'toolbar'
  onManual?: () => void
  onCompare: () => void
}) {
  const { state, project, updateCreationInput, runCreation, stopCreation, undoCreation } = useStudio()
  const flow = project.creation!
  const master = project.drafts.master!
  const [expanded, setExpanded] = useState(false)
  const running = flow.status === 'running'
  const snapshot = creationSnapshot(state, project)
  const stale = !!flow.snapshot && JSON.stringify(snapshot) !== JSON.stringify(flow.snapshot)
  const canUndo = !!flow.applied && master.title === flow.applied.title && master.body === flow.applied.body
  const inputId = `creation-input-${project.id}`
  const statusText = running ? '正在整理原始材料…' : flow.message
  const needsAttention = ['blocked', 'failed', 'stopped'].includes(flow.status)
  useEffect(() => {
    if (flow.status === 'ready' || flow.status === 'candidate') setExpanded(false)
  }, [flow.status])
  const fields = (
    <div className="grid gap-4">
      <Field
        label="想法与原始记录"
        hint="第一行写主题或问题，后面直接放入笔记、摘录和链接。还没有观点也可以开始。"
      >
        <Textarea
          className="max-h-64 overflow-y-auto"
          id={inputId}
          aria-label="想法与原始记录"
          rows={6}
          value={flow.input}
          aria-invalid={flow.status === 'blocked'}
          aria-describedby={statusText ? `${inputId}-status` : undefined}
          onChange={(e) => updateCreationInput(e.target.value)}
          placeholder={'例如：少收集一点，给每周回顾留出时间\n周五记录：存了很多链接，却很少重读……'}
        />
      </Field>
      <div className="text-xs text-muted-foreground">
        自动带入本篇 {snapshot.materials.length} 份素材 · {snapshot.language} · {snapshot.tone}
        {snapshot.point.trim() && <p className="mt-1">已有观点：{snapshot.point}</p>}
        <p className="mt-1">保留原文；链接不抓取，图片和文件不解读。整理为底稿，事实与论证仍需校订。</p>
      </div>
      {snapshot.materials.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer">查看本篇参考素材</summary>
          <ul className="mt-2 grid gap-2">
            {snapshot.materials.map((m) => (
              <li key={m.id} className="break-words bg-muted p-3">
                <strong>{m.title}</strong>
                <p className="whitespace-pre-wrap">{m.body || '没有可读取的原文'}</p>
                {m.url && <p className="break-all">{m.url}（未抓取、未核验）</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {statusText && (
        <p
          id={`${inputId}-status`}
          role={['blocked', 'failed'].includes(flow.status) ? 'alert' : 'status'}
          className="text-sm text-muted-foreground"
        >
          {statusText}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button variant="outline" onClick={stopCreation}>
            <Square />
            停止整理
          </Button>
        ) : (
          <Button onClick={runCreation}>
            <Sparkles />
            {['failed', 'stopped'].includes(flow.status)
              ? '继续整理'
              : master.body.trim()
                ? '按新方向准备候选'
                : '整理成初稿'}
          </Button>
        )}
        {onManual && (
          <Button variant="ghost" onClick={onManual}>
            直接写作
          </Button>
        )}
      </div>
    </div>
  )
  if (variant === 'start')
    return (
      <section className="grid gap-4 py-4 text-sm" aria-label="从想法到母稿" aria-busy={running}>
        <PageTitle
          title="这次想写什么"
          description="先放下你的想法，下一步直接在正文继续。"
          actions={<Badge tone="orange">整理演示</Badge>}
        />
        {fields}
      </section>
    )
  return (
    <section
      className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-xs"
      aria-label="从想法到母稿"
    >
      <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
        调整方向与素材
      </Button>
      {flow.status === 'candidate' && (
        <Button variant="outline" size="sm" onClick={onCompare}>
          比较原稿与候选
        </Button>
      )}
      {running && (
        <Button variant="outline" size="sm" onClick={stopCreation}>
          停止整理
        </Button>
      )}
      {['failed', 'stopped'].includes(flow.status) && (
        <Button variant="outline" size="sm" onClick={runCreation}>
          继续整理
        </Button>
      )}
      {canUndo && !running && (
        <Button variant="ghost" size="sm" onClick={undoCreation}>
          <RotateCcw />
          撤销这次整理
        </Button>
      )}
      <span
        className={`min-w-0 ${needsAttention ? 'text-warning' : 'text-muted-foreground'}`}
        role={['blocked', 'failed'].includes(flow.status) ? 'alert' : 'status'}
      >
        {needsAttention
          ? flow.message
          : running
            ? '正在整理，现有母稿保留'
            : flow.status === 'candidate'
              ? '候选待比较，原稿未改动'
              : stale
                ? '方向或素材已更新，可重新整理'
                : flow.applied && !canUndo
                  ? '已有后续修改，可从版本历史恢复'
                  : '原始记录与素材随本篇保留'}
      </span>
      {expanded && (
        <Modal
          title="调整创作方向"
          description="已带入本篇原始记录。重新整理只产生候选，现有正文保持原样。"
          onClose={() => setExpanded(false)}
          footer={
            <Button variant="outline" onClick={() => setExpanded(false)}>
              返回正文
            </Button>
          }
        >
          {fields}
        </Modal>
      )}
    </section>
  )
}

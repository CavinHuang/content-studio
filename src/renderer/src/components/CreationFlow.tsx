import { useState } from 'react'
import { Download, RotateCcw, Sparkles, Square } from 'lucide-react'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { Badge, download, Field } from './ui'
import { creationSnapshot } from '../studio/creation'
import { useStudio } from '../studio/store'

export function CreationFlow() {
  const {
    state,
    project,
    patchProject,
    updateCreationInput,
    runCreation,
    stopCreation,
    acceptCreation,
    undoCreation,
    notify,
  } = useStudio()
  const flow = project.creation!
  const master = project.drafts.master!
  const [expanded, setExpanded] = useState(false)
  const [comparison, setComparison] = useState(false)
  const running = flow.status === 'running'
  const snapshot = creationSnapshot(state, project)
  const stale = !!flow.snapshot && JSON.stringify(snapshot) !== JSON.stringify(flow.snapshot)
  const candidate = flow.status === 'candidate' ? flow.candidate : undefined
  const conflict =
    !!candidate && (candidate.baseTitle !== master.title || candidate.baseBody !== master.body || stale)
  const canUndo = !!flow.applied && master.title === flow.applied.title && master.body === flow.applied.body
  const compact = flow.status === 'ready' && !expanded
  const inputId = `creation-input-${project.id}`
  const statusText = running ? '正在整理原始材料…' : flow.message
  return (
    <section
      className="mb-4 rounded-xl border bg-card p-4 text-sm"
      aria-label="从想法到母稿"
      aria-busy={running}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h2 className="font-medium">{compact ? '原始材料已带入母稿' : '从想法，直接开始写'}</h2>
          <Badge tone="orange">整理演示</Badge>
        </div>
        {compact && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            调整方向与素材
          </Button>
        )}
      </div>
      {!compact && (
        <div className="mt-3 grid gap-3">
          <Field
            label="想法与原始记录"
            hint="第一行写主题或问题，后面直接粘贴笔记、摘录和链接。还没有观点也可以开始。"
          >
            <Textarea
              id={inputId}
              aria-label="想法与原始记录"
              rows={5}
              value={flow.input}
              aria-invalid={flow.status === 'blocked'}
              aria-describedby={statusText ? `${inputId}-status` : undefined}
              onChange={(e) => {
                updateCreationInput(e.target.value)
                setComparison(false)
              }}
              placeholder={'例如：少收集一点，给每周回顾留出时间\n周五记录：存了很多链接，却很少重读……'}
            />
          </Field>
          <div className="text-xs text-muted-foreground">
            自动带入本篇 {snapshot.materials.length} 份素材 · {snapshot.language} · {snapshot.tone}
            {snapshot.point.trim() && <p className="mt-1">已有观点：{snapshot.point}</p>}
            <p className="mt-1">
              原文保留；链接不抓取，图片和文件不解读。这里先整理底稿，论证和事实仍需校订。
            </p>
          </div>
          {!!snapshot.materials.length && (
            <details className="min-w-0 text-xs">
              <summary className="cursor-pointer text-muted-foreground">查看自动带入的原始素材</summary>
              <ul className="mt-2 grid gap-2">
                {snapshot.materials.map((m) => (
                  <li key={m.id} className="break-words rounded-md bg-muted p-2">
                    <strong>{m.title}</strong>
                    <p className="whitespace-pre-wrap">{m.body || '没有可读取的原文'}</p>
                    {m.url && <p className="break-all">{m.url}（未抓取、未核验）</p>}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {running ? (
              <Button variant="outline" size="sm" onClick={stopCreation}>
                <Square className="size-3" />
                停止整理
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  setComparison(false)
                  runCreation()
                }}
              >
                <Sparkles className="size-4" />
                {['failed', 'stopped'].includes(flow.status)
                  ? '继续整理'
                  : master.body.trim()
                    ? '按新方向准备候选'
                    : '整理成初稿'}
              </Button>
            )}
            {master.body.trim() && (
              <span className="text-xs text-muted-foreground">现有母稿会保留，候选需要你比较后替换。</span>
            )}
          </div>
        </div>
      )}
      {statusText && (
        <p
          id={`${inputId}-status`}
          role={['blocked', 'failed'].includes(flow.status) ? 'alert' : 'status'}
          className="mt-2 text-xs text-muted-foreground"
        >
          {statusText}
        </p>
      )}
      {stale && flow.status === 'ready' && (
        <p role="status" className="mt-2 text-xs text-warning">
          方向或引用素材有更新，当前母稿仍基于上次快照；可调整后重新整理。
        </p>
      )}
      {candidate && (
        <div className="mt-3 grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-expanded={comparison}
              onClick={() => setComparison((v) => !v)}
            >
              比较原稿与候选
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                patchProject(project.id, (p) => ({
                  ...p,
                  creation: {
                    ...p.creation!,
                    status: 'idle',
                    candidate: undefined,
                    message: '已放弃候选。现有母稿与原始输入均保留。',
                  },
                }))
              }
            >
              放弃候选，保留母稿
            </Button>
          </div>
          {comparison && (
            <div className="grid min-w-0 gap-3" role="region" aria-label="原稿与候选对照">
              <div>
                <h3 className="mb-2 font-medium">当前母稿：{master.title}</h3>
                <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-sm">
                  {master.body}
                </pre>
              </div>
              <div>
                <h3 className="mb-2 font-medium">候选：{candidate.title}</h3>
                <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans text-sm">
                  {candidate.body}
                </pre>
              </div>
              {conflict && (
                <p role="alert" className="text-xs text-warning">
                  母稿、方向或素材已变化。请重新整理，当前修改不会被覆盖。
                </p>
              )}
              <Button
                className="justify-self-start"
                size="sm"
                disabled={conflict}
                onClick={() => {
                  acceptCreation()
                  setExpanded(false)
                }}
              >
                采用候选，保留原稿版本
              </Button>
            </div>
          )}
        </div>
      )}
      {master.body.trim() && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              download(`${master.title || '母稿'}.md`, `# ${master.title}\n\n${master.body}`)
              notify('已导出当前母稿，未执行发布。')
            }}
          >
            <Download className="size-4" />
            导出母稿 Markdown
          </Button>
          {canUndo && (
            <Button variant="ghost" size="sm" onClick={undoCreation}>
              <RotateCcw className="size-4" />
              撤销这次整理
            </Button>
          )}
          {flow.applied && !canUndo && (
            <span className="text-xs text-muted-foreground">
              母稿已有后续修改；如需恢复，请使用版本历史。
            </span>
          )}
        </div>
      )}
    </section>
  )
}

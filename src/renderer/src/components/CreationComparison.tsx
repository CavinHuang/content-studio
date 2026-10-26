import { Button } from './ui/button'
import { creationSnapshot } from '../studio/creation'
import { textDiff } from '../studio/text-diff'
import { useStudio } from '../studio/store'

export function CreationComparison({ onClose }: { onClose: () => void }) {
  const { state, project, patchProject, acceptCreation } = useStudio()
  const flow = project.creation!,
    candidate = flow.candidate!,
    master = project.drafts.master!
  const conflict =
    candidate.baseTitle !== master.title ||
    candidate.baseBody !== master.body ||
    JSON.stringify(flow.snapshot) !== JSON.stringify(creationSnapshot(state, project))
  const changes = textDiff(master.body, candidate.body)
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="原稿与候选对照">
      <header className="shrink-0 border-b p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-semibold">比较母稿与候选</h1>
          <Button variant="ghost" size="sm" onClick={onClose}>
            返回正文继续编辑
          </Button>
        </div>
        <p className="mt-1 text-muted-foreground">替换范围：母稿全文。采用后保留当前稿为历史版本。</p>
        <p className="mt-2 break-words">
          标题：{master.title || '未命名内容'} → {candidate.title}
        </p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm" aria-label="正文差异">
        {changes.map((change, i) =>
          change.kind === 'same' ? (
            <details className="mb-3 rounded-md border p-3 text-muted-foreground" key={i}>
              <summary className="cursor-pointer">
                未改动的上下文 · {change.text.split('\n').length} 行
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans">{change.text}</pre>
            </details>
          ) : (
            <div
              key={i}
              className={`mb-3 rounded-md border-l-4 p-3 ${change.kind === 'removed' ? 'border-destructive bg-destructive/10' : 'border-success bg-success-background'}`}
            >
              <strong className="mb-2 block">{change.kind === 'removed' ? '将移除' : '将加入'}</strong>
              <pre className="whitespace-pre-wrap break-words font-sans">{change.text}</pre>
            </div>
          ),
        )}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-background p-3">
        {conflict && (
          <p className="w-full text-sm text-warning" role="alert">
            母稿、方向或素材已变化。请返回正文重新整理，当前修改不会被覆盖。
          </p>
        )}
        <Button
          disabled={conflict}
          onClick={() => {
            acceptCreation()
            onClose()
          }}
        >
          采用候选，保留原稿版本
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            patchProject(project.id, (p) => ({
              ...p,
              creation: {
                ...p.creation!,
                status: 'idle',
                candidate: undefined,
                message: '已放弃候选，原稿和输入均保留。',
              },
            }))
            onClose()
          }}
        >
          放弃候选，保留母稿
        </Button>
      </footer>
    </section>
  )
}

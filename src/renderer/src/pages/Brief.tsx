import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  ArrowDown,
  ArrowUp,
  Check,
  GripVertical,
  Plus,
  Sparkles,
  Trash2,
  ArrowUpRight,
  Link2,
} from 'lucide-react'
import { useStudio } from '../studio/store'
import { Badge, Field, PageTitle } from '../components/ui'
export function BriefPage({ embedded = false }: { embedded?: boolean }) {
  const { project, patchProject, generateArticle, reference, setState, notify } = useStudio()
  const brief = project.brief
  function patch(value: Partial<typeof brief>) {
    patchProject(project.id, (p) => ({
      ...p,
      brief: {
        ...p.brief,
        ...value,
        confirmed: false,
      },
    }))
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= brief.outline.length) return
    const outline = [...brief.outline]
    const [item] = outline.splice(from, 1)
    outline.splice(to, 0, item!)
    patch({
      outline,
    })
  }
  const running = project.creation?.status === 'running'
  return (
    <section className="workspace-page brief-page">
      {!embedded && (
        <PageTitle
          eyebrow="A LITTLE CLARITY, BEFORE YOU CREATE"
          title="这篇内容怎么写"
          description="先把方向和结构定下来，再开始写作。"
          actions={
            <Badge tone={brief.confirmed ? 'green' : 'orange'}>
              {brief.confirmed ? '已确认方案' : '待确认'}
            </Badge>
          }
        />
      )}
      {embedded && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0 break-words">《{project.title || '未命名内容'}》的方案</span>
          <Badge tone={brief.confirmed ? 'green' : 'orange'}>
            {brief.confirmed ? '已确认方案' : '待确认'}
          </Badge>
        </div>
      )}
      {project.source && (
        <Button
          className="source-origin h-auto justify-start whitespace-normal text-left"
          onClick={() =>
            setState((s) => ({
              ...s,
              page: 'hotspots',
              selectedTopic: project.source!.topicId,
            }))
          }
          variant="ghost"
          size="default"
        >
          <Link2 size={17} />
          <span>
            <small>从热点发起 · 已保留来源快照</small>
            {project.source.title}
          </span>
          <ArrowUpRight size={17} />
        </Button>
      )}
      <Field label="选题">
        <Input
          aria-label="方案选题"
          value={brief.topic}
          placeholder="给这次创作一个方向…"
          onChange={(e) =>
            patch({
              topic: e.target.value,
            })
          }
        />
      </Field>
      <Field label="核心观点" hint="不是信息的堆砌，而是你想说的一句话。">
        <Textarea
          aria-label="核心观点"
          rows={3}
          value={brief.point}
          placeholder="你希望读者记住什么？"
          onChange={(e) =>
            patch({
              point: e.target.value,
            })
          }
        />
      </Field>
      <div className={`form-grid ${embedded ? 'grid-cols-1' : ''}`}>
        <Field label="写给谁">
          <Input
            value={brief.audience}
            onChange={(e) =>
              patch({
                audience: e.target.value,
              })
            }
          />
        </Field>
        <Field label="怎么表达">
          <Input
            value={brief.tone}
            onChange={(e) =>
              patch({
                tone: e.target.value,
              })
            }
          />
        </Field>
      </div>
      <Field label="篇幅建议">
        <Input
          value={brief.length}
          onChange={(e) =>
            patch({
              length: e.target.value,
            })
          }
        />
      </Field>
      <div className="section-heading">
        <h2>文章大纲</h2>
        <span>{brief.outline.length} 个段落</span>
      </div>
      <div className="outline-list">
        {brief.outline.map((item, i) => (
          <div
            className="outline-item"
            key={i}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const from = Number(e.dataTransfer.getData('text/plain'))
              if (Number.isInteger(from)) move(from, i)
            }}
          >
            <GripVertical size={15} />
            <span className="outline-number">{String(i + 1).padStart(2, '0')}</span>
            <Input
              aria-label={`大纲段落 ${i + 1}`}
              value={item}
              onChange={(e) =>
                patch({
                  outline: brief.outline.map((line, n) => (n === i ? e.target.value : line)),
                })
              }
            />
            <Button
              className="icon-button"
              aria-label={`上移段落 ${i + 1}`}
              disabled={i === 0}
              onClick={() => move(i, i - 1)}
              variant="ghost"
              size="icon"
            >
              <ArrowUp size={14} />
            </Button>
            <Button
              className="icon-button"
              aria-label={`下移段落 ${i + 1}`}
              disabled={i === brief.outline.length - 1}
              onClick={() => move(i, i + 1)}
              variant="ghost"
              size="icon"
            >
              <ArrowDown size={14} />
            </Button>
            <Button
              className="icon-button"
              aria-label={`删除段落 ${i + 1}`}
              onClick={() =>
                patch({
                  outline: brief.outline.filter((_, n) => n !== i),
                })
              }
              variant="ghost"
              size="icon"
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
      </div>
      <Button
        className="text-button add-outline text-muted-foreground"
        onClick={() =>
          patch({
            outline: [...brief.outline, '新的段落'],
          })
        }
        variant="ghost"
        size="sm"
      >
        <Plus size={15} />
        添加一个段落
      </Button>
      <div className="brief-footer">
        <div>
          <Sparkles size={17} />
          <span>方案属于你，Agent 帮你把想法理清。</span>
        </div>
        <Button
          className="button secondary"
          onClick={() =>
            reference('当前创作方案', `${brief.topic}\n${brief.point}\n${brief.outline.join('\n')}`)
          }
          variant="outline"
          size="default"
        >
          和 Agent 再聊聊
        </Button>
        <Button
          className={brief.confirmed ? 'button secondary' : 'button primary'}
          disabled={running || !brief.topic.trim() || !brief.point.trim() || !brief.outline.length}
          onClick={() => {
            if (!brief.outline.every((item) => item.trim())) {
              notify('请补充空白大纲段落，或将其移除。')
              return
            }
            generateArticle()
          }}
          variant={brief.confirmed ? 'outline' : 'default'}
          size="default"
        >
          {running ? (
            '正在生成示例母稿…'
          ) : project.drafts.master?.body.trim() ? (
            '按方案准备候选'
          ) : (
            <>
              <Check size={16} />
              确认方案，生成母稿
            </>
          )}
        </Button>
      </div>
    </section>
  )
}

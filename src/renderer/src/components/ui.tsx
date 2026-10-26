import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useCallback,
  useId,
  useRef,
  type ComponentProps,
  type RefObject,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'
import { ArrowLeft, Check, Leaf, Search, X, type LucideIcon } from 'lucide-react'
import { platformName, PLATFORMS, type Platform } from '../studio/types'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { NativeSelect } from './ui/native-select'
import { Field as UIField, FieldDescription, FieldLabel, FieldTitle } from './ui/field'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group'
import { Badge as UIBadge } from './ui/badge'
import { Checkbox } from './ui/checkbox'
import { Label } from './ui/label'
import { Tabs, TabsList, TabsTrigger } from './ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? 'small' : ''}`}>
      <Leaf size={small ? 18 : 23} strokeWidth={1.7} />
    </span>
  )
}
export function IconButton({
  icon: Icon,
  label,
  className = '',
  ...buttonProps
}: {
  icon: LucideIcon
  label: string
} & Omit<ComponentProps<typeof Button>, 'children' | 'aria-label' | 'variant' | 'size'>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`icon-button ${className}`}
          type="button"
          aria-label={label}
          {...buttonProps}
        >
          <Icon size={18} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode
  tone?: 'neutral' | 'green' | 'orange' | 'red'
  className?: string
}) {
  return (
    <UIBadge
      variant="secondary"
      className={cn(
        'badge',
        tone === 'green' && 'border-success/20 bg-success-background text-success',
        tone === 'orange' && 'border-warning/20 bg-warning-background text-warning',
        tone === 'red' && 'border-destructive/20 bg-destructive/10 text-destructive',
        className,
      )}
    >
      {children}
    </UIBadge>
  )
}
export function PlatformMark({ platform }: { platform: Platform }) {
  const item = PLATFORMS.find((p) => p.id === platform)
  return (
    <span
      aria-hidden="true"
      className="platform-mark"
      style={{
        background: item?.color ?? '#b3663e',
      }}
      title={platformName(platform)}
    >
      {item?.short ?? '稿'}
    </span>
  )
}
export function PageTitle({
  eyebrow,
  title,
  description,
  actions,
  back,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  back?: () => void
}) {
  return (
    <div className="page-title-block">
      {back && (
        <Button
          className="text-button back-link text-muted-foreground"
          onClick={back}
          variant="ghost"
          size="sm"
        >
          <ArrowLeft size={15} />
          返回
        </Button>
      )}
      <div className="page-title-row">
        <div>
          {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="page-description">{description}</p>}
        </div>
        {actions && <div className="page-title-actions">{actions}</div>}
      </div>
    </div>
  )
}
export function SearchBox({
  value,
  onChange,
  placeholder = '搜索…',
  label,
  inputRef,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  label?: string
  inputRef?: RefObject<HTMLInputElement | null>
}) {
  const ownInput = useRef<HTMLInputElement>(null)
  const input = inputRef ?? ownInput
  return (
    <InputGroup className="search-field">
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        ref={input}
        value={value}
        aria-label={label ?? placeholder}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            type="button"
            aria-label="清除搜索"
            onClick={() => {
              onChange('')
              input.current?.focus()
            }}
            variant="ghost"
            size="icon-xs"
          >
            <X size={14} />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}
export function Empty({
  icon: Icon = Search,
  title,
  description,
  children,
}: {
  icon?: LucideIcon
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="empty-state">
      <Icon size={34} strokeWidth={1.3} />
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  )
}
export function CheckOption({
  checked,
  onChange,
  children,
  disabled = false,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <Label className={`check-option ${disabled ? 'disabled' : ''}`}>
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(value === true)} />
      <span>{children}</span>
    </Label>
  )
}
// 横排单选的唯一选中语言（DESIGN-SYSTEM v2.3「选中态规范」N3）：沙色轨道 + 白色凸起片的
// 分段白块式，直接复用上游 TabsList 默认外观；实底药丸样式退役。
export function SegmentedControl({
  value,
  onValueChange,
  options,
  label,
  className,
}: {
  value: string
  onValueChange: (value: string) => void
  options: { value: string; label: ReactNode }[]
  label: string
  className?: string
}) {
  return (
    <Tabs value={value} onValueChange={onValueChange} className={className}>
      <TabsList aria-label={label}>
        {options.map((option) => (
          <TabsTrigger key={option.value} value={option.value}>
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
  footer,
}: {
  title: string
  description?: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
  footer?: ReactNode
}) {
  const previousFocus = useRef(document.activeElement as HTMLElement | null)
  const trackScrollArea = useCallback((container: HTMLDivElement | null) => {
    if (!container) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const focused = document.activeElement
        if (
          focused instanceof HTMLElement &&
          container.contains(focused) &&
          focused.matches('input, textarea, select, [contenteditable="true"]')
        ) {
          focused.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        }
      })
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className={cn(
          'studio-dialog flex max-h-[90dvh] flex-col gap-4 overflow-hidden p-6 sm:max-w-lg',
          wide && 'studio-dialog-wide sm:max-w-4xl',
        )}
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          if (previousFocus.current?.isConnected) {
            event.preventDefault()
            previousFocus.current.focus()
          }
        }}
      >
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-4 top-4"
          aria-label="关闭弹窗"
          onClick={onClose}
        >
          <X size={17} />
        </Button>
        <div
          ref={trackScrollArea}
          className="modal-scroll min-h-0 scroll-py-1 overflow-y-auto [overflow-wrap:anywhere]"
        >
          <DialogHeader className="pr-8">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className={description ? undefined : 'sr-only'}>
              {description || title}
            </DialogDescription>
          </DialogHeader>
          <div className="modal-body mt-4">{children}</div>
        </div>
        {footer && <DialogFooter className="shrink-0">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const id = useId()
  const labelId = `${id}-label`
  const hintId = `${id}-description`
  let controlId: string | undefined
  function connectControl(nodes: ReactNode): ReactNode {
    return Children.map(nodes, (child) => {
      if (!isValidElement<{ id?: string; children?: ReactNode; 'aria-describedby'?: string }>(child))
        return child
      if (!controlId && (child.type === Input || child.type === Textarea || child.type === NativeSelect)) {
        controlId = child.props.id ?? `${id}-control`
        return cloneElement(child, {
          id: controlId,
          'aria-describedby':
            [child.props['aria-describedby'], hint && hintId].filter(Boolean).join(' ') || undefined,
        })
      }
      if (typeof child.type === 'string' || child.type === Fragment)
        return cloneElement(child, { children: connectControl(child.props.children) })
      return child
    })
  }
  const content = connectControl(children)
  return (
    <UIField className="field min-w-0" aria-labelledby={controlId ? undefined : labelId}>
      {controlId ? (
        <FieldLabel id={labelId} htmlFor={controlId}>
          {label}
        </FieldLabel>
      ) : (
        <FieldTitle id={labelId}>{label}</FieldTitle>
      )}
      {content}
      {hint && <FieldDescription id={hintId}>{hint}</FieldDescription>}
    </UIField>
  )
}
export function download(name: string, content: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(
    new Blob([content], {
      type,
    }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = name.replace(/[<>:"/\\|?*]/g, '-')
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
function inline(text: string): ReactNode[] {
  // Render only explicit Markdown constructs as React nodes; imported HTML is always plain text.
  return text
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
    .map((part, i) =>
      part.startsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : part.startsWith('*') ? (
        <em key={i}>{part.slice(1, -1)}</em>
      ) : part.startsWith('`') ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    )
}
export function Markdown({
  body,
  media = {},
  beforeBlock,
  className,
}: {
  body: string
  media?: Record<string, string>
  beforeBlock?: (block: string, index: number) => ReactNode
  className?: string
}) {
  return (
    <div className={cn('markdown', className)}>
      {body.split(/\n\s*\n/).map((block, index) => (
        <Fragment key={index}>
          {beforeBlock?.(block, index)}
          {(() => {
            const trimmed = block.trim()
            const picture = /^!\[([^\]]*)\]\(asset:([^)]+)\)$/.exec(trimmed)
            if (picture && media[picture[2]!])
              return (
                <figure key={index}>
                  <img src={media[picture[2]!]} alt={picture[1]} />
                  <figcaption>{picture[1]}</figcaption>
                </figure>
              )
            if (trimmed.startsWith('### ')) return <h3 key={index}>{inline(trimmed.slice(4))}</h3>
            if (trimmed.startsWith('## ')) return <h2 key={index}>{inline(trimmed.slice(3))}</h2>
            if (trimmed.startsWith('# ')) return <h2 key={index}>{inline(trimmed.slice(2))}</h2>
            if (trimmed.startsWith('> '))
              return <blockquote key={index}>{inline(trimmed.replace(/^> /gm, ''))}</blockquote>
            if (/^[-*] /.test(trimmed))
              return (
                <ul key={index}>
                  {trimmed.split('\n').map((line, n) => (
                    <li key={n}>{inline(line.replace(/^[-*] /, ''))}</li>
                  ))}
                </ul>
              )
            if (/^\d+\. /.test(trimmed))
              return (
                <ol key={index}>
                  {trimmed.split('\n').map((line, n) => (
                    <li key={n}>{inline(line.replace(/^\d+\. /, ''))}</li>
                  ))}
                </ol>
              )
            if (trimmed === '---') return <hr key={index} />
            return (
              <p key={index}>
                {trimmed.split('\n').map((line, n) => (
                  <span key={n}>
                    {n > 0 && <br />}
                    {inline(line)}
                  </span>
                ))}
              </p>
            )
          })()}
        </Fragment>
      ))}
    </div>
  )
}

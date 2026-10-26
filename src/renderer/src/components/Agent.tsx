import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Leaf,
  Paperclip,
  Plus,
  RefreshCw,
  SquarePen,
  X,
  Send,
} from 'lucide-react'
import { Badge, Brand, copyText, IconButton } from './ui'
import { Button } from './ui/button'
import { Bubble, BubbleContent } from './ui/bubble'
import { Message, MessageContent, MessageHeader } from './ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from './ui/message-scroller'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from './ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu'
import { useStudio } from '../studio/store'
import { platformName, uid } from '../studio/types'
import { topics } from '../studio/mock'
import { requestSuggestionReview } from '../studio/suggestion-review'
import { creationSnapshot } from '../studio/creation'

export function AgentPanel({ onClose }: { onClose: () => void }) {
  const {
    state,
    setState,
    project,
    patchProject,
    composer,
    setComposer,
    context,
    setContext,
    sendMessage,
    reference,
    navigate,
    setPlatformsOpen,
    setCaptureOpen,
    notify,
  } = useStudio()
  const [threadMenu, setThreadMenu] = useState(false),
    [materials, setMaterials] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const panel = useRef<HTMLElement>(null)
  const firstMaterialAction = useRef<HTMLButtonElement>(null)
  const focusComposerAfterMenu = useRef(false)
  const discovery = ['hotspots', 'sources'].includes(state.page)
  const conversations = discovery ? state.discoveryConversations : project.conversations
  const thread =
    conversations.find((c) => c.id === (discovery ? state.activeDiscovery : project.activeConversation)) ??
    conversations[0]!
  const busy =
    project.creation?.status === 'running' ||
    state.tasks.some(
      (t) => t.title === 'Agent 正在整理建议' && t.projectId === project.id && t.state === 'running',
    )
  const topic = state.page === 'hotspots' ? topics.find((t) => t.id === state.selectedTopic) : undefined
  const contextLabel =
    context?.label ||
    (topic
      ? `热点：${topic.title}`
      : discovery
        ? '热点发现 · 多来源'
        : `${project.title || '未命名内容'} · ${platformName(project.activePlatform)}`)
  const referencedMaterials = state.materials.filter(
    (material) => !material.trashed && project.materialIds.includes(material.id),
  )
  const sharedContext = creationSnapshot(state, project)
  useEffect(() => {
    if (context) input.current?.focus()
  }, [context])
  function newConversation() {
    const id = uid()
    if (discovery)
      setState((s) => ({
        ...s,
        discoveryConversations: [...s.discoveryConversations, { id, title: '新的发现对话', messages: [] }],
        activeDiscovery: id,
      }))
    else
      patchProject(project.id, (p) => ({
        ...p,
        conversations: [...p.conversations, { id, title: '新的创作对话', messages: [] }],
        activeConversation: id,
      }))
    setThreadMenu(false)
    input.current?.focus()
  }
  return (
    <aside ref={panel} className="agent-panel bg-agent" aria-label="创作 Agent">
      <header className="agent-header flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <Brand small />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">创作 Agent</h2>
        <div className="agent-thread-bar static shrink-0">
          <DropdownMenu open={threadMenu} onOpenChange={setThreadMenu}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label={`切换对话：${thread.title}`} title={thread.title}>
                <span className="thread-title">会话</span>
                <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-80 max-w-[min(calc(100vw-2rem),var(--radix-dropdown-menu-content-available-width))]"
              collisionBoundary={panel.current}
              collisionPadding={8}
              onCloseAutoFocus={(event) => {
                if (focusComposerAfterMenu.current) {
                  event.preventDefault()
                  focusComposerAfterMenu.current = false
                  input.current?.focus()
                }
              }}
            >
              <DropdownMenuLabel>{discovery ? '发现对话' : '本篇对话'}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={thread.id}
                onValueChange={(id) => {
                  if (discovery) setState((s) => ({ ...s, activeDiscovery: id }))
                  else patchProject(project.id, (p) => ({ ...p, activeConversation: id }))
                }}
              >
                {conversations.map((conversation) => (
                  <DropdownMenuRadioItem
                    key={conversation.id}
                    value={conversation.id}
                    onSelect={() => {
                      focusComposerAfterMenu.current = true
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate" title={conversation.title}>
                        {conversation.title}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {conversation.messages.length} 条消息
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  focusComposerAfterMenu.current = true
                  newConversation()
                }}
              >
                <Plus size={15} />
                开始新的对话
              </DropdownMenuItem>
              <p className="px-2 py-1.5 text-xs text-muted-foreground">切换对话，当前文稿保持不变。</p>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="agent-header-actions">
          <IconButton icon={Plus} label="新建对话" onClick={newConversation} />
          <IconButton icon={X} label="收起 Agent" onClick={onClose} />
        </div>
      </header>
      <MessageScrollerProvider key={thread.id} autoScroll>
        <MessageScroller className="agent-scroll-region" aria-label="Agent 对话记录">
          <MessageScrollerViewport className="agent-transcript">
            <MessageScrollerContent className="gap-4">
              {!thread.messages.length ? (
                <div className="agent-welcome">
                  <div className="welcome-leaf">
                    <Leaf size={27} strokeWidth={1.5} />
                  </div>
                  <div className="page-eyebrow">A THOUGHTFUL CREATIVE PARTNER</div>
                  <h2>这次想创作什么？</h2>
                  <p>
                    一个想法、一段记录、一份没写完的草稿，
                    <br />
                    我们都可以从这里开始。
                  </p>
                  <div className="starter-prompts">
                    {[
                      { icon: SquarePen, text: '帮我梳理一个选题和大纲' },
                      { icon: Paperclip, text: '结合素材，整理成自己的观点' },
                      { icon: FileText, text: '帮我润色当前文稿的表达' },
                    ].map((item) => (
                      <Button
                        variant="outline"
                        key={item.text}
                        onClick={() => {
                          setComposer(item.text)
                          input.current?.focus()
                        }}
                      >
                        <item.icon size={17} />
                        {item.text}
                        <ChevronRight size={14} />
                      </Button>
                    ))}
                  </div>
                  <p className="agent-welcome-note">先把方向聊清楚，再慢慢写成作品。</p>
                </div>
              ) : (
                <>
                  {thread.messages.map((message) => (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={message.role === 'user'}
                    >
                      <Message className="agent-message" align={message.role === 'user' ? 'end' : 'start'}>
                        {message.role === 'assistant' ? (
                          <Brand small />
                        ) : (
                          <span className="user-avatar" aria-hidden="true">
                            我
                          </span>
                        )}
                        <MessageContent>
                          <MessageHeader className="order-last flex w-full items-center justify-end gap-2 px-0 text-xs">
                            {message.role === 'assistant' && (
                              <span className="message-copy-action">
                                <Button
                                  variant="ghost"
                                  size="xs"
                                  className="copy-message"
                                  aria-label="复制 Agent 回复"
                                  onClick={() =>
                                    void copyText(message.text).then((ok) =>
                                      notify(ok ? '已复制回复。' : '剪贴板暂不可用。'),
                                    )
                                  }
                                >
                                  <Copy size={12} />
                                  复制
                                </Button>
                              </span>
                            )}
                            <strong>{message.role === 'assistant' ? '创作 Agent' : '我'}</strong>
                            <span>
                              {new Date(message.at).toLocaleTimeString('zh-CN', {
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })}
                            </span>
                          </MessageHeader>
                          <Bubble
                            align={message.role === 'user' ? 'end' : 'start'}
                            variant={message.role === 'user' ? 'muted' : 'ghost'}
                            className={
                              message.role === 'user' ? '*:data-[slot=bubble-content]:bg-accent' : undefined
                            }
                          >
                            <BubbleContent>{message.text}</BubbleContent>
                          </Bubble>
                          {message.action && (
                            <Button
                              variant="outline"
                              className="chat-artifact m-0 h-auto justify-start gap-2 whitespace-normal p-3"
                              onClick={() => {
                                if (message.action === 'platforms') setPlatformsOpen(true)
                                else {
                                  if (message.suggestion)
                                    patchProject(project.id, (p) => ({
                                      ...p,
                                      activePlatform: message.suggestion!.platform,
                                    }))
                                  if (message.suggestion)
                                    requestSuggestionReview({
                                      projectId: project.id,
                                      platform: message.suggestion.platform,
                                      id: message.suggestion.id,
                                    })
                                  navigate(
                                    message.action === 'plan'
                                      ? 'plan'
                                      : message.action === 'video'
                                        ? 'video'
                                        : 'article',
                                  )
                                }
                              }}
                            >
                              <span className="chat-artifact-icon">
                                <FileText size={18} />
                              </span>
                              <div>
                                <strong>
                                  {message.suggestion
                                    ? '段落修改建议'
                                    : message.action === 'plan'
                                      ? '创作方案'
                                      : message.action === 'video'
                                        ? '视频工作台'
                                        : message.action === 'platforms'
                                          ? '选择适配平台'
                                          : '当前文稿'}
                                </strong>
                                <small>
                                  {message.suggestion
                                    ? `${platformName(message.suggestion.platform)} · ${message.suggestion.status === 'accepted' ? '已采用' : message.suggestion.status === 'pending' ? '等待对照' : '已处理'}`
                                    : '在中间继续调整'}
                                </small>
                              </div>
                              <ChevronRight size={16} />
                            </Button>
                          )}
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ))}
                </>
              )}
              {busy && (
                <div className="agent-thinking" role="status">
                  <RefreshCw className="spin" size={16} />
                  <span>正在整理演示建议…</span>
                </div>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton aria-label="回到最新消息" />
        </MessageScroller>
      </MessageScrollerProvider>
      <div className="composer-area">
        <InputGroup aria-label="发送创作指令">
          <InputGroupAddon align="block-start">
            <div className="context-chip">
              <FileText size={12} />
              <span title={contextLabel}>{contextLabel}</span>
              {context && (
                <InputGroupButton
                  size="icon-xs"
                  aria-label="移除对话上下文引用"
                  onClick={() => setContext(null)}
                >
                  <X size={12} />
                </InputGroupButton>
              )}
            </div>
            {!discovery && (sharedContext.input || referencedMaterials.length > 0) && (
              <details className="mt-1 text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  已带入原始记录与 {referencedMaterials.length} 份本篇素材
                </summary>
                {sharedContext.input && (
                  <p className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words">
                    {sharedContext.input}
                  </p>
                )}
                {referencedMaterials.map((m) => (
                  <p key={m.id}>
                    {m.title}
                    {m.body ? '' : '（未读取原文）'}
                  </p>
                ))}
              </details>
            )}
          </InputGroupAddon>
          <InputGroupTextarea
            ref={input}
            aria-label="Agent 消息"
            placeholder="说说你的想法，或粘贴一段文字…"
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              const shouldSend = state.preferences.enterToSend
                ? e.key === 'Enter' && !e.shiftKey
                : e.key === 'Enter' && (e.ctrlKey || e.metaKey)
              if (shouldSend) {
                e.preventDefault()
                if (!busy) sendMessage()
              }
            }}
          />
          <InputGroupAddon align="block-end">
            <div className="composer-actions">
              <div>
                <Popover open={materials} onOpenChange={setMaterials}>
                  <PopoverTrigger asChild>
                    <InputGroupButton size="icon-sm" aria-label="引用素材到对话">
                      <Paperclip size={18} />
                    </InputGroupButton>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    side="top"
                    className="w-80 max-w-[min(calc(100vw-2rem),var(--radix-popover-content-available-width))] max-h-[min(22rem,var(--radix-popover-content-available-height))] overflow-y-auto"
                    collisionBoundary={panel.current}
                    collisionPadding={8}
                    aria-label="引用素材列表"
                    onOpenAutoFocus={(event) => {
                      event.preventDefault()
                      firstMaterialAction.current?.focus()
                    }}
                    onCloseAutoFocus={(event) => {
                      event.preventDefault()
                      input.current?.focus()
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-medium">引用本篇素材</span>
                      <IconButton icon={X} label="关闭素材引用列表" onClick={() => setMaterials(false)} />
                    </div>
                    {referencedMaterials.map((material, index) => (
                      <Button
                        ref={index === 0 ? firstMaterialAction : undefined}
                        variant="ghost"
                        className="w-full justify-start"
                        key={material.id}
                        onClick={() => {
                          reference(material.title, material.body || material.url || material.title)
                          setMaterials(false)
                        }}
                      >
                        <Paperclip size={14} />
                        <span className="min-w-0 flex-1 truncate text-left" title={material.title}>
                          {material.title}
                        </span>
                        <Plus size={13} />
                      </Button>
                    ))}
                    {!referencedMaterials.length && (
                      <p className="py-3 text-sm text-muted-foreground">
                        本篇还没有引用素材，可以先收集一份。
                      </p>
                    )}
                    <Button
                      ref={!referencedMaterials.length ? firstMaterialAction : undefined}
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={() => {
                        setMaterials(false)
                        setCaptureOpen(true)
                      }}
                    >
                      <Plus size={14} />
                      先收集一份新素材
                    </Button>
                  </PopoverContent>
                </Popover>
                <span className="agent-model">
                  <i />
                  创作助手
                </span>
              </div>
              <InputGroupButton
                variant="default"
                size="icon-sm"
                className="send-button"
                disabled={!composer.trim() || busy}
                aria-label="发送消息"
                onClick={sendMessage}
              >
                {busy ? <RefreshCw className="spin" size={17} /> : <Send size={20} />}
              </InputGroupButton>
            </div>
          </InputGroupAddon>
        </InputGroup>
        <p className="composer-caption">
          <span>
            {state.preferences.enterToSend ? 'Enter 发送 · Shift+Enter 换行' : 'Ctrl/Cmd+Enter 发送'}
          </span>
          <span>本机演示</span>
        </p>
      </div>
    </aside>
  )
}

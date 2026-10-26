import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from '@/components/ui/resizable'
import { SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { StudioSidebar } from './components/StudioSidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useMediaQuery } from '@/hooks/use-media-query'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import {
  Bookmark,
  ChevronRight,
  CircleHelp,
  FileText,
  ListTodo,
  MessageCircle,
  MoreHorizontal,
  Settings,
  Trash2,
  Upload,
  Clapperboard,
  Paperclip,
  SquarePen,
  X,
} from 'lucide-react'
import { AgentPanel } from './components/Agent'
import { Field, IconButton, Modal } from './components/ui'
import { StudioProvider, useStudio } from './studio/store'
import { makeProject } from './studio/mock'
import { stopCreationRun } from './studio/creation'
import { type Artifact, type Page, type Project } from './studio/types'
import { ArticlePage, PlatformDialog } from './pages/Article'
import { BriefPage } from './pages/Brief'
import { HotspotsPage, SourcesPage } from './pages/Hotspots'
import { MaterialCapture, MaterialsPage } from './pages/Materials'
import { VideosPage } from './pages/Videos'
import { PublishPage } from './pages/Publish'
import { SettingsPage } from './pages/Settings'
import { TasksPage } from './pages/Tasks'
// 面包屑分区命名（G4）：首段固定复用侧栏同名入口，二级页用「>」连接，
// 不再自创「/」分隔或另起分区名（48「热点 / 来源管理」即由此修掉）。
const pageCrumbs: Record<Page, { section: string; page?: string }> = {
  hotspots: { section: '热点' },
  sources: { section: '热点', page: '来源管理' },
  library: { section: '素材库' },
  settings: { section: '设置' },
  tasks: { section: '任务中心' },
  publish: { section: '发布准备' },
  plan: { section: '创作方案' },
  article: { section: '文稿' },
  video: { section: '视频' },
  materials: { section: '参考素材' },
}
export function App() {
  return (
    <TooltipProvider delayDuration={350}>
      <StudioProvider>
        <SidebarProvider defaultOpen={window.innerWidth >= 768} className="h-dvh min-h-0">
          <Workbench />
        </SidebarProvider>
        <Toaster position="bottom-center" closeButton />
      </StudioProvider>
    </TooltipProvider>
  )
}
function Workbench() {
  // Move the same workspace host between layouts so resizing retains page-local state.
  const [workspaceHost] = useState(() => {
    const host = document.createElement('div')
    host.className = 'h-full min-h-0 min-w-0'
    return host
  })
  const workspaceFocus = useRef<HTMLElement | null>(null)
  const [auxiliaryHost] = useState(() => {
    const host = document.createElement('div')
    host.className = 'h-full min-h-0 min-w-0'
    return host
  })
  const auxiliaryFocus = useRef<HTMLElement | null>(null)
  const {
    state,
    setState,
    project,
    notice,
    notify,
    newProject,
    selectProject,
    navigate,
    patchProject,
    setCaptureOpen,
  } = useStudio()
  const { open, setOpen, openMobile, setOpenMobile, isMobile } = useSidebar()
  const desktop = useMediaQuery('(min-width: 1100px)')
  const tablet = !isMobile
  const sidebarOpen = isMobile ? openMobile : open
  const setSidebarOpen = isMobile ? setOpenMobile : setOpen
  const [desktopAgentOpen, setDesktopAgentOpen] = useState(false)
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false)
  const [workspaceModalCount, setWorkspaceModalCount] = useState(0)
  const workspaceModalOpen = workspaceModalCount > 0
  useEffect(() => {
    const update = (event: Event) =>
      setWorkspaceModalCount((n) => Math.max(0, n + (event as CustomEvent<number>).detail))
    window.addEventListener('studio:modal-visibility', update)
    return () => window.removeEventListener('studio:modal-visibility', update)
  }, [])
  const toolPage = state.page === 'plan' || state.page === 'materials'
  const assistantAvailable = ['article', 'video', 'hotspots', 'sources'].includes(state.page)
  const agentOpen = toolPage || (assistantAvailable && (desktop ? desktopAgentOpen : agentDrawerOpen))
  const setAgentOpen = desktop ? setDesktopAgentOpen : setAgentDrawerOpen
  const [search, setSearch] = useState(''),
    [editing, setEditing] = useState<Project | null>(null),
    [renamed, setRenamed] = useState(''),
    [trash, setTrash] = useState(false),
    [more, setMore] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const projectPage = ['plan', 'article', 'video', 'materials', 'publish'].includes(state.page)
  const mainPage = toolPage ? (project.activeTab === 'video' ? 'video' : 'article') : state.page
  const toolsTrigger = useRef<HTMLButtonElement>(null)
  const returningFromTools = useRef(false)
  const hasContent =
    Object.values(project.drafts).some((d) => d?.body.trim()) || project.videos.some((v) => v.adopted)
  const pendingTasks = state.tasks.filter((t) => ['queued', 'running'].includes(t.state)).length
  useEffect(() => {
    const navigation = document.querySelector('.artifact-nav')
    if (!navigation) return
    const reveal = () =>
      navigation
        .querySelector('[data-state="active"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const observer = new ResizeObserver(reveal)
    observer.observe(navigation)
    reveal()
    return () => observer.disconnect()
  }, [state.page, projectPage])
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (event.isComposing) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSidebarOpen(true)
        setTimeout(() => searchRef.current?.focus(), 0)
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setAgentOpen(false)
        newProject()
        setSearch('')
      }
    }
    const openAgent = () => {
      if (state.page === 'plan' || state.page === 'materials')
        navigate(project.activeTab === 'video' ? 'video' : 'article')
      else if (['library', 'settings', 'tasks', 'publish'].includes(state.page)) navigate('article')
      setAgentOpen(true)
    }
    window.addEventListener('keydown', keyboard)
    window.addEventListener('studio:open-agent', openAgent)
    return () => {
      window.removeEventListener('keydown', keyboard)
      window.removeEventListener('studio:open-agent', openAgent)
    }
  }, [setSidebarOpen, newProject, setAgentOpen, state.page, project.activeTab])
  useEffect(() => {
    if (desktop) setAgentDrawerOpen(false)
  }, [desktop])
  function choose(id: string, tab?: Artifact) {
    selectProject(id, tab)
    if (window.innerWidth < 768) setSidebarOpen(false)
  }
  function go(page: Parameters<typeof navigate>[0]) {
    navigate(page)
    if (window.innerWidth < 768) setSidebarOpen(false)
  }
  async function openDesigns() {
    setMore(false)
    if (!window.desktop) {
      notify('设计总览保存在项目 docs/ux/index.html，可从文件面板打开。')
      return
    }
    try {
      const result = await window.desktop.openDesigns()
      if (!result.ok) notify(result.message ?? '无法打开设计总览。')
    } catch {
      notify('打开失败，请从 docs/ux/index.html 查看设计。')
    }
  }
  function trashProject() {
    if (!editing) return
    setState((s) => {
      const stopped = stopCreationRun(s, editing.id, '作品已移入回收站，整理停止；原始记录保留。')
      const projects = stopped.projects.map((p) =>
        p.id === editing.id
          ? {
              ...p,
              trashed: true,
            }
          : p,
      )
      let next = projects.find((p) => !p.trashed)
      if (!next) {
        next = makeProject()
        projects.unshift(next)
      }
      return {
        ...stopped,
        projects,
        selectedProject: s.selectedProject === editing.id ? next.id : s.selectedProject,
        page: s.selectedProject === editing.id ? next.activeTab : s.page,
      }
    })
    setEditing(null)
    setTrash(false)
    notify('内容已移入回收站，平台稿、对话和历史一并保留。')
  }
  const renderPage = () => {
    switch (mainPage) {
      case 'article':
        return <ArticlePage />
      case 'plan':
        return <ArticlePage />
      case 'video':
        return <VideosPage key={project.id} />
      case 'materials':
        return <ArticlePage />
      case 'library':
        return <MaterialsPage global key="global" />
      case 'hotspots':
        return <HotspotsPage />
      case 'sources':
        return <SourcesPage />
      case 'publish':
        return <PublishPage key={project.id} />
      case 'settings':
        return <SettingsPage />
      case 'tasks':
        return <TasksPage />
    }
  }
  useEffect(() => {
    if (notice)
      toast(notice, {
        id: 'studio-notice',
      })
    else toast.dismiss('studio-notice')
  }, [notice])
  const sidebar = (
    <StudioSidebar
      search={search}
      searchRef={searchRef}
      onSearchChange={setSearch}
      onCreate={() => {
        setAgentOpen(false)
        newProject()
        setSearch('')
        if (window.innerWidth < 768) setSidebarOpen(false)
      }}
      onChoose={choose}
      onNavigate={go}
      onManage={(item) => {
        setEditing(item)
        setRenamed(item.title)
        setTrash(false)
      }}
      onOpenDesigns={() => void openDesigns()}
    />
  )
  const workspace = (
    <Tabs value={mainPage} onValueChange={(value) => navigate(value as Artifact)} className="gap-0" asChild>
      <main className={`work-area gap-0 ${!projectPage ? 'global-work-area' : ''}`}>
        <header className="work-header">
          {!sidebarOpen && <SidebarTrigger aria-label="展开内容库" />}
          {projectPage && state.page !== 'publish' ? (
            <div className="artifact-nav min-w-0 flex-1 py-2">
              <TabsList className="artifact-tabs" aria-label="内容产物" variant="line">
                {[
                  { id: 'article', label: '文稿', icon: FileText },
                  { id: 'video', label: '视频', icon: Clapperboard },
                ].map((tab) => (
                  <TabsTrigger
                    key={tab.id}
                    className={cn(
                      'data-[state=active]:after:bg-brand-accent [&[data-state=active]_svg]:text-brand-accent',
                      mainPage === tab.id && 'active',
                    )}
                    value={tab.id}
                  >
                    <tab.icon size={17} className="hidden md:block" />
                    <span>{tab.label}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          ) : (
            <div className="global-breadcrumb">
              {state.page === 'publish' ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="返回文稿编辑"
                    onClick={() => navigate('article')}
                  >
                    文稿
                  </Button>
                  <ChevronRight size={14} />
                  <strong>发布准备</strong>
                </>
              ) : pageCrumbs[state.page].page ? (
                <>
                  <span>{pageCrumbs[state.page].section}</span>
                  <ChevronRight size={14} />
                  <strong>{pageCrumbs[state.page].page}</strong>
                </>
              ) : (
                <strong>{pageCrumbs[state.page].section}</strong>
              )}
            </div>
          )}
          <div className="header-actions">
            {mainPage === 'article' && <div id="article-toolbar-slot" />}
            {projectPage && state.page !== 'publish' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="作品工具"
                    ref={toolsTrigger}
                    className={toolPage ? 'bg-accent' : ''}
                  >
                    <Paperclip size={16} />
                    <span className="hidden md:inline">作品工具</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onCloseAutoFocus={(event) => {
                    // Closing animation must not take focus back after the author has entered the tool.
                    if (auxiliaryHost.contains(document.activeElement)) event.preventDefault()
                  }}
                >
                  <DropdownMenuItem onSelect={() => navigate('plan')}>
                    <SquarePen size={16} />
                    创作方案
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => navigate('materials')}>
                    <Paperclip size={16} />
                    参考素材
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {projectPage && state.page !== 'publish' && hasContent && (
              <Button
                className="button primary publish-entry"
                onClick={() => navigate('publish')}
                aria-label="发布准备"
                variant="outline"
                size={tablet ? 'default' : 'icon'}
              >
                <Upload size={15} />
                <span className="hidden md:inline">发布准备</span>
              </Button>
            )}
            <DropdownMenu open={more} onOpenChange={setMore}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="更多工作区操作（含设置）"
                  className="relative"
                >
                  <MoreHorizontal size={18} />
                  {/* 关闭态提示（G2）：手机档没有常驻侧栏，「…」是设置等全局入口的唯一黑盒，
                      给一个静默小圆点提示菜单内有设置；桌面档侧栏常驻，不显示。 */}
                  <span
                    aria-hidden="true"
                    className="absolute top-1.5 right-1.5 hidden size-1.5 rounded-full bg-primary max-[767px]:block"
                  />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void openDesigns()}>
                  <CircleHelp size={15} />
                  查看设计总览
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('settings')}>
                  <Settings size={15} />
                  设置
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {assistantAvailable && !agentOpen && (
              <IconButton icon={MessageCircle} label="展开 Agent" onClick={() => setAgentOpen(true)} />
            )}
          </div>
        </header>
        {projectPage && state.page !== 'publish' ? (
          <TabsContent value={mainPage} className="current-artifact">
            {renderPage()}
          </TabsContent>
        ) : (
          <div
            className="current-artifact"
            role="region"
            aria-label={pageCrumbs[state.page].page ?? pageCrumbs[state.page].section}
          >
            {renderPage()}
          </div>
        )}
      </main>
    </Tabs>
  )
  const closePanel = () => {
    returningFromTools.current = toolPage
    if (toolPage) navigate(mainPage === 'video' ? 'video' : 'article')
    setAgentOpen(false)
  }
  const agent = toolPage ? (
    <aside className="flex h-full min-h-0 flex-col bg-background" aria-label="作品辅助工具">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <Tabs value={state.page} onValueChange={(value) => navigate(value as Artifact)}>
          <TabsList aria-label="作品辅助内容">
            <TabsTrigger value="plan">创作方案</TabsTrigger>
            <TabsTrigger value="materials">参考素材</TabsTrigger>
          </TabsList>
        </Tabs>
        <IconButton icon={X} label="关闭作品工具" onClick={closePanel} />
      </header>
      <div className="min-h-0 flex-1">
        {state.page === 'plan' ? (
          <BriefPage embedded />
        ) : (
          <MaterialsPage embedded key={`project-${project.id}`} />
        )}
      </div>
    </aside>
  ) : (
    <AgentPanel onClose={closePanel} />
  )
  return (
    <div
      className={`studio studio-components w-full ${!sidebarOpen ? 'sidebar-hidden' : ''} ${!agentOpen ? 'agent-hidden' : ''}`}
    >
      {desktop ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="desktop-panels"
          onLayoutChanged={(layout, meta) => {
            if (!meta.isUserInteraction) return
            const width =
              document.querySelector('.desktop-panels')?.getBoundingClientRect().width ?? window.innerWidth
            setState((s) => ({
              ...s,
              layout: {
                left:
                  layout.navigation == null ? s.layout.left : Math.round((layout.navigation * width) / 100),
                right: layout.agent == null ? s.layout.right : Math.round((layout.agent * width) / 100),
              },
            }))
          }}
        >
          {sidebarOpen && (
            <>
              <ResizablePanel id="navigation" defaultSize={state.layout.left} minSize={216} maxSize={320}>
                {sidebar}
              </ResizablePanel>
              <ResizableHandle aria-label="调整内容库宽度" />
            </>
          )}
          <ResizablePanel id="editor" minSize={400}>
            <WorkspaceMount host={workspaceHost} focus={workspaceFocus} />
          </ResizablePanel>
          {agentOpen && (
            <>
              <ResizableHandle aria-label="调整 Agent 宽度" />
              <ResizablePanel id="agent" defaultSize={state.layout.right} minSize={320} maxSize={480}>
                <WorkspaceMount host={auxiliaryHost} focus={auxiliaryFocus} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      ) : (
        <div className="compact-panels">
          {tablet && sidebarOpen && sidebar}
          <WorkspaceMount host={workspaceHost} focus={workspaceFocus} />
        </div>
      )}
      {createPortal(workspace, workspaceHost)}
      {createPortal(agent, auxiliaryHost)}
      <Sheet open={isMobile && openMobile} onOpenChange={setOpenMobile}>
        <SheetContent
          side="left"
          className="navigation-sheet w-4/5 gap-0 p-0 sm:max-w-sm"
          showCloseButton={false}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            searchRef.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="展开内容库"]')
            if (trigger) {
              event.preventDefault()
              trigger.focus()
            }
          }}
        >
          <SheetTitle className="sr-only">内容导航</SheetTitle>
          <SheetDescription className="sr-only">选择内容或工作区功能</SheetDescription>
          {sidebar}
        </SheetContent>
      </Sheet>
      <Sheet
        open={!desktop && agentOpen && !workspaceModalOpen}
        onOpenChange={(open) => {
          if (!open) closePanel()
        }}
      >
        <SheetContent
          className="agent-sheet w-full gap-0 p-0 sm:max-w-md"
          showCloseButton={false}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (!workspaceModalOpen)
              document.querySelector<HTMLTextAreaElement>('.agent-sheet textarea')?.focus()
          }}
          onCloseAutoFocus={(event) => {
            if (desktop || workspaceModalOpen) {
              event.preventDefault()
              return
            }
            const trigger = returningFromTools.current
              ? toolsTrigger.current
              : document.querySelector<HTMLButtonElement>('button[aria-label="展开 Agent"]')
            if (trigger) {
              event.preventDefault()
              trigger.focus()
            }
          }}
        >
          <SheetTitle className="sr-only">{toolPage ? '作品辅助工具' : '创作 Agent'}</SheetTitle>
          <SheetDescription className="sr-only">
            {toolPage ? '调整当前作品的方案或参考素材，正文保留在工作区' : '与创作助手讨论当前内容'}
          </SheetDescription>
          <WorkspaceMount host={auxiliaryHost} focus={auxiliaryFocus} />
        </SheetContent>
      </Sheet>
      <nav className="mobile-navigation" aria-label="手机主要导航">
        {/* 激活态（G1）：当前分区墨绿图标+文字，非当前分区弱化为次要文字色，
            与桌面侧栏的选中机制对应。 */}
        <Button
          className={cn(
            state.page === 'library' ? 'active text-primary' : 'text-muted-foreground',
            'h-auto justify-start whitespace-normal text-left',
          )}
          onClick={() => setCaptureOpen(true)}
          variant="ghost"
          size="default"
        >
          {/* G5：「收集」是与内容/任务平级的栏目入口，换书签类图标表达收藏语义，
              加号留给新建/添加动作，避免误读为创建按钮。 */}
          <Bookmark size={19} />
          收集
        </Button>
        <Button
          className={cn(
            projectPage ? 'active text-primary' : 'text-muted-foreground',
            'h-auto justify-start whitespace-normal text-left',
          )}
          onClick={() => go(project.activeTab)}
          variant="ghost"
          size="default"
        >
          <FileText size={19} />
          内容
        </Button>
        <Button
          className={cn(
            state.page === 'tasks' ? 'active text-primary' : 'text-muted-foreground',
            'h-auto justify-start whitespace-normal text-left',
          )}
          onClick={() => go('tasks')}
          variant="ghost"
          size="default"
        >
          <ListTodo size={19} />
          任务{pendingTasks > 0 && <i />}
        </Button>
      </nav>
      <PlatformDialog />
      <MaterialCapture />
      {editing && (
        <Modal
          title={trash ? '将内容移入回收站？' : '管理这篇内容'}
          description={
            trash
              ? '平台版本、对话、视频和发布记录会一起保留，可从回收站恢复。'
              : '名称用于左侧内容库，不会改写各平台的独立标题。'
          }
          onClose={() => setEditing(null)}
          footer={
            trash ? (
              <>
                <Button
                  className="button secondary"
                  onClick={() => setTrash(false)}
                  variant="outline"
                  size="default"
                >
                  返回
                </Button>
                <Button className="button danger" onClick={trashProject} variant="destructive" size="default">
                  移入回收站
                </Button>
              </>
            ) : (
              <>
                <Button
                  className="text-button danger-text text-destructive"
                  onClick={() => setTrash(true)}
                  variant="ghost"
                  size="sm"
                >
                  <Trash2 size={15} />
                  移入回收站
                </Button>
                <Button
                  className="button primary"
                  disabled={!renamed.trim()}
                  onClick={() => {
                    patchProject(editing.id, (p) => ({
                      ...p,
                      title: renamed.trim(),
                    }))
                    setEditing(null)
                    notify('内容名称已更新。')
                  }}
                  variant="default"
                  size="default"
                >
                  保存名称
                </Button>
              </>
            )
          }
        >
          {trash ? (
            <p>
              「{editing.title || '未命名内容'}」包含 {Object.keys(editing.drafts).length} 份文稿、
              {editing.videos.length} 部视频。引用的全局素材仍然保留。
            </p>
          ) : (
            <Field label="内容名称">
              <Input autoFocus value={renamed} onChange={(e) => setRenamed(e.target.value)} />
            </Field>
          )}
        </Modal>
      )}
    </div>
  )
}

function WorkspaceMount({ host, focus }: { host: HTMLDivElement; focus: RefObject<HTMLElement | null> }) {
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return
      node.appendChild(host)
      if (focus.current?.isConnected) focus.current.focus({ preventScroll: true })
      focus.current = null
      return () => {
        const focused = document.activeElement
        if (focused instanceof HTMLElement && host.contains(focused)) focus.current = focused
      }
    },
    [host, focus],
  )
  return <div ref={attach} className="workspace-mount h-full min-h-0 min-w-0 flex-1" />
}

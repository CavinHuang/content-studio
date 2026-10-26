import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from '@/components/ui/resizable'
import { SidebarProvider, SidebarTrigger, useSidebar } from '@/components/ui/sidebar'
import { StudioSidebar } from './components/StudioSidebar'
import { artifactTabs as tabs } from './studio/navigation'
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
  ArrowDownToLine,
  ChevronRight,
  CircleHelp,
  FileText,
  ListTodo,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Settings,
  Trash2,
  Upload,
} from 'lucide-react'
import { AgentPanel } from './components/Agent'
import { download, Field, IconButton, Modal } from './components/ui'
import { StudioProvider, useStudio } from './studio/store'
import { makeProject } from './studio/mock'
import { type Artifact, type Project } from './studio/types'
import { ArticlePage, PlatformDialog } from './pages/Article'
import { BriefPage } from './pages/Brief'
import { HotspotsPage, SourcesPage } from './pages/Hotspots'
import { MaterialCapture, MaterialsPage } from './pages/Materials'
import { VideosPage } from './pages/Videos'
import { PublishPage } from './pages/Publish'
import { SettingsPage } from './pages/Settings'
import { TasksPage } from './pages/Tasks'
const pageNames = {
  hotspots: '热点发现',
  sources: '热点 / 来源管理',
  library: '全局素材库',
  settings: '工作台设置',
  tasks: '任务中心',
  publish: '发布准备',
  plan: '创作方案',
  article: '文稿',
  video: '视频',
  materials: '参考素材',
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
  const [desktopAgentOpen, setDesktopAgentOpen] = useState(true)
  const [agentDrawerOpen, setAgentDrawerOpen] = useState(false)
  const agentOpen = desktop ? desktopAgentOpen : agentDrawerOpen
  const setAgentOpen = desktop ? setDesktopAgentOpen : setAgentDrawerOpen
  const [search, setSearch] = useState(''),
    [editing, setEditing] = useState<Project | null>(null),
    [renamed, setRenamed] = useState(''),
    [trash, setTrash] = useState(false),
    [more, setMore] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const projectPage = ['plan', 'article', 'video', 'materials', 'publish'].includes(state.page)
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
        newProject()
        setSearch('')
      }
    }
    const openAgent = () => setAgentOpen(true)
    window.addEventListener('keydown', keyboard)
    window.addEventListener('studio:open-agent', openAgent)
    return () => {
      window.removeEventListener('keydown', keyboard)
      window.removeEventListener('studio:open-agent', openAgent)
    }
  }, [setSidebarOpen, newProject, setAgentOpen])
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
      const projects = s.projects.map((p) =>
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
        ...s,
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
    switch (state.page) {
      case 'article':
        return <ArticlePage />
      case 'plan':
        return <BriefPage />
      case 'video':
        return <VideosPage key={project.id} />
      case 'materials':
        return <MaterialsPage key={`project-${project.id}`} />
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
    <Tabs value={state.page} onValueChange={(value) => navigate(value as Artifact)} className="gap-0" asChild>
      <main className={`work-area gap-0 ${!projectPage ? 'global-work-area' : ''}`}>
        <header className="work-header">
          {!sidebarOpen && <SidebarTrigger aria-label="展开内容库" />}
          {projectPage ? (
            <div className="artifact-nav min-w-0 flex-1 overflow-x-auto py-2 [scrollbar-width:none]">
              <TabsList className="artifact-tabs" aria-label="内容产物" variant="line">
                {tabs.map((tab) => (
                  <TabsTrigger
                    key={tab.id}
                    className={cn(
                      'data-[state=active]:after:bg-brand-accent [&[data-state=active]_svg]:text-brand-accent',
                      state.page === tab.id && 'active',
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
              <span>工作区</span>
              <ChevronRight size={14} />
              <strong>{pageNames[state.page]}</strong>
            </div>
          )}
          <div className="header-actions">
            {state.page === 'article' && <div id="article-toolbar-slot" />}
            {projectPage && (
              <Button
                className="button primary publish-entry"
                onClick={() => navigate('publish')}
                aria-label="发布准备"
                variant="default"
                size={tablet ? 'default' : 'icon'}
              >
                <Upload size={15} />
                <span className="hidden md:inline">发布准备</span>
              </Button>
            )}
            <DropdownMenu open={more} onOpenChange={setMore}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="更多工作区操作">
                  <MoreHorizontal size={18} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    const draft = project.drafts[project.activePlatform] ?? project.drafts.master!
                    download((draft.title || '文稿') + '.md', '# ' + draft.title + '\n\n' + draft.body)
                    notify('当前文稿已导出为 Markdown。')
                  }}
                >
                  <ArrowDownToLine size={15} />
                  导出当前文稿
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void openDesigns()}>
                  <CircleHelp size={15} />
                  查看设计总览
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('settings')}>
                  <Settings size={15} />
                  工作台设置
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {!agentOpen && (
              <IconButton icon={MessageCircle} label="展开 Agent" onClick={() => setAgentOpen(true)} />
            )}
          </div>
        </header>
        {projectPage && state.page !== 'publish' ? (
          <TabsContent value={state.page} className="current-artifact">
            {renderPage()}
          </TabsContent>
        ) : (
          <div className="current-artifact" role="region" aria-label={pageNames[state.page]}>
            {renderPage()}
          </div>
        )}
      </main>
    </Tabs>
  )
  const agent = <AgentPanel onClose={() => setAgentOpen(false)} />
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
                {agent}
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
      <Sheet open={!desktop && agentDrawerOpen} onOpenChange={setAgentDrawerOpen}>
        <SheetContent
          className="agent-sheet w-full gap-0 p-0 sm:max-w-md"
          showCloseButton={false}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            document.querySelector<HTMLTextAreaElement>('.agent-sheet textarea')?.focus()
          }}
          onCloseAutoFocus={(event) => {
            const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="展开 Agent"]')
            if (trigger) {
              event.preventDefault()
              trigger.focus()
            }
          }}
        >
          <SheetTitle className="sr-only">创作 Agent</SheetTitle>
          <SheetDescription className="sr-only">与创作助手讨论当前内容</SheetDescription>
          {agent}
        </SheetContent>
      </Sheet>
      <nav className="mobile-navigation" aria-label="手机主要导航">
        <Button
          className={cn(
            state.page === 'library' ? 'active' : '',
            'h-auto justify-start whitespace-normal text-left',
          )}
          onClick={() => setCaptureOpen(true)}
          variant="ghost"
          size="default"
        >
          <Plus size={19} />
          收集
        </Button>
        <Button
          className={cn(projectPage ? 'active' : '', 'h-auto justify-start whitespace-normal text-left')}
          onClick={() => go(project.activeTab)}
          variant="ghost"
          size="default"
        >
          <FileText size={19} />
          内容
        </Button>
        <Button
          className={cn(
            state.page === 'tasks' ? 'active' : '',
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

import type { RefObject } from 'react'
import {
  CircleHelp,
  FileText,
  Flame,
  FolderOpen,
  ListTodo,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
} from 'lucide-react'
import { Brand } from './ui'
import { Button } from './ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from './ui/input-group'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from './ui/sidebar'
import { useStudio } from '../studio/store'
import type { Artifact, Project } from '../studio/types'
import { useMediaQuery } from '@/hooks/use-media-query'

type StudioSidebarProps = {
  search: string
  searchRef: RefObject<HTMLInputElement | null>
  onSearchChange: (value: string) => void
  onCreate: () => void
  onChoose: (id: string, tab?: Artifact) => void
  onNavigate: (page: Parameters<ReturnType<typeof useStudio>['navigate']>[0]) => void
  onManage: (project: Project) => void
  onOpenDesigns: () => void
}

export function StudioSidebar({
  search,
  searchRef,
  onSearchChange,
  onCreate,
  onChoose,
  onNavigate,
  onManage,
  onOpenDesigns,
}: StudioSidebarProps) {
  const { state, project } = useStudio()
  const { isMobile } = useSidebar()
  const desktop = useMediaQuery('(min-width: 1100px)')
  const compact = !isMobile && !desktop
  const projectPage = ['plan', 'article', 'video', 'materials', 'publish'].includes(state.page)
  const projects = state.projects.filter((item) => !item.trashed)
  const visibleProjects = projects.filter((item) =>
    `${item.title || '未命名内容'}${item.brief.point}`.toLowerCase().includes(search.toLowerCase()),
  )
  const pending = state.tasks.filter((task) => ['queued', 'running'].includes(task.state)).length
  const attention = state.tasks.filter((task) => ['failed', 'stopped'].includes(task.state)).length
  const shortcut = /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'

  return (
    <Sidebar
      collapsible="none"
      className="sidebar min-h-0 md:max-[1100px]:border-r md:max-[1100px]:border-sidebar-border"
      style={{ width: compact ? 256 : '100%', flexShrink: 0 }}
      role="complementary"
      aria-label="内容导航"
    >
      <SidebarHeader className="gap-2 p-0">
        <div className="sidebar-brand flex h-14 shrink-0 items-center gap-2 border-b px-3">
          <Brand />
          <strong className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
            Content Studio
          </strong>
          <SidebarTrigger className="shrink-0" aria-label="收起内容库" />
        </div>
        <div className="sidebar-actions grid gap-2 px-2">
          <Button className="new-content w-full justify-start" onClick={onCreate}>
            <Plus />
            新建内容
            <span className="ml-auto text-xs text-primary-foreground/70" aria-hidden="true">
              {shortcut} N
            </span>
          </Button>
          <InputGroup className="bg-background shadow-none">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              ref={searchRef}
              aria-label="搜索内容"
              placeholder="搜索内容…"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
            <InputGroupAddon align="inline-end">
              <kbd className="text-xs">{shortcut} K</kbd>
            </InputGroupAddon>
          </InputGroup>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-1">
        <SidebarGroup className="global-nav">
          <SidebarGroupContent>
            <SidebarMenu aria-label="工作区导航">
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={['hotspots', 'sources'].includes(state.page)}
                  onClick={() => onNavigate('hotspots')}
                >
                  <Flame />
                  <span>热点</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="pr-10"
                  isActive={state.page === 'library'}
                  onClick={() => onNavigate('library')}
                >
                  <FolderOpen />
                  <span>素材库</span>
                </SidebarMenuButton>
                <SidebarMenuBadge aria-label="素材数量">
                  {state.materials.filter((item) => !item.trashed).length}
                </SidebarMenuBadge>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="pt-0">
          <SidebarGroupLabel>
            我的内容<span className="ml-2 tabular-nums text-muted-foreground">{projects.length}</span>
          </SidebarGroupLabel>
          <SidebarGroupAction aria-label="新建一篇内容" title="新建一篇内容" onClick={onCreate}>
            <Plus />
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu aria-label="我的内容">
              {visibleProjects.map((item) => {
                const selected = item.id === project.id && projectPage
                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      className="project-item"
                      title={item.title || '未命名内容'}
                      isActive={selected}
                      onClick={() => onChoose(item.id)}
                    >
                      <FileText className="project-file" />
                      <span>{item.title || '未命名内容'}</span>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      showOnHover
                      aria-label={`管理内容：${item.title || '未命名内容'}`}
                      onClick={() => onManage(item)}
                    >
                      <MoreHorizontal />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
            {visibleProjects.length === 0 && (
              <div className="px-2 py-4 text-sm text-muted-foreground" role="status">
                <p>没有找到相关内容</p>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-0 py-1"
                  onClick={() => onSearchChange('')}
                >
                  清除搜索
                </Button>
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator className="data-[orientation=horizontal]:w-auto" />
      <SidebarFooter className="sidebar-bottom">
        <SidebarMenu aria-label="工作区工具">
          <SidebarMenuItem>
            <SidebarMenuButton
              className="pr-20"
              isActive={state.page === 'tasks'}
              onClick={() => onNavigate('tasks')}
            >
              <ListTodo />
              <span>任务中心</span>
            </SidebarMenuButton>
            {(pending > 0 || attention > 0) && (
              <SidebarMenuBadge className="text-muted-foreground">
                {pending > 0 ? `${pending} 进行中` : `${attention} 需要留意`}
              </SidebarMenuBadge>
            )}
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton isActive={state.page === 'settings'} onClick={() => onNavigate('settings')}>
              <Settings />
              <span>设置</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="flex min-w-0 items-center gap-2 px-2 text-xs text-muted-foreground">
          <span className="size-1.5 shrink-0 rounded-full bg-primary" />
          <span className="min-w-0 flex-1 truncate">本机工作区 · Mock 演示</span>
          <Button variant="ghost" size="icon-xs" aria-label="打开设计总览" onClick={onOpenDesigns}>
            <CircleHelp />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}

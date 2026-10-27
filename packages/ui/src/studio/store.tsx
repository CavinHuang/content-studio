import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { makeProject, platformContent, seedState, topics } from './mock'
import {
  applyCreation,
  beginCreation,
  creationSnapshot,
  finishCreation,
  recoverCreation,
  stopCreationRun,
  syncCreationTask,
} from './creation'
import {
  makeDraft,
  now,
  uid,
  versioned,
  type Artifact,
  type Draft,
  type Material,
  type Page,
  type Platform,
  type Project,
  type StudioState,
  type Task,
  type Topic,
} from './types'

const KEY = 'content-studio.mock-workspace.v2'
function readState(): StudioState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as StudioState | null
    if (
      saved?.schema === 2 &&
      Array.isArray(saved.projects) &&
      saved.projects.length &&
      Array.isArray(saved.materials) &&
      saved.preferences &&
      saved.hotspotFilters
    ) {
      // A browser/app restart interrupts local simulated tasks; never leave a false running state.
      const fallback = seedState()
      return {
        ...saved,
        projects: saved.projects.map((project) => ({
          ...project,
          creation: recoverCreation(project.creation),
          drafts: Object.fromEntries(
            Object.entries(project.drafts).map(([platform, draft]) => {
              if (!draft) return [platform, draft]
              const old = draft.typography
              return [
                platform,
                old.font === 'serif' &&
                old.size === 17 &&
                old.lineHeight === 1.95 &&
                old.spacing === 20 &&
                old.padding === 40
                  ? { ...draft, typography: fallback.projects[0]!.drafts.master!.typography }
                  : draft,
              ]
            }),
          ),
        })),
        // Upgrade the previous untouched panel defaults; explicit user sizing stays intact.
        layout:
          (saved.layout?.left === 244 && saved.layout?.right === 368) ||
          (saved.layout?.left === 272 && saved.layout?.right === 416)
            ? fallback.layout
            : (saved.layout ?? fallback.layout),
        discoveryConversations: saved.discoveryConversations ?? fallback.discoveryConversations,
        activeDiscovery: saved.activeDiscovery ?? fallback.activeDiscovery,
        tasks: saved.tasks.map((t) =>
          ['running', 'queued'].includes(t.state)
            ? { ...t, state: 'stopped', detail: '应用已重新打开。演示任务已停止，可重新运行。' }
            : t,
        ),
      }
    }
    const seeded = seedState()
    const legacy = JSON.parse(localStorage.getItem('content-studio.documents.v1') ?? 'null') as
      { id: string; title: string; body: string }[] | null
    if (Array.isArray(legacy)) {
      const retained = legacy
        .filter(
          (d) =>
            typeof d.title === 'string' && typeof d.body === 'string' && (d.title.trim() || d.body.trim()),
        )
        .map((d) => {
          const project = makeProject(d.title)
          project.drafts.master = makeDraft(d.title, d.body, '从初始化文稿导入')
          return project
        })
      seeded.projects.push(...retained)
    }
    return seeded
  } catch {
    return seedState()
  }
}

type ContextReference = { label: string; text: string; platform?: Platform }
type AgentDraft = { composer: string; context: ContextReference | null }
type Store = {
  state: StudioState
  setState: Dispatch<SetStateAction<StudioState>>
  project: Project
  notice: string
  notify: (message: string) => void
  saveState: string
  retrySave: () => void
  captureOpen: boolean
  setCaptureOpen: Dispatch<SetStateAction<boolean>>
  platformsOpen: boolean
  setPlatformsOpen: Dispatch<SetStateAction<boolean>>
  context: ContextReference | null
  setContext: Dispatch<SetStateAction<ContextReference | null>>
  composer: string
  setComposer: Dispatch<SetStateAction<string>>
  clearAgentDrafts: () => void
  navigate: (page: Page) => void
  selectProject: (id: string, tab?: Artifact) => void
  patchProject: (id: string, updater: (p: Project) => Project) => void
  patchDraft: (patch: Partial<Draft>, label?: string, platform?: Platform) => void
  newProject: () => void
  updateCreationInput: (input: string) => void
  runCreation: () => void
  stopCreation: () => void
  acceptCreation: () => void
  undoCreation: () => void
  createFromTopic: (topic: Topic) => void
  generatePlatforms: (platforms: Platform[]) => void
  generateArticle: () => void
  sendMessage: () => void
  resolveSuggestion: (id: string, action: 'accept' | 'reject' | 'undo') => void
  task: (
    title: string,
    detail: string,
    kind: Task['kind'],
    complete?: (state: StudioState) => StudioState,
    extra?: Partial<Task>,
  ) => string
  controlTask: (id: string, action: 'stop' | 'retry') => void
  reference: (label: string, text: string) => void
}
const StudioContext = createContext<Store | null>(null)
export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(readState)
  const [notice, notify] = useState('')
  const [saveState, setSaveState] = useState('已保存')
  const [captureOpen, setCaptureOpen] = useState(false)
  const [platformsOpen, setPlatformsOpen] = useState(false)
  const [agentDrafts, setAgentDrafts] = useState<Record<string, AgentDraft>>({})
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const creationTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const stateRef = useRef(state)
  stateRef.current = state
  const project =
    state.projects.find((p) => p.id === state.selectedProject && !p.trashed) ??
    state.projects.find((p) => !p.trashed) ??
    state.projects[0]!
  const discovery = ['hotspots', 'sources'].includes(state.page)
  const conversationId = discovery ? state.activeDiscovery : project.activeConversation
  const draftKey = discovery ? `discovery:${conversationId}` : `${project.id}:${conversationId}`
  const { composer = '', context = null } = agentDrafts[draftKey] ?? {}
  const setComposer: Dispatch<SetStateAction<string>> = (value) => {
    setAgentDrafts((drafts) => {
      const current = drafts[draftKey] ?? { composer: '', context: null }
      return {
        ...drafts,
        [draftKey]: { ...current, composer: typeof value === 'function' ? value(current.composer) : value },
      }
    })
  }
  const setContext: Dispatch<SetStateAction<ContextReference | null>> = (value) => {
    setAgentDrafts((drafts) => {
      const current = drafts[draftKey] ?? { composer: '', context: null }
      return {
        ...drafts,
        [draftKey]: { ...current, context: typeof value === 'function' ? value(current.context) : value },
      }
    })
  }
  const clearAgentDrafts = () => setAgentDrafts({})
  const retrySave = useCallback(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(stateRef.current))
      setSaveState('已保存')
    } catch {
      setSaveState('保存失败')
      notify('本机空间不足，请在「设置 → 数据与导出」备份当前内容后再重试。')
    }
  }, [])
  useEffect(() => {
    setSaveState('保存中')
    const timer = setTimeout(retrySave, 180)
    const flush = () => retrySave()
    window.addEventListener('pagehide', flush)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pagehide', flush)
    }
  }, [state, retrySave])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => notify(''), 5500)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout)
    },
    [],
  )
  useEffect(() => {
    const running = state.projects.filter(
      (p) => !p.trashed && p.creation?.status === 'running' && p.creation.runId,
    )
    const active = new Set(running.map((p) => p.creation!.runId!))
    for (const [runId, timer] of creationTimers.current) {
      if (!active.has(runId)) {
        clearTimeout(timer)
        timers.current.delete(timer)
        creationTimers.current.delete(runId)
      }
    }
    for (const p of running) {
      const runId = p.creation!.runId!
      if (creationTimers.current.has(runId)) continue
      const timer = setTimeout(() => {
        timers.current.delete(timer)
        setState((s) => finishCreation(s, p.id, runId))
      }, 1000)
      creationTimers.current.set(runId, timer)
      timers.current.add(timer)
    }
  }, [state.projects])
  const patchProject = useCallback(
    (id: string, updater: (p: Project) => Project) =>
      setState((s) =>
        syncCreationTask(
          {
            ...s,
            projects: s.projects.map((p) => (p.id === id ? { ...updater(p), updated: now() } : p)),
          },
          id,
        ),
      ),
    [],
  )
  function navigate(page: Page) {
    if (['article', 'video'].includes(page))
      patchProject(project.id, (p) => ({ ...p, activeTab: page as Artifact }))
    setState((s) => ({ ...s, page }))
  }
  function selectProject(id: string, tab?: Artifact) {
    setState((s) => {
      const previous = s.projects.find((p) => p.id === id)?.activeTab
      return { ...s, selectedProject: id, page: tab ?? (previous === 'video' ? 'video' : 'article') }
    })
  }
  function patchDraft(patch: Partial<Draft>, label?: string, platform = project.activePlatform) {
    patchProject(project.id, (p) => {
      const current = p.drafts[platform] ?? makeDraft(p.title)
      const next = label ? versioned(current, patch, label) : { ...current, ...patch, updated: now() }
      return {
        ...p,
        title: platform === 'master' && patch.title !== undefined ? patch.title : p.title,
        drafts: { ...p.drafts, [platform]: next },
      }
    })
  }
  function task(
    title: string,
    detail: string,
    kind: Task['kind'],
    complete?: (s: StudioState) => StudioState,
    extra: Partial<Task> = {},
  ) {
    const id = uid()
    setState((s) => ({
      ...s,
      tasks: [
        { id, title, detail, projectId: project.id, state: 'running', kind, at: now(), ...extra },
        ...s.tasks,
      ],
    }))
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      setState((s) => {
        if (s.tasks.find((t) => t.id === id)?.state !== 'running') return s
        const result = complete ? complete(s) : s
        return {
          ...result,
          tasks: result.tasks.map((t) =>
            t.id === id && t.state === 'running'
              ? { ...t, state: 'complete', detail: '演示任务已完成；未调用外部服务。' }
              : t,
          ),
        }
      })
    }, 1000)
    timers.current.add(timer)
    return id
  }
  function controlTask(id: string, action: 'stop' | 'retry') {
    const target = state.tasks.find((t) => t.id === id)
    if (!target) return
    if (target.kind === 'creation') {
      setState((s) => {
        const current = s.tasks.find((t) => t.id === id)
        const owner = s.projects.find((p) => p.id === current?.projectId && !p.trashed)
        if (!current || !owner) return s
        if (action === 'stop') return owner.creation?.runId === id ? stopCreationRun(s, owner.id) : s
        return beginCreation(s, owner.id).state
      })
      notify(
        action === 'stop'
          ? '整理已停止，记录与母稿保留。'
          : '已按这篇内容的当前记录重新整理；已有正文会保留。',
      )
      return
    }
    if (action === 'stop') {
      setState((s) => ({
        ...s,
        tasks: s.tasks.map((t) =>
          t.id === id ? { ...t, state: 'stopped', detail: '已停止演示，之前的文稿与作品保持可用。' } : t,
        ),
      }))
      notify('任务已停止，已完成内容仍然保留。')
    } else {
      task(target.title, '正在重试当前任务（演示）…', target.kind, undefined, {
        projectId: target.projectId,
        videoId: target.videoId,
        version: target.version,
        snapshot: target.snapshot,
      })
      notify('已创建一次演示重试，原失败记录保留。视频仍需单独导出文件。')
    }
  }
  function newProject() {
    const next = makeProject()
    next.creation = { input: '', status: 'idle' }
    next.brief.tone = state.preferences.tone
    setState((s) => ({ ...s, projects: [next, ...s.projects], selectedProject: next.id, page: 'article' }))
  }
  function updateCreationInput(input: string) {
    const id = project.id
    setState((s) => {
      const stopped = stopCreationRun(s, id, '原始记录已修改，旧整理任务已停止。')
      return {
        ...stopped,
        projects: stopped.projects.map((p) =>
          p.id === id
            ? {
                ...p,
                updated: now(),
                creation: {
                  ...(p.creation ?? { input: '', status: 'idle' }),
                  input,
                  source: 'input',
                  status: 'idle',
                  candidate: undefined,
                  message: undefined,
                  runId: undefined,
                },
              }
            : p,
        ),
      }
    })
  }
  function runCreation() {
    const id = project.id
    setState((s) => beginCreation(s, id).state)
  }
  function stopCreation() {
    setState((s) => stopCreationRun(s, project.id))
  }
  function acceptCreation() {
    patchProject(project.id, (p) => {
      const flow = p.creation
      const candidate = flow?.candidate
      if (flow?.status !== 'candidate' || !candidate) return p
      const master = p.drafts.master!
      if (
        candidate.baseTitle !== master.title ||
        candidate.baseBody !== master.body ||
        JSON.stringify(flow.snapshot) !== JSON.stringify(creationSnapshot(stateRef.current, p))
      ) {
        return {
          ...p,
          creation: { ...flow, message: '母稿、方向或素材已变化。请重新整理；现有正文和候选均已保留。' },
        }
      }
      return applyCreation(p, candidate.title, candidate.body)
    })
  }
  function undoCreation() {
    patchProject(project.id, (p) => {
      const applied = p.creation?.applied
      const master = p.drafts.master!
      if (!applied || master.title !== applied.title || master.body !== applied.body) return p
      return {
        ...p,
        title: applied.previousTitle,
        drafts: {
          ...p.drafts,
          master: versioned(
            master,
            { title: applied.previousTitle, body: applied.previousBody },
            '撤销材料整理',
          ),
        },
        creation: {
          ...p.creation!,
          status: 'idle',
          applied: undefined,
          message: '已撤销整理。原始输入和版本记录均保留。',
        },
      }
    })
  }
  function createFromTopic(topic: Topic) {
    const draft = state.topicDrafts[topic.id] ?? {
      angle: topic.angles[0]!,
      articleIds: topic.articles.map((a) => a.id),
      requirements: '',
    }
    if (!draft?.angle.trim() || !draft.articleIds.length) {
      notify('请填写一个创作角度，并至少选择一篇来源。')
      return
    }
    const next = makeProject(draft.angle)
    next.activeTab = 'plan'
    next.brief = {
      ...next.brief,
      point: draft.angle,
      topic: topic.title,
      tone: draft.requirements || next.brief.tone,
    }
    next.source = {
      topicId: topic.id,
      title: topic.title,
      angle: draft.angle,
      articleIds: [...draft.articleIds],
      at: now(),
    }
    const materials: Material[] = topic.articles
      .filter((a) => draft.articleIds.includes(a.id))
      .map((a) => ({
        id: uid(),
        title: a.title,
        type: 'link',
        body: a.body,
        url: a.url,
        readState: a.body ? 'ready' : 'link-only',
        tags: [topic.category, '热点来源'],
        at: now(),
      }))
    next.materialIds = materials.map((m) => m.id)
    next.conversations[0]!.title = '从热点梳理创作方向'
    next.conversations[0]!.messages = [
      {
        id: uid(),
        role: 'assistant',
        at: now(),
        text: `已带入「${topic.title}」的 ${materials.length} 篇来源快照。创作方案已准备好，你可以修改观点和大纲，确认后再生成母稿。`,
        action: 'plan',
      },
    ]
    setState((s) => ({
      ...s,
      projects: [next, ...s.projects],
      materials: [...materials, ...s.materials],
      selectedProject: next.id,
      page: 'plan',
    }))
    notify('已创建独立内容，并保留本次选题与来源快照。')
  }
  function generateArticle() {
    const id = project.id
    setState((s) => {
      const started = beginCreation(s, id, 'plan').state
      return {
        ...started,
        page: 'article',
        projects: started.projects.map((p) =>
          p.id === id ? { ...p, activeTab: 'article', activePlatform: 'master' } : p,
        ),
      }
    })
    notify(
      project.drafts.master?.body.trim()
        ? '正在基于方案、原始记录和素材准备候选，现有母稿保留。'
        : '正在基于方案、原始记录和素材整理底稿。',
    )
  }
  function generatePlatforms(platforms: Platform[]) {
    const id = project.id
    const master = structuredClone(project.drafts.master ?? makeDraft(project.title))
    if (!master.body.trim()) {
      notify('请先写一些母稿内容，再创建平台版本。')
      return
    }
    const originals = Object.fromEntries(platforms.map((p) => [p, project.drafts[p]?.body]))
    task('准备平台版本', `正在适配 ${platforms.length} 个所选平台（演示）…`, 'agent', (s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (p.id !== id) return p
        const drafts = { ...p.drafts }
        for (const platform of platforms) {
          // Existing platform drafts never get overwritten by a batch generation.
          if (drafts[platform] || originals[platform] !== undefined) continue
          const content = platformContent(platform, master.title, master.body)
          drafts[platform] = {
            ...makeDraft(content.title, content.body, '从母稿适配（示例）'),
            ...content,
            sourceBody: master.body,
            sourceVersion: master.versions.at(-1)?.number ?? 1,
          }
        }
        return { ...p, drafts }
      }),
    }))
    setPlatformsOpen(false)
    notify('正在创建所选平台的示例版本，已有平台稿会保留。')
  }
  function reference(label: string, text: string) {
    setContext({ label, text, platform: project.activePlatform })
    setComposer((current) => (current.trim() ? current : '请结合这段内容，帮我继续梳理。'))
    window.dispatchEvent(new Event('studio:open-agent'))
  }
  function sendMessage() {
    const text = composer.trim()
    if (!text) return
    if (['hotspots', 'sources'].includes(state.page)) {
      const threadId = state.activeDiscovery
      const topic = topics.find((t) => t.id === state.selectedTopic)
      const angle = topic ? state.topicDrafts[topic.id]?.angle : undefined
      const user = {
        id: uid(),
        role: 'user' as const,
        text: `${topic ? `当前热点：${topic.title}\n${angle ? `角度：${angle}\n` : ''}\n` : ''}${text}`,
        at: now(),
      }
      setState((s) => ({
        ...s,
        discoveryConversations: s.discoveryConversations.map((c) =>
          c.id === threadId ? { ...c, messages: [...c.messages, user] } : c,
        ),
      }))
      setComposer('')
      setContext(null)
      task('Agent 正在整理建议', '围绕所选热点整理角度（演示）…', 'agent', (s) => ({
        ...s,
        discoveryConversations: s.discoveryConversations.map((c) =>
          c.id === threadId
            ? {
                ...c,
                messages: [
                  ...c.messages,
                  {
                    id: uid(),
                    role: 'assistant',
                    at: now(),
                    text: topic
                      ? `这个话题可以先区分来源中的事实片段与作者的判断。\n\n建议角度：${angle || topic.angles[0]}\n\n你可以在中间改写角度、逐篇选择原文，再用这个角度开始一篇独立创作。没有读到正文的来源，只作为链接保留。`
                      : '可以先从你关心的领域与订阅来源入手，再比较不同原文。选择一个热点进入详情，就能查看来源、修改角度，并创建独立内容。',
                  },
                ],
              }
            : c,
        ),
      }))
      return
    }
    const id = project.id,
      conversationId = project.activeConversation,
      platform = project.activePlatform
    const capturedContext = context
    const sourceDraft = structuredClone(project.drafts[platform] ?? makeDraft(project.title))
    const sharedContext = creationSnapshot(state, project)
    const userMessage = {
      id: uid(),
      role: 'user' as const,
      text: capturedContext ? `引用：${capturedContext.label}\n「${capturedContext.text}」\n\n${text}` : text,
      at: now(),
      context: sharedContext,
    }
    patchProject(id, (p) => ({
      ...p,
      conversations: p.conversations.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              title: c.messages.length ? c.title : text.slice(0, 14),
              messages: [...c.messages, userMessage],
            }
          : c,
      ),
    }))
    setComposer('')
    setContext(null)
    if (project.creation && !sourceDraft.body.trim()) {
      setState((s) => {
        const projects = s.projects.map((p) =>
          p.id === id
            ? {
                ...p,
                creation: { ...p.creation!, input: p.creation!.input.trim() ? p.creation!.input : text },
                conversations: p.conversations.map((c) =>
                  c.id === conversationId
                    ? {
                        ...c,
                        messages: [
                          ...c.messages,
                          {
                            id: uid(),
                            role: 'assistant' as const,
                            at: now(),
                            action: 'article' as const,
                            text: '已带入这篇内容的原始记录与参考素材，正在整理底稿。整理完成后可直接在正文继续编辑。（演示）',
                          },
                        ],
                      }
                    : c,
                ),
              }
            : p,
        )
        return beginCreation({ ...s, projects }, id).state
      })
      return
    }
    const wantsPlan = /方案|选题|方向|大纲/.test(text)
    const wantsPlatforms = /平台|小红书|公众号|知乎|适配|串文/.test(text)
    const wantsVideo = /视频|动画|镜头|画面/.test(text)
    task('Agent 正在整理建议', '根据当前内容与所引用片段生成演示建议…', 'agent', (s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (p.id !== id) return p
        const response = {
          id: uid(),
          role: 'assistant' as const,
          text: '',
          at: now(),
          action: undefined as 'plan' | 'article' | 'video' | 'platforms' | undefined,
          suggestion: undefined as import('./types').Suggestion | undefined,
        }
        if (wantsPlan) {
          response.text =
            '可以从一个具体的问题出发。我已在中间整理了一份可编辑的创作方向。先确认观点、读者和大纲，再生成母稿。（演示）'
          response.action = 'plan'
          if (!p.brief.point)
            p = {
              ...p,
              brief: {
                ...p.brief,
                topic: p.title || text.slice(0, 28),
                point: p.brief.point,
              },
            }
        } else if (wantsPlatforms) {
          response.text =
            '各平台的表达方式可以不同，观点保持一致。请先选择需要的平台；已有平台稿会完整保留，你可以分别修改。'
          response.action = 'platforms'
        } else if (wantsVideo) {
          response.text =
            '可以做成素材口播，也可以用文字动画解释观点。两种方式会创建独立作品，进入视频工作区后选择即可。'
          response.action = 'video'
        } else if (!sourceDraft.body.trim()) {
          response.text =
            '先记下最想回应的问题，再补一个例子。你可以在创作方案中修改结构，确认后生成第一版示例稿。'
          response.action = 'plan'
        } else {
          const original =
            capturedContext?.platform === platform && sourceDraft.body.includes(capturedContext.text)
              ? capturedContext.text
              : (sourceDraft.body
                  .split('\n\n')
                  .find((line) => !line.startsWith('#') && !line.startsWith('>') && line.length > 20) ??
                sourceDraft.body)
          response.text =
            '我为当前范围整理了一个更简洁的表达，原文和建议都放在文稿中。你可以逐条采用或保留原文。（演示）'
          response.action = 'article'
          response.suggestion = {
            id: uid(),
            platform,
            original,
            replacement: `把想法先留下，再多问一句为什么。${original.replace(/，/g, '，').slice(0, 80)}让每一次整理，都向自己的判断再走一步。`,
            baseBody: sourceDraft.body,
            status: 'pending',
          }
        }
        return {
          ...p,
          conversations: p.conversations.map((c) =>
            c.id === conversationId ? { ...c, messages: [...c.messages, response] } : c,
          ),
        }
      }),
    }))
  }
  function resolveSuggestion(id: string, action: 'accept' | 'reject' | 'undo') {
    const requested = project.conversations
      .flatMap((c) => c.messages)
      .find((m) => m.suggestion?.id === id)?.suggestion
    const currentDraft = requested ? project.drafts[requested.platform] : undefined
    if (!requested || !currentDraft) return
    if (action === 'accept' && (requested.status !== 'pending' || currentDraft.body !== requested.baseBody)) {
      notify('原文已变化，这条建议已过期。请重新生成建议。')
      return
    }
    if (
      action === 'undo' &&
      (requested.status !== 'accepted' || currentDraft.body !== requested.resultBody)
    ) {
      notify('采用后又有新修改，请通过版本历史对照恢复，避免覆盖新内容。')
      return
    }
    patchProject(project.id, (p) => {
      const suggestion = p.conversations
        .flatMap((c) => c.messages)
        .find((m) => m.suggestion?.id === id)?.suggestion
      if (!suggestion) return p
      const draft = p.drafts[suggestion.platform]
      if (!draft) return p
      if (action === 'accept' && (suggestion.status !== 'pending' || draft.body !== suggestion.baseBody))
        return p
      if (action === 'undo' && (suggestion.status !== 'accepted' || draft.body !== suggestion.resultBody))
        return p
      const body =
        action === 'accept'
          ? draft.body.replace(suggestion.original, suggestion.replacement)
          : action === 'undo'
            ? suggestion.baseBody
            : draft.body
      const status = action === 'accept' ? 'accepted' : action === 'undo' ? 'undone' : 'rejected'
      return {
        ...p,
        drafts: {
          ...p.drafts,
          [suggestion.platform]:
            action === 'reject'
              ? draft
              : versioned(draft, { body }, action === 'accept' ? '采用 Agent 建议' : '撤销 Agent 建议'),
        },
        conversations: p.conversations.map((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.suggestion?.id === id
              ? {
                  ...m,
                  suggestion: {
                    ...m.suggestion,
                    status,
                    resultBody: action === 'accept' ? body : m.suggestion.resultBody,
                  },
                }
              : m,
          ),
        })),
      }
    })
    notify(
      action === 'accept'
        ? '已采用修改，并保留原文版本。'
        : action === 'undo'
          ? '已撤销这次修改，版本记录仍然保留。'
          : '已保留原文。',
    )
  }
  return (
    <StudioContext.Provider
      value={{
        state,
        setState,
        project,
        notice,
        notify,
        saveState,
        retrySave,
        captureOpen,
        setCaptureOpen,
        platformsOpen,
        setPlatformsOpen,
        context,
        setContext,
        composer,
        setComposer,
        clearAgentDrafts,
        navigate,
        selectProject,
        patchProject,
        patchDraft,
        newProject,
        updateCreationInput,
        runCreation,
        stopCreation,
        acceptCreation,
        undoCreation,
        createFromTopic,
        generatePlatforms,
        generateArticle,
        sendMessage,
        resolveSuggestion,
        task,
        controlTask,
        reference,
      }}
    >
      {children}
    </StudioContext.Provider>
  )
}
export function useStudio() {
  const store = useContext(StudioContext)
  if (!store) throw new Error('StudioProvider is required')
  return store
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import {
  makeProject,
  platformContent,
  seedState,
  topics as demoTopics,
} from './mock'
import {
  resolvePersistence,
  taskFromRecord,
  WORKSPACE_KEY,
  type DiscoverySnapshot,
  type Persistence,
  type TtsConfigView,
  type VideoMediaView,
  type WechatConfigView,
} from './persistence'
import {
  applyCreation,
  beginCreation,
  creationProblem,
  creationSnapshot,
  finishCreation,
  recoverCreation,
  stopCreationRun,
  syncCreationTask,
} from './creation'
import { supplementArticlesToProject, topicNewArticles } from './hotspot-followup'
import {
  makeDraft,
  messageSuggestions,
  now,
  platformName,
  uid,
  versioned,
  type Artifact,
  type Conversation,
  type CreationFlow,
  type CreationSnapshot,
  type Draft,
  type Material,
  type Message,
  type Page,
  type Platform,
  type Project,
  type Source,
  type SourceType,
  type StudioState,
  type Suggestion,
  type Task,
  type Topic,
} from './types'
import type { AiEvent } from './persistence'

const KEY = WORKSPACE_KEY
function readState(): StudioState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as StudioState | null
    if (
      typeof saved?.schema === 'number' &&
      saved.schema >= 2 &&
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
        schema: 3,
        topics: saved.topics ?? fallback.topics,
        topicAngleSuggestions: saved.topicAngleSuggestions ?? {},
        topicOverviews: saved.topicOverviews ?? {},
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
        // 主进程任务不随文档迁移；creation 任务由渲染端编排，随文档保留。
        tasks: saved.tasks
          .filter((t) => t.kind === 'creation')
          .map((t) =>
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

// DB 工作区只由本版本写入；重启后恢复 creation 流程并降级其中的活动任务。
function adoptWorkspace(workspace: StudioState): StudioState {
  return {
    ...workspace,
    // 桌面模式文档不保存 topics/sources（权威在主进程 discovery 表），用演示副本兜底后由快照覆盖。
    topics: workspace.topics ?? structuredClone(demoTopics),
    topicAngleSuggestions: workspace.topicAngleSuggestions ?? {},
    topicOverviews: workspace.topicOverviews ?? {},
    sources: workspace.sources ?? [],
    projects: workspace.projects.map((project) => ({
      ...project,
      creation: recoverCreation(project.creation),
    })),
    tasks: workspace.tasks.map((t) =>
      t.kind === 'creation' && ['running', 'queued'].includes(t.state)
        ? { ...t, state: 'stopped', detail: '应用已重新打开。演示任务已停止，可重新运行。' }
        : t,
    ),
  }
}

// 主进程/本地任务列表与文档内 creation 任务按 id 去重合并（新→旧）。
function mergeTaskLists(mainTasks: Task[], current: Task[]): Task[] {
  const seen = new Set(mainTasks.map((t) => t.id))
  const creation = current.filter((t) => t.kind === 'creation' && !seen.has(t.id))
  return [...mainTasks, ...creation].sort((a, b) => (a.at < b.at ? 1 : -1))
}
type AgentDraft = { composer: string; context: ContextReference | null }
type AiRunTarget = {
  discovery: boolean
  projectId: string
  conversationId: string
  messageId: string
  /** F03：发起请求时冻结的各平台文稿正文与版本号；建议到达以此作 baseBody。 */
  bases?: Partial<Record<Platform, { body: string; version: number }>>
}
/** 真实重新适配产出的平台候选（transient，不写入文档）；比较采用前现有平台稿不动。 */
export type PlatformCandidate = {
  projectId: string
  platform: Platform
  title: string
  body: string
  /** 候选产出时的平台稿正文；采用前正文变化则候选过期。 */
  base: string
  /** F08：构造生成请求时实际使用的母稿正文与版本号。 */
  master: string
  version: number
}
export type Store = {
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
  /** F01：单平台重新适配（已配置模型时走真实生成，产出候选）；未配置时由页面回退示例候选。 */
  regeneratePlatform: (platform: Platform) => void
  /** 真实重新适配的平台候选（transient，不写入文档）；null = 无待比较候选。 */
  platformCandidate: PlatformCandidate | null
  adoptPlatformCandidate: () => void
  discardPlatformCandidate: () => void
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
  /** 主进程执行器任务（P5 视频导出/配音等）：提交后由主进程驱动进度与结算。 */
  submitMainTask: (input: {
    kind: Task['kind']
    title: string
    detail: string
    payload?: unknown
    extra?: Partial<Task>
  }) => string
  controlTask: (id: string, action: 'stop' | 'retry') => void
  failTask: (id: string, detail: string) => void
  /** P5 视频桥是否可用（dev:web 本地降级为 false，导出/配音保留演示文案）。 */
  videoAvailable: boolean
  ttsReady: boolean
  ttsConfig: TtsConfigView | null
  refreshTtsConfig: () => void
  saveTtsConfig: (input: { baseUrl: string; apiKey: string; modelId: string; voice: string }) => Promise<{ ok: boolean; message: string }>
  clearTtsConfig: () => Promise<void>
  /** 打开本机导出文件夹（userData/exports）。 */
  openExportsFolder: () => Promise<void>
  /** 读取配音音频字节（渲染端 Blob 播放 + Audio 解码测时长）；本地降级返回 null。 */
  readVideoMedia: (mediaId: string) => Promise<VideoMediaView | null>
  aiReady: boolean
  aiBusy: boolean
  aiAsk: { questionId: string; question: string; options?: string[] } | null
  answerAsk: (answer: string) => void
  cancelAi: () => void
  refreshAiConfig: () => void
  saveAiConfig: (input: { name?: string; baseUrl: string; apiKey: string; modelId: string }) => Promise<{ ok: boolean; message: string }>
  testAiConnection: (baseUrl: string, apiKey: string, modelId: string) => Promise<{ ok: boolean; message: string; latencyMs?: number } | null>
  clearAiConfig: () => Promise<void>
  /** 公众号发布桥是否可用（dev:web 本地降级为 false，复制/下载演示交付保留）。 */
  publishAvailable: boolean
  /** 公众号凭证脱敏视图；null = 未配置或桥不可用。 */
  wechatConfig: WechatConfigView | null
  wechatReady: boolean
  refreshWechatConfig: () => void
  saveWechatConfig: (input: { appId: string; secret: string }) => Promise<{ ok: boolean; message: string }>
  clearWechatConfig: () => Promise<void>
  probeWechat: () => Promise<{ ok: boolean; message: string } | null>
  renderWechatHtml: (body: string) => Promise<string | null>
  saveWechatDraft: (input: {
    batchId?: string
    title: string
    body: string
    digest?: string
    assets?: Record<string, string>
  }) => Promise<{ ok: boolean; message: string }>
  /** 小红书登录态：unknown=未检测（含检测失败，message 说明原因）。 */
  redbookLogin: { state: 'unknown' | 'loggedIn' | 'notLoggedIn'; message?: string }
  /** 探测小红书登录态（会话未打开时在主进程隐藏打开；本地降级无动作）。 */
  checkRedbookLogin(): Promise<void>
  /** 打开小红书平台页（可见，供扫码登录/查看草稿）并更新登录态。 */
  openRedbookSession(): Promise<void>
  /** 注入小红书草稿：任务系统驱动（kind 'publish' / executor 'main'），只填草稿绝不点发布。 */
  injectRedbookDraft: (input: {
    batchId?: string
    title: string
    body: string
    tags?: string
  }) => Promise<{ ok: boolean; message: string }>
  reference: (label: string, text: string) => void
  saveSource: (input: SourceInput) => Promise<boolean>
  deleteSource: (id: string) => Promise<void>
  refreshSource: (source: Source) => void
  refreshAllSources: () => void
  suggestAngles: (topic: Topic) => void
  angleBusy: Record<string, boolean>
  /** §20.4：把选中的新文章补充为项目素材引用（不改母稿正文；改稿仍经建议/候选流）。 */
  supplementTopicArticles: (topicId: string, projectId: string, articleIds: string[]) => void
  /** §20.2/§20.3 AI 话题概览：一次性会话生成，结果与原文来源分开显示。 */
  generateTopicOverview: (topic: Topic) => void
  overviewBusy: Record<string, boolean>
}
export type SourceInput = {
  id?: string
  name: string
  type: SourceType
  category: string
  enabled: boolean
  url: string
  /** 自动刷新间隔（分钟）；0 = 仅手动。编辑时缺省表示沿用原值（桌面模式）。 */
  refreshMinutes?: number
}
const StudioContext = createContext<Store | null>(null)
export function StudioProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StudioState>(seedState)
  const [ready, setReady] = useState(false)
  const [notice, notify] = useState('')
  const [saveState, setSaveState] = useState('已保存')
  const [captureOpen, setCaptureOpen] = useState(false)
  const [platformsOpen, setPlatformsOpen] = useState(false)
  const [agentDrafts, setAgentDrafts] = useState<Record<string, AgentDraft>>({})
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const creationTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const stateRef = useRef(state)
  stateRef.current = state
  const persistence = useMemo(() => resolvePersistence(), [])
  const startedRuns = useRef(new Set<string>())
  const saveNowRef = useRef<(() => Promise<void>) | undefined>(undefined)
  const [aiReady, setAiReady] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiAsk, setAiAsk] = useState<{ questionId: string; question: string; options?: string[] } | null>(null)
  const [angleBusy, setAngleBusy] = useState<Record<string, boolean>>({})
  const [overviewBusy, setOverviewBusy] = useState<Record<string, boolean>>({})
  const [wechatConfig, setWechatConfig] = useState<WechatConfigView | null>(null)
  const [ttsConfig, setTtsConfig] = useState<TtsConfigView | null>(null)
  const [platformCandidate, setPlatformCandidate] = useState<PlatformCandidate | null>(null)
  const [redbookLogin, setRedbookLogin] = useState<{ state: 'unknown' | 'loggedIn' | 'notLoggedIn'; message?: string }>(
    { state: 'unknown' },
  )
  // 会话键 → 流式目标（并发 1，一键一运行足够）。
  const aiRuns = useRef(new Map<string, AiRunTarget>())
  // AI 建议角度的一次性会话：按会话键累积增量文本，run_end 时解析为候选角度。
  const angleRuns = useRef(new Map<string, { topicId: string; buffer: string }>())
  // AI 话题概览的一次性会话：按会话键累积增量文本，run_end 时整段落位 topicOverviews。
  const overviewRuns = useRef(new Map<string, { topicId: string; buffer: string }>())
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
  const failNextSaveRef = useRef(false)
  const saveNow = useCallback(async () => {
    if (failNextSaveRef.current) {
      // 测试注入的一次性失败：验证重试入口与状态反馈，不写权威存储。
      failNextSaveRef.current = false
      setSaveState('保存失败')
      notify('本机保存失败，已保留当前内容；请重试或到「设置 → 数据与导出」备份。')
      return
    }
    const result = await persistence.save(stateRef.current)
    if (result.ok) {
      setSaveState('已保存')
    } else {
      setSaveState('保存失败')
      notify('本机保存失败，已保留当前内容；请重试或到「设置 → 数据与导出」备份。')
    }
  }, [persistence])
  saveNowRef.current = saveNow
  const retrySave = useCallback(() => {
    void saveNow()
  }, [saveNow])
  // 启动：权威存储载入；空库时用 localStorage/旧键引导（readState）并回写建立基线。
  useEffect(() => {
    let cancelled = false
    let offDiscovery: (() => void) | undefined
    void (async () => {
      const { workspace } = await persistence.load()
      if (cancelled) return
      if (workspace) {
        setState(adoptWorkspace(workspace))
      } else {
        const bootstrap = readState()
        setState(bootstrap)
        void persistence.save(bootstrap)
        // 空库引导：种子演示任务登记进任务引擎，保持任务中心首次演示内容。
        for (const seed of bootstrap.tasks) {
          if (seed.kind === 'creation') continue
          startedRuns.current.add(seed.id)
          await persistence.taskSubmit({
            id: seed.id,
            kind: seed.kind,
            title: seed.title,
            detail: seed.detail,
            projectId: seed.projectId,
            extra: { version: seed.version, videoId: seed.videoId, snapshot: seed.snapshot },
          })
          await persistence.taskSettle(seed.id, {
            state: seed.state === 'complete' ? 'complete' : 'failed',
            detail: seed.detail,
          })
        }
      }
      const tasks = await persistence.taskList()
      if (cancelled) return
      setState((s) => ({ ...s, tasks: mergeTaskLists(tasks, s.tasks) }))
      // 热点域：桌面模式从主进程加载聚合快照并订阅变更（来源/话题权威在主进程）。
      const discovery = persistence.discovery
      if (discovery) {
        const applySnapshot = (snapshot: DiscoverySnapshot) => {
          if (cancelled) return
          setState((s) => ({
            ...s,
            sources: snapshot.sources,
            topics: snapshot.topics,
            ...(snapshot.lastSyncAt ? { discoverySyncAt: snapshot.lastSyncAt } : {}),
          }))
        }
        try {
          applySnapshot(await discovery.snapshot())
        } catch {
          // 桥异常时保留本地演示数据，不阻塞启动
        }
        offDiscovery = discovery.onEvent((event) => {
          if (event.type === 'snapshot') applySnapshot(event.snapshot)
        })
      }
      setReady(true)
      const info = await window.desktop?.getAppInfo().catch(() => undefined)
      if (!cancelled && (import.meta.env.DEV || info?.smoke)) {
        // 测试/开发调试钩子：e2e 用它读写工作区，不再依赖 localStorage 断言。
        window.__studio = {
          get: () => stateRef.current,
          replace: (next) => setState(next),
          save: () => saveNowRef.current!(),
          __failNextSave: () => {
            failNextSaveRef.current = true
          },
        }
      }
    })()
    const off = persistence.onTasks((event) => {
      if (event.type === 'snapshot') {
        setState((s) => ({ ...s, tasks: mergeTaskLists(event.tasks.map(taskFromRecord), s.tasks) }))
        return
      }
      const task = taskFromRecord(event.task)
      setState((s) => ({
        ...s,
        tasks: s.tasks.some((t) => t.id === task.id)
          ? s.tasks.map((t) => (t.id === task.id ? task : t))
          : [task, ...s.tasks],
      }))
      // 渲染端兜底只接管未登记的本地任务；主进程执行器任务（AI 生成）由其自行结算。
      if (
        task.state === 'running' &&
        task.executor !== 'main' &&
        !startedRuns.current.has(task.id)
      ) {
        startedRuns.current.add(task.id)
        scheduleCompletion(task.id)
      }
      if (
        task.executor === 'main' &&
        task.kind === 'agent' &&
        (task.state === 'complete' || task.state === 'partial' || task.state === 'failed')
      ) {
        applyGenerationOutcome(task)
      }
    })
    return () => {
      cancelled = true
      off()
      offDiscovery?.()
      delete window.__studio
    }
  }, [persistence])
  useEffect(() => {
    if (!ready) return
    setSaveState('保存中')
    const timer = setTimeout(() => void saveNow(), 180)
    const flush = () => void saveNow()
    window.addEventListener('pagehide', flush)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pagehide', flush)
    }
  }, [state, ready, saveNow])
  // AI 服务：配置就绪探测 + 事件订阅（流式/建议/问询/候选，按会话键路由）。
  useEffect(() => {
    const ai = persistence.ai
    if (!ai) return
    void ai.configGet().then((view) => setAiReady(Boolean(view)))
    return ai.onEvent((event) => handleAiEvent(event))
  }, [persistence])
  // 公众号发布桥：启动时拉取脱敏配置视图（未配置/本地降级均按 null 处理）。
  useEffect(() => {
    const publish = persistence.publish
    if (!publish) return
    let cancelled = false
    void publish
      .configGet()
      .then((view) => {
        if (!cancelled) setWechatConfig(view)
      })
      .catch(() => {
        if (!cancelled) setWechatConfig(null)
      })
    return () => {
      cancelled = true
    }
  }, [persistence])
  // P5 视频桥：启动时拉取语音服务脱敏视图（未配置/本地降级均按 null 处理）。
  useEffect(() => {
    const video = persistence.video
    if (!video) return
    let cancelled = false
    void video
      .ttsConfigGet()
      .then((view) => {
        if (!cancelled) setTtsConfig(view)
      })
      .catch(() => {
        if (!cancelled) setTtsConfig(null)
      })
    return () => {
      cancelled = true
    }
  }, [persistence])
  function mutateAiMessage(
    target: AiRunTarget,
    mutate: (message: Message) => { text?: string; suggestions?: Suggestion[] },
  ): void {
    setState((s) => {
      const mapConversation = (c: Conversation) =>
        c.id === target.conversationId
          ? {
              ...c,
              messages: c.messages.map((m) => {
                if (m.id !== target.messageId) return m
                const next = mutate(m)
                return {
                  ...m,
                  ...(next.text !== undefined ? { text: next.text } : {}),
                  ...(next.suggestions ? { suggestions: next.suggestions } : {}),
                }
              }),
            }
          : c
      if (target.discovery)
        return { ...s, discoveryConversations: s.discoveryConversations.map(mapConversation) }
      return {
        ...s,
        projects: s.projects.map((p) =>
          p.id === target.projectId ? { ...p, conversations: p.conversations.map(mapConversation) } : p,
        ),
      }
    })
  }
  function handleAiEvent(event: AiEvent): void {
    if (event.type === 'run_start') {
      setAiBusy(true)
      return
    }
    if (event.type === 'delta') {
      const target = aiRuns.current.get(event.sessionKey)
      if (target) mutateAiMessage(target, (m) => ({ text: m.text + event.text }))
      const angleRun = angleRuns.current.get(event.sessionKey)
      if (angleRun) angleRun.buffer += event.text
      const overviewRun = overviewRuns.current.get(event.sessionKey)
      if (overviewRun) overviewRun.buffer += event.text
      return
    }
    if (event.type === 'ask') {
      setAiAsk({ questionId: event.questionId, question: event.question, options: event.options })
      return
    }
    if (event.type === 'suggestion') {
      const target = aiRuns.current.get(event.sessionKey)
      if (!target || target.discovery) return
      const platform = event.suggestion.platform as Platform
      // F03：baseBody 取发起请求时冻结的文稿，而不是事件到达时的正文；
      // 发起时该平台稿不存在（未冻结基线）则无法建立过期比对，忽略该建议。
      const base = target.bases?.[platform]
      if (!base) return
      const suggestion: Suggestion = {
        id: uid(),
        platform,
        original: event.suggestion.original,
        replacement: event.suggestion.replacement,
        baseBody: base.body,
        status: 'pending',
      }
      // F06：同一次生成的多条建议逐条保留，追加而不是覆盖。
      mutateAiMessage(target, (m) => ({ suggestions: [...messageSuggestions(m), suggestion] }))
      return
    }
    if (event.type === 'draft') {
      const target = aiRuns.current.get(event.sessionKey)
      if (target && !target.discovery) applyMasterCandidate(target.projectId, event.draft.title, event.draft.body)
      return
    }
    if (event.type !== 'run_end') return
    setAiBusy(false)
    setAiAsk(null)
    const target = aiRuns.current.get(event.sessionKey)
    aiRuns.current.delete(event.sessionKey)
    if (target && !event.ok)
      mutateAiMessage(target, (m) => ({
        text: m.text || `（对话出错了：${event.error ?? '未知错误'}）`,
      }))
    // AI 建议角度的一次性会话：解析为候选（供选择/改写，不自动采用）
    const angleRun = angleRuns.current.get(event.sessionKey)
    if (angleRun) {
      angleRuns.current.delete(event.sessionKey)
      setAngleBusy((busy) => ({ ...busy, [angleRun.topicId]: false }))
      if (!event.ok) {
        notify('角度生成失败；仍可在下方手动输入角度继续创作。')
        return
      }
      const angles = parseAngleSuggestions(angleRun.buffer)
      if (angles.length) {
        setState((s) => ({
          ...s,
          topicAngleSuggestions: { ...s.topicAngleSuggestions, [angleRun.topicId]: angles },
        }))
        notify('AI 角度建议已生成；可任选一个或直接改写。')
      } else {
        notify('未能从模型输出解析出角度建议；可直接手动输入。')
      }
    }
    // AI 话题概览的一次性会话：整段落位并与原文分开显示；失败/空输出如实通知
    const overviewRun = overviewRuns.current.get(event.sessionKey)
    if (overviewRun) {
      overviewRuns.current.delete(event.sessionKey)
      setOverviewBusy((busy) => ({ ...busy, [overviewRun.topicId]: false }))
      if (!event.ok) {
        notify('概览生成失败；原文来源不受影响。')
        return
      }
      const text = overviewRun.buffer.trim()
      if (text) {
        setState((s) => ({
          ...s,
          topicOverviews: { ...s.topicOverviews, [overviewRun.topicId]: { text, at: now() } },
        }))
        notify('AI 概览已生成；与原文来源分开显示。')
      } else {
        notify('模型没有返回概览内容；原文来源不受影响。')
      }
    }
  }

  /** 解析模型输出为至多 3 条角度候选：优先「角度：」行，退化为编号/符号列表行。 */
  function parseAngleSuggestions(buffer: string): string[] {
    const lines = buffer
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const marked = lines
      .map((line) => /^角度[：:]\s*(.+)$/.exec(line)?.[1]?.trim() ?? null)
      .filter((line): line is string => Boolean(line))
    const pool = marked.length
      ? marked
      : lines.map((line) => /^(?:\d+[.、)]\s*|[-*·]\s*)(.+)$/.exec(line)?.[1]?.trim() ?? line)
    return pool.filter((line) => line.length >= 6).slice(0, 3)
  }
  function applyMasterCandidate(
    projectId: string,
    title: string,
    body: string,
    options?: { snapshot?: CreationSnapshot; source?: 'input' | 'plan' },
  ): void {
    setState((s) => {
      const current = s.projects.find((p) => p.id === projectId)
      if (!current) return s
      const master = current.drafts.master ?? makeDraft(current.title)
      const creation: CreationFlow = {
        ...(current.creation ?? { input: '', status: 'idle' as const }),
        source: options?.source ?? 'plan',
        status: 'candidate',
        candidate: { title, body, baseTitle: master.title, baseBody: master.body },
        // F01：优先用发起任务时冻结的快照，采用时才能检出整理期间的方向/素材修改。
        snapshot: options?.snapshot ?? creationSnapshot(s, current),
        message: 'AI 已生成母稿候选；比较后采用，现有正文保留。',
      }
      return syncCreationTask(
        {
          ...s,
          projects: s.projects.map((p) =>
            p.id === projectId ? { ...p, creation, updated: now() } : p,
          ),
        },
        projectId,
      )
    })
    notify('母稿候选已生成，可在文稿页比较后采用。')
  }
  function applyGenerationOutcome(task: Task): void {
    const payload = task.payload as
      | {
          job?: string
          platforms?: string[]
          masterBody?: string
          sourceVersion?: number
          regenerate?: boolean
          snapshot?: CreationSnapshot
          creationSource?: string
        }
      | undefined
    if (payload?.job === 'platforms' && (task.state === 'complete' || task.state === 'partial')) {
      const result = task.result as
        | { drafts?: Record<string, { title: string; body: string }> }
        | undefined
      if (!result?.drafts || !Object.keys(result.drafts).length) return
      // F08：来源标注取发起任务时冻结的母稿快照与版本号，而不是落位时的当前母稿。
      const masterBody = payload.masterBody
      const sourceVersion = payload.sourceVersion
      if (payload.regenerate) {
        // F01 单平台重新适配：产出只落候选，比较采用，不直接覆盖现有平台稿。
        const current = stateRef.current.projects.find((p) => p.id === task.projectId)
        let landed = false
        for (const [platform, content] of Object.entries(result.drafts)) {
          const key = platform as Platform
          const draft = current?.drafts[key]
          if (!current || !draft || !masterBody) continue
          setPlatformCandidate({
            projectId: task.projectId,
            platform: key,
            title: content.title,
            body: content.body,
            base: draft.body,
            master: masterBody,
            version:
              typeof sourceVersion === 'number'
                ? sourceVersion
                : (current.drafts.master?.versions.at(-1)?.number ?? 1),
          })
          landed = true
          break
        }
        notify(
          landed
            ? '平台候选已生成，比较后可采用；现有平台稿保持原样。'
            : '平台候选已生成，但对应平台稿已不存在，请重新发起适配。',
        )
        return
      }
      setState((s) => ({
        ...s,
        projects: s.projects.map((p) => {
          if (p.id !== task.projectId) return p
          const drafts = { ...p.drafts }
          const master = p.drafts.master
          for (const [platform, content] of Object.entries(result.drafts!)) {
            const key = platform as Platform
            if (drafts[key]) continue
            drafts[key] = {
              ...makeDraft(content.title, content.body, 'AI 适配'),
              sourceBody: masterBody ?? master?.body,
              sourceVersion:
                typeof sourceVersion === 'number'
                  ? sourceVersion
                  : (master?.versions.at(-1)?.number ?? 1),
            }
          }
          return { ...p, drafts, updated: now() }
        }),
      }))
      // §12 部分完成：成功草稿照常落位（已完成产物可用），失败项可回任务中心重试
      notify(
        task.state === 'partial'
          ? '部分平台版本已生成；失败的平台可在任务中心重试。'
          : '平台版本已生成；已有平台稿不会被覆盖。',
      )
      return
    }
    if (payload?.job === 'master' && task.state === 'complete') {
      const draft = task.result as { title: string; body: string } | undefined
      if (draft)
        applyMasterCandidate(task.projectId, draft.title, draft.body, {
          snapshot: payload.snapshot,
          ...(payload.creationSource === 'input' || payload.creationSource === 'plan'
            ? { source: payload.creationSource }
            : {}),
        })
    }
  }
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
  function scheduleCompletion(id: string, complete?: (s: StudioState) => StudioState) {
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      // 结算被拒（已停止/已失败）时不再套用状态变换，避免覆盖用户操作。
      void persistence.taskSettle(id, { state: 'complete', detail: '演示任务已完成；未调用外部服务。' }).then(
        (applied) => {
          if (applied && complete) setState(complete)
        },
      )
    }, 1000)
    timers.current.add(timer)
  }
  function task(
    title: string,
    detail: string,
    kind: Task['kind'],
    complete?: (state: StudioState) => StudioState,
    extra: Partial<Task> = {},
  ) {
    const id = uid()
    startedRuns.current.add(id)
    setState((s) => ({
      ...s,
      tasks: [
        {
          id,
          title,
          detail,
          projectId: project.id,
          state: 'running',
          kind,
          at: now(),
          ...extra,
        },
        ...s.tasks,
      ],
    }))
    void persistence
      .taskSubmit({
        id,
        kind,
        title,
        detail,
        projectId: project.id,
        extra: { version: extra.version, videoId: extra.videoId, snapshot: extra.snapshot },
      })
      .then((task) => {
        if (!task) return
        setState((s) => ({
          ...s,
          tasks: s.tasks.some((t) => t.id === task.id)
            ? s.tasks.map((t) => (t.id === task.id && t.state === 'running' ? task : t))
            : [task, ...s.tasks],
        }))
      })
    scheduleCompletion(id, complete)
    return id
  }
  /** 主进程执行器任务：本地列表先落 running 占位，提交后由主进程真实驱动（进度/结算）。 */
  function submitMainTask(input: {
    kind: Task['kind']
    title: string
    detail: string
    payload?: unknown
    extra?: Partial<Task>
  }) {
    const id = uid()
    startedRuns.current.add(id)
    setState((s) => ({
      ...s,
      tasks: [
        {
          id,
          title: input.title,
          detail: input.detail,
          projectId: project.id,
          state: 'running',
          kind: input.kind,
          at: now(),
          executor: 'main',
          ...(input.extra ?? {}),
        },
        ...s.tasks,
      ],
    }))
    void persistence
      .taskSubmit({
        id,
        kind: input.kind,
        executor: 'main',
        title: input.title,
        detail: input.detail,
        projectId: project.id,
        payload: input.payload,
        extra: { version: input.extra?.version, videoId: input.extra?.videoId, snapshot: input.extra?.snapshot },
      })
      .then((task) => {
        if (!task) return
        setState((s) => ({
          ...s,
          tasks: s.tasks.some((t) => t.id === task.id)
            ? s.tasks.map((t) => (t.id === task.id && t.state === 'running' ? { ...task, executor: 'main' } : t))
            : [task, ...s.tasks],
        }))
      })
    return id
  }
  function failTask(id: string, detail: string) {
    void persistence.taskSettle(id, { state: 'failed', detail })
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
      void persistence.taskControl(id, 'stop')
      notify('任务已停止，已完成内容仍然保留。')
    } else {
      void persistence.taskControl(id, 'retry')
      notify(
        target.kind === 'source'
          ? '已重新发起来源刷新，可在任务列表查看进度；失败会保留旧缓存。'
          : target.kind === 'agent'
            ? '已重新发起生成任务，原失败记录保留。'
            : target.kind === 'publish'
              ? (target.payload as { platform?: unknown } | undefined)?.platform === 'redbook'
                ? '已重新发起小红书草稿注入任务，原失败记录保留。'
                : '已重新发起存草稿任务，原失败记录保留。'
              : target.kind === 'export'
                ? '已重新发起视频导出任务，原失败记录保留。'
                : target.kind === 'voice'
                  ? '已重新发起配音生成，原失败记录保留。'
                  : '已创建一次演示重试，原失败记录保留。',
      )
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
    if (aiReady && persistence.ai) {
      // F01 真实生成：主进程 master 任务（executor:'main'），产出只落候选（applyMasterCandidate）。
      // 快照在发起时冻结，采用时才能检出整理期间的方向/素材修改；未配置模型走演示路径。
      const current = stateRef.current.projects.find((p) => p.id === id && !p.trashed)
      if (!current) return
      const snapshot = creationSnapshot(stateRef.current, current)
      const problem = creationProblem(snapshot)
      if (problem) {
        notify(problem)
        return
      }
      const input = snapshot.input.trim()
      const plan = snapshot.plan
      const briefText = [
        `主题：${snapshot.title}`,
        snapshot.point.trim() && `核心观点：${snapshot.point}`,
        snapshot.tone.trim() && `表达：${snapshot.tone}`,
        plan?.audience && `写给：${plan.audience}`,
        plan?.length && `篇幅建议：${plan.length}`,
        plan?.outline.length &&
          `大纲：\n${plan.outline.map((line, index) => `${index + 1}. ${line}`).join('\n')}`,
        input && `原始记录：\n${input.slice(0, 6000)}`,
      ]
        .filter(Boolean)
        .join('\n')
      const materialsText = snapshot.materials
        .map((m) => `【${m.title}】\n${m.body ? m.body.slice(0, 800) : '（未读取原文，仅保留链接）'}`)
        .join('\n\n')
      submitMainTask({
        kind: 'agent',
        title: '按当前方向生成母稿候选',
        detail: '正在把原始记录与素材整理成母稿候选；现有正文保留。',
        payload: {
          job: 'master',
          briefText,
          materialsText: materialsText || undefined,
          snapshot,
          creationSource: current.creation?.source ?? 'input',
        },
      })
      notify('正在把原始记录与素材整理成母稿候选；现有正文保留，生成后可比较采用。')
      return
    }
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
      // 真实来源聚合的话题没有预置角度（AI 建议/手动输入补位）
      angle: topic.angles[0] ?? '',
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
    if (aiReady && persistence.ai && project.brief.confirmed) {
      setState((s) => ({
        ...s,
        page: 'article',
        projects: s.projects.map((p) =>
          p.id === id ? { ...p, activeTab: 'article', activePlatform: 'master' } : p,
        ),
      }))
      const taskId = uid()
      startedRuns.current.add(taskId)
      const briefText = [
        project.brief.topic && `主题：${project.brief.topic}`,
        project.brief.point && `核心观点：${project.brief.point}`,
        project.brief.audience && `写给：${project.brief.audience}`,
        project.brief.tone && `表达：${project.brief.tone}`,
        project.brief.length && `篇幅建议：${project.brief.length}`,
        project.brief.outline.length &&
          `大纲：\n${project.brief.outline.map((line, index) => `${index + 1}. ${line}`).join('\n')}`,
      ]
        .filter(Boolean)
        .join('\n')
      const materialsText = project.materialIds
        .flatMap((mid) => state.materials.filter((m) => m.id === mid && !m.trashed))
        .map((m) => `【${m.title}】\n${m.body.slice(0, 800)}`)
        .join('\n\n')
      const detail = '正在按方案生成候选，现有母稿保留。'
      setState((s) => ({
        ...s,
        tasks: [
          { id: taskId, title: '按方案生成母稿候选', detail, projectId: id, state: 'running', kind: 'agent', executor: 'main', at: now() },
          ...s.tasks,
        ],
      }))
      void persistence
        .taskSubmit({
          id: taskId,
          kind: 'agent',
          executor: 'main',
          title: '按方案生成母稿候选',
          detail,
          projectId: id,
          payload: { job: 'master', briefText, materialsText: materialsText || undefined },
        })
        .then((submitted) => {
          if (!submitted) return
          setState((s) => ({
            ...s,
            tasks: s.tasks.map((t) =>
              t.id === taskId && t.state === 'running' ? { ...submitted, executor: 'main' } : t,
            ),
          }))
        })
      notify('正在按方案生成母稿候选；现有正文保留，生成后可比较采用。')
      return
    }
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
    if (aiReady && persistence.ai) {
      const todo = platforms.filter((p) => !project.drafts[p])
      if (!todo.length) {
        notify('所选平台都已有版本；已有内容不会被覆盖。')
        setPlatformsOpen(false)
        return
      }
      const taskId = uid()
      startedRuns.current.add(taskId)
      const detail = `正在为 ${todo.length} 个平台生成版本…`
      setState((s) => ({
        ...s,
        tasks: [
          { id: taskId, title: '准备平台版本', detail, projectId: id, state: 'running', kind: 'agent', executor: 'main', at: now() },
          ...s.tasks,
        ],
      }))
      void persistence
        .taskSubmit({
          id: taskId,
          kind: 'agent',
          executor: 'main',
          title: '准备平台版本',
          detail,
          projectId: id,
          payload: {
            job: 'platforms',
            platforms: todo,
            masterTitle: master.title,
            masterBody: master.body,
            sourceVersion: master.versions.at(-1)?.number ?? 1,
            skip: platforms.filter((p) => project.drafts[p]),
            tone: state.preferences.tone,
          },
        })
        .then((submitted) => {
          if (!submitted) return
          setState((s) => ({
            ...s,
            tasks: s.tasks.map((t) =>
              t.id === taskId && t.state === 'running' ? { ...submitted, executor: 'main' } : t,
            ),
          }))
        })
      setPlatformsOpen(false)
      notify(`正在为 ${todo.length} 个平台生成版本；已有平台稿会保留。`)
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
  /** F01：单平台重新适配（已配置模型走真实生成）。产出只落候选，比较采用，不直接覆盖现有平台稿。 */
  function regeneratePlatform(platform: Platform) {
    if (!persistence.ai || !aiReady) {
      notify('尚未配置模型，请先到「设置 → AI 服务」配置；当前可继续使用示例候选。')
      return
    }
    const master = structuredClone(project.drafts.master ?? makeDraft(project.title))
    if (!master.body.trim()) {
      notify('请先写一些母稿内容，再重新适配平台版本。')
      return
    }
    submitMainTask({
      kind: 'agent',
      title: `重新适配${platformName(platform)}版本`,
      detail: '正在基于当前母稿生成平台候选；现有平台稿保留。',
      payload: {
        job: 'platforms',
        platforms: [platform],
        skip: [],
        masterTitle: master.title,
        masterBody: master.body,
        sourceVersion: master.versions.at(-1)?.number ?? 1,
        regenerate: true,
        tone: state.preferences.tone,
      },
    })
    notify(`正在基于当前母稿重新生成${platformName(platform)}候选；现有平台稿保留。`)
  }
  /** 采用真实重新适配候选：正文与发起时一致才落位；来源标注用发起时的母稿快照（F08）。 */
  function adoptPlatformCandidate() {
    const candidate = platformCandidate
    if (!candidate || candidate.projectId !== project.id) return
    const draft = project.drafts[candidate.platform]
    if (!draft || draft.body !== candidate.base) {
      notify('当前平台稿已变化，这条候选已过期。请重新生成候选。')
      setPlatformCandidate(null)
      return
    }
    patchProject(project.id, (p) => {
      const current = p.drafts[candidate.platform]
      if (!current || current.body !== candidate.base) return p
      return {
        ...p,
        drafts: {
          ...p.drafts,
          [candidate.platform]: versioned(
            current,
            {
              title: candidate.title,
              body: candidate.body,
              sourceBody: candidate.master,
              sourceVersion: candidate.version,
            },
            '采用重新适配候选',
          ),
        },
      }
    })
    setPlatformCandidate(null)
    notify('已采用候选，手改内容保存在历史版本中。')
  }
  function discardPlatformCandidate() {
    setPlatformCandidate(null)
  }
  function reference(label: string, text: string) {
    setContext({ label, text, platform: project.activePlatform })
    setComposer((current) => (current.trim() ? current : '请结合这段内容，帮我继续梳理。'))
    window.dispatchEvent(new Event('studio:open-agent'))
  }
  // —— 热点域动作：桌面模式走主进程（真实抓取/聚合），本地降级保持演示语义 ——
  async function saveSource(input: SourceInput): Promise<boolean> {
    const discovery = persistence.discovery
    if (!discovery) {
      setState((s) => ({
        ...s,
        sources: s.sources.some((source) => source.id === input.id)
          ? s.sources.map((source) => (source.id === input.id ? { ...source, ...input } : source))
          : [
              ...s.sources,
              { id: input.id ?? uid(), ...input, status: 'unconfigured', updated: '' },
            ],
      }))
      notify('来源已保存（本地演示模式，不会发起网络请求）。')
      return true
    }
    try {
      const saved = await discovery.sourceSave(input)
      setState((s) => ({
        ...s,
        sources: s.sources.some((source) => source.id === saved.id)
          ? s.sources.map((source) => (source.id === saved.id ? saved : source))
          : [...s.sources, saved],
      }))
      notify('来源已保存。')
      return true
    } catch (err) {
      notify(err instanceof Error ? err.message : '来源保存失败，请重试。')
      return false
    }
  }
  async function deleteSource(id: string): Promise<void> {
    const discovery = persistence.discovery
    if (!discovery) {
      setState((s) => ({ ...s, sources: s.sources.filter((source) => source.id !== id) }))
      notify('来源已移除（本地演示模式）。')
      return
    }
    try {
      const result = await discovery.sourceDelete(id)
      if (!result.ok) {
        notify(result.message ?? '来源移除失败。')
        return
      }
      setState((s) => ({ ...s, sources: s.sources.filter((source) => source.id !== id) }))
      notify('来源已移除；它贡献的原文缓存已清理，已创建内容的选题快照不受影响。')
    } catch (err) {
      notify(err instanceof Error ? err.message : '来源移除失败。')
    }
  }
  function refreshSource(source: Source): void {
    const discovery = persistence.discovery
    if (!discovery) {
      task(`刷新 ${source.name}`, '本地演示：未发起网络请求…', 'source')
      notify('本地演示模式：话题均为示例，刷新不会请求实时榜单。')
      return
    }
    void discovery.sourceRefresh(source.id).then((result) => {
      if (!result.ok) notify(result.message ?? '刷新任务创建失败。')
      else notify(`正在刷新「${source.name}」；失败时会保留旧缓存。`)
    })
  }
  function refreshAllSources(): void {
    const discovery = persistence.discovery
    if (!discovery) {
      task('刷新热点来源', '本地演示：未发起网络请求…', 'source')
      notify('本地演示模式：话题均为示例，未请求实时榜单。')
      return
    }
    void discovery.refreshAll().then((result) => {
      if (!result.ok) notify(result.message ?? '刷新任务创建失败。')
      else notify('正在刷新已启用的来源；单个来源失败不影响其余来源。')
    })
  }
  /** AI 建议角度：经 AgentService 一次性会话生成 3 个候选，供选择或改写（不自动采用）。 */
  function suggestAngles(topic: Topic): void {
    const ai = persistence.ai
    if (!ai) {
      notify('浏览器预览不支持 AI 建议角度，请在桌面应用中配置模型后使用。')
      return
    }
    if (!aiReady) {
      notify('尚未配置模型，请先到「设置 → AI 服务」配置。')
      return
    }
    if (angleBusy[topic.id]) return
    const sessionKey = `gen:angles-${topic.id.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 48)}`
    angleRuns.current.set(sessionKey, { topicId: topic.id, buffer: '' })
    setAngleBusy((busy) => ({ ...busy, [topic.id]: true }))
    const currentAngle = state.topicDrafts[topic.id]?.angle.trim()
    const sourcesBlock = topic.articles
      .slice(0, 6)
      .map((article) => `· ${article.title}${article.body ? `——${article.body.slice(0, 160)}` : '（仅链接）'}`)
      .join('\n')
    const prompt = [
      '你是选题角度顾问。基于下面的热点话题与来源原文，提出 3 个互不重叠的创作切入点。',
      '要求：每个角度一句话、具体可执行；尊重原文事实，不虚构数据；可以建立在来源观点差异之上，但不得把推断当作原文事实。',
      '输出恰好 3 行，每行以「角度：」开头，不要输出其他内容。',
      '',
      `话题：${topic.title}`,
      topic.summary ? `概要：${topic.summary}` : '',
      currentAngle ? `作者当前倾向：${currentAngle}` : '',
      `来源原文（截选）：\n${sourcesBlock}`,
    ]
      .filter(Boolean)
      .join('\n')
    void ai.send(sessionKey, prompt).then((result) => {
      if (result.ok) return
      angleRuns.current.delete(sessionKey)
      setAngleBusy((busy) => ({ ...busy, [topic.id]: false }))
      const message =
        result.code === 'NO_MODEL_CONFIG'
          ? '尚未配置模型，请到「设置 → AI 服务」配置。'
          : result.code === 'AGENT_BUSY'
            ? '已有 AI 任务在运行，请等待完成或先取消。'
            : (result.message ?? '角度生成失败；可直接手动输入。')
      notify(message)
    })
  }
  /** §20.4 补充动作：选中文章保存为素材并引用到对应项目；不改母稿正文，改稿仍经建议/候选流。 */
  function supplementTopicArticles(topicId: string, projectId: string, articleIds: string[]): void {
    const topic = stateRef.current.topics.find((t) => t.id === topicId)
    const project = stateRef.current.projects.find((p) => p.id === projectId && !p.trashed)
    if (!topic || !project?.source || project.source.topicId !== topicId || !articleIds.length) {
      notify('请先选择要补充的新文章。')
      return
    }
    const fresh = topicNewArticles(topic, project).filter((article) => articleIds.includes(article.id))
    if (!fresh.length) {
      notify('所选文章已补充过，或不在该热点的新文章列表中。')
      return
    }
    setState((s) => supplementArticlesToProject(s, topicId, projectId, fresh.map((a) => a.id)))
    notify(`已补充 ${fresh.length} 篇新进展素材，可在 Agent 中生成修改建议。`)
  }
  /** AI 话题概览（§20.2/§20.3）：一次性会话生成；只依据来源正文，未读正文不生成确定口吻摘要。 */
  function generateTopicOverview(topic: Topic): void {
    const ai = persistence.ai
    if (!ai) {
      notify('浏览器预览不支持 AI 概览，请在桌面应用中配置模型后使用。')
      return
    }
    if (!aiReady) {
      notify('尚未配置模型，请先到「设置 → AI 服务」配置。')
      return
    }
    if (overviewBusy[topic.id]) return
    const sessionKey = `gen:overview-${topic.id.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 44)}`
    overviewRuns.current.set(sessionKey, { topicId: topic.id, buffer: '' })
    setOverviewBusy((busy) => ({ ...busy, [topic.id]: true }))
    const sourcesBlock = topic.articles
      .slice(0, 6)
      .map(
        (article) =>
          `· ${article.title}${article.body ? `——${article.body.slice(0, 200)}` : '（仅链接，未读正文）'}`,
      )
      .join('\n')
    const prompt = [
      '你是热点研究助理。基于下面的热点话题与来源正文，写一段话题概览与背景归纳。',
      '要求：只依据所给来源正文；未读正文的来源不得生成确定口吻摘要，只能说明「仅链接，未读正文」；来源观点不一致时分别简述，不抹平差异；不虚构数据、引语或事实。',
      '输出一段 150 至 300 字的连贯归纳，不要使用列表，不要输出其他内容。',
      '',
      `话题：${topic.title}`,
      topic.summary ? `概要：${topic.summary}` : '',
      `来源正文（截选）：\n${sourcesBlock}`,
    ]
      .filter(Boolean)
      .join('\n')
    void ai.send(sessionKey, prompt).then((result) => {
      if (result.ok) return
      overviewRuns.current.delete(sessionKey)
      setOverviewBusy((busy) => ({ ...busy, [topic.id]: false }))
      const message =
        result.code === 'NO_MODEL_CONFIG'
          ? '尚未配置模型，请到「设置 → AI 服务」配置。'
          : result.code === 'AGENT_BUSY'
            ? '已有 AI 任务在运行，请等待完成或先取消。'
            : (result.message ?? '概览生成失败；原文来源不受影响。')
      notify(message)
    })
  }
  function answerAsk(answer: string) {
    if (!aiAsk) return
    void persistence.ai?.answer(aiAsk.questionId, answer)
    setAiAsk(null)
  }
  function cancelAi() {
    for (const key of [...aiRuns.current.keys()]) void persistence.ai?.cancel(key)
  }
  function refreshAiConfig() {
    void persistence.ai?.configGet().then((view) => setAiReady(Boolean(view)))
  }
  async function saveAiConfig(input: { name?: string; baseUrl: string; apiKey: string; modelId: string }) {
    const ai = persistence.ai
    if (!ai) return { ok: false, message: '浏览器预览不支持 AI 服务配置，请在桌面应用中配置。' }
    try {
      await ai.configSet(input)
      setAiReady(true)
      return { ok: true, message: '模型配置已保存。' }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '保存失败。' }
    }
  }
  async function testAiConnection(baseUrl: string, apiKey: string, modelId: string) {
    return persistence.ai?.test(baseUrl, apiKey, modelId) ?? null
  }
  async function clearAiConfig() {
    await persistence.ai?.configClear()
    setAiReady(false)
  }
  // —— 公众号发布链动作：桌面模式走主进程（凭证/探测/存草稿任务），本地降级保留演示交付 ——
  function refreshWechatConfig() {
    const publish = persistence.publish
    if (!publish) return
    void publish
      .configGet()
      .then((view) => setWechatConfig(view))
      .catch(() => setWechatConfig(null))
  }
  async function saveWechatConfig(input: { appId: string; secret: string }) {
    const publish = persistence.publish
    if (!publish) return { ok: false, message: '浏览器预览不支持公众号配置，请在桌面应用中配置。' }
    try {
      const view = await publish.configSave(input)
      setWechatConfig(view)
      return { ok: true, message: '公众号配置已保存。' }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '保存失败，请重试。' }
    }
  }
  async function clearWechatConfig() {
    await persistence.publish?.configClear()
    setWechatConfig(null)
    notify('已清除公众号配置；本机不再保留凭证。')
  }
  function probeWechat(): Promise<{ ok: boolean; message: string } | null> {
    const publish = persistence.publish
    if (!publish) return Promise.resolve(null)
    return publish
      .canInject()
      .catch(() => ({ ok: false, message: '检测失败，请稍后重试。' }) as { ok: boolean; message: string })
  }
  /** md → 公众号正文 HTML（主进程纯转换）；本地降级返回 null，由调用方回退 DOM 富文本。 */
  async function renderWechatHtml(body: string) {
    const publish = persistence.publish
    if (!publish) return null
    try {
      const result = await publish.renderHtml(body)
      return result.ok && result.html ? result.html : null
    } catch {
      return null
    }
  }
  /** 存入草稿箱：任务系统驱动（kind 'publish' / executor 'main'），进度与失败如实回传。 */
  async function saveWechatDraft(input: {
    batchId?: string
    title: string
    body: string
    digest?: string
    assets?: Record<string, string>
  }): Promise<{ ok: boolean; message: string }> {
    const publish = persistence.publish
    if (!publish) return { ok: false, message: '浏览器预览不支持草稿箱，请使用桌面应用或继续复制交付。' }
    const result = await publish
      .saveDraft({ projectId: project.id, ...input })
      .catch(() => ({ ok: false as const, message: '存草稿任务创建失败，请重试。' }))
    const outcome = {
      ok: result.ok,
      message: result.message ?? (result.ok ? '已创建存草稿任务。' : '存草稿任务创建失败。'),
    }
    notify(outcome.message)
    return outcome
  }
  // —— 小红书平台会话动作：登录态探测/打开平台页/注入草稿（只填草稿，绝不点发布） ——
  async function checkRedbookLogin() {
    const publish = persistence.publish
    if (!publish) return
    try {
      const view = await publish.redbookLoginState()
      setRedbookLogin(
        view.ok && view.loginState ? { state: view.loginState } : { state: 'unknown', message: view.message },
      )
    } catch {
      setRedbookLogin({ state: 'unknown', message: '登录检测失败，请稍后重试。' })
    }
  }
  async function openRedbookSession() {
    const publish = persistence.publish
    if (!publish) return
    try {
      const view = await publish.redbookOpenSession()
      if (view.ok && view.loginState) setRedbookLogin({ state: view.loginState })
      notify(
        view.ok
          ? view.loginState === 'loggedIn'
            ? '已打开小红书平台页。'
            : '已打开小红书平台页；请扫码完成登录后重试注入。'
          : `打开小红书平台页失败：${view.message ?? '请稍后重试。'}`,
      )
    } catch {
      notify('打开小红书平台页失败，请稍后重试。')
    }
  }
  async function injectRedbookDraft(input: {
    batchId?: string
    title: string
    body: string
    tags?: string
  }): Promise<{ ok: boolean; message: string }> {
    const publish = persistence.publish
    if (!publish) return { ok: false, message: '浏览器预览不支持小红书注入，请使用桌面应用或继续复制交付。' }
    const result = await publish
      .redbookInjectDraft({ projectId: project.id, ...input })
      .catch(() => ({ ok: false as const, message: '注入任务创建失败，请重试。' }))
    const outcome = {
      ok: result.ok,
      message: result.message ?? (result.ok ? '已创建注入任务。' : '注入任务创建失败。'),
    }
    notify(outcome.message)
    return outcome
  }
  // —— P5 视频域动作：语音服务配置、导出文件夹、配音媒体读取 ——
  function refreshTtsConfig() {
    const video = persistence.video
    if (!video) return
    void video
      .ttsConfigGet()
      .then((view) => setTtsConfig(view))
      .catch(() => setTtsConfig(null))
  }
  async function saveTtsConfig(input: { baseUrl: string; apiKey: string; modelId: string; voice: string }) {
    const video = persistence.video
    if (!video) return { ok: false, message: '浏览器预览不支持语音服务配置，请在桌面应用中配置。' }
    try {
      const view = await video.ttsConfigSet(input)
      setTtsConfig(view)
      return { ok: true, message: '语音服务配置已保存。' }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '保存失败，请重试。' }
    }
  }
  async function clearTtsConfig() {
    await persistence.video?.ttsConfigClear()
    setTtsConfig(null)
    notify('已清除语音服务配置；视频配音回到本地演示。')
  }
  async function openExportsFolder() {
    const video = persistence.video
    if (!video) {
      notify('浏览器预览不支持打开导出文件夹，请使用桌面应用导出。')
      return
    }
    const result = await video.openExportsFolder().catch(() => ({ ok: false as const, message: '打开失败。' }))
    if (!result.ok) notify(result.message ?? '打开导出文件夹失败，请稍后重试。')
  }
  async function readVideoMedia(mediaId: string) {
    const video = persistence.video
    if (!video) return null
    try {
      return await video.readMedia(mediaId)
    } catch {
      return null
    }
  }
  /** pi 对话：先落用户消息与空回复占位，再发送；事件按会话键回流（并发 1，一键一运行）。 */
  function sendAiMessage(text: string): void {
    const ai = persistence.ai
    if (!ai) return
    const discovery = ['hotspots', 'sources'].includes(state.page)
    const conversationId = discovery ? state.activeDiscovery : project.activeConversation
    const messageId = uid()
    let bases: AiRunTarget['bases'] | undefined
    let materialsTruncated = false
    const blocks: string[] = []
    if (discovery) {
      const topic = stateRef.current.topics.find((t) => t.id === state.selectedTopic)
      const angle = topic ? state.topicDrafts[topic.id]?.angle : undefined
      if (topic) blocks.push(`当前热点：${topic.title}${angle ? `\n角度：${angle}` : ''}`)
    } else {
      const draft = project.drafts[project.activePlatform] ?? project.drafts.master
      if (draft?.body.trim())
        blocks.push(
          `当前文稿（${platformName(project.activePlatform)}）片段：\n${draft.body.slice(0, 1500)}`,
        )
      if (project.creation?.input?.trim())
        blocks.push(`原始记录：\n${project.creation.input.slice(0, 1200)}`)
      if (context) blocks.push(`引用（${context.label}）：\n${context.text.slice(0, 800)}`)
      if (project.brief.point.trim()) blocks.push(`核心观点：${project.brief.point}`)
      // F05：请求真实带入本篇素材（与界面「已带入 N 份本篇素材」口径一致），有截断在尾部说明。
      const materials = project.materialIds.flatMap((mid) =>
        stateRef.current.materials.filter((m) => m.id === mid && !m.trashed),
      )
      if (materials.length) {
        materialsTruncated = materials.some((m) => m.body.length > 800)
        blocks.push(
          `本篇素材（${materials.length} 份）：\n${materials
            .map((m) => `【${m.title}】\n${m.body ? m.body.slice(0, 800) : '（未读取原文，仅保留链接）'}`)
            .join('\n\n')}`,
        )
      }
      // F03：冻结各平台文稿正文与版本号；建议到达时以冻结值作 baseBody，生成期间的手改不会进入基线。
      bases = Object.fromEntries(
        Object.entries(project.drafts)
          .filter((entry): entry is [Platform, Draft] => !!entry[1])
          .map(([platform, d]) => [platform, { body: d.body, version: d.versions.at(-1)?.number ?? 1 }]),
      )
    }
    let prompt = [...blocks, text].join('\n\n')
    if (materialsTruncated)
      prompt += '\n\n（以上素材正文为截选：每份仅保留前 800 字；全文保存在本机素材库中。）'
    // F07：项目会话键包含对话身份，新建对话不再复用同一项目的模型历史。
    const sessionKey = discovery ? `d:${conversationId}` : `p:${project.id}:${conversationId}`
    const userMessage = {
      id: uid(),
      role: 'user' as const,
      text: context ? `引用：${context.label}\n「${context.text}」\n\n${text}` : text,
      at: now(),
    }
    const placeholder = { id: messageId, role: 'assistant' as const, text: '', at: now() }
    if (discovery) {
      setState((s) => ({
        ...s,
        discoveryConversations: s.discoveryConversations.map((c) =>
          c.id === conversationId ? { ...c, messages: [...c.messages, userMessage, placeholder] } : c,
        ),
      }))
    } else {
      patchProject(project.id, (p) => ({
        ...p,
        conversations: p.conversations.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                title: c.messages.length ? c.title : text.slice(0, 14),
                messages: [...c.messages, userMessage, placeholder],
              }
            : c,
        ),
      }))
    }
    setComposer('')
    setContext(null)
    setAiBusy(true)
    const target: AiRunTarget = {
      discovery,
      projectId: discovery ? '' : project.id,
      conversationId,
      messageId,
      ...(bases ? { bases } : {}),
    }
    aiRuns.current.set(sessionKey, target)
    void ai.send(sessionKey, prompt).then((result) => {
      if (result.ok) return
      aiRuns.current.delete(sessionKey)
      setAiBusy(false)
      const message =
        result.code === 'NO_MODEL_CONFIG'
          ? '尚未配置模型，请到「设置 → AI 服务」配置。'
          : result.code === 'AGENT_BUSY'
            ? '已有对话在运行，请等待完成或先取消。'
            : (result.message ?? '发送失败。')
      mutateAiMessage(target, () => ({ text: `（${message}）` }))
      notify(message)
    })
  }
  function sendMessage() {
    const text = composer.trim()
    if (!text) return
    if (aiReady && persistence.ai) {
      sendAiMessage(text)
      return
    }
    if (['hotspots', 'sources'].includes(state.page)) {
      const threadId = state.activeDiscovery
      const topic = state.topics.find((t) => t.id === state.selectedTopic)
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
                      ? `这个话题可以先区分来源中的事实片段与作者的判断。\n\n建议角度：${angle || topic.angles[0] || '先用自己的话写下一句切入'}\n\n你可以在中间改写角度、逐篇选择原文，再用这个角度开始一篇独立创作。没有读到正文的来源，只作为链接保留。`
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
          suggestions: [] as Suggestion[],
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
          response.suggestions = [
            {
              id: uid(),
              platform,
              original,
              replacement: `把想法先留下，再多问一句为什么。${original.replace(/，/g, '，').slice(0, 80)}让每一次整理，都向自己的判断再走一步。`,
              baseBody: sourceDraft.body,
              status: 'pending',
            },
          ]
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
  /** F06：采用/撤销一条建议后，同平台原文仍完整存在的待定建议基线跟随新正文（不相交建议继续可用）。 */
  function rebasePendingSuggestions(
    project: Project,
    platform: Platform,
    body: string,
    changedId: string,
  ): Project {
    return {
      ...project,
      conversations: project.conversations.map((c) => ({
        ...c,
        messages: c.messages.map((m) => {
          const list = messageSuggestions(m)
          if (!list.some((s) => s.id !== changedId && s.platform === platform && s.status === 'pending'))
            return m
          return {
            ...m,
            suggestions: list.map((s) =>
              s.id !== changedId && s.platform === platform && s.status === 'pending' && body.includes(s.original)
                ? { ...s, baseBody: body }
                : s,
            ),
          }
        }),
      })),
    }
  }
  function resolveSuggestion(id: string, action: 'accept' | 'reject' | 'undo') {
    const requested = project.conversations
      .flatMap((c) => c.messages)
      .flatMap((m) => messageSuggestions(m))
      .find((s) => s.id === id)
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
      const found = p.conversations
        .flatMap((c) => c.messages.map((m) => ({ m, list: messageSuggestions(m) })))
        .find((entry) => entry.list.some((s) => s.id === id))
      const suggestion = found?.list.find((s) => s.id === id)
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
      const next: Project = {
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
          messages: c.messages.map((m) => {
            const list = messageSuggestions(m)
            if (!list.some((s) => s.id === id)) return m
            return {
              ...m,
              // 旧文档的单值字段同步更新，避免残留与列表不一致的历史建议状态。
              ...(m.suggestion?.id === id && m.suggestion
                ? {
                    suggestion: {
                      ...m.suggestion,
                      status,
                      ...(action === 'accept' ? { resultBody: body } : {}),
                    },
                  }
                : {}),
              suggestions: list.map((s) =>
                s.id === id
                  ? { ...s, status, ...(action === 'accept' ? { resultBody: body } : {}) }
                  : s,
              ),
            }
          }),
        })),
      }
      if (action === 'reject') return next
      return rebasePendingSuggestions(next, suggestion.platform, body, id)
    })
    notify(
      action === 'accept'
        ? '已采用修改，并保留原文版本。'
        : action === 'undo'
          ? '已撤销这次修改，版本记录仍然保留。'
          : '已保留原文。',
    )
  }
  if (!ready) return null
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
        regeneratePlatform,
        platformCandidate,
        adoptPlatformCandidate,
        discardPlatformCandidate,
        generateArticle,
        sendMessage,
        resolveSuggestion,
        task,
        submitMainTask,
        controlTask,
        failTask,
        videoAvailable: persistence.video !== null,
        ttsReady: Boolean(ttsConfig?.baseUrl && ttsConfig?.modelId && ttsConfig?.voice && ttsConfig.hasKey),
        ttsConfig,
        refreshTtsConfig,
        saveTtsConfig,
        clearTtsConfig,
        openExportsFolder,
        readVideoMedia,
        aiReady,
        aiBusy,
        aiAsk,
        answerAsk,
        cancelAi,
        refreshAiConfig,
        saveAiConfig,
        testAiConnection,
        clearAiConfig,
        publishAvailable: persistence.publish !== null,
        wechatConfig,
        wechatReady: Boolean(wechatConfig?.appId && wechatConfig.hasSecret),
        refreshWechatConfig,
        saveWechatConfig,
        clearWechatConfig,
        probeWechat,
        renderWechatHtml,
        saveWechatDraft,
        redbookLogin,
        checkRedbookLogin,
        openRedbookSession,
        injectRedbookDraft,
        reference,
        saveSource,
        deleteSource,
        refreshSource,
        refreshAllSources,
        suggestAngles,
        angleBusy,
        supplementTopicArticles,
        generateTopicOverview,
        overviewBusy,
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

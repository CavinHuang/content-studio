import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { ModelConfig } from '../../shared/desktop'
import { piAgentDir, sessionDirFor, writePiModelsJson } from './model-config'
import { buildDomainTools, domainToolNames, type AskUserFn, type CollectFn } from './domain-tools'
import { loadPi, loadTypebox } from './pi-loader'
import type { SessionLike } from './agent-service'

export interface RealSessionFactoryDeps {
  userDataDir(): string
  getConfig(): ModelConfig | null
  collect: CollectFn
}

function coded(message: string, code: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string }
  err.code = code
  return err
}

/** 为单测注入 stub：真实实现经 pi.createAgentSession 建会话。 */
export interface PiSessionLike {
  subscribe(listener: (ev: unknown) => void): () => void
  prompt(text: string): Promise<void>
  abort(): Promise<void>
  waitForIdle(): Promise<void>
  dispose(): void
}
export type CreatePiSession = (options: {
  cwd: string
  agentDir: string
  sessionDir: string
  modelsPath: string
  config: ModelConfig
  askUser: AskUserFn
  collect: CollectFn
}) => Promise<PiSessionLike>
export function buildCreatePiSession(): CreatePiSession {
  return async (options) => {
    const pi = await loadPi()
    const T = await loadTypebox()
    // 探针实证：ModelRuntime.create 不读 <agentDir>/models.json，必须显式传路径。
    const modelRuntime = await pi.ModelRuntime.create({
      modelsPath: options.modelsPath,
      authPath: path.join(options.agentDir, 'auth.json'),
    })
    const model = modelRuntime.getModel(options.config.providerId, options.config.modelId)
    if (!model) throw coded(`模型不可用：${options.config.providerId}/${options.config.modelId}`, 'MODEL_NOT_FOUND')
    const loader = new pi.DefaultResourceLoader({
      cwd: options.cwd,
      agentDir: options.agentDir,
      skillsOverride: () => ({ skills: [], diagnostics: [] }), // 技能暂不分发；提示词由系统提示承担
    })
    await loader.reload()
    const customTools = await buildDomainTools(pi, T, { askUser: options.askUser, collect: options.collect })
    const { session } = await pi.createAgentSession({
      cwd: options.cwd,
      agentDir: options.agentDir,
      model,
      modelRuntime,
      resourceLoader: loader,
      noTools: 'all', // 关闭全部内置工具（read/bash/edit/write）——agent 只有领域工具
      customTools,
      tools: [...domainToolNames()],
      sessionManager: pi.SessionManager.continueRecent(options.cwd, options.sessionDir),
    })
    return session
  }
}

/**
 * 真实 pi 会话工厂：sessionKey（'p:<项目>'/'d:<发现>'/'gen:<任务>'）绑定独立会话目录，
 * continueRecent 续聊；cwd 为统一 ai-workspace（状态模型无文件库，上下文由渲染端注入 prompt）。
 */
export function createRealSessionFactory(
  deps: RealSessionFactoryDeps,
  createPiSession: CreatePiSession = buildCreatePiSession(),
) {
  return async (sessionKey: string, askUser: AskUserFn, collectOverride?: CollectFn): Promise<SessionLike> => {
    const config = deps.getConfig()
    if (!config) throw coded('尚未配置模型，请先在「设置 → AI 服务」中配置。', 'NO_MODEL_CONFIG')
    const userDataDir = deps.userDataDir()
    const cwd = path.join(userDataDir, 'ai-workspace')
    await mkdir(cwd, { recursive: true })
    const sessionDir = sessionDirFor(userDataDir, sessionKey)
    await mkdir(sessionDir, { recursive: true })
    const agentDir = piAgentDir(userDataDir)
    await mkdir(agentDir, { recursive: true })
    const modelsPath = await writePiModelsJson(userDataDir, config)
    const session = await createPiSession({
      cwd,
      agentDir,
      sessionDir,
      modelsPath,
      config,
      askUser,
      collect: collectOverride ?? deps.collect,
    })
    return {
      subscribe: (listener) => session.subscribe(listener as never),
      prompt: (text) => session.prompt(text),
      abort: () => session.abort(),
      waitForIdle: () => session.waitForIdle(),
      dispose: () => session.dispose(),
    }  }
}

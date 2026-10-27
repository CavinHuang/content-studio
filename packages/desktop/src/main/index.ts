import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AI_CHANNELS, DESKTOP_CHANNELS, DISCOVERY_CHANNELS, type AppInfo, type AiEvent, type DiscoveryEvent } from '../shared/desktop'
import { initServices } from './services'
import { AgentService } from './ai/agent-service'
import { buildAiHandlers } from './ai/handlers'
import { safeStorageCrypto } from './ai/crypto'
import { createRealSessionFactory } from './ai/real-session'
import { registerAiHandlers } from './ai/ipc'
import { getModelConfig } from './ai/model-config'
import { createPlatformRewriteExecutor, createMasterDraftExecutor } from './ai/generation-jobs'
import type { CollectFn } from './ai/domain-tools'
import { DiscoveryStore } from './discovery/store'
import { DiscoveryService } from './discovery/service'
import { buildDiscoveryHandlers } from './discovery/handlers'
import { registerDiscoveryHandlers } from './discovery/ipc'
import { SourceScheduler } from './discovery/scheduler'
import { getWechatConfig } from './publish/wechat-config'
import { createWechatDraftExecutor } from './publish/draft-job'
import { buildPublishHandlers } from './publish/handlers'
import { registerPublishHandlers } from './publish/ipc'
import { buildRedbookHandlers } from './publish/redbook/handlers'
import { createRedbookInjectExecutor } from './publish/redbook/inject-job'
import { resolveRedbookEditorConfig } from './publish/redbook/policy'
import { createRedbookService } from './publish/redbook/service'
import { RedbookSession } from './publish/redbook/session'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: 'Content Studio',
    width: 1480,
    height: 960,
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: '#fffcf7',
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../resources/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const window = mainWindow
  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  const rendererPath = join(__dirname, '../renderer/index.html')
  const rendererUrl = pathToFileURL(rendererPath).href
  const isAppUrl = (url: string): boolean => {
    try {
      return developmentUrl
        ? new URL(url).origin === new URL(developmentUrl).origin
        : url.split(/[?#]/)[0] === rendererUrl
    } catch {
      return false
    }
  }

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })

  window.once('ready-to-show', () => {
    if (process.env.STUDIO_SMOKE !== '1') window.show()
  })
  window.on('closed', () => { mainWindow = null })

  if (developmentUrl && !app.isPackaged) void window.loadURL(developmentUrl)
  else void window.loadFile(rendererPath)
}

app.setName('Content Studio')
if (process.env.STUDIO_USER_DATA) app.setPath('userData', process.env.STUDIO_USER_DATA)

void app.whenReady().then(() => {
  nativeTheme.themeSource = 'light'
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'close' }] },
  ]))

  ipcMain.handle(DESKTOP_CHANNELS.appInfo, (event): AppInfo => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Unknown window')
    return {
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron,
      smoke: process.env.STUDIO_SMOKE === '1',
    }
  })
  ipcMain.handle(DESKTOP_CHANNELS.openDesigns, async (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Unknown window')
    const folder = app.isPackaged ? join(process.resourcesPath, 'ux') : join(app.getAppPath(), 'docs/ux')
    const file = join(folder, 'index.html')
    if (!existsSync(file)) return { ok: false, message: '没有找到设计总览文件。' }
    const error = await shell.openPath(file)
    return error ? { ok: false, message: error } : { ok: true }
  })

  const services = initServices(join(app.getPath('userData'), 'studio.db'), (event) => {
    mainWindow?.webContents.send(DESKTOP_CHANNELS.taskEvent, event)
  })
  const guard = (event: IpcMainInvokeEvent): void => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Unknown window')
  }
  // AI 服务装配：safeStorage 加密配置 + pi 会话工厂 + 并发 1 编排（产出回调晚绑定）。
  const aiCrypto = safeStorageCrypto()
  const emitAi = (event: AiEvent): void => {
    mainWindow?.webContents.send(AI_CHANNELS.event, event)
  }
  let collect: CollectFn = () => {}
  const createSession = createRealSessionFactory({
    userDataDir: () => app.getPath('userData'),
    getConfig: () => getModelConfig(services.db, aiCrypto),
    collect: (item) => collect(item),
  })
  const agent = new AgentService({
    createSession,
    emit: emitAi,
    hasModelConfig: () => getModelConfig(services.db, aiCrypto) !== null,
  })
  collect = agent.collect
  // 生成任务执行器：payload.job 分派平台改写 / 方案→母稿候选（executor='main' 时生效）。
  const jobDeps = { createSession, getConfig: () => getModelConfig(services.db, aiCrypto) }
  services.runner.registerExecutor('agent', (task, ctx) => {
    const job = (task.payload as { job?: string } | undefined)?.job
    if (job === 'platforms') return createPlatformRewriteExecutor(jobDeps)(task, ctx)
    if (job === 'master') return createMasterDraftExecutor(jobDeps)(task, ctx)
    return Promise.resolve({ state: 'failed', detail: '未知的生成任务类型。' })
  })
  registerAiHandlers(buildAiHandlers({ db: services.db, crypto: aiCrypto, agent }), guard)
  // 热点域装配：内置示例来源 seed（演示保留）+ 真实抓取执行器（kind 'source'）+ IPC。
  const discoveryStore = new DiscoveryStore(services.db)
  const discovery = new DiscoveryService({
    store: discoveryStore,
    emit: (event: DiscoveryEvent) => {
      mainWindow?.webContents.send(DISCOVERY_CHANNELS.event, event)
    },
  })
  discovery.ensureSeeded()
  services.runner.registerExecutor('source', discovery.createTaskExecutor())
  registerDiscoveryHandlers(
    buildDiscoveryHandlers({ store: discoveryStore, service: discovery, runner: services.runner }),
    guard,
  )
  // 可配置定时刷新：默认全部来源为手动（refreshMinutes 0），演示路径不受影响。
  const scheduler = new SourceScheduler({ store: discoveryStore, runner: services.runner })
  scheduler.start()
  app.on('will-quit', () => scheduler.stop())
  // 公众号发布链装配：safeStorage 凭证 + 存草稿执行器（kind 'publish' / executor 'main'）+ IPC。
  // STUDIO_WECHAT_API_BASE：e2e/本地 stub 钩子，覆盖官方 baseUrl（生产不设即走官方地址）。
  const publishBaseUrl = process.env.STUDIO_WECHAT_API_BASE || undefined
  const wechatExecutor = createWechatDraftExecutor({
    getConfig: () => getWechatConfig(services.db, aiCrypto),
    ...(publishBaseUrl ? { baseUrl: publishBaseUrl } : {}),
  })
  // 小红书平台会话装配：persist:redbook partition 登录态由平台写入（应用不落明文）；
  // 注入只填草稿绝不点发布（inject-job 铁律）。STUDIO_REDBOOK_EDITOR_URL：e2e/本地联调显式覆盖编辑器地址。
  const redbookConfig = resolveRedbookEditorConfig(process.env.STUDIO_REDBOOK_EDITOR_URL)
  const redbookSession = new RedbookSession({
    ...redbookConfig,
    getWindow: () => mainWindow,
    appName: app.name,
  })
  const redbookExecutor = createRedbookInjectExecutor(redbookSession)
  // kind 'publish' 按 payload.platform 分派：redbook=平台注入，缺省=公众号草稿。
  services.runner.registerExecutor('publish', (task, ctx) =>
    (task.payload as { platform?: string } | undefined)?.platform === 'redbook'
      ? redbookExecutor(task, ctx)
      : wechatExecutor(task, ctx),
  )
  registerPublishHandlers(
    buildPublishHandlers({
      db: services.db,
      crypto: aiCrypto,
      runner: services.runner,
      ...(publishBaseUrl ? { baseUrl: publishBaseUrl } : {}),
    }),
    buildRedbookHandlers({ runner: services.runner, service: createRedbookService(redbookSession) }),
    guard,
  )
  app.on('will-quit', () => redbookSession.close())
  // 上一次会话中断的任务不允许保留假 running 状态。
  services.runner.recover()
  ipcMain.handle(DESKTOP_CHANNELS.dbLoad, (event) => {
    guard(event)
    return services.api.dbLoad()
  })
  ipcMain.handle(DESKTOP_CHANNELS.dbSave, (event, doc: unknown) => {
    guard(event)
    return services.api.dbSave(doc)
  })
  ipcMain.handle(DESKTOP_CHANNELS.taskList, (event) => {
    guard(event)
    return services.api.taskList()
  })
  ipcMain.handle(DESKTOP_CHANNELS.taskSubmit, (event, input: Parameters<typeof services.api.taskSubmit>[0]) => {
    guard(event)
    return services.api.taskSubmit(input)
  })
  ipcMain.handle(DESKTOP_CHANNELS.taskSettle, (event, id: string, settle: Parameters<typeof services.api.taskSettle>[1]) => {
    guard(event)
    return services.api.taskSettle(id, settle)
  })
  ipcMain.handle(DESKTOP_CHANNELS.taskControl, (event, id: string, action: 'stop' | 'retry') => {
    guard(event)
    return services.api.taskControl(id, action)
  })

  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

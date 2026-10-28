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
import { createWechatPublishAdapter } from './publish/draft-job'
import { PublishService } from './publish/publish-service'
import { buildPublishHandlers } from './publish/handlers'
import { registerPublishHandlers } from './publish/ipc'
import { buildRedbookHandlers } from './publish/redbook/handlers'
import { createRedbookPublishAdapter } from './publish/redbook/inject-job'
import { resolveRedbookEditorConfig } from './publish/redbook/policy'
import { createRedbookService } from './publish/redbook/service'
import { RedbookSession } from './publish/redbook/session'
import { createExportExecutor } from './render/export-job'
import { buildVideoHandlers } from './render/handlers'
import { registerVideoHandlers } from './render/ipc'
import { createVoiceExecutor } from './render/tts-job'
import { getTtsConfig } from './render/tts-config'

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
  // 公众号发布链装配：safeStorage 凭证 + 存草稿适配器（API 平台，不开页面会话）+ IPC。
  // STUDIO_WECHAT_API_BASE：e2e/本地 stub 钩子，覆盖官方 baseUrl（生产不设即走官方地址）。
  const publishBaseUrl = process.env.STUDIO_WECHAT_API_BASE || undefined
  // 小红书平台会话装配：persist:redbook partition 登录态由平台写入（应用不落明文）；
  // 注入只填草稿绝不点发布（inject-job 铁律）。STUDIO_REDBOOK_EDITOR_URL：e2e/本地联调显式覆盖编辑器地址。
  const redbookConfig = resolveRedbookEditorConfig(process.env.STUDIO_REDBOOK_EDITOR_URL)
  const redbookSession = new RedbookSession({
    ...redbookConfig,
    getWindow: () => mainWindow,
    appName: app.name,
  })
  // 发布编排（spec P4）：平台间串行限速（默认 15s，env STUDIO_PUBLISH_MIN_INTERVAL_MS 可调）＋
  // 失败三分类（瞬态自动重试/凭证停下要求配置/永久如实上报）；usesSession 分流——
  // 页面会话平台（小红书）执行前开平台页，API 平台（公众号）绝不开页面。
  const publishService = new PublishService({
    openSession: async (platform) => {
      if (platform !== 'redbook')
        throw new Error(`平台「${platform}」没有页面会话（API 平台不开页面）。`)
      // 注入需要用户可见的平台页（右半屏）：扫码登录、检查草稿都在这里完成。
      await redbookSession.open(true)
      return redbookSession
    },
  })
  publishService.register(
    createWechatPublishAdapter({
      getConfig: () => getWechatConfig(services.db, aiCrypto),
      ...(publishBaseUrl ? { baseUrl: publishBaseUrl } : {}),
    }),
  )
  publishService.register(createRedbookPublishAdapter())
  services.runner.registerExecutor('publish', publishService.createExecutor())
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
  // P5 视频链装配：Remotion 真实导出（kind 'export'）+ 语音配音（kind 'voice'）走任务系统。
  // STUDIO_RENDER_ENTRY：e2e/联调显式覆盖组合入口路径（缺省为应用目录内 remotion/index.tsx；
  // 入口缺失时执行器如实失败——精简安装包不含渲染组件的诚实降级）。
  // STUDIO_TTS_API_BASE：e2e/本地 stub 钩子，覆盖语音服务官方地址（生产不设即走配置地址）。
  const renderEntry = process.env.STUDIO_RENDER_ENTRY || join(app.getAppPath(), 'remotion', 'index.tsx')
  const exportsDir = () => join(app.getPath('userData'), 'exports')
  const mediaDir = () => join(app.getPath('userData'), 'media')
  // 打包形态：Remotion 的浏览器按 cwd 自动下载不可控（spike §7.1），改用随包预置的
  // Chrome Headless Shell（extraResources → resources/chrome-headless-shell），离线可用；
  // 缺失（如精简安装）则回落 Remotion 默认行为，由执行器如实失败。
  // 渲染根目录同理：组合入口在 asar 内，bundler 的 process.chdir 进不去（实测 ENOENT），
  // 指到用户数据目录（真实可写，webpack 缓存也落在那里）。
  // 原生二进制：electron-builder 已把 esbuild 与 Remotion 合成器解包到 app.asar.unpacked，
  // 但子进程无法从 asar 虚拟路径 spawn（实测 ENOENT）——esbuild 走官方 ESBUILD_BINARY_PATH
  // 覆盖，合成器（remotion.exe/ffmpeg.exe/ffprobe.exe）走 renderMedia/selectComposition
  // 的 binariesDirectory 指到解包目录。
  const unpacked = (relative: string) => join(process.resourcesPath, 'app.asar.unpacked', relative)
  const packagedBrowser = app.isPackaged
    ? join(process.resourcesPath, 'chrome-headless-shell', 'chrome-headless-shell.exe')
    : null
  const renderBrowser = packagedBrowser && existsSync(packagedBrowser) ? packagedBrowser : null
  const esbuildBinary = app.isPackaged
    ? unpacked(join('node_modules', '@esbuild', 'win32-x64', 'esbuild.exe'))
    : null
  if (esbuildBinary && existsSync(esbuildBinary)) process.env.ESBUILD_BINARY_PATH = esbuildBinary
  const compositorDir = app.isPackaged
    ? unpacked(join('node_modules', '@remotion', 'compositor-win32-x64-msvc'))
    : null
  const renderBinaries = compositorDir && existsSync(join(compositorDir, 'remotion.exe')) ? compositorDir : null
  services.runner.registerExecutor(
    'export',
    createExportExecutor({
      entryPoint: () => renderEntry,
      exportsDir,
      ...(renderBrowser ? { browserExecutable: () => renderBrowser } : {}),
      ...(app.isPackaged ? { bundleRootDir: () => app.getPath('userData') } : {}),
      ...(renderBinaries ? { binariesDirectory: () => renderBinaries } : {}),
    }),
  )
  services.runner.registerExecutor(
    'voice',
    createVoiceExecutor({
      getConfig: () => getTtsConfig(services.db, aiCrypto),
      mediaDir,
      ...(process.env.STUDIO_TTS_API_BASE ? { baseUrl: process.env.STUDIO_TTS_API_BASE } : {}),
    }),
  )
  registerVideoHandlers(
    buildVideoHandlers({
      db: services.db,
      crypto: aiCrypto,
      exportsDir,
      mediaDir,
      openPath: (path) => shell.openPath(path),
    }),
    guard,
  )
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

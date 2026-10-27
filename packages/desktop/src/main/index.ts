import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DESKTOP_CHANNELS, type AppInfo } from '../shared/desktop'
import { initServices } from './services'

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
  // 上一次会话中断的任务不允许保留假 running 状态。
  services.runner.recover()
  const guard = (event: IpcMainInvokeEvent): void => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Unknown window')
  }
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

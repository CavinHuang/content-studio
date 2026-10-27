/**
 * 小红书平台会话（WebContentsView + persist partition）。
 * 移植自 ref/cc0f351-platform-session.ts（本仓库自有历史资产）：
 * - 登录态 cookie 由平台写入 persist:redbook partition，应用不落明文、不入库；
 * - 安全三开关 contextIsolation/nodeIntegration:false/sandbox:true；
 * - 只加载白名单域名；UA 剥离 Electron 与应用名 token；
 * - evaluate 包 90s 超时，防页面脚本卡死编排层。
 */
import { BrowserWindow, WebContentsView, session } from 'electron'
import type { RedbookDriver } from './driver'
import { redbookInjectScript, type RedbookPayload, type RedbookResult } from './inject-script'
import { checkEditorUrl, normalizeUserAgent } from './policy'

const EVALUATE_TIMEOUT_MS = 90_000

function codedError(message: string, code: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string }
  err.code = code
  return err
}

export interface RedbookSessionOptions {
  editorUrl: string
  allowedHosts: readonly string[]
  getWindow: () => BrowserWindow | null
  appName: string
}

export class RedbookSession implements RedbookDriver {
  private view: WebContentsView | null = null
  private url = ''
  private shown = false

  constructor(private readonly options: RedbookSessionOptions) {}

  get isOpen(): boolean {
    return this.view !== null
  }

  async open(visible: boolean): Promise<void> {
    const check = checkEditorUrl(this.options.editorUrl, this.options.allowedHosts)
    if (!check.ok) throw codedError(check.message, check.code)
    if (!this.view) {
      // persist partition：登录态由平台自己写入，应用不落明文、不入库。
      const ses = session.fromPartition('persist:redbook')
      ses.setUserAgent(normalizeUserAgent(ses.getUserAgent(), this.options.appName))
      this.view = new WebContentsView({
        webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
      })
    }
    if (this.url !== check.url) {
      await this.view.webContents.loadURL(check.url)
      this.url = check.url
    }
    // 已可见的会话不因后台探测被隐藏（用户正看着登录页扫码时不能突然收起）。
    if (visible || !this.shown) this.attach(visible)
  }

  /** 挂到主窗口：visible=右半屏；false=零尺寸隐藏（登录探测/后台注入仍可执行）。 */
  private attach(visible: boolean): void {
    const win = this.options.getWindow()
    if (!win || win.isDestroyed() || !this.view) return
    try {
      win.contentView.addChildView(this.view)
    } catch {
      /* 已挂载 */
    }
    const [width = 0, height = 0] = win.getContentSize()
    this.view.setBounds(
      visible
        ? { x: Math.floor(width * 0.55), y: 0, width: Math.ceil(width * 0.45), height }
        : { x: 0, y: 0, width: 0, height: 0 },
    )
    this.shown = visible
  }

  async evaluate(payload: RedbookPayload): Promise<RedbookResult> {
    if (!this.view) throw codedError('小红书平台页未打开。', 'SESSION_NOT_OPEN')
    const exec = this.view.webContents.executeJavaScript(
      `(${redbookInjectScript.toString()})(${JSON.stringify(payload)})`,
      true,
    ) as Promise<RedbookResult>
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(codedError('小红书平台页脚本执行超时。', 'TIMEOUT')), EVALUATE_TIMEOUT_MS)
    })
    return Promise.race([exec, timeout])
  }

  currentUrl(): string {
    return this.view?.webContents.getURL() ?? ''
  }

  close(): void {
    if (!this.view) return
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.contentView.removeChildView(this.view)
      } catch {
        /* 窗口已销毁 */
      }
    }
    try {
      this.view.webContents.close()
    } catch {
      /* 已关闭 */
    }
    this.view = null
    this.url = ''
    this.shown = false
  }
}

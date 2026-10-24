import { BrowserWindow, WebContentsView, session, app } from 'electron';

/** UA 常规化（spec §6：窗口特征与常规浏览器一致）：剥离 Electron 与应用名 token。 */
export function normalizeUserAgent(ua: string): string {
  const appName = app.name?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') ?? '';
  return ua.replace(/\s*Electron\/[\d.]+/i, '').replace(new RegExp(`\\s*${appName}/[\\d.]+`), '').trim();
}

function coded(message: string, code: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code; return err;
}

/** 每平台一个常驻会话：persist partition 保存登录态（cookie 由平台写入，应用不落明文，spec §4.2）。 */
export class PlatformSession {
  private view: WebContentsView | null = null;
  private url = '';

  constructor(private readonly platform: string) {}

  async open(url: string, allowedHosts: string[]): Promise<void> {
    let host: string;
    try { host = new URL(url).hostname; } catch { throw coded(`编辑器地址不合法: ${url}`, 'EDITOR_URL_INVALID'); }
    if (!allowedHosts.includes(host)) throw coded(`编辑器地址 ${url} 不在 ${this.platform} 平台白名单内`, 'EDITOR_URL_BLOCKED');
    if (!this.view) {
      const ses = session.fromPartition(`persist:${this.platform}`);
      ses.setUserAgent(normalizeUserAgent(ses.getUserAgent()));
      this.view = new WebContentsView({
        webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
    }
    if (this.url !== url) {
      await this.view.webContents.loadURL(url);
      this.url = url;
    }
  }

  /** 挂到主窗口：visible=窗口右半屏；false=零尺寸隐藏（登录探测/后台注入）。 */
  attach(visible: boolean): void {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    if (!win || !this.view) return;
    try { win.contentView.addChildView(this.view); } catch { /* 已挂载 */ }
    const [w = 0, h = 0] = win.getContentSize(); // getContentSize(): number[] + noUncheckedIndexedAccess → 解构默认值
    this.view.setBounds(visible ? { x: Math.floor(w * 0.55), y: 0, width: Math.ceil(w * 0.45), height: h } : { x: 0, y: 0, width: 0, height: 0 });
  }

  async evaluate<T>(fnSource: string, payload: unknown): Promise<T> {
    if (!this.view) throw coded('平台页未打开', 'SESSION_NOT_OPEN');
    const exec = this.view.webContents.executeJavaScript(`(${fnSource})(${JSON.stringify(payload)})`, true) as Promise<T>;
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(coded('平台页脚本执行超时', 'TIMEOUT')), 90_000);
    });
    return Promise.race([exec, timeout]);
  }

  currentUrl(): string { return this.view?.webContents.getURL() ?? ''; }

  dispose(): void {
    if (!this.view) return;
    for (const w of BrowserWindow.getAllWindows()) {
      try { w.contentView.removeChildView(this.view); } catch { /* 窗口已销毁 */ }
    }
    try { this.view.webContents.close(); } catch { /* 已关闭 */ }
    this.view = null; this.url = '';
  }
}

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc';

// @electron-forge/plugin-vite 8.x 以编译期 define 注入各渲染器 dev server URL
// （vite.base.config.js getBuildDefine：开发为 '"http://localhost:port"' 字符串字面量，
// 打包替换为 void 0，已实测 vite 对 undefined define 值做替换而非悬空标识符）。
// 旧版 process.env.VITE_DEV_SERVER_URL 机制在本版插件不存在，dev 下恒走 loadFile
// 导致 ERR_FILE_NOT_FOUND 白屏。
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 640,
    title: 'ContentDeck',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  if (!app.isPackaged && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/main_window/index.html'));
  }
};

app.whenReady().then(() => {
  process.env.CONTENTDECK_USER_DATA ??= app.getPath('userData');
  registerIpc();
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

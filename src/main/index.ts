import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc';

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 640,
    title: 'ContentDeck',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
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

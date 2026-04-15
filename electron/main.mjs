import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVER_PORT = 3457;
let mainWindow = null;

// ── API Key Storage (safeStorage) ──────────────────────────────

const keyStore = new Map();

ipcMain.handle('keys:store', (_event, name, value) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption not available on this platform');
  }
  const encrypted = safeStorage.encryptString(value);
  keyStore.set(name, encrypted);
  return true;
});

ipcMain.handle('keys:retrieve', (_event, name) => {
  const encrypted = keyStore.get(name);
  if (!encrypted) return null;
  return safeStorage.decryptString(encrypted);
});

ipcMain.handle('keys:delete', (_event, name) => {
  return keyStore.delete(name);
});

ipcMain.handle('keys:has', (_event, name) => {
  return keyStore.has(name);
});

// ── Native Dialogs ────────────────────────────────────────────

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ── Window Creation ────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 800,
    minHeight: 560,
    title: 'Trellis',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // In dev, load Vite dev server; in prod, load built dashboard
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);
  }

  // Open external URLs in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost') || url.startsWith('file://')) {
      return { action: 'allow' };
    }
    import('electron').then(({ shell }) => shell.openExternal(url));
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App Lifecycle ──────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

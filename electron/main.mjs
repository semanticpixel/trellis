import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVER_PORT = 3457;
const DATA_DIR = join(homedir(), '.trellis');
const KEYS_FILE = join(DATA_DIR, 'keys.json');
const KNOWN_PROVIDER_TYPES = new Set(['anthropic', 'openai', 'custom']);
let mainWindow = null;

// ── API Key Storage (safeStorage + on-disk persistence) ────────

// Encrypted buffers, keyed by provider name. Values are Buffers produced by
// safeStorage.encryptString and are safe to write to disk — they're bound to
// the OS user's keychain/DPAPI and unreadable without it.
const keyStore = loadKeysFromDisk();

function loadKeysFromDisk() {
  const map = new Map();
  if (!existsSync(KEYS_FILE)) return map;
  try {
    const raw = readFileSync(KEYS_FILE, 'utf-8');
    const obj = JSON.parse(raw);
    for (const [name, b64] of Object.entries(obj)) {
      if (typeof b64 === 'string') map.set(name, Buffer.from(b64, 'base64'));
    }
  } catch (err) {
    console.error('[trellis] Failed to load persisted keys:', err.message);
  }
  return map;
}

function persistKeysToDisk() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const obj = {};
    for (const [name, buf] of keyStore.entries()) {
      obj[name] = buf.toString('base64');
    }
    // 0o600 so only the current OS user can read the encrypted blob.
    writeFileSync(KEYS_FILE, JSON.stringify(obj, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error('[trellis] Failed to persist keys:', err.message);
  }
}

ipcMain.handle('keys:store', (_event, name, value) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption not available on this platform');
  }
  const encrypted = safeStorage.encryptString(value);
  keyStore.set(name, encrypted);
  persistKeysToDisk();
  return true;
});

ipcMain.handle('keys:retrieve', (_event, name) => {
  const encrypted = keyStore.get(name);
  if (!encrypted) return null;
  return safeStorage.decryptString(encrypted);
});

ipcMain.handle('keys:delete', (_event, name) => {
  const existed = keyStore.delete(name);
  if (existed) persistKeysToDisk();
  return existed;
});

ipcMain.handle('keys:has', (_event, name) => {
  return keyStore.has(name);
});

// ── Adapter Bootstrap ──────────────────────────────────────────

async function waitForBackend(maxWaitMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(`http://localhost:${SERVER_PORT}/api/adapters`);
      if (res.ok) return true;
    } catch {
      // not ready
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function registerPersistedAdapters() {
  if (keyStore.size === 0) return;
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[trellis] Cannot restore keys: encryption not available');
    return;
  }
  const ready = await waitForBackend();
  if (!ready) {
    console.warn('[trellis] Backend did not become ready; skipping key restore');
    return;
  }
  for (const [name, encrypted] of keyStore.entries()) {
    if (!KNOWN_PROVIDER_TYPES.has(name)) continue;
    try {
      const apiKey = safeStorage.decryptString(encrypted);
      const res = await fetch(`http://localhost:${SERVER_PORT}/api/adapters/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: name, apiKey }),
      });
      if (res.ok) {
        console.log(`[trellis] Restored ${name} adapter from safeStorage`);
      } else {
        console.warn(`[trellis] Failed to restore ${name} adapter: ${res.status}`);
      }
    } catch (err) {
      console.error(`[trellis] Error restoring ${name} adapter:`, err.message);
    }
  }
}

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
      preload: join(__dirname, 'preload.cjs'),
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

app.whenReady().then(() => {
  createWindow();
  // Re-register any adapters whose keys were persisted from a previous run.
  // Fire-and-forget: the window loads independently while this runs.
  registerPersistedAdapters().catch((err) => {
    console.error('[trellis] Adapter restore failed:', err);
  });
});

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

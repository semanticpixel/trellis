import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, safeStorage, shell } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { createServer } from 'http';
import { randomBytes, timingSafeEqual } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Must be set before app.whenReady() so the macOS app menu picks it up.
app.name = 'Trellis';

const SERVER_PORT = 3457;
const DATA_DIR = join(homedir(), '.trellis');
const KEYS_FILE = join(DATA_DIR, 'keys.json');
const BRIDGE_FILE = join(DATA_DIR, 'oauth-bridge.json');
const KNOWN_PROVIDER_TYPES = new Set(['anthropic', 'openai', 'custom']);
const OAUTH_CALLBACK_PORT = Number(process.env.TRELLIS_OAUTH_CALLBACK_PORT ?? 33418);
const OAUTH_FLOW_TIMEOUT_MS = 5 * 60 * 1000;
// safeStorage keys are flat strings; OAuth material is namespaced under
// `mcp:<server>:<kind>` so it shares the keys.json blob without colliding
// with LLM provider keys.
const MCP_OAUTH_KINDS = ['tokens', 'client-info', 'code-verifier', 'discovery'];
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

// ── OAuth Bridge (backend → main) ──────────────────────────────

// The tsx-subprocess backend can't touch safeStorage or shell.openExternal,
// so main exposes a tiny 127.0.0.1 HTTP listener and writes its port + a
// rotating shared secret into ~/.trellis/oauth-bridge.json (chmod 0600).
// The backend reads that file and calls the listener with the secret in
// a header. Everything stays on loopback, and stolen secrets don't
// survive a restart.

function mcpKey(serverName, kind) {
  return `mcp:${serverName}:${kind}`;
}

function storeEncrypted(name, plaintext) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption not available on this platform');
  }
  keyStore.set(name, safeStorage.encryptString(plaintext));
  persistKeysToDisk();
}

function readEncrypted(name) {
  const buf = keyStore.get(name);
  if (!buf) return null;
  return safeStorage.decryptString(buf);
}

function deleteEncrypted(name) {
  const existed = keyStore.delete(name);
  if (existed) persistKeysToDisk();
  return existed;
}

// Shared status map so the bridge endpoint (on a different port) can flip
// a flow's browser page from "Completing authorization…" to success/failed
// without coupling to the callback server. Keyed by the PKCE `state` value
// the backend issued.
const oauthFlowStatus = new Map();

function setOAuthFlowStatus(state, status, message) {
  if (typeof state !== 'string' || state.length === 0) return;
  oauthFlowStatus.set(state, { status, message: message ?? null, ts: Date.now() });
}

// Browser-facing listener. The callback arrives with code+state; we
// validate, respond with a "Completing authorization…" page that polls
// `/callback-status`, and resolve the promise with the captured code so
// the backend can run the token exchange. The server stays alive long
// enough for the polling page to see the final status, then shuts down.
// Browser-facing so it must NOT require the bridge secret — the PKCE
// state check is the CSRF defense here.
function awaitOAuthCallback(expectedState) {
  return new Promise((resolve, reject) => {
    let codeSettled = false;
    let shuttingDown = false;
    let shutdownTimer = null;

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${OAUTH_CALLBACK_PORT}`);

      if (url.pathname === '/callback-status') {
        const state = url.searchParams.get('state');
        // Reject a missing/mismatched state outright — the page only ever
        // polls with the state it was rendered with.
        if (state !== expectedState) {
          sendJson(res, 400, { status: 'failed', message: 'Invalid state parameter.' });
          return;
        }
        const entry = oauthFlowStatus.get(state) ?? { status: 'pending', message: null };
        sendJson(res, 200, { status: entry.status, message: entry.message });
        if (entry.status !== 'pending') scheduleShutdown(3000);
        return;
      }

      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const description = url.searchParams.get('error_description');

      if (error) {
        const msg = `${error}${description ? ` — ${description}` : ''}`;
        setOAuthFlowStatus(expectedState, 'failed', msg);
        respondCompletingHtml(res, expectedState, 400);
        finishCode(new Error(`OAuth error from server: ${msg}`));
        return;
      }
      if (!code) {
        setOAuthFlowStatus(expectedState, 'failed', 'Missing authorization code.');
        respondCompletingHtml(res, expectedState, 400);
        finishCode(new Error('OAuth callback missing code parameter'));
        return;
      }
      if (state !== expectedState) {
        // Mismatched state → someone else's callback, or a replay. Reject
        // without exposing what we expected.
        respondHtml(res, 400, 'Invalid state parameter.');
        finishCode(new Error('OAuth callback state mismatch'));
        return;
      }

      // Code looks good — stage the "pending" page and hand the code back
      // so the caller can run the exchange. We do NOT write success HTML
      // yet; the poll page flips only once the backend reports success.
      if (!oauthFlowStatus.has(expectedState)) {
        setOAuthFlowStatus(expectedState, 'pending');
      }
      respondCompletingHtml(res, expectedState, 200);
      finishCode(null, { code, state });
    });

    server.on('error', (err) => finishCode(err));
    server.listen(OAUTH_CALLBACK_PORT, '127.0.0.1');

    const overallTimer = setTimeout(() => {
      finishCode(new Error(`OAuth flow timed out after ${OAUTH_FLOW_TIMEOUT_MS / 1000}s`));
    }, OAUTH_FLOW_TIMEOUT_MS);

    function finishCode(err, value) {
      if (codeSettled) return;
      codeSettled = true;
      clearTimeout(overallTimer);
      if (err) {
        // Ensure the browser page (if it rendered at all) sees the failure
        // on its next poll, then tear the server down shortly after.
        setOAuthFlowStatus(expectedState, 'failed', err instanceof Error ? err.message : String(err));
        scheduleShutdown(3000);
        reject(err);
        return;
      }
      // Success path: resolve the code immediately, but keep the server
      // up so the browser page can poll for the exchange outcome. Cap
      // that wait at OAUTH_FLOW_TIMEOUT_MS in case the backend never
      // reports back.
      scheduleShutdown(OAUTH_FLOW_TIMEOUT_MS);
      resolve(value);
    }

    function scheduleShutdown(ms) {
      if (shuttingDown) return;
      if (shutdownTimer) clearTimeout(shutdownTimer);
      shutdownTimer = setTimeout(() => {
        shuttingDown = true;
        try { server.close(); } catch { /* ignore */ }
        // Hold onto the status for a few more seconds in case a late poll
        // lands after we've shut the server, then drop it.
        setTimeout(() => oauthFlowStatus.delete(expectedState), 5000);
      }, ms);
    }
  });
}

// HTML shown on /callback once the state + code check out. It polls
// /callback-status and swaps to a success or failure message once the
// backend-side token exchange finishes. Writing the final status only
// from the polling result prevents "Authorization complete" from showing
// when saveTokens never actually ran.
function respondCompletingHtml(res, stateValue, status) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  const stateJson = JSON.stringify(stateValue);
  res.end(`<!doctype html>
<html>
  <body style="font-family:system-ui;padding:2rem">
    <p id="msg">Completing authorization…</p>
    <script>
      (function () {
        var state = ${stateJson};
        var msg = document.getElementById('msg');
        var done = false;
        function poll() {
          if (done) return;
          fetch('/callback-status?state=' + encodeURIComponent(state))
            .then(function (r) { return r.json().catch(function () { return { status: 'failed', message: 'Bad response' }; }); })
            .then(function (body) {
              if (!body || body.status === 'pending') {
                setTimeout(poll, 500);
                return;
              }
              done = true;
              if (body.status === 'success') {
                msg.textContent = 'Authorization complete — you can close this window.';
              } else {
                msg.textContent = 'Authorization failed' + (body.message ? ': ' + body.message : '.');
              }
            })
            .catch(function () { setTimeout(poll, 1000); });
        }
        poll();
      })();
    </script>
  </body>
</html>`);
}

function respondHtml(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><body style="font-family:system-ui;padding:2rem"><p>${message}</p></body></html>`);
}

function readJsonBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// server URL always matches `/mcp-oauth/:server/:kind` — server name is
// `[A-Za-z0-9_-]+` per routes.ts validation, so a simple split is safe.
function parseSecretPath(pathname) {
  const m = pathname.match(
    /^\/mcp-oauth\/([A-Za-z0-9_-]+)\/(tokens|client-info|code-verifier|discovery|all)$/,
  );
  if (!m) return null;
  return { serverName: m[1], kind: m[2] };
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

async function handleBridgeRequest(secret, req, res) {
  const headerSecret = req.headers['x-trellis-oauth-secret'];
  if (!timingSafeEqualStr(Array.isArray(headerSecret) ? headerSecret[0] : headerSecret ?? '', secret)) {
    sendJson(res, 401, { error: 'Invalid or missing bridge secret' });
    return;
  }

  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  if (url.pathname === '/oauth/exchange-complete' && req.method === 'POST') {
    let body;
    try { body = await readJsonBody(req); }
    catch (err) { sendJson(res, 400, { error: `Invalid request body: ${err.message}` }); return; }
    const { state, result, message } = body ?? {};
    if (typeof state !== 'string' || (result !== 'success' && result !== 'failed')) {
      sendJson(res, 400, { error: 'state (string) and result ("success"|"failed") are required' });
      return;
    }
    setOAuthFlowStatus(state, result, typeof message === 'string' ? message : null);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/oauth/start-flow' && req.method === 'POST') {
    let body;
    try { body = await readJsonBody(req); }
    catch (err) { sendJson(res, 400, { error: `Invalid request body: ${err.message}` }); return; }

    const { authorizationUrl, expectedState } = body ?? {};
    if (typeof authorizationUrl !== 'string' || typeof expectedState !== 'string') {
      sendJson(res, 400, { error: 'authorizationUrl and expectedState are required strings' });
      return;
    }

    // Start listener before opening the browser so we never lose the callback
    // to a fast redirect.
    const callbackPromise = awaitOAuthCallback(expectedState);
    try {
      await shell.openExternal(authorizationUrl);
    } catch (err) {
      // Still await — the user may paste the URL manually. But surface the
      // failure so the caller can decide to abort.
      console.warn('[trellis] shell.openExternal failed:', err?.message ?? err);
    }
    try {
      const result = await callbackPromise;
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  const parsed = parseSecretPath(url.pathname);
  if (!parsed) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  const { serverName, kind } = parsed;

  if (kind === 'all') {
    if (req.method !== 'DELETE') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }
    for (const k of MCP_OAUTH_KINDS) deleteEncrypted(mcpKey(serverName, k));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET') {
    const value = readEncrypted(mcpKey(serverName, kind));
    if (value == null) { sendJson(res, 200, { value: null }); return; }
    sendJson(res, 200, { value });
    return;
  }

  if (req.method === 'PUT') {
    let body;
    try { body = await readJsonBody(req); }
    catch (err) { sendJson(res, 400, { error: `Invalid request body: ${err.message}` }); return; }
    const { value } = body ?? {};
    if (typeof value !== 'string') {
      sendJson(res, 400, { error: 'value must be a string' });
      return;
    }
    try { storeEncrypted(mcpKey(serverName, kind), value); }
    catch (err) { sendJson(res, 500, { error: err instanceof Error ? err.message : 'store failed' }); return; }
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'DELETE') {
    deleteEncrypted(mcpKey(serverName, kind));
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}

function startOAuthBridge() {
  // Rotating secret: 32 random bytes, regenerated every main startup so a
  // leaked bridge file from a previous session can't be replayed.
  const secret = randomBytes(32).toString('base64url');

  const server = createServer((req, res) => {
    handleBridgeRequest(secret, req, res).catch((err) => {
      console.error('[trellis] OAuth bridge error:', err);
      try { sendJson(res, 500, { error: 'Internal bridge error' }); }
      catch { /* ignore */ }
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    // `listen(0, '127.0.0.1')` picks a free ephemeral port. After listen
    // resolves, `.address().port` is the actual port for the bridge file.
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr !== 'object') {
        reject(new Error('Bridge listener did not return an address'));
        return;
      }
      try {
        mkdirSync(DATA_DIR, { recursive: true });
        writeFileSync(
          BRIDGE_FILE,
          JSON.stringify({ bridgePort: addr.port, bridgeSecret: secret, callbackPort: OAUTH_CALLBACK_PORT }, null, 2),
          { mode: 0o600 },
        );
      } catch (err) {
        reject(err);
        return;
      }
      console.log(`[trellis] OAuth bridge listening on 127.0.0.1:${addr.port}`);
      resolve(server);
    });
  });
}

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

// Pick the icon variant that contrasts with the OS theme (dark-themed logo
// on light UI, light-themed logo on dark UI). Variant is chosen once at
// launch; macOS dock icons don't live-update with theme changes anyway.
function iconDir() {
  const variant = nativeTheme.shouldUseDarkColors ? 'png-light' : 'png-dark';
  return join(__dirname, '..', 'assets', variant);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 800,
    minHeight: 560,
    title: 'Trellis',
    // macOS uses app.dock.setIcon below; Windows/Linux take the icon from
    // the BrowserWindow itself.
    icon: process.platform !== 'darwin' ? join(iconDir(), 'icon-512.png') : undefined,
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

// ── Application Menu ───────────────────────────────────────────

// A custom menu is required so that Trellis-specific shortcuts
// (Cmd+` for terminal, Cmd+Shift+D for review panel) are dispatched as
// menu accelerators — which take precedence over the default menu's
// zoom accelerators that would otherwise swallow Cmd+`. Zoom items are
// kept on their standard accelerators (Cmd+Plus / Cmd+- / Cmd+0) which
// don't collide with our shortcuts.
function buildApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const sendToRenderer = (channel) => () => {
    mainWindow?.webContents.send(channel);
  };

  const template = [
    ...(isMac
      ? [
          {
            label: 'Trellis',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        {
          label: 'Toggle Terminal',
          accelerator: 'CmdOrCtrl+`',
          click: sendToRenderer('menu:toggle-terminal'),
        },
        {
          label: 'Toggle Review Panel',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: sendToRenderer('menu:toggle-review'),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front' },
            ]
          : []),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

// ── App Lifecycle ──────────────────────────────────────────────

app.whenReady().then(() => {
  Menu.setApplicationMenu(buildApplicationMenu());
  if (process.platform === 'darwin') {
    app.dock?.setIcon(join(iconDir(), 'icon-1024.png'));
  }
  createWindow();
  // Start the OAuth bridge before the backend learns about it — backend
  // reads oauth-bridge.json lazily on the first OAuth call.
  startOAuthBridge().catch((err) => {
    console.error('[trellis] OAuth bridge failed to start:', err);
  });
  // Re-register any adapters whose keys were persisted from a previous run.
  // Fire-and-forget: the window loads independently while this runs.
  registerPersistedAdapters().catch((err) => {
    console.error('[trellis] Adapter restore failed:', err);
  });
});

app.on('will-quit', () => {
  // Remove the bridge file on quit so a stale (port, secret) pair from a
  // previous run can never be picked up — the next startup writes a fresh one.
  try { if (existsSync(BRIDGE_FILE)) unlinkSync(BRIDGE_FILE); }
  catch (err) { console.warn('[trellis] Could not remove bridge file:', err?.message ?? err); }
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

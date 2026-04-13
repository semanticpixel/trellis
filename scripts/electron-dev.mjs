#!/usr/bin/env node

// Development launcher: starts backend, Vite dev server, then Electron
import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

const SERVER_PORT = 3457;
const VITE_PORT = 5174;

async function waitForPort(port, maxWait = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(`http://localhost:${port}`);
      if (res.ok || res.status < 500) return true;
    } catch {
      // not ready yet
    }
    await setTimeout(500);
  }
  throw new Error(`Port ${port} did not become available within ${maxWait}ms`);
}

// 1. Start backend server
console.log('[trellis] Starting backend on port', SERVER_PORT);
const server = spawn('npx', ['tsx', 'src/index.ts'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(SERVER_PORT) },
});

// 2. Start Vite dev server for dashboard
console.log('[trellis] Starting Vite dev server on port', VITE_PORT);
const vite = spawn('pnpm', ['-C', 'dashboard', 'dev', '--port', String(VITE_PORT)], {
  stdio: 'inherit',
});

// 3. Wait for both servers, then launch Electron
try {
  await Promise.all([
    waitForPort(SERVER_PORT),
    waitForPort(VITE_PORT),
  ]);

  console.log('[trellis] Servers ready, launching Electron');
  const electron = spawn('npx', ['electron', 'electron/main.mjs'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: `http://localhost:${VITE_PORT}`,
    },
  });

  electron.on('close', () => {
    server.kill();
    vite.kill();
    process.exit(0);
  });
} catch (err) {
  console.error('[trellis] Failed to start:', err.message);
  server.kill();
  vite.kill();
  process.exit(1);
}

// Cleanup on exit
process.on('SIGINT', () => {
  server.kill();
  vite.kill();
  process.exit(0);
});

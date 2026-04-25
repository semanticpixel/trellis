import express from 'express';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import * as pty from 'node-pty';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Store } from '../db/store.js';
import { SessionManager } from '../session/manager.js';
import { createRoutes } from './routes.js';
import { WS_PATH, WS_OVERFLOW_QUEUE_MAX } from '../shared/constants.js';
import type { WSMessage, WSEventType, TerminalClientMessage } from '../shared/types.js';

export interface ServerContext {
  store: Store;
  broadcast: (threadId: string, type: WSEventType, data: unknown) => void;
  sessionManager: SessionManager;
}

// ── Terminal session management ─────────────────────────────────

interface TerminalSession {
  ptyProcess: pty.IPty;
  workspaceId: string;
}

// Map: ws client → Map<workspaceId, TerminalSession>
const terminalSessions = new WeakMap<WebSocket, Map<string, TerminalSession>>();

function getOrCreateTerminalMap(ws: WebSocket): Map<string, TerminalSession> {
  let map = terminalSessions.get(ws);
  if (!map) {
    map = new Map();
    terminalSessions.set(ws, map);
  }
  return map;
}

function cleanupTerminals(ws: WebSocket): void {
  const map = terminalSessions.get(ws);
  if (!map) return;
  for (const session of map.values()) {
    session.ptyProcess.kill();
  }
  map.clear();
}

function sendToClient(ws: WebSocket, msg: WSMessage): void {
  if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < WS_OVERFLOW_QUEUE_MAX * 1024) {
    ws.send(JSON.stringify(msg));
  }
}

function handleTerminalMessage(ws: WebSocket, msg: TerminalClientMessage): void {
  const sessions = getOrCreateTerminalMap(ws);

  switch (msg.type) {
    case 'terminal_start': {
      // Kill existing terminal for this workspace if any
      const existing = sessions.get(msg.workspaceId);
      if (existing) {
        existing.ptyProcess.kill();
        sessions.delete(msg.workspaceId);
      }

      const shell = process.env.SHELL || '/bin/zsh';
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: msg.cols || 80,
        rows: msg.rows || 24,
        cwd: msg.cwd,
        env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
      });

      sessions.set(msg.workspaceId, { ptyProcess, workspaceId: msg.workspaceId });

      // Pipe PTY output to this specific client
      ptyProcess.onData((data: string) => {
        sendToClient(ws, {
          threadId: msg.workspaceId,
          type: 'terminal_output',
          data: { output: data },
          timestamp: Date.now(),
        });
      });

      ptyProcess.onExit(({ exitCode }) => {
        sendToClient(ws, {
          threadId: msg.workspaceId,
          type: 'terminal_exit',
          data: { exitCode },
          timestamp: Date.now(),
        });
        sessions.delete(msg.workspaceId);
      });
      break;
    }

    case 'terminal_input': {
      const session = sessions.get(msg.workspaceId);
      if (session) {
        session.ptyProcess.write(msg.data);
      }
      break;
    }

    case 'terminal_resize': {
      const session = sessions.get(msg.workspaceId);
      if (session) {
        session.ptyProcess.resize(msg.cols, msg.rows);
      }
      break;
    }
  }
}

// ── Server ──────────────────────────────────────────────────────

export function createServer(store: Store, port: number): { httpServer: ReturnType<typeof createHttpServer>; wss: WebSocketServer; app: ReturnType<typeof express> } {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Static serving for uploaded images. Paths are uuid-stamped so we can mark
  // them immutable for the browser cache.
  const imageDir = join(homedir(), '.trellis', 'images');
  mkdirSync(imageDir, { recursive: true });
  app.use(
    '/files/images',
    express.static(imageDir, {
      maxAge: '1y',
      immutable: true,
      fallthrough: false,
    }),
  );

  const httpServer = createHttpServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

  // Track connected clients
  const clients = new Set<WebSocket>();

  // Broadcast to all connected clients — every message includes threadId
  function broadcast(threadId: string, type: WSEventType, data: unknown): void {
    const message: WSMessage = {
      threadId,
      type,
      data,
      timestamp: Date.now(),
    };
    const payload = JSON.stringify(message);

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        // Backpressure: drop if client buffer is too large
        if (client.bufferedAmount < WS_OVERFLOW_QUEUE_MAX * 1024) {
          client.send(payload);
        }
      }
    }
  }

  wss.on('connection', (ws) => {
    clients.add(ws);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        // Route terminal messages
        if (msg.type === 'terminal_start' || msg.type === 'terminal_input' || msg.type === 'terminal_resize') {
          handleTerminalMessage(ws, msg as TerminalClientMessage);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      cleanupTerminals(ws);
      clients.delete(ws);
    });

    ws.on('error', () => {
      cleanupTerminals(ws);
      clients.delete(ws);
    });
  });

  // Session manager for LLM sessions
  const sessionManager = new SessionManager(store, broadcast);

  // Server context passed to routes
  const ctx: ServerContext = { store, broadcast, sessionManager };

  // Mount API routes
  app.use('/api', createRoutes(ctx));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  httpServer.listen(port);

  return { httpServer, wss, app };
}

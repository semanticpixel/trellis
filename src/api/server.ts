import express from 'express';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { Store } from '../db/store.js';
import { SessionManager } from '../session/manager.js';
import { createRoutes } from './routes.js';
import { WS_PATH, WS_OVERFLOW_QUEUE_MAX } from '../shared/constants.js';
import type { WSMessage, WSEventType } from '../shared/types.js';

export interface ServerContext {
  store: Store;
  broadcast: (threadId: string, type: WSEventType, data: unknown) => void;
  sessionManager: SessionManager;
}

export function createServer(store: Store, port: number): { httpServer: ReturnType<typeof createHttpServer>; wss: WebSocketServer; app: ReturnType<typeof express> } {
  const app = express();
  app.use(cors());
  app.use(express.json());

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
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
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

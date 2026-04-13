import { createServer } from './api/server.js';
import { Store } from './db/store.js';
import { SERVER_PORT, DB_FILENAME } from './shared/constants.js';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

const DATA_DIR = join(homedir(), '.trellis');
mkdirSync(DATA_DIR, { recursive: true });

const dbPath = join(DATA_DIR, DB_FILENAME);
const store = new Store(dbPath);

const port = parseInt(process.env.PORT ?? String(SERVER_PORT), 10);
const { httpServer } = createServer(store, port);

// Graceful shutdown
const shutdown = () => {
  console.log('[trellis] Shutting down...');
  httpServer.close();
  store.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`[trellis] Server running on http://localhost:${port}`);

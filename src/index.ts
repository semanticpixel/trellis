import { createServer } from './api/server.js';
import { Store } from './db/store.js';
import { registerAdapter } from './llm/adapter.js';
import { AnthropicAdapter } from './llm/anthropic.js';
import { OpenAIAdapter } from './llm/openai.js';
import { SERVER_PORT, DB_FILENAME } from './shared/constants.js';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

const DATA_DIR = join(homedir(), '.trellis');
mkdirSync(DATA_DIR, { recursive: true });

const dbPath = join(DATA_DIR, DB_FILENAME);
const store = new Store(dbPath);

// Register LLM adapters (keys are loaded from environment for now;
// in-app key management via electron.safeStorage will pass keys at runtime)
if (process.env.ANTHROPIC_API_KEY) {
  registerAdapter(new AnthropicAdapter(process.env.ANTHROPIC_API_KEY));
  console.log('[trellis] Anthropic adapter registered');
}
if (process.env.OPENAI_API_KEY) {
  registerAdapter(new OpenAIAdapter(process.env.OPENAI_API_KEY));
  console.log('[trellis] OpenAI adapter registered');
}

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

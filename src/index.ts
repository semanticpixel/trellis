import { createServer } from './api/server.js';
import { Store } from './db/store.js';
import { registerAdapter } from './llm/adapter.js';
import { AnthropicAdapter } from './llm/anthropic.js';
import { OpenAIAdapter } from './llm/openai.js';
import { OllamaAdapter } from './llm/ollama.js';
import { CustomAdapter } from './llm/custom.js';
import { SERVER_PORT, DB_FILENAME } from './shared/constants.js';
import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

const DATA_DIR = join(homedir(), '.trellis');
mkdirSync(DATA_DIR, { recursive: true });

const dbPath = join(DATA_DIR, DB_FILENAME);
const store = new Store(dbPath);

// Recover threads left in 'running' status from a prior crash / forced quit.
const recoveredThreadIds = store.recoverRunningThreads();
for (const threadId of recoveredThreadIds) {
  store.createMessage(threadId, 'assistant', 'Session interrupted (app restart)');
}
if (recoveredThreadIds.length > 0) {
  console.log(`[trellis] Recovered ${recoveredThreadIds.length} interrupted session(s)`);
}

// Register LLM adapters from environment variables (bootstrap/fallback)
if (process.env.ANTHROPIC_API_KEY) {
  registerAdapter(new AnthropicAdapter(process.env.ANTHROPIC_API_KEY));
  console.log('[trellis] Anthropic adapter registered (env)');
}
if (process.env.OPENAI_API_KEY) {
  registerAdapter(new OpenAIAdapter(process.env.OPENAI_API_KEY));
  console.log('[trellis] OpenAI adapter registered (env)');
}

// Register adapters from database provider configuration
// (API keys managed via electron.safeStorage are passed at runtime via IPC;
// for Ollama, no key is needed; for env-based fallback keys, use process.env)
const dbProviders = store.listProviders();
for (const provider of dbProviders) {
  if (provider.type === 'ollama') {
    registerAdapter(new OllamaAdapter(provider.base_url ?? undefined));
    console.log(`[trellis] Ollama adapter registered: ${provider.name}`);
  }
  // Custom adapters registered at runtime when keys are provided via safeStorage
}

// Export for dynamic adapter registration from Electron main process
export { registerAdapter, AnthropicAdapter, OpenAIAdapter, OllamaAdapter, CustomAdapter };

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

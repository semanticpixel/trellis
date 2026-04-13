// ── Server ──────────────────────────────────────────────────────
export const SERVER_PORT = 3457;
export const WS_PATH = '/ws';

// ── Database ────────────────────────────────────────────────────
export const DB_FILENAME = 'trellis.db';

// ── Defaults ────────────────────────────────────────────────────
export const DEFAULT_WORKSPACE_COLOR = '#6e7681';
export const DEFAULT_PROVIDER = 'anthropic' as const;
export const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
export const DEFAULT_MAX_TOKENS = 8192;

// ── Tool Limits ─────────────────────────────────────────────────
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const BASH_TIMEOUT_MS = 120_000; // 2 minutes
export const MAX_TOOL_LOOPS = 50; // prevent infinite tool loops

// ── WebSocket ───────────────────────────────────────────────────
export const WS_OVERFLOW_QUEUE_MAX = 500;
export const WS_BACKPRESSURE_LIMIT = 1024 * 1024; // 1MB

// ── Git ─────────────────────────────────────────────────────────
export const GIT_TIMEOUT_MS = 30_000;

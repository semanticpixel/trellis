# Trellis — Claude Code Instructions

## What is Trellis?

Multi-workspace LLM desktop app (Electron + React 19 + Express + SQLite) that multiplexes AI coding sessions across workspaces with built-in code review. See ARCHITECTURE.md for data flow and PLAN-v3.md for implementation phases.

## Project Structure

```
trellis/
├── src/              Backend (Express + WebSocket + SQLite)
│   ├── api/          REST routes + WebSocket server
│   ├── db/           SQLite store (better-sqlite3, WAL mode)
│   ├── llm/          LLM adapters (Anthropic, OpenAI) — direct API, NOT CLI wrapping
│   ├── tools/        Workspace-scoped tools (read_file, write_file, edit_file, bash, list_files)
│   ├── session/      Session lifecycle + tool execution loop
│   ├── git/          Git operations (branch, diff, checkout)
│   ├── review/       Annotation CRUD + plan parser (ported from redline)
│   └── shared/       Shared TypeScript types + constants
├── dashboard/        Frontend (React 19 + Vite)
│   └── src/
│       ├── components/  sidebar/, chat/, review/, git/, terminal/, layout/
│       ├── hooks/       useWebSocket, useChatStream, useWorkspaces
│       └── ui/          Design tokens + primitives
└── electron/         Electron main process + preload
```

## Hard Rules

### IPC Boundary
- Renderer NEVER imports from `src/` (backend). All Node/OS access goes through the Express API or WebSocket.
- SQLite writes happen in the backend process only.

### CSS
- No inline styles — use CSS Modules (`.module.css`) exclusively in React components.
- No hardcoded colors — all colors reference CSS custom properties from `tokens.css`.

### Monaco Editor
- ALWAYS lazy-load via `React.lazy()` + `Suspense` — never a top-level import.
- Used for: code blocks in chat messages, DiffEditor in review panel.

### API Keys
- Store/retrieve via `electron.safeStorage` IPC only.
- NEVER in localStorage, electron-store, .env files, or the SQLite database.
- The `providers` table stores provider config but NOT keys.

### WebSocket Envelope
- EVERY WebSocket message MUST include `threadId`. This is critical for routing concurrent streams to the correct ChatPanel.
```typescript
interface WSMessage {
  threadId: string;
  type: string;
  data: unknown;
  timestamp: number;
}
```

## Commit Format

```
feat(P1.2): design tokens and app shell
fix(P2.3): missing path cross-check on launch
refactor(P3.1): extract git operations module
```

Phase prefix maps to the plan: P1 = Foundation+Chat+Sidebar, P2 = Review Panel, P3 = Git+Terminal, P4 = Polish.

## Verification

After every change:
```bash
pnpm typecheck          # TypeScript compilation (backend + dashboard)
pnpm test               # Vitest test suite
```

## Native Module Rebuild

After any `pnpm install` that touches native packages:
```bash
npx electron-rebuild -f -w node-pty better-sqlite3
```

## Key Patterns

### LLM Adapters
All adapters implement the same `LLMAdapter` interface (src/llm/types.ts). They call provider APIs directly — no CLI wrapping. The `stream()` method returns `AsyncIterable<StreamEvent>` with normalized event types.

### Tool Sandboxing
Every tool validates paths against the thread's workspace directory. Paths outside the workspace are rejected. The `bash` tool runs with `cwd` set to the workspace path.

### Session Runner
The tool loop in `src/session/runner.ts`: stream from LLM → if tool_use, execute tool → append result → loop. Multiple threads run concurrently via `Map<threadId, AbortController>`.

### Annotations → LLM Context
`formatFeedback()` converts annotations into natural language prepended to the next user message. After injection, annotations are marked `resolved = 1`.

## Transfer to Another Machine

```bash
pnpm run bundle  # creates ~/Desktop/trellis.bundle
# Transfer the .bundle file, then on target:
git clone trellis.bundle trellis
cd trellis && pnpm install && npx electron-rebuild -f -w node-pty better-sqlite3
```

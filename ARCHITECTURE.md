# Trellis Architecture

## Overview

Trellis is a three-process Electron application:
1. **Electron Main** — Window management, IPC bridge, safeStorage for API keys
2. **Express Backend** — REST API, WebSocket, SQLite, LLM adapters, tool execution, session management
3. **React Renderer** — Vite-powered dashboard with sidebar, chat, and review panels

The backend runs in-process with Electron main (no separate server process).

## Data Flow

### Chat Message Flow
```
User types in ChatComposer
  → POST /api/threads/:id/messages
  → SessionRunner loads:
      - Thread message history
      - System prompt
      - Unresolved annotations (via formatFeedback())
  → Calls adapter.stream(messages, tools)
  → LLM streams response:
      → text_delta: broadcast via WS, append to buffer
      → tool_use: execute tool → append result → loop back to LLM
  → Final text response: store in DB, broadcast via WS
  → useChatStream(threadId) filters by threadId → ChatMessageList re-renders
```

### Annotation Feedback Loop
```
User adds comment on diff line or plan step
  → POST /api/threads/:id/annotations
  → Stored in annotations table (resolved = 0)
  → Next user message triggers SessionRunner
  → formatFeedback() converts unresolved annotations to natural language:
      "On file src/api.ts:42 — Comment: This should validate the input first"
  → Prepended to system context for next LLM call
  → Annotations marked resolved = 1
```

## WebSocket Envelope

Every WS message includes `threadId` for routing concurrent streams:

```typescript
interface WSMessage {
  threadId: string;     // REQUIRED — routes to correct ChatPanel
  type: WSEventType;    // event type
  data: unknown;        // event payload
  timestamp: number;    // server timestamp
}
```

Event types:
- `thread_stream_start/delta/end` — streaming lifecycle
- `thread_message` — stored message (user/assistant/tool)
- `thread_tool_start/end` — tool execution
- `thread_status` — status change (idle/running/error/done)
- `thread_error` — execution error
- `repo_update` — branch/file changes
- `workspace_update` — workspace path changes

## LLM Adapter Pattern

```typescript
interface LLMAdapter {
  readonly providerId: string;
  readonly displayName: string;
  healthCheck(): Promise<boolean>;
  listModels(): Promise<Array<{ id: string; name: string }>>;
  stream(request: StreamRequest): AsyncIterable<StreamEvent>;
}
```

Adapters normalize provider-specific streaming into a common `StreamEvent` type. Currently: Anthropic (Claude), OpenAI. Planned: Ollama, custom endpoints.

## Tool Sandboxing

Tools are scoped to the thread's workspace directory:
- Path validation: `resolve(workspacePath, userPath)` must start with `workspacePath`
- `bash` tool: `cwd` set to workspace path
- Symlink traversal blocked
- Paths outside workspace → error

## Session Concurrency

`SessionManager` holds `Map<threadId, AbortController>`. Multiple threads stream simultaneously — each adapter call is independent. Cancellation propagates via `AbortSignal` to the LLM SDK.

## Database

SQLite with WAL mode for concurrent read/write. Schema: workspaces → repos → threads → messages. Annotations table for diff/plan comments. Providers table for LLM config (keys stored separately in OS keychain via safeStorage).

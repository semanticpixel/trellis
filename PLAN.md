# Trellis — Multi-Workspace LLM Development Environment

## Current Status (last updated: 2026-04-12)

### What's done (Phase 1 foundation)
- **Project scaffolding**: package.json, tsconfig, Electron config, Vite config, .gitignore, .nvmrc
- **Documentation**: README.md, CLAUDE.md, ARCHITECTURE.md, PLAN.md (this file)
- **Shared types**: `src/shared/types.ts` — all DB entities, WS envelope, LLM types, API request/response types
- **Constants**: `src/shared/constants.ts` — server port, defaults, limits
- **SQLite database**: `src/db/store.ts` — full schema (workspaces, repos, threads, messages, annotations, providers, settings), WAL mode, all CRUD methods
- **Express API**: `src/api/routes.ts` — REST routes for workspaces (with auto-scan for git repos), repos (with missing path detection), threads, messages (with auto-title), annotations, settings, path health check
- **WebSocket server**: `src/api/server.ts` — broadcast with threadId envelope, backpressure handling
- **Electron shell**: `electron/main.mjs` — context isolation, sandbox, hiddenInset titlebar, safeStorage IPC for API keys
- **Preload bridge**: `electron/preload.mjs` — keys:store/retrieve/delete/has via IPC
- **Dev scripts**: `scripts/electron-dev.mjs` — starts backend + Vite + Electron
- **Dashboard entry**: `dashboard/src/main.tsx` — React 19 + QueryClientProvider
- **App shell**: `dashboard/src/App.tsx` + `App.module.css` — three-column layout (sidebar 240px | chat flex | review 380px toggleable)
- **Design tokens**: `dashboard/src/ui/tokens.css` — full color system (light + dark), spacing, radii, scrollbar styling, global reset

### What's verified
- Backend compiles (`tsc --noEmit` passes)
- Dashboard compiles (`tsc --noEmit` passes)
- Server starts on port 3457, health endpoint responds
- Creating a workspace auto-discovers git repos (tested with w0 — found 12 repos)
- pnpm install + native module builds work (better-sqlite3, node-pty, electron)

### What's next (remaining Phase 1 work)
1. **LLM adapters** — `src/llm/types.ts`, `adapter.ts`, `anthropic.ts`, `openai.ts`, `stream-handler.ts`
2. **Tool implementations** — `src/tools/types.ts`, `registry.ts`, `read-file.ts`, `write-file.ts`, `edit-file.ts`, `bash.ts`, `list-files.ts`
3. **Session runner** — `src/session/manager.ts`, `runner.ts` (prompt -> LLM -> tool loop with concurrent sessions)
4. **Sidebar tree view** — `Sidebar.tsx`, `TreeView.tsx`, `WorkspaceBlock.tsx`, `RepoRow.tsx`, `ThreadRow.tsx`, `AddWorkspaceModal.tsx`, `ColorPicker.tsx`, `MissingNotice.tsx`
5. **Chat panel** — `ChatPanel.tsx`, `ChatComposer.tsx`, `ChatMessageList.tsx`, `ChatMessage.tsx`, `CodeBlock.tsx`, `ToolCallBlock.tsx`, `ModelSelector.tsx`, `useWebSocket.ts`, `useChatStream.ts`
6. **Wire it up** — connect POST `/api/threads/:id/messages` to the SessionRunner so sending a message triggers the LLM

### After Phase 1: future phases
- **Phase 2**: Review panel (Monaco DiffEditor with inline comments, plan annotations)
- **Phase 3**: Git operations (branch popover, embedded terminal)
- **Phase 4**: Polish (Ollama/custom adapters, settings UI, flat sidebar mode, keyboard shortcuts)

---

## Context

You currently parallelize LLM-assisted development across 4 workspace copies (w0-w3), each with its own repo checkout, running separate Claude Code / Codex sessions in color-coded iTerm2 terminals. This works but requires constant context-switching between terminal windows, manual tracking of which session is doing what, and no unified review workflow. Trellis replaces this with a single desktop app that multiplexes LLM sessions across workspaces with built-in code review.

**Key differentiators from Codex Desktop / Claude Code:**
- Multi-LLM: Claude, OpenAI, Ollama, and custom endpoints in one app
- Workspace-centric: tree sidebar organized around your directory structure with color coding
- Inline review: Monaco diff editor with inline comments + plan annotations (redline-style)
- Annotation feedback loop: comments on diffs/plans get sent back to the LLM as context
- Git-aware: branch management built into the UI

## Architecture

### Tech Stack
- **Desktop**: Electron 35 (context isolation, sandbox, native title bar)
- **Frontend**: React 19 + Vite 7 + React Query + CSS Modules
- **Backend**: Express + WebSocket (same-process as Electron main)
- **Database**: SQLite (better-sqlite3, WAL mode)
- **Diff/Code**: Monaco Editor (lazy-loaded via React.lazy + Suspense) — DiffEditor for inline review with comments, read-only editor for code blocks
- **Terminal**: xterm.js + node-pty
- **Markdown**: react-markdown + remark-gfm
- **LLM SDKs**: @anthropic-ai/sdk, openai
- **API Key Storage**: electron.safeStorage (OS keychain encryption, no native rebuild needed)

### Project Location
`~/workspace/external/trellis/`

### Directory Structure
```
trellis/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── electron/
│   ├── main.mjs                # Electron shell
│   └── preload.mjs             # Context bridge for IPC
├── src/                        # Backend
│   ├── index.ts                # Server bootstrap
│   ├── api/
│   │   ├── server.ts           # Express + WebSocket + terminal protocol
│   │   └── routes.ts           # REST API
│   ├── db/
│   │   ├── store.ts            # SQLite store (better-sqlite3, WAL)
│   │   └── migrations.ts       # Schema versioning
│   ├── llm/
│   │   ├── types.ts            # Provider-agnostic interfaces
│   │   ├── adapter.ts          # Base adapter + registry
│   │   ├── anthropic.ts        # Claude adapter
│   │   ├── openai.ts           # OpenAI adapter
│   │   └── stream-handler.ts   # Unified streaming normalization
│   ├── tools/
│   │   ├── types.ts            # Tool definition interface
│   │   ├── registry.ts         # Tool registry scoped per session
│   │   ├── read-file.ts
│   │   ├── write-file.ts
│   │   ├── edit-file.ts
│   │   ├── bash.ts             # Sandboxed shell (cwd = workspace)
│   │   └── list-files.ts
│   ├── session/
│   │   ├── manager.ts          # Session lifecycle, concurrency
│   │   └── runner.ts           # Prompt -> LLM -> tool loop
│   ├── git/
│   │   └── operations.ts       # Branch info, diff, checkout, status
│   └── review/
│       ├── annotations.ts      # Annotation CRUD
│       ├── plan-parser.ts      # Port from redline
│       └── feedback.ts         # Annotations -> LLM context
└── dashboard/                  # Frontend
    ├── vite.config.ts
    └── src/
        ├── App.tsx
        ├── hooks/
        │   ├── useWebSocket.ts
        │   ├── useChatStream.ts
        │   ├── useWorkspaces.ts
        │   └── useDiffQuery.ts
        ├── components/
        │   ├── sidebar/
        │   │   ├── Sidebar.tsx
        │   │   ├── TreeView.tsx         # Hierarchical workspace tree
        │   │   ├── WorkspaceBlock.tsx   # Color square + name + collapse
        │   │   ├── RepoRow.tsx          # Repo name + branch pill
        │   │   ├── ThreadRow.tsx        # Thread title + status badge
        │   │   ├── AddWorkspaceModal.tsx # Directory picker + color swatch
        │   │   ├── ColorPicker.tsx      # Color swatch selector
        │   │   └── MissingNotice.tsx    # Bottom notice for missing paths
        │   ├── chat/
        │   │   ├── ChatPanel.tsx
        │   │   ├── ChatComposer.tsx
        │   │   ├── ChatMessageList.tsx
        │   │   ├── ChatMessage.tsx
        │   │   ├── ToolCallBlock.tsx
        │   │   ├── CodeBlock.tsx        # Monaco read-only, lazy-loaded
        │   │   └── ModelSelector.tsx
        │   ├── review/
        │   │   ├── ReviewPanel.tsx       # Toggleable right panel
        │   │   ├── DiffTab.tsx           # Monaco DiffEditor + inline comments
        │   │   ├── DiffFileList.tsx      # Changed files with +N -M counts
        │   │   ├── PlanTab.tsx           # Plan viewer with annotations
        │   │   ├── InlineComment.tsx     # Comment widget injected via viewZones
        │   │   └── AnnotationBadge.tsx
        │   ├── git/
        │   │   └── BranchPopover.tsx     # Branch list, switch, create
        │   ├── terminal/
        │   │   └── EmbeddedTerminal.tsx  # Bottom strip in chat pane
        │   └── layout/
        │       ├── AppShell.tsx          # Three-column layout
        │       └── PanelResizer.tsx
        └── ui/
            ├── tokens.css               # Design tokens (light + dark)
            └── [primitives]             # Button, Badge, Card, StatusBadge, etc.
```

### UI Layout
```
┌───────────────────────────────────────────────────────────────┐
│  [■] Polish annotation styling         blessed-migrate ↓     │
│       ^color pip  ^thread title         ^branch popover       │
│                                    [model ▾]  [◧ review]     │
├────────────┬──────────────────────────────┬───────────────────┤
│            │                              │                   │
│  Sidebar   │     Chat Panel              │  Review Panel     │
│  240px     │                              │  380px            │
│            │  message history             │  (toggleable)     │
│ [■] w0     │                              │                   │
│  ○ sprint… │                              │  [Diff] [Plan]    │
│  ────      │                              │                   │
│  ▾ redline │                              │  Monaco           │
│   blessed… │                              │  DiffEditor       │
│    ● Poli… │                              │  with inline      │
│    ● Plan… │                              │  comments         │
│  ▾ clima…  │                              │                   │
│    (none)  │                              │  — or —           │
│ [■] w1     │                              │                   │
│ [■] w2     │  ┌────────────────────┐     │  plan steps with  │
│ [■] w3     │  │ message input      │     │  annotations      │
│            │  └────────────────────┘     │                   │
│            │  ┌────────────────────┐     │                   │
│ ⚠ 1 missi…│  │ terminal (Cmd+`)   │     │                   │
│            │  └────────────────────┘     │                   │
├────────────┴──────────────────────────────┴───────────────────┤
│  + Add workspace                                    Settings  │
└───────────────────────────────────────────────────────────────┘
```

### Sidebar Design (from prototype testing)

**Mental model**: User adds a workspace by picking a directory (e.g. `~/workspace/grammarly/w0`). Trellis scans one level deep for git repos (checks for `.git`). User assigns a color label via color picker.

**Visual structure:**
```
[■] w0                          <- color square + workspace name, collapsible
    ○ w0 sprint planning        <- workspace-level thread (repoId: null), hollow dot
    ────                        <- hairline separator
    ▾ redline  blessed-migrate  <- repo row: chevron + name + branch pill
        ● Polish annotation...  <- thread row: filled dot + title + status badge
        ● Plan markdown range
    ▾ clima-web  main
        (no threads)
[■] w1                          <- collapsed by default if not active
[■] w2
[■] w3

⚠ 1 missing project            <- bottom notice if any registered path is gone
```

**Collapse behavior:**
- Workspace containing the active thread auto-expands on launch
- All other workspaces start collapsed
- A workspace with a `running` or `awaiting-approval` thread auto-expands regardless

**Thread types:**
- **Workspace-level threads** (`repoId: null`): render above repo list with hollow circle indicator (○), separated by hairline rule. For general workspace conversations not tied to a specific repo.
- **Repo-level threads** (`repoId` set): render under their repo with filled circle indicator (●).

**Status badges on threads:**
- `running`: spinning CSS indicator
- `awaiting-approval`: green pill
- `done`: muted/dim text
- `error`: red dot

**Missing path handling:**
- On launch, cross-check all workspace and repo paths against filesystem
- Missing items render as strikethrough with ⚠ icon, non-interactive
- Bottom notice shows count: "⚠ N missing project(s)" — click to see full paths
- DB records preserved — thread history survives path removal
- If path comes back (remounted drive, recreated dir), resurfaces on next launch

**Topbar:**
- Minimal: color pip (from workspace) + thread title only
- Model selector and review panel toggle on the right
- No breadcrumb — sidebar selection already communicates location

### WebSocket Message Envelope

**Critical**: Every WebSocket message MUST include `threadId` from day one. When multiple threads stream simultaneously across different workspaces, the frontend needs to route each event to the correct ChatPanel. Retrofitting this later touches every message type.

```typescript
// Every WS message follows this envelope
interface WSMessage {
  threadId: string;          // REQUIRED — which thread this event belongs to
  type: string;              // event type
  data: unknown;             // event-specific payload
  timestamp: number;         // server timestamp
}

// Event types
type WSEventType =
  | "thread_message"         // new stored message (user/assistant/tool)
  | "thread_stream_start"    // streaming begun for a thread
  | "thread_stream_delta"    // streaming text chunk
  | "thread_stream_end"      // streaming complete
  | "thread_tool_start"      // tool execution started
  | "thread_tool_end"        // tool execution complete with result
  | "thread_status"          // thread status changed (idle/running/error/done)
  | "thread_error"           // error during execution
  | "repo_update"            // branch/file change detected
  | "workspace_update";      // workspace path change detected
```

Frontend routing: `useChatStream(threadId)` subscribes to WS events filtered by `threadId`. Each ChatPanel instance only processes events matching its active thread.

### Data Flow
```
User types message in ChatPanel
  -> POST /api/threads/:id/messages
  -> SessionRunner loads thread context + unresolved annotations as system context
  -> Calls LLM adapter.stream(messages, tools)
  -> LLM returns text or tool_use
     -> tool_use: execute tool (scoped to workspace dir), append result, loop
     -> text: store message, broadcast via WebSocket
  -> WS broadcasts { threadId, type: "thread_stream_delta", data: { text } }
  -> useChatStream(threadId) filters by threadId -> ChatMessageList re-renders

User adds annotation on diff/plan
  -> POST /api/threads/:id/annotations
  -> Stored in annotations table
  -> On next LLM call, formatFeedback() injects annotations as context
  -> Annotations marked resolved after being sent
```

## Data Model (SQLite)

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#6e7681',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE repos (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  current_branch TEXT,
  default_branch TEXT DEFAULT 'main',
  remote_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo_id TEXT REFERENCES repos(id) ON DELETE SET NULL,  -- null = workspace-level thread
  title TEXT NOT NULL DEFAULT 'New Thread',
  provider TEXT NOT NULL DEFAULT 'anthropic',
  model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
  system_prompt TEXT,
  status TEXT NOT NULL DEFAULT 'idle',  -- idle | running | awaiting-approval | done | error
  base_commit TEXT,                     -- git commit at thread start (diff baseline)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                   -- user | assistant | tool
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_use_id TEXT,
  token_count INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,            -- diff_line | plan_step
  target_ref TEXT NOT NULL,             -- file:lineNumber or stepId
  annotation_type TEXT NOT NULL,        -- comment | question | delete | replace
  text TEXT NOT NULL,
  replacement TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                   -- anthropic | openai | ollama | custom
  base_url TEXT,
  default_model TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- API keys stored via electron.safeStorage (OS keychain), NOT in this table

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

## LLM Adapter Interface

```typescript
interface LLMAdapter {
  readonly providerId: string;
  readonly displayName: string;
  healthCheck(): Promise<boolean>;
  listModels(): Promise<Array<{ id: string; name: string }>>;
  stream(request: StreamRequest): AsyncIterable<StreamEvent>;
}

// Normalized stream events (provider-independent)
type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; text: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_end"; id: string; name: string; input: unknown }
  | { type: "message_end"; usage: UsageData }
  | { type: "error"; error: Error };
```

Adapters call provider APIs directly (Anthropic SDK, OpenAI SDK). This is NOT wrapping CLI tools — it's direct API integration with our own tool implementations.

## Diff Viewer: Monaco DiffEditor

Using Monaco DiffEditor instead of diff2html because it natively supports the inline commenting UX shown in Codex:

- **`editor.changeViewZones()`** — inject InlineComment form widgets between diff lines (the popup shown in Codex screenshot)
- **Glyph margin decorations** — comment indicators (+ icon) in the gutter, click to open comment form
- **Built-in side-by-side and inline diff modes** — native to Monaco
- **Syntax highlighting** — free, covers all languages
- **Lazy-loaded** via `React.lazy()` + `Suspense` to keep initial bundle small (~2-3MB loaded on demand)

The InlineComment component renders inside a Monaco viewZone:
- Shows annotation type selector (comment/question/replace/delete)
- Text input for the comment
- Cancel / Submit buttons
- On submit: `POST /api/threads/:id/annotations` with `target_type: "diff_line"`, `target_ref: "file/path:lineNumber"`

## Tools Provided to LLMs

Each tool is scoped to the thread's workspace directory via path validation:
- `read_file(path)` — read file contents (rejects paths outside workspace)
- `write_file(path, content)` — write/create file (direct write, no approval gate)
- `edit_file(path, old_string, new_string)` — search & replace
- `bash(command)` — shell execution with cwd = workspace path
- `list_files(pattern)` — glob-based file listing

## Session Runner (Tool Loop)

1. Load thread messages + system prompt + unresolved annotations (via `formatFeedback()`)
2. Call `adapter.stream(request)` with tools
3. Stream text deltas to client via WebSocket
4. If tool_use: execute tool -> append tool result -> loop back to step 2
5. If text response (no tool calls): store assistant message -> emit complete
6. Concurrent sessions: `Map<threadId, AbortController>` — multiple threads stream simultaneously

## Plan Storage Convention

Plans are stored as `.trellis-plan.md` files on disk in the repo root. The Plan tab reads this file and renders it with the redline-style annotation UI. This keeps plans visible in the filesystem and git.

## Design Patterns (self-contained — no external repos needed)

All remaining work is built from scratch using standard libraries. These notes describe the patterns to follow, not code to copy.

### WebSocket Hook Pattern
Create a `useWebSocket(url)` hook with: singleton connection, auto-reconnect with exponential backoff, subscription pattern (`subscribe(eventType, callback)` returns unsubscribe fn). Use `useChatStream(threadId)` to filter WS events by `threadId` for per-thread routing.

### Terminal Integration (Phase 3)
xterm.js + node-pty via WebSocket: backend spawns PTY with `node-pty`, pipes stdout to WS `terminal:output` events. Frontend sends `terminal:input` events. Use `xterm-addon-fit` inside a `ResizeObserver` callback (not on mount) — container must have measured size before `fit()` is called.

### Plan Parser (Phase 2)
`parsePlan(markdown)` splits markdown into selectable steps by matching: headings (`#`, `##`, `###`), numbered lists (`1.`, `2.`), bullet points (`-`, `*`). Each step gets an `id`, `content`, `depth`, and `annotations[]` array. `formatFeedback(steps)` converts annotated steps into structured text:
```
On step: "### 2. Update package.json"
  Comment: Use pnpm --version to get the exact installed version
On step: "## Verification"
  Remove this step
```

### Annotation Model
4 types: `comment` (general note), `question` (ask for clarification), `delete` (mark for removal), `replace` (suggest alternative text with `replacement` field). Target types: `diff_line` (file:lineNumber) or `plan_step` (step ID).

### Monaco DiffEditor Inline Comments (Phase 2)
Use `editor.changeViewZones()` to inject React-rendered comment form widgets between diff lines. Use glyph margin decorations for `+` icons in the gutter. On glyph click, create a viewZone at that line number containing the `InlineComment` component.

## Implementation Phases

### Phase 1: Foundation + Chat + Sidebar (MVP)

**Goal**: Working multi-workspace LLM chat with tree sidebar. Concurrent conversations across workspaces using Claude or OpenAI.

**Documentation (created during scaffolding):**
- `README.md` — Project overview, setup instructions (`pnpm install`, `npx electron-rebuild`, `pnpm dev`), architecture summary, transfer instructions (git bundle)
- `CLAUDE.md` — Instructions for future Claude Code sessions: project structure, IPC boundary rules, CSS-only-via-tokens rule, Monaco lazy-loading rule, safeStorage-only for keys, commit format (`feat(P1.1):`, `fix(P2.3):`), native rebuild command, verification steps
- `PLAN.md` — Symlink or copy of the implementation plan for quick reference
- `ARCHITECTURE.md` — Tech stack, data flow diagrams, WebSocket envelope spec, LLM adapter pattern, tool sandboxing model
- `.gitignore` — node_modules, dist, *.db, .env, .DS_Store

**Backend:**
1. Project scaffolding — `package.json`, `tsconfig.json`, Electron setup, Vite config
2. `src/db/store.ts` — SQLite schema, WAL mode, migrations
3. `src/llm/types.ts` + `adapter.ts` + `anthropic.ts` + `openai.ts` — LLM adapters with streaming
4. `src/tools/` — All 5 tool implementations with workspace sandboxing
5. `src/session/manager.ts` + `runner.ts` — Session lifecycle and tool loop
6. `src/api/server.ts` + `routes.ts` — REST API + WebSocket events
7. `src/index.ts` + `electron/main.mjs` — Server bootstrap + Electron shell
8. `src/main/ipc/keys.ts` — API key storage via electron.safeStorage

**Frontend:**
1. `tokens.css` — Full color system (light + dark via prefers-color-scheme)
2. `AppShell.tsx` + `PanelResizer.tsx` — Three-column layout (sidebar fixed 240px, review panel 380px toggleable via `Cmd+\`)
3. Sidebar: `Sidebar.tsx` + `TreeView.tsx` + `WorkspaceBlock.tsx` + `RepoRow.tsx` + `ThreadRow.tsx`
4. Sidebar: `AddWorkspaceModal.tsx` + `ColorPicker.tsx` — directory picker + color swatch + auto-scan for git repos
5. Sidebar: `MissingNotice.tsx` — missing path detection + bottom notice
6. Chat: `ChatPanel.tsx` + `ChatComposer.tsx` + `ChatMessageList.tsx` + `ChatMessage.tsx`
7. Chat: `CodeBlock.tsx` — Monaco read-only, lazy-loaded for code blocks in messages
8. Chat: `ToolCallBlock.tsx` — Collapsible tool call display
9. `ModelSelector.tsx` — Provider + model dropdown
10. `useWebSocket.ts` + `useChatStream.ts` + `useWorkspaces.ts`

**Key decisions:**
- API keys stored via `electron.safeStorage` (OS keychain encryption) — never in localStorage, electron-store, or .env files. Main process exposes encrypt/decrypt via IPC.
- Workspace colors are fully user-customizable: `color` field (hex) editable via color picker in the sidebar context menu and AddWorkspaceModal. Default is neutral gray (`#6e7681`).
- Workspace scanner: on first launch, prompt user to add workspace directories. Auto-detect git repos one level deep by checking for `.git`.
- First 60 chars of first user message auto-set as thread title.
- All colors reference CSS custom properties from `tokens.css` — no hardcoded hex in components.
- Monaco is always lazy-loaded via `React.lazy()` + `Suspense` — never top-level import.

### Phase 2: Review Panel + Inline Comments

**Goal**: Toggleable right panel with Monaco diff editor (inline comments) and plan annotations. Annotations feed back to the LLM.

1. `ReviewPanel.tsx` — Container with [Diff | Plan] tab bar, toggled via header button or `Cmd+\`
2. `DiffTab.tsx` — Monaco DiffEditor with:
   - `DiffFileList.tsx` showing changed files with `+N -M` counts
   - Glyph margin `+` icons to open inline comment form
   - `InlineComment.tsx` rendered via `editor.changeViewZones()` between diff lines
   - Stage/Revert actions per file
3. `PlanTab.tsx` — Web port of redline's plan annotation UI:
   - Reads `.trellis-plan.md` from repo root
   - Click/shift-click step selection
   - 4 annotation types: comment, question, delete, replace
   - `AnnotationBadge.tsx` visual indicators on annotated steps
4. `src/review/annotations.ts` — Server-side annotation CRUD
5. `src/review/plan-parser.ts` — Port `parsePlan()` + `formatFeedback()` from redline
6. `src/review/feedback.ts` — Inject annotations into next LLM call as context
7. API routes: annotations CRUD, `GET /api/repos/:id/diff`, `POST /api/open-in-editor`
8. "Open in VSCode" links: `code --goto path:line` via IPC

### Phase 3: Git Operations + Terminal

**Goal**: Branch management in the UI and embedded terminal for complex git operations.

1. `src/git/operations.ts` — Branch list, checkout, status, commit (via child_process.execFile)
2. Branch pill on each `RepoRow.tsx` in sidebar — shows current branch
3. `BranchPopover.tsx` — Click branch pill to open: branch list sorted by last commit, switch, create new
4. `EmbeddedTerminal.tsx` — Collapsible strip at bottom of chat pane (not in review panel), toggle via `` Cmd+` ``
   - Spawns in active repo path (or workspace path if no repo active)
   - Each workspace can have an independent terminal session
   - Uses xterm.js + node-pty via WebSocket protocol from aorta
5. API routes: `GET /api/repos/:id/branches`, `POST /api/repos/:id/checkout`
6. WebSocket `repo_update` events for branch/file changes

### Phase 4: Polish + Extended LLM Support

**Goal**: Settings UI, Ollama/custom adapters, keyboard shortcuts, flat sidebar mode.

1. `src/llm/ollama.ts` + `src/llm/custom.ts` — Additional adapters
2. `SettingsOverlay.tsx` — Provider config, workspace management, color pickers
3. Flat sidebar mode toggle (Codex-style colored-square list as alternative view)
4. `src/session/history.ts` — Context window management, token counting, compaction
5. Keyboard shortcuts: `Cmd+N` new thread, `Cmd+1-4` workspace, `Cmd+Shift+D` toggle review
6. Thread search across all workspaces
7. Notification dot on sidebar thread when status changes while another thread is focused

## Verification

After each phase:
1. `pnpm exec tsc --noEmit` — Zero TypeScript errors
2. `pnpm test` — All tests passing
3. Manual verification:
   - **Phase 1**: Add workspace (directory picker + color), see repos auto-detected, create thread, send message to Claude, see streaming response with tool calls. Open second thread in different workspace simultaneously. Verify missing path notice if workspace deleted. Verify workspace-level threads (repoId: null) render correctly.
   - **Phase 2**: Toggle review panel, see Monaco diff with changed files, click gutter to add inline comment, add annotation on plan step, verify annotation appears in next LLM context. Verify "Open in VSCode" links work.
   - **Phase 3**: See branch pills on repo rows, click to open popover, switch branches. Open terminal via Cmd+`, run git commands. Verify terminal spawns in correct cwd.
   - **Phase 4**: Configure Ollama endpoint in settings, switch between flat/tree sidebar, use keyboard shortcuts. Verify search finds threads across workspaces.

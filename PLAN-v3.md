# Trellis — Plan v3 (Dogfooding Improvements)

> Living document. Add items as you hit friction during daily use.

## How to use this plan

Each Claude Code session can tackle one or more items independently. This section tells you how to hand items off cleanly.

### Reading an item

Every item below follows this structure. When adding new items, match the shape so future sessions can execute without asking for clarification.

- **Title** — imperative, short: "Fix X" / "Add Y" / "Refactor Z"
- **Symptom** (bugs) / **What** (features) — what the user sees or wants
- **Cause** (bugs) / **Why** (features) — one-paragraph root cause or motivation
- **Fix** / **Implementation** — concrete steps, file paths, code sketches where useful
- **Fix options** (bugs only, when >1 approach) — labeled Option A/B/C with a recommended pick
- **Files to touch** — explicit paths, when non-obvious
- **Acceptance** — one-line verification: how to know it's done
- **Out of scope** — what NOT to do in this item (prevents scope creep)

### Priority tiers

- **P0 — Daily blockers.** Bugs you hit every session, or missing features that cause data loss. Items 1 (state persistence — DONE), 2 (abort button — DONE), 4 (startup recovery — DONE), 5 (unread indicator — DONE), 20 (tool call bars — DONE), 21 (Monaco error — DONE), 23 (Cmd+` zoom — DONE), 24 (stale annotations), 30 (abort leak — DONE), 32 (draft persistence — DONE), 33 (error boundaries).
- **P1 — High-value features.** New capabilities that unlock workflows. Items 3 (workspace context file), 6 (MCP), 7 (plan mode), 10 (@-mentions), 26 (AskUserQuestion), 27 (sleek diff/terminal), 28 (text-range plan annotations), 34 (image paste), 35 (commit message gen).
- **P2 — Nice polish.** Quality-of-life. Items 8 (permissions), 9 (Claude settings import), 11 (edit/regenerate), 12 (LLM titles), 13 (cost display), 14 (Cmd+K), 15 (arrow nav), 16 (auto-focus composer), 22 (app branding — DONE), 25 (terminal tab — may be superseded by 27), 31 (thread export), 36 (shortcut reference), 38 (group tool calls).
- **P3 — Hygiene / future.** Items 17 (extend Cmd+1-9), 18 (duplicate shadow token), 19 (hardcoded color), 29 (rotating welcome), 37 (tests), 39 (packaged distribution), 40 (@electron/rebuild migration — DONE), 41 (unread entry cleanup — DONE).

### Dependency graph

Some items share infrastructure or unblock others. Do the upstream item first.

- **Context-snippet anchoring** — items 24 and 28 both need this. Build it once in a shared module (`src/review/anchoring.ts`), reuse for diff and plan annotations.
- **Custom menu + IPC** — item 22 (app branding) and item 23 (shortcut conflict) both involve `Menu.buildFromTemplate` in `main.mjs`. Bundle them.
- **Monaco removal** — items 21 (disposal error) and 27 (sleek diff renderer) both benefit from dropping Monaco for the diff view. Item 27 subsumes item 21 if done.
- **Right-panel layout** — items 25 (terminal as tab) and 27 (stacked diff + terminal) conflict. Item 27's stacked approach is the final answer; skip item 25.
- **MCP + permissions** — items 6 (MCP) and 8 (permissions) are orthogonal but UI work in Settings overlaps. Can share a Settings tab scaffolding.
- **Session recovery** — item 4 (startup recovery) and item 26 (pending user inputs) both need "resume orphaned state on startup." Build the pattern once.

### Template for new items

```md
### NN. Short imperative title

**Symptom / What:** One-sentence description of user-visible behavior.

**Cause / Why:** Root cause or motivation in one paragraph.

**Fix / Implementation:**
1. Step one with file path
2. Step two with code sketch
3. Step three

**Files to touch:**
- `path/to/file.ts` — what changes
- `path/to/other.tsx` — what changes

**Acceptance:** How to verify it's done (one line).

**Out of scope:** What NOT to do in this item.
```

### Working across sessions

- Always start a session with `@CLAUDE.md @PLAN-v3.md` and a specific item number
- If an item is large, split into sub-items (N.1, N.2) in-place before starting
- Mark items done by striking through the title (`### ~~NN. Title~~ DONE`) and adding a one-line recap
- If you discover new work while implementing, add it as a new item rather than scope-creeping the current one

---

## Priority — things that'll bite you repeatedly

### ~~1. Session state persistence across restarts~~ DONE

Implemented in commit `3eaaeaa` (PR #37) via a new `dashboard/src/hooks/usePersistedSetting.ts` — a generic `useState` wrapper that hydrates from `/api/settings/:key` on mount and debounce-saves (300ms) on change, with an optional validator to drop malformed values. Persists `session.activeThreadId`, `session.activeWorkspaceId`, `sidebar.mode` (tree/flat), `review.activeTab` (diff/plan). Stale-ID cleanup: a 404 on the persisted thread, or a workspace no longer in the loaded list, clears the persisted ID. To preserve the welcome screen after restoring an active thread, the empty-thread case now renders `WelcomeState` inside the chat message area (composer stays mounted; suggestion cards send into the current thread). Out of scope and still open: `expandedWorkspaceIds`, `searchQuery`, `review.open`, `review.selectedFile`, `terminal.open`.

<details>
<summary>Original spec</summary>

`activeThreadId` / `activeWorkspaceId` live in React state only. Quit the app, you lose your place. Persist to the settings table (or localStorage) and restore on mount. Also restore which sidebar mode (tree/flat), which tabs were open in the review panel, and which files were selected in DiffTab.

**Trigger scenarios (all should restore full state):**
- App quit + relaunch
- Laptop sleep + wake (process may be reaped by macOS during sleep; even if it survives, WS reconnect can't rebuild state
 that was only in React memory)
- App crash + restart
- Switching between browser dev mode and Electron during development

**Fix:** Persist on every state change (debounced, ~300ms), read on mount. State keys to persist:
- `session.activeThreadId`
- `session.activeWorkspaceId`
- `sidebar.mode` (tree | flat)
- `sidebar.expandedWorkspaceIds` (Set)
- `sidebar.searchQuery` (optional — debatable whether to persist)
- `review.open` (boolean)
- `review.activeTab` (diff | plan)
- `review.selectedFile` (per repo)
- `terminal.open` (boolean)
- `layout.sidebarWidth`, `layout.reviewWidth` (already persisted — confirm still working)

**Files to touch:**
- `dashboard/src/hooks/usePersistedState.ts` (new) — generic `useState` + localStorage wrapper with debounced writes
- `dashboard/src/App.tsx` — migrate each piece of state to the hook
- Or: keep state in React Query cache keyed by user, hydrated from backend settings table

**Acceptance:** Open a thread, toggle review panel, select a diff file, close app, reopen — everything is exactly where y
ou left it. Put laptop to sleep for 30 min, wake, same result.

**Out of scope:** Syncing state across devices. Per-window state for multi-window support.

</details>

### ~~2. Abort running session button~~ DONE

Implemented in commit `1be9432` (PR #39). New `POST /api/threads/:id/abort` endpoint calls `sessionManager.abortSession()`; the ChatComposer renders a Stop button in the textarea's bottom-right while `isStreaming`, wired via a new `useAbortSession` mutation. `SessionManager.abortSession` now also broadcasts `thread_stream_end` and transitions the thread to `done` (was `idle`) so the UI clears streaming state immediately rather than waiting for the runner to wind down.

<details>
<summary>Original spec</summary>

`SessionManager.abortSession()` exists but isn't wired to the UI. Add a Stop button next to the composer when `isStreaming` is true. Clicking it should call `POST /api/threads/:id/abort` which invokes `sessionManager.abortSession(threadId)`. On the next stream event, broadcast `thread_status: 'done'` and clear any streaming state.

</details>

### 3. Workspace-level context file

Every thread starts fresh with the same default system prompt. Add a per-workspace persistent context file (coding conventions, architecture notes, gotchas) that's prepended to every thread's system prompt.

- Store as `.trellis-context.md` in the workspace root (like CLAUDE.md)
- Editable from a new "Context" tab in the workspace context menu (see v2 item 1)
- Loaded by `SessionRunner` at the start of each run and prepended to system prompt
- Per-thread `system_prompt` still layers on top

### ~~4. Session recovery on startup~~ DONE

Implemented in commit `ce6a065` (PR #42). New `Store.recoverRunningThreads()` runs a single SQL `UPDATE` to mark any `status = 'running'` threads as `error` and returns the affected IDs; `src/index.ts` appends an `"Session interrupted (app restart)"` assistant message on each (matching the `runner.ts` pattern for system-ish notices) and logs the recovered count. Runs after `new Store(...)` and before `createServer` — no routes, no WS broadcasts needed since no clients are connected at that point.

<details>
<summary>Original spec</summary>

If the app quits mid-stream, threads stuck at `status: 'running'` stay that way forever. On backend startup, scan for `running` threads and mark them `error` with a sentinel message: "Session interrupted (app restart)". User can re-send the last message to retry.

</details>

### ~~5. Unread content indicator~~ DONE

Implemented in commit `86f0388` (PR #48). New `unreadCounts: Record<string, number>` map lives at the App level, persisted via `usePersistedSetting('session.unreadCounts', ...)` with a shape validator that drops malformed values. The WebSocket handler increments the count when `msg.type === 'thread_message' && msg.threadId !== activeThreadIdRef.current`; `handleSelectThread` deletes the entry on select, alongside the existing `notifiedThreadIds` clear (both signals coexist — status dot vs. message count). The map threads down through `Sidebar → TreeView → WorkspaceBlock → (ThreadRow | RepoRow → ThreadRow)` and `Sidebar → FlatView`; the sidebar search list reads it too. Rendered as an accent-colored pill badge (matching the `--accent` token used elsewhere) next to the thread title when `unread > 0` and the thread isn't active. Note: every `thread_message` broadcast increments — that includes tool-use and tool-result messages, not just pure assistant text. For a session with many tool calls this produces a large count; if it reads as noisy in practice, narrow the increment to `role === 'assistant' && tool_name === null` in a follow-up.

<details>
<summary>Original spec</summary>

Currently the notification dot only fires on `thread_status` changes. If the LLM finishes streaming while you're on another thread, the dot might clear before you see it. Track "unseen messages" per thread: when a `thread_message` arrives for a non-active thread, mark it unseen. Clear when user selects the thread. Show a small count badge on the thread row.

</details>

### 6. MCP server integration (priority)

Trellis only exposes its 5 built-in tools. All MCP servers configured for Claude Code (Atlassian, GitLab, Glean, Context7, Chrome DevTools, Sumologic, etc.) are inaccessible from Trellis, which makes it feel limited for daily use. This is likely the single biggest feature gap.

**Config loading:**
- Read `.mcp.json` from workspace root (repo-level) and `~/.trellis/mcp.json` (user-level)
- Format matches Claude Code's `.mcp.json` so existing configs work as-is
- Also check `~/.claude.json` / `~/.claude/settings.json` for existing Claude Code MCP configs and offer to import

**Server lifecycle:**
- Spawn MCP servers as child processes when first needed in a workspace
- Keep them alive per-workspace (shared across threads), kill when last thread closes
- Use the official `@modelcontextprotocol/sdk` for the client side

**Tool discovery:**
- At session start, query each MCP server for its tool list
- Merge with built-in tools, namespaced as `mcp__<server>__<tool>`
- Pass merged tool list to LLM adapter's `stream()` call
- Cache tool lists per workspace to avoid re-querying

**Permission integration:**
- MCP tools respect the same permission system (item 7)
- Per-server allow/deny in settings (e.g. allow all `mcp__atlassian__*`, deny `mcp__chrome-devtools__evaluate_script`)
- UI shows which tools came from which MCP server

**Management UI** (Settings → MCP):
- List configured servers (name, status, tool count, last-seen error)
- Add/edit/remove servers
- Reload server (re-spawn)
- View server stderr logs for debugging (MCP servers log a lot)

### 7. Plan mode (priority)

Mirror Claude Code's plan mode. Forces the LLM into "propose before executing" — useful for non-trivial changes where you want to review before any files get written.

**How it works:**
- Toggle on the composer: `Plan mode` button next to Send (or keyboard shortcut like `Shift+Tab` to match Claude Code)
- When active, the system prompt instructs the LLM to only use read-only tools (`read_file`, `list_files`) and produce a plan, never modifying files
- LLM's response renders as a plan in the review panel's Plan tab (reusing existing plan annotation UI)
- User reviews, annotates, and either approves (plan mode exits, LLM executes) or denies with feedback (plan mode stays on, LLM revises)

**Implementation:**
- Add `plan_mode: boolean` column to `threads` table (per-thread state)
- SessionRunner checks this flag; if true, filters tools to read-only subset and injects plan-mode system prompt
- When LLM produces its final response in plan mode, save it to `.trellis-plan.md` so the existing Plan tab renders it
- Approval button in the Plan tab header: "Approve & execute" → sets `plan_mode = false`, triggers a new session that follows the plan
- Works with existing annotation system — user annotations feed back into plan revisions via the existing "Send feedback" flow

**UI cues:**
- Visible badge in the chat header when plan mode is active (e.g. "Plan mode" pill in workspace color)
- Review panel auto-opens to Plan tab when LLM is thinking
- Composer placeholder changes to "Describe what you want to build (plan mode)"

## Claude-style permissions system

### 8. Per-workspace tool permissions

Right now the LLM can freely `write_file`, `edit_file`, `bash`, etc. anywhere in the workspace. Mirror Claude Code's permission model:

**Sandbox modes** (per workspace, configurable in Settings → Workspace):
- `read-only` — only `read_file`, `list_files` allowed
- `workspace-write` (default) — adds `write_file`, `edit_file`, `bash` scoped to workspace
- `full-access` — no path scoping (dangerous, explicit opt-in)

**Approval policies** (per workspace or per thread):
- `untrusted` — every tool call requires explicit approval
- `on-request` — LLM can use allowlisted tools freely, asks for others
- `never` — auto-approve all (current behavior)

**Allow/deny patterns**:
- Bash command patterns (e.g. `allow: git *`, `deny: rm -rf *`)
- File path patterns (e.g. `allow: src/**`, `deny: .env*`)

**Approval UI**:
- When a tool call hits approval gate, pause the session and broadcast `thread_awaiting_approval` WS event
- ChatPanel shows inline approval prompt: tool name, input, "Allow once" / "Allow for session" / "Deny"
- Store decisions in a `tool_permissions` table (thread_id, tool_name, pattern, decision, scope)

### 9. Surface existing Claude settings

If the user has a `~/.claude/settings.json` or repo-level `.claude/settings.json`, read the permissions/allowlist from there as defaults for the workspace. This makes Trellis feel consistent with Claude Code usage.

## Productivity / chat features

### 10. File tags (@-mentions in composer)

Cursor / Codex / Claude Code all let you type `@` in the composer to fuzzy-search files in the workspace and insert a reference. Trellis should too — this is one of the most-used features in agent chat.

**Interaction:**
- Type `@` in `ChatComposer` → inline dropdown appears above the textarea
- Dropdown shows fuzzy-matched files from the active repo (or workspace if no repo selected)
- Tab or Enter inserts the path, dropdown closes
- Escape dismisses
- Arrow keys navigate the dropdown
- Rendered as a pill/chip in the composer: `@src/api/routes.ts` with a small file icon

**Data:**
- New backend route: `GET /api/repos/:id/files?q=<query>` — returns up to 20 fuzzy-matched files
- Use `list_files` logic but with fuzzy ranking (match against filename first, then full path)
- Exclude `node_modules`, `.git`, `dist`, etc. (reuse existing list-files exclusions)
- Cache the file list per-workspace with a short TTL (5s) so repeat searches are instant

**Context injection:**
- When the message is sent, replace each `@path` reference with the file's contents wrapped in an XML-ish block, similar to how Cursor does it:
  ```
  <file path="src/api/routes.ts">
  [file contents]
  </file>
  ```
- Multiple `@` references get multiple file blocks
- Reference the original user prompt text after the file blocks so the model sees the question last
- If a referenced file doesn't exist anymore, show an error toast and don't send

**Stretch:**
- `@#symbol` for symbol search within files (function/class names) — out of scope for v3
- `@commit:hash` to reference a git commit diff — nice to have

### 11. Edit + regenerate

Standard chat features that are noticeable by their absence:
- Edit last user message (re-runs the session from that point, clears messages after)
- Regenerate last assistant response (re-runs with same user message)
- Fork thread at message — creates a new thread that's a copy up to that point

### 12. LLM-generated titles

Auto-title currently is the first 60 chars of the first user message. After the first exchange completes successfully, call the LLM with a short prompt to generate a better 3-5 word title. Update the thread title via WS broadcast.

### 13. Cost / token display

`UsageData` tracks input/output/cache tokens per session. Surface them:
- Running total per thread in the chat header (small, subtle)
- Per-message tokens on hover (already stored in `messages.token_count`)
- Aggregate cost per workspace in Settings → Workspace

Use provider pricing tables in a constants file; fall back gracefully for Ollama/custom (no cost).

## Small polish

### 14. Cmd+K to focus sidebar search

Standard shortcut. Currently no keyboard path to search.

### 15. Arrow key navigation in sidebar

Up/Down to move between threads, Enter to select. Standard tree navigation.

### 16. Auto-focus composer on thread select

When a thread is selected, focus the composer textarea automatically. Right now you have to click it.

### 17. Extend Cmd+1-4 workspace shortcuts

Currently only handles first 4 workspaces. Options:
- Extend to Cmd+1 through Cmd+9
- Or switch to "most recently active" instead of index-based

### 18. Fix duplicate `--shadow-subtle` in tokens.css

Lines 69-70 in `dashboard/src/ui/tokens.css` are identical. Remove the duplicate.

### 19. Hardcoded workspace color fallback

`WelcomeState.tsx:112` uses `ws.color ?? '#6e7681'`. Should import `DEFAULT_WORKSPACE_COLOR` from `@shared/constants` to stay consistent with the "all colors from tokens/constants" rule.

## Bugs found while dogfooding

### ~~20. Tool call blocks render as thin "horizontal lines"~~ DONE

Fixed in commit `562805a` — swapped `overflow: hidden` to `overflow: clip` on `.block` in `ToolCallBlock.module.css`. The hidden container was collapsing content due to establishing a new block formatting context; `clip` still respects `border-radius` without that side effect. Follow-up item 38 (group consecutive tool calls) still open for a richer collapsed UX.

### ~~21. Monaco DiffEditor disposal error when switching files or closing review panel~~ DONE

Fixed in commit `6984f7f` (PR #46) via Option A — added `key={selectedFile}` to the `<DiffEditor>` in `DiffTab.tsx` so React fully unmounts the previous Monaco instance and mounts a fresh one on file switch, eliminating the TextModel-disposal race. Option B (keep-current-model props + manual lifecycle) and the `@monaco-editor/react` upgrade path remain available if this proves insufficient. Item 27 (sleek custom diff renderer) would subsume this change entirely by dropping Monaco from the review panel; until then the `key` prop stays.

<details>
<summary>Original spec</summary>

**Symptom:** Uncaught error in console:
```
Error: TextModel got disposed before DiffEditorWidget model got reset
    at ER.value (editor.api-*)
    at @monaco-editor_react.js
```

Thrown when `DiffTab` unmounts (review panel closed) or when the selected file changes rapidly. Doesn't break functionality but spams the console.

**Cause:** Known issue with `@monaco-editor/react` under React 19's stricter effect ordering. When the parent React tree unmounts, the `DiffEditor` component disposes its underlying `TextModel`s on cleanup. If Monaco's own async model-reset is still in flight, the model is already gone by the time it tries to reset, triggering the error.

StrictMode's double-mount in dev makes it worse (not the root cause — production has it too when switching files).

**Fix options:**

**Option A — Force remount via key (simplest):**
```tsx
<DiffEditor key={selectedFile} ... />
```
Forces Monaco to fully tear down and recreate when the file changes. Eliminates the error but adds a brief flicker on file switch. Acceptable tradeoff for correctness.

**Option B — Keep models alive:** Pass these props to `DiffEditor`:
```tsx
<DiffEditor
  keepCurrentOriginalModel={true}
  keepCurrentModifiedModel={true}
  ...
/>
```
Tells Monaco not to dispose the models on prop change. Then manage model lifecycle manually via `onMount` / component-level cleanup.

**Option C — Defer cleanup:** In `DiffTab`, wrap the cleanup in a microtask so Monaco finishes its async work first:
```tsx
useEffect(() => {
  return () => {
    queueMicrotask(() => { /* dispose models manually */ });
  };
}, [selectedFile]);
```

Recommended: **Option A** for quick fix. If the flicker is noticeable, move to **Option B** with manual model management. Also consider upgrading `@monaco-editor/react` — check GitHub issues around React 19 compatibility; there may be a newer version with this patched.

**References to investigate:**
- https://github.com/suren-atoyan/monaco-react/issues (search "TextModel disposed")
- React 19 migration notes on effect cleanup ordering

</details>

### ~~22. App branding — replace "Electron" with "Trellis" in menu bar and dock~~ DONE

Dev branding done in commit `d2ee4de` (PR #35) on top of item 23's custom menu. `app.name = 'Trellis'` set before `app.whenReady()`. Dock icon set via `app.dock?.setIcon(...)` using `assets/png-{light,dark}/icon-1024.png` chosen by `nativeTheme.shouldUseDarkColors` so it contrasts with the OS theme. Windows/Linux pick up the icon through `BrowserWindow.icon`. Brand assets committed under `assets/` (`icon.icns`, `icon.ico`, SVG sources, PNG sets 16–1024 px, light + dark variants). Packaged-app distribution work (electron-builder config, code signing, notarization) spun out as **item 39**.

<details>
<summary>Original spec</summary>

**Symptom:** The macOS menu bar shows "Electron" instead of "Trellis" as the app name. The dock icon is the default Electron logo. First-run impression is of a generic Electron app, not a shipped product.

**Fix — menu bar name:**

The app name in the macOS menu bar comes from the bundle's `CFBundleName`, not `app.setName()` at runtime (which is ignored for the app menu once the menu is built). The clean fix depends on how you're launching:

- **Dev (`electron:dev`):** The menu bar will always say "Electron" because you're running Electron directly. You can override by setting `app.name = 'Trellis'` at the very top of `electron/main.mjs` *before* `app.whenReady()` and creating a custom menu template that doesn't rely on the default app menu name. Some of the system menu items (About, Quit) will still read "Electron" in dev — this is unavoidable without packaging.

- **Packaged app:** Add a `build` config to `package.json` (via electron-builder or electron-forge) that sets `productName: "Trellis"`. This writes `CFBundleName` correctly in the `.app` bundle and fixes both menu bar and dock label.

**Fix — app icon:**

Create a `build/icon.icns` (macOS), `build/icon.ico` (Windows), `build/icon.png` (Linux) file. A simple trellis/lattice icon in the workspace color palette would fit the brand. Reference in `electron-builder` config:
```json
{
  "build": {
    "productName": "Trellis",
    "appId": "com.semanticpixel.trellis",
    "mac": { "icon": "build/icon.icns" },
    "win": { "icon": "build/icon.ico" },
    "linux": { "icon": "build/icon.png" }
  }
}
```

In dev, you can set the dock icon at runtime:
```js
app.dock?.setIcon(path.join(__dirname, '../build/icon.png'));
```

**Scope decision:**
- For dev-only (current state): just `app.name = 'Trellis'` and dock icon override — fixes the window title bar immediately.
- For distribution: add electron-builder / electron-forge with `productName` + icons. This is a bigger chunk of work (build pipeline, code signing, notarization for macOS) that can stand as its own item when you're ready to ship builds.

</details>

### ~~23. `Cmd+`` terminal shortcut triggers app zoom instead~~ DONE

Implemented via Option A — custom menu built in `electron/main.mjs::buildApplicationMenu()`. View submenu includes `Toggle Terminal` (`CmdOrCtrl+`\``) and `Toggle Review Panel` (`CmdOrCtrl+Shift+D`), both dispatched to the renderer via IPC (`menu:toggle-terminal`, `menu:toggle-review`). `app.name = 'Trellis'` set before `app.whenReady()` so the macOS app menu label is correct. Note: the implementation deliberately **omits the zoom roles** (resetZoom / zoomIn / zoomOut) — if zoom is wanted back, add those role entries to the View submenu.

<details>
<summary>Original spec</summary>

**Symptom:** Pressing `Cmd+`` to toggle the terminal zooms the app's window content instead. The renderer-level `keydown` handler in `App.tsx` calls `e.preventDefault()`, but something upstream is intercepting first.

**Cause:** Electron's default application menu has zoom accelerators registered at the native menu level (`Cmd+Plus`, `Cmd+-`, `Cmd+0`). On some keyboard layouts / macOS versions, `Cmd+\`` gets treated as a zoom-related accelerator by the native menu before the event reaches web content. Renderer `preventDefault()` can't cancel native menu accelerators — they fire first and consume the event.

**Fix options:**

**Option A — Register a custom menu in main.mjs (recommended):** Build an explicit `Menu.buildFromTemplate(...)` with Trellis's shortcuts registered as accelerators. Menu accelerators take precedence over the default menu and get dispatched back to the renderer via IPC. This also fixes item 22 (the "Electron" menu label) as a side effect.

```js
// electron/main.mjs
import { Menu } from 'electron';

const template = [
  // ... standard app/edit/view menus with zoom removed or relabeled ...
  {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      {
        label: 'Toggle Terminal',
        accelerator: 'CmdOrCtrl+`',
        click: () => mainWindow?.webContents.send('menu:toggle-terminal'),
      },
      {
        label: 'Toggle Review Panel',
        accelerator: 'CmdOrCtrl+Shift+D',
        click: () => mainWindow?.webContents.send('menu:toggle-review'),
      },
      // Note: NO zoom items here — or keep them on Cmd+Plus/Minus only
    ],
  },
];
Menu.setApplicationMenu(Menu.buildFromTemplate(template));
```

Then in preload, forward `menu:toggle-terminal` → renderer, and in `App.tsx`, listen for it and toggle state. Remove the corresponding `keydown` handler in React.

**Option B — Disable zoom at webContents level (quick fix):** In `main.mjs`:
```js
mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
// and globally disable zoom accelerator
app.commandLine.appendSwitch('disable-pinch');
```
Prevents zoom but doesn't fix menu accelerator ordering; may work if the zoom is pinch-based rather than menu-based.

**Option C — Change the shortcut:** Use `Cmd+J` (VS Code's toggle-panel shortcut) or `Cmd+Shift+T`. Easiest but breaks muscle memory for anyone used to `Cmd+\``.

Recommended: **Option A**. Registering a proper menu is the right long-term fix — it also gives you "View → Toggle Terminal" visible in the menu bar, which is discoverable, and as a bonus it cooperates cleanly with item 22 (app branding).

</details>

### 24. Stale diff annotations after file content changes

**Symptom:** After the LLM edits a file that already has an unresolved review comment, the comment still renders on the old line number even though the code at that line has changed (or the line no longer exists). The annotation becomes misleading — attached to code it was never written about.

**Cause:** Annotations store `target_ref` as `"file/path:lineNumber"`. When the diff updates (LLM re-writes the file), the line numbers shift but the stored ref doesn't. The Monaco viewZone still anchors to the old line, now pointing at unrelated code.

This is the same "stale review comment" problem GitHub PR reviews solve by marking comments "outdated" when the underlying code changes.

**Fix options:**

**Option A — Mark stale, keep visible (recommended, matches GitHub):**
1. When an annotation is created, store a small context snippet in a new `context_snippet` column on the `annotations` table — e.g. the 3 lines centered on the target line.
2. On diff render, for each annotation: find the current content at `target_ref` line number and compare against `context_snippet`.
3. If they match → render normally. If different → render with visual staleness (muted color, "outdated" badge, "Show on original diff" collapse toggle).
4. Stale annotations don't feed back into the LLM by default (excluded from `formatFeedback`) — user can explicitly opt in.

**Option B — Re-anchor by fuzzy content match:** Same context snippet storage, but on diff render, search the new file content for the snippet and move the annotation to the new line if found. If not found → mark stale. Better UX (comment follows the code) but more complex and can mis-anchor on ambiguous matches.

**Option C — Auto-resolve on file rewrite:** Cheapest: when `write_file` or `edit_file` succeeds on a path, auto-resolve all unresolved annotations targeting that file. User has to re-comment if the concern still applies. Fast to implement but loses context and forces busywork for comments on unchanged lines.

Recommended: **Option A**. Matches established UX (GitHub, GitLab), is robust, and users understand "outdated" semantics. Requires a one-line migration (`ALTER TABLE annotations ADD COLUMN context_snippet TEXT`), a small change in the create-annotation route to capture the snippet, and a staleness check in `DiffTab` before rendering viewZones.

**Bonus**: Once staleness is tracked, the `DiffFileList` unresolved-comment badge (already implemented) can split into "active" vs "outdated" counts so reviewers see where fresh attention is needed.

### 25. Move terminal into review panel as a tab (like Claude's desktop app)

**Current state:** Terminal is a collapsible strip at the bottom of the chat pane. Diff and Plan are tabs in the right-side review panel. Two different UI patterns for "contextual views," which is inconsistent.

**Proposed:** Consolidate into the review panel. Add `Terminal` as a third tab next to `Diff` and `Plan`. Reference: Claude's new desktop app uses a unified "Views" dropdown (Preview, Diff, Terminal, Tasks, Plan) — same pattern, different affordance.

**Benefits:**
- Consistent UX — one panel, multiple contextual views
- Cleaner layout — no bottom strip eating chat vertical space
- Extensible — Tasks, Preview, or other future views drop in as more tabs without redesign
- Matches VS Code's secondary-side-bar model that users already understand

**Tradeoff:** You lose the ability to see terminal + chat simultaneously. Mitigation: the `Cmd+\`` shortcut opens the review panel and selects the Terminal tab in one action, so it's still a single-keystroke view switch.

**Implementation:**
1. Move `EmbeddedTerminal` component out of `ChatPanel` and into `ReviewPanel`
2. Add `Terminal` tab to the `ReviewPanel` tab bar
3. Update `Cmd+\`` handler in `App.tsx`: open review panel + set active tab to `'terminal'`
4. Remove `terminalOpen`, `onToggleTerminal`, `onCloseTerminal` props from `ChatPanel`
5. Terminal's `cwd` still comes from the same source (active repo or workspace path)
6. Terminal session should persist when switching tabs (don't unmount the xterm instance — use CSS `display: none` or a tab-content caching approach)

**Stretch — Views dropdown:** If you end up with 4+ tabs, switch the tab bar to a dropdown like Claude's screenshot. Tabs are fine for 2-3; dropdown scales past that.

### 26. LLM-initiated questions (AskUserQuestion tool)

**What:** Add a built-in `ask_user` tool that lets the LLM pause the session to ask a multiple-choice question (with free-text "Other" fallback) instead of guessing or making assumptions. Matches Claude Code's `AskUserQuestion` pattern.

**Why:** Today, when the LLM hits an ambiguous decision point (e.g. "should I remove these unused classes?"), it either guesses or produces a wall of text explaining options. A structured question UI is faster to answer, keeps the session moving, and reduces bad guesses on destructive operations.

**Example use case from Claude Code's UI:**
> "Once the variantToClassNameMap points at the new global `type-*` classes, the 11 variant classes in text.module.css become unused dead CSS. Should I remove them?"
> 1. Yes, remove them (Recommended)
> 2. No, leave them
> 3. Other (free-text)
> [Skip] [Submit]

**Tool schema:**
```ts
{
  name: 'ask_user',
  description: 'Pause and ask the user a question with multiple-choice options. Use when you need user judgment before proceeding (e.g. destructive operations, ambiguous requirements). Do NOT use for rhetorical questions or narration.',
  input_schema: {
    question: { type: 'string' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          description: { type: 'string' },
          recommended: { type: 'boolean' }
        }
      },
      minItems: 2,
      maxItems: 4
    },
    allow_other: { type: 'boolean', default: true }
  }
}
```

**Backend flow:**
1. LLM emits `tool_use` for `ask_user` — runner detects this tool specifically
2. Runner stores a `pending_user_input` row: `{ id, thread_id, tool_use_id, question, options, created_at }`
3. Thread status set to `awaiting_input`, broadcast `thread_user_input_request` WS event with the question payload
4. Runner suspends the tool loop and awaits a resolution (Promise that resolves when user submits)
5. When frontend POSTs `/api/threads/:id/user-input` with `{ pendingId, response }`, backend:
   - Stores response as the tool result (just like any other tool)
   - Resolves the pending Promise → runner continues the tool loop
   - Thread status back to `running`

**Frontend flow:**
1. `useChatStream` subscribes to `thread_user_input_request` events
2. When one arrives, ChatPanel renders an inline `UserQuestion` component (matches the screenshot):
   - Question text at top
   - Options as numbered clickable rows with label + description + "Recommended" badge
   - "Other" row with free-text input (if `allow_other: true`)
   - `Skip` / `Submit` buttons (Skip sends a canonical "user skipped" response so the LLM can continue)
   - Keyboard: `1`/`2`/`3`/`4` for options, Enter to submit, Esc to skip
3. On submit, POST to the user-input endpoint with the response
4. UI replaces the question card with the submitted response (so it reads naturally in the chat history)

**Data model:**
- New table `pending_user_inputs (id, thread_id, tool_use_id, question_json, created_at, resolved_at, response)` — survives restarts so a mid-session question isn't lost if the app crashes
- On startup recovery (item 4), resolve any orphaned pending inputs as "Skipped (session interrupted)"

**Interaction with permissions (item 8):** Orthogonal — `ask_user` is always allowed (it's not destructive). But it pairs well with the approval system: instead of "Allow/Deny" binary, the LLM can proactively ask the user for clarification before proposing a tool call.

**System prompt nudge:** Update the default system prompt in `runner.ts` to encourage use of `ask_user` for ambiguous or destructive operations. Something like: "When you have a choice between plausible alternatives (especially destructive ones), use the `ask_user` tool instead of guessing."

### 27. Sleeker diff + terminal rendering (Claude Desktop style)

**What Claude Desktop does:**
- **Header:** branch line — `main → chore/text-use-global-type-classes`
- **File heading:** path + concise change count — `src/components/ui-core/text/text.module.css +0 -87`
- **Unmodified context collapsed:** `3 unmodified lines ▾` — expand on demand; cuts visual noise
- **Diff rows:** line number gutter + code, with a thin colored bar on the left edge (red for removals, green for additions) instead of full row-width borders or blocks
- **Row tint:** subtle background tint per row (not heavy like Monaco's default)
- **Terminal and diff stacked** in the same right panel, both visible simultaneously, with a compact "Terminal" header row that can be closed with an X

**Why this matters:**
- Monaco's `DiffEditor` is heavy for what we need — full editor widget, heavy borders, high visual weight, plus the lifecycle issues from item 21
- A custom lightweight renderer over a parsed unified diff is faster, smaller, and easier to style to Trellis's aesthetic
- Stacking terminal under diff (instead of tabs from item 25) preserves "see both at once" which is the whole point of having a terminal alongside code review

**This refines item 25:** Instead of tabs for Diff/Plan/Terminal, the right panel has:
- A tab bar at the top (Diff / Plan)
- The active tab's content rendered in the top portion
- A Terminal strip at the bottom that can be shown/hidden independently of the active tab
- Same pattern as Claude Desktop's screenshot — Terminal is always available but dismissible

**Implementation — diff renderer:**
1. Keep the backend diff API as-is (returns unified diff text via `git diff`)
2. Write a thin React component that parses unified diff hunks into rows
3. Render each row as: `[gutter line number] [left-edge marker bar] [syntax-highlighted code]`
4. Use `shiki` or `prismjs` for syntax highlighting (lighter than pulling in Monaco just for colors)
5. Collapsible "unmodified context" sections between hunks (show 3 lines by default, click to expand the full gap)
6. Keep inline commenting from current DiffTab — attach to line rows instead of Monaco viewZones

This also resolves item 21 (Monaco TextModel disposal error) entirely by removing the Monaco dependency for diff viewing. Monaco can stay for code-block rendering in chat messages only.

**Implementation — stacked layout:**
- `ReviewPanel.tsx` layout changes to a vertical flex container:
  - Top: tab bar (Diff / Plan)
  - Middle: active tab content
  - Bottom: Terminal (when `terminalOpen`), with its own header + close button
- `Cmd+\`` toggles the terminal strip without changing the active tab

**Tradeoff:** You lose the richer features Monaco provides (find-in-diff, minimap, click-to-copy line, etc.). For a review panel those aren't essential — and Claude Desktop demonstrates a compelling UX without them.

### 28. Text-range plan annotations (Claude Desktop style)

**What Claude Desktop does:**
- Plan renders as a normal rendered-markdown document (not a list of discrete "steps")
- Instructional hint at top: `Select any text to leave a comment for Claude`
- User drags to select any span of text (mid-sentence, a phrase, a whole paragraph)
- Selected text gets highlighted in a subtle accent color
- A small floating input appears near the selection with a "Comment ⏎" button
- On submit, the comment anchors to the selected text range

**Why this is better than our current step-based model:**
- Current Trellis plan tab parses markdown into discrete steps (headings/bullets) and annotates whole steps. That's a legacy of redline's terminal constraints.
- Text-range selection is far more precise: you can comment on a single phrase ("I do not like this sentence") without it applying to the surrounding 5 lines.
- Matches how users actually think about reviewing prose — "this sentence, not this paragraph"
- Works for plans that aren't cleanly step-based (free-form proposals, design docs, architecture notes)

**Implementation:**

1. **Drop step-based parsing for the Plan tab.** Render `.trellis-plan.md` as normal markdown via `react-markdown` (already a dep).
2. **Listen for text selection** via `document.getSelection()` on mouseup inside the Plan container.
3. **Compute an anchor** for the selected range. Options:
   - **Character offsets within the plan file** — simplest: `{ start: N, end: M }` where N/M are offsets into the raw markdown. Fragile if the plan is edited.
   - **Context-snippet anchoring** (recommended): store `{ before: "...20 chars", selected: "...", after: "...20 chars" }`. On re-render, search for this signature. Same approach as item 24 (stale diff annotations) — share the logic.
4. **Floating comment input:** on selection, position a small popover near the end of the selection with a textarea + "Comment" button. Esc/outside click dismisses.
5. **Highlight active annotations:** wrap annotated text ranges with a `<mark>` or styled span using accent-subtle background. Hover shows the comment; click opens the comment thread.
6. **Update annotation schema:** add a new `target_type: 'plan_range'` variant. `target_ref` becomes a JSON string containing the anchor context snippet (or a stable hash of it).

**Migration:** Existing `plan_step` annotations can coexist. New comments use `plan_range`; old ones keep their step-level anchoring. Over time `plan_step` phases out.

**Feedback formatting:** `formatFeedback()` already includes `target_ref` and comment text — extend it to render plan-range annotations with the quoted selected text for context, e.g.:
```
On plan > "The goal is to point Text's variant map..."
  Comment: I do not like this sentence
```

**UX details from the screenshot worth copying:**
- The instructional hint ("Select any text to leave a comment") appears at the top of the plan panel only when there are no annotations yet, then fades out
- Selected text highlight uses the same accent-subtle color as our existing selection states
- Comment button uses `⏎` keyboard hint — matches our InlineComment Cmd+Enter pattern
- Compact floating input — no type selector (pure comments); if we want to keep the 4 types, drop them into a subtle icon row

**Tradeoff:** More complex than step-level annotations. The payoff is precision and naturalness. Worth it for a review tool where annotation quality matters.

### 29. Rotating welcome phrases

**What:** The `WelcomeState` heading currently shows a static "Let's build". Rotate it through a small set of phrases that emphasize the excitement of building, so it feels fresh each time you open the app.

**Suggested phrases:**
- Let's build
- Let's cook
- Time to cook
- Building time
- Idea to reality
- Ship it
- What's next?
- Let's make something
- Back to the forge

**Implementation:**
- Pick randomly on mount (no animation cycling — that's distracting)
- Keep phrases in a `WELCOME_PHRASES` constant array, easy to extend
- If you want to get fancy: weight the selection so recently-used phrases are less likely to repeat on back-to-back launches (store last-shown in localStorage)

**Stretch variations:**
- Time-of-day aware — "Morning, ready to build?" before noon, "Late night coding?" after 10pm
- Workspace-aware — if a workspace is named after a project, riff on it
- Don't lean too hard on gimmicks. Keep 80% neutral, 20% playful.

**UX notes:**
- Don't rotate mid-session — feels twitchy. Pick once on mount, keep until next app open or full welcome-screen remount.
- Keep the subtitle static ("Select a thread from the sidebar..." / "Add a workspace...") — only the heading rotates.

### ~~30. AbortSignal listener leak in session runner~~ DONE

Fixed in commit `b8d0cb6` (PR #30) via Option A — each tool-loop iteration now wraps `adapter.stream()` in a linked per-iteration `AbortController`. Session-level aborts propagate through a single `once: true` listener per iteration, and listeners are released when the iteration completes. No more `MaxListenersExceededWarning` on long sessions.

<details>
<summary>Original spec</summary>

**Symptom:** Console warning on long sessions:
```
(node:xxxxx) MaxListenersExceededWarning: Possible EventTarget memory leak detected.
11 abort listeners added to [AbortSignal]. MaxListeners is 10.
```

(Ignore the sibling `Autofill.enable`, `Autofill.setAddresses`, and `HTTP/1.1 4...` errors — those are Chrome DevTools noise from Electron's inspector, unrelated to Trellis.)

**Cause:** In `src/session/runner.ts`, the tool loop passes the same `abortSignal` to `adapter.stream()` on every iteration (line 74). Each provider SDK call (Anthropic, OpenAI) attaches its own abort listener to that signal. After 11 tool-loop iterations in a single session, you exceed the default Node `EventTarget` listener limit. The listeners only get cleaned up when the parent controller aborts or is garbage collected — which doesn't happen mid-loop.

It's technically a leak (listeners accumulate), not just a warning, though in practice it's bounded by `MAX_TOOL_LOOPS` (50) so it won't grow unbounded.

**Fix options:**

**Option A — Derive a per-iteration signal (recommended):** Use `AbortSignal.any([sessionSignal])` to create a fresh linked signal for each loop iteration. When the iteration ends, the derived signal is garbage collected along with its listeners. Session-level abort still propagates through.

```ts
// Inside the while loop, replace:
const stream = adapter.stream({ ..., abortSignal });
// With:
const iterationController = new AbortController();
const onSessionAbort = () => iterationController.abort();
abortSignal.addEventListener('abort', onSessionAbort, { once: true });
try {
  const stream = adapter.stream({ ..., abortSignal: iterationController.signal });
  // ... consume stream
} finally {
  abortSignal.removeEventListener('abort', onSessionAbort);
}
```

**Option B — Raise the limit:** Call `setMaxListeners(MAX_TOOL_LOOPS + 5, abortSignal)` at the top of `runThread`. Silences the warning but doesn't fix the underlying accumulation. Only use if Option A is too invasive.

```ts
import { setMaxListeners } from 'events';
// At the top of runThread:
setMaxListeners(MAX_TOOL_LOOPS + 5, abortSignal);
```

Recommended: **Option A** — the linked-signal pattern is the idiomatic fix and keeps each iteration's listeners scoped to its own lifetime.

**Files to touch:**
- `src/session/runner.ts` — wrap the `adapter.stream()` call in the per-iteration signal pattern

**Acceptance:** Run a session with 15+ tool calls, no `MaxListenersExceededWarning` appears.

**Out of scope:** Reducing `MAX_TOOL_LOOPS` or changing the tool loop structure.

</details>

## New capabilities

### 31. Thread export as markdown

**What:** One-click export of a thread's full conversation — user messages, assistant responses, tool calls with inputs/results — as a markdown file for archiving, sharing, or feeding into other tools.

**Why:** When you complete a complex multi-turn investigation (e.g. "diagnose this bug"), the thread contains valuable context you may want to reference outside the app, paste into a PR description, or share with a teammate.

**Implementation:**
1. Backend: `GET /api/threads/:id/export` returns a `.md` file with:
   - Thread title as H1
   - Workspace + repo + branch metadata
   - Each message as a section: `## User` / `## Assistant`
   - Tool calls rendered as collapsible `<details>` blocks with tool name, input JSON, result
   - Timestamps on each message
2. Frontend: Export button in chat header (next to model selector). Triggers download via `a[download]` link.
3. Optional: "Copy as markdown" button for clipboard paste.

**Files to touch:**
- `src/api/routes.ts` — add export route
- `src/review/export.ts` (new) — render thread to markdown
- `dashboard/src/components/chat/ChatPanel.tsx` — add export button

**Acceptance:** Export a thread with mixed text + tool calls, open the `.md` file, verify all content is there in readable form.

**Out of scope:** Export of annotations, plan files, or multi-thread export.

### ~~32. Composer draft persistence~~ DONE

Implemented in commit `d7c0216` (PR #44). `ChatComposer` now takes a `threadId` prop; its `useState` initializer hydrates from `localStorage['trellis:draft:<threadId>']` (stored as `{ content, updatedAt }`), a 500ms-debounced effect re-writes the key on every change (removing it when empty), and `handleSubmit` clears the key after `onSend`. `ChatPanel` passes `key={thread.id}` so the composer fully remounts per thread — each gets its own init from localStorage. A one-shot `useEffect` on app mount in `App.tsx` sweeps any `trellis:draft:*` entry older than 7 days (or unparseable). Deliberately did **not** reuse the `usePersistedSetting` hook (item 1) — drafts are ephemeral and benefit from synchronous, no-roundtrip writes per keystroke, so they belong in localStorage rather than the backend settings table.

<details>
<summary>Original spec</summary>

**What:** If you type a message but don't send it, then switch threads (or the app crashes), the draft should be there when you come back.

**Why:** Losing in-progress messages is a small but repeated data-loss event. Especially painful for long prompts with `@file` references (item 10) that took effort to compose.

**Implementation:**
1. `ChatComposer` already has local state for the textarea. Add `useEffect` that debounces writes (500ms) to `localStorage` keyed by `draft:${threadId}`.
2. On mount, read `localStorage[draft:${threadId}]` and initialize state.
3. On successful send, clear the draft entry.
4. Expire drafts older than 7 days on app start (cleanup pass).

**Files to touch:**
- `dashboard/src/components/chat/ChatComposer.tsx` — add draft hooks

**Acceptance:** Type a message, switch threads, switch back — draft is still there. Send the message — draft is cleared.

**Out of scope:** Syncing drafts across machines or storing in the backend DB.

</details>

### 33. React error boundaries

**What:** If any component in the tree throws, show a friendly error UI with a "Reload" button instead of a white screen.

**Why:** Right now, any unhandled render error in Monaco, the diff parser, or any third-party component white-screens the whole app. Losing state to a white screen during dogfooding is painful.

**Implementation:**
1. Create `ErrorBoundary.tsx` in `dashboard/src/components/layout/` — standard React 19 class component with `componentDidCatch`.
2. Wrap at three levels:
   - Top-level in `App.tsx` (catches catastrophic failures)
   - Around `ReviewPanel` (isolates diff/plan rendering errors)
   - Around `EmbeddedTerminal` (isolates xterm/pty errors)
3. Error UI: icon + short message + "Reload" + "Report" buttons. Report copies error stack to clipboard for pasting into a github issue.
4. Log errors to backend via `POST /api/errors` (new endpoint that appends to a local error log file at `~/.trellis/errors.log`).

**Files to touch:**
- `dashboard/src/components/layout/ErrorBoundary.tsx` (new)
- `dashboard/src/components/layout/ErrorBoundary.module.css` (new)
- `dashboard/src/App.tsx` — wrap top-level
- `dashboard/src/components/review/ReviewPanel.tsx` — wrap content
- `src/api/routes.ts` — add `/api/errors` endpoint

**Acceptance:** Temporarily throw in a component, verify the error UI renders and reload works. Other components (sidebar, chat) still function.

**Out of scope:** Automatic error reporting to a remote service.

### 34. Image paste / drop in composer

**What:** Paste an image from clipboard or drag-drop from Finder into the composer. Image gets attached to the message and sent to the LLM.

**Why:** Reviewing UI screenshots, design mockups, error dialogs — all faster as images than descriptions. Claude and OpenAI both support image input natively.

**Implementation:**
1. `ChatComposer`: add `onPaste` and `onDrop` handlers on the textarea / container.
2. On paste/drop, read blob → convert to base64 → append to message's image array.
3. Render a thumbnail strip above the textarea showing attached images with X to remove.
4. On send, backend stores images at `~/.trellis/images/<threadId>/<uuid>.png` and returns paths.
5. Update LLM adapters to convert image attachments into provider format:
   - Anthropic: `{ type: "image", source: { type: "base64", media_type, data } }` in message content array
   - OpenAI: `{ type: "image_url", image_url: { url: "data:image/png;base64,..." } }`
6. `ChatMessage` renders images inline in user/assistant turns.

**Files to touch:**
- `dashboard/src/components/chat/ChatComposer.tsx` — paste/drop handlers, thumbnail strip
- `dashboard/src/components/chat/ChatMessage.tsx` — render attached images
- `src/llm/anthropic.ts`, `src/llm/openai.ts` — image message conversion
- `src/shared/types.ts` — add `images?: string[]` to `LLMMessage`
- `src/db/store.ts` — store image paths as JSON in a new `images` column on messages
- `src/api/routes.ts` — image upload handler, static serving from `~/.trellis/images/`

**Acceptance:** Paste a screenshot, send, see Claude describe what's in it. Close the app, reopen — image still renders in history.

**Out of scope:** Video, PDF, or non-image attachments.

### 35. Commit message generation

**What:** After a session that modified files, a "Generate commit message" button in the diff viewer that calls the LLM with the staged diff and returns a conventional-commit-style message.

**Why:** Natural endpoint for an LLM coding session. You've already loaded the diff in the review panel; generating a good commit message from it is a 10-second LLM call that saves a minute of manual writing.

**Implementation:**
1. Backend: `POST /api/repos/:id/generate-commit-message`
   - Takes `staged: boolean` flag (default true)
   - Reads `git diff --cached` (or `git diff` if not staged)
   - Calls LLM with a tight system prompt: "Generate a conventional-commit-style message (type: description) summarizing this diff. Keep to one line under 72 chars. No body."
   - Returns the generated string
2. Frontend: "Generate commit message" button in `DiffFileList` header
3. On click: show spinner, then a small popover with the generated message + Copy button + "Use in terminal" (runs `git commit -m "<msg>"` via terminal IPC)

**Files to touch:**
- `src/api/routes.ts` — new endpoint
- `src/review/commit-message.ts` (new) — system prompt + LLM call
- `dashboard/src/components/review/DiffFileList.tsx` — button + popover
- `dashboard/src/hooks/useReview.ts` — mutation hook

**Acceptance:** After editing a file, click the button, see a reasonable commit message generated. Copy it, paste into terminal, commit works.

**Out of scope:** Auto-committing, commit body generation, multi-commit splitting.

### 36. Keyboard shortcut reference (Cmd+/ or Cmd+?)

**What:** A modal showing all Trellis keyboard shortcuts, grouped by section.

**Why:** After adding Cmd+N, Cmd+1-4, Cmd+Shift+D, Cmd+`, Cmd+K (and more from this plan), discoverability becomes a problem. A cheat sheet modal is standard for pro tools.

**Implementation:**
1. `ShortcutReference.tsx` — modal component with sections: Navigation, Threads, Review, Terminal
2. Each shortcut as a row: description + keycap rendering
3. Bound to `Cmd+/` (or `Cmd+?`)
4. Can also be opened from Settings

**Files to touch:**
- `dashboard/src/components/settings/ShortcutReference.tsx` (new)
- `dashboard/src/components/settings/ShortcutReference.module.css` (new)
- `dashboard/src/App.tsx` — add keyboard binding + modal state

**Acceptance:** Press Cmd+/, see all current shortcuts listed, close with Escape.

**Out of scope:** User-customizable shortcuts.

### 37. Smoke test coverage

**What:** A small but meaningful Vitest test suite covering the critical paths that are most likely to break invisibly.

**Why:** The project has Vitest configured but zero tests. The riskiest areas (adapter streaming normalization, tool path sandboxing, plan parser, session runner tool loop) all have complex logic that could silently break on refactors.

**Implementation:**
1. **Tool sandboxing** (`src/tools/validate-path.test.ts`) — verify paths outside workspace are rejected, symlinks blocked, relative paths resolved correctly
2. **Plan parser** (`src/review/plan-parser.test.ts`) — verify headings/bullets/numbered lists parse, continuation lines captured (item 24-ish)
3. **Feedback formatter** (`src/review/feedback.test.ts`) — verify output format matches `formatFeedback()` contract
4. **Context window compaction** (`src/session/history.test.ts`) — verify oldest messages dropped first, system prompt preserved, tool pairs kept together
5. **Stream event normalization** — harder to test directly, but can test the provider message conversion functions (`convertMessages`, `convertTools`) in isolation

Target: 50+ tests, under 5 seconds total runtime. Keep it fast so `pnpm test` stays snappy.

**Files to touch:**
- `src/tools/validate-path.test.ts` (new)
- `src/review/plan-parser.test.ts` (new)
- `src/review/feedback.test.ts` (new)
- `src/session/history.test.ts` (new)

**Acceptance:** `pnpm test` passes with >50 tests. CI (or pre-commit hook) runs tests.

**Out of scope:** E2E tests, UI tests, integration tests hitting real LLM APIs.

### 38. Group consecutive tool calls into a collapsible block

**What:** Follow-up to item 20 (now DONE — the CSS fix made individual blocks legible). When the LLM runs many tool calls in a row, group them into one collapsible `ToolCallGroup` instead of rendering each as a separate block. Matches how Claude Code renders tool chains.

**Why:** Even with item 20's CSS fix, 10 consecutive `read_file` calls produce 10 stacked blocks. Visually that's a lot. Grouping them into one "5 tool calls ▸" row keeps chat scannable, and expansion shows the individual calls. Matches established UX from Claude Code and Cursor.

**Implementation:**
1. Create `ToolCallGroup.tsx` in `dashboard/src/components/chat/`:
   - Props: `calls: Array<{ id, name, input, result }>`
   - Collapsed state: single row showing `{N} tool calls` with a chevron, plus a compact preview (e.g. comma-separated tool names: `read_file, read_file, bash`)
   - Expanded state: renders each `ToolCallBlock` vertically inside
   - Default collapsed if `calls.length >= 3`, otherwise expanded
2. Update `ChatMessageList.tsx`:
   - Walk the message array and group adjacent tool-related messages
   - A group starts when a non-text assistant message appears (a `tool_use`) and extends through all subsequent `tool_use` + `tool` messages until a text assistant message or a user message breaks the run
   - Render each group via `<ToolCallGroup calls={...} />` instead of separate `<ChatMessage>` entries
3. Pair `tool_use` messages with their matching `tool` result (by `tool_use_id`) inside the group so expanded view shows call + result together

**Files to touch:**
- `dashboard/src/components/chat/ToolCallGroup.tsx` (new)
- `dashboard/src/components/chat/ToolCallGroup.module.css` (new)
- `dashboard/src/components/chat/ChatMessageList.tsx` — grouping logic
- `dashboard/src/components/chat/ChatMessage.tsx` — `ToolCallBlock` still rendered for singleton calls (outside groups); might not need changes if grouping happens one level up

**Design notes:**
- Compact preview in collapsed state: show up to 3 tool names, then `+N more` — e.g. `read_file, read_file, bash +2 more`
- If any call in the group had `isError: true`, show a small red dot on the collapsed header so errors don't hide inside groups
- Streaming case: while a group is actively being built (new tool calls arriving via WS), keep it expanded until the next text response, then auto-collapse

**Acceptance:** After a session with 10+ `read_file` calls, chat shows one collapsible "10 tool calls" row instead of 10 stacked blocks. Expanding shows each call + result.

**Out of scope:** Nested groups (groups within groups). Custom grouping rules (e.g. "group by tool name"). Keyboard navigation within groups.

### 39. Packaged app distribution (electron-builder)

**What:** Build signed, distributable Trellis binaries for macOS / Windows / Linux so the app can be installed without cloning the repo. Follow-up from item 22 — dev branding is done; this is the production-build piece.

**Why:** Today Trellis only runs via `pnpm run electron:dev`. To share with teammates or ship publicly, it needs packaged installers (`.dmg`, `.exe`, `.AppImage`).

**Implementation:**
1. **Install electron-builder:** `pnpm add -D electron-builder`
2. **Add `build` config to `package.json`:**
   ```json
   {
     "build": {
       "productName": "Trellis",
       "appId": "com.semanticpixel.trellis",
       "directories": { "output": "dist-electron" },
       "files": ["dist/**/*", "dashboard/dist/**/*", "electron/**/*", "assets/**/*"],
       "mac": {
         "icon": "assets/icon.icns",
         "category": "public.app-category.developer-tools",
         "target": ["dmg", "zip"]
       },
       "win": { "icon": "assets/icon.ico", "target": "nsis" },
       "linux": { "icon": "assets/png-dark/icon-512.png", "target": ["AppImage", "deb"] }
     }
   }
   ```
3. **Scripts:** add `"dist": "pnpm run build && electron-builder"` and `"dist:mac": "electron-builder --mac"` etc.
4. **Asar + native modules:** better-sqlite3 and node-pty need to be unpacked from asar. Add `"asarUnpack": ["**/node_modules/better-sqlite3/**", "**/node_modules/node-pty/**"]` to the build config.
5. **macOS code signing + notarization (separate sub-task):**
   - Developer ID Application cert in Keychain
   - Notarization credentials via `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` env vars
   - electron-builder handles this automatically once env vars are set
   - Without this, macOS users get a Gatekeeper warning on first launch
6. **CI (optional):** GitHub Actions workflow that builds + releases on tag push. Can come later; manual local builds work for personal use.

**Files to touch:**
- `package.json` — `build` config + new scripts
- `.gitignore` — add `dist-electron/`
- `electron/main.mjs` — confirm production asset paths work when packaged (ASAR vs unpacked)

**Acceptance:** `pnpm run dist:mac` produces a `.dmg` in `dist-electron/`. Install, launch from Applications — Trellis opens with the correct name, icon, and all features functional. SQLite writes to `~/.trellis/trellis.db`. Terminal spawns pty correctly.

**Out of scope:** Auto-update (`electron-updater`) — separate item when you start shipping releases. Cross-platform signing (Windows code signing is its own rabbit hole).

### ~~40. Migrate from `electron-rebuild` to `@electron/rebuild`~~ DONE

Implemented in commit `0873f77` (PR #51). Swapped to `@electron/rebuild@^4.0.3`; dropped the `npx` prefix from the `electron:rebuild` script since the binary is now a direct devDep on `node_modules/.bin`. Updated README and CLAUDE.md to point at `pnpm run electron:rebuild` instead of the raw command — less to remember, and the command survives any future binary rename. The binary name itself stayed `electron-rebuild`, so the script body only differs by the dropped `npx`.

<details>
<summary>Original spec</summary>

**Symptom:** `pnpm run electron:rebuild` fails on systems with Python 3.12+ because the bundled `node-gyp@9.4.1` imports the removed `distutils` module:
```
ModuleNotFoundError: No module named 'distutils'
```

**Cause:** `electron-rebuild@3.2.9` is unmaintained (the project was renamed to `@electron/rebuild` under the official Electron org). Its bundled `node-gyp` predates the Python 3.12 `distutils` removal.

**Fix:**
1. `pnpm remove electron-rebuild`
2. `pnpm add -D @electron/rebuild`
3. Update the script in `package.json`:
   ```diff
   -"electron:rebuild": "npx electron-rebuild -f -w node-pty better-sqlite3"
   +"electron:rebuild": "electron-rebuild -f -w node-pty better-sqlite3"
   ```
   (The binary name stays the same; it's just the npm package that moved.)
4. Run `pnpm run electron:rebuild` to verify.
5. Update README / CLAUDE.md native-rebuild section if either mentions the old package name.

**Files to touch:**
- `package.json` — dependency swap + script
- `README.md`, `CLAUDE.md` — update any references to `electron-rebuild`

**Acceptance:** `pnpm run electron:rebuild` succeeds on a machine with Python 3.12+ without needing `pip install setuptools` or a downgraded Python.

**Out of scope:** Pinning or upgrading Electron itself. Reworking the build scripts.

</details>

### ~~41. Clean up orphaned unread-count entries when threads are deleted~~ DONE

Implemented in commit `c71051d` (PR #52). Added a `useQuery({ queryKey: ['threads'] })` at the App level for the full thread set (existing `qc.invalidateQueries({ queryKey: ['threads'] })` calls refetch it by prefix match, so workspace-delete cascades and status changes both refresh it). A `useMemo` derives `allKnownThreadIds` as a `Set<string>` (or `null` while the query is pending), and a single effect reconciles both `unreadCounts` (persisted) and `notifiedThreadIds` (in-memory) against it — each setter guards with a `changed` flag so unchanged state isn't rewritten. The pruner is a no-op while `allKnownThreadIds` is `null`, so the initial pending fetch never wipes live counts.

<details>
<summary>Original spec</summary>

**Symptom:** When a thread is deleted, its entry in the `session.unreadCounts` map stays in localStorage forever. Harmless (nobody reads keys for non-existent threads) but accumulates over time.

**Cause:** The unread counter (item 5) increments on WS events and clears on selection, but has no reaper for deleted threads. Spotted during item 5's audit.

**Fix:** In `dashboard/src/App.tsx`, add an effect that prunes orphaned entries whenever the full set of known thread IDs changes. Roughly:

```ts
useEffect(() => {
  // threads is undefined during initial load; skip
  if (!allKnownThreadIds) return;
  setUnreadCounts((prev) => {
    let changed = false;
    const next: Record<string, number> = {};
    for (const [id, count] of Object.entries(prev)) {
      if (allKnownThreadIds.has(id)) {
        next[id] = count;
      } else {
        changed = true;
      }
    }
    return changed ? next : prev;
  });
  // Do the same for notifiedThreadIds
}, [allKnownThreadIds]);
```

`allKnownThreadIds` can be derived from the threads list already being fetched at the App level (aggregate across all workspaces). Apply the same cleanup to `notifiedThreadIds` for symmetry.

**Files to touch:**
- `dashboard/src/App.tsx` — add the effect

**Acceptance:** Create a thread, let it accumulate unread count, delete it. Inspect `localStorage['trellis:setting:session.unreadCounts']` — the deleted thread's entry is gone.

**Out of scope:** Cleanup on a timer (e.g. "expire entries older than N days"). Cleanup of other persisted state (review.selectedFile, etc.) — handle those if/when they're added and show the same pattern.

</details>

---

## Known debt (carried from v2)

- Terminal uses `workspaceId` as `threadId` in WS messages — works but bends the envelope spec
- Terminal sessions don't persist across close/reopen — reopening starts fresh

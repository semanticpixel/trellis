# Trellis — Plan (shipped archive)

> Shipped-work archive for [`PLAN.md`](./PLAN.md). Items keep their original numbers so they continue to match the priority-tier index in the active plan. Each block is preserved verbatim from when it shipped — useful when revisiting related work or auditing decisions.

---

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

---

### ~~55. Adopt CSS logical properties + add Stylelint~~ DONE

Adopted Stylelint for dashboard CSS, migrated physical CSS properties to logical equivalents, wired CSS linting into CI, and documented the rule in CLAUDE.md.

<details>
<summary>Original spec</summary>

**What:** Migrate every CSS Module in the dashboard from physical properties (`margin-left`, `padding-right`, `top`, `border-bottom`, etc.) to logical properties (`margin-inline-start`, `padding-inline-end`, `inset-block-start`, `border-block-end`). Add Stylelint with the `stylelint-use-logical` plugin so future drift is caught automatically.

**Why:**
- **RTL readiness.** Physical properties hardcode left/right; logical properties flow with the writing direction. Even if Trellis is LTR-only today, mirroring is one CSS variable away when we want it.
- **Consistency catch-net.** No lint today means physical/logical can be mixed file-to-file. One unified vocabulary across the codebase reads better and reviews faster.
- **Free wins from Stylelint.** Beyond `use-logical`, `stylelint-config-standard` catches duplicate selectors, invalid color values, and other real defects we currently rely on review to spot.
- **Codex will execute this.** The migration is mechanical (`stylelint --fix` + `csstools/use-logical` autofix handles ~95%), and the residual hand-edits are localized. Good fit for an isolated agent run.

**Config:** Trimmed to only what Trellis needs. The only override is for camelCase class names — we use them in CSS Modules (`.attachError`, `.dropOverlay`), and `stylelint-config-standard` defaults to kebab-case which would flag every class.

```js
// stylelint.config.cjs (repo root)
module.exports = {
  extends: ['stylelint-config-standard'],
  plugins: ['stylelint-use-logical'],
  rules: {
    'csstools/use-logical': ['always', {
      // Width/height stay physical — they don't have a writing-mode counterpart
      // worth the indirection, and `block-size`/`inline-size` would obscure intent.
      except: ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height'],
    }],
    'selector-class-pattern': null, // CSS Modules use camelCase classes
  },
  ignoreFiles: ['dashboard/dist/**/*', 'dist/**/*', 'node_modules/**/*'],
};
```

If during the migration any `stylelint-config-standard` rule turns out to be genuinely noisy (e.g. `no-descending-specificity` flags too many legitimate hover-before-base patterns), disable that specific rule **with a one-line comment explaining why**. Don't preemptively disable rules.

**Implementation:**
1. **Add deps:** `pnpm add -D -w stylelint stylelint-config-standard stylelint-use-logical`.
2. **Create `stylelint.config.cjs`** at the repo root with the config above.
3. **Add scripts to root `package.json`:**
   ```json
   {
     "scripts": {
       "lint:css": "stylelint 'dashboard/src/**/*.css'",
       "lint:css:fix": "stylelint 'dashboard/src/**/*.css' --fix"
     }
   }
   ```
4. **Run the autofix in two passes:**
   - First pass: `pnpm run lint:css:fix` — handles the bulk of physical→logical conversions (`margin-left → margin-inline-start`, etc.) automatically via the `csstools/use-logical` plugin.
   - Second pass: review the remaining warnings/errors. The plugin can't always pick the right side for shorthand `margin: 4px 8px` (that's already block + inline — fine) or for cases where intent matters (e.g. `text-align: left` should usually become `text-align: start`). Sweep these by hand.
5. **Run `pnpm typecheck && pnpm test`** + smoke-test the dashboard visually. Logical properties resolve to the same physical values in LTR, so there should be **zero visual regressions**. If anything moves, that's a bug — investigate.
6. **Add to CI:** wire `pnpm run lint:css` into the existing CI pipeline (or pre-commit hook if one exists). Fast (<2s).
7. **Update `CLAUDE.md`** under the CSS section with one new bullet: *"Use CSS logical properties (`margin-inline-start`, `padding-block-end`, `inset-block-start`) — never physical equivalents. Stylelint enforces this; run `pnpm run lint:css` before commit."*

**Files to touch:**
- `stylelint.config.cjs` (new)
- `package.json` — add deps + lint scripts
- All CSS Module files in `dashboard/src/**/*.module.css` — autofixed, with manual review for `text-align`, hardcoded `left:`/`right:` positioning, etc.
- `CLAUDE.md` — one-line CSS rule update
- CI config (whichever file currently runs `pnpm typecheck` / `pnpm test`)

**Acceptance:**
1. `pnpm run lint:css` passes with zero errors after the migration.
2. Diff against `main` shows only physical→logical property renames in CSS files; no rule changes, no value changes (other than `text-align` corrections).
3. Visual smoke: open the dashboard, click through chat / sidebar / review panel / settings — pixel-identical to pre-migration.
4. Adding a new physical property (`margin-left: 8px`) to any CSS file fails `pnpm run lint:css`.
5. Stylelint runs in CI and blocks merge on violations.

**Out of scope:**
- Adopting SCSS or any preprocessor.
- RTL-specific styling work (just the property migration; no `dir="rtl"` testing yet).
- Migrating inline `style={{}}` props (there should be none — CLAUDE.md already forbids them; if you find any, log a separate item).
- Token-level changes to `tokens.css` (those use CSS custom properties, not physical/logical positioning).
- Auto-fixing `text-align: left/right` to `start/end` — handle by hand because some places (e.g. timestamps that should always be right-aligned visually regardless of writing direction) genuinely want physical alignment.

**Owner:** Codex agent run. Suggested commit split: (1) config + scripts + deps, (2) autofixed CSS changes, (3) manual `text-align` sweep + CLAUDE.md update + add `pnpm run lint:css` to the workflow created by item 56. PR title: `chore(css): adopt logical properties + Stylelint`.

**Depends on:** Item 56 (initial CI). Land 56 first so Stylelint plugs into an existing workflow rather than fabricating one.

</details>

---

### ~~56. Set up GitHub Actions CI~~ DONE

Added the first GitHub Actions CI workflow for `pnpm typecheck` and `pnpm test`, plus a README status badge for `semanticpixel/trellis`.

<details>
<summary>Original spec</summary>

**What:** Add the repo's first CI workflow. Run `pnpm typecheck` + `pnpm test` on every push and on PRs targeting `main`. Block merges on failure.

**Why:** No CI today means typecheck or test regressions only surface when a human runs them locally — easy to slip past review. With items 55 (Stylelint), 37 (smoke tests), and 39 (packaged distribution) all queued, having a workflow file in place now means each of those just adds a step instead of bootstrapping CI alongside the feature.

**Implementation:**

1. Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: ['**']
  pull_request:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        # Reads packageManager from package.json — no version arg needed

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version-file: '.nvmrc'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Test
        run: pnpm test
```

2. Verify the workflow runs by opening the CI PR. Native modules (`better-sqlite3`, `node-pty`) compile from source on `ubuntu-latest` — the runner has python + build-essential preinstalled, so `pnpm install` should succeed without extra setup. If it fails, add `apt-get install -y python3 make g++` as a step before install (don't add preemptively).

3. Add a status badge to the top of `README.md`:
   ```md
   [![CI](https://github.com/<owner>/<repo>/actions/workflows/ci.yml/badge.svg)](https://github.com/<owner>/<repo>/actions/workflows/ci.yml)
   ```
   Look up the actual `<owner>/<repo>` from the existing git remote — don't guess.

4. **Branch protection:** after the workflow lands and is green at least once, ask the user to enable required status checks on `main` in GitHub Settings → Branches. Don't try to do this via gh API in the migration — repo settings are the user's call.

**Files to touch:**
- `.github/workflows/ci.yml` (new)
- `README.md` — CI status badge at the top

**Acceptance:**
1. Push the branch — `Actions` tab shows the workflow running and passing.
2. Open the PR — CI runs again and reports green on the PR.
3. Introduce a deliberate `pnpm typecheck` failure on a throwaway commit (e.g. `const x: string = 42;` in a temp file) — CI fails. Revert before merging.
4. README badge renders the green/passing state on `main`.

**Out of scope:**
- Caching beyond `actions/setup-node`' built-in pnpm cache.
- Build matrix (multiple Node versions, multiple OSes).
- Release / packaging workflow (item 39 covers that separately).
- Branch protection enforcement via API — manual user step.
- Linting (item 55 adds `pnpm run lint:css` to this workflow once Stylelint lands).
- Smoke tests (item 37 will add `pnpm test`-coverage-relevant steps when the test suite grows).

**Owner:** Codex agent run. Single PR, single commit. PR title: `chore(ci): add GitHub Actions workflow for typecheck + test`.

</details>

---

### ~~2. Abort running session button~~ DONE

Implemented in commit `1be9432` (PR #39). New `POST /api/threads/:id/abort` endpoint calls `sessionManager.abortSession()`; the ChatComposer renders a Stop button in the textarea's bottom-right while `isStreaming`, wired via a new `useAbortSession` mutation. `SessionManager.abortSession` now also broadcasts `thread_stream_end` and transitions the thread to `done` (was `idle`) so the UI clears streaming state immediately rather than waiting for the runner to wind down.

<details>
<summary>Original spec</summary>

`SessionManager.abortSession()` exists but isn't wired to the UI. Add a Stop button next to the composer when `isStreaming` is true. Clicking it should call `POST /api/threads/:id/abort` which invokes `sessionManager.abortSession(threadId)`. On the next stream event, broadcast `thread_status: 'done'` and clear any streaming state.

</details>

---

### ~~4. Session recovery on startup~~ DONE

Implemented in commit `ce6a065` (PR #42). New `Store.recoverRunningThreads()` runs a single SQL `UPDATE` to mark any `status = 'running'` threads as `error` and returns the affected IDs; `src/index.ts` appends an `"Session interrupted (app restart)"` assistant message on each (matching the `runner.ts` pattern for system-ish notices) and logs the recovered count. Runs after `new Store(...)` and before `createServer` — no routes, no WS broadcasts needed since no clients are connected at that point.

<details>
<summary>Original spec</summary>

If the app quits mid-stream, threads stuck at `status: 'running'` stay that way forever. On backend startup, scan for `running` threads and mark them `error` with a sentinel message: "Session interrupted (app restart)". User can re-send the last message to retry.

</details>

---

### ~~5. Unread content indicator~~ DONE

Implemented in commit `86f0388` (PR #48). New `unreadCounts: Record<string, number>` map lives at the App level, persisted via `usePersistedSetting('session.unreadCounts', ...)` with a shape validator that drops malformed values. The WebSocket handler increments the count when `msg.type === 'thread_message' && msg.threadId !== activeThreadIdRef.current`; `handleSelectThread` deletes the entry on select, alongside the existing `notifiedThreadIds` clear (both signals coexist — status dot vs. message count). The map threads down through `Sidebar → TreeView → WorkspaceBlock → (ThreadRow | RepoRow → ThreadRow)` and `Sidebar → FlatView`; the sidebar search list reads it too. Rendered as an accent-colored pill badge (matching the `--accent` token used elsewhere) next to the thread title when `unread > 0` and the thread isn't active. Note: every `thread_message` broadcast increments — that includes tool-use and tool-result messages, not just pure assistant text. For a session with many tool calls this produces a large count; if it reads as noisy in practice, narrow the increment to `role === 'assistant' && tool_name === null` in a follow-up.

<details>
<summary>Original spec</summary>

Currently the notification dot only fires on `thread_status` changes. If the LLM finishes streaming while you're on another thread, the dot might clear before you see it. Track "unseen messages" per thread: when a `thread_message` arrives for a non-active thread, mark it unseen. Clear when user selects the thread. Show a small count badge on the thread row.

</details>

---

### ~~6. MCP server integration (priority)~~ DONE

> **Status (2026-04-21):** Stdio landed in `4084654` (item 6). HTTP/SSE transport in `4a0a0a9` (item 50). OAuth for hosted servers (Sourcegraph, Glean, Coda, Statsig, Context7, Contentful) in item 51 — see its entry for the shipped set + the quiet-provider invariant. All three together complete the MCP arc.

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

---

### ~~10. File tags (@-mentions in composer)~~ DONE

**Why:** Cursor / Codex / Claude Code all let you type `@` in the composer to fuzzy-search files and insert a reference. One of the most-used features in agent chat; pairs with MCP because MCP tools often take file paths as input.

**Shape:** User types `@` in `ChatComposer` → overlay dropdown of fuzzy-matched workspace files → arrow keys navigate → Enter/Tab inserts `@path/to/file.ts`. On send, the backend replaces each `@path` token with the file's contents wrapped in `<file>` blocks before calling the LLM. The raw message stored in the DB keeps the `@path` tokens; the rendering layer displays them as pills with a file icon.

**Backend:**

New route `GET /api/workspaces/:id/files/search?q=<query>&repo_id=<optional>`:
- Returns up to 20 fuzzy-matched relative paths. Filename match ranks higher than full-path match.
- Scope defaults to workspace root; if `repo_id` is provided, scope to that repo's path.
- Reuses `list-files` exclusions (`.git`, `node_modules`, `dist`, hidden dirs). Walks recursively, capped at ~5000 files.
- Cached per workspace/repo with a 5s TTL. Invalidation on TTL expiry only — no filesystem watcher yet.
- Fuzzy: substring match on lowercased path first pass; if empty query, return 20 most-recently-modified files by mtime.

Message-send injection — single point of change in `src/session/runner.ts` (wherever user-message content is passed to the adapter):

1. Scan the raw user message for `@path` tokens (regex `@([\w./-]+)` at word boundaries, excluding email-like patterns).
2. For each unique `@path`, validate against workspace via the existing `validatePath()` helper, read contents. Skip if file missing — surface a `thread_error` WS event and abort the send.
3. Cap per-file at 200KB. Refuse binary files (null-byte scan in first 8KB).
4. Prepend file blocks to the message sent to the model; keep the trailing user prompt last:
   ```
   <file path="src/api/routes.ts">
   …contents…
   </file>

   <original user prompt with @src/api/routes.ts still present>
   ```
5. Store the original message unchanged in the DB — `@path` tokens are the canonical form. Expansion is ephemeral.

**Frontend:**

New `MentionDropdown.tsx` in `dashboard/src/components/chat/`:
- Absolutely positioned above the composer textarea. v1: anchor to textarea top-left with a fixed offset (simple). Upgrade to caret-tracking via a mirror div if it feels wrong.
- Max 8 visible results, scroll to 20.
- Row layout: file icon + basename in bold + dimmed parent directory after.
- Keyboard: ↑/↓ navigate, Enter/Tab inserts, Esc dismisses. Mouse click inserts.
- Debounced fetch (120ms) on the query text.

New hook `useFileSearch(workspaceId, query)` in `useWorkspaces.ts` — React Query against the new route, stale 5s.

Composer changes:
- Detect `@` typed at a word boundary (start of string, after whitespace, or after newline). Track `mentionStart` offset in state. Substring from `mentionStart + 1` to the caret is the query.
- Space, newline, or other non-path char closes the dropdown without inserting.
- On insert, replace `[mentionStart, caret]` with `@<selected.path>` + trailing space.

Pill rendering in `ChatMessage.tsx`:
- When rendering a user message, tokenize content by the `@path` regex. Render plain-text spans and `<FileMention>` spans.
- `FileMention` is a small inline chip — file icon + path. Clickable → fires the existing `ipc:openInEditor` channel.
- Composer itself stays a plain textarea (no contenteditable) — pills only render in the *sent* message view. Keeps caret handling simple.

**Files:**

New:
- `dashboard/src/components/chat/MentionDropdown.tsx` + `.module.css`
- `dashboard/src/components/chat/FileMention.tsx`

Modified:
- `src/api/routes.ts` — new search route
- `src/session/runner.ts` — message expansion
- `src/tools/list-files.ts` or a new `src/tools/search-files.ts` helper — shared fuzzy-search logic
- `dashboard/src/hooks/useWorkspaces.ts` — `useFileSearch`
- `dashboard/src/components/chat/ChatComposer.tsx` — @ detection, dropdown integration
- `dashboard/src/components/chat/ChatMessage.tsx` — pill rendering for user messages

**Acceptance:**

1. Type `@rou` in composer → dropdown shows `src/api/routes.ts` and others, with "routes.ts" bold.
2. Arrow down + Enter inserts `@src/api/routes.ts ` (trailing space, caret after).
3. Send the message. Backend logs confirm the message sent to Anthropic has a `<file path="src/api/routes.ts">…</file>` block prepended. Original textarea contents preserved in DB.
4. User's message renders in the thread with `src/api/routes.ts` as a pill. Clicking the pill opens the file in VS Code via the existing `ipc:openInEditor` path.
5. Reference a non-existent file → toast error via `thread_error`, message not sent, draft preserved.
6. Reference 3 files in one message → all 3 file blocks prepended in order they appear in the prompt.
7. Escape while dropdown is open dismisses without inserting. Typing a space also dismisses.

**Out of scope:**
- `@#symbol` symbol search within files — defer to v4.
- `@commit:hash` diff references — nice-to-have, defer.
- Fuzzy ranker beyond substring (fzf-style scoring) — ship simple, upgrade to `fuse.js` or a scoring function if search feels bad.
- Drag-and-drop from Finder into composer — related but different input path; not in this item.

**Risk callouts:**
- **Fuzzy ranker quality:** substring-only will feel crude vs Cursor. Plan to iterate based on feel.
- **Caret-relative positioning:** mirror-div tracking is the "right" solution but adds complexity. Start with textarea-anchored; upgrade only if it feels wrong.
- **Large workspaces:** the 5000-file cap will bite in monorepos. If the user hits it, add `.trellisignore` before upgrading the cap.

---

### ~~11. Edit + regenerate~~ DONE

**Why:** Standard chat features noticeable by their absence. Edit lets you tweak a prompt and re-run without losing all context; Regenerate lets you re-roll an assistant response without rewriting the user message. Both are daily-use.

**Shape:** Hover-button actions on messages.

- **Edit** on a user message → inline-editable textarea with Save / Cancel. Save truncates everything after the edited message (including its assistant response + tool calls/results), updates the content, restarts the session. Cancel reverts.
- **Regenerate** on an assistant message → one click truncates from that assistant message onward (preceding user message survives), then restarts the session.

Editing *any* user message (not just the last one) works the same way — truncate after the edited message + restart. Same mechanism, no special-case for the last message.

**Scope note:** Fork thread at message is in SPECULATIVE_FEATURES.md and stays there — promote when demand shows.

**Backend:**

New store methods in `src/db/store.ts`:
```ts
deleteMessagesFromId(threadId: string, fromId: number): number    // delete id >= fromId
deleteMessagesAfterId(threadId: string, afterId: number): number  // delete id >  afterId
updateMessageContent(messageId: number, content: string): Message | undefined
```
- `updateMessageContent` enforces `role = 'user'` — editing assistant/tool messages doesn't mesh with the tool-loop model.
- All three bump `threads.updated_at`.

New routes in `src/api/routes.ts`:

`PATCH /api/threads/:threadId/messages/:messageId` body `{ content: string }`:
1. Validate thread + message exist, message is a user message in that thread.
2. If session is running: `await sessionManager.abortSession(threadId)` — must actually wait for the runner to tear down (see abort-and-wait below).
3. `store.deleteMessagesAfterId(threadId, messageId)`.
4. `store.updateMessageContent(messageId, content)`.
5. Broadcast `thread_truncated` with `{ fromMessageId: messageId }`.
6. Broadcast `thread_message` with the updated message.
7. `sessionManager.startSession(threadId)` fire-and-forget.
8. Return `{ message, deleted: N }`.

`POST /api/threads/:threadId/regenerate` no body:
1. Find the most recent user message. If none, 400 `{error: "No user message to regenerate from"}`.
2. If running, `await abortSession`.
3. `store.deleteMessagesAfterId(threadId, lastUser.id)`.
4. Broadcast `thread_truncated` with `{ fromMessageId: lastUser.id }`.
5. `sessionManager.startSession(threadId)` fire-and-forget.
6. Return `{ deleted: N }`.

New WS event type in `src/shared/types.ts`:
```ts
| 'thread_truncated'   // data: { fromMessageId: number }
```
Clients drop all cached messages with `id > fromMessageId` so truncation feels instant.

**Abort-and-wait plumbing:** `sessionManager.abortSession` is currently synchronous — just signals the controller. Edit + Regenerate need to wait for tear-down before mutating the DB, otherwise the runner's next `store.createMessage` writes a zombie row referencing a deleted chain. Fix: track a cleanup promise alongside the `AbortController` in `activeSessions`; `abortSession` returns it. `startSession` stores it when spawning `runThread`. ~10 lines in `SessionManager`.

**Frontend:**

Hooks in `dashboard/src/hooks/useWorkspaces.ts`:
```ts
useEditMessage()   // mutationFn: PATCH /threads/:id/messages/:messageId
useRegenerate()    // mutationFn: POST  /threads/:id/regenerate
```
Both invalidate `['messages', threadId]` on success.

`useChatStream` (or wherever WS events update message cache): handle `thread_truncated` by optimistically pruning the local cache:
```ts
qc.setQueryData<Message[]>(['messages', threadId], prev =>
  prev?.filter(m => m.id <= fromMessageId) ?? []);
```

`ChatMessage.tsx` — hover action buttons:
- User message: `Edit` button (+ optional `Copy`).
- Assistant message (not tool-call variants): `Regenerate` button (+ optional `Copy`).
- Small row top-right of the message, visible on hover only (`opacity: 0 → 1`).
- Disabled when `thread.status === 'running'`.

Edit flow (user message):
- Click Edit → swap message body for an inline `<textarea>` with current content, auto-sized, Save/Cancel buttons below.
- Save: call `useEditMessage`; close editor; rely on `thread_truncated` WS event to prune the tail.
- Cancel: close editor, no mutation.
- Escape = Cancel, Cmd+Enter = Save.
- Textarea auto-focuses with caret at end.

Regenerate flow (assistant message):
- Click Regenerate → immediately fires `useRegenerate(threadId)`. No confirmation — `thread_truncated` makes it responsive, and the composer's abort button already exists for stopping the stream.

**Files:**

Modified only:
- `src/db/store.ts` — three new methods
- `src/api/routes.ts` — two new routes
- `src/session/manager.ts` — return cleanup promise from `abortSession`
- `src/shared/types.ts` — add `'thread_truncated'` to `WSEventType`
- `dashboard/src/hooks/useWorkspaces.ts` — two new hooks
- `dashboard/src/hooks/useChatStream.ts` — handle `thread_truncated`
- `dashboard/src/components/chat/ChatMessage.tsx` — hover actions + inline edit mode
- `dashboard/src/components/chat/ChatMessage.module.css` — action-button styles, hover, inline-edit textarea

**Tests:**
- Unit: `deleteMessagesAfterId` / `deleteMessagesFromId` / `updateMessageContent` — correctness + role guard.
- Route: `PATCH /threads/:id/messages/:id` — happy path, reject non-user message, reject mismatched thread_id, abort-before-mutate with mocked session manager.
- Route: `POST /threads/:id/regenerate` — happy path, 400 on no user messages, abort-before-mutate.
- Frontend: `ChatMessage` edit mode — open, type, Save calls mutation, Cancel reverts.

**Acceptance:**

1. Hover user message → Edit appears. Click → textarea + Save/Cancel. Change text, Save → message updates; later messages disappear; assistant streams a new response from the edited message.
2. Hover assistant message → Regenerate appears. Click → that message and anything after vanishes; assistant streams a fresh response to the same preceding user message.
3. Edit mid-thread (not the last user message) → all messages after the edited one are wiped.
4. Escape cancels edit mode. Cmd+Enter saves.
5. Edit/Regenerate while streaming → in-flight stream aborts cleanly (no orphan deltas), then the new generation starts.
6. Annotations survive (they're keyed by `target_ref`, not `message_id`). Verify manually with one present.
7. `thread_truncated` arrives before the regenerated stream begins — no flicker of stale messages.

**Out of scope:**
- **Fork thread at message** — in SPECULATIVE_FEATURES.md.
- **Edit assistant messages** — doesn't mesh with tool-loop model.
- **Edit history / undo** — old content is gone after save.
- **Regenerate with different model** — use ModelSelector + Regenerate as two clicks.
- **Branching / retaining both paths** — that's Fork.

**Risk callouts:**
- **Abort race:** the main correctness hazard. Without the cleanup-promise fix, truncation can happen mid-iteration and the runner writes a zombie row. Track a cleanup promise — do not use a sleep-before-mutate workaround.
- **Annotations anchored to diff lines:** unaffected in practice but worth confirming manually.
- **Composer streaming state:** the stop button is keyed off `isStreaming`. After regenerate fires, the composer should re-enter streaming state via WS events. Earlier debt notes flagged this as flaky — verify.

---

### ~~12. LLM-generated titles~~ DONE

After the first user + assistant exchange completes, `src/session/runner.ts` fires `generateTitleForThread` (fire-and-forget) using the thread's own adapter and model. The titler (`src/session/titler.ts`) streams with no tools, a tight system prompt, and `maxTokens: 32`, then strips quotes/trailing punctuation and calls `store.updateThreadTitle` + broadcasts a new `thread_update` WS event. The Sidebar invalidates `['threads']` and `['thread', id]` on `thread_update`, which also refreshes the ChatPanel header. The 60-char auto-title set in `routes.ts` on the first user message remains the initial state and the silent fallback when the LLM call fails or is aborted. Skipped on abort and max-tool-loop exits; only triggered when the thread has exactly one user message.

---

### ~~14. Cmd+K to focus sidebar search~~ DONE

Added a Cmd+K branch to the global keyboard handler in `App.tsx`. A ref threads from `App.tsx` → `Sidebar.tsx` and attaches to the existing search input; the handler calls `scrollIntoView({ block: 'nearest' })` then `.focus()` so the input is visible before focus lands.

---

### ~~16. Auto-focus composer on thread select~~ DONE

`App.tsx` bumps a `composerFocusToken` inside `handleSelectThread` and threads it through `ChatPanel` → `ChatComposer`. The composer focuses its textarea on token change but skips when `document.activeElement` is already an `INPUT` / `TEXTAREA` / contenteditable surface (modal, sidebar search, etc.). The token starts at 0 so initial app load with a persisted thread does not steal focus.

---

### ~~17. Extend Cmd+1-4 workspace shortcuts~~ DONE

`App.tsx` now matches `'1'`–`'9'` instead of `'1'`–`'4'` in the global keydown handler. If fewer workspaces exist than the pressed digit, the index lookup returns `undefined` and the handler no-ops (after `preventDefault`).

**Follow-up fix (PR #73):** Cmd+1-9 originally fed `activeWorkspaceId` into both the terminal cwd / session key and the ChatPanel color accent, so switching the selected workspace while a thread was open jumped the terminal and swapped the accent even though the visible chat stayed on the original thread. `App.tsx` now derives `focusWorkspaceId = activeThread?.workspace_id ?? activeWorkspaceId` and routes the terminal (`workspaceId` + `cwd`) and color accent through it. `activeWorkspaceId` remains the Cmd+N target and welcome-state selection, so Cmd+1-9 keeps its "pre-select workspace for next new thread" role.

---

### ~~18. Fix duplicate `--shadow-subtle` in tokens.css~~ DONE

Removed the duplicate `--shadow-subtle` declaration from the `:root` (light) block in `dashboard/src/ui/tokens.css`. Other theme blocks already had a single declaration.

---

### ~~19. Hardcoded workspace color fallback~~ DONE

Replaced every dashboard literal of `'#6e7681'` with `DEFAULT_WORKSPACE_COLOR` from `@shared/constants`. Touched `WelcomeState.tsx`, `App.tsx`, `Sidebar.tsx`, `AddWorkspaceModal.tsx` (initial state), and `ColorPicker.tsx` (the gray swatch in the COLORS array). The canonical definition still lives in `src/shared/constants.ts`.

---

### ~~20. Tool call blocks render as thin "horizontal lines"~~ DONE

Fixed in commit `562805a` — swapped `overflow: hidden` to `overflow: clip` on `.block` in `ToolCallBlock.module.css`. The hidden container was collapsing content due to establishing a new block formatting context; `clip` still respects `border-radius` without that side effect. Follow-up item 38 (group consecutive tool calls) still open for a richer collapsed UX.

---

### ~~21. Monaco DiffEditor disposal error when switching files or closing review panel~~ OBSOLETE

Originally fixed in commit `6984f7f` (PR #46) via the `key={selectedFile}` workaround. **Superseded by item 27**: Monaco is no longer used in the diff view (or anywhere else). The `key` prop and the entire `@monaco-editor/react` dependency were removed when the custom shiki-based diff renderer landed.

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

---

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

---

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

---

### ~~24. Stale diff annotations after file content changes~~ DONE

Implemented in commit `058fc92` (PR #59) via Option A — GitHub-style "outdated" UX. Added a `context_snippet TEXT` column to the `annotations` table (idempotent `ALTER` for existing DBs). The POST `/threads/:threadId/annotations` route captures a 3-line snippet centered on the target line from the current working-tree file. A new shared module `src/review/anchoring.ts` exposes `captureSnippet`, `compareSnippet`, `parseDiffLineRef`, and `findStaleAnnotations` — built deliberately diff/plan-agnostic so item 28 (plan-range annotations) can reuse it. GET `/threads/:threadId/annotations` decorates each annotation with a computed `stale: boolean`. In the UI, stale annotations render at ~0.5 opacity with an "outdated" pill (both in the Monaco viewZone and the `AnnotationBadge` row); `ReviewPanel`'s "All" select-all and Send-feedback default exclude stale annotations — reviewers can still tick stale items individually if they want to resend. `DiffFileList`'s unresolved badge is split into separate "active" and "outdated" counts. Out of scope: re-anchoring by fuzzy match (Option B) and plan-range annotations (item 28).

<details>
<summary>Original spec</summary>

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

</details>

---

### ~~25. Move terminal into review panel as a tab~~ SKIPPED

After trying both layouts during item 27, the user decided terminal belongs in `ChatPanel` (run-commands-while-talking flow), not in the review panel. Terminal stays as the dismissible strip below the chat composer.

<details>
<summary>Original spec</summary>

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

</details>

---

### ~~27. Sleeker diff + terminal rendering (Claude Desktop style)~~ DONE

**Scope note (2026-04-17):** The "stack terminal below the active review tab" portion of this item is no longer in scope. After trying both layouts, the user decided terminal belongs in ChatPanel — their flow is run-commands-while-talking, not verify-after-reviewing. Item 25 is also effectively moot for the same reason. This item now covers only the diff renderer swap + chat code block highlighting swap.

Implemented by removing `@monaco-editor/react` and `monaco-editor` entirely. New pieces:

- `dashboard/src/utils/diffParser.ts` — parses the unified-diff `patch` from `GET /api/repos/:id/diff` into per-file hunks plus inter-hunk gap ranges.
- `dashboard/src/utils/highlighter.ts` — lazy singleton shiki highlighter (`github-dark` theme) covering the languages we ship.
- `dashboard/src/components/review/DiffTab.tsx` — row-based renderer: `[oldNo | newNo] [colored marker bar] [+/- sign] [highlighted code]`. Inter-hunk gaps show 3 lines by default with a "Show N more unmodified lines" expander. Click any row's gutter to anchor an `InlineComment` at that modified-file line; existing annotation CRUD + staleness logic (item 24) is unchanged.
- DiffTab header: `base → currentBranch` row at the top; per-file heading shows `path` followed by `+N -M` change counts.
- Chat code blocks (`ChatMessage.tsx`) also moved to shiki, so monaco is gone from the bundle.
- Terminal placement was *not* changed — `EmbeddedTerminal` continues to mount inside `ChatPanel` as a dismissible strip below the composer (per the scope note above).

**Subsumed:** item 21 (Monaco TextModel disposal — gone with Monaco).

<details>
<summary>Original spec</summary>

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

</details>

---

### ~~29. Rotating welcome phrases~~ DONE

Shipped in commit `34c887a` — `WelcomeState` heading now rotates through a small `WELCOME_PHRASES` constant on mount. Subtitle stays static; selection is per-mount (no twitchy mid-session cycling).

<details>
<summary>Original spec</summary>

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

</details>

---

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

---

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

---

### ~~33. React error boundaries~~ DONE

Implemented in commit `b2917e0` (PR #57). Added `ErrorBoundary` class component (`dashboard/src/components/layout/`) using `getDerivedStateFromError` + `componentDidCatch`; fallback UI renders an `AlertTriangle` icon, the error message, a **Reload** button (window reload) and a **Report** button (copies message + stack + component stack to the clipboard, with a 2s "Copied" confirmation). Wrapped three levels: top-level in `App.tsx`, around `ReviewPanel`, and around `EmbeddedTerminal` (wrapped inside `ChatPanel.tsx`, since that's where it's rendered — not in `App.tsx` as originally sketched). `componentDidCatch` fires-and-forgets a POST to the new `/api/errors` endpoint in `src/api/routes.ts`, which appends a JSONL entry (`timestamp`, `message`, `stack`, `componentStack`, `label`) to `~/.trellis/errors.log`. Styling via CSS Modules + `tokens.css` only.

<details>
<summary>Original spec</summary>

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

</details>

---

### ~~35. Commit message generation~~ MOVED to SPECULATIVE_FEATURES.md (2026-04-22)

Demoted because Trellis's `bash` tool already lets the LLM commit directly — "commit this and open a PR" as a prompt does the job. A one-click button saves ~30s vs. one prompt saves the same; not worth the 1-hour budget while items 11 and 3 get used every session. Full spec preserved in SPECULATIVE_FEATURES.md → "Commit message generation" — ready to implement if dogfooding surfaces a manual-commit flow.

---

### ~~36. Keyboard shortcut reference (Cmd+/ or Cmd+?)~~ DONE

Recap: `ShortcutReference` modal grouped by Navigation / Threads / Review / Terminal / General, bound to Cmd+/ with Cmd+? (Cmd+Shift+/) added as an alias for the macOS-native help convention. Closes on Esc or backdrop click, also reachable from a new Settings footer button. Keycaps render through a small `<Kbd>` component; modifier glyphs (⌘ / ⇧) are used on macOS and `Ctrl` / `Shift` elsewhere.

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

---

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

---

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

### ~~42. Fix native module rebuild target mismatch~~ DONE

Implemented in commit `b546866` (PR #55) — Option A. Renamed the `electron:rebuild` script to `rebuild:native` with body `pnpm rebuild better-sqlite3 node-pty`, which targets system Node's ABI (the same runtime the `tsx` backend subprocess uses). Dropped `@electron/rebuild` as a devDep since nothing in the tree calls it now and the native modules (`better-sqlite3`, `node-pty`) are only loaded by the backend, never by Electron's main process. Updated README and CLAUDE.md to use the new script name and to explain *why* system Node is the right target for this architecture. Option B (move backend in-process with Electron) split out as item 43 for a future session.

<details>
<summary>Original spec</summary>

**Symptom:** On a fresh clone, running `pnpm run electron:rebuild` followed by `pnpm run dev:server` (or `pnpm run electron:dev`) produces:

```
Error: The module '.../better-sqlite3/build/Release/better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 133. This version of Node.js requires
NODE_MODULE_VERSION 115.
```

The reverse also happens: if you `pnpm install` fresh (prebuilt for system Node), then try to run the packaged app later where better-sqlite3 ends up in Electron's process, you'd get the opposite error.

**Cause:** The `electron:rebuild` script compiles native modules against Electron's Node ABI (v22, `NODE_MODULE_VERSION 133`). But the backend doesn't run inside Electron — `electron-dev.mjs` spawns it as a separate `tsx` subprocess using **system Node** (v20, `NODE_MODULE_VERSION 115`). So the rebuild targets the wrong runtime for this architecture.

ARCHITECTURE.md describes the backend as "running in-process with Electron main," but the actual implementation is a subprocess. That drift is what's causing the rebuild confusion.

**Fix options:**

**Option A — Just rename the rebuild script (quick, low-risk):** The native modules used by Trellis (`better-sqlite3`, `node-pty`) are only loaded by the backend, which runs under system Node. Swap `@electron/rebuild` for plain `pnpm rebuild`, which uses node-gyp against system Node.

```diff
- "electron:rebuild": "electron-rebuild -f -w node-pty better-sqlite3"
+ "rebuild:native": "pnpm rebuild better-sqlite3 node-pty"
```

Update README and CLAUDE.md to use the new name and explain why. Keep `@electron/rebuild` as a devDependency only if/when the Electron main process starts using native modules directly.

**Option B — Move backend in-process with Electron (bigger, fixes the architectural drift):** Rework `electron/main.mjs` to instantiate the Express server and WebSocket directly in the main process instead of spawning a subprocess. The renderer loads from the same port (`http://localhost:3457` in prod) and everything shares Electron's Node runtime. Then `electron:rebuild` is correct and the ABI never drifts.

Tradeoffs:
- Option A: 5 minutes, no architectural change, keeps subprocess isolation (a crash in the backend doesn't kill the window, but you lose that anyway since the subprocess is also in-tree)
- Option B: 1-2 hours, matches the stated architecture in ARCHITECTURE.md, eliminates a whole class of rebuild confusion, slightly simpler dev flow (one process to watch)

Recommended: **Option A** now (you need dev unblocked), **Option B** as a separate future item when you're doing architectural cleanup.

**Files to touch (Option A):**
- `package.json` — rename script
- `README.md`, `CLAUDE.md` — update rebuild instructions
- `scripts/electron-dev.mjs` — no change needed

**Acceptance:** Fresh clone → `pnpm install` → `pnpm run rebuild:native` → `pnpm run electron:dev` runs without ABI errors. Same command sequence works for anyone pulling the repo.

**Out of scope:** Option B (separate item if/when pursued). Packaging-time rebuild concerns (item 39 handles that separately via electron-builder's `asarUnpack`).

</details>

---

### ~~44. Per-row horizontal scrollbars on diff lines~~ DONE

Fixed via Option A: moved `overflow: auto` to a new `.diffBodyInner` wrapper inside `.diffBody`, dropped `overflow-x: auto` from `.code`, and switched the row grid's last column from `1fr` to `auto`. Rows still stretch to the inner's `min-width: max-content`, so add/remove backgrounds extend across the full scroll area instead of clipping at the visible viewport.

**Symptom:** Each long line in the diff renders its own horizontal scrollbar (see screenshot — multiple thin gray scrollbars appearing under long lines of code). Looks messy and creates visual noise across what should be a clean diff.

**Cause:** `DiffTab.module.css` sets `overflow-x: auto` on `.code` (the individual line's code cell). Every row that's wider than its container renders a scrollbar of its own.

**Fix options:**

**Option A — One container scrollbar (recommended):** Move `overflow-x: auto` from `.code` to the parent container (the hunk body or diff wrapper). Individual rows become `overflow: visible`, and the whole diff scrolls horizontally as a unit. Tradeoff: when scrolled right, all rows shift together — which is what you want for comparing lines.

**Option B — Soft-wrap long lines:** Replace `white-space: pre` with `white-space: pre-wrap` and `word-break: break-all` on `.code`. Long lines wrap to the next visual row. Tradeoff: line numbering gets visually noisy (one logical line spans multiple rendered rows); diff alignment becomes harder to follow.

**Option C — Hide scrollbars but keep scrollability:** Add `scrollbar-width: none` + `::-webkit-scrollbar { display: none }` on `.code`. Users can still scroll via trackpad gesture but no visible bar. Tradeoff: discoverability — users won't know lines are scrollable unless they try.

Recommended: **Option A**. Matches how GitHub, VS Code, and Codex render diffs — single bottom scrollbar for the entire diff pane.

**Files to touch:**
- `dashboard/src/components/review/DiffTab.module.css` — move `overflow-x: auto` from `.code` to the diff body container; ensure the grid layout still aligns rows

**Acceptance:** Open a diff with long lines. Only one horizontal scrollbar appears at the bottom of the diff pane. Scrolling it moves all rows in sync.

**Out of scope:** Redesigning the gutter/sign/code grid layout.

---

### ~~50. HTTP/SSE transport for MCP servers (completes item 6)~~ DONE (shipped in `4a0a0a9`; OAuth layer is item 51)

**Symptom:** After item 6 shipped (stdio MCP integration), HTTP-based MCP servers configured in Claude Code (`~/.claude.json`'s `mcpServers` block where entries have `{type: "http", url: ...}` instead of `{command: ...}`) are silently dropped from import candidates and never spawned. For users whose MCP setup is dominated by hosted services (Sourcegraph, Glean, Context7, Coda, Statsig, Sumologic, Contentful, etc.), this means most of their tooling is invisible to Trellis.

**Cause:** Two interlocking gaps from item 6's stdio-only scope:

1. **Schema** (`src/mcp/config.ts`): `MCPServerConfigSchema` requires `command: z.string().min(1)`. HTTP entries have no `command`, so they fail per-entry validation. Worse, `extractMcpServers()` uses `z.record(MCPServerConfigSchema).safeParse()` which fails the **entire record** if even one entry fails — so the presence of any HTTP server drops *all* top-level entries from import candidates, including valid stdio ones.

2. **Manager** (`src/mcp/manager.ts`): only imports `StdioClientTransport` from the SDK. Even if HTTP entries passed validation, there's no transport implementation to spawn them.

**Why this matters:** HTTP transport is a first-class part of the MCP spec, not an edge case. The official `@modelcontextprotocol/sdk` ships clients for stdio + HTTP+SSE + Streamable HTTP. Hosted SaaS MCP servers almost always use HTTP because it removes the local-install burden, supports server-side auth (OAuth, bearer tokens), and centralizes versioning. Skipping HTTP means Trellis can't reach the majority of an average user's MCP servers.

**Fix:**

1. **Discriminated union schema** in `src/mcp/config.ts`:
   ```ts
   const StdioServerSchema = z.object({
     type: z.literal('stdio').optional(),  // optional for backward compat with v1 stdio-only entries
     command: z.string().min(1),
     args: z.array(z.string()).optional(),
     env: z.record(z.string()).optional(),
     cwd: z.string().optional(),
   });
   const HttpServerSchema = z.object({
     type: z.literal('http'),
     url: z.string().url(),
     headers: z.record(z.string()).optional(),
   });
   const SseServerSchema = z.object({
     type: z.literal('sse'),
     url: z.string().url(),
     headers: z.record(z.string()).optional(),
   });
   export const MCPServerConfigSchema = z.discriminatedUnion('type', [HttpServerSchema, SseServerSchema])
     .or(StdioServerSchema);
   ```
   The `.or(StdioServerSchema)` handles legacy stdio entries that omit `type` entirely.

2. **Per-entry validation** in `extractMcpServers()`: stop calling `z.record(...).safeParse()` on the whole record. Iterate entries, `safeParse` each one individually, skip + log invalid ones, keep the rest. One bad entry no longer drops the whole batch.

3. **Transport router** in `MCPManager.spawnServer()`: switch on `cfg.type` (defaulting to `'stdio'` if absent) and instantiate the right transport:
   - `stdio` → `StdioClientTransport` (existing path)
   - `http` → `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk/client/streamableHttp.js`
   - `sse` → `SSEClientTransport` from `@modelcontextprotocol/sdk/client/sse.js`

4. **HTTP-specific lifecycle**: HTTP transports don't have stdin/stdout/stderr. Adapt the manager's process tracking — no PID, no stderr ring buffer for HTTP servers. Surface "transport: http" + URL + last response status in the Settings UI in place of the stderr toggle.

5. **Settings UI** (`SettingsOverlay.tsx`): edit form swaps fields based on transport type:
   - stdio → command, args, env (current)
   - http/sse → URL, optional headers (key/value pairs)
   - Type selector at the top of the edit form

6. **Auth headers**: many hosted MCP servers need a bearer token. The `headers` field accepts arbitrary key/value pairs — users can set `Authorization: Bearer ...` or whatever the server needs. Keep secrets out of `.mcp.json` itself by supporting `${env:VAR_NAME}` interpolation in header values, resolved at spawn time. Out of scope: full OAuth flows for servers that require dynamic token refresh.

**Files to touch:**
- `src/mcp/config.ts` — discriminated union schema + per-entry validation
- `src/mcp/manager.ts` — transport router, lifecycle adaptations for HTTP
- `dashboard/src/components/settings/SettingsOverlay.tsx` — type-aware edit form
- `dashboard/src/hooks/useWorkspaces.ts` — types for HTTP server payloads

**Acceptance:**
- After fix, `detectClaudeCodeConfigs()` returns all 10 top-level entries from the user's `.claude.json` (8 HTTP + 2 stdio), not 0.
- Importing them all and starting a thread successfully calls a tool from at least one HTTP server (e.g. `mcp__context7__search`).
- Settings → MCP shows transport type per row; edit form swaps fields based on type.
- One bad entry in `.mcp.json` (e.g. `command: ""`) is logged and skipped without dropping the rest.

**Out of scope:**
- OAuth flows that require browser redirects (those need a separate auth-handling item)
- Dynamic token refresh (assume static bearer tokens for now)
- Header value secret-prompting UI (env var interpolation is enough for v1)
- Permissions gating (item 8) — MCP tools still auto-execute regardless of transport

---

### ~~51. OAuth 2.0 client for HTTP MCP servers (auth follow-up to item 50)~~ DONE

**Shipped (2026-04-21):**
- `TrellisOAuthProvider` (`src/mcp/oauth.ts`) with PKCE, DCR, refresh handling, safeStorage persistence via an Electron-main bridge (random port + rotating secret in `~/.trellis/oauth-bridge.json`, 0600).
- Fixed loopback callback on `127.0.0.1:33418`; "Completing authorization…" page polls `/callback-status` and flips only when the backend POSTs `/oauth/exchange-complete` — prevents false-success UI.
- `MCPManager.oauthFlowChain` serializes concurrent Authorize clicks through a single promise so the fixed callback port never collides.
- Discovery state persisted (`saveDiscoveryState` / `discoveryState`) so the SDK's second `auth()` pass reuses the endpoints from the first pass — the missing implementation silently dropped token exchanges.
- **Quiet/interactive provider split** — transports built during session-init use a quiet `TrellisOAuthProvider` that throws a `TRELLIS_OAUTH_REQUIRED` sentinel from `redirectToAuthorization` instead of opening a browser tab. `runAuthorizeServer` builds a separate interactive provider for the manual Authorize path. Without this, a cold-start chat across N unauthorized HTTP servers cascaded N browser tabs and raced on port 33418. `startServer` catches the sentinel and lands the server in a benign "Needs authorization — use Authorize in Settings" error state.
- Callback listener grace after success dropped from 5min → 30s so the next flow can rebind the callback port quickly.
- Cold-start reload bootstraps a transient workspace slot — Reload/Authorize work before any session has touched the workspace.
- Settings UI (Settings → MCP): single contextual auth button per http/sse server — `state === 'ready'` shows Sign-out (LogOut icon), otherwise Authorize (LogIn icon). Reload is hidden on http/sse because Authorize/Sign-out both reload as part of their flow. Stdio cards unchanged. Hooks: `useAuthorizeMcpServer`, `useSignOutMcpServer` with `['mcp-servers']` invalidation.
- Backend routes: `POST /api/mcp/servers/:name/authorize`, `DELETE /api/mcp/servers/:name/authorization`. Introduced a `readStringField(req, field)` helper and removed every `as string | undefined` cast in `src/api/routes.ts`.

**Invariant for future work:** session-init MUST use quiet providers. Any new code path that builds a transport during acquire/reload must respect this or the cascade returns.

**Key commits:** `7a44311` (PR A), `877ad05` (discovery state), `c8b57cf` (serialize + cold-start reload), `55f27a6` (quiet provider), plus PR B (Authorize/Sign-out UI) — current working tree.

---

<details>
<summary>Original spec (historical)</summary>

**Symptom:** After item 50 shipped, calling tools on hosted HTTP MCP servers (Sourcegraph, Glean, Context7, Coda, Statsig, Sumologic, Contentful) fails with:
```
Streamable HTTP error: Error POSTing to endpoint: {"statusCode":401,"statusMessage":"Unauthorized","message":"Unauthorized"}
```
The same servers work in Claude Code with no explicit auth in `.claude.json` — entries are bare `{type: "http", url: "..."}`.

**Cause:** These servers require **OAuth 2.0** (typically the Authorization Code with PKCE flow), not static bearer tokens. The MCP spec defines an authorization handshake: server returns 401 with `WWW-Authenticate: Bearer realm="...", authorization_uri="..."` headers, client initiates an OAuth flow, exchanges authorization code for access token, retries the request with `Authorization: Bearer <token>`. Subsequent requests reuse the cached token; refresh tokens handle expiry.

The official `@modelcontextprotocol/sdk`'s `StreamableHTTPClientTransport` and `SSEClientTransport` both accept an `authProvider` option implementing the `OAuthClientProvider` interface. Trellis instantiates the transports without an `authProvider`, so the SDK has no way to handle 401s — it surfaces them verbatim.

Claude Code implements its own `OAuthClientProvider` that:
1. Opens the system browser to the authorization URL
2. Spins up a temporary local HTTP listener (e.g. `http://localhost:33418/oauth/callback`)
3. Captures the redirect with the authorization code
4. Exchanges code for tokens via the token endpoint
5. Persists tokens via OS keychain
6. Implements refresh-token logic for expiry

**Fix — implement an `OAuthClientProvider` for Trellis:**

1. **New module** `src/mcp/oauth.ts` exporting a `TrellisOAuthProvider` class that implements `OAuthClientProvider`:
   - `redirectUrl()` returns a localhost callback URL on a fixed-or-random free port
   - `clientMetadata()` returns Trellis's client name + redirect URI for dynamic client registration
   - `clientInformation()` reads persisted client_id/client_secret from disk, or returns undefined to trigger registration
   - `saveClientInformation(info)` persists client info per-server
   - `tokens()` reads persisted access/refresh tokens
   - `saveTokens(tokens)` persists tokens via OS keychain (reuse the safeStorage IPC pattern from item 22)
   - `redirectToAuthorization(url)` triggers the browser-open + localhost listener flow
   - `codeVerifier()` / `saveCodeVerifier(verifier)` for PKCE state

2. **Browser-open + callback listener** in `electron/main.mjs` (must run in main process for `shell.openExternal` access):
   - IPC channel `oauth:start-flow` accepts `{ authorizationUrl, redirectPort }`, opens the system browser, spins up a one-shot HTTP server on `redirectPort` listening for the callback, resolves with the captured `code` (and `state` for CSRF check)
   - 5-minute timeout — fail the flow if user doesn't complete
   - Backend's `TrellisOAuthProvider.redirectToAuthorization()` calls this IPC and awaits the code

3. **Token storage** — extend the existing `keys:store/retrieve/delete` IPC to namespace per server (e.g. `mcp:<server-name>:access_token`, `mcp:<server-name>:refresh_token`, `mcp:<server-name>:client_info`). All values still encrypted via `safeStorage`.

4. **Wire into transports** in `MCPManager.spawnServer()`:
   ```ts
   if (cfg.type === 'http' || cfg.type === 'sse') {
     const authProvider = new TrellisOAuthProvider(serverName);
     const transport = cfg.type === 'http'
       ? new StreamableHTTPClientTransport(new URL(cfg.url), { authProvider })
       : new SSEClientTransport(new URL(cfg.url), { authProvider });
   }
   ```
   The SDK handles the rest — it'll call `authProvider.tokens()` first, fall back to the auth flow on 401, and retry transparently.

5. **Settings UI** (`SettingsOverlay.tsx`) per HTTP server:
   - Status pill: "Authorized" / "Not authorized" / "Reauthorizing..."
   - "Authorize" button when not connected — triggers the OAuth flow on demand (otherwise it triggers lazily on first tool call)
   - "Sign out" button — clears tokens for that server, forces re-auth on next request

6. **Refresh handling**: the SDK calls `tokens()` before each request and calls `saveTokens()` after a refresh. If the refresh-token flow itself returns 401, the provider should clear stored tokens and trigger a fresh OAuth flow.

**Files to touch:**
- `src/mcp/oauth.ts` (new) — TrellisOAuthProvider implementation
- `src/mcp/manager.ts` — instantiate authProvider, pass to HTTP/SSE transports
- `electron/main.mjs` — `oauth:start-flow` IPC handler, browser open + localhost callback listener
- `electron/preload.cjs` — expose `oauth:start-flow` to renderer (for settings UI testing)
- `dashboard/src/components/settings/SettingsOverlay.tsx` — auth status + Authorize/Sign-out per server
- `dashboard/src/hooks/useWorkspaces.ts` — types for auth status payloads
- `src/shared/types.ts` — auth status shape

**Acceptance:**
- Click "Authorize" on a Glean server → browser opens to Glean's OAuth page → after granting access, the redirect lands on Trellis's localhost listener and the status flips to "Authorized" without the user touching anything else.
- Calling a tool on that Glean server (e.g. `mcp__glean__search`) succeeds.
- Quit and relaunch Trellis — tokens persist, no re-auth needed.
- After token expiry, the refresh-token flow runs transparently. User notices nothing.

**Out of scope:**
- Importing OAuth tokens from Claude Code's storage as a shortcut (Claude Code stores them in `~/.claude/oauth/` or similar; deciphering its format is brittle and Claude Code can change it. Stick with first-time browser auth in Trellis — it's a one-time tax per server.)
- Servers that require non-OAuth flows (mTLS, API key in a custom header, SAML, etc.) — handle case-by-case via the existing static-headers mechanism from item 50.
- Multi-account support per server — assume one identity per Trellis user per server for v1.

**Risk callouts:**
- **Browser callback security**: the localhost listener should validate `state` parameter against PKCE state, only accept exactly one callback, then shut down. Otherwise other localhost processes could spoof callbacks.
- **Port collision**: random free port via `net.createServer().listen(0)` then `address().port` — register dynamic redirect URI with the OAuth client metadata.
- **MCP spec evolution**: the OAuth spec for MCP is relatively young and evolving. Pin the SDK version once this works.

</details>

---

### ~~53. Center chat list/composer at fixed content width~~ DONE

**What:** Pin chat content to a centered column instead of letting it stretch edge-to-edge in wide windows. Drop the "You" / "Assistant" role labels so the conversation feels less form-like; let the user bubble hug its content rather than spanning the column.

**Why:** Wide-window line lengths hurt readability. Role labels duplicate information already conveyed by bubble styling and alignment, adding noise without clarity.

**Implementation (shipped in `6550c27`):**
- New token `--content-max-width` (960px) on `:root` in `dashboard/src/ui/tokens.css`.
- `dashboard/src/components/chat/ChatMessageList.module.css` and `ChatComposer.module.css` constrain their inner content to `max-width: var(--content-max-width)` and center via `margin-inline: auto`.
- `ChatMessage.module.css` user bubble uses `width: fit-content` so it hugs its text; Edit textarea gets a `min-width` so it stays usable inside the now fit-content user parent.
- `ChatMessage.tsx` removes the `<span>You</span>` / `<span>Assistant</span>` role labels.

**Files touched:** `dashboard/src/ui/tokens.css`, `dashboard/src/components/chat/ChatMessageList.module.css`, `dashboard/src/components/chat/ChatComposer.module.css`, `dashboard/src/components/chat/ChatMessage.module.css`, `dashboard/src/components/chat/ChatMessage.tsx`.

**Acceptance:** Chat content stays at ≤960px in wide windows, centered. User bubble hugs its text. No role labels render. Edit textarea remains usable on a fit-content parent.

---

---

### ~~54. Full-bleed chat shell + icon-only action affordances~~ DONE

**What:** Split the chat list and composer into a full-bleed outer shell + centered inner column so scrollbars and borders run edge-to-edge while content stays at the shared content width. Remove the user-message bottom-right rounding (chat-bubble feel). Render assistant responses directly on the canvas (no bubble). Replace the text Edit / Regenerate buttons with icon-only Pencil / RefreshCw on a dedicated row beneath each message, exposed only on the most recent user / assistant-text message. Match the review-panel toggle to the sidebar's icon-button style with `PanelRightOpen` / `PanelRightClose` icons.

**Why:** The previous layout left visible scroll gutters and stacked the action buttons inline with text, crowding the conversation. Full-bleed scrollbars feel native; icon-only actions on a dedicated row keep the message body clean while remaining discoverable.

**Implementation (shipped in `3d5f58f`):**
- Tokens: bump default radii one step; rename `--content-max-width` → `--content-width`; add companion `--content-padding`.
- `ChatMessageList.tsx` / `ChatComposer.tsx` wrap content in a full-bleed outer + `.inner` (capped at `--content-width` with `--content-padding` gutters).
- `ChatMessage.module.css` drops user-message bottom-right rounding; assistant response renders without a bubble background.
- `ChatMessage.tsx` swaps text Edit / Regenerate for icon-only `Pencil` / `RefreshCw` buttons on a dedicated row beneath the message; only the most recent user / assistant-text message exposes them.
- `Sidebar.tsx` review-panel toggle adopts the sidebar icon-button style and uses `PanelRightOpen` / `PanelRightClose` from lucide-react.

**Files touched:** `dashboard/src/ui/tokens.css`, `dashboard/src/components/chat/ChatPanel.{tsx,module.css}`, `dashboard/src/components/chat/ChatMessageList.{tsx,module.css}`, `dashboard/src/components/chat/ChatComposer.{tsx,module.css}`, `dashboard/src/components/chat/ChatMessage.{tsx,module.css}`, `dashboard/src/components/sidebar/Sidebar.tsx`.

**Acceptance:** Scrollbars run edge-to-edge; content sits within `--content-width` gutters. Edit/Regenerate icons appear only on the most recent user/assistant-text message. Review-panel toggle matches sidebar icon-button styling.

---

### ~~34. Image paste / drop in composer~~ DONE

Shipped: paste/drop images into the composer, two-step upload via `POST /threads/:id/images` (multer/memoryStorage with 5 MB / 10-images caps and PNG/JPEG/GIF/WebP allowlist), files persisted at `~/.trellis/images/<threadId>/<uuid>.<ext>` and served immutably at `/files/images/...`. Messages gain an `images TEXT` JSON column; the session runner lazily base64-encodes attachments per turn and feeds them through Anthropic / OpenAI / Custom (`image_url` / `image` blocks before text) and Ollama (model-level `images: string[]`). Chat history renders a lazy-loaded image grid above user-text bubbles (click → new tab); `deleteThread` recursively removes the per-thread image dir.

<details>
<summary>Original spec</summary>

**What:** Paste an image from clipboard or drag-drop from Finder into the composer. Image attaches to the user message and is sent to the LLM as a vision input. After send, the image renders inline in chat history and survives app restart.

**Why:** Reviewing UI screenshots, design mockups, error dialogs — all faster as images than descriptions. Anthropic and OpenAI both support image input natively; we pay nothing extra at the API layer to enable this. Frequent use case during dogfooding (UI work, "why does this look wrong", layout questions).

#### Data model

**On-disk layout:** images live at `~/.trellis/images/<threadId>/<uuid>.<ext>` (the existing `~/.trellis/` data dir from `src/index.ts:14`). The backend Express server serves them as static assets at `/files/images/<threadId>/<uuid>.<ext>`. Images persist for the life of the thread; deleted with the thread via cascade (handled at the FS level — extend `deleteThread` in `store.ts` to `rm -rf` the thread's image dir).

**SQLite:** add an `images` column to `messages` storing JSON `string[]` of paths relative to the trellis dir (e.g. `["images/<threadId>/<uuid>.png"]`). Use the existing idempotent ALTER pattern at `src/db/store.ts:115`:

```ts
try {
  this.db.exec('ALTER TABLE messages ADD COLUMN images TEXT');
} catch (err) {
  if (!(err instanceof Error) || !err.message.includes('duplicate column')) throw err;
}
```

`Message` type gains `images: string[] | null` (parsed from JSON on read; null when no images).

**LLMMessage type:** extend `src/shared/types.ts:138` with an optional `images?: Array<{ mediaType: string; data: string }>` field (base64 data + media type). Adapters consume this; the DB layer never sees base64 — paths only.

#### Backend flow

1. **Upload endpoint:** `POST /api/threads/:threadId/images` accepts `multipart/form-data` with one or more `image` fields. For each upload:
   - Validate `Content-Type` matches one of `image/png`, `image/jpeg`, `image/gif`, `image/webp` (the four formats Anthropic + OpenAI both accept). Reject anything else with 415.
   - Cap individual file size at **5 MB** (Anthropic's per-image limit). 413 if exceeded.
   - Cap total per-message images at **10**.
   - Generate `uuid`, infer extension from media type, write to `~/.trellis/images/<threadId>/<uuid>.<ext>`.
   - Return `{ paths: string[] }` where each path is relative to `~/.trellis/` (same form stored in DB).

   Use `multer` (already a transitive dep via Express ecosystem; add explicitly if not). Configure with `memoryStorage()` so we control the write — don't let multer dump to `/tmp` and then move.

2. **Static serving:** mount `express.static('~/.trellis/images')` at `/files/images` in `src/api/server.ts`. Set `Cache-Control: public, max-age=31536000, immutable` (paths are uuid-stamped).

3. **Send-message API:** `POST /api/threads/:threadId/messages` body extends to `{ content: string; images?: string[] }`. The `images` array contains paths returned from the upload endpoint. Store them as JSON in the new `images` column. Empty/missing → store NULL.

4. **Session runner:** when building the LLM history, for any user `Message` with non-null `images`, read each file from disk → base64 encode → attach as `LLMMessage.images: [{ mediaType, data }]`. Read happens lazily per-run — don't preload at startup. If a file is missing (user deleted manually), log a warning and skip that image; don't crash.

5. **Adapter conversion:**
   - **Anthropic** (`src/llm/anthropic.ts:133` `convertMessages`): when a user `LLMMessage` has `images`, change the content from a string to an array: `[...images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })), { type: 'text', text: msg.content }]`. Image blocks come **before** text — Anthropic's recommendation.
   - **OpenAI** (`src/llm/openai.ts:127` `convertMessages`): same idea, content becomes `[...images.map(img => ({ type: 'image_url', image_url: { url: \`data:${img.mediaType};base64,${img.data}\` } })), { type: 'text', text: msg.content }]`. Order: images then text.
   - **Ollama** (`src/llm/ollama.ts`): only specific Ollama models support vision (llava, etc.). Pass `images: string[]` (base64 strings without data URI prefix) on the message — Ollama's API supports this on its `/api/chat` endpoint when the model is multimodal. Non-multimodal models will error from the server side; we surface the error as-is.
   - **Custom** (`src/llm/custom.ts`): assume OpenAI-compatible — same payload shape as OpenAI.

6. **Thread deletion:** in `store.deleteThread` (or wherever cascade cleanup runs), recursively remove `~/.trellis/images/<threadId>/`. Use `fs.rm(path, { recursive: true, force: true })`.

#### Frontend flow

1. **`ChatComposer.tsx`** (`dashboard/src/components/chat/ChatComposer.tsx`):
   - Add local state `attachments: Array<{ id: string; file: File; previewUrl: string }>` (`previewUrl` from `URL.createObjectURL` for thumbnail rendering; revoked on remove/send).
   - `onPaste` handler on the textarea: read `e.clipboardData.items`, filter for `kind === 'file'` with `type.startsWith('image/')`, append as attachments.
   - `onDrop` handler on the composer container (also handle `onDragOver`/`onDragEnter` to show a drop highlight): read `e.dataTransfer.files`, filter for image MIME types, append.
   - Reject files >5 MB or unsupported types client-side with an inline error message above the thumbnail strip (auto-clears after 4s).
   - **Thumbnail strip:** new sub-component `AttachmentStrip` rendered above the textarea inside `inputWrap`. Each thumb is a 64×64 square with the preview, an "X" remove button on hover, and a faint border using existing tokens (`var(--border-subtle)`).
   - **Send flow:** `handleSubmit` becomes async. If attachments exist:
     1. POST them via FormData to `/api/threads/:threadId/images`, get back paths.
     2. Then POST to `/api/threads/:threadId/messages` with `{ content, images: paths }`.
     3. Revoke object URLs, clear attachments.
   - If only text (no attachments), keep current behavior (the existing single POST).
   - Disable Send button while uploads are in flight; show a small spinner inside the stop-button slot.
   - Drop zone visual: when dragging over composer, render a dashed border + "Drop image to attach" overlay using `var(--accent-subtle)` background.

2. **`ChatMessage.tsx`** (`dashboard/src/components/chat/ChatMessage.tsx`):
   - When rendering a user message with `message.images`, render an image grid above the text content. Use `<img src="/files/images/..." />` (the static-serving path). Click image → open in new tab/lightbox (v1: just `window.open(src)`).
   - Grid layout: max 3 per row, max 200px wide each, `object-fit: cover` for thumbnails. Lazy-load (`loading="lazy"`).
   - Edit flow: editing a message **does not** edit attachments in v1 — the attachment set is frozen at send time. The Edit button still works on text. Document this limitation in a comment near the EditBox.

3. **API client** (`dashboard/src/hooks/useWorkspaces.ts` or wherever the existing send-message mutation lives): extend the mutation input shape and add an `uploadImages(threadId, files): Promise<string[]>` helper.

4. **`Message` type sync:** the `images` field on the shared type flows through; the dashboard reads it via the existing `/api/threads/:id/messages` GET.

#### Files to touch

- `src/shared/types.ts` — add `images: string[] | null` to `Message`; add `images?: Array<{mediaType, data}>` to `LLMMessage`.
- `src/db/store.ts` — ALTER for `images` column; serialize/deserialize JSON in create/list/get; FS cleanup in `deleteThread`.
- `src/api/routes.ts` — new `POST /threads/:threadId/images` route; extend send-message route to accept `images: string[]`.
- `src/api/server.ts` — mount static `/files/images`; ensure dir exists on startup.
- `src/session/runner.ts` (or wherever LLM history is assembled — confirm exact filename) — read image bytes, base64 encode, populate `LLMMessage.images`.
- `src/llm/anthropic.ts`, `src/llm/openai.ts`, `src/llm/ollama.ts`, `src/llm/custom.ts` — image content conversion in each adapter.
- `dashboard/src/components/chat/ChatComposer.tsx` (+ `.module.css`) — paste/drop handlers, attachment state, thumbnail strip, drop overlay, two-step send.
- `dashboard/src/components/chat/ChatMessage.tsx` (+ `.module.css`) — render image grid above user message text.
- `dashboard/src/components/chat/AttachmentStrip.tsx` (new, + `.module.css`) — composer thumbnail UI.
- `dashboard/src/hooks/useWorkspaces.ts` (or current send-message hook) — multipart upload helper, mutation shape change.
- `package.json` — add `multer` if not present.

#### Acceptance

1. Paste a PNG screenshot from clipboard into the composer → thumbnail appears above the textarea.
2. Drag a JPEG from Finder onto the composer → drop overlay shows, then thumbnail appears.
3. Hover thumbnail → X appears → click removes it.
4. Send a message with one image and the text "what's in this image" using an Anthropic model → assistant response describes the image content correctly.
5. Same flow with an OpenAI model → also works.
6. Send a message with 3 images → grid renders correctly in chat history.
7. Quit the app, reopen, navigate to the thread → images still render (served from static path, file present on disk).
8. Delete the thread → image directory at `~/.trellis/images/<threadId>/` is removed.
9. Drop a `.txt` file → rejected with inline error "Only image files are supported".
10. Drop a 10 MB image → rejected with inline error "Image too large (max 5 MB)".
11. Edit a sent message that has images → text edits work; image set is unchanged.

#### Out of scope

- Video, PDF, audio, or non-image attachments.
- Image editing/cropping in the composer.
- Lightbox modal (v1 = open in new tab on click).
- Editing attachments after send (only text editable).
- Image attachments on assistant messages (LLMs return text/tool-use; not attaching images of their own).
- Per-image alt text or captions.
- Compression / resizing on upload (let users send full quality; cap is 5 MB).
- Dragging URLs from a browser tab (only File items from `dataTransfer.files`).

</details>

---

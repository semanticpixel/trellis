# Trellis — Plan (Dogfooding Improvements)

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

### Done items

Done items live in [`PLAN-DONE.md`](./PLAN-DONE.md). When an item ships, mark it `~~DONE~~` in the priority-tier index below, then move its full block to the archive. The index here is the manifest of every item ever planned; the archive holds the spec history.

### Priority tiers

- **P0 — Daily blockers.** Bugs you hit every session, or missing features that cause data loss. Items 1 (state persistence — DONE), 2 (abort button — DONE), 4 (startup recovery — DONE), 5 (unread indicator — DONE), 20 (tool call bars — DONE), 21 (Monaco error — OBSOLETE: Monaco removed by item 27), 23 (Cmd+` zoom — DONE), 24 (stale annotations — DONE), 30 (abort leak — DONE), 32 (draft persistence — DONE), 33 (error boundaries — DONE).
- **P1 — High-value features.** New capabilities that unlock workflows. Items 3 (workspace context file), 6 (MCP — stdio DONE, HTTP/SSE in item 50, OAuth in item 51), 7 (plan mode), 10 (@-mentions — DONE), 26 (AskUserQuestion), 27 (sleek diff/terminal — DONE), 28 (text-range plan annotations), 34 (image paste), 35 (commit message gen), 50 (HTTP/SSE MCP transport — DONE), 51 (OAuth for HTTP MCP — DONE).
- **P2 — Nice polish.** Quality-of-life. Items 8 (permissions), 9 (Claude settings import), 11 (edit/regenerate — DONE), 12 (LLM titles — DONE), 13 (cost display), 14 (Cmd+K — DONE), 15 (arrow nav), 16 (auto-focus composer — DONE), 22 (app branding — DONE), 25 (terminal tab — SKIPPED, superseded by 27), 31 (thread export), 36 (shortcut reference — DONE), 38 (group tool calls).
- **P3 — Hygiene / future.** Items 17 (extend Cmd+1-9 — DONE), 18 (duplicate shadow token — DONE), 19 (hardcoded color — DONE), 29 (rotating welcome — DONE), 37 (tests), 39 (packaged distribution), 40 (@electron/rebuild migration — DONE), 41 (unread entry cleanup — DONE), 42 (rebuild target mismatch — DONE), 43 (backend in-process with Electron), 44 (diff scrollbars — DONE), 45 (theme-aware Shiki), 46 (binary + CRLF polish — DONE), 47 (virtualize file list — candidate for SPECULATIVE if unused), 48 (Cmd+K focus guard), 53 (centered chat content width — DONE), 54 (full-bleed chat shell + icon actions — DONE).

### Dependency graph

Some items share infrastructure or unblock others. Do the upstream item first.

- **Context-snippet anchoring** — item 24 (DONE — see [PLAN-DONE.md](./PLAN-DONE.md)) shipped the shared anchoring module in `src/review/anchoring.ts`; item 28 should reuse it for plan annotations.
- **MCP + permissions** — item 6 (DONE — see [PLAN-DONE.md](./PLAN-DONE.md)) shipped the Settings tab scaffolding; item 8 (permissions UI) builds on it.
- **Session recovery** — item 4 (DONE — see [PLAN-DONE.md](./PLAN-DONE.md)) established the resume-orphaned-state-on-startup pattern; item 26 (pending user inputs) should reuse it.

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

- Always start a session with `@CLAUDE.md @PLAN.md` and a specific item number
- For polish-only sessions (batching visual/interaction papercuts), reference `@UX_POLISH.md` instead — lower-bar observations live there, not in this file
- If an item is large, split into sub-items (N.1, N.2) in-place before starting
- Mark items done by striking through the title (`### ~~NN. Title~~ DONE`) and adding a one-line recap
- If you discover new work while implementing, add it as a new item rather than scope-creeping the current one
- If you spot a visual papercut mid-session (e.g. "that button's misaligned"), log it in UX_POLISH.md instead of the current PR so the batch stays clean

---

## Priority — things that'll bite you repeatedly

### 3. Workspace-level context file

Every thread starts fresh with the same default system prompt. Add a per-workspace persistent context file (coding conventions, architecture notes, gotchas) that's prepended to every thread's system prompt.

- Store as `.trellis-context.md` in the workspace root (like CLAUDE.md)
- Editable from a new "Context" tab in the workspace context menu (see v2 item 1)
- Loaded by `SessionRunner` at the start of each run and prepended to system prompt
- Per-thread `system_prompt` still layers on top

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

### 13. Cost / token display

`UsageData` tracks input/output/cache tokens per session. Surface them:
- Running total per thread in the chat header (small, subtle)
- Per-message tokens on hover (already stored in `messages.token_count`)
- Aggregate cost per workspace in Settings → Workspace

Use provider pricing tables in a constants file; fall back gracefully for Ollama/custom (no cost).

## Small polish

### 15. Arrow key navigation in sidebar

Up/Down to move between threads, Enter to select. Standard tree navigation.

## Bugs found while dogfooding

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

### 43. Move backend in-process with Electron main

**Symptom (latent):** `ARCHITECTURE.md` describes the backend as "running in-process with Electron main," but `scripts/electron-dev.mjs` actually spawns it as a separate `tsx` subprocess under system Node. That drift is what produced the rebuild confusion fixed in item 42 — the docs say one thing, the code does another, and any future native-module work has to keep tracking which Node ABI applies to which process. Other latent costs:

- Two processes to supervise during dev (Electron + the tsx subprocess) — backend crashes leave a zombie window with no chat.
- The renderer talks to the backend over `localhost:3457` HTTP/WS rather than direct IPC, which is fine but unnecessary indirection given they live in the same app.
- Packaging has to ship and launch a Node runtime alongside Electron, or rely on Electron's bundled Node from a subprocess — easy to get wrong (see item 39).

**Cause:** Historical — the backend was scaffolded as a standalone Express server before Electron was added, and the subprocess approach kept the dev story simple at the time.

**Fix:** Rework `electron/main.mjs` (or a new `electron/main.ts` if we want type-checking) to instantiate the Express app and WebSocket server directly in the main process at startup, instead of spawning `tsx`. Concretely:

1. Convert backend entrypoint into a callable factory: extract the Express + WS bootstrap from `src/index.ts` into `src/server.ts` exporting `startServer({ port, dbPath }): Promise<{ stop(): Promise<void> }>`. Keep `src/index.ts` as a thin CLI shim that calls the factory (so `pnpm run dev:server` still works for backend-only dev).
2. In `electron/main.mjs`, `await startServer(...)` before `createWindow()`. Pass the resolved port into `loadURL`.
3. Update `scripts/electron-dev.mjs` to stop spawning the tsx subprocess. Vite still runs separately for the dashboard HMR; Electron just imports the backend.
4. Confirm `better-sqlite3` and `node-pty` load under Electron's ABI — at this point we *do* want `@electron/rebuild` back, since native modules now live in Electron's process. Re-add it as a devDep and restore (or rename) the script.
5. Update `ARCHITECTURE.md` to drop the historical-context note about the subprocess; it now matches reality.
6. Update `README.md` and `CLAUDE.md`: `pnpm run electron:dev` is now the single entrypoint and there's no separate backend log stream.

**Tradeoffs:**
- Pro: matches stated architecture, eliminates a whole class of ABI confusion, simpler dev process tree, packaging story collapses to "just ship Electron."
- Pro: renderer ↔ backend can optionally move to direct IPC later (faster, no port conflicts), though HTTP/WS is fine to keep for now.
- Con: backend errors crash the whole app instead of just the subprocess. Add a top-level `process.on('uncaughtException')` in main to log + show an error dialog rather than silently dying.
- Con: hot-reload of backend code requires restarting Electron (the tsx subprocess gave us free `tsx watch`). Acceptable trade — backend changes are less frequent than dashboard changes, and dashboard HMR is unaffected.

**Files to touch:**
- `src/index.ts` → split into `src/server.ts` (factory) + `src/index.ts` (CLI shim)
- `electron/main.mjs` — import and start the server before window creation; add uncaught-exception handler
- `scripts/electron-dev.mjs` — drop the tsx subprocess
- `package.json` — restore `@electron/rebuild` devDep, add or rename `electron:rebuild` script targeting Electron's ABI
- `ARCHITECTURE.md`, `README.md`, `CLAUDE.md` — reflect new process model

**Acceptance:** `pnpm run electron:dev` starts a single process (Electron) with the backend running inside main; only Vite is a sibling. `better-sqlite3` and `node-pty` work without ABI errors after `pnpm install` + `pnpm run electron:rebuild`. ARCHITECTURE.md's process-model description matches the code.

**Out of scope:** Migrating renderer transport from HTTP/WS to Electron IPC (separate optimization item if/when latency or port conflicts become a problem). Packaging changes (item 39) — but this work makes that item simpler since there's no separate Node runtime to ship.

## Item 27 follow-ups (diff renderer polish)

### 45. Theme-aware Shiki highlighter

**Symptom:** Shiki theme is hardcoded to `github-dark` in `dashboard/src/utils/highlighter.ts`. Even when the app is in light mode (via OS preference or the explicit theme toggle from item 22), code blocks and the diff view stay dark.

**Cause:** The highlighter was introduced in item 27 with a single theme constant. No coupling to the app's theme state.

**Fix:**
1. Load **both** `github-light` and `github-dark` themes in the highlighter. Shiki supports multiple themes loaded into one instance.
2. In `highlightCode()` (and wherever it's called), accept a theme parameter: `'light' | 'dark'`.
3. Read current theme from the existing theme state (look at where `data-theme` is set on `:root` for the CSS token swap — probably in `useTheme.ts` or similar).
4. Pass the resolved theme into `highlightCode()`. When the theme changes, re-highlight visible code (easy: add theme to the `useMemo` / `useEffect` dep array in `DiffTab` and `ShikiCodeBlock`).
5. Loading both themes adds ~100KB. Lazy-load them in parallel on first use.

**Files to touch:**
- `dashboard/src/utils/highlighter.ts` — support both themes
- `dashboard/src/components/review/DiffTab.tsx` — pass theme, add to effect deps
- `dashboard/src/components/chat/ChatMessage.tsx` — same for `ShikiCodeBlock`
- Possibly `dashboard/src/hooks/useTheme.ts` if a hook exists for theme state

**Acceptance:** Toggle theme in Settings → diff view and chat code blocks switch color schemes without reload. OS-level prefers-color-scheme changes also reflect.

**Out of scope:** Custom theme support (e.g. loading user-provided TextMate themes). Per-language theme overrides.

### 46. Small diff renderer polish (binary files + CRLF)

Two tiny gaps from the item 27 audit, bundled together:

**A. Binary file placeholder.** When `ParsedDiffFile.isBinary === true`, the diff body currently renders as empty. Show a placeholder row instead: `Binary file — diff not displayed`. Muted color, centered, with a small icon.

**B. CRLF normalization.** `diffParser.ts` splits on `\n` only, leaving trailing `\r` on CRLF-originated lines. Shows as phantom trailing whitespace. Normalize at parse time:
```ts
const lines = patch.split('\n').map((l) => l.endsWith('\r') ? l.slice(0, -1) : l);
```

**Files to touch:**
- `dashboard/src/components/review/DiffTab.tsx` — binary placeholder rendering
- `dashboard/src/utils/diffParser.ts` — CRLF strip at split time

**Acceptance:** Open a diff with a binary file (e.g. add an image) — see the placeholder. Open a diff with CRLF-origin files — no trailing whitespace artifacts.

**Out of scope:** Rendering image diffs visually (before/after). Encoding detection beyond CRLF.

### 47. Virtualize DiffFileList for large change sets

**Symptom:** A diff with 100+ changed files renders all file entries as DOM nodes in the file list. Scrolling gets janky and initial render takes a beat on older hardware or when many annotations are present.

**Cause:** `DiffFileList` renders the full list. No virtualization.

**Fix:** Introduce a small virtualization library (`react-virtuoso` or `@tanstack/react-virtual`) and render only visible rows + a small overscan. File list becomes fixed-height-per-row (already is) with lazy hydration.

**Trigger:** Only bother if you actually start hitting diffs with 50+ files during dogfooding. For typical LLM sessions that touch 1-10 files, this is premature. **Move to SPECULATIVE_FEATURES.md if it doesn't bite in the next month.**

**Files to touch:**
- `dashboard/src/components/review/DiffFileList.tsx` — swap list rendering for virtual list
- `dashboard/package.json` — add virtualization lib

**Acceptance:** A 500-file diff renders the initial view in <100ms and scrolls at 60fps.

**Out of scope:** Virtualizing the diff body (individual hunks) — that's a separate, larger concern.

### 48. Add focus guard to Cmd+K sidebar search shortcut

**Symptom:** Pressing Cmd+K while typing in another input (a modal textarea, the sidebar search itself, the composer) steals focus to the sidebar search. The original brief for item 14 said "should not steal focus from other inputs," but the shipped handler has no guard.

**Cause:** The Cmd+K handler in `App.tsx` calls `preventDefault()` and forcibly focuses the sidebar search input without checking the current focus context. Item 16 (auto-focus composer) uses the right pattern — it skips focus if `document.activeElement` is an INPUT / TEXTAREA / contenteditable element.

**Fix:** Add a guard before the Cmd+K focus call:

```ts
if (meta && e.key === 'k' && !e.shiftKey) {
  const ae = document.activeElement as HTMLElement | null;
  const inEditable =
    ae &&
    (ae.tagName === 'INPUT' ||
      ae.tagName === 'TEXTAREA' ||
      ae.isContentEditable);
  // If already in an editable element, only hijack when it's the sidebar search itself
  // (toggle-off behavior), otherwise let the keystroke pass through.
  if (inEditable && ae !== sidebarSearchRef.current) return;
  e.preventDefault();
  sidebarSearchRef.current?.scrollIntoView(...);
  sidebarSearchRef.current?.focus();
}
```

**Files to touch:**
- `dashboard/src/App.tsx` — add the focus guard around the Cmd+K handler

**Acceptance:** Type in a modal textarea → press Cmd+K → focus stays in the textarea, no jump. Press Cmd+K while focused anywhere non-editable (message list, sidebar tree) → sidebar search focuses. Pressing Cmd+K while already in sidebar search → no-op (already focused).

**Out of scope:** Reworking Cmd+K to toggle the search open/closed. Making other global shortcuts guard similarly — only the explicit regression from item 14's brief is in scope here.

### 52. Collapse long user messages with Show more / Show less

**Why:** Pasting a long file, log, or prompt into chat produces a wall of text that dominates the thread and pushes subsequent turns off-screen. Scrolling past the same pasted block every time you revisit the thread is friction. Cursor / Claude.ai / ChatGPT all cap tall user messages and surface a Show more toggle — feels standard once you notice it's missing.

**Shape:** Cap the visible height of user messages at ~20 lines (roughly 400px at current line-height). If content exceeds the cap, render a soft fade-out gradient over the last ~40px and a `Show more` control below the bubble. Click → expands to full height, control flips to `Show less`. State is per-message, lives in component state (not persisted — re-collapse on thread reopen is acceptable for v1).

Applies to **user** messages only. Assistant messages are streamed markdown and may contain code blocks the user actively needs to read; collapsing them hurts more than it helps. Users can collapse their own prompt ideas; assistant output stays open.

**Frontend:**

- New component `CollapsibleUserText.tsx` in `dashboard/src/components/chat/` — wraps `UserMessageContent`.
  - Measures content height via a `useLayoutEffect` + `ResizeObserver` on mount and when `text` changes.
  - If measured height > `MAX_COLLAPSED_PX` (say 400), clamp via `max-height` + `overflow: hidden` and render the fade + toggle.
  - Fade: a `::after` absolute gradient from transparent to the bubble bg (`var(--bg-message-user)`), 40px tall, pointer-events none.
  - Toggle: small text button below the bubble in the action row — lives in the same hover-reveal slot as Edit. Always visible (not hover-only) when the message is collapsible, so users see it without exploration.
- `ChatMessage.tsx` — wrap user content in `CollapsibleUserText`; keep `FileMention` tokenization inside.
- `ChatMessage.module.css` — collapsed state class with `max-height` + `overflow: hidden` + the fade pseudo-element.

**No backend changes.**

**Files:**
- New: `dashboard/src/components/chat/CollapsibleUserText.tsx` + `.module.css`
- Modified: `dashboard/src/components/chat/ChatMessage.tsx` (swap raw `<UserMessageContent />` for the collapsible wrapper)
- Modified: `dashboard/src/components/chat/ChatMessage.module.css` (fade/overflow rules)

**Acceptance:**
1. Paste a 50-line block into composer, send. The rendered user bubble is capped at ~20 lines with a fade and `Show more` below it.
2. Click `Show more` → bubble expands to full content; toggle flips to `Show less`.
3. Click `Show less` → re-collapses.
4. Short messages (under the cap) render normally with no toggle and no fade.
5. Edit a long message → inline textarea opens (Edit flow unchanged); after save, new content measures again and the toggle appears or disappears based on the new length.
6. Fade matches the user bubble background in both light and dark themes (no hardcoded color).
7. Toggle is keyboard-accessible (native `<button>`, focusable, Enter activates).

**Out of scope:**
- Collapsing assistant messages.
- Remembering expanded state across reloads.
- Smart cap (e.g. "collapse only if there's later content"). Always-cap is simpler and predictable.
- Collapsing tool-call blocks — covered separately by item 38.

**Risk callouts:**
- **Measurement on mount**: content height depends on fonts loading, `@`-mention pill widths, etc. Using `ResizeObserver` after initial paint avoids flashes where a short-looking message briefly shows a toggle.
- **Edit flow interaction**: when the inline editor is open, bypass the collapse entirely so the user sees the full text while editing. The collapsible wrapper should only apply in the non-edit render path.

---

## Known debt (carried from v2)

- Terminal uses `workspaceId` as `threadId` in WS messages — works but bends the envelope spec
- Terminal sessions don't persist across close/reopen — reopening starts fresh

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
- **P1 — High-value features.** New capabilities that unlock workflows. Items 3 (workspace context file), 6 (MCP — stdio DONE, HTTP/SSE in item 50, OAuth in item 51), 7 (plan mode), 10 (@-mentions — DONE), 26 (AskUserQuestion), 27 (sleek diff/terminal — DONE), 28 (text-range plan annotations), ~~34 (image paste — DONE)~~, 35 (commit message gen), 50 (HTTP/SSE MCP transport — DONE), 51 (OAuth for HTTP MCP — DONE).
- **P2 — Nice polish.** Quality-of-life. Items 8 (permissions), 9 (Claude settings import), 11 (edit/regenerate — DONE), 12 (LLM titles — DONE), 13 (cost display), 14 (Cmd+K — DONE), 15 (arrow nav), 16 (auto-focus composer — DONE), 22 (app branding — DONE), 25 (terminal tab — SKIPPED, superseded by 27), 31 (thread export), 36 (shortcut reference — DONE), 38 (group tool calls).
- **P3 — Hygiene / future.** Items 17 (extend Cmd+1-9 — DONE), 18 (duplicate shadow token — DONE), 19 (hardcoded color — DONE), 29 (rotating welcome — DONE), 37 (tests), 39 (packaged distribution), 40 (@electron/rebuild migration — DONE), 41 (unread entry cleanup — DONE), 42 (rebuild target mismatch — DONE), 43 (backend in-process with Electron), 44 (diff scrollbars — DONE), 45 (theme-aware Shiki), 46 (binary + CRLF polish — DONE), 47 (virtualize file list — candidate for SPECULATIVE if unused), 48 (Cmd+K focus guard), 53 (centered chat content width — DONE), 54 (full-bleed chat shell + icon actions — DONE), ~~55 (CSS logical properties + Stylelint)~~, ~~56 (initial GitHub Actions CI)~~, 57 (CSS cascade layers reorg), 58 (design system primitives).

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

**What:** Mirror Claude Code's plan mode. A per-thread toggle that forces the LLM into "propose before executing." When on, the model can read but cannot write — its final response is saved as the thread's plan, surfaced in the existing Plan tab for annotation, and only executes after explicit user approval.

**Why:** For non-trivial changes the cost of letting the LLM run wild is wasted token spend, broken trees, and rework. A "plan first, then act" mode lets the user catch a wrong direction before any file is touched. It also reuses the Plan tab + annotation system already built — turning that surface from a static `.trellis-plan.md` viewer into the live review surface for in-progress work.

#### How it works (user-facing)

- Composer has a **Plan mode** toggle button next to Send. Keyboard shortcut **`Shift+Tab`** mirrors Claude Code.
- When active:
  - Composer placeholder changes to *"Describe what you want to build (plan mode)"*
  - A small **Plan mode** pill appears in the chat header (workspace-color background, neutral text) so it's obvious you're in this mode
  - On send, the LLM streams normally into chat, but the runner constrains its tool set and system prompt
  - When the assistant emits a final text turn (no more tool calls), the runner writes that text to `.trellis-plan.md` in the repo root and broadcasts a refresh
  - Review panel auto-switches to the **Plan** tab so the proposal is visible immediately
- User reviews + annotates the plan in the Plan tab (existing flow). Two new affordances appear in the Plan tab header **only while the thread is in plan mode**:
  - **Approve & execute** — exits plan mode, starts a new run with the full tool set + the approved plan injected as a system note
  - **Revise** — sends accumulated annotations as feedback, runner stays in plan mode, new revision streams in
- Approve & execute is disabled while a run is in flight or while there are unresolved annotations.

#### Schema

Add to the `threads` table via the same idempotent ALTER pattern at `src/db/store.ts:115`:

```ts
try {
  this.db.exec("ALTER TABLE threads ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0");
} catch (err) {
  if (!(err instanceof Error) || !err.message.includes('duplicate column')) throw err;
}
```

Update `Thread` interface in `src/shared/types.ts:26` with `plan_mode: number` (0 or 1; we keep numeric to match existing SQLite booleans like `Annotation.resolved`). Add `setThreadPlanMode(threadId, planMode: 0 | 1)` to the store.

#### Backend — runner changes

In `src/session/runner.ts`:

1. **Tool gate.** After `const toolDefs = [...getToolDefinitions(), ...mcpTools];` (line 67), if `thread.plan_mode === 1`, filter to a read-only allowlist:
   ```ts
   const READ_ONLY_TOOL_ALLOWLIST = new Set(['read_file', 'list_files', 'search_files']);
   const filteredToolDefs = thread.plan_mode
     ? toolDefs.filter(t => READ_ONLY_TOOL_ALLOWLIST.has(t.name))
     : toolDefs;
   ```
   MCP tools are filtered OUT in plan mode (we can't audit their side-effect surface). Document this in the spec; if a user has a strictly-read-only MCP tool they want exposed in plan mode, that's a follow-up item.

2. **System prompt.** Extend `buildDefaultSystemPrompt` to take `planMode: boolean` and append a plan-mode addendum when true:
   ```
   You are currently in PLAN MODE.
   - DO NOT modify any files. You only have read tools available.
   - Your job is to investigate the codebase and propose a concrete plan.
   - End your response with the proposed plan as the final assistant message.
   - The plan will be saved to .trellis-plan.md and reviewed by the user before any execution.
   - Structure the plan as numbered steps so the user can comment on each step.
   ```
   When the user has set a custom `thread.system_prompt`, **still append the plan-mode addendum** if `plan_mode = 1`. The two layer.

3. **Capture final assistant text → write `.trellis-plan.md`.** When the runner exits the tool loop in plan mode and the last assistant message is a text turn, write its content to `<repoPath>/.trellis-plan.md`. Use `writeFile` from `fs/promises`. Broadcast a new WS event `plan_updated` (add to `WSEventType`) with `{ repoId }` so the dashboard can re-fetch via the existing `usePlan(repoId)` hook. Workspace-only threads (no `repo_id`) — write to `<workspacePath>/.trellis-plan.md` instead.

4. **Skip if no text turn.** If the assistant only emitted tool calls and no final text (shouldn't happen, but defend), don't write the plan file — just leave the thread as-is.

#### Backend — API changes

In `src/api/routes.ts`:

1. **PATCH thread plan_mode** — extend the existing `PATCH /threads/:id` route to accept `plan_mode: 0 | 1`. Reject the toggle if the thread is currently `running`; user must wait for the in-flight session to settle first.

2. **POST /threads/:threadId/approve-plan** — new route:
   ```ts
   router.post('/threads/:threadId/approve-plan', async (req, res) => {
     // 1. Verify thread exists, is in plan_mode, status !== running
     // 2. Read the current .trellis-plan.md
     // 3. Set plan_mode = 0
     // 4. Append a system-style user message: "Plan approved. Execute the plan above."
     //    plus the plan content (this is what the runner sees on the next loop)
     // 5. Trigger a new session via sessionManager.startSession(threadId)
     // 6. Mark all plan_step annotations on this thread resolved (the plan is now committed)
     // 7. Return 202
   });
   ```

3. **Reuse existing `/send-feedback`** for the Revise action. The PlanTab already creates `plan_step` annotations; sending them back to the LLM with `plan_mode = 1` keeps the runner constrained to read tools, and the model produces a revised plan. No new endpoint needed for revise.

#### Frontend — composer

In `dashboard/src/components/chat/ChatComposer.tsx`:

1. Add `planMode: boolean` and `onTogglePlanMode: () => void` to `ChatComposerProps`. The owner (`ChatPanel`) passes the thread's current `plan_mode` and a mutation that PATCHes the thread.
2. Render a **Plan mode** toggle button to the left of (or replacing the position of) the existing send affordances. Use the `Compass` icon from `lucide-react` (already a dep) when off, filled accent state when on. Tooltip: *"Plan mode (Shift+Tab)"*.
3. Bind `Shift+Tab` in the textarea's `onKeyDown` (already exists, just add a branch). PreventDefault so it doesn't move focus.
4. When `planMode` is true, swap the textarea placeholder to *"Describe what you want to build (plan mode)"*.

#### Frontend — chat header

In `dashboard/src/components/chat/ChatPanel.tsx` (header area):

- When `thread.plan_mode === 1`, render a small `<span class={styles.planPill}>Plan mode</span>` next to the title. Background `var(--color-accent-subtle)` (or workspace color if available), text `var(--text-primary)`, no hardcoded colors. Tokens only.

#### Frontend — Plan tab

In `dashboard/src/components/review/PlanTab.tsx`:

1. Accept `planMode: boolean` from props (plumb through `ReviewPanel`).
2. When `planMode === true`, render a sticky header bar at the top of the tab with two buttons:
   - **Approve & execute** (primary) — calls `POST /api/threads/:id/approve-plan`. Disabled when:
     - `thread.status === 'running'`
     - There are unresolved `plan_step` annotations on this thread (you have to either resolve them via Revise, or delete them, before approving)
   - **Revise** (secondary) — calls the existing `POST /api/threads/:id/send-feedback` with selected annotations. After a successful revise, the runner emits a new plan and the `plan_updated` WS event re-fetches.
3. When `planMode === false`, the tab renders exactly as today (no header bar) — backwards compatible.
4. Add a hook `useApprovePlan(threadId)` next to existing `useCreateAnnotation` etc. in `dashboard/src/hooks/useReview.ts`.

#### Frontend — auto-open Plan tab

In `dashboard/src/components/review/ReviewPanel.tsx`:

- When the active thread has `plan_mode === 1` and `status === 'running'`, auto-switch to the Plan tab on mount and on every `thread_status` transition into `running`. Honor the existing manual-tab-selection pattern: if the user explicitly clicked a different tab during this run, don't override.

#### WebSocket

Add `'plan_updated'` to `WSEventType` in `src/shared/types.ts`. Payload: `{ repoId: string | null; workspaceId: string }`. The dashboard listens (in the existing WS hook) and invalidates the React Query cache for `usePlan(repoId)`.

#### Files to touch

- `src/shared/types.ts` — `Thread.plan_mode`, `WSEventType +'plan_updated'`
- `src/db/store.ts` — ALTER threads + `setThreadPlanMode`
- `src/session/runner.ts` — tool filter, system prompt addendum, write `.trellis-plan.md` on plan-mode completion, broadcast `plan_updated`
- `src/api/routes.ts` — PATCH thread accepts `plan_mode`; new `POST /threads/:id/approve-plan`
- `src/git/operations.ts` — utility to write `.trellis-plan.md` (mirrors existing `readPlanFile`)
- `dashboard/src/components/chat/ChatComposer.tsx` (+ `.module.css`) — toggle button, Shift+Tab binding, placeholder swap
- `dashboard/src/components/chat/ChatPanel.tsx` (+ `.module.css`) — plan-mode pill in header; pass `planMode` to children
- `dashboard/src/components/review/PlanTab.tsx` (+ `.module.css`) — Approve & execute / Revise header bar
- `dashboard/src/components/review/ReviewPanel.tsx` — auto-switch to Plan tab when plan-mode run starts
- `dashboard/src/hooks/useReview.ts` — `useApprovePlan`, `useTogglePlanMode`
- `dashboard/src/hooks/useChatStream.ts` (or wherever WS events are routed) — handle `plan_updated`

#### Acceptance

1. New thread, click Plan mode toggle (or press Shift+Tab) — pill appears in header, placeholder changes, button shows active state.
2. Send "refactor the auth module to drop sessions in favor of JWTs" — LLM streams response in chat without writing files. Tools used should only be `read_file` / `list_files` / `search_files`.
3. After streaming completes, `.trellis-plan.md` exists in the repo root with the LLM's plan content. Plan tab refreshes automatically and shows the plan.
4. Annotate step 2 with a comment ("don't deprecate the legacy refresh token endpoint"). Click **Revise**. New run starts (still in plan mode), new plan supersedes the old, comment is consumed.
5. Click **Approve & execute** with no outstanding annotations. Plan-mode pill disappears, a new session starts with the full tool set, and the LLM begins editing files following the plan.
6. Toggle Plan mode off mid-thread (via toggle button) while idle — pill disappears, next message uses full tools.
7. Try to toggle Plan mode while a run is in flight → button is disabled (or PATCH returns 409).
8. Workspace-only thread (no repo) — `.trellis-plan.md` is written to the workspace path; Plan tab still renders.
9. MCP tools that are normally available are NOT visible in tool defs while plan_mode is on (verify via runner log or by stubbing one MCP tool).
10. App restart mid-plan-mode session: thread still shows plan-mode pill (state persisted in DB).

#### Out of scope

- Per-MCP-tool read-only allowlisting in plan mode (right now: all MCP tools off in plan mode).
- Approving only specific steps of the plan (all-or-nothing v1).
- Plan-mode for workspace-write threads with custom path scoping (separate; ties into item 8).
- Editing the plan markdown directly in the Plan tab (still read-only there; user edits via annotations or by switching to a file editor).
- A "preview" run that pretends to execute but only logs intended actions — separate item if requested.
- Multi-thread plan composition (combining plans from sibling threads).

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

### 57. Reorganize global CSS into cascade layers

**What:** Move global stylesheets into `dashboard/src/styles/` and structure them as five explicit CSS cascade layers (`reset`, `theme`, `base`, `components`, `atoms`) imported through a single `app.css` entry point. Replaces the lone `dashboard/src/ui/tokens.css` import in `main.tsx` with a layered architecture that gives us deterministic cascade order across the entire app.

**Why:** Right now there's exactly one global stylesheet (`tokens.css`) and one entry point. As we add a CSS reset, base typography, global utility/atomic classes, and primitives (item 58), specificity wars are inevitable unless we name the layers up front. Cascade layers make ordering explicit at the top of `app.css` — no more "why does this `:hover` rule lose to that selector" debugging. This also separates "import once globally" CSS (everything in `styles/`) from "import per component" CSS (CSS Modules under `ui/` and `components/`), so the import direction is obvious by location.

#### Final layout

```
dashboard/src/
  styles/
    app.css         ← entry; declares @layer order and @imports the rest
    reset.css
    theme.css       ← absorbs everything currently in ui/tokens.css
    base.css
    components.css
    atoms.css
  main.tsx          ← imports './styles/app.css' (single global CSS entry)
```

`dashboard/src/ui/tokens.css` is **deleted** in this item — its contents move into `theme.css`. CLAUDE.md's reference to `tokens.css` updates to `styles/theme.css`.

#### `app.css` (verbatim)

```css
@layer reset, theme, base, components, atoms;

@import './reset.css' layer(reset);
@import './theme.css' layer(theme);
@import './base.css' layer(base);
@import './components.css' layer(components);
@import './atoms.css' layer(atoms);
```

**Layer order (lowest → highest cascade priority):**
1. **reset** — modern CSS reset (start with `modern-normalize` or a minimal hand-written reset; pick one and document the choice in a top-of-file comment in `reset.css`).
2. **theme** — design tokens (CSS custom properties only — `--color-*`, `--space-*`, `--font-*`, `--shadow-*`). No selectors that emit declarations on actual elements.
3. **base** — element-level defaults: `body`, `html`, headings, links, form elements. Keep the surface small; this is for *defaults*, not opinionated styling.
4. **components** — global, semantic class-based styles for cross-cutting widgets that aren't CSS Modules (e.g. legacy `.card`, third-party library overrides, markdown rendering classes from `react-markdown` if any need theming). Empty initially — add as we encounter cases.
5. **atoms** — utility/atomic classes (`.flex`, `.gap-md`, `.text-muted`). Highest priority so a `<div className="text-muted">` actually overrides component-level color when applied. Empty initially; populate as patterns emerge.

CSS Modules (`Button.module.css`, etc.) are **outside** this stack. They get auto-scoped class names from Vite's CSS Modules pipeline and don't participate in global cascade — no layer needed.

#### Files to touch

- `dashboard/src/styles/app.css` (new) — the layer declaration + imports above
- `dashboard/src/styles/reset.css` (new) — pick a reset; document the choice in a comment at the top
- `dashboard/src/styles/theme.css` (new) — content moved from `dashboard/src/ui/tokens.css` (1:1 move; no content changes)
- `dashboard/src/styles/base.css` (new) — start empty with a comment listing what belongs here ("body, html, headings, links, form defaults"); don't preemptively add styles
- `dashboard/src/styles/components.css` (new) — empty with a header comment explaining the layer's purpose
- `dashboard/src/styles/atoms.css` (new) — empty with a header comment explaining the layer's purpose
- `dashboard/src/ui/tokens.css` — **delete** after moving content
- `dashboard/src/main.tsx` — change `import './ui/tokens.css'` to `import './styles/app.css'`
- `CLAUDE.md` — update the CSS section: replace the `tokens.css` reference with `styles/theme.css`, and add a one-line bullet about the layer architecture (e.g. *"Global CSS lives in `dashboard/src/styles/`, imported once via `app.css` which declares the layer order: `reset, theme, base, components, atoms`."*)
- `stylelint.config.cjs` — verify the config still ignores `dashboard/dist/**` and friends; no rule changes expected, but ensure `@layer` and `@import layer(...)` syntax doesn't trigger a false positive (newer `stylelint-config-standard` supports both natively; if it doesn't, add the at-rules to `at-rule-no-unknown` ignore list with a comment)

#### Acceptance

1. `pnpm typecheck && pnpm test && pnpm run lint:css` all pass.
2. The dashboard renders pixel-identically to pre-migration in both LTR and current theme — no visual regressions. Layered CSS with no actual rules added in `base/components/atoms` should be a no-op.
3. DevTools → Inspector → Computed pane shows the `@layer` ordering for any style that ends up in a layer (verify on one element from `theme.css` — e.g. body background — that the layer label appears).
4. `dashboard/src/ui/tokens.css` no longer exists; grep finds zero references to it across the repo.
5. CLAUDE.md's CSS section names `styles/theme.css` (not `tokens.css`) and lists the layer order.

#### Out of scope

- Adding any new actual styles to `base.css`, `components.css`, or `atoms.css`. This item is *purely* the file structure and import pipeline. Populate the layers in follow-ups when there's a concrete style to add.
- Migrating CSS Modules to also opt into a layer via `@layer components.foo { ... }` blocks — unnecessary given Vite's scoping, and adds noise.
- Swapping in a different reset library or opinionated typography system. Pick a minimal reset, document it, move on.
- Sass / PostCSS plugins beyond what's already configured.
- Any work that belongs to item 58 (primitives layer).

#### Risk callouts

- **Vite + CSS @import:** Vite handles `@import` in CSS by inlining at build time. Confirm in dev (`pnpm run dev`) AND in a production build (`pnpm run build:dashboard`) that `@layer` survives intact — modern Vite preserves it, but verify by inspecting the built CSS for `@layer reset, theme, base, components, atoms;`. If a future Vite version flattens layers, we'll need a postcss plugin (don't add preemptively).
- **Stylelint + @layer:** `stylelint-config-standard` 36+ supports `@layer` natively. If lint fails on it, add `'at-rule-no-unknown': [true, { ignoreAtRules: ['layer'] }]` to `stylelint.config.cjs` with a one-line comment, but try without first.
- **Browser support:** `@layer` ships in all modern browsers since 2022 (Safari 15.4+, Firefox 97+, Chrome 99+). Electron 35 ships Chromium 134+ — fully supported. Non-issue for our target.
- **Unsourced reset choice:** Don't paste a reset from memory. Pin a specific source (e.g. `modern-normalize` v3.0.1 copied verbatim, or Josh Comeau's reset with attribution) so the file's provenance is obvious to reviewers.

### 58. Seed a design system primitives layer (Button, Row, Column, Text, Link)

**What:** Create a small set of reusable primitive components in `dashboard/src/ui/` so feature components stop hand-rolling buttons, flex containers, headings, and links. Today there are ~86 raw `<button>` usages and ~112 inline flex containers across `dashboard/src/components/`; each is one more place where styling drifts from tokens and accessibility falls through.

**Why:** The CSS-logical-properties migration (item 55) and Stylelint exposed how much identical styling lives in feature CSS modules. A primitives layer collapses that into one place — and it's the prerequisite for later polish items (button hierarchy in modals, consistent link behavior, predictable spacing). It also unlocks a small `/playground` route where future variants can be eyeballed without firing up Storybook.

**Why NOT Storybook (yet):** Solo dogfooding tool, ~5 primitives to start. A `/playground` route inside the existing dashboard gives the same isolation + variant-comparison benefits with zero new deps, zero new build target, and no risk of stories rotting. Revisit if (a) the primitives count grows past ~15, or (b) someone else starts contributing components — then permalinks + the addons ecosystem actually pay for themselves.

**Depends on:** Item 57 (CSS cascade layers). The `theme.css` location and layer architecture must exist before primitives reference design tokens through the new path.

#### What ships in this item

A minimal but opinionated v1. **Don't** boil the ocean — five primitives, one playground route, and a validation migration of one feature area. Sweeping migration is follow-up work (per-feature items, or a dedicated cleanup PR later).

1. **`Button.tsx`** + `Button.module.css` (folder: `ui/Button/`)
   - Variants: `primary | secondary | ghost | danger`
   - Sizes: `sm | md` (no `lg` until something needs it)
   - Props: `variant`, `size`, `loading` (replaces children with a spinner, keeps width via `aria-hidden` placeholder), `leftIcon`, `rightIcon`, plus standard `<button>` attrs via `...rest`
   - Always uses `type="button"` by default (avoids accidental form submits — common React footgun)
   - Polymorphism intentionally omitted — if you need a link styled as a button, compose `<Link><Button /></Link>` or add a `linkAsButton` variant later
2. **`Row.tsx`** + **`Column.tsx`** + shared `Stack.module.css` (folders: `ui/Row/`, `ui/Column/`)
   - Both wrap a flex container; `Row` sets `flex-direction: row`, `Column` sets `column`
   - Props: `gap` (matches token scale: `xs | sm | md | lg | xl | 2xl`), `align` (cross-axis), `justify` (main-axis), `wrap`, `as` (defaults to `div`; can render as `section`, `header`, etc.)
   - Implementation note: keep them as two separate components even though they share CSS — call sites read better as `<Row gap="md">` than `<Stack direction="row" gap="md">`. The shared module CSS lives once and both components import it.
3. **`Text.tsx`** + `Text.module.css` (folder: `ui/Text/`)
   - Props: `variant` (`heading-1 | heading-2 | heading-3 | body | body-sm | caption | code`), `weight` (`regular | medium | semibold`), `tone` (`primary | secondary | muted | accent | danger`), `as` (defaults match variant: `h1`, `h2`, `h3`, `p`, `span`)
   - All sizes/weights/colors come from `styles/theme.css` tokens — never hardcode
4. **`Link.tsx`** + `Link.module.css` (folder: `ui/Link/`)
   - Props: `href`, `external` (auto-applies `target="_blank" rel="noopener noreferrer"` when true), `variant` (`default | subtle | inherit`)
   - `external` defaults to `true` when `href` starts with `http://` or `https://` and isn't pointing at our own origin; can be overridden
   - For in-app navigation, this stays a plain `<a>` for now — Trellis doesn't use a router. Revisit if/when one is added
5. **`/playground` route** in the dashboard
   - New file `dashboard/src/components/playground/Playground.tsx`
   - Wired into `App.tsx` as a top-level view, accessible by setting `?view=playground` in the URL or via a new menu entry under Settings → Developer (only visible when `import.meta.env.DEV`)
   - Renders every variant of every primitive in a single scrollable page, grouped by component, with section headings via the new `Text` primitive

#### Folder structure

PascalCase folder + PascalCase file, matching the existing project convention (`components/chat/ChatPanel.tsx` style). Each primitive lives in its own folder with an `index.ts` barrel so feature code imports as `import { Button } from '@/ui/Button'` (or relative path equivalent):

```
dashboard/src/ui/
  Button/
    Button.tsx
    Button.module.css
    index.ts          ← exports { Button, type ButtonProps }
  Row/
    Row.tsx
    index.ts
  Column/
    Column.tsx
    index.ts
  Stack.module.css    ← shared by Row and Column
  Text/
    Text.tsx
    Text.module.css
    index.ts
  Link/
    Link.tsx
    Link.module.css
    index.ts
  index.ts            ← top-level barrel re-exporting everything
```

#### Conventions to lock in (document in CLAUDE.md once landed)

- `dashboard/src/ui/` is the **only** place primitives live. Anything in `components/` is feature-scoped.
- Feature folders import from `ui/` and **never** the other way around. Linter rule isn't enforceable here without extra config — if you find a violation during code review, send it back.
- One folder per primitive; folder name matches component name in PascalCase.
- Every primitive exposes a typed Props interface as a named export so feature components can extend or pick from it.

#### Validation migration

Pick **one** feature area and migrate it to the new primitives in this same PR — proves the API actually works under load. Suggested target: `components/settings/` (lots of buttons, simple flex layouts, low blast radius if something needs revisiting). Don't migrate chat/, review/, or sidebar/ in this PR — those are higher-traffic and deserve their own scoped commits.

#### Implementation order

1. Add `ui/Button/` (Button.tsx + Button.module.css + index.ts). Build the playground page with just Button so you can iterate the API in isolation. Keep iterating until the API feels right before moving on.
2. Add `ui/Row/`, `ui/Column/`, and shared `ui/Stack.module.css`. Add to playground.
3. Add `ui/Text/`. Add to playground.
4. Add `ui/Link/`. Add to playground.
5. Add `dashboard/src/ui/index.ts` barrel re-exporting everything.
6. Migrate `components/settings/**` to use the primitives — only this one folder.
7. Run `pnpm typecheck && pnpm test && pnpm run lint:css`. Smoke-test the dashboard.
8. Update `CLAUDE.md` with a new section "Design system primitives" documenting the conventions above.

#### Files to touch

- `dashboard/src/ui/Button/Button.tsx` + `Button.module.css` + `index.ts` (new)
- `dashboard/src/ui/Row/Row.tsx` + `index.ts` (new)
- `dashboard/src/ui/Column/Column.tsx` + `index.ts` (new)
- `dashboard/src/ui/Stack.module.css` (new, shared)
- `dashboard/src/ui/Text/Text.tsx` + `Text.module.css` + `index.ts` (new)
- `dashboard/src/ui/Link/Link.tsx` + `Link.module.css` + `index.ts` (new)
- `dashboard/src/ui/index.ts` (new) — barrel re-exporting all primitives + their Props types
- `dashboard/src/components/playground/Playground.tsx` + `Playground.module.css` (new)
- `dashboard/src/App.tsx` — wire `?view=playground` route + dev-only menu entry
- `dashboard/src/components/settings/**` — migrate to use primitives
- `CLAUDE.md` — new "Design system primitives" section documenting `ui/` conventions

#### Acceptance

1. Each primitive renders all its variants in `/playground` without warnings or token violations.
2. `pnpm typecheck && pnpm test && pnpm run lint:css` pass.
3. The settings area visually matches its pre-migration state (pixel-equivalent or better; never worse).
4. CLAUDE.md has a "Design system primitives" section listing the five primitives + the import-direction rule.
5. Adding a new primitive (or variant) requires only: new folder under `ui/`, export from `ui/index.ts`, render in `Playground`. No other edits.
6. Storybook is **not** added.

#### Out of scope

- Migrating chat/, review/, sidebar/, git/, or terminal/ to the primitives — separate follow-up items per area.
- Form primitives (`Input`, `Select`, `Checkbox`, `Switch`) — significant API design surface; defer until at least one form needs them.
- Toast / Modal / Tooltip / Popover — overlay primitives have their own complexity (focus traps, portal mounting); separate item.
- Storybook, Chromatic, or any visual-regression tooling.
- Theming beyond what `styles/theme.css` already provides — no per-component theme contexts in v1.
- A router for in-app navigation — `?view=` query param is enough for the playground; adding a real router is its own decision.
- Documentation site or rendered API reference — the types in `ui/index.ts` and the playground page are the docs.

#### Risk callouts

- **Polymorphism creep.** Tempting to add `as` everywhere ("but what if I want Button to render as a div?"). Resist. Keep `as` only on `Row`, `Column`, and `Text` where semantic-tag flexibility is genuinely useful. `Button` should always be a `<button>`; if you need a link styled as a button, compose.
- **Variant explosion.** Five primitives × five variants × five sizes is already 125 combinations. Don't add a variant unless it's currently inlined somewhere in the codebase. Check first.
- **Settings as test bed.** If migrating settings reveals an awkward API, fix the API before merging — don't accept a sub-par primitive just because the migration's almost done.

## Known debt (carried from v2)

- Terminal uses `workspaceId` as `threadId` in WS messages — works but bends the envelope spec
- Terminal sessions don't persist across close/reopen — reopening starts fresh

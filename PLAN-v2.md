# Trellis — Plan v2 (UX Polish)

> Completed: item 3 (welcome state + clickable cards), streaming message fix, user message max-width.
> Verified already landed: InlineComment shadow tokenized, listAnnotations uses `unresolvedOnly`, AddWorkspaceModal webkitdirectory fallback.

## 1. Workspace context menu (Codex-style)

Add a `...` overflow menu on each WorkspaceBlock header row (appears on hover). Actions:

- **Open in Finder** — opens workspace path in macOS Finder (`open <path>`)
- **Open in Terminal** — spawns the embedded terminal at that workspace path (infrastructure already exists via `EmbeddedTerminal`)
- **Open in VS Code** — runs `code <path>` (IPC pattern from Phase 2)
- **Edit name** — inline rename the workspace
- **Edit color** — opens the ColorPicker inline
- **Archive threads** — marks all threads in the workspace as `done`
- **Remove** — deletes the workspace (with confirmation dialog)

Currently removal is only possible in Settings → Workspaces. This brings it inline like Codex.

Reference: Codex shows a `...` button on workspace rows that opens a popover with Open in Finder, Create permanent worktree, Edit name, Archive threads, Remove.

## 2. Header alignment fix

The sidebar header ("Trellis" + view toggle icons) and the chat panel header ("No thread selected" / thread title + model selector) are misaligned vertically. Both have `padding-top: 38px` for macOS traffic lights, but the sidebar header also has the search bar below it which pushes content down.

Concrete fix: both the sidebar and chat headers should share a fixed header row height (e.g. 56px including the traffic light offset). The search bar in the sidebar sits *below* this shared header row as a separate element, not inside it. Both header bottom borders should align horizontally across the sidebar/chat boundary.

## ~~3. Welcome empty state~~ DONE

Implemented with two states:
1. No workspaces → "Let's build" heading + Add Workspace CTA
2. Workspaces exist, no thread selected → "Select a thread or pick a prompt" + clickable suggestion cards with workspace picker

## ~~4. Horizontal lines in streamed messages~~ DONE

Scoped `hr { display: none }` inside `.content` in `ChatMessage.module.css`. The lines were `<hr>` elements produced by ReactMarkdown rendering `---` patterns in the streamed assistant content.

## 5. App window not draggable

The Electron window cannot be dragged by the title bar area. The custom header bar needs a CSS `-webkit-app-region: drag` zone, with interactive elements inside it marked as `-webkit-app-region: no-drag` so buttons/inputs remain clickable.

Fix: add a drag region to the top of the app shell (e.g. a dedicated title bar div or the existing header area). Mark all buttons, inputs, and dropdowns inside it as `no-drag`.

## 6. Resizable sidebar panels

The sidebar and review panel have fixed widths. Users should be able to drag the border between panels to resize them.

Fix: add a drag handle (thin vertical strip) at the sidebar/chat boundary and the chat/review boundary. On mousedown, track horizontal movement and update the panel width via CSS variable or state. Persist the widths in settings so they survive restarts.

## 7. Auto-show diff viewer on changes

The review/diff panel should automatically appear when the LLM makes file changes (write_file, edit_file tool calls), rather than requiring the user to manually toggle it.

Fix: listen for `thread_tool_end` WS events with tool names `write_file` or `edit_file`. When detected, auto-open the review panel and navigate to the changed file's diff.

## 8. User message alignment

User messages are currently right-aligned with max-width: 75%. This may read better left-aligned instead, keeping the max-width cap for visual distinction.

Fix: remove `margin-left: auto` from `.user` in ChatMessage.module.css. Keep `max-width: 75%` so user messages are still visually narrower than assistant responses.

## 9. Annotation/diff review workflow

The inline annotation feature on diffs does not appear to work correctly. Need to research what Codex does for code review annotations and align the UX.

Research:
- How does Codex present diffs after tool edits?
- Can users leave inline comments on specific lines?
- Are annotations sent back to the LLM as feedback?
- Current implementation: `src/review/` has annotation CRUD + `formatFeedback()` that injects annotations into the next user message. Likely a frontend wiring issue.

## 10. API key persistence across restarts

API keys entered in Settings are not persisted — users have to re-enter them every time the app launches. Keys are stored via `electron.safeStorage` IPC but the adapters are only registered in-memory during the current session.

Fix: on app startup, the backend should read stored keys from safeStorage and auto-register the corresponding adapters. This likely requires an init routine in the Electron main process that calls the adapter registration endpoint after the Express server is ready.

---

## Known Debt (non-blocking)

These are noted but low priority — not blocking any features.

- **Terminal uses workspaceId as threadId in WS messages** — Works because terminal sessions are workspace-scoped, but bends the envelope spec. Functionally correct, semantically loose.
- **Terminal sessions don't persist across close/reopen** — Reopening starts fresh. Expected for MVP.

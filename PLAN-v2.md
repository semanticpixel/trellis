# Trellis — Plan v2 (UX Polish)

> Items 3 (welcome state) is complete. Remaining items below.

## 1. Workspace context menu (Codex-style)

Add a `...` overflow menu on each WorkspaceBlock header row (appears on hover). Actions:

- **Open in Finder** — opens workspace path in macOS Finder (`open <path>`)
- **Edit name** — inline rename the workspace
- **Edit color** — opens the ColorPicker inline
- **Archive threads** — marks all threads in the workspace as `done`
- **Remove** — deletes the workspace (with confirmation dialog)

Currently removal is only possible in Settings → Workspaces. This brings it inline like Codex.

Reference: Codex shows a `...` button on workspace rows that opens a popover with Open in Finder, Create permanent worktree, Edit name, Archive threads, Remove.

## 2. Header alignment fix

The sidebar header ("Trellis" + view toggle icons) and the chat panel header ("No thread selected" / thread title + model selector) are misaligned vertically. Both have `padding-top: 38px` for macOS traffic lights, but the sidebar header also has the search bar below it which pushes content down.

Fix: ensure both headers use the same total height and vertical centering so the bottom border of the sidebar header aligns with the bottom border of the chat header. The search bar should not affect this alignment — it sits below the shared header line.

## 3. Welcome empty state

When the app loads with no workspaces (or no thread selected), show an encouraging empty state in the main content area instead of just "No thread selected". Inspired by Codex's "Let's build" screen:

- Large centered heading: "Let's build"
- Subtitle encouraging the user to add a workspace
- "Add workspace" CTA button that opens the AddWorkspaceModal
- Optional: 2-3 suggestion cards with starter prompts (e.g. "Explore a codebase", "Fix a bug", "Write tests for a module") that create a thread with the prompt pre-filled once a workspace exists

This makes the first-launch experience welcoming instead of blank.

## 4. Horizontal lines in streamed messages

During LLM streaming, random horizontal lines (`<hr>`) appear between assistant message blocks. Likely cause: tool call/result messages (read_file, list_files, bash) render as thin bordered blocks with no visible content, or the markdown renderer interprets separator-like patterns from the stream as `<hr>` elements.

Fix: investigate whether these are empty ToolCallBlock renders or markdown `---` artifacts. Either collapse empty tool blocks or add CSS `hr { display: none }` scoping within the message content area.

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

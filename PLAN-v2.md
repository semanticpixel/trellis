# Trellis — Plan v2 (UX Polish)

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

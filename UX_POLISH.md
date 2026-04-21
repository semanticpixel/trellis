# Trellis — UX Polish

> Running log of visual and interaction papercuts caught while dogfooding. Low bar to add. Batch into a polish session when you have 6-8 related items.

## How to use this file

**Different from PLAN-v3.** PLAN-v3 is for features and architectural work — spec'd out with Symptom/Cause/Fix/Files/Acceptance. This file is for visual observations:

- Add an entry the moment you notice something
- Include: what you saw, which file probably owns it (guess if unsure), and what "good" would look like
- Don't worry about fix approach — just log the observation
- When the list has 6+ entries, run a dedicated polish session to burn through them

**Entry template:**

```md
### Short description
- **Where:** component or file (best guess is fine)
- **What:** one sentence describing the issue
- **Target:** what it should look/feel like
```

**Promote to PLAN-v3 when:** the fix is actually an architectural change (e.g. "rework how the review panel lays out") — that belongs as a real plan item, not a polish note.

---

## Open

### Terminal letter-spacing too wide
- **Where:** `dashboard/src/components/terminal/EmbeddedTerminal.tsx` (xterm.js config) or `.module.css`
- **What:** Characters in the terminal render with excessive letter-spacing, making the monospace output feel stretched and harder to read
- **Target:** Tight letter-spacing matching a real terminal (iTerm2, Terminal.app). xterm.js has a `letterSpacing` option; may also need to remove any CSS `letter-spacing` on the container

### Diff viewer green has insufficient contrast
- **Where:** `dashboard/src/ui/tokens.css` — `--diff-add-fg` / `--diff-add-bg`, possibly `--status-running` family too
- **What:** Addition lines in the diff viewer use a green background + text color combination where some text becomes hard to read. Likely fails WCAG AA contrast (4.5:1 for body text)
- **Target:** Run current green through a contrast checker. Darken the text or lighten the tint until ratio is at least 4.5:1 in both light and dark themes. Same check for `--diff-del-fg` / `--diff-del-bg`

### Reload All MCP button — keep, rework, or remove?
- **Where:** `dashboard/src/components/settings/SettingsOverlay.tsx` (MCP tab header), `src/api/routes.ts` `POST /mcp/reload-all` endpoint
- **What:** After item 51's cold-start reload fix lands, individual per-server reload covers the primary use case. Reload All's only remaining value is bulk-restart for error recovery — but for users with mostly HTTP/OAuth servers, clicking it opens N browser tabs simultaneously and triggers the EADDRINUSE port collision on callback port 33418. Feels like a footgun in its current form.
- **Target:** Decide between three options based on dogfooding friction:
  - **(a) Remove entirely.** If bulk-start is rarely useful, delete the button and the `/mcp/reload-all` endpoint. Simplest.
  - **(b) Split into "Start all stdio" + per-server authorize.** Stdio spawns are instant/headless. HTTP/SSE should always be per-server opt-in. Captures the useful case without the OAuth tab-storm.
  - **(c) Keep as-is but gate behind confirmation.** "This will open N browser tabs for authorization, continue?" plus require item 52 (serialize OAuth callback port) to be implemented first.
- **Decision depends on:** whether bulk-start ever feels useful during real daily use. If you never click Reload All intentionally, go with (a). If you click it after config imports, go with (b). If it genuinely helps recovery scenarios, (c) with item 52 as a prerequisite.
- **Linked item:** Item 52 (serialize OAuth flows / fix EADDRINUSE) in PLAN-v3 becomes required only if we keep Reload All. If we remove it, item 52 can be dropped.

### Button alignment inconsistencies
- **Where:** multiple components — log specific spots below as they're spotted
- **What:** Buttons across the app don't align consistently — some sit too high/low relative to siblings, icon + text pairs have inconsistent gaps
- **Target:** Shared `<Button>` primitive (if one exists) enforces vertical alignment; audit usages and replace ad-hoc button markup

**Specific button misalignment instances** (add as caught):
- _(placeholder — add "saw X in Y" notes here)_

---

## Promoted to PLAN-v3

_(When an item grows into architectural work, move it here with a pointer — e.g. "Moved to PLAN-v3 item 50.")_

---

## Done

_(Move entries here with a one-line recap + commit when fixed, same as PLAN-v3.)_

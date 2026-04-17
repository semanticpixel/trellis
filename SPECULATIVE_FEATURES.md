# Trellis — Speculative Features

> Ideas that aren't in PLAN-v3 because they're premature, speculative, or solve problems you don't have yet. Promote an item to PLAN-v3 when the underlying need becomes real.

## How this file works

Unlike PLAN-v3, items here are **intentionally shallow**. Don't over-design them until you actually need them — thinking through implementation details now is wasted effort if the feature never ships.

Each item has:
- **Idea** — one sentence
- **Trigger** — what signal would promote this to PLAN-v3
- **Sketch** — rough approach, if obvious

---

## Workflow / productivity

### Prompt library / templates

**Idea:** Save commonly-used prompts as templates. Pick from a library when starting a new thread. Variables (e.g. `{{file}}`, `{{branch}}`) get substituted at send time.

**Trigger:** You find yourself copy-pasting the same prompt prefix into multiple threads. Or item 6 (MCP) lands and you want to combine MCP tool context with prompt boilerplate.

**Sketch:** New `prompt_templates` table + Settings tab for CRUD. Templates show in a `/` slash-command dropdown in the composer.

### Thread pinning and archiving

**Idea:** Pin important threads to the top of a workspace. Archive old/done threads to hide them from the main sidebar view without deleting.

**Trigger:** A single workspace accumulates 50+ threads and the sidebar becomes unnavigable.

**Sketch:** Add `pinned: boolean` and `archived: boolean` columns on threads. Sidebar section for pinned at top. Archived threads accessible via a toggle or search only.

### Plan history / version control

**Idea:** `.trellis-plan.md` gets revised over a session. Keep a version history so you can see how a plan evolved and revert if needed.

**Trigger:** You lose a good earlier version of a plan to a later over-eager revision.

**Sketch:** Store each plan version as a row in `plan_versions(thread_id, content, created_at)`. Plan tab shows a "history" dropdown to browse versions.

### Fork thread at message

**Idea:** Branch a thread at a specific message to try a different approach without losing the original path. Like git branches for conversations.

**Trigger:** You hit a decision point mid-session and want to explore both options without losing context.

**Sketch:** "Fork from here" button on any message. Creates a new thread with messages up to that point copied. Link new thread back to parent for navigation. Already mentioned in item 11 as a stretch — promote to its own item if demand grows.

### Parallel agents / fan-out prompts

**Idea:** Submit the same prompt to N threads with slight variations (different models, different system prompts) and compare outputs side by side.

**Trigger:** You're regularly running the same question across multiple models to compare. Or you want to A/B test prompt phrasings.

**Sketch:** "Run in parallel" button that spawns N threads, tiles them in the chat area. Merge results back as annotations.

### Session replay / time-travel

**Idea:** Go back to a specific turn in a thread and re-run from there, optionally with a different model or modified message.

**Trigger:** Edit + regenerate (item 11) lands and you find yourself wanting deeper time-travel controls.

**Sketch:** Store message state immutably. "Rewind to here" rolls the thread back, forking anything after into a sub-thread.

---

## Cost / observability

### Session cost budgets

**Idea:** Warn when a thread's token/dollar spend exceeds a threshold. Soft warning at 80%, hard stop at 100%.

**Trigger:** You accidentally burn through $20 on a runaway tool loop.

**Sketch:** Extend item 13 (cost display). Add `budget_usd` per thread or workspace. Pre-call check: if projected cost would exceed, pause and prompt.

### Usage dashboard

**Idea:** Aggregate view across all threads/workspaces: tokens per day, cost per provider, most-used tools, time spent, top files touched.

**Trigger:** You want to understand your own usage patterns, or prove ROI / efficiency to someone else.

**Sketch:** New Settings tab rendering charts from `usage` table (already exists). Use a light chart lib like `recharts`.

### Telemetry / crash reporting

**Idea:** Send anonymous error logs + usage stats to a remote endpoint for debugging.

**Trigger:** You distribute Trellis as a packaged app and need visibility into crashes on other people's machines. Not needed while it's a personal tool.

**Sketch:** Opt-in only. Local log file (item 33) is enough for now.

---

## LLM / tool sophistication

### Multi-model routing

**Idea:** Use different models for different tool calls — cheap/fast model for reads and `list_files`, expensive model for synthesis. Configurable per-workspace.

**Trigger:** Your Anthropic bill materially bothers you, OR you want faster iteration on reads.

**Sketch:** Tool call router inspects tool name, picks model from config. Session runner handles switching between adapters mid-loop.

### Model fallback

**Idea:** If primary provider fails (rate limit, outage), automatically retry with a secondary provider.

**Trigger:** You hit provider-side outages during real work and want resilience.

**Sketch:** Provider config grows a `fallback_provider_id` field. Session runner catches specific error types and retries once with fallback.

### Offline mode

**Idea:** Detect when API is unreachable and show a graceful UI. Queue messages to send when back online. Use Ollama as a local fallback.

**Trigger:** You try to use Trellis on a plane or with bad wifi.

**Sketch:** WS-based connectivity check. Red dot on header when offline. Composer disabled or queued. If Ollama is configured, auto-switch.

---

## Collaboration / sharing

### Shareable thread links

**Idea:** Generate a read-only public URL for a thread that others can view without installing Trellis. Like GitHub Gists for AI conversations.

**Trigger:** You want to share a particularly clever session with teammates or blog about it.

**Sketch:** Requires backend hosting (currently all local). New "Share" endpoint that uploads thread JSON to an S3 bucket behind a slug URL. Probably a whole separate product.

### Team workspaces

**Idea:** Multiple users collaborating on the same workspace, seeing each other's threads, leaving comments.

**Trigger:** You convince a teammate to use Trellis and want to collaborate.

**Sketch:** Huge scope. Requires auth, hosted backend, access control. Don't touch unless Trellis becomes a real product.

---

## Distribution / packaging

### Packaged app releases

**Idea:** Build signed macOS / Windows / Linux binaries so non-developers can install Trellis.

**Trigger:** You want others to try it without cloning the repo. Partially captured in item 22 but a bigger undertaking.

**Sketch:** electron-builder config, macOS code signing cert, notarization, GitHub Releases automation. Probably a multi-day project.

### Auto-update

**Idea:** App checks for updates on startup, downloads in background, prompts to restart.

**Trigger:** Distribution happens (above), and you start shipping bugfix releases.

**Sketch:** `electron-updater` plus a releases feed. Standard Electron pattern.

### CLI companion

**Idea:** `trellis` CLI that can start a thread, send a message, attach a file — for scripting Trellis from shell.

**Trigger:** You find yourself repeatedly doing the same Trellis flow and want to automate it. Or you want Trellis to be scriptable from other tools.

**Sketch:** Node CLI that talks to the backend HTTP API. Reuses the same endpoints the UI uses. Tiny scope.

---

## Accessibility / polish

### Accessibility audit

**Idea:** Full WCAG audit — keyboard navigation everywhere, ARIA labels, screen reader support, focus traps in modals.

**Trigger:** Someone with accessibility needs tries to use Trellis. Or you distribute it publicly and accessibility becomes table stakes.

**Sketch:** Not a single item — a sustained effort. Start with an automated tool (axe-core) for a baseline, then manual fixes.

### Localization / i18n

**Idea:** Translate UI into other languages.

**Trigger:** Non-English users ask for it. Low probability for a personal dev tool.

**Sketch:** Wrap all strings in `t('key')`, add locale files, detect OS locale. Use `react-intl` or similar.

### User-level global settings

**Idea:** Settings that apply across all workspaces (default model, default theme, global keyboard shortcuts). Different from per-workspace settings.

**Trigger:** You find yourself repeatedly configuring the same thing in each new workspace.

**Sketch:** New `global_settings` table or reuse the `settings` table with a key prefix. UI separates user-level from workspace-level in the Settings overlay.

---

## Wild cards

### Voice input

**Idea:** Hold a key to dictate a prompt. Whisper transcription to text.

**Trigger:** You're on macOS and want to dictate long prompts without typing.

**Sketch:** macOS has built-in dictation via Fn key — may be enough without building custom.

### Web clipper

**Idea:** Browser extension or bookmarklet that sends a URL's content to a Trellis thread as context.

**Trigger:** You find yourself copy-pasting web pages into Trellis often.

**Sketch:** Chrome extension that POSTs to Trellis's local API with the current page's markdown.

### Notebook / scratch pad

**Idea:** A place in Trellis that isn't a thread — more like a durable note. Pinned to a workspace. Can be included as context in threads via `@notes`.

**Trigger:** You start using thread messages as de-facto notes and realize that's not quite right.

**Sketch:** `notes` table. Markdown editor. Reference via `@notes` in composer (integrates with item 10).

---

## Process for promoting items

When an idea here starts hurting (you hit the trigger condition), promote it:

1. Move the item text into PLAN-v3
2. Flesh it out following the PLAN-v3 item template (Symptom/What, Cause/Why, Implementation, Files, Acceptance, Out of scope)
3. Delete from here
4. Assign it a priority tier in the PLAN-v3 triage section

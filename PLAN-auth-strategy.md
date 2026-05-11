# Implementation Plan: Claude Auth Strategy Toggle (API Key vs. Claude Code CLI)

## 1. Goal

Let users choose, per Anthropic provider, between two auth strategies:

- **`api_key`** (default, current behavior) — user-supplied `ANTHROPIC_API_KEY`, billed to that key, uses `@anthropic-ai/sdk`.
- **`claude_code_cli`** — piggybacks on the user's existing `claude` CLI login (subscription/OAuth), uses `@anthropic-ai/claude-agent-sdk`. No key entered. Billed against the user's Claude subscription.

Selection is persistent (provider config) and the rest of trellis is unaware of which path is active.

## 2. Architecture

Introduce a second concrete adapter alongside `AnthropicAdapter`. Both implement the existing `LLMAdapter` interface and yield trellis's normalized `StreamEvent`s. The session runner is unchanged at the dispatch level — the registry returns whichever adapter matches the active provider.

```
┌─────────────────────────────────────────────────────┐
│ SessionRunner (src/session/runner.ts) — unchanged   │
└──────────────────────┬──────────────────────────────┘
                       │ adapter.stream(request)
        ┌──────────────┴───────────────┐
        ▼                              ▼
 AnthropicAdapter              ClaudeCodeAdapter  ← NEW
 (api_key path)                (claude_code_cli path)
 @anthropic-ai/sdk             @anthropic-ai/claude-agent-sdk
 client.messages.stream()      query({ ... })
 Yields raw stream events      Translates SDK events → StreamEvent
 Tool loop owned by runner     Tool loop owned by SDK (see §6)
```

**Critical asymmetry to plan around:** the agent SDK's `query()` runs the full tool loop internally — it streams tool_use, executes the tool, streams tool_result, and continues until the model emits a terminal `result`. The raw SDK adapter expects trellis's `SessionRunner` to do that loop. We resolve this in §6 and §8.

## 3. Dependencies

Add to `package.json`:

```json
"@anthropic-ai/claude-agent-sdk": "^0.2.58"
```

Keep `@anthropic-ai/sdk` — the API-key path still uses it.

## 4. Schema Changes

### 4.1 Providers table

In `src/db/store.ts` (the providers DDL — currently `id`, `name`, `type`, `base_url`, `default_model`):

```sql
ALTER TABLE providers ADD COLUMN auth_strategy TEXT NOT NULL DEFAULT 'api_key';
```

Constrain in TS: `auth_strategy: 'api_key' | 'claude_code_cli'`. Only meaningful for `type = 'anthropic'`; ignored for openai/ollama/custom. Default `'api_key'` so existing rows are untouched.

Add a migration in the same place existing DDL lives. Use the bumped-version pattern if you already track schema versions; otherwise `CREATE TABLE IF NOT EXISTS` + a one-shot `ALTER TABLE` guarded by a `PRAGMA table_info(providers)` check.

### 4.2 No API key persistence change

Keep API keys ephemeral (not in SQLite) — same as today. Document the future `safeStorage` work separately; it's orthogonal.

## 5. Settings UI Changes

`dashboard/src/components/settings/SettingsOverlay.tsx` → `ProvidersTab`:

When the user picks `type = 'anthropic'`, show an **Auth strategy** radio group:

```
○ API key  (recommended for non-subscription users)
  └── [API Key input]                    ← only enabled when this radio is selected
○ Claude Code CLI  (uses your `claude` login)
  └── Status: ✓ claude CLI detected      ← live preflight check
      Or:    ✗ claude not found on PATH  [Install instructions ↗]
```

Behavior:
- Selecting `claude_code_cli` hides/disables the API key input.
- Add a `GET /api/providers/preflight/claude-cli` endpoint that runs `claude --version` (or `which claude`) and returns `{ ok: boolean, version?: string }`. Surface the result inline.
- Form POSTs to `/api/providers` with `{ type: 'anthropic', auth_strategy, apiKey? }`. `apiKey` is omitted when strategy is `claude_code_cli`.

Persist the selected strategy alongside the provider row (§4.1).

## 6. New Adapter: `ClaudeCodeAdapter`

Create `src/llm/claude-code.ts`. It implements `LLMAdapter` (same interface as `AnthropicAdapter` in `src/llm/anthropic.ts:1-200`).

### 6.1 The core call

```typescript
import { query, type McpServerConfig as SdkMcpServerConfig } from "@anthropic-ai/claude-agent-sdk";

async *stream(request: StreamRequest): AsyncIterable<StreamEvent> {
  const abortController = new AbortController();
  request.abortSignal?.addEventListener("abort", () => abortController.abort());

  const q = query({
    prompt: this.buildPrompt(request.messages),    // see §6.3
    options: {
      abortController,
      model: request.model,                         // e.g. "claude-sonnet-4-5-20250929"
      systemPrompt: request.systemPrompt,
      maxTurns: 50,
      allowedTools: this.mapToolsToSdk(request.tools),  // see §6.4
      permissionMode: "bypassPermissions",          // tools auto-approved
      allowDangerouslySkipPermissions: true,
      mcpServers: this.buildMcpServersConfig(request.workspaceId),  // see §6.5
      ...(this.sessionId ? { resume: this.sessionId } : { persistSession: true }),
      stderr: (data) => console.warn("[claude-sdk]", data.trim()),
    },
  });

  for await (const msg of q) {
    yield* this.translateSdkMessage(msg);          // see §6.2
    this.captureSessionId(msg);                     // see §6.6
  }
}
```

### 6.2 SDK → trellis stream-event translation

Map the SDK's `SdkStreamMessage` shapes to trellis's `StreamEvent` shape (from `src/shared/`). Reference table:

| SDK message type | Trellis `StreamEvent` |
|---|---|
| `system.init` | (none, or emit a `session_init` event if useful for UI) |
| `assistant` with text block | `content_block_start` + `content_block_delta(type: 'text')` + `content_block_stop` |
| `assistant` with thinking block | `content_block_delta(type: 'thinking')` |
| `assistant` with tool_use block | `content_block_start(type: 'tool_use')` + `content_block_delta(type: 'input_json')` + `content_block_stop` |
| `tool_result` | `content_block_start(type: 'tool_result')` + `content_block_stop` (UI already renders these) |
| `result` (success) | `message_end` with `usage: { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }` |
| `result` (error) | `message_end` with `error: { ... }` |

The goal: the chat UI should look identical regardless of which adapter is active. Existing components in `dashboard/src/components/chat/` are already wired to these event types — don't touch them.

### 6.3 Prompt construction

The agent SDK's `query({ prompt })` expects a **single prompt string** (the latest user turn), not the full message history. History is preserved server-side by the SDK via `resume: sessionId`.

This is a fundamental difference from `AnthropicAdapter`. Two consequences:

1. **First turn**: pass the latest user message verbatim. The SDK creates a session and starts persisting.
2. **Subsequent turns**: pass `{ resume: sessionId }`. The SDK has the prior turns; we only send the new user message.
3. **Trellis's own `messages` table**: keep writing to it (UI relies on it for the chat transcript), but treat the SDK's session as the source of truth for the model. If a session is lost / compacted (the SDK emits a new sessionId), don't try to reconstruct — just store the new one and continue.

### 6.4 Tools

The SDK ships with its own built-ins (Read, Edit, Write, Bash, Glob, Grep, etc.) — these *replace* trellis's `src/tools/` registry when the CLI adapter is active. That's intentional and fine, because the SDK's built-ins are functionally a superset of `readFileTool`, `writeFileTool`, `editFileTool`, `bashTool`, `listFilesTool` (defined in `src/tools/registry.ts:1-15`).

In `mapToolsToSdk`, translate trellis's tool name list to the SDK's tool names:

```typescript
const TRELLIS_TO_SDK_TOOL = {
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  bash: "Bash",
  list_files: "Glob",
} as const;
```

Tool calls from the SDK arrive with SDK-native names — translate back when writing to the `messages` table so existing UI rendering and annotation logic in `src/session/runner.ts:203-245` still recognizes them. Pick one canonical naming (probably trellis's), translate at the adapter boundary.

### 6.5 MCP servers

Existing MCP config lives in `src/mcp/` and is keyed by `workspace_id`. Translate it to the SDK's `mcpServers` format:

```typescript
buildMcpServersConfig(workspaceId: string): Record<string, SdkMcpServerConfig> {
  const configs = mcpManager.getConfigsForWorkspace(workspaceId);
  const out: Record<string, SdkMcpServerConfig> = {};
  for (const cfg of configs) {
    if (cfg.transport === "stdio") {
      out[cfg.name] = { type: "stdio", command: cfg.command, args: cfg.args, env: cfg.env };
    } else if (cfg.transport === "http" || cfg.transport === "sse") {
      out[cfg.name] = { type: cfg.transport, url: cfg.url, headers: cfg.headers };
    }
  }
  return out;
}
```

The SDK spawns and manages these directly. Trellis's own `mcpManager` connection pool is **bypassed** in CLI mode for tool execution — but you may still want it active for the Settings UI (showing connection status, OAuth flows). Keep `mcpManager` alive for UI status display; don't route tool calls through it.

### 6.6 Session ID persistence

Add a `sdk_session_id` column to threads, or store under a known key in the existing settings table (`thread.<threadId>.sdkSessionId`).

```typescript
captureSessionId(msg: SdkStreamMessage) {
  const sid = extractSessionId(msg);  // session_id | sessionId | session.id
  if (sid && sid !== this.sessionId) {
    this.sessionId = sid;
    store.setThreadSdkSessionId(this.threadId, sid);
  }
}
```

When the SDK auto-compacts, sessionId changes — store the new one. Don't try to merge or reconstruct.

## 7. Adapter Registration

`src/index.ts:30-37` currently does:

```typescript
if (process.env.ANTHROPIC_API_KEY) {
  registerAdapter(new AnthropicAdapter(process.env.ANTHROPIC_API_KEY));
}
```

Change `POST /api/providers` (in `src/api/routes.ts`) to branch on `auth_strategy`:

```typescript
if (type === 'anthropic') {
  if (auth_strategy === 'claude_code_cli') {
    const preflight = await checkClaudeCli();
    if (!preflight.ok) {
      res.status(400).json({ error: 'claude CLI not found on PATH', hint: preflight.hint });
      return;
    }
    registerAdapter(new ClaudeCodeAdapter({ defaultModel }));
  } else {
    if (!apiKey) { res.status(400).json({ error: 'apiKey required for api_key strategy' }); return; }
    registerAdapter(new AnthropicAdapter(apiKey));
  }
  store.upsertProvider({ type, name, default_model, auth_strategy });
}
```

On app startup, re-register the adapter for the persisted provider — for `claude_code_cli` providers no key is needed, so this restores function across restarts (something the current api_key path doesn't do; that gap is fine to leave for now).

## 8. Session Runner Changes

`src/session/runner.ts` mostly stays the same. **One change**: when the adapter is `ClaudeCodeAdapter`, the SDK runs the tool loop internally, so the runner's existing post-stream tool dispatch (lines 203-245) is **dead code on that path**. The cleanest way to handle this:

- Have adapters expose a capability flag: `adapter.ownsToolLoop: boolean`.
- `AnthropicAdapter.ownsToolLoop = false` → runner executes tools, re-streams, etc. (current behavior).
- `ClaudeCodeAdapter.ownsToolLoop = true` → runner just consumes the event stream until `message_end`. No tool dispatch.

The runner already writes tool_use and tool_result messages to the DB based on observed stream events — that path works for both modes. The only block to gate is the "now execute the tool and start a new stream" loop.

## 9. Preflight & Setup UX

In `scripts/` add `check-claude-cli.ts` (or extend whatever preflight script already exists). At minimum a function in `src/llm/claude-code.ts`:

```typescript
export async function checkClaudeCli(): Promise<{ ok: boolean; version?: string; hint?: string }> {
  try {
    const { stdout } = await execAsync("claude --version");
    return { ok: true, version: stdout.trim() };
  } catch {
    return {
      ok: false,
      hint: "Install: npm install -g @anthropic-ai/claude-code, then run `claude` once to log in.",
    };
  }
}
```

Surface this:
- Inline in Settings → Providers (live status next to the radio).
- On first stream attempt: if preflight fails, fail fast with a clear UI error rather than letting the SDK error opaquely.

## 10. README & .env.example

- `README.md`: add a "Choosing an auth strategy" section explaining the trade-off (API key billed to your key; CLI uses your subscription, requires `claude` installed and logged in).
- `.env.example`: keep `ANTHROPIC_API_KEY=` but add a comment that it's only used by the `api_key` strategy.

## 11. Testing

- Unit: `ClaudeCodeAdapter.translateSdkMessage()` — feed canned SDK messages, assert correct `StreamEvent` output. Use vitest like the rest of the repo.
- Integration: stub `query()` from `@anthropic-ai/claude-agent-sdk` (it's a named export, easy to mock). Verify session_id capture, abort propagation, MCP config translation.
- E2E (manual, document in PR): with `claude` CLI logged in, create an Anthropic provider with `auth_strategy = claude_code_cli`, send a multi-turn message that uses a tool, verify the chat UI renders identically to the API-key path.

## 12. Order of Operations (suggested commits)

1. Add `auth_strategy` column + migration. Update provider TS types. (no behavior change)
2. Add `@anthropic-ai/claude-agent-sdk` dependency.
3. Stub `ClaudeCodeAdapter` (no SDK call yet) implementing the interface, throwing on `stream()`. Wire registration.
4. Implement `translateSdkMessage` with unit tests against canned fixtures.
5. Implement the `query()` call and session ID persistence.
6. Add MCP config translation.
7. Add `ownsToolLoop` flag + guard in `SessionRunner`.
8. Settings UI: radio toggle + preflight endpoint.
9. README + .env.example updates.
10. Manual E2E + screenshot.

## 13. Model Registry & UI Mapping

### 13.1 Background: how the agent SDK handles model strings

The agent SDK accepts **two** forms:

- **Rolling aliases** — `opus`, `sonnet`, `haiku`. Auto-resolve to the SDK's current default for that tier. Convenient but **non-deterministic across SDK upgrades** (the alias silently bumps when Anthropic ships a new version).
- **Pinned full IDs** — `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`. Locked to a specific version. Predictable.

The raw `@anthropic-ai/sdk` (api_key path) only accepts full IDs — no aliases.

**Decision: pin to full IDs in the UI.** Users picking "Opus 4.7" today should keep getting 4.7 after the next SDK bump unless they explicitly change it. Aliases are kept as an internal normalization step inside the adapter for users who type one in manually.

### 13.2 New file: `src/shared/models.ts`

Single source of truth, consumed by both adapters and the Settings UI:

```typescript
export type AuthStrategy = 'api_key' | 'claude_code_cli';

export interface ModelEntry {
  /** Canonical model ID sent to the SDK / API */
  id: string;
  /** Display name shown in dropdowns */
  displayName: string;
  /** Tier — used for grouping in the UI */
  tier: 'opus' | 'sonnet' | 'haiku';
  /** SDK alias that resolves to this ID at time of writing (informational) */
  rollingAlias?: 'opus' | 'sonnet' | 'haiku';
  /** Which auth strategies expose this model in the UI */
  availableIn: AuthStrategy[];
}

export const ANTHROPIC_MODELS: ModelEntry[] = [
  {
    id: 'claude-opus-4-7',
    displayName: 'Opus 4.7',
    tier: 'opus',
    rollingAlias: 'opus',
    availableIn: ['api_key', 'claude_code_cli'],
  },
  {
    id: 'claude-sonnet-4-6',
    displayName: 'Sonnet 4.6',
    tier: 'sonnet',
    rollingAlias: 'sonnet',
    availableIn: ['api_key', 'claude_code_cli'],
  },
  {
    id: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku 4.5',
    tier: 'haiku',
    rollingAlias: 'haiku',
    availableIn: ['api_key', 'claude_code_cli'],
  },
  // Add prior versions here as they become relevant — e.g. for users who
  // need to pin to an older snapshot for reproducibility.
];

/** Normalize aliases and shorthand to canonical IDs. */
export function resolveModelId(input: string): string {
  const lower = input.trim().toLowerCase();
  const aliasMatch = ANTHROPIC_MODELS.find(m => m.rollingAlias === lower);
  if (aliasMatch) return aliasMatch.id;
  return input; // pass through unknown IDs — let the SDK error
}

export function getModelsForStrategy(strategy: AuthStrategy): ModelEntry[] {
  return ANTHROPIC_MODELS.filter(m => m.availableIn.includes(strategy));
}
```

This file is the **only place** model IDs and display names should be hardcoded. When Anthropic ships a new model, you add one entry here and it lights up in the UI + both adapters.

### 13.3 Adapter normalization

Both `AnthropicAdapter.stream()` and `ClaudeCodeAdapter.stream()` should pipe `request.model` through `resolveModelId()` before sending it to the SDK. This way:

- If the user picks "Opus 4.7" in the UI → `claude-opus-4-7` is stored on the thread and passed verbatim.
- If a script/test passes `"opus"` → normalized to `claude-opus-4-7` before the SDK call.
- If someone passes an unrecognized ID → passed through unchanged, letting the SDK return its own validation error.

### 13.4 Settings UI: model dropdown

In `ProvidersTab` (and anywhere else a model picker exists — check `dashboard/src/components/` for a `ModelSelect` component or similar):

```tsx
const models = getModelsForStrategy(authStrategy);

<select value={defaultModel} onChange={...}>
  {models.map(m => (
    <option key={m.id} value={m.id}>
      {m.displayName}
    </option>
  ))}
</select>
```

When the user toggles `auth_strategy`, re-filter the dropdown. If the currently-selected model isn't available under the new strategy (currently not the case — all three tiers are available under both — but future-proofing), fall back to the highest-tier model that is.

### 13.5 Per-thread model override

Threads can override the provider default. The override is stored as a canonical ID (already the case in your existing schema). No migration needed — existing rows already contain full IDs like `claude-sonnet-4-5-20250929`. Old IDs will just pass through `resolveModelId()` untouched and the SDK will either accept them (older snapshots are usually still routable) or return a clean "unknown model" error the UI can surface.

### 13.6 Test coverage

- `resolveModelId('opus')` → `'claude-opus-4-7'`
- `resolveModelId('claude-opus-4-7')` → `'claude-opus-4-7'` (identity)
- `resolveModelId('OPUS')` → case-insensitive alias resolution
- `resolveModelId('claude-sonnet-3-5')` → passes through unchanged (unknown but well-formed)
- `getModelsForStrategy('api_key').length === 3`
- `getModelsForStrategy('claude_code_cli').length === 3`

## 14. Open Questions for Implementing Session

- **Cost display** (PLAN.md P2 item 13): in CLI mode, usage tokens are reported by the SDK in the final `result` message — keep showing them, but consider noting "billed via subscription, not metered against any visible quota" in the cost panel.
- **Plan mode** (PLAN.md P1 item 7): when plan mode lands, it constrains tools to read-only. In CLI mode this means setting `allowedTools` to the read-only subset for the `query()` call — should compose cleanly with §6.4.
- **Multiple Anthropic providers**: if the user creates two Anthropic providers with different strategies, the registry needs to key on provider ID, not type. Current code keys on type (`AnthropicAdapter` is a singleton per type). Decide whether to scope this change in or punt.
- **Older model snapshots**: §13.2 lists only current versions. If users have existing threads pinned to e.g. `claude-sonnet-4-5-20250929`, those will still work (passed through unchanged) but won't appear in the dropdown. Decide whether to add a "Legacy" group to the registry or just rely on the pass-through behavior.

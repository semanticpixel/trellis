# Trellis

Multi-workspace LLM development environment. Run multiple AI coding sessions across workspaces simultaneously, review diffs and plans inline, and manage git branches — all from one app.

## Features

- **Multi-LLM**: Claude, OpenAI, Ollama, and custom endpoints via API keys
- **Workspace Tree**: Organize sessions by workspace/repo with color labels
- **Inline Review**: Custom unified-diff renderer with shiki syntax highlighting, inline comments, plan annotations (redline-style)
- **Annotation Feedback**: Comments on diffs/plans automatically feed back to the LLM
- **Git-Aware**: Branch switching, diff viewer, embedded terminal
- **Concurrent Sessions**: Multiple threads streaming simultaneously across workspaces

## Setup

```bash
# Install dependencies (also builds native modules for system Node)
pnpm install

# Start development
pnpm run electron:dev
```

If you ever see an `NODE_MODULE_VERSION` mismatch from `better-sqlite3` or `node-pty`, their binaries were compiled for the wrong runtime. Repair with:

```bash
pnpm run rebuild:native
```

Trellis's backend runs as a `tsx` subprocess under system Node — not inside Electron's main process — so native modules must target system Node, which `pnpm rebuild` does by default.

## API Keys

Trellis stores API keys securely in the OS keychain via Electron's `safeStorage`. Configure them in Settings on first launch.

Required for each provider:
- **Claude**: `ANTHROPIC_API_KEY`
- **OpenAI**: `OPENAI_API_KEY`
- **Ollama**: No key needed (local)

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for full details.

```
Electron (desktop shell)
  └── Express + WebSocket (backend)
        ├── SQLite (persistence)
        ├── LLM Adapters (Claude, OpenAI)
        ├── Tools (file read/write, bash — workspace-scoped)
        └── Session Runner (prompt → LLM → tool loop)
  └── React + Vite (frontend)
        ├── Sidebar (workspace tree with colors)
        ├── Chat Panel (streaming + tool calls + dismissible embedded terminal)
        └── Review Panel (shiki-highlighted diff + plan annotations)
```

## Transfer to Another Machine

```bash
pnpm run bundle  # creates ~/Desktop/trellis.bundle

# On the target machine:
git clone trellis.bundle trellis
cd trellis
pnpm install
pnpm run electron:dev
```

## Tech Stack

- Electron 35, React 19, Vite 7, TypeScript 5.7
- SQLite (better-sqlite3, WAL mode)
- shiki (lazy-loaded syntax highlighting)
- xterm.js + node-pty
- @anthropic-ai/sdk, openai

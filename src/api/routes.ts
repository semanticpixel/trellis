import { Router, type Request } from 'express';
import type { ServerContext } from './server.js';
import { existsSync, readdirSync, statSync, appendFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import { getDiffSummary, getFileDiff, stageFile, revertFile, readPlanFile, listBranches, checkoutBranch, createBranch, getCurrentBranch } from '../git/operations.js';
import { formatFeedback } from '../review/feedback.js';
import { parsePlan } from '../review/plan-parser.js';
import { captureSnippet, parseDiffLineRef, findStaleAnnotations } from '../review/anchoring.js';
import { registerAdapter, hasAdapter, listAdapters } from '../llm/adapter.js';
import { AnthropicAdapter } from '../llm/anthropic.js';
import { OpenAIAdapter } from '../llm/openai.js';
import { OllamaAdapter } from '../llm/ollama.js';
import { CustomAdapter } from '../llm/custom.js';
import {
  loadUserConfig,
  saveUserConfig,
  loadMergedConfig,
  detectClaudeCodeConfigs,
  MCPServerConfigSchema,
  transportTypeOf,
  type MergedMCPServer,
} from '../mcp/config.js';
import { mcpManager } from '../mcp/manager.js';

/**
 * Read a string field from either the JSON body or the query string.
 * Returns undefined when the field is missing or any non-string value
 * (e.g. Express parses `?x=a&x=b` into `string[]`; casting to string
 * would silently accept that). Lets route handlers avoid `as string`
 * casts without losing type safety.
 */
function readStringField(req: Request, field: string): string | undefined {
  const fromBody: unknown = req.body?.[field];
  if (typeof fromBody === 'string') return fromBody;
  const fromQuery: unknown = req.query[field];
  if (typeof fromQuery === 'string') return fromQuery;
  return undefined;
}

export function createRoutes(ctx: ServerContext): Router {
  const router = Router();
  const { store, broadcast, sessionManager } = ctx;

  // ── Workspaces ─────────────────────────────────────────────

  router.get('/workspaces', (_req, res) => {
    const workspaces = store.listWorkspaces();
    res.json(workspaces);
  });

  router.post('/workspaces', (req, res) => {
    const { name, path, color } = req.body;
    if (!name || !path) {
      res.status(400).json({ error: 'name and path are required' });
      return;
    }
    try {
      const workspace = store.createWorkspace({ name, path, color });

      // Auto-scan for git repos one level deep
      if (existsSync(path)) {
        try {
          const entries = readdirSync(path);
          for (const entry of entries) {
            const entryPath = join(path, entry);
            const gitPath = join(entryPath, '.git');
            try {
              if (statSync(entryPath).isDirectory() && existsSync(gitPath)) {
                store.createRepo(workspace.id, entry, entryPath);
              }
            } catch {
              // skip entries we can't stat
            }
          }
        } catch {
          // skip if we can't read the directory
        }
      }

      res.status(201).json(workspace);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('UNIQUE constraint')) {
        res.status(409).json({ error: 'Workspace path already exists' });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  router.patch('/workspaces/:id', (req, res) => {
    const { color, name, sort_order } = req.body;
    if (color) {
      store.updateWorkspaceColor(req.params.id, color);
    }
    if (name) {
      store.updateWorkspaceName(req.params.id, name);
    }
    if (sort_order !== undefined) {
      store.updateWorkspaceSortOrder(req.params.id, sort_order);
    }
    const workspace = store.getWorkspace(req.params.id);
    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    res.json(workspace);
  });

  router.delete('/workspaces/:id', (req, res) => {
    store.deleteWorkspace(req.params.id);
    res.status(204).end();
  });

  // ── Repos ──────────────────────────────────────────────────

  router.get('/workspaces/:workspaceId/repos', (req, res) => {
    const repos = store.listRepos(req.params.workspaceId);

    // Check which paths still exist
    const result = repos.map((repo) => ({
      ...repo,
      missing: !existsSync(repo.path),
    }));
    res.json(result);
  });

  // ── Threads ────────────────────────────────────────────────

  router.get('/threads', (req, res) => {
    const threads = store.listThreads(
      readStringField(req, 'workspace_id'),
      readStringField(req, 'repo_id'),
    );
    res.json(threads);
  });

  router.post('/threads', (req, res) => {
    const thread = store.createThread(req.body);
    res.status(201).json(thread);
  });

  // Thread search must come before /threads/:id to avoid "search" matching as :id
  router.get('/threads/search', (req, res) => {
    const q = readStringField(req, 'q');
    if (!q) {
      res.json([]);
      return;
    }
    const threads = store.searchThreads(q);
    res.json(threads);
  });

  router.get('/threads/:id', (req, res) => {
    const thread = store.getThread(req.params.id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    res.json(thread);
  });

  router.patch('/threads/:id', (req, res) => {
    const { title, status, provider, model } = req.body;
    if (title) store.updateThreadTitle(req.params.id, title);
    if (status) {
      store.updateThreadStatus(req.params.id, status);
      broadcast(req.params.id, 'thread_status', { status });
    }
    if (provider && model) {
      store.updateThreadModel(req.params.id, provider, model);
    }
    const thread = store.getThread(req.params.id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    res.json(thread);
  });

  router.delete('/threads/:id', (req, res) => {
    store.deleteThread(req.params.id);
    res.status(204).end();
  });

  router.post('/threads/:id/abort', (req, res) => {
    const thread = store.getThread(req.params.id);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    const wasRunning = sessionManager.isRunning(req.params.id);
    sessionManager.abortSession(req.params.id);
    res.json({ ok: true, wasRunning });
  });

  // ── Messages ───────────────────────────────────────────────

  router.get('/threads/:threadId/messages', (req, res) => {
    const limit = readStringField(req, 'limit');
    const before = readStringField(req, 'before');
    const messages = store.listMessages(
      req.params.threadId,
      limit ? parseInt(limit, 10) : 100,
      before ? parseInt(before, 10) : undefined,
    );
    res.json(messages);
  });

  router.post('/threads/:threadId/messages', (req, res) => {
    const { content } = req.body;
    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const threadId = req.params.threadId;
    const thread = store.getThread(threadId);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    // Store user message
    const message = store.createMessage(threadId, 'user', content);

    // Auto-title: first 60 chars of first user message
    const allMessages = store.listMessages(threadId);
    const userMessages = allMessages.filter((m) => m.role === 'user');
    if (userMessages.length === 1 && thread.title === 'New Thread') {
      const autoTitle = content.slice(0, 60) + (content.length > 60 ? '...' : '');
      store.updateThreadTitle(threadId, autoTitle);
    }

    // Broadcast the user message
    broadcast(threadId, 'thread_message', message);

    // Trigger the LLM session (fire-and-forget — streams via WebSocket)
    sessionManager.startSession(threadId).catch((err) => {
      console.error(`[trellis] Session error for thread ${threadId}:`, err);
    });

    res.status(201).json(message);
  });

  // ── Annotations ────────────────────────────────────────────

  // Resolve a thread's working-tree root for file-content lookups. Returns
  // null when the thread has no associated repo or the repo path is gone.
  function getThreadRepoPath(threadId: string): string | null {
    const thread = store.getThread(threadId);
    if (!thread?.repo_id) return null;
    const repo = store.getRepo(thread.repo_id);
    if (!repo || !existsSync(repo.path)) return null;
    return repo.path;
  }

  router.get('/threads/:threadId/annotations', async (req, res) => {
    const annotations = store.listAnnotations(req.params.threadId);
    const repoPath = getThreadRepoPath(req.params.threadId);

    if (!repoPath) {
      // No repo to compare against → nothing can be stale.
      res.json(annotations.map((a) => ({ ...a, stale: false })));
      return;
    }

    const staleIds = await findStaleAnnotations(annotations, async (relPath) => {
      try {
        return await readFile(join(repoPath, relPath), 'utf-8');
      } catch {
        return null;
      }
    });

    res.json(annotations.map((a) => ({ ...a, stale: staleIds.has(a.id) })));
  });

  router.post('/threads/:threadId/annotations', async (req, res) => {
    const { target_type, target_ref, annotation_type, text, replacement } = req.body;
    let context_snippet: string | undefined;

    // For diff_line annotations, capture a 3-line snippet of the current
    // working-tree content so future renders can detect staleness.
    if (target_type === 'diff_line' && typeof target_ref === 'string') {
      const ref = parseDiffLineRef(target_ref);
      const repoPath = getThreadRepoPath(req.params.threadId);
      if (ref && repoPath) {
        try {
          const content = await readFile(join(repoPath, ref.path), 'utf-8');
          context_snippet = captureSnippet(content, ref.line);
        } catch {
          // File missing/unreadable — leave snippet empty; comparator treats
          // missing snippets as fresh, which is a safer default than
          // mass-marking-stale on the very first read.
        }
      }
    }

    const annotation = store.createAnnotation(req.params.threadId, {
      target_type,
      target_ref,
      annotation_type,
      text,
      replacement,
      context_snippet,
    });
    res.status(201).json(annotation);
  });

  router.delete('/annotations/:id', (req, res) => {
    store.deleteAnnotation(req.params.id);
    res.status(204).end();
  });

  router.patch('/annotations/:id/resolve', (req, res) => {
    const annotation = store.getAnnotation(req.params.id);
    if (!annotation) {
      res.status(404).json({ error: 'Annotation not found' });
      return;
    }
    store.resolveAnnotationsByIds([req.params.id]);
    const updated = store.getAnnotation(req.params.id);
    res.json(updated);
  });

  // ── Review: Send Feedback ─────────────────────────────────

  // Selectively send annotations as feedback to the LLM
  router.post('/threads/:threadId/send-feedback', (req, res) => {
    const { annotationIds } = req.body as { annotationIds: string[] };
    const threadId = req.params.threadId;
    const thread = store.getThread(threadId);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }

    if (!annotationIds || annotationIds.length === 0) {
      res.status(400).json({ error: 'annotationIds is required' });
      return;
    }

    // Get the selected annotations
    const allAnnotations = store.listAnnotations(threadId);
    const selected = allAnnotations.filter((a) => annotationIds.includes(a.id) && a.resolved === 0);

    if (selected.length === 0) {
      res.status(400).json({ error: 'No unresolved annotations found for the given IDs' });
      return;
    }

    // Format feedback and inject as a user message
    const feedback = formatFeedback(selected);
    const message = store.createMessage(threadId, 'user', feedback);

    // Mark selected annotations as resolved
    store.resolveAnnotationsByIds(annotationIds);

    // Broadcast the message
    broadcast(threadId, 'thread_message', message);

    // Trigger LLM session
    sessionManager.startSession(threadId).catch((err) => {
      console.error(`[trellis] Session error for thread ${threadId}:`, err);
    });

    res.status(201).json({ message, resolvedCount: selected.length });
  });

  // ── Repos: Diff ───────────────────────────────────────────

  router.get('/repos/:id/diff', async (req, res) => {
    const repo = store.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

    if (!existsSync(repo.path)) {
      res.status(404).json({ error: 'Repo path not found on disk' });
      return;
    }

    try {
      const baseRef = readStringField(req, 'base');
      const diff = await getDiffSummary(repo.path, baseRef);
      res.json(diff);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get diff' });
    }
  });

  router.get('/repos/:id/diff/file', async (req, res) => {
    const repo = store.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

    const filePath = readStringField(req, 'path');
    if (!filePath) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }

    try {
      const baseRef = readStringField(req, 'base');
      const fileDiff = await getFileDiff(repo.path, filePath, baseRef);
      res.json(fileDiff);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to get file diff' });
    }
  });

  router.post('/repos/:id/stage', async (req, res) => {
    const repo = store.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

    const { filePath } = req.body;
    if (!filePath) {
      res.status(400).json({ error: 'filePath is required' });
      return;
    }

    try {
      await stageFile(repo.path, filePath);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to stage file' });
    }
  });

  router.post('/repos/:id/revert', async (req, res) => {
    const repo = store.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

    const { filePath, baseRef } = req.body;
    if (!filePath) {
      res.status(400).json({ error: 'filePath is required' });
      return;
    }

    try {
      await revertFile(repo.path, filePath, baseRef);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to revert file' });
    }
  });

  // ── Repos: Plan ───────────────────────────────────────────

  router.get('/repos/:id/plan', async (req, res) => {
    const repo = store.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

    try {
      const content = await readPlanFile(repo.path);
      if (content === null) {
        res.json({ exists: false, steps: [], raw: '' });
        return;
      }
      const steps = parsePlan(content);
      res.json({ exists: true, steps, raw: content });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to read plan' });
    }
  });

  // ── Repos: Branches ────────────────────────────────────────

  router.get('/repos/:id/branches', async (req, res) => {
    const repo = store.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

    if (!existsSync(repo.path)) {
      res.status(404).json({ error: 'Repo path not found on disk' });
      return;
    }

    try {
      const branches = await listBranches(repo.path);
      res.json(branches);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list branches' });
    }
  });

  router.post('/repos/:id/checkout', async (req, res) => {
    const repo = store.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

    const { branch } = req.body;
    if (!branch) {
      res.status(400).json({ error: 'branch is required' });
      return;
    }

    try {
      await checkoutBranch(repo.path, branch);
      const current = await getCurrentBranch(repo.path);
      // Update repo record in DB
      store.updateRepoBranch(repo.id, current);
      // Broadcast repo_update so sidebar + diff panel refresh
      broadcast('*', 'repo_update', { repoId: repo.id, branch: current });
      res.json({ ok: true, branch: current });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to checkout branch' });
    }
  });

  router.post('/repos/:id/create-branch', async (req, res) => {
    const repo = store.getRepo(req.params.id);
    if (!repo) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

    const { branch, startPoint } = req.body;
    if (!branch) {
      res.status(400).json({ error: 'branch is required' });
      return;
    }

    try {
      await createBranch(repo.path, branch, startPoint);
      const current = await getCurrentBranch(repo.path);
      store.updateRepoBranch(repo.id, current);
      broadcast('*', 'repo_update', { repoId: repo.id, branch: current });
      res.json({ ok: true, branch: current });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create branch' });
    }
  });

  // ── Providers ──────────────────────────────────────────────

  router.get('/providers', (_req, res) => {
    const providers = store.listProviders();
    res.json(providers);
  });

  router.post('/providers', (req, res) => {
    const { name, type, base_url, default_model } = req.body;
    if (!name || !type) {
      res.status(400).json({ error: 'name and type are required' });
      return;
    }
    const provider = store.createProvider(name, type, base_url, default_model);
    res.status(201).json(provider);
  });

  router.patch('/providers/:id', (req, res) => {
    const { name, base_url, default_model } = req.body;
    const provider = store.updateProvider(req.params.id, { name, base_url, default_model });
    if (!provider) {
      res.status(404).json({ error: 'Provider not found' });
      return;
    }
    res.json(provider);
  });

  router.delete('/providers/:id', (req, res) => {
    store.deleteProvider(req.params.id);
    res.status(204).end();
  });

  // ── Adapters (runtime LLM adapter registration) ───────────

  router.get('/adapters', (_req, res) => {
    const adapters = listAdapters().map((a) => ({
      providerId: a.providerId,
      displayName: a.displayName,
    }));
    res.json(adapters);
  });

  router.post('/adapters/register', (req, res) => {
    const { type, apiKey, baseUrl } = req.body as { type: string; apiKey?: string; baseUrl?: string };
    if (!type) {
      res.status(400).json({ error: 'type is required' });
      return;
    }

    try {
      switch (type) {
        case 'anthropic':
          if (!apiKey) { res.status(400).json({ error: 'apiKey is required for anthropic' }); return; }
          registerAdapter(new AnthropicAdapter(apiKey));
          break;
        case 'openai':
          if (!apiKey) { res.status(400).json({ error: 'apiKey is required for openai' }); return; }
          registerAdapter(new OpenAIAdapter(apiKey));
          break;
        case 'ollama':
          registerAdapter(new OllamaAdapter(baseUrl ?? undefined));
          break;
        case 'custom':
          if (!apiKey || !baseUrl) { res.status(400).json({ error: 'apiKey and baseUrl are required for custom' }); return; }
          registerAdapter(new CustomAdapter(`custom_${Date.now()}`, 'Custom', baseUrl, apiKey));
          break;
        default:
          res.status(400).json({ error: `Unknown provider type: ${type}` });
          return;
      }

      console.log(`[trellis] ${type} adapter registered via API`);
      res.json({ ok: true, type });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to register adapter' });
    }
  });

  // ── Settings ───────────────────────────────────────────────

  router.get('/settings/:key', (req, res) => {
    const value = store.getSetting(req.params.key);
    if (value === undefined) {
      res.status(404).json({ error: 'Setting not found' });
      return;
    }
    res.json({ key: req.params.key, value });
  });

  router.put('/settings/:key', (req, res) => {
    const { value } = req.body;
    store.setSetting(req.params.key, value);
    res.json({ key: req.params.key, value });
  });

  // ── Error Log ──────────────────────────────────────────────

  router.post('/errors', (req, res) => {
    const { message, stack, componentStack, label } = req.body ?? {};
    const entry = {
      timestamp: new Date().toISOString(),
      message: typeof message === 'string' ? message : String(message ?? ''),
      stack: typeof stack === 'string' ? stack : null,
      componentStack: typeof componentStack === 'string' ? componentStack : null,
      label: typeof label === 'string' ? label : null,
    };
    try {
      const logPath = join(homedir(), '.trellis', 'errors.log');
      appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to write error log' });
    }
  });

  // ── Workspace Path Check ───────────────────────────────────

  router.get('/check-paths', (_req, res) => {
    const workspaces = store.listWorkspaces();
    const missing: Array<{ type: 'workspace' | 'repo'; id: string; name: string; path: string }> = [];

    for (const ws of workspaces) {
      if (!existsSync(ws.path)) {
        missing.push({ type: 'workspace', id: ws.id, name: ws.name, path: ws.path });
      }
      const repos = store.listRepos(ws.id);
      for (const repo of repos) {
        if (!existsSync(repo.path)) {
          missing.push({ type: 'repo', id: repo.id, name: repo.name, path: repo.path });
        }
      }
    }

    res.json({ missing, count: missing.length });
  });

  // ── MCP Servers ────────────────────────────────────────────

  // List configured servers. `workspace_id` is optional — when provided, live
  // status (state, pid, tool list, stderr tail) from the MCP manager for that
  // workspace is merged in so the Settings UI can show what's actually running.
  router.get('/mcp/servers', async (req, res) => {
    try {
      const workspaceId = readStringField(req, 'workspace_id');
      let merged: Record<string, MergedMCPServer> = {};

      if (workspaceId) {
        const ws = store.getWorkspace(workspaceId);
        if (!ws) {
          res.status(404).json({ error: 'Workspace not found' });
          return;
        }
        merged = await loadMergedConfig(ws.path);
      } else {
        const user = await loadUserConfig();
        for (const [name, cfg] of Object.entries(user.mcpServers)) {
          merged[name] = { ...cfg, source: 'user' };
        }
      }

      const liveStatus = workspaceId ? mcpManager.getStatus(workspaceId) : [];
      const statusMap = new Map(liveStatus.map((s) => [s.name, s]));

      const servers = Object.entries(merged).map(([name, cfg]) => {
        const live = statusMap.get(name);
        const transport = transportTypeOf(cfg);
        const stdio = transport === 'stdio' ? (cfg as { command: string; args?: string[]; env?: Record<string, string>; cwd?: string }) : null;
        const http = transport !== 'stdio' ? (cfg as { url: string; headers?: Record<string, string> }) : null;
        return {
          name,
          source: cfg.source,
          transport,
          command: stdio?.command ?? null,
          args: stdio?.args ?? [],
          env: stdio?.env ?? {},
          cwd: stdio?.cwd ?? null,
          url: http?.url ?? null,
          headers: http?.headers ?? {},
          state: live?.state ?? 'idle',
          toolCount: live?.toolCount ?? 0,
          tools: live?.tools ?? [],
          error: live?.error ?? null,
          pid: live?.pid ?? null,
          stderrTail: live?.stderrTail ?? [],
        };
      });
      res.json(servers);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list MCP servers' });
    }
  });

  router.post('/mcp/servers', async (req, res) => {
    const { name, config } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      res.status(400).json({ error: 'name must match [a-zA-Z0-9_-]+ (used in tool namespace mcp__<name>__<tool>)' });
      return;
    }
    const parsed = MCPServerConfigSchema.safeParse(config);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const current = await loadUserConfig();
      if (current.mcpServers[name]) {
        res.status(409).json({ error: `Server "${name}" already exists` });
        return;
      }
      current.mcpServers[name] = parsed.data;
      await saveUserConfig(current);
      res.status(201).json({ name, ...parsed.data, source: 'user' });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save MCP server' });
    }
  });

  router.put('/mcp/servers/:name', async (req, res) => {
    const name = req.params.name;
    const parsed = MCPServerConfigSchema.safeParse(req.body?.config);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    try {
      const current = await loadUserConfig();
      current.mcpServers[name] = parsed.data;
      await saveUserConfig(current);
      res.json({ name, ...parsed.data, source: 'user' });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update MCP server' });
    }
  });

  router.delete('/mcp/servers/:name', async (req, res) => {
    const name = req.params.name;
    try {
      const current = await loadUserConfig();
      if (!(name in current.mcpServers)) {
        res.status(404).json({ error: 'Server not found in user config' });
        return;
      }
      delete current.mcpServers[name];
      await saveUserConfig(current);
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete MCP server' });
    }
  });

  // Reload a single server (useful after editing env vars or fixing a crash).
  // Requires a workspace_id because servers run per-workspace.
  router.post('/mcp/servers/:name/reload', async (req, res) => {
    const name = req.params.name;
    const workspaceId = readStringField(req, 'workspace_id');
    if (!workspaceId) {
      res.status(400).json({ error: 'workspace_id is required' });
      return;
    }
    const ws = store.getWorkspace(workspaceId);
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    try {
      const status = await mcpManager.reloadServer(workspaceId, ws.path, name);
      if (!status) {
        res.status(404).json({ error: 'Server not found in merged config for workspace' });
        return;
      }
      res.json(status);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to reload MCP server' });
    }
  });

  // Trigger the OAuth authorization flow on http/sse servers. Surfaced as
  // the "Authorize" button in Settings → MCP. Also callable directly via
  // `curl -X POST .../authorize -d '{"workspace_id":"…"}'`.
  router.post('/mcp/servers/:name/authorize', async (req, res) => {
    const name = req.params.name;
    const workspaceId = readStringField(req, 'workspace_id');
    if (!workspaceId) {
      res.status(400).json({ error: 'workspace_id is required' });
      return;
    }
    const ws = store.getWorkspace(workspaceId);
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    try {
      const status = await mcpManager.authorizeServer(workspaceId, ws.path, name);
      if (!status) {
        res.status(404).json({ error: 'Server not found in merged config for workspace' });
        return;
      }
      res.json(status);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'OAuth authorization failed' });
    }
  });

  // Clear persisted OAuth artifacts for an http/sse server — tokens, DCR
  // client info, PKCE verifier, discovery cache — and reload so the
  // transport reconnects unauthenticated. Surfaced as the "Sign out"
  // button in Settings → MCP.
  router.delete('/mcp/servers/:name/authorization', async (req, res) => {
    const name = req.params.name;
    const workspaceId = readStringField(req, 'workspace_id');
    if (!workspaceId) {
      res.status(400).json({ error: 'workspace_id is required' });
      return;
    }
    const ws = store.getWorkspace(workspaceId);
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    try {
      const status = await mcpManager.signOutServer(workspaceId, ws.path, name);
      if (!status) {
        res.status(404).json({ error: 'Server not found in merged config for workspace' });
        return;
      }
      res.json(status);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Sign-out failed' });
    }
  });

  // Reload every server for a workspace — matches the UI "Reload all" button.
  router.post('/mcp/reload-all', async (req, res) => {
    const workspaceId = readStringField(req, 'workspace_id');
    if (!workspaceId) {
      res.status(400).json({ error: 'workspace_id is required' });
      return;
    }
    const ws = store.getWorkspace(workspaceId);
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    try {
      const statuses = await mcpManager.reloadAll(workspaceId, ws.path);
      res.json(statuses);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to reload MCP servers' });
    }
  });

  // Detect existing Claude Code MCP configs so the UI can offer an import.
  router.get('/mcp/claude-code-candidates', async (_req, res) => {
    try {
      const candidates = await detectClaudeCodeConfigs();
      res.json(candidates);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to detect Claude Code configs' });
    }
  });

  // Import a set of servers into the user-level config. `overwrite=false` skips
  // existing names; `overwrite=true` replaces them. Per-entry validation so a
  // single malformed entry doesn't reject the whole batch.
  router.post('/mcp/import', async (req, res) => {
    const { servers, overwrite } = req.body ?? {};
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
      res.status(400).json({ error: 'servers must be an object keyed by server name' });
      return;
    }
    try {
      const current = await loadUserConfig();
      let imported = 0;
      let skipped = 0;
      const invalid: Array<{ name: string; error: string }> = [];
      for (const [name, rawCfg] of Object.entries(servers as Record<string, unknown>)) {
        const parsed = MCPServerConfigSchema.safeParse(rawCfg);
        if (!parsed.success) {
          invalid.push({ name, error: parsed.error.issues.map((i) => i.message).join('; ') });
          continue;
        }
        if (current.mcpServers[name] && !overwrite) {
          skipped++;
          continue;
        }
        current.mcpServers[name] = parsed.data;
        imported++;
      }
      await saveUserConfig(current);
      res.json({ imported, skipped, invalid });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to import MCP servers' });
    }
  });

  return router;
}

import { Router } from 'express';
import type { ServerContext } from './server.js';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { getDiffSummary, getFileDiff, stageFile, revertFile, readPlanFile, listBranches, checkoutBranch, createBranch, getCurrentBranch } from '../git/operations.js';
import { formatFeedback } from '../review/feedback.js';
import { parsePlan } from '../review/plan-parser.js';

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
    const { workspace_id, repo_id } = req.query;
    const threads = store.listThreads(
      workspace_id as string | undefined,
      repo_id as string | undefined,
    );
    res.json(threads);
  });

  router.post('/threads', (req, res) => {
    const thread = store.createThread(req.body);
    res.status(201).json(thread);
  });

  // Thread search must come before /threads/:id to avoid "search" matching as :id
  router.get('/threads/search', (req, res) => {
    const q = req.query.q as string;
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
    const { title, status } = req.body;
    if (title) store.updateThreadTitle(req.params.id, title);
    if (status) {
      store.updateThreadStatus(req.params.id, status);
      broadcast(req.params.id, 'thread_status', { status });
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

  // ── Messages ───────────────────────────────────────────────

  router.get('/threads/:threadId/messages', (req, res) => {
    const { before, limit } = req.query;
    const messages = store.listMessages(
      req.params.threadId,
      limit ? parseInt(limit as string, 10) : 100,
      before ? parseInt(before as string, 10) : undefined,
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

  router.get('/threads/:threadId/annotations', (req, res) => {
    const annotations = store.listAnnotations(req.params.threadId);
    res.json(annotations);
  });

  router.post('/threads/:threadId/annotations', (req, res) => {
    const annotation = store.createAnnotation(req.params.threadId, req.body);
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
      const baseRef = req.query.base as string | undefined;
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

    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }

    try {
      const baseRef = req.query.base as string | undefined;
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

  return router;
}

import Database from 'better-sqlite3';
import type {
  Workspace,
  Repo,
  Thread,
  Message,
  Annotation,
  Provider,
  CreateWorkspaceRequest,
  CreateThreadRequest,
  CreateAnnotationRequest,
  SendMessageRequest,
  ThreadStatus,
} from '../shared/types.js';
import { v4 as uuid } from 'uuid';
import { DEFAULT_WORKSPACE_COLOR, DEFAULT_PROVIDER, DEFAULT_MODEL } from '../shared/constants.js';

export class Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initialize();
    this.migrate();
  }

  private initialize(): void {
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_COLOR}',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        current_branch TEXT,
        default_branch TEXT DEFAULT 'main',
        remote_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        repo_id TEXT REFERENCES repos(id) ON DELETE SET NULL,
        title TEXT NOT NULL DEFAULT 'New Thread',
        provider TEXT NOT NULL DEFAULT '${DEFAULT_PROVIDER}',
        model TEXT NOT NULL DEFAULT '${DEFAULT_MODEL}',
        system_prompt TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        base_commit TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_name TEXT,
        tool_use_id TEXT,
        token_count INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, id);

      CREATE TABLE IF NOT EXISTS annotations (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL,
        target_ref TEXT NOT NULL,
        annotation_type TEXT NOT NULL,
        text TEXT NOT NULL,
        replacement TEXT,
        resolved INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_annotations_thread ON annotations(thread_id);

      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        base_url TEXT,
        default_model TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  // ── Workspaces ─────────────────────────────────────────────

  listWorkspaces(): Workspace[] {
    return this.db.prepare('SELECT * FROM workspaces ORDER BY sort_order, name').all() as Workspace[];
  }

  getWorkspace(id: string): Workspace | undefined {
    return this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Workspace | undefined;
  }

  createWorkspace(req: CreateWorkspaceRequest): Workspace {
    const id = uuid();
    const color = req.color ?? DEFAULT_WORKSPACE_COLOR;
    this.db.prepare(
      'INSERT INTO workspaces (id, name, path, color) VALUES (?, ?, ?, ?)'
    ).run(id, req.name, req.path, color);
    return this.getWorkspace(id)!;
  }

  updateWorkspaceColor(id: string, color: string): void {
    this.db.prepare('UPDATE workspaces SET color = ? WHERE id = ?').run(color, id);
  }

  deleteWorkspace(id: string): void {
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  }

  // ── Repos ──────────────────────────────────────────────────

  listRepos(workspaceId: string): Repo[] {
    return this.db.prepare('SELECT * FROM repos WHERE workspace_id = ? ORDER BY name').all(workspaceId) as Repo[];
  }

  getRepo(id: string): Repo | undefined {
    return this.db.prepare('SELECT * FROM repos WHERE id = ?').get(id) as Repo | undefined;
  }

  createRepo(workspaceId: string, name: string, path: string, branch?: string, remoteUrl?: string): Repo {
    const id = uuid();
    this.db.prepare(
      'INSERT INTO repos (id, workspace_id, name, path, current_branch, remote_url) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, workspaceId, name, path, branch ?? null, remoteUrl ?? null);
    return this.getRepo(id)!;
  }

  updateRepoBranch(id: string, branch: string): void {
    this.db.prepare('UPDATE repos SET current_branch = ? WHERE id = ?').run(branch, id);
  }

  // ── Threads ────────────────────────────────────────────────

  listThreads(workspaceId?: string, repoId?: string): Thread[] {
    if (repoId) {
      return this.db.prepare(
        'SELECT * FROM threads WHERE repo_id = ? ORDER BY updated_at DESC'
      ).all(repoId) as Thread[];
    }
    if (workspaceId) {
      return this.db.prepare(
        'SELECT * FROM threads WHERE workspace_id = ? ORDER BY updated_at DESC'
      ).all(workspaceId) as Thread[];
    }
    return this.db.prepare('SELECT * FROM threads ORDER BY updated_at DESC').all() as Thread[];
  }

  getThread(id: string): Thread | undefined {
    return this.db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as Thread | undefined;
  }

  createThread(req: CreateThreadRequest): Thread {
    const id = uuid();
    this.db.prepare(
      `INSERT INTO threads (id, workspace_id, repo_id, title, provider, model, system_prompt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      req.workspace_id,
      req.repo_id ?? null,
      req.title ?? 'New Thread',
      req.provider ?? DEFAULT_PROVIDER,
      req.model ?? DEFAULT_MODEL,
      req.system_prompt ?? null,
    );
    return this.getThread(id)!;
  }

  updateThreadStatus(id: string, status: ThreadStatus): void {
    this.db.prepare(
      'UPDATE threads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(status, id);
  }

  updateThreadTitle(id: string, title: string): void {
    this.db.prepare(
      'UPDATE threads SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(title, id);
  }

  deleteThread(id: string): void {
    this.db.prepare('DELETE FROM threads WHERE id = ?').run(id);
  }

  // ── Messages ───────────────────────────────────────────────

  listMessages(threadId: string, limit = 100, beforeId?: number): Message[] {
    if (beforeId) {
      return this.db.prepare(
        'SELECT * FROM messages WHERE thread_id = ? AND id < ? ORDER BY id DESC LIMIT ?'
      ).all(threadId, beforeId, limit) as Message[];
    }
    return this.db.prepare(
      'SELECT * FROM messages WHERE thread_id = ? ORDER BY id ASC'
    ).all(threadId) as Message[];
  }

  createMessage(threadId: string, role: string, content: string, toolName?: string, toolUseId?: string): Message {
    const result = this.db.prepare(
      'INSERT INTO messages (thread_id, role, content, tool_name, tool_use_id) VALUES (?, ?, ?, ?, ?)'
    ).run(threadId, role, content, toolName ?? null, toolUseId ?? null);

    // Update thread's updated_at
    this.db.prepare('UPDATE threads SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(threadId);

    return this.db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid) as Message;
  }

  // ── Annotations ────────────────────────────────────────────

  listAnnotations(threadId: string, resolvedOnly = false): Annotation[] {
    if (resolvedOnly) {
      return this.db.prepare(
        'SELECT * FROM annotations WHERE thread_id = ? AND resolved = 0 ORDER BY created_at'
      ).all(threadId) as Annotation[];
    }
    return this.db.prepare(
      'SELECT * FROM annotations WHERE thread_id = ? ORDER BY created_at'
    ).all(threadId) as Annotation[];
  }

  createAnnotation(threadId: string, req: CreateAnnotationRequest): Annotation {
    const id = uuid();
    this.db.prepare(
      `INSERT INTO annotations (id, thread_id, target_type, target_ref, annotation_type, text, replacement)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, threadId, req.target_type, req.target_ref, req.annotation_type, req.text, req.replacement ?? null);
    return this.db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as Annotation;
  }

  markAnnotationsResolved(threadId: string): number {
    const result = this.db.prepare(
      'UPDATE annotations SET resolved = 1 WHERE thread_id = ? AND resolved = 0'
    ).run(threadId);
    return result.changes;
  }

  resolveAnnotationsByIds(ids: string[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const result = this.db.prepare(
      `UPDATE annotations SET resolved = 1 WHERE id IN (${placeholders}) AND resolved = 0`
    ).run(...ids);
    return result.changes;
  }

  getAnnotation(id: string): Annotation | undefined {
    return this.db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as Annotation | undefined;
  }

  deleteAnnotation(id: string): void {
    this.db.prepare('DELETE FROM annotations WHERE id = ?').run(id);
  }

  // ── Settings ───────────────────────────────────────────────

  getSetting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
    ).run(key, value, value);
  }

  // ── Providers ──────────────────────────────────────────────

  listProviders(): Provider[] {
    return this.db.prepare('SELECT * FROM providers ORDER BY name').all() as Provider[];
  }

  getProvider(id: string): Provider | undefined {
    return this.db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Provider | undefined;
  }

  createProvider(name: string, type: string, baseUrl?: string, defaultModel?: string): Provider {
    const id = uuid();
    this.db.prepare(
      'INSERT INTO providers (id, name, type, base_url, default_model) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name, type, baseUrl ?? null, defaultModel ?? null);
    return this.getProvider(id)!;
  }
}

import type { Store } from '../db/store.js';
import type { WSEventType } from '../shared/types.js';
import type { LLMAdapter } from '../llm/types.js';
import { runThread, type RunnerContext } from './runner.js';
import { getAdapter } from '../llm/adapter.js';
import { mcpManager } from '../mcp/manager.js';

export class SessionManager {
  private activeSessions = new Map<string, AbortController>();
  private ctx: RunnerContext;

  constructor(store: Store, broadcast: (threadId: string, type: WSEventType, data: unknown) => void) {
    this.ctx = { store, broadcast };
  }

  /**
   * Start an LLM session for a thread. If a session is already running
   * for this thread, it is aborted first.
   */
  async startSession(threadId: string): Promise<void> {
    // Abort any existing session for this thread
    this.abortSession(threadId);

    const thread = this.ctx.store.getThread(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);

    let adapter: LLMAdapter;
    try {
      adapter = getAdapter(thread.provider);
    } catch {
      this.ctx.store.updateThreadStatus(threadId, 'error');
      this.ctx.broadcast(threadId, 'thread_error', {
        error: `No adapter configured for provider: ${thread.provider}. Please add an API key in settings.`,
      });
      this.ctx.broadcast(threadId, 'thread_status', { status: 'error' });
      return;
    }

    const workspace = this.ctx.store.getWorkspace(thread.workspace_id);
    if (workspace) {
      await mcpManager.acquire(workspace.id, workspace.path, threadId);
    }

    const controller = new AbortController();
    this.activeSessions.set(threadId, controller);

    try {
      await runThread(threadId, adapter, this.ctx, controller.signal);
    } finally {
      this.activeSessions.delete(threadId);
      if (workspace) {
        await mcpManager.release(workspace.id, threadId);
      }
    }
  }

  abortSession(threadId: string): void {
    const controller = this.activeSessions.get(threadId);
    if (controller) {
      controller.abort();
      this.activeSessions.delete(threadId);
      this.ctx.store.updateThreadStatus(threadId, 'done');
      this.ctx.broadcast(threadId, 'thread_stream_end', {});
      this.ctx.broadcast(threadId, 'thread_status', { status: 'done' });
    }
  }

  isRunning(threadId: string): boolean {
    return this.activeSessions.has(threadId);
  }

  abortAll(): void {
    for (const [threadId, controller] of this.activeSessions) {
      controller.abort();
      this.ctx.store.updateThreadStatus(threadId, 'idle');
    }
    this.activeSessions.clear();
  }
}

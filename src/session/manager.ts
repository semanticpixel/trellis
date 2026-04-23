import type { Store } from '../db/store.js';
import type { WSEventType } from '../shared/types.js';
import type { LLMAdapter } from '../llm/types.js';
import { runThread, type RunnerContext } from './runner.js';
import { getAdapter } from '../llm/adapter.js';
import { mcpManager } from '../mcp/manager.js';

interface SessionEntry {
  controller: AbortController;
  done: Promise<void>;
}

export class SessionManager {
  private activeSessions = new Map<string, SessionEntry>();
  private ctx: RunnerContext;

  constructor(store: Store, broadcast: (threadId: string, type: WSEventType, data: unknown) => void) {
    this.ctx = { store, broadcast };
  }

  /**
   * Start an LLM session for a thread. If a session is already running
   * for this thread, it is aborted first — and we wait for the previous
   * runner to fully tear down before starting the new one.
   */
  async startSession(threadId: string): Promise<void> {
    await this.abortSession(threadId);

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
    const done = (async () => {
      try {
        await runThread(threadId, adapter, this.ctx, controller.signal);
      } finally {
        if (workspace) {
          try {
            await mcpManager.release(workspace.id, threadId);
          } catch (err) {
            console.error(`[trellis] mcpManager.release failed for ${threadId}:`, err);
          }
        }
        this.activeSessions.delete(threadId);
      }
    })();
    this.activeSessions.set(threadId, { controller, done });

    await done;
  }

  /**
   * Abort a running session and wait for the runner to fully tear down.
   * Callers that need to mutate messages (edit / regenerate) MUST await this
   * — otherwise the runner's in-flight `store.createMessage` can race with
   * a deleteMessagesAfterId and produce zombie rows against a truncated chain.
   */
  async abortSession(threadId: string): Promise<void> {
    const entry = this.activeSessions.get(threadId);
    if (!entry) return;
    entry.controller.abort();
    this.ctx.store.updateThreadStatus(threadId, 'done');
    this.ctx.broadcast(threadId, 'thread_stream_end', {});
    this.ctx.broadcast(threadId, 'thread_status', { status: 'done' });
    try {
      await entry.done;
    } catch {
      // Runner handles its own errors and resolves cleanly; this catch is
      // defensive in case a future change makes `done` reject.
    }
  }

  isRunning(threadId: string): boolean {
    return this.activeSessions.has(threadId);
  }

  abortAll(): void {
    for (const [threadId, entry] of this.activeSessions) {
      entry.controller.abort();
      this.ctx.store.updateThreadStatus(threadId, 'idle');
    }
    this.activeSessions.clear();
  }
}

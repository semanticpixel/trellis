import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';
import type { Express } from 'express';
import { Store } from '../db/store.js';
import { createRoutes } from './routes.js';
import type { ServerContext } from './server.js';
import type { SessionManager } from '../session/manager.js';
import type { WSEventType } from '../shared/types.js';

interface HarnessCall {
  fn: 'abortSession' | 'startSession' | 'deleteMessagesAfterId' | 'updateMessageContent';
  args: unknown[];
}

interface Harness {
  app: Express;
  store: Store;
  threadId: string;
  userMessageId: number;
  assistantMessageId: number;
  calls: HarnessCall[];
  broadcasts: Array<{ threadId: string; type: WSEventType; data: unknown }>;
  abortSessionSpy: ReturnType<typeof vi.fn>;
  startSessionSpy: ReturnType<typeof vi.fn>;
  cleanup: () => void;
}

function createHarness(opts: { isRunning?: boolean } = {}): Harness {
  const tmpDir = mkdtempSync(join(tmpdir(), 'trellis-routes-test-'));
  const store = new Store(join(tmpDir, 'test.db'));

  const ws = store.createWorkspace({ name: 'ws', path: join(tmpDir, 'ws') });
  const thread = store.createThread({ workspace_id: ws.id });
  const userMsg = store.createMessage(thread.id, 'user', 'hello');
  const assistantMsg = store.createMessage(thread.id, 'assistant', 'hi back');

  const calls: HarnessCall[] = [];
  const broadcasts: Array<{ threadId: string; type: WSEventType; data: unknown }> = [];

  // Wrap store methods so we can record call order alongside session manager calls.
  const originalDelete = store.deleteMessagesAfterId.bind(store);
  store.deleteMessagesAfterId = (tid: string, afterId: number) => {
    calls.push({ fn: 'deleteMessagesAfterId', args: [tid, afterId] });
    return originalDelete(tid, afterId);
  };
  const originalUpdate = store.updateMessageContent.bind(store);
  store.updateMessageContent = (id: number, content: string) => {
    calls.push({ fn: 'updateMessageContent', args: [id, content] });
    return originalUpdate(id, content);
  };

  const abortSessionSpy = vi.fn(async (tid: string) => {
    calls.push({ fn: 'abortSession', args: [tid] });
  });
  const startSessionSpy = vi.fn(async (tid: string) => {
    calls.push({ fn: 'startSession', args: [tid] });
  });

  const sessionManager = {
    abortSession: abortSessionSpy,
    startSession: startSessionSpy,
    isRunning: vi.fn(() => opts.isRunning ?? false),
    abortAll: vi.fn(),
  } as unknown as SessionManager;

  const broadcast = (threadId: string, type: WSEventType, data: unknown) => {
    broadcasts.push({ threadId, type, data });
  };

  const ctx: ServerContext = { store, broadcast, sessionManager };

  const app = express();
  app.use(express.json());
  app.use('/api', createRoutes(ctx));

  return {
    app,
    store,
    threadId: thread.id,
    userMessageId: userMsg.id,
    assistantMessageId: assistantMsg.id,
    calls,
    broadcasts,
    abortSessionSpy,
    startSessionSpy,
    cleanup: () => {
      store.close();
      rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

// Minimal fetch-like helper so we can hit the Express app without spinning up a
// real HTTP server. Uses a random port and `app.listen` only long enough to
// run one request.
async function request(
  app: Express,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no server address');
  const url = `http://127.0.0.1:${addr.port}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : undefined;
    return { status: res.status, body: parsed };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('PATCH /threads/:threadId/messages/:messageId', () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness();
  });

  afterEach(() => {
    h.cleanup();
  });

  it('happy path: aborts, deletes tail, updates content, broadcasts, restarts', async () => {
    const res = await request(h.app, 'PATCH', `/api/threads/${h.threadId}/messages/${h.userMessageId}`, {
      content: 'edited!',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      deleted: 1,
      message: { id: h.userMessageId, content: 'edited!' },
    });
    // Assistant message was deleted
    expect(h.store.listMessages(h.threadId).map((m) => m.id)).toEqual([h.userMessageId]);
    expect(h.store.getMessage(h.userMessageId)?.content).toBe('edited!');

    // Broadcast ordering: thread_truncated first, then thread_message
    const relevant = h.broadcasts.filter((b) =>
      b.type === 'thread_truncated' || b.type === 'thread_message',
    );
    expect(relevant.map((b) => b.type)).toEqual(['thread_truncated', 'thread_message']);
    expect(relevant[0].data).toEqual({ fromMessageId: h.userMessageId });
  });

  it('aborts BEFORE deleting / updating / restarting (correctness hazard)', async () => {
    await request(h.app, 'PATCH', `/api/threads/${h.threadId}/messages/${h.userMessageId}`, {
      content: 'safe edit',
    });
    const fnOrder = h.calls.map((c) => c.fn);
    const abortIdx = fnOrder.indexOf('abortSession');
    const deleteIdx = fnOrder.indexOf('deleteMessagesAfterId');
    const updateIdx = fnOrder.indexOf('updateMessageContent');
    const startIdx = fnOrder.indexOf('startSession');
    expect(abortIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeGreaterThan(abortIdx);
    expect(updateIdx).toBeGreaterThan(deleteIdx);
    expect(startIdx).toBeGreaterThan(updateIdx);
  });

  it('returns 404 when thread does not exist', async () => {
    const res = await request(
      h.app,
      'PATCH',
      `/api/threads/bogus/messages/${h.userMessageId}`,
      { content: 'x' },
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when message does not exist', async () => {
    const res = await request(h.app, 'PATCH', `/api/threads/${h.threadId}/messages/999999`, {
      content: 'x',
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when message belongs to a different thread', async () => {
    const otherThread = h.store.createThread({ workspace_id: h.store.listWorkspaces()[0].id });
    const otherMsg = h.store.createMessage(otherThread.id, 'user', 'other');
    const res = await request(
      h.app,
      'PATCH',
      `/api/threads/${h.threadId}/messages/${otherMsg.id}`,
      { content: 'x' },
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when target is an assistant message (role mismatch)', async () => {
    const res = await request(
      h.app,
      'PATCH',
      `/api/threads/${h.threadId}/messages/${h.assistantMessageId}`,
      { content: 'x' },
    );
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/user/i);
    // Must not call abort / delete / start when the role check fails.
    expect(h.abortSessionSpy).not.toHaveBeenCalled();
    expect(h.startSessionSpy).not.toHaveBeenCalled();
  });

  it('returns 400 when content is missing', async () => {
    const res = await request(
      h.app,
      'PATCH',
      `/api/threads/${h.threadId}/messages/${h.userMessageId}`,
      {},
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /threads/:threadId/regenerate', () => {
  let h: Harness;

  beforeEach(() => {
    h = createHarness();
  });

  afterEach(() => {
    h.cleanup();
  });

  it('truncates from the last user message and restarts the session', async () => {
    const res = await request(h.app, 'POST', `/api/threads/${h.threadId}/regenerate`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 1 });
    expect(h.store.listMessages(h.threadId).map((m) => m.id)).toEqual([h.userMessageId]);

    const truncated = h.broadcasts.find((b) => b.type === 'thread_truncated');
    expect(truncated?.data).toEqual({ fromMessageId: h.userMessageId });
  });

  it('aborts BEFORE deleting and restarting', async () => {
    await request(h.app, 'POST', `/api/threads/${h.threadId}/regenerate`);
    const fnOrder = h.calls.map((c) => c.fn);
    const abortIdx = fnOrder.indexOf('abortSession');
    const deleteIdx = fnOrder.indexOf('deleteMessagesAfterId');
    const startIdx = fnOrder.indexOf('startSession');
    expect(abortIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeGreaterThan(abortIdx);
    expect(startIdx).toBeGreaterThan(deleteIdx);
  });

  it('returns 400 when the thread has no user messages', async () => {
    // Delete the existing user message to simulate a thread with only non-user rows.
    h.store.deleteMessagesFromId(h.threadId, h.userMessageId);
    const res = await request(h.app, 'POST', `/api/threads/${h.threadId}/regenerate`);
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/no user message/i);
    expect(h.startSessionSpy).not.toHaveBeenCalled();
  });

  it('returns 404 when the thread does not exist', async () => {
    const res = await request(h.app, 'POST', `/api/threads/bogus/regenerate`);
    expect(res.status).toBe(404);
  });

  it('picks the most recent user message when multiple exist', async () => {
    const secondUser = h.store.createMessage(h.threadId, 'user', 'follow-up');
    h.store.createMessage(h.threadId, 'assistant', 'later response');
    await request(h.app, 'POST', `/api/threads/${h.threadId}/regenerate`);
    const truncated = h.broadcasts.find((b) => b.type === 'thread_truncated');
    expect(truncated?.data).toEqual({ fromMessageId: secondUser.id });
    // Only the "later response" row should have been deleted — first exchange intact.
    const ids = h.store.listMessages(h.threadId).map((m) => m.id);
    expect(ids).toContain(h.userMessageId);
    expect(ids).toContain(h.assistantMessageId);
    expect(ids).toContain(secondUser.id);
    expect(ids).toHaveLength(3);
  });
});

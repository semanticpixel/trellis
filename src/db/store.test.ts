import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Store } from './store.js';

describe('Store — message mutation helpers', () => {
  let tmpDir: string;
  let store: Store;
  let threadId: string;
  let otherThreadId: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'trellis-store-test-'));
    store = new Store(join(tmpDir, 'test.db'));
    const ws = store.createWorkspace({ name: 'ws', path: join(tmpDir, 'ws') });
    threadId = store.createThread({ workspace_id: ws.id }).id;
    otherThreadId = store.createThread({ workspace_id: ws.id }).id;
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function seed(id: string, roles: Array<'user' | 'assistant' | 'tool'>): number[] {
    return roles.map((r, i) => store.createMessage(id, r, `msg-${i}-${r}`).id);
  }

  describe('deleteMessagesAfterId', () => {
    it('deletes only messages with id > afterId in the given thread', () => {
      const ids = seed(threadId, ['user', 'assistant', 'user', 'assistant']);
      const deleted = store.deleteMessagesAfterId(threadId, ids[1]);
      expect(deleted).toBe(2);
      const remaining = store.listMessages(threadId).map((m) => m.id);
      expect(remaining).toEqual([ids[0], ids[1]]);
    });

    it('returns 0 and does not touch other threads when id has no later siblings', () => {
      const ids = seed(threadId, ['user', 'assistant']);
      seed(otherThreadId, ['user', 'assistant']);
      const deleted = store.deleteMessagesAfterId(threadId, ids[1]);
      expect(deleted).toBe(0);
      expect(store.listMessages(threadId)).toHaveLength(2);
      expect(store.listMessages(otherThreadId)).toHaveLength(2);
    });

    it('leaves other threads untouched even when afterId overlaps their range', () => {
      const a = seed(threadId, ['user', 'assistant']);
      seed(otherThreadId, ['user', 'assistant', 'user']);
      store.deleteMessagesAfterId(threadId, a[0]);
      expect(store.listMessages(threadId).map((m) => m.id)).toEqual([a[0]]);
      expect(store.listMessages(otherThreadId)).toHaveLength(3);
    });

    it('returns 0 for an empty thread', () => {
      const deleted = store.deleteMessagesAfterId(threadId, 999);
      expect(deleted).toBe(0);
    });

    it('bumps thread updated_at when rows were deleted', async () => {
      const ids = seed(threadId, ['user', 'assistant']);
      const before = store.getThread(threadId)!.updated_at;
      await new Promise((r) => setTimeout(r, 1100));
      store.deleteMessagesAfterId(threadId, ids[0]);
      const after = store.getThread(threadId)!.updated_at;
      expect(after).not.toBe(before);
    });
  });

  describe('deleteMessagesFromId', () => {
    it('deletes messages with id >= fromId, including the boundary row', () => {
      const ids = seed(threadId, ['user', 'assistant', 'user']);
      const deleted = store.deleteMessagesFromId(threadId, ids[1]);
      expect(deleted).toBe(2);
      expect(store.listMessages(threadId).map((m) => m.id)).toEqual([ids[0]]);
    });

    it('returns 0 when no matching rows exist', () => {
      expect(store.deleteMessagesFromId(threadId, 999)).toBe(0);
    });

    it('does not delete rows in a different thread that happen to share ids', () => {
      const a = seed(threadId, ['user', 'assistant']);
      const b = seed(otherThreadId, ['user', 'assistant']);
      store.deleteMessagesFromId(threadId, a[0]);
      expect(store.listMessages(threadId)).toHaveLength(0);
      expect(store.listMessages(otherThreadId).map((m) => m.id)).toEqual(b);
    });
  });

  describe('updateMessageContent', () => {
    it('updates content for a user message and returns the updated row', () => {
      const [userId] = seed(threadId, ['user']);
      const updated = store.updateMessageContent(userId, 'new content');
      expect(updated?.content).toBe('new content');
      expect(store.getMessage(userId)?.content).toBe('new content');
    });

    it('throws when called on a non-user message', () => {
      const [, assistantId] = seed(threadId, ['user', 'assistant']);
      expect(() => store.updateMessageContent(assistantId, 'x')).toThrow(/user messages/);
    });

    it('throws when called on a tool message', () => {
      const ids = seed(threadId, ['user', 'tool']);
      expect(() => store.updateMessageContent(ids[1], 'x')).toThrow(/user messages/);
    });

    it('returns undefined for a missing id', () => {
      expect(store.updateMessageContent(99999, 'x')).toBeUndefined();
    });

    it('bumps thread updated_at', async () => {
      const [userId] = seed(threadId, ['user']);
      const before = store.getThread(threadId)!.updated_at;
      await new Promise((r) => setTimeout(r, 1100));
      store.updateMessageContent(userId, 'updated');
      const after = store.getThread(threadId)!.updated_at;
      expect(after).not.toBe(before);
    });
  });
});

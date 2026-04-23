import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useThreadEvents } from './useWebSocket';
import type { WSEventType, Message, ThreadStatus } from '@shared/types';

interface ChatStreamState {
  /** Text currently being streamed (not yet persisted) */
  streamingText: string;
  /** Whether the LLM is currently streaming */
  isStreaming: boolean;
  /** Thread status */
  status: ThreadStatus;
  /** Last error message */
  error: string | null;
}

export function useChatStream(threadId: string | null): ChatStreamState {
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState<ThreadStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const handleEvent = useCallback((type: WSEventType, data: unknown) => {
    const d = data as Record<string, unknown>;

    switch (type) {
      case 'thread_stream_start':
        setStreamingText('');
        setIsStreaming(true);
        setError(null);
        break;

      case 'thread_stream_delta':
        if (d.text) {
          setStreamingText((prev) => prev + (d.text as string));
        }
        break;

      case 'thread_stream_end':
        setStreamingText('');
        setIsStreaming(false);
        break;

      case 'thread_message': {
        const msg = d as unknown as Message;
        // Append the new message directly into the React Query cache
        // so it's visible immediately without a refetch
        if (threadId) {
          qc.setQueryData<Message[]>(['messages', threadId], (prev) => {
            if (!prev) return [msg];
            // Avoid duplicates if the query refetched in the meantime
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }
        // Clear streaming text when we get the final assistant message
        if (msg.role === 'assistant' && !msg.tool_use_id) {
          setStreamingText('');
        }
        break;
      }

      case 'thread_status':
        setStatus(d.status as ThreadStatus);
        break;

      case 'thread_error':
        setError(d.error as string);
        setIsStreaming(false);
        break;

      case 'thread_truncated': {
        // Optimistically prune the message cache so truncation feels instant.
        // For edit: fromMessageId is the edited user message — keep it; the
        // PATCH invalidate refetches its updated content.
        // For regenerate: fromMessageId is the surviving user message.
        const fromMessageId = d.fromMessageId as number;
        if (threadId && typeof fromMessageId === 'number') {
          qc.setQueryData<Message[]>(['messages', threadId], (prev) =>
            prev?.filter((m) => m.id <= fromMessageId) ?? [],
          );
        }
        setStreamingText('');
        break;
      }
    }
  }, [threadId, qc]);

  useThreadEvents(threadId, handleEvent);

  return { streamingText, isStreaming, status, error };
}

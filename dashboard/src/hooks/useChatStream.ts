import { useState, useCallback } from 'react';
import { useThreadEvents } from './useWebSocket';
import type { WSEventType, Message, ThreadStatus } from '@shared/types';

interface ChatStreamState {
  /** Text currently being streamed (not yet persisted) */
  streamingText: string;
  /** Whether the LLM is currently streaming */
  isStreaming: boolean;
  /** Thread status */
  status: ThreadStatus;
  /** New messages received via WebSocket (append to query data) */
  newMessages: Message[];
  /** Last error message */
  error: string | null;
}

export function useChatStream(threadId: string | null): ChatStreamState {
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [status, setStatus] = useState<ThreadStatus>('idle');
  const [newMessages, setNewMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);

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

      case 'thread_message':
        setNewMessages((prev) => [...prev, d as unknown as Message]);
        // When we get the assistant message, clear streaming text
        if ((d as unknown as Message).role === 'assistant' && !(d as unknown as Message).tool_use_id) {
          setStreamingText('');
        }
        break;

      case 'thread_status':
        setStatus(d.status as ThreadStatus);
        break;

      case 'thread_error':
        setError(d.error as string);
        setIsStreaming(false);
        break;
    }
  }, []);

  useThreadEvents(threadId, handleEvent);

  return { streamingText, isStreaming, status, newMessages, error };
}

/**
 * Clear accumulated newMessages (call after merging into query cache).
 */
export function useClearNewMessages(): (setter: React.Dispatch<React.SetStateAction<Message[]>>) => void {
  return useCallback((setter) => setter([]), []);
}

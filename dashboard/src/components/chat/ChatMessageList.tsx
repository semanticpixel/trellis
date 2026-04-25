import { useEffect, useMemo, useRef } from 'react';
import type { Message } from '@shared/types';
import { ChatMessage } from './ChatMessage';
import styles from './ChatMessageList.module.css';

interface ChatMessageListProps {
  messages: Message[];
  streamingText: string;
  isStreaming: boolean;
  onOpenFile?: (path: string) => void;
}

export function ChatMessageList({ messages, streamingText, isStreaming, onOpenFile }: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText]);

  // Only the most recent user and most recent assistant-text message can be
  // edited/regenerated. Tool-call assistant messages (tool_use_id set) render
  // as ToolCallBlocks and don't carry their own action buttons.
  const { lastUserId, lastAssistantId } = useMemo(() => {
    let lu: number | null = null;
    let la: number | null = null;
    for (let i = messages.length - 1; i >= 0 && (lu === null || la === null); i--) {
      const m = messages[i];
      if (lu === null && m.role === 'user') lu = m.id;
      if (la === null && m.role === 'assistant' && !m.tool_use_id) la = m.id;
    }
    return { lastUserId: lu, lastAssistantId: la };
  }, [messages]);

  return (
    <div className={styles.list}>
      <div className={styles.inner}>
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            message={msg}
            onOpenFile={onOpenFile}
            disabled={isStreaming}
            isLastUser={msg.id === lastUserId}
            isLastAssistant={msg.id === lastAssistantId}
          />
        ))}

        {isStreaming && streamingText && (
          <div className={styles.streaming}>
            <ChatMessage
              message={{
                id: -1,
                thread_id: '',
                role: 'assistant',
                content: streamingText,
                tool_name: null,
                tool_use_id: null,
                token_count: null,
                images: null,
                created_at: '',
              }}
            />
          </div>
        )}

        {isStreaming && !streamingText && (
          <div className={styles.thinking}>
            <span className={styles.dot} />
            <span className={styles.dot} />
            <span className={styles.dot} />
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

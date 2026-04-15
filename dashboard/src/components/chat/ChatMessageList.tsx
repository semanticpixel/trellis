import { useEffect, useRef } from 'react';
import type { Message } from '@shared/types';
import { ChatMessage } from './ChatMessage';
import styles from './ChatMessageList.module.css';

interface ChatMessageListProps {
  messages: Message[];
  streamingText: string;
  isStreaming: boolean;
}

export function ChatMessageList({ messages, streamingText, isStreaming }: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText]);

  return (
    <div className={styles.list}>
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} />
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
  );
}

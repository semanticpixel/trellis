import type { Message } from '@shared/types';
import { ToolCallBlock } from './ToolCallBlock';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './ChatMessage.module.css';

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  // Tool use (assistant requesting a tool call)
  if (message.role === 'assistant' && message.tool_use_id) {
    return (
      <ToolCallBlock
        name={message.tool_name ?? 'unknown'}
        input={message.content}
        toolUseId={message.tool_use_id}
      />
    );
  }

  // Tool result
  if (message.role === 'tool') {
    return (
      <ToolCallBlock
        name={message.tool_name ?? 'unknown'}
        result={message.content}
        toolUseId={message.tool_use_id ?? ''}
      />
    );
  }

  const isUser = message.role === 'user';

  return (
    <div className={`${styles.message} ${isUser ? styles.user : styles.assistant}`}>
      <div className={styles.role}>{isUser ? 'You' : 'Assistant'}</div>
      <div className={styles.content}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const isInline = !className;
              if (isInline) {
                return <code className={styles.inlineCode} {...props}>{children}</code>;
              }
              return (
                <pre className={styles.codeBlock}>
                  <code className={className} {...props}>{children}</code>
                </pre>
              );
            },
          }}
        >
          {message.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

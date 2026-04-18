import type { Message } from '@shared/types';
import type { ThemedToken } from 'shiki';
import { useEffect, useState } from 'react';
import { ToolCallBlock } from './ToolCallBlock';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { highlightCode, languageFromMarkdownClass } from '../../utils/highlighter';
import styles from './ChatMessage.module.css';

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  if (message.role === 'assistant' && message.tool_use_id) {
    return (
      <ToolCallBlock
        name={message.tool_name ?? 'unknown'}
        input={message.content}
        toolUseId={message.tool_use_id}
      />
    );
  }

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
              const text = String(children).replace(/\n$/, '');
              return <ShikiCodeBlock code={text} className={className} />;
            },
          }}
        >
          {message.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

interface ShikiCodeBlockProps {
  code: string;
  className?: string;
}

function ShikiCodeBlock({ code, className }: ShikiCodeBlockProps) {
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  const lang = languageFromMarkdownClass(className);

  useEffect(() => {
    let cancelled = false;
    highlightCode(code, lang).then((res) => {
      if (!cancelled) setTokens(res.lines);
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  return (
    <pre className={styles.codeBlock}>
      <code className={className}>
        {tokens
          ? tokens.map((lineTokens, i) => (
              <span key={i} className={styles.codeLine}>
                {lineTokens.map((t, j) => (
                  <span key={j} style={t.color ? { color: t.color } : undefined}>
                    {t.content}
                  </span>
                ))}
                {'\n'}
              </span>
            ))
          : code}
      </code>
    </pre>
  );
}

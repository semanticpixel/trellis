import type { Message } from '@shared/types';
import type { ThemedToken } from 'shiki';
import { Fragment, useEffect, useState } from 'react';
import { ToolCallBlock } from './ToolCallBlock';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { highlightCode, languageFromMarkdownClass } from '../../utils/highlighter';
import { FileMention, tokenizeMentions } from './FileMention';
import styles from './ChatMessage.module.css';

interface ChatMessageProps {
  message: Message;
  onOpenFile?: (path: string) => void;
}

export function ChatMessage({ message, onOpenFile }: ChatMessageProps) {
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
        {isUser ? (
          <UserMessageContent text={message.content} onOpenFile={onOpenFile} />
        ) : (
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
        )}
      </div>
    </div>
  );
}

function UserMessageContent({ text, onOpenFile }: { text: string; onOpenFile?: (path: string) => void }) {
  const segments = tokenizeMentions(text);
  return (
    <p className={styles.userText}>
      {segments.map((seg, i) =>
        seg.kind === 'mention' ? (
          <FileMention key={i} path={seg.value} onOpen={onOpenFile} />
        ) : (
          <Fragment key={i}>{seg.value}</Fragment>
        ),
      )}
    </p>
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

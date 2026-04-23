import type { Message } from '@shared/types';
import type { ThemedToken } from 'shiki';
import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ToolCallBlock } from './ToolCallBlock';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { highlightCode, languageFromMarkdownClass } from '../../utils/highlighter';
import { FileMention, tokenizeMentions } from './FileMention';
import { useEditMessage, useRegenerate } from '../../hooks/useWorkspaces';
import styles from './ChatMessage.module.css';

interface ChatMessageProps {
  message: Message;
  onOpenFile?: (path: string) => void;
  /** When true, Edit/Regenerate are disabled (e.g. stream in flight). */
  disabled?: boolean;
}

export function ChatMessage({ message, onOpenFile, disabled }: ChatMessageProps) {
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
      <MessageActions message={message} disabled={disabled} onOpenFile={onOpenFile} />
    </div>
  );
}

interface MessageActionsProps {
  message: Message;
  disabled?: boolean;
  onOpenFile?: (path: string) => void;
}

function MessageActions({ message, disabled, onOpenFile }: MessageActionsProps) {
  const [editing, setEditing] = useState(false);
  const editMessage = useEditMessage();
  const regenerate = useRegenerate();
  const isUser = message.role === 'user';
  // Ephemeral streaming message has id === -1; don't show actions on it.
  const isPersisted = message.id > 0;

  if (editing && isUser) {
    return (
      <EditBox
        initial={message.content}
        onSave={(content) => {
          editMessage.mutate(
            { threadId: message.thread_id, messageId: message.id, content },
            { onSuccess: () => setEditing(false) },
          );
        }}
        onCancel={() => setEditing(false)}
        saving={editMessage.isPending}
      />
    );
  }

  return (
    <>
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
      {isPersisted && (
        <div className={styles.actions}>
          {isUser ? (
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => setEditing(true)}
              disabled={disabled}
              title="Edit message"
            >
              Edit
            </button>
          ) : (
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => regenerate.mutate(message.thread_id)}
              disabled={disabled || regenerate.isPending}
              title="Regenerate response"
            >
              Regenerate
            </button>
          )}
        </div>
      )}
    </>
  );
}

interface EditBoxProps {
  initial: string;
  onSave: (content: string) => void;
  onCancel: () => void;
  saving: boolean;
}

function EditBox({ initial, onSave, onCancel, saving }: EditBoxProps) {
  const [value, setValue] = useState(initial);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    // Caret at end, not selecting all content.
    el.setSelectionRange(el.value.length, el.value.length);
    // Auto-size to content
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    setValue(el.value);
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (value.trim().length > 0) onSave(value);
    }
  };

  return (
    <div className={styles.editBox}>
      <textarea
        ref={textareaRef}
        className={styles.editTextarea}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKey}
        disabled={saving}
      />
      <div className={styles.editActions}>
        <button
          type="button"
          className={styles.editSave}
          onClick={() => onSave(value)}
          disabled={saving || value.trim().length === 0}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className={styles.editCancel}
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
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

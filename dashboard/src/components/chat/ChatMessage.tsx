import type { Message } from '@shared/types';
import type { ThemedToken } from 'shiki';
import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Pencil, RefreshCw } from 'lucide-react';
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
  /** True only for the most recent user message — gates the Edit button. */
  isLastUser?: boolean;
  /** True only for the most recent assistant-text message — gates Regenerate. */
  isLastAssistant?: boolean;
}

export function ChatMessage({
  message,
  onOpenFile,
  disabled,
  isLastUser,
  isLastAssistant,
}: ChatMessageProps) {
  const [editing, setEditing] = useState(false);
  const editMessage = useEditMessage();
  const regenerate = useRegenerate();

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
  // Ephemeral streaming message has id === -1; no actions on it.
  const isPersisted = message.id > 0;
  const showEdit = isUser && isPersisted && isLastUser;
  const showRegenerate = !isUser && isPersisted && isLastAssistant;

  if (editing && showEdit) {
    return (
      <div className={`${styles.row} ${styles.rowUser}`}>
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
      </div>
    );
  }

  return (
    <div className={`${styles.row} ${isUser ? styles.rowUser : styles.rowAssistant}`}>
      <div className={`${styles.message} ${isUser ? styles.user : styles.assistant}`}>
        <div className={styles.content}>
          {isUser && message.images && message.images.length > 0 && (
            <ImageGrid paths={message.images} />
          )}
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
      {(showEdit || showRegenerate) && (
        <div className={styles.actions}>
          {showEdit && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => setEditing(true)}
              disabled={disabled}
              title="Edit message"
              aria-label="Edit message"
            >
              <Pencil size={14} />
            </button>
          )}
          {showRegenerate && (
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => regenerate.mutate(message.thread_id)}
              disabled={disabled || regenerate.isPending}
              title="Regenerate response"
              aria-label="Regenerate response"
            >
              <RefreshCw size={14} />
            </button>
          )}
        </div>
      )}
    </div>
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

// Editing a sent message only edits text in v1 — the attachment set is frozen
// at send time. See PLAN.md item 34 "Out of scope".
function ImageGrid({ paths }: { paths: string[] }) {
  return (
    <div className={styles.imageGrid}>
      {paths.map((p, i) => {
        const src = `/files/${p}`;
        return (
          <button
            key={`${p}_${i}`}
            type="button"
            className={styles.imageCell}
            onClick={() => window.open(src, '_blank', 'noopener,noreferrer')}
            title="Open image"
          >
            <img src={src} loading="lazy" alt="attached" className={styles.image} />
          </button>
        );
      })}
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

import { useState, useRef, useCallback, useEffect } from 'react';
import styles from './ChatComposer.module.css';

const DRAFT_PREFIX = 'trellis:draft:';

interface ChatComposerProps {
  threadId: string;
  onSend: (content: string) => void;
  disabled: boolean;
  isStreaming?: boolean;
  onAbort?: () => void;
  autoFocusToken?: number;
}

function readDraft(threadId: string): string {
  try {
    const raw = localStorage.getItem(`${DRAFT_PREFIX}${threadId}`);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as { content?: unknown };
    return typeof parsed?.content === 'string' ? parsed.content : '';
  } catch {
    return '';
  }
}

export function ChatComposer({ threadId, onSend, disabled, isStreaming = false, onAbort, autoFocusToken }: ChatComposerProps) {
  const [value, setValue] = useState(() => readDraft(threadId));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Resize textarea to fit a restored draft on mount.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta || !ta.value) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, []);

  // Token starts at 0 on initial app load; only user-initiated thread selects bump it.
  // Skip stealing focus when the user is already typing in another input (modal, search, etc).
  useEffect(() => {
    if (!autoFocusToken) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body) {
      const tag = active.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) return;
    }
    textareaRef.current?.focus();
  }, [autoFocusToken]);

  // Debounced draft persistence. Empty value clears the entry.
  useEffect(() => {
    const key = `${DRAFT_PREFIX}${threadId}`;
    const timeout = setTimeout(() => {
      if (!value) {
        localStorage.removeItem(key);
        return;
      }
      try {
        localStorage.setItem(key, JSON.stringify({ content: value, updatedAt: Date.now() }));
      } catch {
        // Best-effort: ignore quota / access errors.
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [threadId, value]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    localStorage.removeItem(`${DRAFT_PREFIX}${threadId}`);
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, onSend, threadId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    // Auto-resize
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  };

  return (
    <div className={styles.composer}>
      <div className={styles.inputWrap}>
        <textarea
          ref={textareaRef}
          className={styles.input}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
          rows={1}
          disabled={disabled}
        />
        {isStreaming && onAbort && (
          <button
            type="button"
            className={styles.stopButton}
            onClick={onAbort}
            title="Stop generating"
            aria-label="Stop generating"
          >
            <span className={styles.stopIcon} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

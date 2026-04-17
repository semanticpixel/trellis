import { useState, useRef, useCallback } from 'react';
import styles from './ChatComposer.module.css';

interface ChatComposerProps {
  onSend: (content: string) => void;
  disabled: boolean;
  isStreaming?: boolean;
  onAbort?: () => void;
}

export function ChatComposer({ onSend, disabled, isStreaming = false, onAbort }: ChatComposerProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, onSend]);

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

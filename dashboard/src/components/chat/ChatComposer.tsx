import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import styles from './ChatComposer.module.css';
import { MentionDropdown } from './MentionDropdown';
import { useFileSearch } from '../../hooks/useWorkspaces';

const DRAFT_PREFIX = 'trellis:draft:';

interface ChatComposerProps {
  threadId: string;
  workspaceId: string | null;
  repoId?: string | null;
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

interface MentionState {
  start: number; // offset of `@` in the textarea
  query: string;
}

const MENTION_QUERY_RE = /^[A-Za-z0-9_./-]*$/;

/**
 * Detect an in-progress @-mention at the current caret position.
 * Returns null when the user isn't currently typing one. The trigger only
 * fires when `@` follows a word boundary (start, whitespace, or `(`); typing
 * a space, newline, or other non-path char closes the mention.
 */
function detectMention(value: string, caret: number): MentionState | null {
  // Walk backwards from caret to find the most recent `@` that opens a mention.
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === '@') {
      const prev = i === 0 ? '' : value[i - 1];
      if (i !== 0 && !/\s|\(/.test(prev)) return null; // mid-word `@` (email, etc.)
      const query = value.slice(i + 1, caret);
      if (!MENTION_QUERY_RE.test(query)) return null;
      return { start: i, query };
    }
    // Path-like chars are valid inside the query window.
    if (/[A-Za-z0-9_./-]/.test(ch)) continue;
    // Anything else (whitespace, punctuation) closes the mention.
    return null;
  }
  return null;
}

export function ChatComposer({
  threadId,
  workspaceId,
  repoId,
  onSend,
  disabled,
  isStreaming = false,
  onAbort,
  autoFocusToken,
}: ChatComposerProps) {
  const [value, setValue] = useState(() => readDraft(threadId));
  const [mention, setMention] = useState<MentionState | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState<string>('');
  const [selectedIdx, setSelectedIdx] = useState(0);
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

  // Debounce the file-search query (120ms) so each keystroke doesn't fire a request.
  useEffect(() => {
    if (mention === null) {
      setDebouncedQuery('');
      return;
    }
    const t = setTimeout(() => setDebouncedQuery(mention.query), 120);
    return () => clearTimeout(t);
  }, [mention]);

  const search = useFileSearch(workspaceId, debouncedQuery, mention !== null, repoId ?? null);
  const results = useMemo(() => search.data?.results ?? [], [search.data]);

  // Reset selection when the result set changes.
  useEffect(() => {
    setSelectedIdx(0);
  }, [results]);

  const insertMention = useCallback(
    (path: string) => {
      if (!mention) return;
      const before = value.slice(0, mention.start);
      const after = value.slice(textareaRef.current?.selectionStart ?? mention.start + 1 + mention.query.length);
      const inserted = `@${path} `;
      const next = `${before}${inserted}${after}`;
      setValue(next);
      setMention(null);

      // Restore caret + auto-resize after React flushes the value back into the DOM.
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        const pos = before.length + inserted.length;
        ta.focus();
        ta.setSelectionRange(pos, pos);
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
      });
    },
    [mention, value],
  );

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    setMention(null);
    localStorage.removeItem(`${DRAFT_PREFIX}${threadId}`);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, disabled, onSend, threadId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention !== null && results.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => (i + 1) % results.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => (i - 1 + results.length) % results.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const choice = results[selectedIdx];
        if (choice) insertMention(choice);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const updateMention = (next: string, caret: number) => {
    const detected = detectMention(next, caret);
    setMention(detected);
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValue(next);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    updateMention(next, ta.selectionStart ?? next.length);
  };

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    updateMention(ta.value, ta.selectionStart ?? ta.value.length);
  };

  return (
    <div className={styles.composer}>
      <div className={styles.inner}>
        <div className={styles.inputWrap}>
        {mention !== null && (
          <MentionDropdown
            results={results}
            selectedIndex={selectedIdx}
            loading={search.isFetching}
            onSelect={insertMention}
            onHover={setSelectedIdx}
          />
        )}
        <textarea
          ref={textareaRef}
          className={styles.input}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onSelect={handleSelect}
          onBlur={() => setMention(null)}
          placeholder="Type a message... (Enter to send, Shift+Enter for newline, @ to mention a file)"
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
    </div>
  );
}

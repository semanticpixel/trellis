import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import styles from './ChatComposer.module.css';
import { MentionDropdown } from './MentionDropdown';
import { AttachmentStrip, type ComposerAttachment } from './AttachmentStrip';
import { useFileSearch, uploadImages } from '../../hooks/useWorkspaces';

const DRAFT_PREFIX = 'trellis:draft:';
const ATTACH_MAX_BYTES = 5 * 1024 * 1024;
const ATTACH_MAX_COUNT = 10;
const ATTACH_ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const ATTACH_ERROR_TIMEOUT_MS = 4000;

interface ChatComposerProps {
  threadId: string;
  workspaceId: string | null;
  repoId?: string | null;
  onSend: (content: string, images?: string[]) => void;
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
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragDepthRef = useRef(0);

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

  // Revoke any object URLs we created for thumbnails when the composer
  // unmounts, so we don't leak blob references between thread switches.
  useEffect(() => {
    return () => {
      for (const att of attachments) URL.revokeObjectURL(att.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-clear inline error after a few seconds.
  useEffect(() => {
    if (!attachError) return;
    const t = setTimeout(() => setAttachError(null), ATTACH_ERROR_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [attachError]);

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const accepted: ComposerAttachment[] = [];
      let rejectedSize = false;
      let rejectedType = false;
      for (const file of files) {
        if (!ATTACH_ALLOWED_MIME.has(file.type)) {
          rejectedType = true;
          continue;
        }
        if (file.size > ATTACH_MAX_BYTES) {
          rejectedSize = true;
          continue;
        }
        accepted.push({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          file,
          previewUrl: URL.createObjectURL(file),
        });
      }
      setAttachments((prev) => {
        const remaining = ATTACH_MAX_COUNT - prev.length;
        const slice = accepted.slice(0, Math.max(0, remaining));
        // Revoke previews we couldn't fit so blob memory isn't leaked.
        for (const dropped of accepted.slice(slice.length)) URL.revokeObjectURL(dropped.previewUrl);
        if (slice.length < accepted.length) {
          setAttachError(`Maximum ${ATTACH_MAX_COUNT} images per message`);
        }
        return [...prev, ...slice];
      });
      if (rejectedType) setAttachError('Only PNG, JPEG, GIF, or WebP images are supported');
      else if (rejectedSize) setAttachError(`Image too large (max ${ATTACH_MAX_BYTES / (1024 * 1024)} MB)`);
    },
    [],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim();
    // Allow image-only sends only if there is also at least 1 char of text —
    // empty string content would be rejected by the backend `content is
    // required` check, so coerce to a single space when only images are
    // attached.
    if (!trimmed && attachments.length === 0) return;
    if (disabled || uploading) return;

    let uploadedPaths: string[] = [];
    if (attachments.length > 0) {
      try {
        setUploading(true);
        uploadedPaths = await uploadImages(threadId, attachments.map((a) => a.file));
      } catch (err) {
        setAttachError(err instanceof Error ? err.message : 'Image upload failed');
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    const contentToSend = trimmed || (uploadedPaths.length > 0 ? '(image)' : '');
    onSend(contentToSend, uploadedPaths.length > 0 ? uploadedPaths : undefined);

    for (const att of attachments) URL.revokeObjectURL(att.previewUrl);
    setAttachments([]);
    setValue('');
    setMention(null);
    localStorage.removeItem(`${DRAFT_PREFIX}${threadId}`);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [value, attachments, disabled, uploading, onSend, threadId]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind !== 'file') continue;
        if (!item.type.startsWith('image/')) continue;
        const f = item.getAsFile();
        if (f) files.push(f);
      }
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    },
    [addFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      const images = files.filter((f) => f.type.startsWith('image/'));
      const nonImages = files.length - images.length;
      if (nonImages > 0 && images.length === 0) {
        setAttachError('Only image files are supported');
        return;
      }
      if (images.length > 0) addFiles(images);
    },
    [addFiles],
  );

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

  const showStop = isStreaming && onAbort;
  const showSpinner = uploading;

  return (
    <div
      className={styles.composer}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={styles.inner}>
        {attachError && <div className={styles.attachError} role="alert">{attachError}</div>}
        <AttachmentStrip
          attachments={attachments}
          onRemove={removeAttachment}
          disabled={uploading}
        />
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
          onPaste={handlePaste}
          onBlur={() => setMention(null)}
          placeholder="Type a message... (Enter to send, Shift+Enter for newline, @ to mention a file, paste/drop images)"
          rows={1}
          disabled={disabled || uploading}
        />
        {showSpinner && (
          <div
            className={styles.spinner}
            role="status"
            aria-label="Uploading images"
          />
        )}
        {!showSpinner && showStop && (
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
        {dragActive && (
          <div className={styles.dropOverlay} aria-hidden="true">
            Drop image to attach
          </div>
        )}
      </div>
    </div>
  );
}

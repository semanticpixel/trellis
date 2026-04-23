import { looksLikeFilePath, mentionTokenRegex } from '@shared/mention-regex';
import styles from './FileMention.module.css';

interface FileMentionProps {
  path: string;
  onOpen?: (path: string) => void;
}

export function FileMention({ path, onOpen }: FileMentionProps) {
  const slash = path.lastIndexOf('/');
  const base = slash === -1 ? path : path.slice(slash + 1);

  return (
    <button
      type="button"
      className={styles.pill}
      onClick={() => onOpen?.(path)}
      title={path}
    >
      <span className={styles.icon} aria-hidden="true">{'\u{1F4C4}'}</span>
      <span className={styles.label}>{base}</span>
    </button>
  );
}

interface Segment {
  kind: 'text' | 'mention';
  value: string;
}

/** Tokenize a string into plain-text spans and `@path` mentions, preserving order and surrounding whitespace. */
export function tokenizeMentions(text: string): Segment[] {
  const out: Segment[] = [];
  let lastIndex = 0;
  const re = mentionTokenRegex();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const path = m[1];
    if (!looksLikeFilePath(path)) continue;
    // Both alternatives in the leading group are zero-width (the `^` anchor
    // and the lookbehind), so the `@` is always at m.index.
    const atIdx = m.index;
    if (atIdx > lastIndex) {
      out.push({ kind: 'text', value: text.slice(lastIndex, atIdx) });
    }
    out.push({ kind: 'mention', value: path });
    lastIndex = atIdx + 1 + path.length;
  }
  if (lastIndex < text.length) {
    out.push({ kind: 'text', value: text.slice(lastIndex) });
  }
  return out;
}

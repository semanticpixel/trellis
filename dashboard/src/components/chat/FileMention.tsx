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

const TOKEN_RE = /(?:^|(?<=[\s(]))@([A-Za-z0-9_./-]+)/g;

/** Returns true if the path looks like a real file mention (has `/` or `.`) — same rule the backend uses. */
function looksLikeFilePath(path: string): boolean {
  if (path === '.' || path === '..' || path.startsWith('../')) return false;
  return path.includes('/') || path.includes('.');
}

interface Segment {
  kind: 'text' | 'mention';
  value: string;
}

/** Tokenize a string into plain-text spans and `@path` mentions, preserving order and surrounding whitespace. */
export function tokenizeMentions(text: string): Segment[] {
  const out: Segment[] = [];
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const path = m[1];
    if (!looksLikeFilePath(path)) continue;
    // The match starts at m.index, but the token itself starts at the `@`,
    // which is m.index OR m.index + 1 depending on whether the leading
    // alternative `^` matched (zero-width) or the lookbehind matched (also
    // zero-width). Both are zero-width here, so the `@` is always at m.index.
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

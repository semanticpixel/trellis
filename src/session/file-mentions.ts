import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { validatePath } from '../tools/validate-path.js';

const MAX_FILE_BYTES = 200 * 1024;
const BINARY_PROBE_BYTES = 8 * 1024;

/**
 * Match `@<path>` tokens. `<path>` is one or more characters from
 * [A-Za-z0-9_./-]; the `(?<![…])` lookbehind rejects email-like patterns
 * (foo@bar.com — the `o` before `@` blocks the match), and the leading
 * `(?:^|[\s(])` means the `@` must follow whitespace, an opening paren,
 * or be at the start of the message.
 */
const TOKEN_RE = /(?:^|(?<=[\s(]))@([A-Za-z0-9_./-]+)/g;

/** Returns the unique relative paths referenced by `@<path>` tokens, in order of first appearance. */
export function extractMentionPaths(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const path = m[1];
    // Reject paths with no slash AND no extension dot — likely a name like `@everyone`.
    // Allow `@README` or `@foo.txt` (basenames with extension or all-caps known names).
    // Conservative: require at least a `/` or a `.` somewhere.
    if (!path.includes('/') && !path.includes('.')) continue;
    // Reject pure dot/up traversal tokens.
    if (path === '.' || path === '..' || path.startsWith('../')) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

export interface ExpandedFile {
  path: string;
  content: string;
}

export type ExpandResult =
  | { ok: true; files: ExpandedFile[] }
  | { ok: false; error: string; path: string };

/**
 * Read each referenced file, validating it stays within the workspace.
 * Stops on the first failure (missing file, oversized, binary, traversal).
 */
export async function expandMentionedFiles(
  text: string,
  workspacePath: string,
): Promise<ExpandResult> {
  const paths = extractMentionPaths(text);
  const files: ExpandedFile[] = [];

  for (const relPath of paths) {
    const absPath = resolve(workspacePath, relPath);
    const pathError = validatePath(absPath, workspacePath);
    if (pathError) {
      return { ok: false, error: pathError, path: relPath };
    }

    let buf: Buffer;
    try {
      buf = await readFile(absPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `Could not read @${relPath}: ${msg}`, path: relPath };
    }

    if (buf.length > MAX_FILE_BYTES) {
      return {
        ok: false,
        error: `@${relPath} is too large (${buf.length} bytes; max ${MAX_FILE_BYTES})`,
        path: relPath,
      };
    }

    const probe = buf.subarray(0, BINARY_PROBE_BYTES);
    if (probe.includes(0)) {
      return { ok: false, error: `@${relPath} appears to be a binary file`, path: relPath };
    }

    files.push({ path: relPath, content: buf.toString('utf-8') });
  }

  return { ok: true, files };
}

/**
 * Wrap each file's content in a `<file path="…">` block, prepended in original
 * order ahead of the user's prompt. The original `@path` tokens stay in the
 * trailing prompt so the model can still see them as references.
 */
export function buildExpandedMessage(originalText: string, files: ExpandedFile[]): string {
  if (files.length === 0) return originalText;
  const blocks = files
    .map((f) => `<file path="${f.path}">\n${f.content}\n</file>`)
    .join('\n\n');
  return `${blocks}\n\n${originalText}`;
}

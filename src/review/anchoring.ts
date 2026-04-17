import type { Annotation } from '../shared/types.js';

/**
 * Shared anchoring utilities for review annotations. The same context-snippet
 * comparison drives staleness for both `diff_line` annotations (item 24) and
 * `plan_range` annotations (item 28). Keep this module agnostic of either —
 * callers translate snippets to/from their own anchoring model.
 */

const SNIPPET_RADIUS = 1; // 1 line above + target + 1 line below = 3-line snippet

/** Capture a context snippet centered on `lineNumber` (1-based). */
export function captureSnippet(fileContent: string, lineNumber: number): string {
  const lines = fileContent.split('\n');
  if (lineNumber < 1 || lineNumber > lines.length) return '';
  const start = Math.max(0, lineNumber - 1 - SNIPPET_RADIUS);
  const end = Math.min(lines.length, lineNumber + SNIPPET_RADIUS);
  return lines.slice(start, end).join('\n');
}

/**
 * Compare a stored snippet against the current snippet at the same anchor.
 * Returns true when they match (annotation is fresh). Whitespace-trimmed
 * line-by-line comparison so trailing-whitespace fixups don't trigger a
 * false stale.
 */
export function compareSnippet(stored: string | null, current: string): boolean {
  if (stored === null || stored === '') return true; // legacy row → assume fresh
  const a = stored.split('\n').map((l) => l.trimEnd());
  const b = current.split('\n').map((l) => l.trimEnd());
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Resolve a `diff_line` annotation's `target_ref` ("path:lineNumber") to its
 * line number. Returns null if the ref isn't parseable.
 */
export function parseDiffLineRef(targetRef: string): { path: string; line: number } | null {
  const idx = targetRef.lastIndexOf(':');
  if (idx === -1) return null;
  const path = targetRef.slice(0, idx);
  const line = parseInt(targetRef.slice(idx + 1), 10);
  if (!path || isNaN(line)) return null;
  return { path, line };
}

/**
 * Compute staleness for a batch of annotations against current file content.
 * `getFileContent(path)` returns the up-to-date text or null when the file
 * is unreadable/missing (which always counts as stale). Plan annotations
 * (item 28) will reuse this with a different `getFileContent` source.
 */
export async function findStaleAnnotations(
  annotations: Annotation[],
  getFileContent: (path: string) => Promise<string | null>,
): Promise<Set<string>> {
  const staleIds = new Set<string>();
  const fileCache = new Map<string, string | null>();

  for (const a of annotations) {
    if (a.target_type !== 'diff_line') continue;
    if (a.context_snippet === null || a.context_snippet === '') continue;

    const ref = parseDiffLineRef(a.target_ref);
    if (!ref) continue;

    let content = fileCache.get(ref.path);
    if (content === undefined) {
      content = await getFileContent(ref.path);
      fileCache.set(ref.path, content);
    }

    if (content === null) {
      staleIds.add(a.id);
      continue;
    }

    const current = captureSnippet(content, ref.line);
    if (!compareSnippet(a.context_snippet, current)) {
      staleIds.add(a.id);
    }
  }

  return staleIds;
}

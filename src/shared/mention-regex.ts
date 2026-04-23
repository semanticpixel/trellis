/**
 * Shared `@<path>` token grammar used by the backend runner (to expand
 * tokens into file blocks before calling the LLM) and the frontend message
 * renderer (to render tokens as pills). Keep these definitions in one place
 * — drift between sides means tokens render as pills but never expand, or
 * vice versa.
 *
 * Matches `@<path>` where `<path>` is one or more chars from
 * [A-Za-z0-9_./-]; the leading `(?:^|(?<=[\s(]))` requires the `@` to be at
 * the start of the string or right after whitespace / an opening paren —
 * blocking email-like patterns (`foo@bar.com`).
 *
 * `mentionTokenRegex()` returns a fresh `RegExp` each call so callers can
 * safely use `.exec` in a loop without sharing `lastIndex` state.
 */
export function mentionTokenRegex(): RegExp {
  return /(?:^|(?<=[\s(]))@([A-Za-z0-9_./-]+)/g;
}

/**
 * Path-shape filter applied after a regex match: rejects bare `@everyone`
 * style tokens (no `/` and no `.`) and parent-relative traversal. Both
 * sides apply this rule so the renderer never paints a pill the runner
 * wouldn't expand.
 */
export function looksLikeFilePath(path: string): boolean {
  if (path === '.' || path === '..' || path.startsWith('../')) return false;
  return path.includes('/') || path.includes('.');
}

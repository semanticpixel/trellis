import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { validatePath } from '../tools/validate-path.js';
import { looksLikeFilePath, mentionTokenRegex } from '../shared/mention-regex.js';

const MAX_FILE_BYTES = 200 * 1024;
const BINARY_PROBE_BYTES = 8 * 1024;

/** Returns the unique relative paths referenced by `@<path>` tokens, in order of first appearance. */
export function extractMentionPaths(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = mentionTokenRegex();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const path = m[1];
    if (!looksLikeFilePath(path)) continue;
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
 * Per-file read outcome stored in a `MentionFileCache`. We cache failures too
 * so a missing/oversized/binary file doesn't get re-probed on every tool-loop
 * iteration.
 */
type ReadResult = { ok: true; content: string } | { ok: false; error: string };

/**
 * Memoization cache keyed by relative path. Scope one cache to a single
 * `runThread` invocation so repeated tool-loop iterations re-use the same
 * snapshot of file contents — both an optimization (avoids redundant disk
 * reads) and a small correctness win (the LLM sees the same content for the
 * whole turn, even if a tool call edits the file mid-turn).
 */
export type MentionFileCache = Map<string, ReadResult>;

async function readMentionedFile(relPath: string, workspacePath: string): Promise<ReadResult> {
  const absPath = resolve(workspacePath, relPath);
  const pathError = validatePath(absPath, workspacePath);
  if (pathError) return { ok: false, error: pathError };

  let buf: Buffer;
  try {
    buf = await readFile(absPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not read @${relPath}: ${msg}` };
  }

  if (buf.length > MAX_FILE_BYTES) {
    return { ok: false, error: `@${relPath} is too large (${buf.length} bytes; max ${MAX_FILE_BYTES})` };
  }

  const probe = buf.subarray(0, BINARY_PROBE_BYTES);
  if (probe.includes(0)) {
    return { ok: false, error: `@${relPath} appears to be a binary file` };
  }

  return { ok: true, content: buf.toString('utf-8') };
}

/**
 * Read each referenced file, validating it stays within the workspace.
 * Stops on the first failure (missing file, oversized, binary, traversal).
 *
 * Pass a `cache` to memoize file reads across multiple calls within the same
 * `runThread` — without it the runner would re-read the same files on every
 * tool-loop iteration.
 */
export async function expandMentionedFiles(
  text: string,
  workspacePath: string,
  cache?: MentionFileCache,
): Promise<ExpandResult> {
  const paths = extractMentionPaths(text);
  const files: ExpandedFile[] = [];

  for (const relPath of paths) {
    let result = cache?.get(relPath);
    if (!result) {
      result = await readMentionedFile(relPath, workspacePath);
      cache?.set(relPath, result);
    }
    if (!result.ok) {
      return { ok: false, error: result.error, path: relPath };
    }
    files.push({ path: relPath, content: result.content });
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

import { readdir, stat } from 'fs/promises';
import { resolve, relative, basename, sep } from 'path';

const EXCLUDED_NAMES = new Set(['node_modules', 'dist', 'build', '.next', '.turbo', 'coverage']);

/**
 * Returns true if a directory entry should be skipped during a workspace walk.
 * Hidden entries (anything starting with `.`, including `.git`) and a small set
 * of well-known build/dependency dirs are always skipped. Used by `list_files`
 * (the LLM tool) and the `/files/search` route — keep the rules in one place
 * so both stay aligned.
 */
export function isExcludedEntry(name: string): boolean {
  if (name.startsWith('.')) return true;
  if (EXCLUDED_NAMES.has(name)) return true;
  return false;
}

interface FileMeta {
  rel: string; // relative path with `/` separators
  base: string;
  mtimeMs: number;
}

const MAX_FILES = 5000;
const MAX_RESULTS = 20;

async function walkWorkspace(rootAbs: string): Promise<FileMeta[]> {
  const out: FileMeta[] = [];
  const stack: string[] = [rootAbs];

  while (stack.length > 0 && out.length < MAX_FILES) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const name of entries) {
      if (out.length >= MAX_FILES) break;
      if (isExcludedEntry(name)) continue;

      const full = resolve(dir, name);
      let stats;
      try {
        stats = await stat(full);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        stack.push(full);
      } else if (stats.isFile()) {
        const rel = relative(rootAbs, full).split(sep).join('/');
        out.push({ rel, base: name, mtimeMs: stats.mtimeMs });
      }
    }
  }

  return out;
}

interface CacheEntry {
  files: FileMeta[];
  expiresAt: number;
}

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, CacheEntry>();

async function getFileList(rootAbs: string): Promise<FileMeta[]> {
  const now = Date.now();
  const hit = cache.get(rootAbs);
  if (hit && hit.expiresAt > now) return hit.files;

  const files = await walkWorkspace(rootAbs);
  cache.set(rootAbs, { files, expiresAt: now + CACHE_TTL_MS });
  return files;
}

/** Test-only: clear the in-memory file-list cache. */
export function _resetSearchCache(): void {
  cache.clear();
}

/**
 * Rank `files` against `query`:
 *   - Empty query → top 20 by recent mtime.
 *   - Otherwise → substring match on lowercased basename and full path.
 *     Filename-substring hits rank above path-only hits; ties broken by
 *     earlier match position, then by shorter path.
 */
export function rankFiles(files: FileMeta[], query: string, max = MAX_RESULTS): string[] {
  if (!query.trim()) {
    const byMtime = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs);
    return byMtime.slice(0, max).map((f) => f.rel);
  }

  const q = query.toLowerCase();

  type Scored = { rel: string; tier: 0 | 1; pos: number; len: number };
  const scored: Scored[] = [];

  for (const f of files) {
    const baseLower = f.base.toLowerCase();
    const pathLower = f.rel.toLowerCase();

    const baseIdx = baseLower.indexOf(q);
    if (baseIdx !== -1) {
      scored.push({ rel: f.rel, tier: 0, pos: baseIdx, len: f.rel.length });
      continue;
    }
    const pathIdx = pathLower.indexOf(q);
    if (pathIdx !== -1) {
      scored.push({ rel: f.rel, tier: 1, pos: pathIdx, len: f.rel.length });
    }
  }

  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.pos !== b.pos) return a.pos - b.pos;
    return a.len - b.len;
  });

  return scored.slice(0, max).map((s) => s.rel);
}

export async function searchWorkspaceFiles(rootAbs: string, query: string): Promise<string[]> {
  const files = await getFileList(rootAbs);
  return rankFiles(files, query);
}

// Re-exported for convenience in tests.
export { basename };

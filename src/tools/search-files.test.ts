import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  _resetSearchCache,
  isExcludedEntry,
  rankFiles,
  searchWorkspaceFiles,
} from './search-files.js';

describe('isExcludedEntry', () => {
  it('rejects hidden entries', () => {
    expect(isExcludedEntry('.git')).toBe(true);
    expect(isExcludedEntry('.DS_Store')).toBe(true);
  });
  it('rejects known build/dependency dirs', () => {
    expect(isExcludedEntry('node_modules')).toBe(true);
    expect(isExcludedEntry('dist')).toBe(true);
  });
  it('accepts ordinary names', () => {
    expect(isExcludedEntry('src')).toBe(false);
    expect(isExcludedEntry('README.md')).toBe(false);
  });
});

describe('rankFiles', () => {
  const files = [
    { rel: 'src/api/routes.ts', base: 'routes.ts', mtimeMs: 100 },
    { rel: 'src/api/server.ts', base: 'server.ts', mtimeMs: 200 },
    { rel: 'src/db/store.ts', base: 'store.ts', mtimeMs: 300 },
    { rel: 'src/router-utils.ts', base: 'router-utils.ts', mtimeMs: 400 },
    { rel: 'docs/routes-guide.md', base: 'routes-guide.md', mtimeMs: 500 },
  ];

  it('ranks filename matches above path-only matches', () => {
    const out = rankFiles(files, 'rou');
    // All three results match in the basename at position 0 (tier 0 ties);
    // ranker breaks ties by full-relative-path length ascending:
    //   src/api/routes.ts (17) < src/router-utils.ts (19) < docs/routes-guide.md (20)
    expect(out).toEqual([
      'src/api/routes.ts',
      'src/router-utils.ts',
      'docs/routes-guide.md',
    ]);
  });

  it('falls back to path matches when no basename hit', () => {
    const out = rankFiles(files, 'api');
    expect(out).toEqual(['src/api/routes.ts', 'src/api/server.ts']);
  });

  it('returns most-recent files for empty query', () => {
    const out = rankFiles(files, '', 3);
    // Sorted by mtime descending → routes-guide (500), router-utils (400), store (300)
    expect(out).toEqual([
      'docs/routes-guide.md',
      'src/router-utils.ts',
      'src/db/store.ts',
    ]);
  });

  it('caps results at 20', () => {
    const big = Array.from({ length: 50 }, (_, i) => ({
      rel: `f${i}.ts`,
      base: `f${i}.ts`,
      mtimeMs: i,
    }));
    const out = rankFiles(big, 'f');
    expect(out.length).toBe(20);
  });
});

describe('searchWorkspaceFiles', () => {
  let workspace: string;

  beforeEach(() => {
    _resetSearchCache();
    workspace = realpathSync(mkdtempSync(join(tmpdir(), 'trellis-search-')));
    mkdirSync(join(workspace, 'src'), { recursive: true });
    mkdirSync(join(workspace, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(workspace, '.git'), { recursive: true });
    writeFileSync(join(workspace, 'src', 'routes.ts'), 'x');
    writeFileSync(join(workspace, 'src', 'server.ts'), 'x');
    writeFileSync(join(workspace, 'README.md'), 'x');
    writeFileSync(join(workspace, 'node_modules', 'pkg', 'index.js'), 'should be excluded');
    writeFileSync(join(workspace, '.git', 'HEAD'), 'should be excluded');
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('skips excluded directories', async () => {
    const all = await searchWorkspaceFiles(workspace, '');
    expect(all).not.toContain('node_modules/pkg/index.js');
    expect(all).not.toContain('.git/HEAD');
    expect(all).toEqual(expect.arrayContaining(['README.md', 'src/routes.ts', 'src/server.ts']));
  });

  it('returns substring matches', async () => {
    const out = await searchWorkspaceFiles(workspace, 'rout');
    expect(out).toEqual(['src/routes.ts']);
  });
});

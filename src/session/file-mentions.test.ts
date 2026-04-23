import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildExpandedMessage,
  expandMentionedFiles,
  extractMentionPaths,
} from './file-mentions.js';

describe('extractMentionPaths', () => {
  it('extracts a single @path token at the start of a string', () => {
    expect(extractMentionPaths('@src/api/routes.ts please review')).toEqual([
      'src/api/routes.ts',
    ]);
  });

  it('extracts multiple unique tokens in order of appearance', () => {
    const text = 'compare @src/a.ts and @src/b.ts and again @src/a.ts';
    expect(extractMentionPaths(text)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('matches a token mid-sentence after whitespace', () => {
    expect(extractMentionPaths('look at @lib/util.ts here')).toEqual(['lib/util.ts']);
  });

  it('does not match email addresses', () => {
    expect(extractMentionPaths('contact foo@bar.com about this')).toEqual([]);
  });

  it('does not match @everyone-style social tokens (no slash, no dot)', () => {
    expect(extractMentionPaths('hey @everyone, look at @here')).toEqual([]);
  });

  it('matches a basename with extension at start of string', () => {
    expect(extractMentionPaths('@README.md needs an update')).toEqual(['README.md']);
  });

  it('rejects parent-relative traversal tokens', () => {
    expect(extractMentionPaths('see @../escape.ts here')).toEqual([]);
  });

  it('matches a path inside parentheses', () => {
    expect(extractMentionPaths('look (@src/foo.ts) please')).toEqual(['src/foo.ts']);
  });

  it('returns empty for content with no @ at all', () => {
    expect(extractMentionPaths('plain text, no mentions')).toEqual([]);
  });
});

describe('expandMentionedFiles', () => {
  let workspace: string;

  beforeEach(() => {
    // Resolve symlinks so validatePath's realpathSync check passes — on macOS
    // /var is a symlink to /private/var.
    workspace = realpathSync(mkdtempSync(join(tmpdir(), 'trellis-mention-')));
    mkdirSync(join(workspace, 'src'), { recursive: true });
    writeFileSync(join(workspace, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(workspace, 'README.md'), '# hello\n');
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('reads referenced files in order', async () => {
    const result = await expandMentionedFiles(
      'look at @src/a.ts and @README.md',
      workspace,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((f) => f.path)).toEqual(['src/a.ts', 'README.md']);
    expect(result.files[0].content).toBe('export const a = 1;\n');
  });

  it('aborts when a referenced file is missing', async () => {
    const result = await expandMentionedFiles('use @src/missing.ts', workspace);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.path).toBe('src/missing.ts');
  });

  it('refuses binary files (null-byte probe)', async () => {
    writeFileSync(join(workspace, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02]));
    const result = await expandMentionedFiles('@bin.dat', workspace);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/binary/);
  });

  it('returns ok with no files when message has no @ tokens', async () => {
    const result = await expandMentionedFiles('hello world', workspace);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toEqual([]);
  });
});

describe('buildExpandedMessage', () => {
  it('returns the original text when no files', () => {
    expect(buildExpandedMessage('hi', [])).toBe('hi');
  });

  it('prepends file blocks before the original prompt', () => {
    const out = buildExpandedMessage('see @a.ts', [{ path: 'a.ts', content: 'X' }]);
    expect(out).toBe('<file path="a.ts">\nX\n</file>\n\nsee @a.ts');
  });

  it('joins multiple files with blank-line separators', () => {
    const out = buildExpandedMessage('q', [
      { path: 'a.ts', content: 'A' },
      { path: 'b.ts', content: 'B' },
    ]);
    expect(out).toBe('<file path="a.ts">\nA\n</file>\n\n<file path="b.ts">\nB\n</file>\n\nq');
  });
});

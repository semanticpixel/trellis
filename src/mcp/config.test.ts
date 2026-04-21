import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import {
  MCPConfigFileSchema,
  MCPServerConfigSchema,
  detectClaudeCodeConfigs,
  interpolateEnvRefs,
  loadConfigFile,
  loadMergedConfig,
  resolveHeaders,
  transportTypeOf,
  workspaceConfigPath,
} from './config.js';

describe('MCPServerConfigSchema', () => {
  it('accepts stdio entries without a type (legacy Claude Code format)', () => {
    const parsed = MCPServerConfigSchema.parse({
      command: 'npx',
      args: ['-y', '@atlassian/mcp'],
      env: { API_TOKEN: 'abc' },
    });
    expect(transportTypeOf(parsed)).toBe('stdio');
  });

  it('accepts explicit type: "stdio"', () => {
    const parsed = MCPServerConfigSchema.parse({
      type: 'stdio',
      command: 'uvx',
      args: ['foo'],
    });
    expect(transportTypeOf(parsed)).toBe('stdio');
  });

  it('accepts http entries', () => {
    const parsed = MCPServerConfigSchema.parse({
      type: 'http',
      url: 'https://mcp.context7.com/mcp',
      headers: { Authorization: 'Bearer xyz' },
    });
    expect(transportTypeOf(parsed)).toBe('http');
  });

  it('accepts sse entries', () => {
    const parsed = MCPServerConfigSchema.parse({
      type: 'sse',
      url: 'https://mcp.example.com/events',
    });
    expect(transportTypeOf(parsed)).toBe('sse');
  });

  it('rejects http entries without a url', () => {
    expect(() => MCPServerConfigSchema.parse({ type: 'http' })).toThrow();
  });

  it('rejects stdio entries missing a command', () => {
    expect(() => MCPServerConfigSchema.parse({ args: ['x'] })).toThrow();
  });
});

describe('loadConfigFile (per-entry validation)', () => {
  it('keeps valid entries even when one is malformed', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'trellis-mcp-per-entry-'));
    const path = join(tmp, '.mcp.json');
    writeFileSync(
      path,
      JSON.stringify({
        mcpServers: {
          good_stdio: { command: 'npx', args: ['-y', 'foo'] },
          good_http: { type: 'http', url: 'https://example.com/mcp' },
          bad_entry: { command: '' }, // fails stdio schema
          half_bad: { type: 'http' }, // fails http schema (no url)
        },
      }),
    );
    try {
      const loaded = await loadConfigFile(path);
      expect(loaded).not.toBeNull();
      const names = Object.keys(loaded!.mcpServers);
      expect(names).toContain('good_stdio');
      expect(names).toContain('good_http');
      expect(names).not.toContain('bad_entry');
      expect(names).not.toContain('half_bad');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('MCPConfigFileSchema', () => {
  it('parses an empty envelope', () => {
    const parsed = MCPConfigFileSchema.parse({ mcpServers: {} });
    expect(parsed.mcpServers).toEqual({});
  });
});

describe('loadMergedConfig', () => {
  let tmpHome: string;
  let tmpWorkspace: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'trellis-mcp-home-'));
    tmpWorkspace = mkdtempSync(join(tmpdir(), 'trellis-mcp-ws-'));
    mkdirSync(join(tmpHome, '.trellis'), { recursive: true });
    vi.spyOn({ homedir }, 'homedir');
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpWorkspace, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('workspace config overrides user config on name collisions', async () => {
    const originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    try {
      writeFileSync(
        join(tmpHome, '.trellis', 'mcp.json'),
        JSON.stringify({
          mcpServers: {
            shared: { command: 'user-cmd', args: [] },
            user_only: { command: 'user-only-cmd' },
          },
        }),
      );
      writeFileSync(
        workspaceConfigPath(tmpWorkspace),
        JSON.stringify({
          mcpServers: {
            shared: { command: 'workspace-cmd' },
            ws_only: { command: 'ws-only-cmd' },
          },
        }),
      );

      const merged = await loadMergedConfig(tmpWorkspace);
      expect((merged.shared as { command: string }).command).toBe('workspace-cmd');
      expect(merged.shared.source).toBe('workspace');
      expect(merged.user_only.source).toBe('user');
      expect(merged.ws_only.source).toBe('workspace');
    } finally {
      process.env.HOME = originalHome;
    }
  });
});

describe('loadConfigFile', () => {
  it('returns null for a missing file', async () => {
    const result = await loadConfigFile('/nonexistent/path/.mcp.json');
    expect(result).toBeNull();
  });

  it('returns null for malformed JSON and does not throw', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'trellis-mcp-bad-'));
    const path = join(tmp, '.mcp.json');
    writeFileSync(path, '{ not valid json ');
    try {
      const result = await loadConfigFile(path);
      expect(result).toBeNull();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('detectClaudeCodeConfigs', () => {
  it('finds stdio and http servers in ~/.claude.json, skipping malformed entries', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'trellis-claude-'));
    const originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    try {
      writeFileSync(
        join(tmpHome, '.claude.json'),
        JSON.stringify({
          mcpServers: {
            context7: { type: 'http', url: 'https://mcp.context7.com/mcp' },
            stdio_a: { command: 'npx', args: ['-y', 'context7'] },
            stdio_b: { command: 'uvx', args: ['bar'] },
            http_a: { type: 'http', url: 'https://a.example.com' },
            http_b: { type: 'http', url: 'https://b.example.com' },
            http_c: { type: 'http', url: 'https://c.example.com' },
            http_d: { type: 'http', url: 'https://d.example.com' },
            http_e: { type: 'http', url: 'https://e.example.com' },
            http_f: { type: 'http', url: 'https://f.example.com' },
            http_g: { type: 'http', url: 'https://g.example.com' },
            malformed: { type: 'http' /* missing url */ },
          },
        }),
      );
      const candidates = await detectClaudeCodeConfigs();
      const names = candidates.flatMap((c) => Object.keys(c.servers));
      expect(names).toContain('context7');
      expect(names).toContain('stdio_a');
      expect(names).toContain('http_a');
      expect(names).toContain('http_g');
      expect(names).not.toContain('malformed');
      // 10 valid entries total — 8 http + 2 stdio
      expect(names.length).toBe(10);
    } finally {
      process.env.HOME = originalHome;
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});

describe('interpolateEnvRefs', () => {
  it('substitutes ${env:NAME} tokens using process.env', () => {
    process.env.TRELLIS_TEST_TOKEN = 'secret-42';
    try {
      expect(interpolateEnvRefs('Bearer ${env:TRELLIS_TEST_TOKEN}')).toBe('Bearer secret-42');
    } finally {
      delete process.env.TRELLIS_TEST_TOKEN;
    }
  });

  it('replaces unknown vars with empty string', () => {
    delete process.env.TRELLIS_UNSET_VAR;
    expect(interpolateEnvRefs('${env:TRELLIS_UNSET_VAR}x')).toBe('x');
  });

  it('leaves non-matching text alone', () => {
    expect(interpolateEnvRefs('no tokens here')).toBe('no tokens here');
  });
});

describe('resolveHeaders', () => {
  it('applies env interpolation to each header value', () => {
    process.env.TRELLIS_HDR_TOKEN = 'abc';
    try {
      const resolved = resolveHeaders({
        Authorization: 'Bearer ${env:TRELLIS_HDR_TOKEN}',
        'X-Static': 'plain',
      });
      expect(resolved.Authorization).toBe('Bearer abc');
      expect(resolved['X-Static']).toBe('plain');
    } finally {
      delete process.env.TRELLIS_HDR_TOKEN;
    }
  });

  it('returns empty object when input is undefined', () => {
    expect(resolveHeaders(undefined)).toEqual({});
  });
});

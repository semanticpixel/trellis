import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import {
  MCPConfigFileSchema,
  detectClaudeCodeConfigs,
  loadConfigFile,
  loadMergedConfig,
  workspaceConfigPath,
} from './config.js';

describe('MCPConfigFileSchema', () => {
  it('accepts the Claude Code format', () => {
    const parsed = MCPConfigFileSchema.parse({
      mcpServers: {
        atlassian: {
          command: 'npx',
          args: ['-y', '@atlassian/mcp'],
          env: { API_TOKEN: 'abc' },
        },
      },
    });
    expect(parsed.mcpServers.atlassian.command).toBe('npx');
    expect(parsed.mcpServers.atlassian.args).toEqual(['-y', '@atlassian/mcp']);
  });

  it('rejects servers missing a command', () => {
    expect(() =>
      MCPConfigFileSchema.parse({
        mcpServers: { bad: { args: ['x'] } },
      }),
    ).toThrow();
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
    // Point HOME at our tmp dir so userConfigPath() resolves under it.
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
      expect(merged.shared.command).toBe('workspace-cmd');
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
  it('finds servers in ~/.claude.json when present', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'trellis-claude-'));
    const originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    try {
      writeFileSync(
        join(tmpHome, '.claude.json'),
        JSON.stringify({
          mcpServers: {
            context7: { command: 'npx', args: ['-y', 'context7'] },
          },
        }),
      );
      const candidates = await detectClaudeCodeConfigs();
      const names = candidates.flatMap((c) => Object.keys(c.servers));
      expect(names).toContain('context7');
    } finally {
      process.env.HOME = originalHome;
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});

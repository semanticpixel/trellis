import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MCPManager, isMcpToolName, namespaceToolName, resolveToolName } from './manager.js';

describe('MCP tool name namespacing', () => {
  it('rejects non-MCP names', () => {
    expect(isMcpToolName('read_file')).toBe(false);
    expect(resolveToolName('read_file')).toBeNull();
  });

  it('round-trips server/tool pairs', () => {
    const name = namespaceToolName('atlassian', 'search_issues');
    expect(name).toBe('mcp__atlassian__search_issues');
    expect(isMcpToolName(name)).toBe(true);
    expect(resolveToolName(name)).toEqual({
      serverName: 'atlassian',
      toolName: 'search_issues',
    });
  });

  it('keeps double underscores inside the tool name intact', () => {
    // A tool whose name contains `__` must still resolve — we only split
    // once on the server/tool boundary.
    const resolved = resolveToolName('mcp__devtools__run__script');
    expect(resolved).toEqual({
      serverName: 'devtools',
      toolName: 'run__script',
    });
  });

  it('returns null for malformed MCP names', () => {
    expect(resolveToolName('mcp__onlyserver')).toBeNull();
  });
});

describe('MCPManager.reloadServer — cold start', () => {
  let tmpHome: string;
  let tmpWorkspace: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'trellis-mcp-home-'));
    tmpWorkspace = mkdtempSync(join(tmpdir(), 'trellis-mcp-ws-'));
    mkdirSync(join(tmpHome, '.trellis'), { recursive: true });
    // Redirect homedir() so loadMergedConfig doesn't pick up the dev's
    // real ~/.trellis/mcp.json.
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  it('spawns a server whose workspace has never had a thread (no more 404)', async () => {
    // Configure a stdio server whose command exits immediately so startServer
    // resolves quickly. The point of this test isn't the end state of the
    // server — it's that reloadServer returns a status object (not null)
    // when the workspace slot hasn't been bootstrapped by a prior acquire().
    writeFileSync(
      join(tmpWorkspace, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          probe: { command: '/bin/false' },
        },
      }),
    );

    const manager = new MCPManager();
    try {
      const status = await manager.reloadServer('ws-cold', tmpWorkspace, 'probe');
      expect(status).not.toBeNull();
      expect(status?.name).toBe('probe');
      expect(status?.transport).toBe('stdio');
      // The process exits immediately, so the state will settle to 'error'
      // or (rarely) 'ready' if the mock handshake somehow succeeded. Either
      // way it's not 'starting', which confirms startServer ran to
      // completion instead of short-circuiting with a 404.
      expect(['error', 'ready', 'stopped']).toContain(status?.state);
    } finally {
      await manager.shutdownAll();
    }
  });

  it('returns null only when the server is absent from the merged config', async () => {
    // Empty config → unknown server should 404, not crash.
    writeFileSync(
      join(tmpWorkspace, '.mcp.json'),
      JSON.stringify({ mcpServers: {} }),
    );

    const manager = new MCPManager();
    try {
      const status = await manager.reloadServer('ws-cold', tmpWorkspace, 'nonexistent');
      expect(status).toBeNull();
    } finally {
      await manager.shutdownAll();
    }
  });
});

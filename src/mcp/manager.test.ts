import { describe, expect, it } from 'vitest';
import { isMcpToolName, namespaceToolName, resolveToolName } from './manager.js';

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

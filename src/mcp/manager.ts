import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolDefinition } from '../shared/types.js';
import { loadMergedConfig, type MergedMCPServer } from './config.js';

const STDERR_RING_SIZE = 200;
const MCP_TOOL_PREFIX = 'mcp__';

export type MCPServerState = 'starting' | 'ready' | 'error' | 'stopped';

export interface MCPServerStatus {
  name: string;
  source: 'workspace' | 'user';
  state: MCPServerState;
  toolCount: number;
  error: string | null;
  pid: number | null;
  tools: Array<{ name: string; description: string }>;
  stderrTail: string[];
}

interface ServerInstance {
  name: string;
  config: MergedMCPServer;
  client: Client | null;
  transport: StdioClientTransport | null;
  tools: Array<{ name: string; description: string; inputSchema: unknown }>;
  state: MCPServerState;
  error: string | null;
  pid: number | null;
  stderrTail: string[];
}

interface WorkspaceMCPState {
  workspaceId: string;
  workspacePath: string;
  servers: Map<string, ServerInstance>;
  activeThreads: Set<string>;
  initPromise: Promise<void> | null;
}

/**
 * Per-workspace MCP server supervisor. Servers are spawned once when the
 * first thread in a workspace needs them, shared across threads, and torn
 * down once the workspace has no active sessions.
 */
export class MCPManager {
  private workspaces = new Map<string, WorkspaceMCPState>();

  async acquire(workspaceId: string, workspacePath: string, threadId: string): Promise<void> {
    let state = this.workspaces.get(workspaceId);
    if (!state) {
      state = {
        workspaceId,
        workspacePath,
        servers: new Map(),
        activeThreads: new Set(),
        initPromise: null,
      };
      this.workspaces.set(workspaceId, state);
    }
    state.activeThreads.add(threadId);
    if (!state.initPromise) {
      state.initPromise = this.initializeServers(state);
    }
    try {
      await state.initPromise;
    } catch (err) {
      console.error(`[trellis] MCP init failed for workspace ${workspaceId}:`, err);
    }
  }

  async release(workspaceId: string, threadId: string): Promise<void> {
    const state = this.workspaces.get(workspaceId);
    if (!state) return;
    state.activeThreads.delete(threadId);
    if (state.activeThreads.size === 0) {
      await this.shutdownWorkspace(workspaceId);
    }
  }

  listTools(workspaceId: string): ToolDefinition[] {
    const state = this.workspaces.get(workspaceId);
    if (!state) return [];
    const defs: ToolDefinition[] = [];
    for (const [serverName, instance] of state.servers) {
      if (instance.state !== 'ready') continue;
      for (const tool of instance.tools) {
        defs.push({
          name: namespaceToolName(serverName, tool.name),
          description: tool.description,
          input_schema: (tool.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
        });
      }
    }
    return defs;
  }

  async callTool(
    workspaceId: string,
    namespacedName: string,
    input: Record<string, unknown>,
  ): Promise<{ output: string; isError: boolean }> {
    const resolved = resolveToolName(namespacedName);
    if (!resolved) {
      return { output: `Not an MCP tool: ${namespacedName}`, isError: true };
    }
    const state = this.workspaces.get(workspaceId);
    if (!state) {
      return { output: `MCP servers are not active for this workspace`, isError: true };
    }
    const instance = state.servers.get(resolved.serverName);
    if (!instance) {
      return { output: `Unknown MCP server: ${resolved.serverName}`, isError: true };
    }
    if (!instance.client || instance.state !== 'ready') {
      return {
        output: `MCP server "${resolved.serverName}" is not ready (state=${instance.state}${instance.error ? `, error=${instance.error}` : ''})`,
        isError: true,
      };
    }
    try {
      const result = await instance.client.callTool({
        name: resolved.toolName,
        arguments: input,
      });
      return formatCallToolResult(result);
    } catch (err) {
      return {
        output: `MCP tool error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  getStatus(workspaceId: string): MCPServerStatus[] {
    const state = this.workspaces.get(workspaceId);
    if (!state) return [];
    return [...state.servers.values()].map(toStatus);
  }

  async reloadServer(workspaceId: string, serverName: string): Promise<MCPServerStatus | null> {
    const state = this.workspaces.get(workspaceId);
    if (!state) return null;
    const existing = state.servers.get(serverName);
    if (existing) {
      await closeInstance(existing);
    }
    const config = await loadMergedConfig(state.workspacePath);
    const cfg = config[serverName];
    if (!cfg) {
      state.servers.delete(serverName);
      return null;
    }
    const instance: ServerInstance = existing ?? makeInstance(serverName, cfg);
    instance.config = cfg;
    instance.state = 'starting';
    instance.error = null;
    instance.stderrTail = [];
    instance.tools = [];
    instance.pid = null;
    instance.client = null;
    instance.transport = null;
    state.servers.set(serverName, instance);
    await this.startServer(instance);
    return toStatus(instance);
  }

  async reloadAll(workspaceId: string, workspacePath: string): Promise<MCPServerStatus[]> {
    let state = this.workspaces.get(workspaceId);
    if (!state) {
      // If no session is active, create a transient state so the UI can still
      // probe the servers. Drop it if nothing acquires a reference afterward.
      state = {
        workspaceId,
        workspacePath,
        servers: new Map(),
        activeThreads: new Set(),
        initPromise: null,
      };
      this.workspaces.set(workspaceId, state);
    }
    for (const instance of state.servers.values()) {
      await closeInstance(instance);
    }
    state.servers.clear();
    state.initPromise = this.initializeServers(state);
    await state.initPromise;
    return this.getStatus(workspaceId);
  }

  async shutdownAll(): Promise<void> {
    for (const workspaceId of [...this.workspaces.keys()]) {
      await this.shutdownWorkspace(workspaceId);
    }
  }

  // ── Internals ───────────────────────────────────────────────

  private async initializeServers(state: WorkspaceMCPState): Promise<void> {
    const config = await loadMergedConfig(state.workspacePath);
    const entries = Object.entries(config);
    if (entries.length === 0) return;
    await Promise.all(
      entries.map(async ([name, cfg]) => {
        const instance = makeInstance(name, cfg);
        state.servers.set(name, instance);
        await this.startServer(instance);
      }),
    );
  }

  private async startServer(instance: ServerInstance): Promise<void> {
    instance.state = 'starting';
    instance.error = null;

    const params: StdioServerParameters = {
      command: instance.config.command,
      args: instance.config.args,
      stderr: 'pipe',
    };
    if (instance.config.env) {
      params.env = { ...process.env, ...instance.config.env } as Record<string, string>;
    }
    if (instance.config.cwd) {
      params.cwd = instance.config.cwd;
    }

    const transport = new StdioClientTransport(params);
    const client = new Client({ name: 'trellis', version: '0.1.0' }, { capabilities: {} });

    transport.stderr?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf-8').split('\n').filter(Boolean);
      instance.stderrTail.push(...lines);
      if (instance.stderrTail.length > STDERR_RING_SIZE) {
        instance.stderrTail.splice(0, instance.stderrTail.length - STDERR_RING_SIZE);
      }
    });

    try {
      await client.connect(transport);
      instance.transport = transport;
      instance.client = client;
      instance.pid = transport.pid;

      const listed = await client.listTools();
      instance.tools = listed.tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema,
      }));
      instance.state = 'ready';
    } catch (err) {
      instance.state = 'error';
      instance.error = err instanceof Error ? err.message : String(err);
      try {
        await transport.close();
      } catch {
        // ignore close errors during failure cleanup
      }
      instance.transport = null;
      instance.client = null;
    }
  }

  private async shutdownWorkspace(workspaceId: string): Promise<void> {
    const state = this.workspaces.get(workspaceId);
    if (!state) return;
    for (const instance of state.servers.values()) {
      await closeInstance(instance);
    }
    state.servers.clear();
    state.initPromise = null;
    this.workspaces.delete(workspaceId);
  }
}

function makeInstance(name: string, config: MergedMCPServer): ServerInstance {
  return {
    name,
    config,
    client: null,
    transport: null,
    tools: [],
    state: 'starting',
    error: null,
    pid: null,
    stderrTail: [],
  };
}

async function closeInstance(instance: ServerInstance): Promise<void> {
  try {
    await instance.transport?.close();
  } catch {
    // best-effort cleanup
  }
  instance.transport = null;
  instance.client = null;
  instance.state = 'stopped';
}

function toStatus(instance: ServerInstance): MCPServerStatus {
  return {
    name: instance.name,
    source: instance.config.source,
    state: instance.state,
    toolCount: instance.tools.length,
    error: instance.error,
    pid: instance.pid,
    tools: instance.tools.map((t) => ({ name: t.name, description: t.description })),
    stderrTail: [...instance.stderrTail],
  };
}

export function namespaceToolName(serverName: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${serverName}__${toolName}`;
}

export function resolveToolName(name: string): { serverName: string; toolName: string } | null {
  if (!name.startsWith(MCP_TOOL_PREFIX)) return null;
  const rest = name.slice(MCP_TOOL_PREFIX.length);
  const idx = rest.indexOf('__');
  if (idx < 0) return null;
  return {
    serverName: rest.slice(0, idx),
    toolName: rest.slice(idx + 2),
  };
}

export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX);
}

function formatCallToolResult(result: unknown): { output: string; isError: boolean } {
  const r = result as {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
    toolResult?: unknown;
  };
  if (Array.isArray(r.content)) {
    const parts: string[] = [];
    for (const block of r.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
      } else {
        parts.push(`[${block.type} content omitted]`);
      }
    }
    return { output: parts.join('\n') || '(empty response)', isError: !!r.isError };
  }
  if (r.toolResult !== undefined) {
    return {
      output: typeof r.toolResult === 'string' ? r.toolResult : JSON.stringify(r.toolResult, null, 2),
      isError: !!r.isError,
    };
  }
  return { output: JSON.stringify(result, null, 2), isError: !!r.isError };
}

export const mcpManager = new MCPManager();

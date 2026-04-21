import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import type { ToolDefinition } from '../shared/types.js';
import {
  loadMergedConfig,
  resolveHeaders,
  transportTypeOf,
  type MCPTransportType,
  type MergedMCPServer,
} from './config.js';
import { TrellisOAuthProvider, TRELLIS_OAUTH_REQUIRED } from './oauth.js';

const STDERR_RING_SIZE = 200;
const MCP_TOOL_PREFIX = 'mcp__';

export type MCPServerState = 'starting' | 'ready' | 'error' | 'stopped';

export interface MCPServerStatus {
  name: string;
  source: 'workspace' | 'user';
  transport: MCPTransportType;
  url: string | null;
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
  transport: Transport | null;
  tools: Array<{ name: string; description: string; inputSchema: unknown }>;
  state: MCPServerState;
  error: string | null;
  pid: number | null;
  stderrTail: string[];
  // Quiet auth provider wired into the transport. When the SDK hits a 401
  // and tries to call `redirectToAuthorization`, the quiet provider throws
  // the `TRELLIS_OAUTH_REQUIRED` sentinel instead of opening a browser tab —
  // session-init must never initiate a browser OAuth flow. Reused across
  // transport restarts so persisted tokens + pre-registered client_id stay
  // consistent for the server's lifetime.
  authProvider: TrellisOAuthProvider | null;
  // Interactive auth provider used only by the explicit Authorize path
  // (`runAuthorizeServer`). Kept separate from `authProvider` so we never
  // have to mutate a shared mode flag — the transport's provider stays
  // quiet for its entire lifetime.
  authProviderInteractive: TrellisOAuthProvider | null;
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
  // The browser OAuth callback listener binds a fixed loopback port; two
  // concurrent flows would collide with EADDRINUSE. Chain authorizeServer
  // calls through a single promise so parallel triggers (e.g. Reload All
  // after adding several OAuth servers) degrade gracefully into sequential
  // flows. Previous flow failures don't poison the chain.
  private oauthFlowChain: Promise<unknown> = Promise.resolve();

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

  async reloadServer(
    workspaceId: string,
    workspacePath: string,
    serverName: string,
  ): Promise<MCPServerStatus | null> {
    // Bootstrap a transient workspace slot if no thread has ever run here —
    // otherwise a reload triggered from Settings before the workspace's
    // first session would return null and the route would 404 the user.
    // Matches the reloadAll / authorizeServer pattern.
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
    // Reload rebuilds the auth providers so edits to clientId/clientSecret/scope
    // in the config actually take effect. Persisted tokens stay untouched —
    // they live in the encrypted store, not on the provider.
    instance.authProvider = null;
    instance.authProviderInteractive = null;
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

  /**
   * Run the OAuth authorization flow for a server end-to-end. This is the
   * manual trigger used before PR B's Settings UI lands: POST the matching
   * route and Trellis will open a browser, await the callback, and persist
   * tokens. On success the next tool call is authorized without further UI.
   *
   * Flow: first `auth()` pass discovers metadata, (optionally) DCRs a
   * client, starts authorization and redirects via the bridge; we await
   * the captured code, then a second `auth()` pass exchanges it for
   * tokens. After that we reload the server so its transport reconnects
   * with the new tokens.
   */
  async authorizeServer(
    workspaceId: string,
    workspacePath: string,
    serverName: string,
  ): Promise<MCPServerStatus | null> {
    // Wait for any in-flight OAuth flow to finish before starting ours.
    // `.then(run, run)` runs `run` regardless of the previous result so a
    // failed earlier flow doesn't permanently block the queue.
    const run = (): Promise<MCPServerStatus | null> =>
      this.runAuthorizeServer(workspaceId, workspacePath, serverName);
    const prev = this.oauthFlowChain;
    const next = prev.then(run, run);
    this.oauthFlowChain = next.catch(() => undefined);
    return next;
  }

  private async runAuthorizeServer(
    workspaceId: string,
    workspacePath: string,
    serverName: string,
  ): Promise<MCPServerStatus | null> {
    let state = this.workspaces.get(workspaceId);
    if (!state) {
      // No active session — spin up a transient state so the manual
      // trigger still works (matches the reloadAll pattern).
      state = {
        workspaceId,
        workspacePath,
        servers: new Map(),
        activeThreads: new Set(),
        initPromise: null,
      };
      this.workspaces.set(workspaceId, state);
    }

    const config = await loadMergedConfig(state.workspacePath);
    const cfg = config[serverName];
    if (!cfg) throw new Error(`No MCP server named "${serverName}" in merged config`);
    const transportType = transportTypeOf(cfg);
    if (transportType === 'stdio') {
      throw new Error(`OAuth only applies to http/sse servers; "${serverName}" is stdio`);
    }

    const httpCfg = cfg as {
      url: string;
      clientId?: string;
      clientSecret?: string;
      scope?: string;
    };

    // Build (or reuse) the interactive auth provider. The transport's
    // provider is quiet — it refuses to open a browser tab — so we can't
    // share it with the explicit Authorize flow, which depends on
    // `redirectToAuthorization` actually firing the bridge call.
    const existing = state.servers.get(serverName);
    const authProvider =
      existing?.authProviderInteractive ??
      new TrellisOAuthProvider(serverName, {
        clientId: httpCfg.clientId,
        clientSecret: httpCfg.clientSecret,
        scope: httpCfg.scope,
      });
    if (existing) existing.authProviderInteractive = authProvider;

    const firstPass = await auth(authProvider, { serverUrl: httpCfg.url });
    if (firstPass === 'AUTHORIZED') {
      // Existing tokens were fine — nothing to do beyond reloading the
      // server so stale connections pick them up.
      return this.reloadServer(workspaceId, state.workspacePath, serverName);
    }

    const code = await authProvider.waitForAuthorizationCode();
    let secondPass: Awaited<ReturnType<typeof auth>>;
    try {
      secondPass = await auth(authProvider, {
        serverUrl: httpCfg.url,
        authorizationCode: code,
      });
    } catch (err) {
      // Before this explicit catch, SDK-level failures (network, 4xx token
      // response, malformed metadata) surfaced as a vague "did not complete"
      // error because nothing logged the underlying exception.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[trellis] MCP OAuth token exchange failed for "${serverName}":`, err);
      await authProvider.reportExchangeResult('failed', msg);
      throw new Error(`OAuth token exchange for "${serverName}" failed: ${msg}`);
    }
    if (secondPass !== 'AUTHORIZED') {
      const msg = `token exchange returned ${secondPass}`;
      console.error(`[trellis] MCP OAuth flow for "${serverName}" did not authorize: ${msg}`);
      await authProvider.reportExchangeResult('failed', msg);
      throw new Error(`OAuth flow for "${serverName}" did not complete (got ${secondPass})`);
    }

    // Belt-and-suspenders: the SDK can technically return AUTHORIZED
    // without saveTokens() having run (e.g. a future bug in the grant path).
    // Confirm the access token actually landed in safeStorage before we
    // tell the UI we're done.
    const persisted = await authProvider.tokens();
    if (!persisted?.access_token) {
      const msg = 'token exchange reported success but no access_token was persisted';
      console.error(`[trellis] MCP OAuth flow for "${serverName}" completed without tokens`);
      await authProvider.reportExchangeResult('failed', msg);
      throw new Error(`OAuth flow for "${serverName}" ${msg}`);
    }

    await authProvider.reportExchangeResult('success');
    return this.reloadServer(workspaceId, state.workspacePath, serverName);
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

    const transportType = transportTypeOf(instance.config);
    let transport: Transport;
    try {
      transport = this.createTransport(instance, transportType);
    } catch (err) {
      instance.state = 'error';
      instance.error = err instanceof Error ? err.message : String(err);
      return;
    }

    const client = new Client({ name: 'trellis', version: '0.1.0' }, { capabilities: {} });

    try {
      await client.connect(transport);
      instance.transport = transport;
      instance.client = client;
      if (transport instanceof StdioClientTransport) {
        instance.pid = transport.pid;
      }

      const listed = await client.listTools();
      instance.tools = listed.tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema,
      }));
      instance.state = 'ready';
    } catch (err) {
      instance.state = 'error';
      // If the transport hit a 401 and the quiet auth provider threw our
      // sentinel, this is a cold-start "needs authorization" state — not a
      // real failure. Replace the raw sentinel message with something the
      // UI can render verbatim. Use `includes` because the SDK may wrap
      // the error message with transport-level context before it reaches
      // us.
      const raw = err instanceof Error ? err.message : String(err);
      instance.error = raw.includes(TRELLIS_OAUTH_REQUIRED)
        ? 'Needs authorization — use Authorize in Settings'
        : raw;
      try {
        await transport.close();
      } catch {
        // ignore close errors during failure cleanup
      }
      instance.transport = null;
      instance.client = null;
    }
  }

  private createTransport(instance: ServerInstance, type: MCPTransportType): Transport {
    if (type === 'http' || type === 'sse') {
      const cfg = instance.config as {
        url: string;
        headers?: Record<string, string>;
        clientId?: string;
        clientSecret?: string;
        scope?: string;
      };
      const headers = resolveHeaders(cfg.headers);
      const url = new URL(cfg.url);
      // Reuse the same provider instance across reload cycles so persisted
      // tokens + pre-registered client info aren't thrown away on restart.
      // Always quiet: if the transport hits a 401, we want `startServer` to
      // land the server in a benign "needs authorization" state, not open
      // a browser tab. The explicit Authorize path uses a separate
      // interactive provider (see `runAuthorizeServer`).
      if (!instance.authProvider) {
        instance.authProvider = new TrellisOAuthProvider(instance.name, {
          clientId: cfg.clientId,
          clientSecret: cfg.clientSecret,
          scope: cfg.scope,
          quiet: true,
        });
      }
      const authProvider = instance.authProvider;
      if (type === 'http') {
        return new StreamableHTTPClientTransport(url, {
          requestInit: { headers },
          authProvider,
        });
      }
      return new SSEClientTransport(url, {
        requestInit: { headers },
        authProvider,
        // SSEClientTransport ignores the Authorization header on the initial
        // EventSource request unless eventSourceInit explicitly forwards it,
        // so mirror headers into the EventSource fetch override.
        eventSourceInit: {
          fetch: (fetchUrl, init) =>
            fetch(fetchUrl, { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), ...headers } }),
        },
      });
    }

    const stdioCfg = instance.config as {
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
    };
    const params: StdioServerParameters = {
      command: stdioCfg.command,
      args: stdioCfg.args,
      stderr: 'pipe',
    };
    if (stdioCfg.env) {
      params.env = { ...process.env, ...stdioCfg.env } as Record<string, string>;
    }
    if (stdioCfg.cwd) {
      params.cwd = stdioCfg.cwd;
    }

    const transport = new StdioClientTransport(params);
    transport.stderr?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf-8').split('\n').filter(Boolean);
      instance.stderrTail.push(...lines);
      if (instance.stderrTail.length > STDERR_RING_SIZE) {
        instance.stderrTail.splice(0, instance.stderrTail.length - STDERR_RING_SIZE);
      }
    });
    return transport;
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
    authProvider: null,
    authProviderInteractive: null,
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
  const transport = transportTypeOf(instance.config);
  const url = transport === 'stdio' ? null : (instance.config as { url?: string }).url ?? null;
  return {
    name: instance.name,
    source: instance.config.source,
    transport,
    url,
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

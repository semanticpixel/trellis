import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { z } from 'zod';

// ── Schemas ────────────────────────────────────────────────────

// Stdio entries may omit `type` entirely — that's the v1 Claude Code shape
// and we want to keep accepting it verbatim.
const StdioServerSchema = z.object({
  type: z.literal('stdio').optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

// OAuth fields are optional — when clientId is present we skip Dynamic Client
// Registration and treat the server as pre-registered (for servers that don't
// advertise /register). scope lets the user override the default requested
// scopes if the server requires something non-default.
const HttpServerSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  scope: z.string().optional(),
});

const SseServerSchema = z.object({
  type: z.literal('sse'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  scope: z.string().optional(),
});

// Http/sse entries carry a literal discriminator; stdio entries may not.
// Combining via `.or()` lets either branch win without forcing `type` to be
// present on stdio.
export const MCPServerConfigSchema = z
  .discriminatedUnion('type', [HttpServerSchema, SseServerSchema])
  .or(StdioServerSchema);

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;
export type StdioServerConfig = z.infer<typeof StdioServerSchema>;
export type HttpServerConfig = z.infer<typeof HttpServerSchema>;
export type SseServerConfig = z.infer<typeof SseServerSchema>;

export type MCPTransportType = 'stdio' | 'http' | 'sse';

export function transportTypeOf(cfg: MCPServerConfig): MCPTransportType {
  if ('type' in cfg && cfg.type === 'http') return 'http';
  if ('type' in cfg && cfg.type === 'sse') return 'sse';
  return 'stdio';
}

export const MCPConfigFileSchema = z.object({
  mcpServers: z.record(MCPServerConfigSchema).default({}),
});

export type MCPConfigFile = z.infer<typeof MCPConfigFileSchema>;

export type MergedMCPServer = MCPServerConfig & {
  source: 'workspace' | 'user';
};

// ── Paths ──────────────────────────────────────────────────────

export function userConfigPath(): string {
  return join(homedir(), '.trellis', 'mcp.json');
}

export function workspaceConfigPath(workspacePath: string): string {
  return join(workspacePath, '.mcp.json');
}

// ── File I/O ───────────────────────────────────────────────────

export async function loadConfigFile(path: string): Promise<MCPConfigFile | null> {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    console.error(`[trellis] Could not read MCP config at ${path}:`, err instanceof Error ? err.message : err);
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    console.error(`[trellis] Invalid JSON in MCP config at ${path}:`, err instanceof Error ? err.message : err);
    return null;
  }
  // Top-level envelope (`{ mcpServers: ... }`) must parse, but individual
  // entries are filtered below so one bad one doesn't disable the rest.
  if (!json || typeof json !== 'object' || !('mcpServers' in json)) {
    return { mcpServers: {} };
  }
  const servers = parseServersRecord((json as { mcpServers: unknown }).mcpServers, path);
  return { mcpServers: servers };
}

export async function saveUserConfig(config: MCPConfigFile): Promise<void> {
  const path = userConfigPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2), 'utf-8');
}

export async function loadUserConfig(): Promise<MCPConfigFile> {
  const existing = await loadConfigFile(userConfigPath());
  return existing ?? { mcpServers: {} };
}

/**
 * Merge user-level and workspace-level MCP configs. Workspace entries win
 * when both scopes define the same server name — matches Claude Code's
 * project-over-user precedence so existing configs behave identically.
 */
export async function loadMergedConfig(workspacePath: string): Promise<Record<string, MergedMCPServer>> {
  const result: Record<string, MergedMCPServer> = {};

  const userConfig = await loadConfigFile(userConfigPath());
  if (userConfig) {
    for (const [name, cfg] of Object.entries(userConfig.mcpServers)) {
      result[name] = { ...cfg, source: 'user' };
    }
  }

  const wsConfig = await loadConfigFile(workspaceConfigPath(workspacePath));
  if (wsConfig) {
    for (const [name, cfg] of Object.entries(wsConfig.mcpServers)) {
      result[name] = { ...cfg, source: 'workspace' };
    }
  }

  return result;
}

// ── Claude Code config detection ───────────────────────────────

export interface ClaudeCodeImportCandidate {
  source: string;
  servers: Record<string, MCPServerConfig>;
}

/**
 * Walk ~/.claude.json and ~/.claude/settings.json for existing MCP entries
 * so the Settings UI can offer a one-click import into Trellis.
 */
export async function detectClaudeCodeConfigs(): Promise<ClaudeCodeImportCandidate[]> {
  const candidates = [
    join(homedir(), '.claude.json'),
    join(homedir(), '.claude', 'settings.json'),
  ];
  const found: ClaudeCodeImportCandidate[] = [];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = await readFile(path, 'utf-8');
      const json = JSON.parse(raw);
      const servers = extractMcpServers(json, path);
      if (Object.keys(servers).length > 0) {
        found.push({ source: path, servers });
      }
    } catch {
      // Unreadable/corrupt — skip silently; this is a best-effort import.
    }
  }
  return found;
}

function extractMcpServers(json: unknown, path: string): Record<string, MCPServerConfig> {
  const result: Record<string, MCPServerConfig> = {};
  if (!json || typeof json !== 'object') return result;
  const obj = json as Record<string, unknown>;

  for (const [name, cfg] of Object.entries(parseServersRecord(obj.mcpServers, path))) {
    result[name] = cfg;
  }

  // ~/.claude.json also stores per-project mcpServers under `projects[path]`.
  if (obj.projects && typeof obj.projects === 'object') {
    for (const [projectPath, project] of Object.entries(obj.projects as Record<string, unknown>)) {
      if (!project || typeof project !== 'object') continue;
      const projectServers = (project as Record<string, unknown>).mcpServers;
      const parsed = parseServersRecord(projectServers, `${path}#projects.${projectPath}`);
      for (const [name, cfg] of Object.entries(parsed)) {
        if (!result[name]) result[name] = cfg;
      }
    }
  }

  return result;
}

// Parse a `mcpServers` record one entry at a time so that a single malformed
// entry (e.g. an http server on an old schema, or a typo'd stdio command)
// no longer nukes the entire record. Invalid entries are logged and skipped.
function parseServersRecord(value: unknown, sourceLabel: string): Record<string, MCPServerConfig> {
  const out: Record<string, MCPServerConfig> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [name, rawCfg] of Object.entries(value as Record<string, unknown>)) {
    const parsed = MCPServerConfigSchema.safeParse(rawCfg);
    if (parsed.success) {
      out[name] = parsed.data;
    } else {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
      console.warn(`[trellis] Skipping MCP server "${name}" in ${sourceLabel}: ${issues}`);
    }
  }
  return out;
}

// ── Env var interpolation ──────────────────────────────────────

/**
 * Expand `${env:VAR_NAME}` placeholders in a string value using process.env.
 * Unknown vars resolve to an empty string. Kept deliberately narrow so
 * `.mcp.json` files can reference secrets without pasting them inline.
 */
export function interpolateEnvRefs(value: string): string {
  return value.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => process.env[name] ?? '');
}

export function resolveHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = interpolateEnvRefs(v);
  }
  return out;
}

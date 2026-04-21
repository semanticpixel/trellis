import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { z } from 'zod';

// ── Schemas ────────────────────────────────────────────────────

export const MCPServerConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;

export const MCPConfigFileSchema = z.object({
  mcpServers: z.record(MCPServerConfigSchema).default({}),
});

export type MCPConfigFile = z.infer<typeof MCPConfigFileSchema>;

export interface MergedMCPServer extends MCPServerConfig {
  source: 'workspace' | 'user';
}

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
  try {
    const raw = await readFile(path, 'utf-8');
    const json = JSON.parse(raw);
    return MCPConfigFileSchema.parse(json);
  } catch (err) {
    console.error(`[trellis] Invalid MCP config at ${path}:`, err instanceof Error ? err.message : err);
    return null;
  }
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
      const servers = extractMcpServers(json);
      if (Object.keys(servers).length > 0) {
        found.push({ source: path, servers });
      }
    } catch {
      // Unreadable/corrupt — skip silently; this is a best-effort import.
    }
  }
  return found;
}

function extractMcpServers(json: unknown): Record<string, MCPServerConfig> {
  const result: Record<string, MCPServerConfig> = {};
  if (!json || typeof json !== 'object') return result;
  const obj = json as Record<string, unknown>;

  const topLevel = z.record(MCPServerConfigSchema).safeParse(obj.mcpServers);
  if (topLevel.success) {
    for (const [name, cfg] of Object.entries(topLevel.data)) {
      result[name] = cfg;
    }
  }

  // ~/.claude.json also stores per-project mcpServers under `projects[path]`
  if (obj.projects && typeof obj.projects === 'object') {
    for (const project of Object.values(obj.projects as Record<string, unknown>)) {
      if (!project || typeof project !== 'object') continue;
      const projectServers = (project as Record<string, unknown>).mcpServers;
      const parsed = z.record(MCPServerConfigSchema).safeParse(projectServers);
      if (parsed.success) {
        for (const [name, cfg] of Object.entries(parsed.data)) {
          if (!result[name]) result[name] = cfg;
        }
      }
    }
  }

  return result;
}

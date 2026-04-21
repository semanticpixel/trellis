import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Workspace, Repo, Thread, Provider, CreateWorkspaceRequest, CreateThreadRequest } from '@shared/types';

const API = '/api';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error ?? `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Workspaces ──────────────────────────────────────────────

export function useWorkspaces() {
  return useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: () => fetchJson(`${API}/workspaces`),
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateWorkspaceRequest) =>
      fetchJson<Workspace>(`${API}/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`${API}/workspaces/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

// ── Repos ───────────────────────────────────────────────────

export interface RepoWithStatus extends Repo {
  missing: boolean;
}

export function useRepos(workspaceId: string | undefined) {
  return useQuery<RepoWithStatus[]>({
    queryKey: ['repos', workspaceId],
    queryFn: () => fetchJson(`${API}/workspaces/${workspaceId}/repos`),
    enabled: !!workspaceId,
  });
}

// ── Threads ─────────────────────────────────────────────────

export function useThreads(workspaceId: string | undefined) {
  return useQuery<Thread[]>({
    queryKey: ['threads', workspaceId],
    queryFn: () => fetchJson(`${API}/threads?workspace_id=${workspaceId}`),
    enabled: !!workspaceId,
  });
}

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateThreadRequest) =>
      fetchJson<Thread>(`${API}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      }),
    onSuccess: (thread) => {
      qc.invalidateQueries({ queryKey: ['threads', thread.workspace_id] });
    },
  });
}

// ── Messages ────────────────────────────────────────────────

export function useMessages(threadId: string | null) {
  return useQuery<import('@shared/types').Message[]>({
    queryKey: ['messages', threadId],
    queryFn: () => fetchJson(`${API}/threads/${threadId}/messages`),
    enabled: !!threadId,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, content }: { threadId: string; content: string }) =>
      fetchJson(`${API}/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['messages', variables.threadId] });
      // Refresh threads to get updated title/timestamp
      qc.invalidateQueries({ queryKey: ['threads'] });
    },
  });
}

export function useAbortSession() {
  return useMutation({
    mutationFn: (threadId: string) =>
      fetchJson<{ ok: boolean; wasRunning: boolean }>(`${API}/threads/${threadId}/abort`, {
        method: 'POST',
      }),
  });
}

// ── Branches ───────────────────────────────────────────────

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  lastCommitDate: string;
  lastCommitMessage: string;
}

export function useBranches(repoId: string | null) {
  return useQuery<BranchInfo[]>({
    queryKey: ['branches', repoId],
    queryFn: () => fetchJson(`${API}/repos/${repoId}/branches`),
    enabled: !!repoId,
  });
}

export function useCheckoutBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, branch }: { repoId: string; branch: string }) =>
      fetchJson<{ ok: boolean; branch: string }>(`${API}/repos/${repoId}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch }),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['branches', variables.repoId] });
      qc.invalidateQueries({ queryKey: ['repos'] });
    },
  });
}

export function useCreateBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, branch, startPoint }: { repoId: string; branch: string; startPoint?: string }) =>
      fetchJson<{ ok: boolean; branch: string }>(`${API}/repos/${repoId}/create-branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch, startPoint }),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['branches', variables.repoId] });
      qc.invalidateQueries({ queryKey: ['repos'] });
    },
  });
}

// ── Path Health ─────────────────────────────────────────────

export function usePathCheck() {
  return useQuery<{ missing: Array<{ type: string; id: string; name: string; path: string }>; count: number }>({
    queryKey: ['path-check'],
    queryFn: () => fetchJson(`${API}/check-paths`),
    staleTime: 60_000,
  });
}

// ── Providers ──────────────────────────────────────────────

export function useProviders() {
  return useQuery<Provider[]>({
    queryKey: ['providers'],
    queryFn: () => fetchJson(`${API}/providers`),
  });
}

export function useCreateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: { name: string; type: string; base_url?: string; default_model?: string }) =>
      fetchJson<Provider>(`${API}/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers'] });
    },
  });
}

export function useUpdateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...updates }: { id: string; name?: string; base_url?: string; default_model?: string }) =>
      fetchJson<Provider>(`${API}/providers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers'] });
    },
  });
}

export function useDeleteProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`${API}/providers/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['providers'] });
    },
  });
}

// ── Workspace Updates ───────────────────────────────────────

export function useUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...updates }: { id: string; color?: string; name?: string; sort_order?: number }) =>
      fetchJson<Workspace>(`${API}/workspaces/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

// ── Settings ────────────────────────────────────────────────

export function useSetting(key: string) {
  return useQuery<{ key: string; value: string } | null>({
    queryKey: ['settings', key],
    queryFn: async () => {
      try {
        return await fetchJson(`${API}/settings/${key}`);
      } catch {
        return null;
      }
    },
  });
}

export function useSetSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      fetchJson(`${API}/settings/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['settings', variables.key] });
    },
  });
}

// ── Thread Model ────────────────────────────────────────────

export function useUpdateThreadModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, provider, model }: { threadId: string; provider: string; model: string }) =>
      fetchJson<Thread>(`${API}/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model }),
      }),
    onSuccess: (thread) => {
      qc.invalidateQueries({ queryKey: ['thread', thread.id] });
      qc.invalidateQueries({ queryKey: ['threads'] });
    },
  });
}

// ── Adapters ────────────────────────────────────────────────

export interface AdapterInfo {
  providerId: string;
  displayName: string;
}

export function useAdapters() {
  return useQuery<AdapterInfo[]>({
    queryKey: ['adapters'],
    queryFn: () => fetchJson(`${API}/adapters`),
  });
}

// ── MCP Servers ─────────────────────────────────────────────

export const MCP_TRANSPORTS = ['stdio', 'http', 'sse'] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export function isMcpTransport(value: string): value is McpTransport {
  return MCP_TRANSPORTS.some((t) => t === value);
}

export interface McpServerInfo {
  name: string;
  source: 'workspace' | 'user';
  transport: McpTransport;
  command: string | null;
  args: string[];
  env: Record<string, string>;
  cwd: string | null;
  url: string | null;
  headers: Record<string, string>;
  state: 'idle' | 'starting' | 'ready' | 'error' | 'stopped';
  toolCount: number;
  tools: Array<{ name: string; description: string }>;
  error: string | null;
  pid: number | null;
  stderrTail: string[];
}

export type McpStdioConfigInput = {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

export type McpHttpConfigInput = {
  type: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
  // OAuth fields — when clientId is set, Trellis skips Dynamic Client
  // Registration and treats the server as pre-registered.
  clientId?: string;
  clientSecret?: string;
  scope?: string;
};

export type McpServerConfigInput = McpStdioConfigInput | McpHttpConfigInput;

export interface McpImportCandidate {
  source: string;
  servers: Record<string, McpServerConfigInput>;
}

const MCP_SERVERS_KEY = (workspaceId: string | null) => ['mcp-servers', workspaceId] as const;

export function useMcpServers(workspaceId: string | null) {
  return useQuery<McpServerInfo[]>({
    queryKey: MCP_SERVERS_KEY(workspaceId),
    queryFn: () =>
      fetchJson(
        workspaceId
          ? `${API}/mcp/servers?workspace_id=${encodeURIComponent(workspaceId)}`
          : `${API}/mcp/servers`,
      ),
    refetchInterval: workspaceId ? 3000 : false,
  });
}

export function useCreateMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, config }: { name: string; config: McpServerConfigInput }) =>
      fetchJson(`${API}/mcp/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-servers'] }),
  });
}

export function useUpdateMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, config }: { name: string; config: McpServerConfigInput }) =>
      fetchJson(`${API}/mcp/servers/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-servers'] }),
  });
}

export function useDeleteMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      fetchJson(`${API}/mcp/servers/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-servers'] }),
  });
}

export function useReloadMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, workspaceId }: { name: string; workspaceId: string }) =>
      fetchJson(`${API}/mcp/servers/${encodeURIComponent(name)}/reload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-servers'] }),
  });
}

export function useReloadAllMcp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) =>
      fetchJson(`${API}/mcp/reload-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-servers'] }),
  });
}

export function useClaudeCodeCandidates() {
  return useQuery<McpImportCandidate[]>({
    queryKey: ['mcp-candidates'],
    queryFn: () => fetchJson(`${API}/mcp/claude-code-candidates`),
    staleTime: 60_000,
  });
}

export function useImportMcpServers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ servers, overwrite }: { servers: Record<string, McpServerConfigInput>; overwrite: boolean }) =>
      fetchJson<{ imported: number; skipped: number }>(`${API}/mcp/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ servers, overwrite }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-servers'] }),
  });
}

// ── Thread Search ───────────────────────────────────────────

export function useThreadSearch(query: string) {
  return useQuery<Thread[]>({
    queryKey: ['thread-search', query],
    queryFn: () => fetchJson(`${API}/threads/search?q=${encodeURIComponent(query)}`),
    enabled: query.length >= 2,
  });
}

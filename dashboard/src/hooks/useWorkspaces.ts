import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Workspace, Repo, Thread, CreateWorkspaceRequest, CreateThreadRequest } from '@shared/types';

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

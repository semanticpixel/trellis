import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Annotation, CreateAnnotationRequest } from '@shared/types';

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

// ── Annotations ────────────────────────────────────────────

export function useAnnotations(threadId: string | null) {
  return useQuery<Annotation[]>({
    queryKey: ['annotations', threadId],
    queryFn: () => fetchJson(`${API}/threads/${threadId}/annotations`),
    enabled: !!threadId,
  });
}

export function useCreateAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, ...req }: CreateAnnotationRequest & { threadId: string }) =>
      fetchJson<Annotation>(`${API}/threads/${threadId}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['annotations', variables.threadId] });
    },
  });
}

export function useDeleteAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, threadId }: { id: string; threadId: string }) =>
      fetchJson(`${API}/annotations/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['annotations', variables.threadId] });
    },
  });
}

export function useResolveAnnotation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, threadId }: { id: string; threadId: string }) =>
      fetchJson(`${API}/annotations/${id}/resolve`, { method: 'PATCH' }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['annotations', variables.threadId] });
    },
  });
}

export function useSendFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, annotationIds }: { threadId: string; annotationIds: string[] }) =>
      fetchJson(`${API}/threads/${threadId}/send-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotationIds }),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['annotations', variables.threadId] });
      qc.invalidateQueries({ queryKey: ['messages', variables.threadId] });
    },
  });
}

// ── Diff ────────────────────────────────────────────────────

export interface DiffFileChange {
  file: string;
  additions: number;
  deletions: number;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldFile?: string;
}

export interface DiffResult {
  files: DiffFileChange[];
  patch: string;
  baseRef: string;
}

export interface FileDiff {
  file: string;
  original: string;
  modified: string;
}

export function useDiffSummary(repoId: string | null, baseRef?: string) {
  const params = baseRef ? `?base=${encodeURIComponent(baseRef)}` : '';
  return useQuery<DiffResult>({
    queryKey: ['diff', repoId, baseRef],
    queryFn: () => fetchJson(`${API}/repos/${repoId}/diff${params}`),
    enabled: !!repoId,
  });
}

export function useFileDiff(repoId: string | null, filePath: string | null, baseRef?: string) {
  const params = new URLSearchParams();
  if (filePath) params.set('path', filePath);
  if (baseRef) params.set('base', baseRef);
  return useQuery<FileDiff>({
    queryKey: ['file-diff', repoId, filePath, baseRef],
    queryFn: () => fetchJson(`${API}/repos/${repoId}/diff/file?${params}`),
    enabled: !!repoId && !!filePath,
  });
}

export function useStageFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, filePath }: { repoId: string; filePath: string }) =>
      fetchJson(`${API}/repos/${repoId}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['diff', variables.repoId] });
    },
  });
}

export function useRevertFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, filePath, baseRef }: { repoId: string; filePath: string; baseRef?: string }) =>
      fetchJson(`${API}/repos/${repoId}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath, baseRef }),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['diff', variables.repoId] });
      qc.invalidateQueries({ queryKey: ['file-diff', variables.repoId] });
    },
  });
}

// ── Plan ────────────────────────────────────────────────────

export interface PlanStep {
  id: string;
  content: string;
  depth: number;
  lineStart: number;
  lineEnd: number;
}

export interface PlanData {
  exists: boolean;
  steps: PlanStep[];
  raw: string;
}

export function usePlan(repoId: string | null) {
  return useQuery<PlanData>({
    queryKey: ['plan', repoId],
    queryFn: () => fetchJson(`${API}/repos/${repoId}/plan`),
    enabled: !!repoId,
  });
}

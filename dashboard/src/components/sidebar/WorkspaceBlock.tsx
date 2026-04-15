import { useState } from 'react';
import type { Workspace, Thread } from '@shared/types';
import { useRepos, useThreads, useCreateThread } from '../../hooks/useWorkspaces';
import { RepoRow } from './RepoRow';
import { ThreadRow } from './ThreadRow';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import styles from './WorkspaceBlock.module.css';

interface WorkspaceBlockProps {
  workspace: Workspace;
  activeThreadId: string | null;
  onSelectThread: (threadId: string, workspaceId: string) => void;
}

export function WorkspaceBlock({ workspace, activeThreadId, onSelectThread }: WorkspaceBlockProps) {
  const { data: repos } = useRepos(workspace.id);
  const { data: threads } = useThreads(workspace.id);
  const createThread = useCreateThread();

  // Auto-expand if contains active thread
  const containsActive = threads?.some((t) => t.id === activeThreadId) ?? false;
  const hasActiveStatus = threads?.some((t) => t.status === 'running' || t.status === 'awaiting-approval') ?? false;
  const [expanded, setExpanded] = useState(containsActive || hasActiveStatus);

  const workspaceThreads = threads?.filter((t) => !t.repo_id) ?? [];
  const repoThreadsMap = new Map<string, Thread[]>();
  for (const t of threads ?? []) {
    if (t.repo_id) {
      const arr = repoThreadsMap.get(t.repo_id) ?? [];
      arr.push(t);
      repoThreadsMap.set(t.repo_id, arr);
    }
  }

  const handleNewThread = (repoId?: string) => {
    createThread.mutate(
      { workspace_id: workspace.id, repo_id: repoId },
      {
        onSuccess: (thread) => {
          onSelectThread(thread.id, workspace.id);
          setExpanded(true);
        },
      },
    );
  };

  return (
    <div className={styles.block}>
      <div
        className={styles.header}
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <span className={styles.colorDot} style={{ backgroundColor: workspace.color }} />
        <span className={styles.name}>{workspace.name}</span>
        <span className={styles.chevron}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <button
          className={styles.addThread}
          onClick={(e) => { e.stopPropagation(); handleNewThread(); }}
          title="New thread"
        >
          <Plus size={12} />
        </button>
      </div>

      {expanded && (
        <div className={styles.body}>
          {/* Workspace-level threads */}
          {workspaceThreads.map((t) => (
            <ThreadRow
              key={t.id}
              thread={t}
              isActive={t.id === activeThreadId}
              isWorkspaceLevel
              onSelect={() => onSelectThread(t.id, workspace.id)}
            />
          ))}

          {workspaceThreads.length > 0 && repos && repos.length > 0 && (
            <div className={styles.separator} />
          )}

          {/* Repos + their threads */}
          {repos?.map((repo) => (
            <RepoRow
              key={repo.id}
              repo={repo}
              threads={repoThreadsMap.get(repo.id) ?? []}
              activeThreadId={activeThreadId}
              onSelectThread={(threadId) => onSelectThread(threadId, workspace.id)}
              onNewThread={() => handleNewThread(repo.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

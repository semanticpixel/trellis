import { useState } from 'react';
import type { Thread } from '@shared/types';
import type { RepoWithStatus } from '../../hooks/useWorkspaces';
import { ThreadRow } from './ThreadRow';
import { ChevronDown, ChevronRight, Plus, AlertTriangle } from 'lucide-react';
import styles from './RepoRow.module.css';

interface RepoRowProps {
  repo: RepoWithStatus;
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
}

export function RepoRow({ repo, threads, activeThreadId, onSelectThread, onNewThread }: RepoRowProps) {
  const containsActive = threads.some((t) => t.id === activeThreadId);
  const [expanded, setExpanded] = useState(containsActive || threads.length > 0);

  if (repo.missing) {
    return (
      <div className={styles.rowMissing}>
        <AlertTriangle size={12} />
        <span className={styles.missingName}>{repo.name}</span>
      </div>
    );
  }

  return (
    <div className={styles.repo}>
      <button className={styles.row} onClick={() => setExpanded(!expanded)}>
        <span className={styles.chevron}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className={styles.name}>{repo.name}</span>
        {repo.current_branch && (
          <span className={styles.branchPill}>{repo.current_branch}</span>
        )}
        <button
          className={styles.addThread}
          onClick={(e) => { e.stopPropagation(); onNewThread(); }}
          title="New thread in this repo"
        >
          <Plus size={11} />
        </button>
      </button>

      {expanded && (
        <div className={styles.threads}>
          {threads.length === 0 ? (
            <span className={styles.empty}>(no threads)</span>
          ) : (
            threads.map((t) => (
              <ThreadRow
                key={t.id}
                thread={t}
                isActive={t.id === activeThreadId}
                onSelect={() => onSelectThread(t.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

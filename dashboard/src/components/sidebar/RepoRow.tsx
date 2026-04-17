import { useState, useCallback, useRef } from 'react';
import type { Thread } from '@shared/types';
import type { RepoWithStatus } from '../../hooks/useWorkspaces';
import { ThreadRow } from './ThreadRow';
import { BranchPopover } from '../git/BranchPopover';
import { ChevronDown, ChevronRight, Plus, AlertTriangle } from 'lucide-react';
import styles from './RepoRow.module.css';

interface RepoRowProps {
  repo: RepoWithStatus;
  threads: Thread[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  notifiedThreadIds: Set<string>;
  unreadCounts: Record<string, number>;
}

export function RepoRow({ repo, threads, activeThreadId, onSelectThread, onNewThread, notifiedThreadIds, unreadCounts }: RepoRowProps) {
  const containsActive = threads.some((t) => t.id === activeThreadId);
  const [expanded, setExpanded] = useState(containsActive || threads.length > 0);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const branchPillRef = useRef<HTMLSpanElement>(null);

  const handleBranchClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setPopoverOpen(true);
  }, []);

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
          <span
            ref={branchPillRef}
            className={styles.branchPill}
            onClick={handleBranchClick}
            role="button"
            tabIndex={-1}
          >
            {repo.current_branch}
          </span>
        )}
        <button
          className={styles.addThread}
          onClick={(e) => { e.stopPropagation(); onNewThread(); }}
          title="New thread in this repo"
        >
          <Plus size={11} />
        </button>
      </button>

      {popoverOpen && branchPillRef.current && (
        <BranchPopover
          repoId={repo.id}
          currentBranch={repo.current_branch}
          anchorRect={branchPillRef.current.getBoundingClientRect()}
          onClose={() => setPopoverOpen(false)}
        />
      )}

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
                hasNotification={notifiedThreadIds.has(t.id)}
                unreadCount={unreadCounts[t.id] ?? 0}
                onSelect={() => onSelectThread(t.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

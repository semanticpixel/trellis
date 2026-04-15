import { useState, useEffect, useRef, useCallback } from 'react';
import { Check } from 'lucide-react';
import { useBranches, useCheckoutBranch, useCreateBranch } from '../../hooks/useWorkspaces';
import styles from './BranchPopover.module.css';

interface BranchPopoverProps {
  repoId: string;
  currentBranch: string | null;
  anchorRect: DOMRect;
  onClose: () => void;
}

function relativeDate(isoDate: string): string {
  if (!isoDate) return '';
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

export function BranchPopover({ repoId, currentBranch, anchorRect, onClose }: BranchPopoverProps) {
  const [filter, setFilter] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const { data: branches } = useBranches(repoId);
  const checkout = useCheckoutBranch();
  const create = useCreateBranch();

  // Focus search on mount
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSwitch = useCallback((branchName: string) => {
    if (branchName === currentBranch) return;
    setError(null);
    checkout.mutate(
      { repoId, branch: branchName },
      {
        onSuccess: () => onClose(),
        onError: (err) => setError(err.message),
      },
    );
  }, [repoId, currentBranch, checkout, onClose]);

  const handleCreate = useCallback(() => {
    const name = newBranch.trim();
    if (!name) return;
    setError(null);
    create.mutate(
      { repoId, branch: name },
      {
        onSuccess: () => onClose(),
        onError: (err) => setError(err.message),
      },
    );
  }, [repoId, newBranch, create, onClose]);

  const filtered = (branches ?? []).filter(
    (b) => !filter || b.name.toLowerCase().includes(filter.toLowerCase()),
  );

  const isBusy = checkout.isPending || create.isPending;

  // Position below the anchor
  const popoverStyle = {
    top: anchorRect.bottom + 4,
    left: Math.max(4, anchorRect.left),
  };

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div ref={popoverRef} className={styles.popover} style={popoverStyle}>
        <div className={styles.searchWrapper}>
          <input
            ref={searchRef}
            className={styles.searchInput}
            placeholder="Filter branches..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <div className={styles.branchList}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>No branches found</div>
          ) : (
            filtered.map((b) => (
              <button
                key={b.name}
                className={b.isCurrent ? styles.branchItemCurrent : styles.branchItem}
                onClick={() => handleSwitch(b.name)}
                disabled={isBusy}
              >
                {b.isCurrent ? (
                  <span className={styles.checkIcon}><Check size={12} /></span>
                ) : (
                  <span className={styles.checkPlaceholder} />
                )}
                <span className={styles.branchName}>{b.name}</span>
                <span className={styles.branchDate}>{relativeDate(b.lastCommitDate)}</span>
              </button>
            ))
          )}
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.footer}>
          <div className={styles.createRow}>
            <input
              className={styles.createInput}
              placeholder="New branch name..."
              value={newBranch}
              onChange={(e) => setNewBranch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              disabled={isBusy}
            />
            <button
              className={styles.createBtn}
              onClick={handleCreate}
              disabled={!newBranch.trim() || isBusy}
            >
              Create
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

import type { Thread } from '@shared/types';
import styles from './ThreadRow.module.css';

interface ThreadRowProps {
  thread: Thread;
  isActive: boolean;
  isWorkspaceLevel?: boolean;
  hasNotification?: boolean;
  unreadCount?: number;
  onSelect: () => void;
}

export function ThreadRow({ thread, isActive, isWorkspaceLevel, hasNotification, unreadCount = 0, onSelect }: ThreadRowProps) {
  const statusClass = styles[`status_${thread.status.replace('-', '_')}`] ?? '';

  return (
    <button
      className={`${styles.row} ${isActive ? styles.active : ''}`}
      onClick={onSelect}
    >
      <span className={`${styles.dot} ${isWorkspaceLevel ? styles.hollow : ''} ${statusClass}`} />
      <span className={styles.title}>{thread.title}</span>
      {unreadCount > 0 && !isActive && <span className={styles.unreadBadge}>{unreadCount}</span>}
      {hasNotification && !isActive && <span className={styles.notifyDot} />}
      {thread.status === 'running' && <span className={styles.spinner} />}
      {thread.status === 'awaiting-approval' && <span className={styles.approvalBadge}>review</span>}
    </button>
  );
}

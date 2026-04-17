import type { Workspace } from '@shared/types';
import { useThreads } from '../../hooks/useWorkspaces';
import styles from './FlatView.module.css';

interface FlatViewProps {
  workspaces: Workspace[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string, workspaceId: string) => void;
  notifiedThreadIds: Set<string>;
  unreadCounts: Record<string, number>;
}

export function FlatView({ workspaces, activeThreadId, onSelectThread, notifiedThreadIds, unreadCounts }: FlatViewProps) {
  return (
    <div className={styles.flat}>
      {workspaces.map((ws) => (
        <FlatWorkspaceBlock
          key={ws.id}
          workspace={ws}
          activeThreadId={activeThreadId}
          onSelectThread={onSelectThread}
          notifiedThreadIds={notifiedThreadIds}
          unreadCounts={unreadCounts}
        />
      ))}
    </div>
  );
}

function FlatWorkspaceBlock({
  workspace,
  activeThreadId,
  onSelectThread,
  notifiedThreadIds,
  unreadCounts,
}: {
  workspace: Workspace;
  activeThreadId: string | null;
  onSelectThread: (threadId: string, workspaceId: string) => void;
  notifiedThreadIds: Set<string>;
  unreadCounts: Record<string, number>;
}) {
  const { data: threads } = useThreads(workspace.id);

  return (
    <div className={styles.block}>
      <div className={styles.header}>
        <span className={styles.colorDot} style={{ backgroundColor: workspace.color }} />
        <span className={styles.name}>{workspace.name}</span>
      </div>

      <div className={styles.threads}>
        {threads && threads.length > 0 ? (
          threads.map((t) => {
            const unread = unreadCounts[t.id] ?? 0;
            return (
              <button
                key={t.id}
                className={`${styles.threadRow} ${t.id === activeThreadId ? styles.threadActive : ''}`}
                onClick={() => onSelectThread(t.id, workspace.id)}
              >
                <span className={styles.threadTitle}>{t.title}</span>
                {unread > 0 && t.id !== activeThreadId && (
                  <span className={styles.unreadBadge}>{unread}</span>
                )}
                {notifiedThreadIds.has(t.id) && t.id !== activeThreadId && (
                  <span className={styles.notifyDot} />
                )}
                {t.status === 'running' && <span className={styles.spinner} />}
              </button>
            );
          })
        ) : (
          <span className={styles.empty}>No threads</span>
        )}
      </div>
    </div>
  );
}

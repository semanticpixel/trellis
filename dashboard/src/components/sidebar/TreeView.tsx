import type { Workspace } from '@shared/types';
import { WorkspaceBlock } from './WorkspaceBlock';
import styles from './TreeView.module.css';

interface TreeViewProps {
  workspaces: Workspace[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string, workspaceId: string) => void;
  notifiedThreadIds: Set<string>;
  unreadCounts: Record<string, number>;
}

export function TreeView({ workspaces, activeThreadId, onSelectThread, notifiedThreadIds, unreadCounts }: TreeViewProps) {
  return (
    <div className={styles.tree}>
      {workspaces.map((ws) => (
        <WorkspaceBlock
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

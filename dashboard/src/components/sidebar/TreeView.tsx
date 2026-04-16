import type { Workspace } from '@shared/types';
import { WorkspaceBlock } from './WorkspaceBlock';
import styles from './TreeView.module.css';

interface TreeViewProps {
  workspaces: Workspace[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string, workspaceId: string) => void;
  notifiedThreadIds: Set<string>;
}

export function TreeView({ workspaces, activeThreadId, onSelectThread, notifiedThreadIds }: TreeViewProps) {
  return (
    <div className={styles.tree}>
      {workspaces.map((ws) => (
        <WorkspaceBlock
          key={ws.id}
          workspace={ws}
          activeThreadId={activeThreadId}
          onSelectThread={onSelectThread}
          notifiedThreadIds={notifiedThreadIds}
        />
      ))}
    </div>
  );
}

import type { Workspace } from '@shared/types';
import { WorkspaceBlock } from './WorkspaceBlock';
import styles from './TreeView.module.css';

interface TreeViewProps {
  workspaces: Workspace[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string, workspaceId: string) => void;
}

export function TreeView({ workspaces, activeThreadId, onSelectThread }: TreeViewProps) {
  return (
    <div className={styles.tree}>
      {workspaces.map((ws) => (
        <WorkspaceBlock
          key={ws.id}
          workspace={ws}
          activeThreadId={activeThreadId}
          onSelectThread={onSelectThread}
        />
      ))}
    </div>
  );
}

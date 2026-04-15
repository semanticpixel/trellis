import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaces, usePathCheck } from '../../hooks/useWorkspaces';
import { useWebSocket } from '../../hooks/useWebSocket';
import { TreeView } from './TreeView';
import { AddWorkspaceModal } from './AddWorkspaceModal';
import { MissingNotice } from './MissingNotice';
import type { WSMessage } from '@shared/types';
import styles from './Sidebar.module.css';

interface SidebarProps {
  activeThreadId: string | null;
  onSelectThread: (threadId: string, workspaceId: string) => void;
}

export function Sidebar({ activeThreadId, onSelectThread }: SidebarProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const { data: workspaces } = useWorkspaces();
  const { data: pathCheck } = usePathCheck();
  const qc = useQueryClient();

  // Listen for repo_update events to refresh branch pills
  useWebSocket(useCallback((msg: WSMessage) => {
    if (msg.type === 'repo_update') {
      qc.invalidateQueries({ queryKey: ['repos'] });
    }
  }, [qc]));

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.logo}>Trellis</span>
      </div>

      <div className={styles.content}>
        {workspaces && workspaces.length > 0 ? (
          <TreeView
            workspaces={workspaces}
            activeThreadId={activeThreadId}
            onSelectThread={onSelectThread}
          />
        ) : (
          <p className={styles.placeholder}>Add a workspace to get started</p>
        )}
      </div>

      {pathCheck && pathCheck.count > 0 && (
        <MissingNotice items={pathCheck.missing} />
      )}

      <div className={styles.footer}>
        <button className={styles.addButton} onClick={() => setShowAddModal(true)}>
          + Add workspace
        </button>
      </div>

      {showAddModal && (
        <AddWorkspaceModal onClose={() => setShowAddModal(false)} />
      )}
    </aside>
  );
}

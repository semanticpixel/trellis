import { useState } from 'react';
import { useWorkspaces, usePathCheck } from '../../hooks/useWorkspaces';
import { TreeView } from './TreeView';
import { AddWorkspaceModal } from './AddWorkspaceModal';
import { MissingNotice } from './MissingNotice';
import styles from './Sidebar.module.css';

interface SidebarProps {
  activeThreadId: string | null;
  onSelectThread: (threadId: string, workspaceId: string) => void;
}

export function Sidebar({ activeThreadId, onSelectThread }: SidebarProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const { data: workspaces } = useWorkspaces();
  const { data: pathCheck } = usePathCheck();

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

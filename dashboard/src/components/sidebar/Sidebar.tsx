import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaces, usePathCheck, useThreadSearch } from '../../hooks/useWorkspaces';
import { useWebSocket } from '../../hooks/useWebSocket';
import { usePersistedSetting } from '../../hooks/usePersistedSetting';
import { TreeView } from './TreeView';
import { FlatView } from './FlatView';
import { AddWorkspaceModal } from './AddWorkspaceModal';
import { MissingNotice } from './MissingNotice';
import { Settings, Search, List, GitBranch } from 'lucide-react';
import type { WSMessage } from '@shared/types';
import { DEFAULT_WORKSPACE_COLOR } from '@shared/constants';
import styles from './Sidebar.module.css';

interface SidebarProps {
  activeThreadId: string | null;
  onSelectThread: (threadId: string, workspaceId: string) => void;
  onOpenSettings: () => void;
  notifiedThreadIds: Set<string>;
  unreadCounts: Record<string, number>;
  searchInputRef?: React.Ref<HTMLInputElement>;
}

type ViewMode = 'tree' | 'flat';
const isViewMode = (v: unknown): v is ViewMode => v === 'tree' || v === 'flat';

export function Sidebar({ activeThreadId, onSelectThread, onOpenSettings, notifiedThreadIds, unreadCounts, searchInputRef }: SidebarProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [viewMode, setViewMode] = usePersistedSetting<ViewMode>('sidebar.mode', 'tree', isViewMode);
  const [searchQuery, setSearchQuery] = useState('');
  const { data: workspaces } = useWorkspaces();
  const { data: pathCheck } = usePathCheck();
  const { data: searchResults } = useThreadSearch(searchQuery);
  const qc = useQueryClient();

  // Listen for repo_update and thread_status events to refresh sidebar
  useWebSocket(useCallback((msg: WSMessage) => {
    if (msg.type === 'repo_update') {
      qc.invalidateQueries({ queryKey: ['repos'] });
    }
    if (msg.type === 'thread_status' || msg.type === 'thread_error' || msg.type === 'thread_update') {
      qc.invalidateQueries({ queryKey: ['threads'] });
      qc.invalidateQueries({ queryKey: ['thread', msg.threadId] });
    }
  }, [qc]));

  const isSearching = searchQuery.length >= 2;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.logo}>Trellis</span>
        <div className={styles.headerActions}>
          <button
            className={`${styles.viewToggle} ${viewMode === 'tree' ? styles.viewToggleActive : ''}`}
            onClick={() => setViewMode('tree')}
            title="Tree view"
          >
            <GitBranch size={14} />
          </button>
          <button
            className={`${styles.viewToggle} ${viewMode === 'flat' ? styles.viewToggleActive : ''}`}
            onClick={() => setViewMode('flat')}
            title="Flat view"
          >
            <List size={14} />
          </button>
        </div>
      </div>

      <div className={styles.searchBar}>
        <Search size={13} className={styles.searchIcon} />
        <input
          ref={searchInputRef}
          className={styles.searchInput}
          placeholder="Search threads..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className={styles.content}>
        {isSearching && searchResults ? (
          <div className={styles.searchResults}>
            {searchResults.length === 0 ? (
              <p className={styles.placeholder}>No threads found</p>
            ) : (
              searchResults.map((t) => {
                const ws = workspaces?.find((w) => w.id === t.workspace_id);
                const unread = unreadCounts[t.id] ?? 0;
                return (
                  <button
                    key={t.id}
                    className={`${styles.searchResultRow} ${t.id === activeThreadId ? styles.searchResultActive : ''}`}
                    onClick={() => onSelectThread(t.id, t.workspace_id)}
                  >
                    <span className={styles.searchResultDot} style={{ backgroundColor: ws?.color ?? DEFAULT_WORKSPACE_COLOR }} />
                    <span className={styles.searchResultTitle}>{t.title}</span>
                    {unread > 0 && <span className={styles.unreadBadge}>{unread}</span>}
                    {notifiedThreadIds.has(t.id) && <span className={styles.notifyDot} />}
                  </button>
                );
              })
            )}
          </div>
        ) : workspaces && workspaces.length > 0 ? (
          viewMode === 'tree' ? (
            <TreeView
              workspaces={workspaces}
              activeThreadId={activeThreadId}
              onSelectThread={onSelectThread}
              notifiedThreadIds={notifiedThreadIds}
              unreadCounts={unreadCounts}
            />
          ) : (
            <FlatView
              workspaces={workspaces}
              activeThreadId={activeThreadId}
              onSelectThread={onSelectThread}
              notifiedThreadIds={notifiedThreadIds}
              unreadCounts={unreadCounts}
            />
          )
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
        <button className={styles.settingsButton} onClick={onOpenSettings} title="Settings">
          <Settings size={15} />
        </button>
      </div>

      {showAddModal && (
        <AddWorkspaceModal onClose={() => setShowAddModal(false)} />
      )}
    </aside>
  );
}

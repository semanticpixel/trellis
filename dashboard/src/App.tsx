import { useState, useCallback } from 'react';
import { Sidebar } from './components/sidebar/Sidebar';
import { ChatPanel } from './components/chat/ChatPanel';
import { useWorkspaces } from './hooks/useWorkspaces';
import { useQuery } from '@tanstack/react-query';
import type { Thread } from '@shared/types';
import styles from './App.module.css';

export function App() {
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const { data: workspaces } = useWorkspaces();

  const { data: activeThread } = useQuery<Thread>({
    queryKey: ['thread', activeThreadId],
    queryFn: async () => {
      const res = await fetch(`/api/threads/${activeThreadId}`);
      return res.json();
    },
    enabled: !!activeThreadId,
  });

  const activeWorkspace = workspaces?.find((w) => w.id === activeWorkspaceId);

  const handleSelectThread = useCallback((threadId: string, workspaceId: string) => {
    setActiveThreadId(threadId);
    setActiveWorkspaceId(workspaceId);
  }, []);

  return (
    <div className={styles.shell}>
      <Sidebar
        activeThreadId={activeThreadId}
        onSelectThread={handleSelectThread}
      />

      <ChatPanel
        thread={activeThread ?? null}
        workspaceColor={activeWorkspace?.color ?? '#6e7681'}
        onToggleReview={() => setReviewPanelOpen(!reviewPanelOpen)}
        reviewOpen={reviewPanelOpen}
      />

      {reviewPanelOpen && (
        <aside className={styles.reviewPanel}>
          <div className={styles.reviewHeader}>
            <button className={styles.reviewTab}>Diff</button>
            <button className={styles.reviewTab}>Plan</button>
          </div>
          <div className={styles.reviewContent}>
            <p className={styles.placeholder}>Review panel — Phase 2</p>
          </div>
        </aside>
      )}
    </div>
  );
}

import { useState, useCallback, useEffect } from 'react';
import { Sidebar } from './components/sidebar/Sidebar';
import { ChatPanel } from './components/chat/ChatPanel';
import { ReviewPanel } from './components/review/ReviewPanel';
import { useWorkspaces, useRepos } from './hooks/useWorkspaces';
import { useQuery } from '@tanstack/react-query';
import type { Thread } from '@shared/types';
import styles from './App.module.css';

export function App() {
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
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
  const { data: repos } = useRepos(activeWorkspaceId ?? undefined);
  const activeRepo = repos?.find((r) => r.id === activeThread?.repo_id);

  // Terminal cwd: prefer active repo path, fall back to workspace path
  const terminalCwd = activeRepo?.path ?? activeWorkspace?.path ?? '';

  const handleSelectThread = useCallback((threadId: string, workspaceId: string) => {
    setActiveThreadId(threadId);
    setActiveWorkspaceId(workspaceId);
  }, []);

  // Global Cmd+` shortcut to toggle terminal
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === '`') {
        e.preventDefault();
        setTerminalOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
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
        terminalOpen={terminalOpen}
        onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
        onCloseTerminal={() => setTerminalOpen(false)}
        workspaceId={activeWorkspaceId}
        terminalCwd={terminalCwd}
      />

      {reviewPanelOpen && (
        <ReviewPanel
          thread={activeThread ?? null}
          repoId={activeThread?.repo_id ?? null}
        />
      )}
    </div>
  );
}

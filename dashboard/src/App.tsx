import { useState, useCallback, useEffect, useRef } from 'react';
import { Sidebar } from './components/sidebar/Sidebar';
import { ChatPanel } from './components/chat/ChatPanel';
import { ReviewPanel } from './components/review/ReviewPanel';
import { SettingsOverlay } from './components/settings/SettingsOverlay';
import { useWorkspaces, useRepos, useCreateThread } from './hooks/useWorkspaces';
import { useWebSocket } from './hooks/useWebSocket';
import { useQuery } from '@tanstack/react-query';
import type { Thread, WSMessage } from '@shared/types';
import styles from './App.module.css';

export function App() {
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notifiedThreadIds, setNotifiedThreadIds] = useState<Set<string>>(new Set());
  const { data: workspaces } = useWorkspaces();
  const createThread = useCreateThread();
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;

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
    // Clear notification for this thread
    setNotifiedThreadIds((prev) => {
      if (!prev.has(threadId)) return prev;
      const next = new Set(prev);
      next.delete(threadId);
      return next;
    });
  }, []);

  // Listen for thread_status events to trigger notification dots
  useWebSocket(useCallback((msg: WSMessage) => {
    if (msg.type === 'thread_status') {
      const threadId = msg.threadId;
      // If this thread is not the active one, mark it as notified
      if (threadId !== activeThreadIdRef.current) {
        setNotifiedThreadIds((prev) => {
          if (prev.has(threadId)) return prev;
          const next = new Set(prev);
          next.add(threadId);
          return next;
        });
      }
    }
  }, []));

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

      // Cmd+` — toggle terminal
      if (meta && e.key === '`') {
        e.preventDefault();
        setTerminalOpen((prev) => !prev);
        return;
      }

      // Cmd+N — new thread in active workspace
      if (meta && e.key === 'n' && !e.shiftKey) {
        e.preventDefault();
        if (activeWorkspaceId) {
          createThread.mutate(
            { workspace_id: activeWorkspaceId },
            {
              onSuccess: (thread) => {
                setActiveThreadId(thread.id);
              },
            },
          );
        }
        return;
      }

      // Cmd+1 through Cmd+4 — switch workspace
      if (meta && !e.shiftKey && e.key >= '1' && e.key <= '4') {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        if (workspaces && workspaces[idx]) {
          setActiveWorkspaceId(workspaces[idx].id);
        }
        return;
      }

      // Cmd+Shift+D — toggle review panel
      if (meta && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        setReviewPanelOpen((prev) => !prev);
        return;
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [activeWorkspaceId, workspaces, createThread]);

  return (
    <div className={styles.shell}>
      <Sidebar
        activeThreadId={activeThreadId}
        onSelectThread={handleSelectThread}
        onOpenSettings={() => setSettingsOpen(true)}
        notifiedThreadIds={notifiedThreadIds}
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
        hasWorkspaces={!!workspaces && workspaces.length > 0}
      />

      {reviewPanelOpen && (
        <ReviewPanel
          thread={activeThread ?? null}
          repoId={activeThread?.repo_id ?? null}
        />
      )}

      {settingsOpen && (
        <SettingsOverlay onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

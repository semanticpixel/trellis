import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Sidebar } from './components/sidebar/Sidebar';
import { ChatPanel } from './components/chat/ChatPanel';
import { ReviewPanel } from './components/review/ReviewPanel';
import { SettingsOverlay } from './components/settings/SettingsOverlay';
import { ShortcutReference } from './components/settings/ShortcutReference';
import { Resizer } from './components/layout/Resizer';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { useWorkspaces, useRepos, useCreateThread, useSendMessage } from './hooks/useWorkspaces';
import { useWebSocket } from './hooks/useWebSocket';
import { usePanelWidths } from './hooks/usePanelWidths';
import { usePersistedSetting } from './hooks/usePersistedSetting';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Thread, WSMessage } from '@shared/types';
import { DEFAULT_WORKSPACE_COLOR } from '@shared/constants';
import styles from './App.module.css';

const isStringOrNull = (v: unknown): v is string | null =>
  v === null || typeof v === 'string';

const isUnreadCounts = (v: unknown): v is Record<string, number> =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v as Record<string, unknown>).every(
    (n) => typeof n === 'number' && Number.isFinite(n),
  );

export function App() {
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = usePersistedSetting<string | null>(
    'session.activeThreadId',
    null,
    isStringOrNull,
  );
  const [activeWorkspaceId, setActiveWorkspaceId] = usePersistedSetting<string | null>(
    'session.activeWorkspaceId',
    null,
    isStringOrNull,
  );
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutReferenceOpen, setShortcutReferenceOpen] = useState(false);
  const [notifiedThreadIds, setNotifiedThreadIds] = useState<Set<string>>(new Set());
  const [unreadCounts, setUnreadCounts] = usePersistedSetting<Record<string, number>>(
    'session.unreadCounts',
    {},
    isUnreadCounts,
  );
  const [autoFocusFile, setAutoFocusFile] = useState<{ path: string; token: number } | null>(null);
  const [composerFocusToken, setComposerFocusToken] = useState(0);
  const sidebarSearchRef = useRef<HTMLInputElement>(null);
  const { data: workspaces } = useWorkspaces();
  const createThread = useCreateThread();
  const sendMessage = useSendMessage();
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;
  const {
    sidebarWidth,
    reviewWidth,
    resizeSidebar,
    resizeReview,
    persistSidebar,
    persistReview,
  } = usePanelWidths();
  const qc = useQueryClient();

  const { data: activeThread, isError: activeThreadError } = useQuery<Thread>({
    queryKey: ['thread', activeThreadId],
    queryFn: async () => {
      const res = await fetch(`/api/threads/${activeThreadId}`);
      if (!res.ok) throw new Error(`Thread fetch failed (${res.status})`);
      return res.json();
    },
    enabled: !!activeThreadId,
    retry: false,
  });

  // Full thread set across all workspaces — drives the orphan-entry pruner
  // below. Existing `qc.invalidateQueries({ queryKey: ['threads'] })` calls
  // (e.g. from the sidebar WS handler) refetch this by prefix match.
  const { data: allThreads } = useQuery<Thread[]>({
    queryKey: ['threads'],
    queryFn: async () => {
      const res = await fetch('/api/threads');
      if (!res.ok) throw new Error(`Threads fetch failed (${res.status})`);
      return res.json();
    },
  });

  const allKnownThreadIds = useMemo(
    () => (allThreads ? new Set(allThreads.map((t) => t.id)) : null),
    [allThreads],
  );

  // Prune persisted unread/notified entries for threads that no longer exist
  // (workspace deletion cascades, imported from another machine, manual DB
  // edits). Skips the initial undefined state so a pending fetch doesn't wipe
  // live counts.
  useEffect(() => {
    if (!allKnownThreadIds) return;
    setUnreadCounts((prev) => {
      let changed = false;
      const next: Record<string, number> = {};
      for (const [id, count] of Object.entries(prev)) {
        if (allKnownThreadIds.has(id)) next[id] = count;
        else changed = true;
      }
      return changed ? next : prev;
    });
    setNotifiedThreadIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (allKnownThreadIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [allKnownThreadIds, setUnreadCounts]);

  // Drop persisted IDs that no longer point at real entities (thread/workspace
  // deleted between sessions, or imported from a different machine).
  useEffect(() => {
    if (activeThreadId && activeThreadError) {
      setActiveThreadId(null);
    }
  }, [activeThreadId, activeThreadError, setActiveThreadId]);

  useEffect(() => {
    if (!workspaces || !activeWorkspaceId) return;
    if (!workspaces.some((w) => w.id === activeWorkspaceId)) {
      setActiveWorkspaceId(null);
    }
  }, [workspaces, activeWorkspaceId, setActiveWorkspaceId]);

  const activeWorkspace = workspaces?.find((w) => w.id === activeWorkspaceId);
  const { data: repos } = useRepos(activeWorkspaceId ?? undefined);
  const activeRepo = repos?.find((r) => r.id === activeThread?.repo_id);

  // Terminal cwd: prefer active repo path, fall back to workspace path
  const terminalCwd = activeRepo?.path ?? activeWorkspace?.path ?? '';

  const handleSelectThread = useCallback((threadId: string, workspaceId: string) => {
    setActiveThreadId(threadId);
    setActiveWorkspaceId(workspaceId);
    setComposerFocusToken((n) => n + 1);
    // Clear notification for this thread
    setNotifiedThreadIds((prev) => {
      if (!prev.has(threadId)) return prev;
      const next = new Set(prev);
      next.delete(threadId);
      return next;
    });
    setUnreadCounts((prev) => {
      if (!prev[threadId]) return prev;
      const next = { ...prev };
      delete next[threadId];
      return next;
    });
  }, [setActiveThreadId, setActiveWorkspaceId, setUnreadCounts]);

  const handleStartWithPrompt = useCallback((workspaceId: string, prompt: string) => {
    createThread.mutate(
      { workspace_id: workspaceId },
      {
        onSuccess: (thread) => {
          setActiveThreadId(thread.id);
          setActiveWorkspaceId(workspaceId);
          sendMessage.mutate({ threadId: thread.id, content: prompt });
        },
      },
    );
  }, [createThread, sendMessage]);

  // Expire composer drafts older than 7 days on startup.
  useEffect(() => {
    const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('trellis:draft:')) continue;
      let stale = true;
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw) as { updatedAt?: unknown };
          if (typeof parsed?.updatedAt === 'number' && now - parsed.updatedAt <= MAX_AGE_MS) {
            stale = false;
          }
        }
      } catch {
        // unparseable → treat as stale
      }
      if (stale) toDelete.push(key);
    }
    for (const key of toDelete) localStorage.removeItem(key);
  }, []);

  // Listen for thread events
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

    if (msg.type === 'thread_message' && msg.threadId !== activeThreadIdRef.current) {
      const threadId = msg.threadId;
      setUnreadCounts((prev) => ({
        ...prev,
        [threadId]: (prev[threadId] ?? 0) + 1,
      }));
    }

    // Auto-open the review panel and focus on the changed file when the
    // LLM writes or edits a file in the active thread.
    if (msg.type === 'thread_tool_end' && msg.threadId === activeThreadIdRef.current) {
      const data = msg.data as { name?: string; input?: { path?: string }; result?: { isError?: boolean } };
      if ((data.name === 'write_file' || data.name === 'edit_file') && !data.result?.isError) {
        const path = data.input?.path;
        if (path) {
          setReviewPanelOpen(true);
          setAutoFocusFile({ path, token: Date.now() });
          qc.invalidateQueries({ queryKey: ['diff'] });
          qc.invalidateQueries({ queryKey: ['file-diff'] });
        }
      }
    }
  }, [qc, setUnreadCounts]));

  // Global keyboard shortcuts (non-menu shortcuts only — menu-driven
  // accelerators like Cmd+` and Cmd+Shift+D are registered in the
  // Electron application menu and dispatched via IPC below).
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;

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

      // Cmd+K — focus sidebar search
      if (meta && e.key === 'k' && !e.shiftKey) {
        e.preventDefault();
        const input = sidebarSearchRef.current;
        if (input) {
          input.scrollIntoView({ block: 'nearest' });
          input.focus();
        }
        return;
      }

      // Cmd+/ or Cmd+? — show keyboard shortcut reference. Cmd+? is the
      // macOS-native help accelerator; Cmd+/ keeps working on keyboard
      // layouts where Shift+/ doesn't produce '?'.
      if (meta && ((e.key === '/' && !e.shiftKey) || (e.shiftKey && e.key === '?'))) {
        e.preventDefault();
        setShortcutReferenceOpen(true);
        return;
      }

      // Cmd+1 through Cmd+9 — switch workspace (no-op if index out of range)
      if (meta && !e.shiftKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        if (workspaces && workspaces[idx]) {
          setActiveWorkspaceId(workspaces[idx].id);
        }
        return;
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [activeWorkspaceId, workspaces, createThread]);

  // Electron application menu → renderer bridge. When running in a plain
  // browser (dev without Electron shell), window.api is undefined and the
  // toggles are only reachable by clicking the in-app buttons.
  useEffect(() => {
    const menu = window.api?.menu;
    if (!menu) return;
    const offTerminal = menu.onToggleTerminal(() => setTerminalOpen((prev) => !prev));
    const offReview = menu.onToggleReview(() => setReviewPanelOpen((prev) => !prev));
    return () => {
      offTerminal();
      offReview();
    };
  }, []);

  const shellStyle = {
    '--sidebar-width': `${sidebarWidth}px`,
    '--review-width': `${reviewWidth}px`,
  } as React.CSSProperties;

  return (
    <ErrorBoundary label="app">
    <div className={styles.shell} style={shellStyle}>
      <Sidebar
        activeThreadId={activeThreadId}
        onSelectThread={handleSelectThread}
        onOpenSettings={() => setSettingsOpen(true)}
        notifiedThreadIds={notifiedThreadIds}
        unreadCounts={unreadCounts}
        searchInputRef={sidebarSearchRef}
      />

      <Resizer
        ariaLabel="Resize sidebar"
        onResize={resizeSidebar}
        onResizeEnd={persistSidebar}
      />

      <ChatPanel
        thread={activeThread ?? null}
        workspaceColor={activeWorkspace?.color ?? DEFAULT_WORKSPACE_COLOR}
        onToggleReview={() => setReviewPanelOpen(!reviewPanelOpen)}
        reviewOpen={reviewPanelOpen}
        terminalOpen={terminalOpen}
        onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
        onCloseTerminal={() => setTerminalOpen(false)}
        workspaceId={activeWorkspaceId}
        terminalCwd={terminalCwd}
        hasWorkspaces={!!workspaces && workspaces.length > 0}
        workspaces={workspaces ?? []}
        onStartWithPrompt={handleStartWithPrompt}
        composerFocusToken={composerFocusToken}
      />

      {reviewPanelOpen && (
        <>
          <Resizer
            ariaLabel="Resize review panel"
            onResize={resizeReview}
            onResizeEnd={persistReview}
          />
          <ErrorBoundary label="review">
            <ReviewPanel
              thread={activeThread ?? null}
              repoId={activeThread?.repo_id ?? null}
              autoFocusFile={autoFocusFile}
            />
          </ErrorBoundary>
        </>
      )}

      {settingsOpen && (
        <SettingsOverlay
          onClose={() => setSettingsOpen(false)}
          onOpenShortcutReference={() => {
            setSettingsOpen(false);
            setShortcutReferenceOpen(true);
          }}
        />
      )}

      {shortcutReferenceOpen && (
        <ShortcutReference onClose={() => setShortcutReferenceOpen(false)} />
      )}
    </div>
    </ErrorBoundary>
  );
}

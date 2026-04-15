import { useState, useCallback } from 'react';
import { useAnnotations, useSendFeedback } from '../../hooks/useReview';
import type { Thread } from '@shared/types';
import styles from './ReviewPanel.module.css';

// Lazy-load tabs since they include Monaco
import { lazy, Suspense } from 'react';
const DiffTab = lazy(() => import('./DiffTab').then((m) => ({ default: m.DiffTab })));
const PlanTab = lazy(() => import('./PlanTab').then((m) => ({ default: m.PlanTab })));

type TabId = 'diff' | 'plan';

interface ReviewPanelProps {
  thread: Thread | null;
  repoId: string | null;
}

export function ReviewPanel({ thread, repoId }: ReviewPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('diff');
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<Set<string>>(new Set());

  const threadId = thread?.id ?? null;
  const { data: annotations } = useAnnotations(threadId);
  const sendFeedback = useSendFeedback();

  const unresolvedAnnotations = annotations?.filter((a) => a.resolved === 0) ?? [];
  const selectedUnresolved = unresolvedAnnotations.filter((a) => selectedAnnotationIds.has(a.id));

  const toggleAnnotationSelection = useCallback((id: string) => {
    setSelectedAnnotationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAllUnresolved = useCallback(() => {
    setSelectedAnnotationIds(new Set(unresolvedAnnotations.map((a) => a.id)));
  }, [unresolvedAnnotations]);

  const handleSendFeedback = useCallback(() => {
    if (!threadId || selectedUnresolved.length === 0) return;
    const ids = selectedUnresolved.map((a) => a.id);
    sendFeedback.mutate(
      { threadId, annotationIds: ids },
      {
        onSuccess: () => {
          setSelectedAnnotationIds(new Set());
        },
      },
    );
  }, [threadId, selectedUnresolved, sendFeedback]);

  if (!thread) {
    return (
      <aside className={styles.panel}>
        <div className={styles.header}>
          <div className={styles.tabs}>
            <button className={`${styles.tab} ${styles.tabActive}`}>Diff</button>
            <button className={styles.tab}>Plan</button>
          </div>
        </div>
        <div className={styles.content}>
          <p className={styles.placeholder}>Select a thread to view diffs and plans</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === 'diff' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('diff')}
          >
            Diff
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'plan' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('plan')}
          >
            Plan
          </button>
        </div>

        {unresolvedAnnotations.length > 0 && (
          <div className={styles.feedbackActions}>
            <button
              className={styles.selectAll}
              onClick={selectAllUnresolved}
              title="Select all unresolved annotations"
            >
              All ({unresolvedAnnotations.length})
            </button>
            <button
              className={styles.sendFeedback}
              onClick={handleSendFeedback}
              disabled={selectedUnresolved.length === 0 || sendFeedback.isPending}
            >
              Send feedback ({selectedUnresolved.length})
            </button>
          </div>
        )}
      </div>

      <div className={styles.content}>
        <Suspense fallback={<div className={styles.placeholder}>Loading...</div>}>
          {activeTab === 'diff' ? (
            <DiffTab
              thread={thread}
              repoId={repoId}
              annotations={annotations ?? []}
              selectedAnnotationIds={selectedAnnotationIds}
              onToggleAnnotation={toggleAnnotationSelection}
            />
          ) : (
            <PlanTab
              thread={thread}
              repoId={repoId}
              annotations={annotations ?? []}
              selectedAnnotationIds={selectedAnnotationIds}
              onToggleAnnotation={toggleAnnotationSelection}
            />
          )}
        </Suspense>
      </div>
    </aside>
  );
}

import { useState, useCallback } from 'react';
import { InlineComment } from './InlineComment';
import { AnnotationBadge } from './AnnotationBadge';
import { usePlan, useCreateAnnotation, useDeleteAnnotation } from '../../hooks/useReview';
import type { Thread, Annotation, AnnotationType } from '@shared/types';
import styles from './PlanTab.module.css';

interface PlanTabProps {
  thread: Thread;
  repoId: string | null;
  annotations: Annotation[];
  selectedAnnotationIds: Set<string>;
  onToggleAnnotation: (id: string) => void;
}

export function PlanTab({ thread, repoId, annotations, selectedAnnotationIds, onToggleAnnotation }: PlanTabProps) {
  const [selectedSteps, setSelectedSteps] = useState<Set<string>>(new Set());
  const [commentingStep, setCommentingStep] = useState<string | null>(null);

  const { data: planData } = usePlan(repoId);
  const createAnnotation = useCreateAnnotation();
  const deleteAnnotation = useDeleteAnnotation();

  // Filter annotations for plan steps
  const stepAnnotations = annotations.filter((a) => a.target_type === 'plan_step');

  const handleStepClick = useCallback(
    (stepId: string, e: React.MouseEvent) => {
      if (e.shiftKey) {
        // Multi-select
        setSelectedSteps((prev) => {
          const next = new Set(prev);
          if (next.has(stepId)) {
            next.delete(stepId);
          } else {
            next.add(stepId);
          }
          return next;
        });
      } else {
        // Single select/deselect toggles the commenting form
        setSelectedSteps(new Set([stepId]));
        setCommentingStep((prev) => (prev === stepId ? null : stepId));
      }
    },
    [],
  );

  const handleCommentSubmit = useCallback(
    (type: AnnotationType, text: string, replacement?: string) => {
      if (!commentingStep) return;
      const step = planData?.steps.find((s) => s.id === commentingStep);
      if (!step) return;

      createAnnotation.mutate(
        {
          threadId: thread.id,
          target_type: 'plan_step',
          target_ref: step.content,
          annotation_type: type,
          text,
          replacement,
        },
        {
          onSuccess: () => {
            setCommentingStep(null);
          },
        },
      );
    },
    [commentingStep, planData, thread.id, createAnnotation],
  );

  const handleDeleteAnnotation = useCallback(
    (id: string) => {
      deleteAnnotation.mutate({ id, threadId: thread.id });
    },
    [thread.id, deleteAnnotation],
  );

  // Get annotations for a specific step
  const getStepAnnotations = (stepContent: string) =>
    stepAnnotations.filter((a) => a.target_ref === stepContent);

  if (!repoId) {
    return <div className={styles.placeholder}>Select a repo-level thread to view plans</div>;
  }

  if (!planData || !planData.exists) {
    return (
      <div className={styles.placeholder}>
        No .trellis-plan.md found in the repo root.
        <br />
        Create one to use the plan annotation feature.
      </div>
    );
  }

  if (planData.steps.length === 0) {
    return <div className={styles.placeholder}>Plan file is empty or has no parseable steps</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.hint}>Click a step to annotate. Shift-click to multi-select.</div>

      <div className={styles.steps}>
        {planData.steps.map((step) => {
          const isSelected = selectedSteps.has(step.id);
          const isCommenting = commentingStep === step.id;
          const annotations = getStepAnnotations(step.content);
          const hasAnnotations = annotations.length > 0;

          return (
            <div key={step.id} className={styles.stepBlock}>
              <div
                className={`${styles.step} ${isSelected ? styles.stepSelected : ''} ${hasAnnotations ? styles.stepAnnotated : ''}`}
                style={{ paddingLeft: `${step.depth * 16 + 12}px` }}
                onClick={(e) => handleStepClick(step.id, e)}
              >
                <span className={styles.stepContent}>{step.content}</span>
                {hasAnnotations && (
                  <span className={styles.annotationCount}>{annotations.length}</span>
                )}
              </div>

              {/* Inline annotations under the step */}
              {annotations.map((a) => (
                <div key={a.id} className={styles.stepAnnotation} style={{ paddingLeft: `${step.depth * 16 + 24}px` }}>
                  <AnnotationBadge
                    annotation={a}
                    selected={selectedAnnotationIds.has(a.id)}
                    onToggleSelect={onToggleAnnotation}
                    onDelete={handleDeleteAnnotation}
                  />
                </div>
              ))}

              {/* Inline comment form when this step is being commented on */}
              {isCommenting && (
                <div className={styles.commentForm} style={{ paddingLeft: `${step.depth * 16 + 24}px` }}>
                  <InlineComment
                    onSubmit={handleCommentSubmit}
                    onCancel={() => setCommentingStep(null)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

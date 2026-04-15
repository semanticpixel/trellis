import type { Annotation } from '@shared/types';
import styles from './AnnotationBadge.module.css';

interface AnnotationBadgeProps {
  annotation: Annotation;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  comment: 'Comment',
  question: 'Question',
  delete: 'Delete',
  replace: 'Replace',
};

export function AnnotationBadge({ annotation, selected, onToggleSelect, onDelete }: AnnotationBadgeProps) {
  const resolved = annotation.resolved === 1;

  return (
    <div className={`${styles.badge} ${resolved ? styles.resolved : ''}`}>
      <div className={styles.header}>
        <label className={styles.checkboxLabel}>
          {!resolved && (
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={selected}
              onChange={() => onToggleSelect(annotation.id)}
            />
          )}
          <span className={`${styles.type} ${styles[annotation.annotation_type]}`}>
            {TYPE_LABELS[annotation.annotation_type]}
          </span>
        </label>
        {!resolved && (
          <button
            className={styles.deleteBtn}
            onClick={() => onDelete(annotation.id)}
            title="Delete annotation"
          >
            &times;
          </button>
        )}
      </div>
      <div className={styles.text}>{annotation.text}</div>
      {annotation.replacement && (
        <div className={styles.replacement}>
          <span className={styles.replacementLabel}>Replacement:</span>
          <code className={styles.replacementCode}>{annotation.replacement}</code>
        </div>
      )}
    </div>
  );
}

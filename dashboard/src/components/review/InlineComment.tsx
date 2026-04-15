import { useState } from 'react';
import type { AnnotationType } from '@shared/types';
import styles from './InlineComment.module.css';

const ANNOTATION_TYPES: { value: AnnotationType; label: string }[] = [
  { value: 'comment', label: 'Comment' },
  { value: 'question', label: 'Question' },
  { value: 'delete', label: 'Delete' },
  { value: 'replace', label: 'Replace' },
];

interface InlineCommentProps {
  onSubmit: (type: AnnotationType, text: string, replacement?: string) => void;
  onCancel: () => void;
}

export function InlineComment({ onSubmit, onCancel }: InlineCommentProps) {
  const [annotationType, setAnnotationType] = useState<AnnotationType>('comment');
  const [text, setText] = useState('');
  const [replacement, setReplacement] = useState('');

  const handleSubmit = () => {
    if (!text.trim()) return;
    onSubmit(annotationType, text.trim(), annotationType === 'replace' ? replacement : undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div className={styles.container} onKeyDown={handleKeyDown}>
      <div className={styles.typeSelector}>
        {ANNOTATION_TYPES.map((t) => (
          <button
            key={t.value}
            className={`${styles.typeBtn} ${annotationType === t.value ? styles.typeBtnActive : ''}`}
            onClick={() => setAnnotationType(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <textarea
        className={styles.input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          annotationType === 'question'
            ? 'Ask a question about this code...'
            : annotationType === 'delete'
            ? 'Why should this be removed?'
            : 'Add your comment...'
        }
        rows={3}
        autoFocus
      />

      {annotationType === 'replace' && (
        <textarea
          className={styles.input}
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          placeholder="Replacement text..."
          rows={3}
        />
      )}

      <div className={styles.actions}>
        <button className={styles.cancelBtn} onClick={onCancel}>
          Cancel
        </button>
        <button className={styles.submitBtn} onClick={handleSubmit} disabled={!text.trim()}>
          Submit
        </button>
      </div>
    </div>
  );
}

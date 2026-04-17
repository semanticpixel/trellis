import type { DiffFileChange } from '../../hooks/useReview';
import { MessageSquare } from 'lucide-react';
import styles from './DiffFileList.module.css';

export interface AnnotationCount {
  active: number;
  outdated: number;
}

interface DiffFileListProps {
  files: DiffFileChange[];
  selectedFile: string | null;
  onSelectFile: (file: string) => void;
  onStage: (file: string) => void;
  onRevert: (file: string) => void;
  annotationCounts?: Record<string, AnnotationCount>;
}

const STATUS_ICONS: Record<string, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

export function DiffFileList({ files, selectedFile, onSelectFile, onStage, onRevert, annotationCounts }: DiffFileListProps) {
  if (files.length === 0) {
    return <div className={styles.empty}>No changes detected</div>;
  }

  return (
    <div className={styles.list}>
      {files.map((f) => {
        const counts = annotationCounts?.[f.file] ?? { active: 0, outdated: 0 };
        return (
          <div
            key={f.file}
            className={`${styles.row} ${selectedFile === f.file ? styles.rowActive : ''}`}
            onClick={() => onSelectFile(f.file)}
          >
            <span className={`${styles.status} ${styles[f.status]}`}>
              {STATUS_ICONS[f.status]}
            </span>
            <span className={styles.fileName} title={f.file}>
              {f.file}
            </span>
            {counts.active > 0 && (
              <span
                className={styles.annotationCount}
                title={`${counts.active} active comment${counts.active === 1 ? '' : 's'}`}
              >
                <MessageSquare size={11} />
                {counts.active}
              </span>
            )}
            {counts.outdated > 0 && (
              <span
                className={`${styles.annotationCount} ${styles.outdatedCount}`}
                title={`${counts.outdated} outdated comment${counts.outdated === 1 ? '' : 's'}`}
              >
                <MessageSquare size={11} />
                {counts.outdated}
              </span>
            )}
            <span className={styles.stats}>
              {f.additions > 0 && <span className={styles.additions}>+{f.additions}</span>}
              {f.deletions > 0 && <span className={styles.deletions}>-{f.deletions}</span>}
            </span>
            <div className={styles.fileActions}>
              <button
                className={styles.actionBtn}
                onClick={(e) => { e.stopPropagation(); onStage(f.file); }}
                title="Stage file"
              >
                S
              </button>
              <button
                className={`${styles.actionBtn} ${styles.revertBtn}`}
                onClick={(e) => { e.stopPropagation(); onRevert(f.file); }}
                title="Revert file"
              >
                R
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

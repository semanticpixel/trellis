import { X } from 'lucide-react';
import styles from './AttachmentStrip.module.css';

export interface ComposerAttachment {
  id: string;
  file: File;
  previewUrl: string;
}

interface AttachmentStripProps {
  attachments: ComposerAttachment[];
  onRemove: (id: string) => void;
  disabled?: boolean;
}

export function AttachmentStrip({ attachments, onRemove, disabled }: AttachmentStripProps) {
  if (attachments.length === 0) return null;
  return (
    <div className={styles.strip} role="list" aria-label="Image attachments">
      {attachments.map((att) => (
        <div key={att.id} className={styles.thumb} role="listitem">
          <img src={att.previewUrl} alt={att.file.name} className={styles.image} />
          <button
            type="button"
            className={styles.remove}
            onClick={() => onRemove(att.id)}
            disabled={disabled}
            title="Remove attachment"
            aria-label={`Remove attachment ${att.file.name}`}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

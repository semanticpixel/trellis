import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import styles from './MissingNotice.module.css';

interface MissingItem {
  type: string;
  id: string;
  name: string;
  path: string;
}

interface MissingNoticeProps {
  items: MissingItem[];
}

export function MissingNotice({ items }: MissingNoticeProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.notice}>
      <button className={styles.summary} onClick={() => setExpanded(!expanded)}>
        <AlertTriangle size={12} />
        <span>{items.length} missing project{items.length !== 1 ? 's' : ''}</span>
      </button>
      {expanded && (
        <div className={styles.details}>
          {items.map((item) => (
            <div key={item.id} className={styles.item}>
              <span className={styles.itemName}>{item.name}</span>
              <span className={styles.itemPath}>{item.path}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

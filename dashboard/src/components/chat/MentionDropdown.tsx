import { useEffect, useRef } from 'react';
import styles from './MentionDropdown.module.css';

interface MentionDropdownProps {
  results: string[];
  selectedIndex: number;
  loading: boolean;
  onSelect: (path: string) => void;
  onHover: (index: number) => void;
}

export function MentionDropdown({ results, selectedIndex, loading, onSelect, onHover }: MentionDropdownProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // Keep the active row scrolled into view as the user arrows down past the
  // visible window (the list shows ~8 rows but holds up to 20).
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLLIElement>(`[data-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!loading && results.length === 0) {
    return (
      <div className={styles.dropdown}>
        <div className={styles.empty}>No matching files</div>
      </div>
    );
  }

  return (
    <div className={styles.dropdown} role="listbox">
      <ul ref={listRef} className={styles.list}>
        {results.map((path, idx) => {
          const slash = path.lastIndexOf('/');
          const base = slash === -1 ? path : path.slice(slash + 1);
          const dir = slash === -1 ? '' : path.slice(0, slash);
          return (
            <li
              key={path}
              data-idx={idx}
              role="option"
              aria-selected={idx === selectedIndex}
              className={`${styles.row} ${idx === selectedIndex ? styles.active : ''}`}
              onMouseDown={(e) => {
                // Use mousedown so the click fires before the textarea's blur
                // closes the dropdown.
                e.preventDefault();
                onSelect(path);
              }}
              onMouseEnter={() => onHover(idx)}
            >
              <span className={styles.icon} aria-hidden="true">{'\u{1F4C4}'}</span>
              <span className={styles.base}>{base}</span>
              {dir && <span className={styles.dir}>{dir}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

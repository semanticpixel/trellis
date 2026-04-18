import { useEffect } from 'react';
import { X } from 'lucide-react';
import styles from './ShortcutReference.module.css';

interface ShortcutReferenceProps {
  onClose: () => void;
}

interface Shortcut {
  keys: string[];
  description: string;
}

interface ShortcutSection {
  title: string;
  shortcuts: Shortcut[];
}

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

const MOD = IS_MAC ? '⌘' : 'Ctrl';
const SHIFT = IS_MAC ? '⇧' : 'Shift';

const SECTIONS: ShortcutSection[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: [MOD, 'K'], description: 'Search threads' },
      { keys: [MOD, '1'], description: 'Switch to workspace 1' },
      { keys: [MOD, '…'], description: 'Switch to workspace 2–9' },
    ],
  },
  {
    title: 'Threads',
    shortcuts: [
      { keys: [MOD, 'N'], description: 'New thread in active workspace' },
      { keys: ['Enter'], description: 'Send message' },
      { keys: [SHIFT, 'Enter'], description: 'Newline in composer' },
    ],
  },
  {
    title: 'Review',
    shortcuts: [
      { keys: [MOD, SHIFT, 'D'], description: 'Toggle review panel' },
      { keys: [MOD, 'Enter'], description: 'Submit inline comment' },
    ],
  },
  {
    title: 'Terminal',
    shortcuts: [{ keys: [MOD, '`'], description: 'Toggle terminal' }],
  },
  {
    title: 'General',
    shortcuts: [
      { keys: [MOD, '/'], description: 'Show this reference' },
      { keys: ['Esc'], description: 'Close modal or popover' },
    ],
  },
];

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className={styles.kbd}>{children}</kbd>;
}

export function ShortcutReference({ onClose }: ShortcutReferenceProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.title}>Keyboard shortcuts</span>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          {SECTIONS.map((section) => (
            <section key={section.title} className={styles.section}>
              <div className={styles.sectionTitle}>{section.title}</div>
              <ul className={styles.list}>
                {section.shortcuts.map((s, i) => (
                  <li key={i} className={styles.row}>
                    <span className={styles.description}>{s.description}</span>
                    <span className={styles.keys}>
                      {s.keys.map((k, ki) => (
                        <Kbd key={ki}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

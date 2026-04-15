import { useState } from 'react';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import styles from './ToolCallBlock.module.css';

interface ToolCallBlockProps {
  name: string;
  toolUseId: string;
  input?: string;
  result?: string;
}

export function ToolCallBlock({ name, input, result }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const isResult = !!result;

  let content = '';
  if (input) {
    try {
      content = JSON.stringify(JSON.parse(input), null, 2);
    } catch {
      content = input;
    }
  } else if (result) {
    content = result;
  }

  return (
    <div className={`${styles.block} ${isResult ? styles.result : styles.call}`}>
      <button className={styles.header} onClick={() => setExpanded(!expanded)}>
        <span className={styles.icon}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <Wrench size={12} />
        <span className={styles.name}>{name}</span>
        <span className={styles.label}>{isResult ? 'result' : 'call'}</span>
      </button>
      {expanded && (
        <pre className={styles.content}>{content}</pre>
      )}
    </div>
  );
}

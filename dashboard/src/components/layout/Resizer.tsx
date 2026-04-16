import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './Resizer.module.css';

interface ResizerProps {
  onResize: (deltaPx: number) => void;
  onResizeEnd?: () => void;
  ariaLabel: string;
}

export function Resizer({ onResize, onResizeEnd, ariaLabel }: ResizerProps) {
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const lastDelta = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startX.current = e.clientX;
    lastDelta.current = 0;
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      const delta = e.clientX - startX.current;
      const incremental = delta - lastDelta.current;
      lastDelta.current = delta;
      if (incremental !== 0) onResize(incremental);
    };
    const handleUp = () => {
      setDragging(false);
      onResizeEnd?.();
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [dragging, onResize, onResizeEnd]);

  return (
    <div
      className={`${styles.handle} ${dragging ? styles.dragging : ''}`}
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
    />
  );
}

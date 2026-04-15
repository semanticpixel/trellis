import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useWebSocket } from '../../hooks/useWebSocket';
import { sendWs } from '../../hooks/useWebSocket';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { WSMessage } from '@shared/types';
import '@xterm/xterm/css/xterm.css';
import styles from './EmbeddedTerminal.module.css';

interface EmbeddedTerminalProps {
  workspaceId: string;
  cwd: string; // repo path or workspace path
  onClose: () => void;
}

export function EmbeddedTerminal({ workspaceId, cwd, onClose }: EmbeddedTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const startedRef = useRef(false);
  const [collapsed, setCollapsed] = useState(false);

  // Initialize xterm
  useEffect(() => {
    if (!termRef.current) return;

    const term = new XTerm({
      fontSize: 12,
      fontFamily: 'var(--font-mono), monospace',
      cursorBlink: true,
      theme: {
        background: getComputedStyle(document.documentElement).getPropertyValue('--bg-code').trim() || '#1e1e1e',
        foreground: getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#e5e5e5',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termRef.current);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Send input to backend
    term.onData((data) => {
      sendWs({
        type: 'terminal_input',
        workspaceId,
        data,
      });
    });

    // Use ResizeObserver — fit after container has measured size
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        // Notify backend of new size
        sendWs({
          type: 'terminal_resize',
          workspaceId,
          cols: term.cols,
          rows: term.rows,
        });
      } catch {
        // fit() can throw if container not yet visible
      }
    });
    resizeObserver.observe(termRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      startedRef.current = false;
    };
  }, [workspaceId]);

  // Start terminal session after xterm is ready
  useEffect(() => {
    if (startedRef.current || !xtermRef.current) return;

    // Small delay to let fitAddon measure
    const timer = setTimeout(() => {
      if (!xtermRef.current) return;
      startedRef.current = true;
      sendWs({
        type: 'terminal_start',
        workspaceId,
        cwd,
        cols: xtermRef.current.cols,
        rows: xtermRef.current.rows,
      });
    }, 100);

    return () => clearTimeout(timer);
  }, [workspaceId, cwd]);

  // Listen for terminal output from server
  useWebSocket(useCallback((msg: WSMessage) => {
    if (msg.threadId !== workspaceId) return;
    if (msg.type === 'terminal_output') {
      const { output } = msg.data as { output: string };
      xtermRef.current?.write(output);
    } else if (msg.type === 'terminal_exit') {
      xtermRef.current?.writeln('\r\n[Process exited]');
    }
  }, [workspaceId]));

  // Re-fit when uncollapsed
  useEffect(() => {
    if (!collapsed && fitAddonRef.current) {
      // Short delay so DOM is visible before fit
      const timer = setTimeout(() => {
        try { fitAddonRef.current?.fit(); } catch { /* ignore */ }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [collapsed]);

  return (
    <div className={styles.container}>
      <div className={styles.header} onClick={() => setCollapsed(!collapsed)}>
        <div className={styles.headerLeft}>
          {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          <span>Terminal</span>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.iconBtn}
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            title="Close terminal"
          >
            <X size={12} />
          </button>
        </div>
      </div>
      <div
        ref={termRef}
        className={collapsed ? styles.terminalWrapperCollapsed : styles.terminalWrapper}
      />
    </div>
  );
}

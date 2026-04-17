import { useState, useRef, useEffect } from 'react';
import type { Workspace } from '@shared/types';
import { AddWorkspaceModal } from '../sidebar/AddWorkspaceModal';
import { FolderPlus, Search, Bug, TestTube } from 'lucide-react';
import styles from './WelcomeState.module.css';

interface WelcomeStateProps {
  hasWorkspaces: boolean;
  workspaces: Workspace[];
  onStartWithPrompt: (workspaceId: string, prompt: string) => void;
  // When set, suggestion clicks send into the existing (empty) thread instead
  // of going through the new-thread/workspace-picker flow.
  onPromptInThread?: (prompt: string) => void;
  inThread?: boolean;
}

const SUGGESTIONS = [
  { icon: Search, label: 'Explore a codebase', prompt: 'Give me an overview of this codebase — key modules, architecture, and how data flows through the system.' },
  { icon: Bug, label: 'Fix a bug', prompt: 'Help me track down and fix a bug. I\'ll describe the symptoms.' },
  { icon: TestTube, label: 'Write tests', prompt: 'Identify untested code paths and help me write comprehensive tests for them.' },
];

export function WelcomeState({
  hasWorkspaces,
  workspaces,
  onStartWithPrompt,
  onPromptInThread,
  inThread,
}: WelcomeStateProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [pickerPrompt, setPickerPrompt] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close picker on outside click
  useEffect(() => {
    if (!pickerPrompt) return;
    const handle = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerPrompt(null);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [pickerPrompt]);

  // Close picker on Escape
  useEffect(() => {
    if (!pickerPrompt) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerPrompt(null);
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [pickerPrompt]);

  const handleCardClick = (prompt: string) => {
    if (onPromptInThread) {
      onPromptInThread(prompt);
      return;
    }
    if (!hasWorkspaces) {
      setShowAddModal(true);
      return;
    }
    if (workspaces.length === 1) {
      onStartWithPrompt(workspaces[0].id, prompt);
      return;
    }
    // Multiple workspaces — show picker
    setPickerPrompt(prompt);
  };

  const handlePickWorkspace = (workspaceId: string) => {
    if (pickerPrompt) {
      onStartWithPrompt(workspaceId, pickerPrompt);
      setPickerPrompt(null);
    }
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.heading}>Let's build</h1>

      {inThread ? (
        <p className={styles.subtitle}>
          Pick a prompt below or type your own.
        </p>
      ) : hasWorkspaces ? (
        <p className={styles.subtitle}>
          Select a thread from the sidebar, or pick a prompt below to get started.
        </p>
      ) : (
        <>
          <p className={styles.subtitle}>
            Add a workspace to start coding with AI across your projects.
          </p>
          <button className={styles.cta} onClick={() => setShowAddModal(true)}>
            <FolderPlus size={16} />
            Add workspace
          </button>
        </>
      )}

      <div className={styles.suggestions}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            className={styles.card}
            onClick={() => handleCardClick(s.prompt)}
          >
            <s.icon size={18} className={styles.cardIcon} />
            <div className={styles.cardText}>
              <span className={styles.cardLabel}>{s.label}</span>
              <span className={styles.cardPrompt}>{s.prompt}</span>
            </div>
          </button>
        ))}
      </div>

      {pickerPrompt && (
        <div className={styles.pickerBackdrop}>
          <div className={styles.picker} ref={pickerRef}>
            <div className={styles.pickerTitle}>Choose a workspace</div>
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                className={styles.pickerItem}
                onClick={() => handlePickWorkspace(ws.id)}
              >
                <span className={styles.pickerDot} style={{ backgroundColor: ws.color ?? '#6e7681' }} />
                <span className={styles.pickerName}>{ws.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showAddModal && (
        <AddWorkspaceModal onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
}

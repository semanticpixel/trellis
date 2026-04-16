import { useState } from 'react';
import { AddWorkspaceModal } from '../sidebar/AddWorkspaceModal';
import { FolderPlus, Search, Bug, TestTube } from 'lucide-react';
import styles from './WelcomeState.module.css';

interface WelcomeStateProps {
  hasWorkspaces: boolean;
}

const SUGGESTIONS = [
  { icon: Search, label: 'Explore a codebase', prompt: 'Give me an overview of this codebase — key modules, architecture, and how data flows through the system.' },
  { icon: Bug, label: 'Fix a bug', prompt: 'Help me track down and fix a bug. I\'ll describe the symptoms.' },
  { icon: TestTube, label: 'Write tests', prompt: 'Identify untested code paths and help me write comprehensive tests for them.' },
];

export function WelcomeState({ hasWorkspaces }: WelcomeStateProps) {
  const [showAddModal, setShowAddModal] = useState(false);

  return (
    <div className={styles.container}>
      <h1 className={styles.heading}>Let's build</h1>

      {hasWorkspaces ? (
        <p className={styles.subtitle}>
          Select a thread from the sidebar, or start a new one to begin coding.
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
          <div key={s.label} className={styles.card}>
            <s.icon size={18} className={styles.cardIcon} />
            <span className={styles.cardLabel}>{s.label}</span>
            <span className={styles.cardPrompt}>{s.prompt}</span>
          </div>
        ))}
      </div>

      {showAddModal && (
        <AddWorkspaceModal onClose={() => setShowAddModal(false)} />
      )}
    </div>
  );
}

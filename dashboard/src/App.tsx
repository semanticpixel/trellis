import { useState } from 'react';
import styles from './App.module.css';

export function App() {
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);

  return (
    <div className={styles.shell}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <span className={styles.logo}>Trellis</span>
        </div>
        <div className={styles.sidebarContent}>
          <p className={styles.placeholder}>Add a workspace to get started</p>
        </div>
        <div className={styles.sidebarFooter}>
          <button className={styles.addWorkspace}>+ Add workspace</button>
        </div>
      </aside>

      {/* Chat Panel */}
      <main className={styles.chat}>
        <div className={styles.chatHeader}>
          <span className={styles.threadTitle}>No thread selected</span>
          <div className={styles.chatActions}>
            <button
              className={styles.reviewToggle}
              onClick={() => setReviewPanelOpen(!reviewPanelOpen)}
              title="Toggle review panel"
            >
              {reviewPanelOpen ? '◧' : '◨'}
            </button>
          </div>
        </div>
        <div className={styles.chatMessages}>
          <p className={styles.placeholder}>Select or create a thread to start chatting</p>
        </div>
        <div className={styles.chatComposer}>
          <textarea
            className={styles.composerInput}
            placeholder="Type a message..."
            rows={3}
            disabled
          />
        </div>
      </main>

      {/* Review Panel (toggleable) */}
      {reviewPanelOpen && (
        <aside className={styles.reviewPanel}>
          <div className={styles.reviewHeader}>
            <button className={styles.reviewTab}>Diff</button>
            <button className={styles.reviewTab}>Plan</button>
          </div>
          <div className={styles.reviewContent}>
            <p className={styles.placeholder}>Review panel — Phase 2</p>
          </div>
        </aside>
      )}
    </div>
  );
}

import type { Thread, Workspace } from '@shared/types';
import { useMessages, useSendMessage } from '../../hooks/useWorkspaces';
import { useChatStream } from '../../hooks/useChatStream';
import { ChatMessageList } from './ChatMessageList';
import { ChatComposer } from './ChatComposer';
import { ModelSelector } from './ModelSelector';
import { EmbeddedTerminal } from '../terminal/EmbeddedTerminal';
import { WelcomeState } from './WelcomeState';
import styles from './ChatPanel.module.css';

interface ChatPanelProps {
  thread: Thread | null;
  workspaceColor: string;
  onToggleReview: () => void;
  reviewOpen: boolean;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  onCloseTerminal: () => void;
  workspaceId: string | null;
  terminalCwd: string;
  hasWorkspaces: boolean;
  workspaces: Workspace[];
  onStartWithPrompt: (workspaceId: string, prompt: string) => void;
}

export function ChatPanel({
  thread,
  workspaceColor,
  onToggleReview,
  reviewOpen,
  terminalOpen,
  onCloseTerminal,
  workspaceId,
  terminalCwd,
  hasWorkspaces,
  workspaces,
  onStartWithPrompt,
}: ChatPanelProps) {
  const threadId = thread?.id ?? null;
  const { data: messages } = useMessages(threadId);
  const { streamingText, isStreaming, error } = useChatStream(threadId);
  const sendMessage = useSendMessage();

  const handleSend = (content: string) => {
    if (!threadId) return;
    sendMessage.mutate({ threadId, content });
  };

  if (!thread) {
    return (
      <main className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.threadTitle}>No thread selected</span>
          <div className={styles.actions}>
            <button className={styles.reviewToggle} onClick={onToggleReview} title="Toggle review panel">
              {reviewOpen ? '\u25E7' : '\u25E8'}
            </button>
          </div>
        </div>
        <div className={styles.empty}>
          <WelcomeState
            hasWorkspaces={hasWorkspaces}
            workspaces={workspaces}
            onStartWithPrompt={onStartWithPrompt}
          />
        </div>
      </main>
    );
  }

  return (
    <main className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.colorPip} style={{ backgroundColor: workspaceColor }} />
          <span className={styles.threadTitle}>{thread.title}</span>
        </div>
        <div className={styles.actions}>
          <ModelSelector provider={thread.provider} model={thread.model} threadId={thread.id} />
          <button className={styles.reviewToggle} onClick={onToggleReview} title="Toggle review panel">
            {reviewOpen ? '\u25E7' : '\u25E8'}
          </button>
        </div>
      </div>

      {messages !== undefined && messages.length === 0 && !isStreaming ? (
        <div className={styles.empty}>
          <WelcomeState
            hasWorkspaces={hasWorkspaces}
            workspaces={workspaces}
            onStartWithPrompt={onStartWithPrompt}
            onPromptInThread={(prompt) => sendMessage.mutate({ threadId: thread.id, content: prompt })}
            inThread
          />
        </div>
      ) : (
        <ChatMessageList
          messages={messages ?? []}
          streamingText={streamingText}
          isStreaming={isStreaming}
        />
      )}

      {error && (
        <div className={styles.errorBar}>{error}</div>
      )}

      <ChatComposer
        onSend={handleSend}
        disabled={isStreaming || sendMessage.isPending}
      />

      {terminalOpen && workspaceId && terminalCwd && (
        <EmbeddedTerminal
          workspaceId={workspaceId}
          cwd={terminalCwd}
          onClose={onCloseTerminal}
        />
      )}
    </main>
  );
}
